/**
 * Triage (design §3.3) — rung 4, not an agent. Deterministic first, then ONE schema-validated
 * Haiku call, then the write of tags/stage (the autonomous tier) and an agent_runs row.
 *
 *   rules   opt-out → dropped; spam → dropped; money / complaint / refund / callback /
 *           gas (regulated_trade, the ONLY out-of-scope work; T18) lexicons → Ben lane with the
 *           exception named; trust_concern tag → Ben;
 *           a date question is a SIGNAL (dateAsked), not Ben's (PRD §7) — except on a booked
 *           job, the §13 interim, where it is still the date_question exception;
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
import { looksLikeDateQuestion } from './date-lexicon';
import { answeredByOurCall } from './answered-by-call';
import type { CaseFile, TriageResult, TimelineItem, ExceptionKind, Lane, Intent } from './types';
import type { TokenUsage } from '../agent-cost';

// ---------------------------------------------------------------- lexicons (from the replay)

// Phase 3 / C: widened from the eval families (scripts/eval-comms.ts --adapter triage): "too much",
// "hourly rate", "do you charge" and "what time" / "another day" / "AM or PM" / "between 11 and 12"
// were real customer lines that reached the scoper. Widening only ever sends more to Ben.
export const RE_MONEY = /(how much|price|cost|£|cheap|expensive|budget|discount|deposit|invoice|pay|too? much|hourly|\brate\b|charge|steep|pricey)/i;
/**
 * The date lexicon lives in its own PURE module (server/spine/date-lexicon.ts) so the rule can be
 * tested without this file's database import. Re-exported so every existing caller is unchanged.
 */
export { RE_DATE, RE_DATE_ASKING, RE_DAY_WORD, RE_ASKING_SHAPE, looksLikeDateQuestion } from './date-lexicon';

export const RE_COMPLAINT = /(complain|unhappy|disappoint|not happy|terrible|awful|rubbish|shocking|trading standards)/i;
export const RE_REFUND = /(refund|money back|charge ?back)/i;
export const RE_CALLBACK = /(call me|ring me|give me a (call|ring)|phone me)/i;
/**
 * T18 (7 Sep 2026, the captain's decision): the only work Handy Services does not do is GAS work,
 * so this is the gas lexicon plus asbestos. It is the ONE path by which a gas job reaches Ben: the
 * rules run before the model and stop it running when they find an exception, and the merge never
 * removes a rules exception. Consumer units, fuse boxes, rewires, load-bearing walls, RSJs and
 * chimney breasts came OUT here: roofing, structural and electrical work is ours now, as is every
 * kind of plumbing (a leaking water heater is the run that prompted this). Asbestos stays: it was
 * never one of the decline categories he was asked about, and a licensed removal is still his call.
 * Mirrored by server/evals/triage-lexicon.ts (REGULATED) and the capability_claim guard's nouns.
 */
export const RE_REGULATED = /(gas ?safe|boiler|combi|flue|gas (hob|cooker|fire|pipe|pipework|leak|meter|supply|work|engineer|appliance|central heating)|smell (of )?gas|gas smell|asbestos)/i;

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
/**
 * T20 (captain, 7 Sep; Priya 495577b5): "one second let me check" at 18:11 was read as a promise
 * and the pass said nothing, while she was still typing. The line is drawn on the WORDS, in two
 * classes: a PROMISE names a deliverable on its way ("will send the photos", "let me get the
 * tape", "sending now") or a deferred return ("back soon", "be back", "shortly"), and the desk
 * still waits for it (the 2 Sep incident, Janet: "back soon with the measurement"). A PAUSE is a
 * short conversational wait with nothing named ("one sec", "hang on", "bear with", "give me a
 * minute", "let me check", "in a mo"), and it no longer silences the desk: a pause that also
 * names a deliverable ("hang on, I'll take a photo") still matches the promise class.
 */
export const RE_PROMISED_MORE = /\b(back (to you )?soon|be back|will (send|get|grab|take|find|forward)|i'?ll (send|get you|get|grab|take|find|forward|pop)|sending (it|them|now|over)|send (it|them|you)( over)? (now|shortly|in a (sec|min|minute|bit))|let me (get|grab|take|find)|shortly)\b/i;
/** The pause class, exported so a test can pin what is deliberately NOT a promise. */
export const RE_PAUSE_ONLY = /\b(one (sec|second|minute|min)|give me (a|two|five|ten) (sec|second|minute|min|mins|minutes)|hang on|bear with|let me check|in a (minute|min|sec|second|bit|mo|moment)|just (a )?(sec|second|minute|min|mo|moment)|two (secs|mins)|(a )?few (mins|minutes|secs))\b/i;

/** Pure: does the customer's last message promise something more is on its way? A bare pause does not. */
export function customerPromisedMore(text: string | null | undefined): boolean {
    const t = (text ?? '').trim();
    return !!t && RE_PROMISED_MORE.test(t);
}

/**
 * B3 / PRD §7 row 3, the §13 interim: a customer who has already BOOKED (deposit paid, or the
 * thread is at stage booked / won) and asks about a date wants to change a booked date. That row
 * is OPEN in the PRD, so today's behaviour is kept: it is still Ben's. Everything before booking
 * is the Scoper's ("dates come with your quote" / the picker).
 */
export function afterBooking(cf: Pick<CaseFile, 'quote' | 'stage'>): boolean {
    return !!cf.quote?.paid || cf.stage === 'booked' || cf.stage === 'won';
}

/** Pure: clamp what the model returned so a long reason or too many tags fails soft, not to rules. */
export function clampTriageModelOutput(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (Array.isArray(o.reasons)) o.reasons = o.reasons.filter((r) => typeof r === 'string').map((r) => String(r).trim().slice(0, 200)).filter(Boolean).slice(0, 6);
    if (Array.isArray(o.tags)) o.tags = o.tags.filter((t) => typeof t === 'string').map((t) => String(t).trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 8);
    return o;
}

/**
 * 0.2 (8 Sep 2026): how far back the GAS lexicon reads.
 *
 * Every other rule here reads the newest inbound alone, which is right for them: "call me" or
 * "how much" is a thing the customer is asking NOW. Gas is not like that. It is a property of the
 * JOB, stated once, and it does not stop being true because the next message is "so can you come
 * Tuesday?". The trace found exactly that hole (s30 finding F5): a thread whose first message says
 * boiler and whose third says Tuesday reached no exception, because only the third was read.
 *
 * Three customer texts, plus every media description on the file — a photo of a flue is the same
 * fact, and with `spine.video` on the describer is the only thing that can see it. Deliberately
 * NOT applied to any other lexicon: widening the money lexicon over three messages would hold a
 * thread for Ben long after the money question was answered.
 */
export const REGULATED_LOOKBACK = 3;

/** The last `n` customer TEXTS on the case file, newest first. A call transcript is not a text. */
export function recentCustomerTexts(cf: CaseFile, n: number = REGULATED_LOOKBACK): string[] {
    const out: string[] = [];
    for (let i = cf.timeline.length - 1; i >= 0 && out.length < n; i--) {
        const t = cf.timeline[i];
        if (t.kind !== 'message_in') continue;
        const body = (t.body ?? '').trim();
        if (body) out.push(body);
    }
    return out;
}

/** Every media description on the file, newest first as the case file holds them. */
export function mediaDescriptions(cf: CaseFile): string[] {
    return (cf.media ?? []).map((m) => (m.description ?? '').trim()).filter(Boolean);
}

/**
 * Does the gas lexicon fire anywhere the desk can see it? Returns WHERE, so the reason line on the
 * run says which message or photo did it rather than just "gas lexicon".
 */
export function regulatedHit(cf: CaseFile): { hit: boolean; where: string | null } {
    const texts = recentCustomerTexts(cf);
    for (let i = 0; i < texts.length; i++) {
        if (RE_REGULATED.test(texts[i])) {
            return { hit: true, where: i === 0 ? 'the newest customer message' : `a customer message ${i} turn${i === 1 ? '' : 's'} back` };
        }
    }
    for (const d of mediaDescriptions(cf)) {
        if (RE_REGULATED.test(d)) return { hit: true, where: 'a photo or video description' };
    }
    return { hit: false, where: null };
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
    // B3 / PRD §7: a date question is a signal the Scoper answers, not a reason for Ben. Read off
    // the same text the old exception used (a message body or a call transcript), so the §13
    // interim below is exactly the old trigger, narrowed to booked jobs.
    // T21: a message Ben has since answered on the phone (an outbound call with a transcript after
    // it, server/spine/answered-by-call.ts) is not re-read by the text lexicons: "yes please call
    // me" must not lane the thread to Ben again after he rang. Opt-out, spam and the tag rules
    // below still run; the model and the Scoper still see the message and the call.
    const answeredByCall = answeredByOurCall(cf);
    if (answeredByCall) reasons.push('the customer\'s last message was answered by our call (Ben spoke to them since): the text lexicons do not re-run on it (T21)');
    const dateAsked = !!text && !answeredByCall && looksLikeDateQuestion(text);
    const base = { audience, stage, tags, reasons, source: 'rules' as const, customerPromisedMore: promised, dateAsked };

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
    if (text && !answeredByCall) {
        if (RE_REFUND.test(text)) { exceptions.push('refund'); reasons.push('refund lexicon'); }
        else if (RE_COMPLAINT.test(text)) { exceptions.push('complaint'); reasons.push('complaint lexicon'); }
        if (RE_CALLBACK.test(text)) { exceptions.push('callback_requested'); reasons.push('callback lexicon'); tags.push('callback_requested'); }
        if (RE_MONEY.test(text)) { exceptions.push('money_question'); reasons.push('money lexicon'); }
        // B3 / PRD §7: dates are not Ben's. Before a quote the Scoper says "dates come with your
        // quote"; with a live quote it points at the picker. The exception survives on ONE path,
        // the §13 interim: a booked job whose date the customer wants to change.
        if (dateAsked) {
            if (afterBooking(cf)) { exceptions.push('date_question'); reasons.push('date lexicon on a booked job (PRD §13 open: still Ben\'s)'); }
            else reasons.push('date lexicon: a signal for the Scoper, not Ben\'s (PRD §7)');
        }
    }
    // 0.2: the gas lexicon reads the last three customer texts and every media description, not
    // just the newest message — and it sits OUTSIDE the `text &&` guard above, because a photo of a
    // flue with no words at all is the same fact. Still behind the T21 rule: a message Ben has
    // since answered on the phone is not re-read.
    if (!answeredByCall) {
        const regulated = regulatedHit(cf);
        if (regulated.hit) { exceptions.push('regulated_trade'); reasons.push(`gas lexicon (regulated_trade) on ${regulated.where}: the one work we do not do`); }
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
    // T20 (8 Sep 2026): only while the customer's message is the thread's ONLY text message. A
    // second one with nothing from us between means the ack did not land (held, refused, off, or
    // the case file was built before it) and the rules layer will not answer it; the thread moves
    // on to the ordinary lanes. A call is not counted: it lands as a call-channel message AND a
    // call row, and its own ack answers it.
    if (!hasOutbound(cf)) {
        const customerTexts = cf.timeline.filter((t) => t.kind === 'message_in' && t.channel !== 'call').length;
        if (customerTexts <= 1) {
            const withMedia = !!(last?.mediaIds?.length);
            reasons.push('no outbound on the thread: first contact');
            return { ...base, intent: withMedia ? 'ack_photos' : 'ack_enquiry', lane: 'rules', exceptions };
        }
        reasons.push(`no outbound on the thread but ${customerTexts} customer messages: the ack did not land, so this is not first contact and the rules layer will not answer it`);
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
- exceptions: array from ${JSON.stringify(EXCEPTIONS)}. Include one whenever the customer raises money, prices or discounts (money_question), a complaint or unhappiness (complaint), a refund (refund), asks for a call (callback_requested), or gas work (regulated_trade, see SCOPE). When in doubt about THOSE, add the exception: Ben would rather see one thread too many than one too few.
- date_question is NOT yours to add. A question about dates, times or availability is ordinary scoping: before a quote the Scoper says dates come with the quote, after a quote it points at the date picker on the quote page. The rules decide the one case that is Ben's (a booked job); anything you add is dropped.
- SCOPE. The only work Handy Services does not do is GAS work: anything a Gas Safe engineer must do (boilers, gas hobs and cookers, gas fires, flues, gas pipework, a smell of gas). That is regulated_trade. Asbestos removal is also regulated_trade. EVERYTHING ELSE a customer asks for is work we do and raises no exception: all plumbing (leaks, taps, toilets, water heaters, cylinders, radiators), roofing, structural work, electrical work, decorating, carpentry, whatever the trade. Do not infer what we do not do from the trade; this sentence is the whole boundary.
- out_of_scope is NOT yours to add: the rules decide it, and anything you add is dropped. It NEVER means "more work than the quote covered". A customer adding to, extending or changing the scope of an existing or expired quote ("all 9 doors now, not 3", "another two lights", "instead of the shelf, the wardrobe", new photos of more of the same job) is ordinary SCOPING: lane "scoper", tags "rescope" and "needs_quote", no exception. The quote is redone and Ben prices it; money stays with Ben through the quote, not through a flag.
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
    // B3 / PRD §7: dates are not Ben's, so the model may never add date_question on its own. The
    // rules raise it on exactly one path (a booked job, the §13 interim) and a rules exception is
    // never removed. This subsumes P7: "back soon with measurement" is a promise, not a date
    // question; the model used to raise date_question on it and route the thread to Ben, and now
    // the run waits for the promised item instead (decide → waiting_for_promised).
    let modelExceptions = rules.exceptions.includes('date_question')
        ? model.exceptions
        : model.exceptions.filter((e) => e !== 'date_question');
    // T18 (7 Sep 2026): out_of_scope is not the model's to add on ANY thread. It was raised only
    // by the model, from the prompt's "work we do not do", and the model guessed the business's
    // scope: Sarah's rescope (P9, 4 Sep) and a leaking water heater (run_5fbca897…, 7 Sep) both
    // went to Ben as out_of_scope. The captain's boundary is gas only, and gas reaches Ben by ONE
    // path: the rules' RE_REGULATED lexicon → regulated_trade, found before the model runs and
    // never removed here. A rules out_of_scope (none today) would still be kept, like every
    // rules exception; a real model exception (money, a complaint, regulated_trade) still wins.
    const droppedOutOfScope = modelExceptions.includes('out_of_scope') && !rules.exceptions.includes('out_of_scope');
    if (droppedOutOfScope) modelExceptions = modelExceptions.filter((e) => e !== 'out_of_scope');
    const exceptions = Array.from(new Set([...rules.exceptions, ...modelExceptions]));
    let intent: Intent | 'unknown' = isIntent(model.intent) ? model.intent : 'unknown';
    let lane: Lane = model.lane;
    // T20 (8 Sep 2026): the rules lane runs no agent (index.ts RULES_PLACEHOLDER) and only the
    // first-contact ack answers it, so a thread the model moves ONTO it gets nothing: the reply to
    // our ack on run_e5372115… was laned `rules` by Haiku with tags needs_quote / multiple_jobs and
    // nobody answered. First contact is a fact of the timeline (no outbound), not a judgement: the
    // model may leave the rules lane, never choose it. Its intent on such an answer is an ack_*,
    // so that goes too.
    const laneNotes: string[] = [];
    if (lane === 'rules' && rules.lane !== 'rules') {
        laneNotes.push(`model chose lane rules on a thread that is not first contact; kept the rules' lane ${rules.lane} (T20)`);
        lane = rules.lane;
        intent = 'unknown';
    }
    if (exceptions.length) lane = 'ben';
    // The dropped exception was the only reason for the model's Ben lane: take the rules' lane instead.
    else if (lane === 'ben' && modelExceptions.length !== model.exceptions.length) lane = rules.lane === 'ben' ? 'scoper' : rules.lane;
    if (rules.lane === 'dropped') lane = 'dropped';
    const stage = model.stage === 'won' ? rules.stage : model.stage;
    return {
        audience: model.audience ?? rules.audience,
        intent, lane, exceptions, stage,
        tags: Array.from(new Set([...rules.tags, ...model.tags.map((t) => t.toLowerCase().slice(0, 30))])),
        reasons: [
            ...model.reasons,
            ...(droppedOutOfScope ? ['model out_of_scope dropped: scope is gas only (regulated_trade, the rules\' lexicon), not the model\'s to infer (T18)'] : []),
            ...laneNotes,
            ...rules.reasons,
        ],
        source: 'model', model: modelId,
        customerPromisedMore: rules.customerPromisedMore,
        dateAsked: rules.dateAsked,
    };
}

export async function triage(cf: CaseFile, deps: TriageDeps = {}): Promise<TriageResult> {
    const startedAt = (deps.now ?? (() => new Date()))();
    const rules = triageRules(cf);
    let result: TriageResult = rules;
    let usage: TokenUsage | null = null;
    let error: string | null = null;
    const model = deps.model ?? (await (async () => { try { return (await import('./config')).DEFAULT_SPINE_CONFIG.triageModel; } catch { return 'claude-haiku-4-5'; } })());

    // 0.2 item G: `spine.agents.triage.enabled = false` stops the MODEL, not triage. The
    // deterministic rules above have already run and they are what raise every exception; the pass
    // then proceeds on those alone, which is exactly what happens today when the model call fails.
    // An unreadable switch is treated as ON, like a model that simply answered.
    let modelAllowed = true;
    if (!deps.llm) {
        try {
            const { isAgentSwitchOn } = await import('./config');
            modelAllowed = await isAgentSwitchOn('triage');
        } catch { modelAllowed = true; }
        if (!modelAllowed) rules.reasons.push('the triage model is switched off (spine.agents.triage.enabled = false): rules only');
    }

    // Rules found an exception or a drop: Ben (or nobody) gets it before any model spends a token.
    if (modelAllowed && rules.lane !== 'dropped' && rules.exceptions.length === 0 && rules.audience !== 'internal') {
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
