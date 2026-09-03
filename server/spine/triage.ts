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
import { RELAY_TAG } from '../contractor-relay';
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

/**
 * P9: a customer adding to or changing the scope of a quote we already sent ("all 9 doors now",
 * "another two lights", "instead of the shelf can you…"). A scope change is SCOPING, never an
 * exception: the Scoper acknowledges and the clerk redoes the quote; money stays with Ben via the
 * quote, not via a flag. Both halves must match — a scope word AND a job noun — so "all good
 * thanks" and "another day" (a date, RE_DATE's) do not fire.
 */
export const RE_RESCOPE_WORD = /\b(all (of )?(the |them|\d+)|all \w+ (of them|doors|windows|rooms|lights|walls|radiators)|more|extra|another|additional|as well|also|plus|instead( of)?|rather than|swap|change (it|that|the \w+) (to|for)|add(ing)?|the (rest|others|whole)|every|both|the lot|do them all|(\d+|two|three|four|five|six|seven|eight|nine|ten) (of them|more))\b/i;
export const RE_JOB_NOUN = /\b(doors?|windows?|sills?|frames?|walls?|rooms?|ceilings?|floors?|lights?|sockets?|taps?|radiators?|shelves|shelf|cupboards?|units?|handles?|locks?|gates?|fences?|panels?|tiles?|skirting|coving|blinds?|curtains?|rails?|mirrors?|tvs?|beds?|wardrobes?|kitchen|bathroom|bedrooms?|hallway|landing|stairs|garden|shed|decking|patio|gutters?|drains?|toilets?|showers?|baths?|sinks?|basins?|painting|decorating|plaster(ing)?|tiling|job|jobs|work)\b/i;

/** Pure: does the customer's message read as a scope change on an existing quote? */
export function looksLikeRescope(text: string | null | undefined): boolean {
    const t = (text ?? '').trim();
    return !!t && RE_RESCOPE_WORD.test(t) && RE_JOB_NOUN.test(t);
}

/**
 * P7: the customer has said more is coming ("back soon with the measurement", "will send the
 * photos", "hang on"). Customer side only. When it fires and nothing has arrived since, the spine
 * waits (decide → none / waiting_for_promised) instead of drafting a reply that asks for the thing
 * they are about to send — the 2 Sep incident (Janet, 46a13bdb…).
 */
export const RE_PROMISED_MORE = /\b(back (to you )?soon|be back|will (send|get|grab|take|find|forward)|i'?ll (send|get you|get|grab|take|find|forward|pop)|sending (it|them|now|over)|send (it|them|you)( over)? (now|shortly|in a (sec|min|minute|bit))|one (sec|second|minute|min)|give me (a|two|five|ten) (sec|second|minute|min|mins|minutes)|hang on|bear with|let me (get|grab|take|find|check)|in a (minute|min|sec|second|bit|mo|moment)|shortly|just (a )?(sec|second|minute|min|mo|moment)|two (secs|mins)|(a )?few (mins|minutes|secs))\b/i;

/** Pure: does the customer's last message promise something more is on its way? */
export function customerPromisedMore(text: string | null | undefined): boolean {
    const t = (text ?? '').trim();
    return !!t && RE_PROMISED_MORE.test(t);
}

/** Pure: clamp what the model returned so a long reason or too many tags fails soft, not to rules. */
export function clampTriageModelOutput(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (Array.isArray(o.reasons)) o.reasons = o.reasons.filter((r) => typeof r === 'string').map((r) => String(r).trim().slice(0, 200)).filter(Boolean).slice(0, 6);
    if (Array.isArray(o.tags)) o.tags = o.tags.filter((t) => typeof t === 'string').map((t) => String(t).trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 8);
    return o;
}

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
    // P7: only a customer's own words can promise more; a call transcript or an internal thread cannot.
    const promised = last?.kind === 'message_in' && audience === 'customer' && customerPromisedMore(last?.body);
    if (promised) reasons.push('customer promised more is coming');
    const base = { audience, stage, tags, reasons, source: 'rules' as const, customerPromisedMore: promised };

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

    // P15 part 2: a contractor is mid-conversation with this customer from his job screen ("which
    // door?"). Her reply belongs to HIM, not to an agent: it is relayed to his phone and shown in
    // his drawer, and nothing here answers it. Sits AFTER the exception checks on purpose — a reply
    // that also asks about money or a date still goes to Ben, and he still gets the relay notice.
    if (cf.tags.includes(RELAY_TAG) && last?.kind === 'message_in') {
        reasons.push('a contractor is mid-relay on this job: the reply goes to him, not to an agent');
        return { ...base, intent: 'unknown', lane: 'contractor_relay', exceptions };
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
    // P9: a scope change on an existing (or expired) quote is scoping, never out_of_scope. Tag
    // it and lane the Scoper BEFORE the model runs; the merge then refuses a model-only
    // out_of_scope on a rescope (Sarah, 4 Sep: 3 doors quoted, "all 9" + six photos → Ben flag).
    if (cf.quote && last?.kind === 'message_in' && looksLikeRescope(text)) {
        tags.push('rescope');
        reasons.push(`scope change on quote ${cf.quote.slug}: the Scoper acknowledges and the clerk redoes it`);
        return { ...base, intent: 'unknown', lane: 'scoper', exceptions };
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
- exceptions: array from ${JSON.stringify(EXCEPTIONS)}. Include one whenever the customer raises money, prices or discounts (money_question), dates or availability (date_question), a complaint or unhappiness (complaint), a refund (refund), asks for a call (callback_requested), work needing certification such as gas, structural or major electrical (regulated_trade), or work we do not do (out_of_scope). When in doubt about THOSE, add the exception: Ben would rather see one thread too many than one too few.
- out_of_scope means, precisely: a trade we do not cover (roofing at height, asbestos, large groundworks, full rewires), a job outside our service area, or regulated work (which is regulated_trade). It NEVER means "more work than the quote covered". A customer adding to, extending or changing the scope of an existing or expired quote ("all 9 doors now, not 3", "another two lights", "instead of the shelf, the wardrobe", new photos of more of the same job) is ordinary SCOPING: lane "scoper", tags "rescope" and "needs_quote", no exception. The quote is redone and Ben prices it; money stays with Ben through the quote, not through a flag.
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
    /** P6: the spine run this triage belongs to; stamped on the triage row as parent_run_id. */
    parentRunId?: string | null;
    /** P15 part 2: push a customer reply to the contractor who is mid-relay. Default true; tests pass false. */
    notifyRelay?: boolean;
    relayDeps?: import('../contractor-relay').NotifyReplyDeps;
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
    // P7: "back soon with measurement" is a promise, not a date question. The rules lexicon
    // (RE_DATE) does not fire on it; the model did, and routed the thread to Ben. When the
    // customer has promised more and the rules found no date, a model-only date_question is
    // dropped: the run waits for the promised item instead (decide → waiting_for_promised).
    let modelExceptions = rules.customerPromisedMore && !rules.exceptions.includes('date_question')
        ? model.exceptions.filter((e) => e !== 'date_question')
        : model.exceptions;
    // P9: on a rescope (rules tagged it: a quote exists and the customer added or changed scope),
    // a model-only out_of_scope is the misreading Sarah's thread got. Drop it; a real exception
    // the rules found (regulated trade, money, a complaint) still wins.
    if (rules.tags.includes('rescope') && !rules.exceptions.includes('out_of_scope')) {
        modelExceptions = modelExceptions.filter((e) => e !== 'out_of_scope');
    }
    const exceptions = Array.from(new Set([...rules.exceptions, ...modelExceptions]));
    const intent: Intent | 'unknown' = isIntent(model.intent) ? model.intent : 'unknown';
    let lane: Lane = model.lane;
    if (exceptions.length) lane = 'ben';
    // The dropped exception was the only reason for the model's Ben lane: take the rules' lane instead.
    else if (lane === 'ben' && modelExceptions.length !== model.exceptions.length) lane = rules.lane === 'ben' ? 'scoper' : rules.lane;
    if (rules.lane === 'dropped') lane = 'dropped';
    const stage = model.stage === 'won' ? rules.stage : model.stage;
    return {
        audience: model.audience ?? rules.audience,
        intent, lane, exceptions, stage,
        tags: Array.from(new Set([...rules.tags, ...model.tags.map((t) => t.toLowerCase().slice(0, 30))])),
        reasons: [...model.reasons, ...rules.reasons],
        source: 'model', model: modelId,
        customerPromisedMore: rules.customerPromisedMore,
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
            // P7: a reason over 200 chars failed the schema twice on one live thread and threw the
            // whole answer away (fell to rules). Clamp the soft fields first; the enums still gate.
            const parsed = TriageModelSchema.safeParse(clampTriageModelOutput(out.data));
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
            // P10: a quote tag that just landed (needs_quote from the model, rescope from the P9
            // pre-check) must schedule the clerk's pass, not sit as a label. ensureQuoteRun is
            // idempotent: nothing when a pass is pending or Route A already produced something.
            const landed = result.tags.filter((t) => (t === 'needs_quote' || t === 'rescope') && !current.includes(t));
            if (landed.length) {
                const { ensureQuoteRun } = await import('./request-run');
                await ensureQuoteRun(cf.conversationId, `triage tagged ${landed.join(', ')}`);
            }
        } catch (e: any) {
            console.warn('[Spine] triage could not write tags/stage:', e?.message ?? e);
        }
    }

    // P15 part 2: her reply reaches the contractor who asked. Fired off the RELAY TAG rather than
    // the final lane, so an answer that also mentions money (which routes to Ben above) still gets
    // to the man at the door. Never answers her, never blocks the pass, never throws.
    if (deps.notifyRelay !== false && cf.tags.includes(RELAY_TAG)) {
        const lastIn = lastInbound(cf);
        if (lastIn?.kind === 'message_in' && (lastIn.body ?? '').trim()) {
            try {
                const { notifyContractorOfReply, liveNotifyReplyDeps } = await import('../contractor-relay');
                await notifyContractorOfReply(cf.conversationId, lastIn.body!, deps.relayDeps ?? await liveNotifyReplyDeps());
            } catch (e: any) {
                console.warn('[Spine] contractor relay notice failed:', e?.message ?? e);
            }
        }
    }

    if (deps.persist !== false) {
        try {
            const { startAgentRun, finishAgentRun } = await import('../agent-runs');
            const id = await startAgentRun({ agent: 'triage', trigger: 'triage', conversationId: cf.conversationId, phone: cf.phone, model, caseFileRef: cf.hash, parentRunId: deps.parentRunId ?? null });
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
