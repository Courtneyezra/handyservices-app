/**
 * Triage (design §3.3) — rung 4, not an agent. Deterministic first, then ONE schema-validated
 * Haiku call, then the write of tags/stage (the autonomous tier) and an agent_runs row.
 *
 *   rules   opt-out → dropped; spam → dropped; money / date / complaint / refund / callback /
 *           regulated lexicons → Ben lane with the exception named; trust_concern tag → Ben;
 *           no outbound ever → rules lane (first contact); quote out and unpaid → post_quote;
 *           needs_quote tag → quote clerk; contractor audience → contractor; else scoper.
 *   model   only when the rules found no exception: {audience, intent, lane, exceptions, stage,
 *           tags} from the fixed vocabularies, zod-validated. Parse failure → the rules result,
 *           source 'rules', with the reason recorded. Any exception the model adds → Ben.
 *
 * Non-UK numbers are NOT dropped (decided 2 Sep: the replay found real customers among them).
 * The lexicons are the replay script's (scripts/_comms-desk-replay.ts), so what the audit
 * measured is what runs.
 */
import { z } from 'zod';
import { db } from '../db';
import { conversations } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { detectOptOut } from '../opt-out';
import { looksLikeSpam } from '../first-contact-ack';
import { AUDIENCES, EXCEPTIONS, INTENTS, LANES, STAGES, isIntent } from './vocab';
import type { CaseFile, TriageResult, TimelineItem, ExceptionKind, Lane, Intent } from './types';
import type { TokenUsage } from '../agent-cost';

// ---------------------------------------------------------------- lexicons (from the replay)

// Phase 3 / C: widened from the eval families (scripts/eval-comms.ts --adapter triage): "too much",
// "hourly rate", "do you charge" and "what time" / "another day" / "AM or PM" / "between 11 and 12"
// were real customer lines that reached the scoper. Widening only ever sends more to Ben.
export const RE_MONEY = /(how much|price|cost|£|cheap|expensive|budget|discount|deposit|invoice|pay|too? much|hourly|\brate\b|charge|steep|pricey)/i;
export const RE_DATE = /(when can|what day|which day|what time|another day|other day|reschedule|am or pm|pm or am|between \d{1,2}(:\d{2})?\s?(am|pm)? and \d{1,2}|available|availability|book|slot|next week|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
export const RE_COMPLAINT = /(complain|unhappy|disappoint|not happy|terrible|awful|rubbish|shocking|trading standards)/i;
export const RE_REFUND = /(refund|money back|charge ?back)/i;
export const RE_CALLBACK = /(call me|ring me|give me a (call|ring)|phone me)/i;
export const RE_REGULATED = /(gas safe|boiler|gas hob|flue|consumer unit|fuse ?box|rewir(e|ing)|asbestos|load.?bearing|structural|rsj|chimney breast)/i;

export function lastInbound(cf: CaseFile): TimelineItem | null {
    for (let i = cf.timeline.length - 1; i >= 0; i--) {
        const t = cf.timeline[i];
        if (t.kind === 'message_in' || t.kind === 'call_in') return t;
    }
    return null;
}

function hasOutbound(cf: CaseFile): boolean {
    return cf.timeline.some((t) => t.kind === 'message_out' || t.kind === 'call_out');
}

// ---------------------------------------------------------------- rules (pure)

/** Deterministic triage over the case file alone. Pure: no db, no model. */
export function triageRules(cf: CaseFile): TriageResult {
    const last = lastInbound(cf);
    const text = (last?.body ?? last?.transcript ?? '').trim();
    const reasons: string[] = [];
    const exceptions: ExceptionKind[] = [];
    const tags: string[] = [];
    const audience = cf.audience;
    const stage = cf.stage;
    const base = { audience, stage, tags, reasons, source: 'rules' as const };

    if (audience === 'internal') {
        reasons.push('internal thread');
        return { ...base, intent: 'unknown', lane: 'ben', exceptions };
    }

    // Opt-out and spam drop the run outright.
    if (text && detectOptOut(text)) {
        reasons.push('customer asked us to stop');
        return { ...base, intent: 'unknown', lane: 'dropped', exceptions: ['opted_out'] };
    }
    const spam = looksLikeSpam(text);
    if (!spam.ok) {
        reasons.push(`spam pattern: ${spam.detail}`);
        return { ...base, intent: 'unknown', lane: 'dropped', exceptions: ['spam'] };
    }

    // Exceptions: Ben before any agent.
    if (cf.tags.includes('trust_concern')) { exceptions.push('trust_concern'); reasons.push('thread tagged trust_concern'); }
    if (text) {
        if (RE_REFUND.test(text)) { exceptions.push('refund'); reasons.push('refund lexicon'); }
        else if (RE_COMPLAINT.test(text)) { exceptions.push('complaint'); reasons.push('complaint lexicon'); }
        if (RE_CALLBACK.test(text)) { exceptions.push('callback_requested'); reasons.push('callback lexicon'); tags.push('callback_requested'); }
        if (RE_MONEY.test(text)) { exceptions.push('money_question'); reasons.push('money lexicon'); }
        if (RE_DATE.test(text)) { exceptions.push('date_question'); reasons.push('date lexicon'); }
        if (RE_REGULATED.test(text)) { exceptions.push('regulated_trade'); reasons.push('regulated-trade lexicon'); }
    }
    if (exceptions.length) {
        return { ...base, intent: 'unknown', lane: 'ben', exceptions };
    }

    if (audience === 'contractor' || audience === 'supplier') {
        reasons.push(`${audience} audience`);
        return { ...base, intent: 'unknown', lane: 'contractor', exceptions };
    }

    // First contact: we have never said anything to this person → the rules layer answers.
    if (!hasOutbound(cf)) {
        const withMedia = !!(last?.mediaIds?.length);
        reasons.push('no outbound on the thread: first contact');
        return { ...base, intent: withMedia ? 'ack_photos' : 'ack_enquiry', lane: 'rules', exceptions };
    }

    if (cf.tags.includes('needs_quote')) {
        reasons.push('tagged needs_quote');
        return { ...base, intent: 'unknown', lane: 'quote_clerk', exceptions };
    }
    if ((stage === 'quote_sent' || cf.quote) && cf.quote && !cf.quote.paid) {
        reasons.push(`quote ${cf.quote.slug} out and unpaid`);
        return { ...base, intent: 'unknown', lane: 'post_quote', exceptions };
    }
    reasons.push('no rule fired: scoper');
    return { ...base, intent: 'unknown', lane: 'scoper', exceptions };
}

// ---------------------------------------------------------------- the model call

export const TriageModelSchema = z.object({
    audience: z.enum(AUDIENCES),
    intent: z.enum([...INTENTS, 'unknown'] as [string, ...string[]]),
    lane: z.enum(LANES),
    exceptions: z.array(z.enum(EXCEPTIONS)).default([]),
    stage: z.enum(STAGES),
    tags: z.array(z.string().min(1).max(30)).max(8).default([]),
    reasons: z.array(z.string().max(200)).max(6).default([]),
});
export type TriageModelOutput = z.infer<typeof TriageModelSchema>;

export const TRIAGE_SYSTEM = `You are the triage step for Handy Services' customer messaging (a Nottingham handyman company).
You read a case file and classify the thread. You never write to the customer. Output ONE JSON object with exactly these keys:
- audience: one of ${JSON.stringify(AUDIENCES)}
- intent: what the customer needs next, one of ${JSON.stringify(INTENTS)} or "unknown"
- lane: one of ${JSON.stringify(LANES)} — "ben" whenever any exception applies; "rules" only for a first contact or a content-free acknowledgement; "post_quote" when a quote is out and unpaid; "quote_clerk" when the job is ready to price; else "scoper"
- exceptions: array from ${JSON.stringify(EXCEPTIONS)}. Include one whenever the customer raises money, prices or discounts (money_question), dates or availability (date_question), a complaint or unhappiness (complaint), a refund (refund), asks for a call (callback_requested), work needing certification such as gas, structural or major electrical (regulated_trade), or something we cannot do (out_of_scope). When in doubt, add the exception: Ben would rather see one thread too many than one too few.
- stage: one of ${JSON.stringify(STAGES)}. Never "won" (that means the deposit is paid and only a payment can set it).
- tags: up to 8 short lowercase labels (e.g. "photos_received", "needs_quote", "callback_requested")
- reasons: up to 6 short sentences citing what in the thread decided this.
No prose. No markdown.`;

export interface TriageLlmArgs { system: string; user: string; model: string; maxTokens?: number }
export interface TriageLlmResult { data: unknown; usage: TokenUsage | null; model: string }
export type TriageLlm = (args: TriageLlmArgs) => Promise<TriageLlmResult>;

export interface TriageDeps {
    llm?: TriageLlm;
    model?: string;
    /** Write tags/stage on the conversation. Default true; tests pass false. */
    writeConversation?: boolean;
    /** Write the agent_runs row + ledger events. Default true; tests pass false. */
    persist?: boolean;
    now?: () => Date;
}

/** A compact, model-facing view of the case file (no base64, no full transcripts). */
export function caseFileForModel(cf: CaseFile): Record<string, unknown> {
    const recent = cf.timeline.slice(-14).map((t) => ({
        at: t.at, kind: t.kind, channel: t.channel,
        text: (t.body ?? (t.transcript ? `[call transcript] ${t.transcript.slice(0, 600)}` : '')).slice(0, 600),
        media: t.mediaIds?.length ? t.mediaIds.length : undefined,
    }));
    return {
        conversationId: cf.conversationId, audience: cf.audience, stage: cf.stage, contactName: cf.contactName ?? null,
        tags: cf.tags, window: cf.window, quote: cf.quote, openPromises: cf.openPromises, openFlags: cf.openFlags,
        client: cf.client ? { name: cf.client.name ?? null } : null, mediaCount: cf.media.length, timeline: recent,
    };
}

async function defaultLlm(args: TriageLlmArgs): Promise<TriageLlmResult> {
    const { claudeJsonWithUsage } = await import('../llm');
    return claudeJsonWithUsage({ system: args.system, user: args.user, model: args.model, maxTokens: args.maxTokens ?? 600 });
}

/** Merge the model's answer over the rules' — the model may only ADD exceptions, never remove one. */
export function mergeTriage(rules: TriageResult, model: TriageModelOutput, modelId: string): TriageResult {
    const exceptions = Array.from(new Set([...rules.exceptions, ...model.exceptions]));
    const intent: Intent | 'unknown' = isIntent(model.intent) ? model.intent : 'unknown';
    let lane: Lane = model.lane;
    if (exceptions.length) lane = 'ben';
    if (rules.lane === 'dropped') lane = 'dropped';
    const stage = model.stage === 'won' ? rules.stage : model.stage;
    return {
        audience: model.audience ?? rules.audience,
        intent, lane, exceptions, stage,
        tags: Array.from(new Set([...rules.tags, ...model.tags.map((t) => t.toLowerCase().slice(0, 30))])),
        reasons: [...model.reasons, ...rules.reasons],
        source: 'model', model: modelId,
    };
}

export async function triage(cf: CaseFile, deps: TriageDeps = {}): Promise<TriageResult> {
    const startedAt = (deps.now ?? (() => new Date()))();
    const rules = triageRules(cf);
    let result: TriageResult = rules;
    let usage: TokenUsage | null = null;
    let error: string | null = null;
    const model = deps.model ?? (await (async () => { try { return (await import('./config')).DEFAULT_SPINE_CONFIG.triageModel; } catch { return 'claude-haiku-4-5'; } })());

    // Rules found an exception or a drop: Ben (or nobody) gets it before any model spends a token.
    if (rules.lane !== 'dropped' && rules.exceptions.length === 0 && rules.audience !== 'internal') {
        try {
            const llm = deps.llm ?? defaultLlm;
            const out = await llm({ system: TRIAGE_SYSTEM, user: JSON.stringify(caseFileForModel(cf)), model });
            usage = out.usage;
            const parsed = TriageModelSchema.safeParse(out.data);
            if (parsed.success) {
                result = mergeTriage(rules, parsed.data, out.model || model);
            } else {
                error = `triage model output failed schema: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ').slice(0, 300)}`;
                result = { ...rules, reasons: [...rules.reasons, error] };
            }
        } catch (e: any) {
            error = `triage model call failed: ${e?.message ?? e}`;
            result = { ...rules, reasons: [...rules.reasons, error] };
        }
    }

    // The autonomous tier: tags and stage. Never 'won', never removes a tag.
    if (deps.writeConversation !== false) {
        try {
            const [row] = await db.select({ tags: conversations.tags, stage: conversations.stage }).from(conversations).where(eq(conversations.id, cf.conversationId));
            const current = (row?.tags as string[] | null) ?? [];
            const merged = Array.from(new Set([...current, ...result.tags]));
            const patch: Record<string, unknown> = { updatedAt: new Date() };
            if (merged.length !== current.length) patch.tags = merged;
            if (result.stage !== 'won' && result.stage !== stageOfRow(row?.stage) && stageOfRow(row?.stage) !== 'won') patch.stage = result.stage;
            if (Object.keys(patch).length > 1) await db.update(conversations).set(patch).where(eq(conversations.id, cf.conversationId));
        } catch (e: any) {
            console.warn('[Spine] triage could not write tags/stage:', e?.message ?? e);
        }
    }

    if (deps.persist !== false) {
        try {
            const { startAgentRun, finishAgentRun } = await import('../agent-runs');
            const id = await startAgentRun({ agent: 'triage', trigger: 'triage', conversationId: cf.conversationId, phone: cf.phone, model, caseFileRef: cf.hash });
            await finishAgentRun(id, { agent: 'triage', conversationId: cf.conversationId, phone: cf.phone }, {
                usage, model: result.source === 'model' ? result.model ?? model : null, error,
                durationMs: Date.now() - startedAt.getTime(), decision: result.lane, lane: result.lane, proposal: result,
            });
        } catch (e: any) {
            console.warn('[Spine] triage run not recorded:', e?.message ?? e);
        }
    }
    return result;
}

function stageOfRow(stage: string | null | undefined): string {
    // Local, minimal copy of case-file.stageOf to avoid a circular import at module load.
    switch ((stage ?? '').toLowerCase()) {
        case 'won': return 'won';
        case 'closed': case 'archived': case 'lost': return 'closed';
        case 'booked': case 'scheduled': return 'booked';
        case 'quote_sent': case 'quoted': return 'quote_sent';
        case 'scoping': case 'active': case 'waiting': return 'scoping';
        default: return 'enquiry';
    }
}
