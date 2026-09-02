/**
 * SILENCE-BREAKER + EXPIRY + DIGEST — the rules-layer sweeps (Phase 1, 2 Sep 2026).
 *
 * Runs inside the worker's fast tick (server/agents/comms-sweep.ts, gated by COMMS_WORKER=1),
 * 24/7 — the rule is about the customer's clock, not Ben's. Each pass is throttled to once a
 * minute, claims every row it acts on with an atomic UPDATE (the 27 Aug lesson: advisory
 * check-then-act reads are how three processes all "win"), and hands the actual send to
 * server/rules-layer.ts, which owns copy, suppression and the template/SMS ladder.
 *
 *   sweepSilence   an inbound ≥ 10 min old with no outbound since → holding line ('silence').
 *                  Idempotent via conversations.metadata.silenceBreakerAt: one per inbound burst.
 *   expireFlags    agent_questions past due_at, unanswered → holding line ('flag_expiry'),
 *                  expired_at stamped (the claim), Ben re-pinged ONCE.
 *   expireDrafts   pending message_drafts past due_at → holding line ('draft_expiry'),
 *                  held_reason = 'due_expired' (the claim). The draft stays pending.
 *   morningDigest  09:00 Europe/London (cron, gated): flags past due, drafts pending > 2h,
 *                  bursts that got only a holding line yesterday.
 *
 * Ledger: no server/ledger.ts exists yet (pane A owns it); every action lands in system_events
 * via logSystemEvent with a `runId`, which is what the ledger will backfill from.
 */
import { db } from '../db';
import { conversations, messages, messageDrafts, agentQuestions } from '@shared/schema';
import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { notQuarantined } from '../message-quarantine';
import { sendHoldingLine, isTestNumber } from '../rules-layer';
import { newRunId } from '../approver';
import { logSystemEvent } from '../system-events';
import { formatUk } from '../working-hours';

/** Decided 2 Sep 2026 (design §0b / §3.5): ten minutes, 24/7. */
export const SILENCE_AFTER_MINUTES = 10;
/** Older than this belongs to the backlog lanes, not a live burst. */
export const SILENCE_MAX_AGE_HOURS = 48;
const PASS_EVERY_MS = 60_000;
const MAX_SILENCE_PER_PASS = 5;
const MAX_EXPIRY_PER_PASS = 5;

// ---------------------------------------------------------------- pure decisions (tested)

export interface SilenceCandidate {
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    /** metadata.silenceBreakerAt — when we last broke a silence on this thread. */
    silenceBreakerAt: Date | null;
    now: Date;
}

/**
 * Is this thread a silent burst? Customer wrote ≥ 10 min ago, nothing outbound since, and we
 * have not already broken the silence for THIS inbound (a stamp older than the inbound is a
 * previous burst and does not count).
 */
export function isSilentBurst(c: SilenceCandidate): boolean {
    if (!c.lastInboundAt) return false;
    const ageMs = c.now.getTime() - c.lastInboundAt.getTime();
    if (ageMs < SILENCE_AFTER_MINUTES * 60_000) return false;
    if (ageMs > SILENCE_MAX_AGE_HOURS * 3_600_000) return false;
    if (c.lastOutboundAt && c.lastOutboundAt.getTime() > c.lastInboundAt.getTime()) return false;
    if (c.silenceBreakerAt && c.silenceBreakerAt.getTime() >= c.lastInboundAt.getTime()) return false;
    return true;
}

export interface FlagCandidate {
    status: string;
    dueAt: Date | null;
    expiredAt: Date | null;
    answeredAt: Date | null;
    /** A human outbound on the thread since the flag was raised = Ben acted. */
    humanRepliedSince: boolean;
    now: Date;
}

/** Past due, nobody answered it, nobody replied in the thread, not already expired. */
export function isExpiredFlag(f: FlagCandidate): boolean {
    if (!f.dueAt || f.expiredAt) return false;
    if (f.dueAt.getTime() > f.now.getTime()) return false;
    if (f.answeredAt || f.humanRepliedSince) return false;
    return f.status === 'open' || f.status === 'flagged';
}

export interface DraftCandidate {
    status: string;
    dueAt: Date | null;
    heldReason: string | null;
    source: string;
    now: Date;
}

export const DUE_EXPIRED = 'due_expired';

/** Pending, past due, not already marked, and not one of our own holding lines. */
export function isExpiredDraft(d: DraftCandidate): boolean {
    if (d.status !== 'pending' || !d.dueAt) return false;
    if (d.dueAt.getTime() > d.now.getTime()) return false;
    if (d.heldReason === DUE_EXPIRED) return false;
    return d.source !== 'rules_layer';
}

// ---------------------------------------------------------------- shared lookups

async function lastMessageTimes(conversationId: string): Promise<{ lastInboundAt: Date | null; lastOutboundAt: Date | null }> {
    const [lastIn] = await db.select({ at: messages.createdAt }).from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound'), notQuarantined))
        .orderBy(desc(messages.createdAt)).limit(1);
    const [lastOut] = await db.select({ at: messages.createdAt }).from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'outbound'), notQuarantined))
        .orderBy(desc(messages.createdAt)).limit(1);
    // An outbound CALL is a reply too (2 Sep 2026): Ben ringing the customer back must not be
    // followed by a "we have got it" text. Match on the last 10 digits of the thread's number.
    let lastCallOutAt: Date | null = null;
    try {
        const [conv] = await db.select({ phone: conversations.phoneNumber }).from(conversations)
            .where(eq(conversations.id, conversationId)).limit(1);
        const digits = (conv?.phone ?? '').replace(/\D/g, '').slice(-10);
        if (digits.length >= 9) {
            const r: any = await db.execute(sql`select max(start_time) as at from calls where direction = 'outbound' and regexp_replace(phone_number, '\\D', '', 'g') like ${'%' + digits}`);
            const at = (r.rows ?? r)?.[0]?.at;
            if (at) lastCallOutAt = new Date(at);
        }
    } catch { /* calls lookup is best-effort */ }
    const lastOutMsgAt = lastOut?.at ? new Date(lastOut.at) : null;
    const lastOutboundAt = [lastOutMsgAt, lastCallOutAt].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    return {
        lastInboundAt: lastIn?.at ? new Date(lastIn.at) : null,
        lastOutboundAt,
    };
}

/**
 * "Ben replied" = an outbound since `since` whose text is not one of OUR sent drafts (agent,
 * rules layer, acks) in that period. Same idea as sla-sweep's humanOutboundSince, restated
 * here because that one is private.
 */
async function humanOutboundSince(conversationId: string, phone: string, since: Date): Promise<boolean> {
    const outs = await db.select({ content: messages.content }).from(messages)
        .where(and(
            eq(messages.conversationId, conversationId), eq(messages.direction, 'outbound'), notQuarantined,
            gte(messages.createdAt, since), notInArray(messages.channel, ['call', 'note']),
        )).limit(50);
    if (!outs.length) return false;
    const digits = phone.replace(/\D/g, '');
    const ours = await db.select({ body: messageDrafts.body }).from(messageDrafts)
        .where(and(
            sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`,
            inArray(messageDrafts.status, ['sent', 'approved']),
            gte(messageDrafts.createdAt, new Date(since.getTime() - 60_000)),
        )).limit(100);
    const ourParts = new Set(ours.flatMap((d) => d.body.split(/\n\s*---\s*\n/)).map((p) => p.trim()).filter(Boolean));
    return outs.some((m) => {
        const text = (m.content ?? '').trim();
        return !!text && !ourParts.has(text);
    });
}

// ---------------------------------------------------------------- 1. silence

export interface SilenceSweepResult { scanned: number; sent: number; suppressed: number; skipped: number }

export async function sweepSilence(now: Date = new Date()): Promise<SilenceSweepResult> {
    const oldest = new Date(now.getTime() - SILENCE_MAX_AGE_HOURS * 3_600_000);
    const newest = new Date(now.getTime() - SILENCE_AFTER_MINUTES * 60_000);
    const candidates = await db.select({
        id: conversations.id,
        phoneNumber: conversations.phoneNumber,
        lastCustomerContactAt: conversations.lastCustomerContactAt,
        metadata: conversations.metadata,
    }).from(conversations).where(and(
        isNull(conversations.archivedAt),
        eq(conversations.roleProfile, 'customer'),
        notInArray(conversations.stage, ['closed', 'won']),
        gte(conversations.lastCustomerContactAt, oldest),
        lte(conversations.lastCustomerContactAt, newest),
        // Cheap pre-filter on the stamp; the exact per-inbound check is below.
        sql`(${conversations.metadata}->>'silenceBreakerAt') IS NULL OR (${conversations.metadata}->>'silenceBreakerAt')::timestamptz < ${conversations.lastCustomerContactAt}`,
    )).orderBy(desc(conversations.lastCustomerContactAt)).limit(100);

    const result: SilenceSweepResult = { scanned: candidates.length, sent: 0, suppressed: 0, skipped: 0 };
    for (const c of candidates) {
        if (result.sent + result.suppressed >= MAX_SILENCE_PER_PASS) break;
        if (isTestNumber(c.phoneNumber ?? '')) { result.skipped++; continue; }
        const times = await lastMessageTimes(c.id);
        const stampRaw = (c.metadata as any)?.silenceBreakerAt as string | undefined;
        const silent = isSilentBurst({
            lastInboundAt: times.lastInboundAt,
            lastOutboundAt: times.lastOutboundAt,
            silenceBreakerAt: stampRaw ? new Date(stampRaw) : null,
            now,
        });
        if (!silent) { result.skipped++; continue; }

        // THE CLAIM: stamp first, atomically, re-checking the stamp under the row lock. A losing
        // concurrent pass matches zero rows and moves on; a customer who writes again mid-claim
        // pushes lastCustomerContactAt past the stamp and becomes a new burst next pass.
        const claimed: any = await db.execute(sql`
            UPDATE conversations
            SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('silenceBreakerAt', ${now.toISOString()}::text)
            WHERE id = ${c.id}
              AND ((metadata->>'silenceBreakerAt') IS NULL OR (metadata->>'silenceBreakerAt')::timestamptz < ${times.lastInboundAt!.toISOString()}::timestamptz)
            RETURNING id`);
        if (!((claimed.rows ?? claimed) as unknown[]).length) { result.skipped++; continue; }

        const runId = newRunId('rules');
        const sent = await sendHoldingLine(c.id, 'silence', runId);
        if (sent.sent) result.sent++; else result.suppressed++;
        void logSystemEvent({
            kind: 'sweep', phone: c.phoneNumber, conversationId: c.id, source: 'silence-breaker',
            summary: `silence-breaker: ${sent.reason}${sent.suppressedBy ? ` (${sent.suppressedBy})` : ''} — inbound ${formatUk(times.lastInboundAt!)} with no outbound since`,
            detail: { runId, event: 'silence_break', outcome: sent.reason, suppressedBy: sent.suppressedBy ?? null, draftId: sent.draftId ?? null },
        });
    }
    return result;
}

// ---------------------------------------------------------------- 2. flag expiry

export interface FlagExpiryResult { scanned: number; expired: number; sent: number; skipped: number }

export async function expireFlags(now: Date = new Date()): Promise<FlagExpiryResult> {
    const rows = await db.select().from(agentQuestions).where(and(
        isNotNull(agentQuestions.dueAt), lte(agentQuestions.dueAt, now), isNull(agentQuestions.expiredAt),
        inArray(agentQuestions.status, ['open', 'flagged']),
    )).orderBy(agentQuestions.dueAt).limit(20);

    const result: FlagExpiryResult = { scanned: rows.length, expired: 0, sent: 0, skipped: 0 };
    for (const q of rows) {
        if (result.expired >= MAX_EXPIRY_PER_PASS) break;
        const humanRepliedSince = await humanOutboundSince(q.conversationId, q.phone, new Date(q.createdAt));
        if (!isExpiredFlag({ status: q.status, dueAt: q.dueAt ? new Date(q.dueAt) : null, expiredAt: q.expiredAt ? new Date(q.expiredAt) : null, answeredAt: q.answeredAt ? new Date(q.answeredAt) : null, humanRepliedSince, now })) {
            if (humanRepliedSince && !q.expiredAt) {
                // Ben acted in the thread: close the clock quietly so this row is never rescanned.
                await db.update(agentQuestions).set({ expiredAt: now }).where(and(eq(agentQuestions.id, q.id), isNull(agentQuestions.expiredAt)));
            }
            result.skipped++; continue;
        }
        // THE CLAIM.
        const [claimed] = await db.update(agentQuestions).set({ expiredAt: now })
            .where(and(eq(agentQuestions.id, q.id), isNull(agentQuestions.expiredAt))).returning({ id: agentQuestions.id });
        if (!claimed) { result.skipped++; continue; }
        result.expired++;

        const runId = newRunId('rules');
        const sent = await sendHoldingLine(q.conversationId, 'flag_expiry', runId);
        if (sent.sent) result.sent++;

        // Re-ping Ben ONCE — the claim above is what makes it once.
        try {
            const { notifyEscalation } = await import('../pushover');
            const [conv] = await db.select({ contactName: conversations.contactName }).from(conversations).where(eq(conversations.id, q.conversationId)).limit(1);
            await notifyEscalation({
                customerName: conv?.contactName ?? null,
                phoneNumber: q.phone,
                conversationId: q.conversationId,
                note: `⏰ Flag past due (${formatUk(new Date(q.dueAt!))}) and still unanswered. The customer ${sent.sent ? 'has had a holding line' : `got no holding line (${sent.reason})`}. Original: ${q.question.slice(0, 200)}`,
            });
        } catch (error: any) {
            console.warn('[SilenceBreaker] flag-expiry re-ping failed (expiry stands):', error?.message);
        }
        void logSystemEvent({
            kind: 'escalation', phone: q.phone, conversationId: q.conversationId, source: 'silence-breaker',
            summary: `flag_expired: due ${formatUk(new Date(q.dueAt!))}, unanswered — holding line ${sent.reason}, Ben re-pinged once`,
            detail: { runId, event: 'flag_expired', questionId: q.id, outcome: sent.reason, draftId: sent.draftId ?? null },
        });
    }
    return result;
}

// ---------------------------------------------------------------- 3. draft expiry

export interface DraftExpiryResult { scanned: number; expired: number; sent: number; skipped: number }

export async function expireDrafts(now: Date = new Date()): Promise<DraftExpiryResult> {
    const rows = await db.select().from(messageDrafts).where(and(
        eq(messageDrafts.status, 'pending'), isNotNull(messageDrafts.dueAt), lte(messageDrafts.dueAt, now),
        ne(messageDrafts.source, 'rules_layer'),
        sql`(${messageDrafts.heldReason} IS NULL OR ${messageDrafts.heldReason} <> ${DUE_EXPIRED})`,
    )).orderBy(messageDrafts.dueAt).limit(20);

    const result: DraftExpiryResult = { scanned: rows.length, expired: 0, sent: 0, skipped: 0 };
    for (const d of rows) {
        if (result.expired >= MAX_EXPIRY_PER_PASS) break;
        if (!isExpiredDraft({ status: d.status, dueAt: d.dueAt ? new Date(d.dueAt) : null, heldReason: d.heldReason ?? null, source: d.source, now })) { result.skipped++; continue; }
        // THE CLAIM: still pending, not yet marked.
        const [claimed] = await db.update(messageDrafts).set({ heldReason: DUE_EXPIRED })
            .where(and(eq(messageDrafts.id, d.id), eq(messageDrafts.status, 'pending'),
                sql`(${messageDrafts.heldReason} IS NULL OR ${messageDrafts.heldReason} <> ${DUE_EXPIRED})`))
            .returning({ id: messageDrafts.id });
        if (!claimed) { result.skipped++; continue; }
        result.expired++;

        let outcome = 'NO_CONVERSATION';
        let draftId: string | null | undefined = null;
        if (d.conversationId) {
            const runId = newRunId('rules');
            const sent = await sendHoldingLine(d.conversationId, 'draft_expiry', runId);
            outcome = sent.reason; draftId = sent.draftId;
            if (sent.sent) result.sent++;
            void logSystemEvent({
                kind: 'hold', phone: d.phone, conversationId: d.conversationId, source: 'silence-breaker',
                summary: `draft_due_expired: ${d.source} draft ${d.id} pending past ${formatUk(new Date(d.dueAt!))} — holding line ${outcome}`,
                detail: { runId, event: 'draft_due_expired', draftId: d.id, holdingDraftId: draftId ?? null, outcome },
            });
        } else {
            void logSystemEvent({
                kind: 'hold', phone: d.phone, conversationId: null, source: 'silence-breaker',
                summary: `draft_due_expired: ${d.source} draft ${d.id} pending past due, no conversation to hold`,
                detail: { event: 'draft_due_expired', draftId: d.id, outcome },
            });
        }
    }
    return result;
}

// ---------------------------------------------------------------- the tick

let lastPassAt = 0;

/** One call per fast tick; self-throttled to a pass a minute. Never throws. */
export async function runSilenceBreakerTick(now: Date = new Date()): Promise<void> {
    if (now.getTime() - lastPassAt < PASS_EVERY_MS) return;
    lastPassAt = now.getTime();
    const [silence, flags, drafts] = await Promise.all([
        sweepSilence(now).catch((e) => { console.error('[SilenceBreaker] silence sweep failed:', e?.message ?? e); return null; }),
        expireFlags(now).catch((e) => { console.error('[SilenceBreaker] flag expiry failed:', e?.message ?? e); return null; }),
        expireDrafts(now).catch((e) => { console.error('[SilenceBreaker] draft expiry failed:', e?.message ?? e); return null; }),
    ]);
    const acted = (silence?.sent ?? 0) + (flags?.expired ?? 0) + (drafts?.expired ?? 0);
    if (acted > 0) {
        console.log(`[SilenceBreaker] silence sent=${silence?.sent} suppressed=${silence?.suppressed} · flags expired=${flags?.expired} sent=${flags?.sent} · drafts expired=${drafts?.expired} sent=${drafts?.sent}`);
    }
}

// ---------------------------------------------------------------- 4. the 09:00 digest

export interface DigestCounts {
    flagsPastDue: number;
    draftsPendingOver2h: number;
    holdingOnlyBurstsYesterday: number;
    yesterday: string;
}

export async function digestCounts(now: Date = new Date()): Promise<DigestCounts> {
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000);
    const [flags] = await db.select({ n: sql<number>`count(*)::int` }).from(agentQuestions).where(and(
        isNotNull(agentQuestions.dueAt), lte(agentQuestions.dueAt, now), isNull(agentQuestions.answeredAt),
        inArray(agentQuestions.status, ['open', 'flagged']),
    ));
    const [drafts] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts).where(and(
        eq(messageDrafts.status, 'pending'), lte(messageDrafts.createdAt, twoHoursAgo), ne(messageDrafts.source, 'rules_layer'),
    ));
    // Yesterday, UK: bursts whose only reply was a rules-layer holding line — the thread got a
    // holding line and nothing human or agent-written after it before midnight.
    const r: any = await db.execute(sql`
        WITH day AS (
            SELECT (date_trunc('day', (${now.toISOString()}::timestamptz AT TIME ZONE 'Europe/London') - interval '1 day')) AS start_local
        ),
        bounds AS (
            SELECT (start_local AT TIME ZONE 'Europe/London') AS start_at,
                   ((start_local + interval '1 day') AT TIME ZONE 'Europe/London') AS end_at,
                   to_char(start_local, 'Dy DD Mon') AS label
            FROM day
        ),
        holds AS (
            SELECT d.conversation_id, d.sent_at
            FROM message_drafts d, bounds b
            WHERE d.source = 'rules_layer' AND d.status = 'sent'
              AND d.sent_at >= b.start_at AND d.sent_at < b.end_at
              AND d.reason LIKE '[silence]%'
        )
        SELECT (SELECT label FROM bounds) AS label,
               count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM messages m, bounds b
                   WHERE m.conversation_id = h.conversation_id AND m.direction = 'outbound'
                     AND m.quarantined_at IS NULL AND m.created_at > h.sent_at AND m.created_at < b.end_at
               ))::int AS holding_only
        FROM holds h`);
    const row = ((r.rows ?? r) as { label: string | null; holding_only: number | null }[])[0];
    return {
        flagsPastDue: flags?.n ?? 0,
        draftsPendingOver2h: drafts?.n ?? 0,
        holdingOnlyBurstsYesterday: row?.holding_only ?? 0,
        yesterday: row?.label ?? 'yesterday',
    };
}

export function formatDigest(c: DigestCounts): { title: string; lines: string[] } {
    const total = c.flagsPastDue + c.draftsPendingOver2h + c.holdingOnlyBurstsYesterday;
    return {
        title: total === 0 ? '☀️ Comms digest: all clear' : `☀️ Comms digest: ${total} to look at`,
        lines: [
            `${c.flagsPastDue} flag${c.flagsPastDue === 1 ? '' : 's'} past due and unanswered`,
            `${c.draftsPendingOver2h} draft${c.draftsPendingOver2h === 1 ? '' : 's'} pending over 2 hours`,
            `${c.holdingOnlyBurstsYesterday} thread${c.holdingOnlyBurstsYesterday === 1 ? '' : 's'} got only a holding line ${c.yesterday}`,
        ],
    };
}

/** The 09:00 Europe/London cron (server/cron.ts, gated to the worker). */
export async function sendMorningDigest(now: Date = new Date()): Promise<DigestCounts> {
    const counts = await digestCounts(now);
    const { title, lines } = formatDigest(counts);
    try {
        const { notifyCommsDigest } = await import('../pushover');
        await notifyCommsDigest({ title, lines });
    } catch (error: any) {
        console.error('[SilenceBreaker] digest push failed:', error?.message ?? error);
    }
    void logSystemEvent({ kind: 'sweep', source: 'silence-breaker', summary: `${title}: ${lines.join(' · ')}`, detail: { ...counts } });
    return counts;
}
