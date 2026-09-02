/**
 * THE MORNING SAMPLER — Phase 3 ("Earn sending"), design §4 "un-earning" and §8.
 *
 * Once an intent is at SEND, Ben stops seeing it, so the verdict stream that promoted it would
 * stop. Every morning at 08:30 Europe/London (worker-gated, behind spine.sampler.enabled) this
 * picks a review set from YESTERDAY's automatic sends:
 *   · a random 10% (min 1, max 15) of agent_runs with decision 'send' by an `agent.*` approver, PLUS
 *   · every send whose thread then got an opt-out, a complaint keyword, or no reply within 48h of a question.
 * For each: the Verifier's `move-quality-v1` judgement → a draft_verdicts row by `agent.verifier`
 * (sample_fine / sample_not_fine + reason), AND a queue item for Ben (agent_questions, source
 * 'sampler', options fine / not fine, due next office day). Ben's tap writes a second verdict row
 * by `human:<id>` (server/agent-questions.ts). Both are stored; pane A computes agreement.
 *
 * Idempotent: the question id is derived from the draft id, so a rerun inserts nothing twice, and
 * a draft already judged by agent.verifier is skipped.
 */
import { db } from '../db';
import { agentRuns, agentQuestions, messageDrafts, messages, conversations, draftVerdicts, commsOptOuts } from '@shared/schema';
import { and, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { isCommsWorker } from '../worker-gate';
import { getSpineConfig } from './config';
import { judgeSend, type JudgeLlm, type JudgeResult } from './agents/verifier';
import { recordVerdict } from '../verdicts';
import { RE_COMPLAINT } from './triage';
import { commsPhoneKey } from '../phone-utils';
import { nextWorkingSlot, OFFICE_HOURS, ukParts } from '../working-hours';
import { logSystemEvent } from '../system-events';
import { notQuarantined } from '../message-quarantine';

export const SAMPLER_APPROVER = 'agent.verifier';
export const SAMPLE_QUESTION_PREFIX = 'aq_sample_';
export const SAMPLE_OPTIONS = ['fine', 'not fine'] as const;
export const NO_REPLY_WINDOW_HOURS = 48;

// ---------------------------------------------------------------- pure selection (tested)

export type SampleSignal = 'opt_out' | 'complaint_keyword' | 'no_reply_48h';

export interface SendCandidate {
    runId: string;
    draftId: string;
    conversationId: string | null;
    phone: string;
    body: string;
    intent: string | null;
    approver: string | null;
    sentAt: Date;
    signals: SampleSignal[];
}

export interface SelectionOpts { rate?: number; min?: number; max?: number; rng?: () => number }

/** Random 10% (clamped) of the unflagged sends, plus every flagged send. Deterministic given rng. */
export function selectSamples<T extends { signals: SampleSignal[] }>(sends: T[], opts: SelectionOpts = {}): T[] {
    const rate = opts.rate ?? 0.1;
    const min = opts.min ?? 1;
    const max = opts.max ?? 15;
    const rng = opts.rng ?? Math.random;
    if (!sends.length) return [];
    const flagged = sends.filter((s) => s.signals.length > 0);
    const rest = sends.filter((s) => s.signals.length === 0);
    const wanted = Math.min(rest.length, Math.max(Math.min(min, rest.length), Math.min(max, Math.ceil(sends.length * rate))));
    // Fisher–Yates on a copy, take the head.
    const pool = rest.slice();
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return [...flagged, ...pool.slice(0, wanted)];
}

/** UK calendar day bounds for "yesterday" relative to `now`. */
export function yesterdayBoundsUk(now: Date): { start: Date; end: Date; label: string } {
    const p = ukParts(now);
    // Midnight UK today, found by stepping back from `now` on the wall clock and re-reading.
    let t = now.getTime() - ((p.hour * 60 + p.minute) * 60_000) - now.getSeconds() * 1000 - now.getMilliseconds();
    let q = ukParts(new Date(t));
    if (q.hour !== 0) t -= (q.hour >= 12 ? q.hour - 24 : q.hour) * 3_600_000; // DST correction
    const end = new Date(t);
    let s = t - 24 * 3_600_000;
    q = ukParts(new Date(s));
    if (q.hour !== 0) s -= (q.hour >= 12 ? q.hour - 24 : q.hour) * 3_600_000;
    const start = new Date(s);
    const sp = ukParts(start);
    return { start, end, label: `${sp.year}-${String(sp.month).padStart(2, '0')}-${String(sp.day).padStart(2, '0')}` };
}

/** Next office day 08:00 (never today): the review is a morning task. */
export function sampleDueAt(now: Date): Date {
    const p = ukParts(now);
    const todayEnd = new Date(now.getTime() + ((24 - p.hour) * 60 - p.minute) * 60_000);
    return nextWorkingSlot(todayEnd, OFFICE_HOURS);
}

export function questionIdFor(draftId: string): string {
    return `${SAMPLE_QUESTION_PREFIX}${draftId}`;
}
export function draftIdFromQuestionId(id: string): string | null {
    return id.startsWith(SAMPLE_QUESTION_PREFIX) ? id.slice(SAMPLE_QUESTION_PREFIX.length) : null;
}

/** Ben's tap → verdict. Anything that is not clearly "fine" is not fine (fail toward review). */
export function verdictFromAnswer(answer: string): 'sample_fine' | 'sample_not_fine' {
    return /^\s*fine\s*$/i.test(answer) ? 'sample_fine' : 'sample_not_fine';
}

// ---------------------------------------------------------------- db-backed

async function yesterdaysAutomaticSends(now: Date): Promise<SendCandidate[]> {
    const { start, end } = yesterdayBoundsUk(now);
    const runs = await db.select({
        id: agentRuns.id, conversationId: agentRuns.conversationId, proposal: agentRuns.proposal, finishedAt: agentRuns.finishedAt,
    }).from(agentRuns).where(and(
        eq(agentRuns.decision, 'send'), isNotNull(agentRuns.finishedAt),
        gte(agentRuns.finishedAt, start), lt(agentRuns.finishedAt, end),
    )).limit(500);
    const out: SendCandidate[] = [];
    for (const r of runs) {
        const p = (r.proposal ?? {}) as any;
        const approver: string | null = p?.decision?.approver ?? null;
        if (!approver || !approver.startsWith('agent.')) continue;
        const [draft] = await db.select({ id: messageDrafts.id, phone: messageDrafts.phone, body: messageDrafts.body, sentAt: messageDrafts.sentAt, reason: messageDrafts.reason })
            .from(messageDrafts).where(and(eq(messageDrafts.runId, r.id), eq(messageDrafts.status, 'sent'))).orderBy(desc(messageDrafts.sentAt)).limit(1);
        if (!draft) continue;
        out.push({
            runId: r.id, draftId: draft.id, conversationId: r.conversationId ?? null, phone: draft.phone, body: draft.body,
            intent: p?.proposal?.intent ?? null, approver, sentAt: draft.sentAt ? new Date(draft.sentAt) : new Date(r.finishedAt!), signals: [],
        });
    }
    return out;
}

async function signalsFor(s: SendCandidate, now: Date): Promise<SampleSignal[]> {
    const signals: SampleSignal[] = [];
    const key = commsPhoneKey(s.phone);
    if (key) {
        const [opt] = await db.select({ id: commsOptOuts.id }).from(commsOptOuts)
            .where(and(eq(commsOptOuts.phoneKey, key), gte(commsOptOuts.createdAt, s.sentAt))).limit(1);
        if (opt) signals.push('opt_out');
    }
    if (s.conversationId) {
        const inbound = await db.select({ content: messages.content, createdAt: messages.createdAt }).from(messages)
            .where(and(eq(messages.conversationId, s.conversationId), eq(messages.direction, 'inbound'), notQuarantined, gte(messages.createdAt, s.sentAt)))
            .orderBy(messages.createdAt).limit(50);
        if (inbound.some((m) => RE_COMPLAINT.test(m.content ?? ''))) signals.push('complaint_keyword');
        const askedQuestion = s.body.includes('?');
        const windowClosed = now.getTime() - s.sentAt.getTime() >= NO_REPLY_WINDOW_HOURS * 3_600_000;
        const repliedInWindow = inbound.some((m) => m.createdAt && new Date(m.createdAt).getTime() - s.sentAt.getTime() <= NO_REPLY_WINDOW_HOURS * 3_600_000);
        if (askedQuestion && windowClosed && !repliedInWindow) signals.push('no_reply_48h');
    }
    return signals;
}

async function alreadyJudged(draftId: string): Promise<boolean> {
    const [row] = await db.select({ id: draftVerdicts.id }).from(draftVerdicts)
        .where(and(eq(draftVerdicts.draftId, draftId), eq(draftVerdicts.by, SAMPLER_APPROVER))).limit(1);
    return !!row;
}

async function renderThread(conversationId: string | null, upTo: Date): Promise<string> {
    if (!conversationId) return '(no thread)';
    const rows = await db.select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt, senderName: messages.senderName })
        .from(messages).where(and(eq(messages.conversationId, conversationId), notQuarantined, lte(messages.createdAt, new Date(upTo.getTime() + 60_000))))
        .orderBy(desc(messages.createdAt)).limit(30);
    return rows.reverse().map((m) => `${m.direction === 'inbound' ? 'CUSTOMER' : 'US'}: ${(m.content ?? '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
}

export interface SamplerResult {
    day: string;
    candidates: number;
    selected: number;
    judged: number;
    queued: number;
    skipped: number;
    failed: number;
    notFine: number;
}

export interface SamplerDeps { now?: Date; llm?: JudgeLlm; model?: string; rng?: () => number }

/** The 08:30 job. Never throws; every failure is a count and a log line. */
export async function runSampler(deps: SamplerDeps = {}): Promise<SamplerResult | { skipped: true; reason: string }> {
    const now = deps.now ?? new Date();
    if (!isCommsWorker()) return { skipped: true, reason: 'not the comms worker' };
    const cfg = await getSpineConfig();
    if (!cfg.sampler?.enabled) return { skipped: true, reason: 'spine.sampler.enabled is false' };

    const { label } = yesterdayBoundsUk(now);
    const result: SamplerResult = { day: label, candidates: 0, selected: 0, judged: 0, queued: 0, skipped: 0, failed: 0, notFine: 0 };
    const sends = await yesterdaysAutomaticSends(now);
    for (const s of sends) s.signals = await signalsFor(s, now).catch(() => []);
    result.candidates = sends.length;
    const picked = selectSamples(sends, { rate: cfg.sampler.rate, min: cfg.sampler.min, max: cfg.sampler.max, rng: deps.rng });
    result.selected = picked.length;
    const dueAt = sampleDueAt(now);

    for (const s of picked) {
        if (await alreadyJudged(s.draftId)) { result.skipped++; continue; }
        let judged: JudgeResult | null = null;
        try {
            judged = await judgeSend({ body: s.body, intent: s.intent, approver: s.approver, thread: await renderThread(s.conversationId, s.sentAt), signals: s.signals }, { llm: deps.llm, model: deps.model });
        } catch (error: any) {
            result.failed++;
            console.error(`[Sampler] judge failed for draft ${s.draftId}:`, error?.message ?? error);
        }
        if (judged) {
            await recordVerdict({ draftId: s.draftId, runId: s.runId, verdict: judged.verdict, reason: judged.reason, originalBody: s.body, finalBody: s.body, by: SAMPLER_APPROVER });
            result.judged++;
            if (judged.verdict === 'sample_not_fine') result.notFine++;
        }
        // The queue item for Ben, idempotent on the draft id.
        const [conv] = s.conversationId ? await db.select({ contactName: conversations.contactName }).from(conversations).where(eq(conversations.id, s.conversationId)).limit(1) : [null];
        const who = conv?.contactName ?? s.phone;
        const inserted = await db.insert(agentQuestions).values({
            id: questionIdFor(s.draftId),
            conversationId: s.conversationId ?? '',
            phone: s.phone,
            question: `Automatic send to ${who} yesterday: fine?`,
            context: [
                `SENT (${s.intent ?? 'no intent'}, ${s.approver ?? 'agent'}):`, s.body, '',
                judged ? `Judge (${judged.rubric}, ${judged.model}): ${judged.verdict === 'sample_fine' ? 'fine' : `NOT fine (${judged.reason})`}. ${judged.judgement.reason}` : 'Judge: unavailable',
                s.signals.length ? `Signals: ${s.signals.join(', ')}` : '',
            ].filter(Boolean).join('\n'),
            options: [...SAMPLE_OPTIONS],
            source: 'sampler',
            status: 'open',
            dueAt,
            runId: s.runId,
        }).onConflictDoNothing().returning({ id: agentQuestions.id });
        if (inserted.length) result.queued++;
    }
    void logSystemEvent({ kind: 'sweep', source: 'sampler', summary: `sampler ${label}: ${result.selected}/${result.candidates} selected, ${result.judged} judged (${result.notFine} not fine), ${result.queued} queued for Ben`, detail: { ...result } });
    console.log(`[Sampler] ${JSON.stringify(result)}`);
    return result;
}
