/**
 * First-contact auto-responder — the ONE sanctioned exception to draft-and-approve.
 *
 * The owner's rule, verbatim: anything coming in for the FIRST time (a post-call follow-up, a
 * first webform submission, a first SMS or WhatsApp message from a number we have never replied
 * to) may be acknowledged automatically. Everything else keeps the approval gate.
 *
 * Six hard limits make that safe, and every one of them is a server-side check here rather than an
 * instruction to a model:
 *
 *   0. SCREENED FIRST. Before anything is composed or sent, two deterministic screens run and each
 *      refuses with its own machine-readable reason: GEOGRAPHY (UK only, so we never promise to
 *      come back to someone we cannot serve) and SPAM (the SEO, web-design and review-farm blasts
 *      this business receives daily). A template send to a spammer costs money AND drags the
 *      WhatsApp sender's quality rating down, which throttles delivery to real customers on the one
 *      number the business messages from. The comms agent remains the backstop for the rest.
 *   1. FIRST CONTACT, OR A GENUINE RETURN. `readContactHistory()` is a query, not a judgement: if
 *      this number has received an outbound message from us RECENTLY, the gate stays on. There is
 *      no prompt to misread and no flag a caller can pass to skip it. A thread that has been silent
 *      longer than `returningAfterDays` is greeted as a returning customer instead of ignored —
 *      repeat payers are the best-converting segment this business has, and until now a customer
 *      coming back after six months got no instant acknowledgement at all.
 *   2. ACKNOWLEDGEMENTS ONLY. The copy is composed here, from fixed variants — it can never
 *      contain a price, a date, a promise or an answer, because there is no code path that puts
 *      one in. The agent's own drafts stay on the approval queue.
 *   3. 24/7, BUT HONEST. A 9pm enquiry deserves an instant acknowledgement, so the UK 8-20
 *      quiet-hours guard that governs ordinary auto-send does not apply here. Instead the
 *      out-of-hours variant says we will come back first thing, rather than implying someone is
 *      at a desk. (The 8-20 guard is untouched for every non-first-contact auto-send.)
 *   4. SHUT WINDOW FALLS BACK, NEVER DROPS. Outside WhatsApp's 24h window only an approved template
 *      may go out, so we look one up by name at runtime; failing that the acknowledgement goes by
 *      SMS, which has no window and no template requirement; and failing even that it is queued for
 *      Ben instead of vanishing.
 *   5. THE RIGHT PIPE. An SMS-first contact is answered by SMS, and a UK landline is never sent a
 *      WhatsApp message at all. Replying by WhatsApp to someone who texted us is how a reply ends
 *      up at a number that never had WhatsApp — and the failure looked like a delivery problem.
 *
 * The other half is `triageAckReply()` at the bottom: an acknowledgement that asks a question makes
 * a promise, so the answer is read the moment it arrives and the thread is tagged with what the
 * customer said (callback_requested / prefers_text) rather than waiting in the ordinary queue.
 *
 * Ships disabled (`comms_agent.firstContactAutoAck.enabled = false`).
 */
import { db } from './db';
import { conversations, messages, messageDrafts, firstContactAckLog } from '@shared/schema';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { queueDraft, approveAndSendDraft, type DraftSource } from './message-drafts';
import { canSendFreeform } from './meta-whatsapp';
import { findApprovedTemplateWithValues } from './whatsapp-template-sync';
import { isNonMobileUkNumber } from './phone-utils';
import { isLikelyRealName } from '@shared/contact-name';
import { isSmsSenderConfigured, getSmsSenderE164, getWhatsAppSenderE164 } from './whatsapp-sender';
import { notQuarantined } from './message-quarantine';

// ---------------------------------------------------------------- config shape

export const FIRST_CONTACT_CHANNELS = ['whatsapp', 'sms', 'webform', 'post_call'] as const;
export type FirstContactChannel = (typeof FIRST_CONTACT_CHANNELS)[number];

export interface FirstContactAckConfig {
    /** Master switch for the exception itself. Ships false. */
    enabled: boolean;
    /** Which first-touch surfaces may auto-acknowledge. */
    channels: FirstContactChannel[];
    /**
     * How quiet a thread must have been before a returning customer is greeted as one rather than
     * left to the ordinary lane. 60 days: long enough that the last job is finished and the thread
     * is cold, short enough that a customer with a seasonal problem still gets an instant answer.
     */
    returningAfterDays: number;
    /**
     * T1 (29 Aug 2026): when true, the ack also asks the customer to send a quick photo or video
     * of the job, folded into the SAME message (a second rapid-fire message reads botty). Canned
     * copy only — see mediaAskSentence(); there is no code path that lets a model near it. Ships
     * false, same pattern as `enabled`: the owner flips it after inspecting real runs.
     */
    askForMedia: boolean;
}

export const DEFAULT_FIRST_CONTACT_ACK: FirstContactAckConfig = {
    enabled: false,
    channels: [...FIRST_CONTACT_CHANNELS],
    returningAfterDays: 60,
    askForMedia: false,
};

/**
 * The only intents that may ever auto-send. Both are content-free by construction: they say we
 * have the message and will come back, and nothing else. Deliberately a subset of DRAFT_INTENTS
 * so the comms agent's whitelist vocabulary and this one cannot drift apart.
 */
export const FIRST_CONTACT_ACK_INTENTS = ['ack_enquiry', 'ack_photos', 'ack_missed_call', 'ack_returning'] as const;
export type FirstContactAckIntent = (typeof FIRST_CONTACT_ACK_INTENTS)[number];

/**
 * Templates we would accept for a first-contact acknowledgement when the freeform window is shut,
 * best first. Names, not SIDs: approval status is Meta's to change, and a template that is pending
 * today may be approved tomorrow without a deploy. Anything not currently approved is skipped.
 */
export const FIRST_CONTACT_TEMPLATE_PREFERENCE = [
    // Context-aware ack: quotes the customer's own enquiry back ("We got your message: ...")
    // and times the call offer ("shortly" / "in the morning") to the UK hour. Submitted
    // 22 Aug 2026 as UTILITY; while Meta has it pending the lookup skips it and the plain
    // call_request below carries the ack, no deploy needed either way.
    'web_enquiry_ack_context',
    // The ask itself, out of hours or out of window: "is it OK if we give you a quick call?".
    // Submitted 19 Aug 2026 as UTILITY and PENDING with Meta at the time of writing, which is
    // exactly why it is a NAME here. The moment Meta approves it the hourly sync flips its cached
    // status and this list starts using it with no deploy; while it is pending the lookup skips it
    // and falls through. Never hardcode the SID of something that is not approved yet.
    'call_request',
    'first_contact_ack',   // a dedicated ack, if one is ever approved
    'video_request',       // UTILITY: "thanks for getting in touch, send a quick video"
    'postcode_request',    // UTILITY: acknowledges and asks the one thing we need to price
    '1_contact_generic',   // MARKETING fallback, reads as post-call ("as discussed")
];

/**
 * The same list with the call-ask removed, for a customer who has told us to keep it in writing.
 * A template is still a message we chose to send: honouring `prefers_text` has to survive the
 * shut-window path too, or the promise only holds when the window happens to be open.
 */
export const PREFERS_TEXT_TEMPLATE_PREFERENCE = FIRST_CONTACT_TEMPLATE_PREFERENCE
    .filter((name) => name !== 'call_request' && name !== 'web_enquiry_ack_context');

/**
 * Same idea for a call nobody answered, and it needs its own list because the ordinary one is
 * wrong here. A phone call almost never leaves the WhatsApp window open (only an inbound WhatsApp
 * message does), so a missed-call ack is a template send nearly every time.
 *
 * 'missed_call_ack' does not exist yet: it is the honest wording ("sorry we missed you, we'll ring
 * back") and belongs in the next template submission. Until it is approved, 'video_request' is the
 * closest approved UTILITY template that is still TRUE of a missed call (they did get in touch,
 * and a video is what we need next) — and anything not approved is skipped, so if none of these
 * are live the acknowledgement is queued for Ben rather than dropped.
 */
export const MISSED_CALL_TEMPLATE_PREFERENCE = [
    'missed_call_ack',     // APPROVED (HX0ae187172810e78213fcfecf536ca972): "sorry we missed your
                           // call. Tell us what needs doing and we will price it up for you, or we
                           // will try you again shortly." One variable ({{1}} = first name).
    // 'video_request' removed 24 Aug 2026 (owner decision, Switchboard Atlas step 2): a missed
    // call gets the honest missed-call template or falls through to SMS — never a video ask the
    // caller never discussed.
];

/**
 * Which template list applies. Three-way, and each branch exists for a reason a reader will
 * otherwise re-litigate: a missed call is answered by ringing back (asking permission to ring
 * someone who just rang us is a confidence leak), a `prefers_text` customer is never offered a
 * call on any surface, and everyone else gets the call-ask first.
 */
export function templatePreferenceFor(intent: FirstContactAckIntent, prefersText?: boolean): string[] {
    if (intent === 'ack_missed_call') return MISSED_CALL_TEMPLATE_PREFERENCE;
    return prefersText ? PREFERS_TEXT_TEMPLATE_PREFERENCE : FIRST_CONTACT_TEMPLATE_PREFERENCE;
}

async function readConfig(): Promise<FirstContactAckConfig> {
    // Lazy: this module is imported by hot ingest paths, and the comms agent module pulls in the
    // whole agent runner. Fail closed if the config cannot be read.
    try {
        const { getCommsAgentConfig } = await import('./agents/comms');
        return (await getCommsAgentConfig()).firstContactAutoAck;
    } catch (error: any) {
        console.error('[FirstContact] Could not read config, treating as disabled:', error?.message);
        return { ...DEFAULT_FIRST_CONTACT_ACK, enabled: false };
    }
}

// ---------------------------------------------------------------- screening
//
// WHY SCREENING EXISTS AT ALL, AND WHY IT RUNS FIRST.
//
// Every auto-ack is a message this business pays for and, outside the 24h window, a TEMPLATE send.
// Templates cost money per send, and — the expensive part — a template sent to someone who does not
// want it is exactly what Meta measures. Blocks and "not useful" reports on template sends drag the
// sender's QUALITY RATING down, and a throttled sender means slower delivery to REAL customers on
// the one number this business messages from. So auto-acking an SEO spammer is not merely a wasted
// penny: it degrades the channel for the people who are trying to buy something.
//
// These guards are deterministic and run BEFORE the send, each returning its own machine-readable
// reason so a refusal can be audited later ("why did this enquiry never get an ack?"). The comms
// agent is the intelligent backstop for anything that slips through — it reads the same thread and
// simply declines to draft. This layer only has to catch the obvious, cheaply.

/**
 * Auto-ack is a UK operation: the business works Nottingham and Derby. An international number is
 * almost always a spam blast or a wrong number, and an instant "we'll come back to you shortly" to
 * someone we can never serve is a promise we cannot keep.
 */
export const AUTO_ACK_ALLOWED_PREFIXES = ['+44'];

/**
 * Numbers that skip the geography rule.
 *
 * +84357691573 is the owner's own number (Vietnam), which is how this feature gets exercised
 * without messaging a customer. The Ofcom smoke range +447700900xxx is already +44 and needs no
 * bypass, but it is listed for the next reader who wonders where the test numbers are.
 */
export const AUTO_ACK_BYPASS_NUMBERS = ['+84357691573'];
const OFCOM_TEST_RANGE = /^\+447700900\d{3}$/;

/**
 * The marketing blasts this business actually receives, in one place so the list can be extended
 * without going near the send logic. Every entry is drawn from real inbound: SEO and "rank your
 * website" pitches, web design and app development touts, review-farm offers ("remove 1 star google
 * reviews"), crypto and loan spam, and the generic "I can help you get more customers" opener.
 *
 * Bias: these have to be specific enough not to eat a real enquiry. A customer says "my website
 * is broken" — we build kitchens, not websites, but they may still want a handyman, so 'website'
 * alone is never a match; it only matches next to a marketing verb (rank, design, redesign, build,
 * traffic). Guards are refusals to AUTO-ack, not blocks: the message still lands on the board, and
 * a human or the comms agent can still answer it.
 */
export const SPAM_PATTERNS: Array<{ name: string; re: RegExp }> = [
    { name: 'seo', re: /\b(seo|search engine optimi[sz]ation|serp|backlinks?|domain authority)\b/i },
    { name: 'rank_website', re: /\brank(ing)?\b[^.!?]{0,40}\b(website|site|google|page one|first page)\b/i },
    { name: 'rank_website', re: /\b(website|site)\b[^.!?]{0,40}\brank(ing|s)?\b/i },
    { name: 'digital_marketer', re: /\b(digital marketer|digital marketing (agency|expert|specialist)|marketing agency|lead gen(eration)? (agency|expert|service))\b/i },
    { name: 'web_design', re: /\b(web|website|app|mobile app|software)\s*(design|designing|designer|development|developer|developing|redesign)\b/i },
    { name: 'web_design', re: /\b(design|develop|build|redesign)\b[^.!?]{0,25}\b(your|a new)\b[^.!?]{0,15}\b(website|web ?site|webpage|app)\b/i },
    { name: 'reviews', re: /\b(\d+\s*star|negative|bad)\s*(google\s*)?reviews?\b/i },
    { name: 'reviews', re: /\b(remove|delete|boost|buy|increase)\b[^.!?]{0,25}\breviews?\b/i },
    { name: 'crypto', re: /\b(crypto(currency)?|bitcoin|btc|ethereum|usdt|forex|trading signals?|binary options?)\b/i },
    { name: 'loans', re: /\b(business loan|payday loan|unsecured (loan|funding)|cash advance|funding for your business|debt relief)\b/i },
    { name: 'more_customers', re: /\b(get|bring|send)\b[^.!?]{0,20}\bmore (customers|clients|leads|enquir\w+|sales)\b/i },
    { name: 'more_customers', re: /\b(guarantee|guaranteed)\b[^.!?]{0,25}\b(leads|customers|clients|calls)\b/i },
    { name: 'outsourcing', re: /\b(outsourc\w+|offshore team|dedicated developers?|hire (a )?(virtual assistant|va)\b)/i },
    { name: 'generic_pitch', re: /\b(i('| a)?m (a|an) (seo|digital|marketing|web)\b|we (specialise|specialize) in (seo|web|digital|marketing))/i },
];

export type ScreenReason = 'OUT_OF_AREA' | 'LOOKS_LIKE_SPAM';

export interface ScreenResult {
    ok: boolean;
    reason?: ScreenReason;
    /** Which rule fired, for the log line and the audit trail. */
    detail?: string;
}

/** True when the number is one of ours or a reserved test range, so geography does not apply. */
export function isTestOrOwnerNumber(e164: string): boolean {
    return AUTO_ACK_BYPASS_NUMBERS.includes(e164) || OFCOM_TEST_RANGE.test(e164);
}

/** Geography: UK only, with the test bypass. */
export function screenGeography(e164: string): ScreenResult {
    if (isTestOrOwnerNumber(e164)) return { ok: true, detail: 'test/owner bypass' };
    if (AUTO_ACK_ALLOWED_PREFIXES.some((p) => e164.startsWith(p))) return { ok: true };
    return { ok: false, reason: 'OUT_OF_AREA', detail: `${e164.slice(0, 4)} is outside the service area` };
}

/** Spam: keyword and pattern screen over the inbound text. Empty text is not spam. */
export function looksLikeSpam(text?: string | null): ScreenResult {
    const body = (text ?? '').trim();
    if (!body) return { ok: true };
    for (const { name, re } of SPAM_PATTERNS) {
        if (re.test(body)) return { ok: false, reason: 'LOOKS_LIKE_SPAM', detail: name };
    }
    return { ok: true };
}

/** Both deterministic screens, geography first (it is free and does not need the message text). */
export function screenInbound(input: { e164: string; text?: string | null }): ScreenResult {
    const geo = screenGeography(input.e164);
    if (!geo.ok) return geo;
    return looksLikeSpam(input.text);
}

// ---------------------------------------------------------------- the hard guard

/** What we already know about this person, from stored messages and drafts. */
export interface ContactHistory {
    /** True when we have EVER sent them anything (message row or an approved/sent draft). */
    hasOutbound: boolean;
    /** The most recent outbound timestamp, when there is one. */
    lastOutboundAt: Date | null;
    /** Conversation rows for this number — a person can have more than one thread. */
    conversationIds: string[];
    /** True when the history could not be read; callers must fail closed on it. */
    unknown?: boolean;
}

/**
 * Read the outbound history for a number, across every conversation row it owns (a customer can
 * have both an SMS and a WhatsApp thread) plus any draft that reached approved/sent — a failed send
 * still means someone decided to talk to this person.
 *
 * Errors set `unknown`, and every caller treats that as "assume we have talked to them", so the
 * approval gate stays on when we cannot prove otherwise.
 *
 * Quarantined messages do not count as outbound at all — see server/message-quarantine.ts. They
 * were written, but nobody received them, and "we sent you something you never got" is not prior
 * contact.
 *
 * A PREVIOUS AUTO-ACKNOWLEDGEMENT, HOWEVER, COUNTS IN FULL, and that asymmetry is deliberate.
 * server/auto-ack-window.ts stops an ack counting as a REPLY, so the SLA clock keeps running and
 * the customer stays in the Unanswered column until a human answers them. This function asks a
 * different question: have we ever messaged this person? An ack means we have, and if it did not
 * count here the same number would be acknowledged again on their next message. It counts twice
 * over, in fact — the `messages` row AND the approved/sent draft below — so neither path alone
 * can lose it.
 */
export async function readContactHistory(input: { conversationId?: string | null; phone: string }): Promise<ContactHistory> {
    try {
        const digits = input.phone.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) return { hasOutbound: true, lastOutboundAt: null, conversationIds: [], unknown: true };

        const convRows = await db.select({ id: conversations.id }).from(conversations)
            .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`);

        const conversationIds = Array.from(new Set([
            ...convRows.map((c) => c.id),
            ...(input.conversationId ? [input.conversationId] : []),
        ]));

        let lastOutboundAt: Date | null = null;

        if (conversationIds.length) {
            // Quarantined rows are excluded: 58,216 outbound rows written Feb-Aug 2026 never
            // reached anyone (server/message-quarantine.ts). 144 threads carry NOTHING but those,
            // and counting them here is what made a genuinely-never-contacted person look like
            // someone we had already spoken to — the exact judgement this function exists to make.
            const [outbound] = await db.select({ at: messages.createdAt }).from(messages)
                .where(and(
                    inArray(messages.conversationId, conversationIds),
                    eq(messages.direction, 'outbound'),
                    notQuarantined,
                ))
                .orderBy(desc(messages.createdAt))
                .limit(1);
            if (outbound?.at) lastOutboundAt = new Date(outbound.at);
        }

        const [priorDraft] = await db.select({ at: messageDrafts.sentAt, created: messageDrafts.createdAt })
            .from(messageDrafts)
            .where(and(
                sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`,
                inArray(messageDrafts.status, ['approved', 'sent']),
            ))
            .orderBy(desc(messageDrafts.createdAt))
            .limit(1);

        if (priorDraft) {
            const draftAt = new Date(priorDraft.at ?? priorDraft.created);
            if (!lastOutboundAt || draftAt > lastOutboundAt) lastOutboundAt = draftAt;
        }

        return { hasOutbound: !!lastOutboundAt, lastOutboundAt, conversationIds };
    } catch (error: any) {
        console.error('[FirstContact] History query failed, assuming prior contact:', error?.message);
        return { hasOutbound: true, lastOutboundAt: null, conversationIds: [], unknown: true }; // Fail closed.
    }
}

/**
 * True only when we have NEVER sent this person anything.
 *
 * Errors and unparseable numbers return false: "we could not prove this is a first contact" must
 * mean the approval gate stays on.
 */
export async function isFirstContact(input: { conversationId?: string | null; phone: string }): Promise<boolean> {
    const history = await readContactHistory(input);
    return !history.hasOutbound && !history.unknown;
}

/**
 * FIRST      — never messaged. The original sanctioned exception.
 * RETURNING  — messaged before, but the last thing we said is older than the configured threshold.
 *              A customer coming back after months currently gets NOTHING instantly, which is
 *              backwards: repeat payers are the best-converting segment this business has.
 * ONGOING    — a live thread. The ordinary lane owns it; an ack would just add noise.
 */
export type ContactClass = 'first' | 'returning' | 'ongoing';

export function classifyHistory(history: ContactHistory, returningAfterDays: number): ContactClass {
    if (history.unknown) return 'ongoing';                 // fail closed
    if (!history.hasOutbound) return 'first';
    if (!history.lastOutboundAt) return 'ongoing';
    const daysQuiet = (Date.now() - history.lastOutboundAt.getTime()) / 86_400_000;
    return daysQuiet >= returningAfterDays ? 'returning' : 'ongoing';
}

// ---------------------------------------------------------------- the copy

/** UK local hour — "out of hours" means out of hours in Nottingham, not in UTC. */
export function ukHourNow(): number {
    return Number(new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric', hour12: false, timeZone: 'Europe/London',
    }).format(new Date()));
}

/** Same 8-20 boundary the ordinary auto-send guard uses — here it picks wording, not permission. */
export function isOutOfHours(hour = ukHourNow()): boolean {
    return hour < 8 || hour >= 20;
}

/** System-stamped lead names that are labels, not people ("Website Visitor", "Unknown Caller"). */
const SYSTEM_STAMPED_NAME_RE = /^(unknown|customer|caller|test|website|web\b|visitor|lead|enquiry)/i;

function greetingFor(contactName?: string | null): string {
    const name = (contactName ?? '').trim();
    // Placeholder names greet nobody: "Hi Website" went to a real customer on 21 Aug because the
    // hero form has no name field and stamps leads "Website Visitor". Anything system-stamped —
    // or failing the shared pushname gate ("Just Me", emoji, business caps: @shared/contact-name)
    // — reads as no-name and the copy degrades to plain "Hi" / "Hi there" gracefully.
    if (!name || SYSTEM_STAMPED_NAME_RE.test(name) || !isLikelyRealName(name)) return '';
    return ` ${name.split(/\s+/)[0]}`;
}

/** Shared placeholder test for template-variable name slots (whatsapp-template-sync uses it). */
export function isPlaceholderName(name?: string | null): boolean {
    const n = (name ?? '').trim();
    return !n || SYSTEM_STAMPED_NAME_RE.test(n) || !isLikelyRealName(n);
}

/**
 * The acknowledgement itself. Brand voice (brand-voice/whatsapp-comms.md): two short bursts split
 * on "---", no em dashes, no sign-off, ONE question at most. Nothing here states a price, a date,
 * an availability promise or an answer, and there is no branch that could add one.
 *
 * WHY THIS ASKS FOR A CALL RATHER THAN PROMISING A REPLY (owner's decision, 19 Aug 2026).
 *
 * The old copy said "we'll come back to you shortly" and then went quiet until a human got to it.
 * That is a promise the customer has to wait on, and waiting is where a lead cools. Voice warms a
 * lead: a two-minute call scopes the job, tells us whether it is even ours, and converts far better
 * than a chain of texts. So the ack now ASKS ("is it OK if we give you a quick call?") and offers
 * the written route in the same breath, so a customer who hates the phone loses nothing.
 *
 * Two intents deliberately do NOT ask:
 *
 *   ack_missed_call — they already rang US. Asking permission to ring back someone who just tried
 *     to reach us by phone is a confidence leak: it reads as hesitancy where the customer has
 *     already stated the preference. This one keeps telling, not asking. Owner's explicit call.
 *
 *   anything for a prefers_text customer — they have answered this exact question once already and
 *     said no. Asking again is the single fastest way to make an automated system feel like one.
 *     Note this suppression has to hold on EVERY surface, so `templatePreferenceFor()` drops the
 *     call-ask template too, not just the freeform wording.
 *
 * Out of hours the ask survives but the timing moves: "first thing", never anything that implies
 * somebody is sitting at a desk at 11pm.
 */
export function composeFirstContactAck(input: {
    intent: FirstContactAckIntent;
    contactName?: string | null;
    hour?: number;
    /**
     * The customer has previously told us to keep it in writing (thread tagged prefers_text).
     * The only line that changes is the missed-call one, which otherwise promises a ring back —
     * a promise this customer has explicitly declined. Honouring that is the whole point of
     * recording it.
     */
    prefersText?: boolean;
}): { body: string; outOfHours: boolean; intent: FirstContactAckIntent } {
    const hour = input.hour ?? ukHourNow();
    const outOfHours = isOutOfHours(hour);
    const named = greetingFor(input.contactName);   // ' Marc', or '' when we have no usable name
    const hi = `Hi${named}`;

    // A missed call is the one case where the acknowledgement has to admit something: they rang and
    // nobody picked up. Saying "thanks for your message" to a caller reads as a bot that did not
    // notice. The promise is still content-free, it is only a promise to make contact.
    const opener = input.intent === 'ack_photos'
        ? `${hi}, thanks for sending those over.`
        : input.intent === 'ack_missed_call'
            ? `${hi}, sorry we missed your call.`
            // A returning customer should not be greeted like a stranger. "Thanks for getting in
            // touch" to someone we did a kitchen for last year reads as a business that forgot
            // them. Naming the relationship costs one clause and is the only difference.
            : input.intent === 'ack_returning'
                ? `Good to hear from you again${named ? `,${named}` : ''}.`
                : `${hi}, thanks for getting in touch.`;

    // A customer who asked to stay in writing does not get promised a phone call, even when the
    // thing they just did was ring us.
    const missedCallFollow = outOfHours
        ? (input.prefersText
            ? "You've caught us out of hours, so we'll come back to you here first thing."
            : "You've caught us out of hours, so we'll ring you back first thing.")
        : (input.prefersText
            ? "We'll pick this up here on text shortly. Just tell us what needs doing and we'll take it from there."
            // Telling, not asking. See the note above the function.
            : "We'll ring you back shortly. If it is easier, just reply here and tell us what needs doing.");

    // The ask. One question, then the written alternative as a plain statement, so the reply is
    // never "two questions in a row" and a text-only customer is not cornered into a phone call.
    const callAsk = outOfHours
        ? "You've caught us out of hours. Is it OK if we give you a quick call first thing to run through it? Or just reply here with the details."
        : "Is it OK if we give you a quick call to run through it? Or just reply here with the details.";

    // What a prefers_text customer gets instead: the same acknowledgement with no phone in it.
    const writtenFollow = outOfHours
        ? "You've caught us out of hours, so we'll come back to you here first thing."
        : "We've got it and we'll come back to you here shortly. Just tell us what needs doing and we'll take it from there.";

    const follow = input.intent === 'ack_missed_call'
        ? missedCallFollow
        : input.prefersText ? writtenFollow : callAsk;

    return { body: `${opener}\n---\n${follow}`, outOfHours, intent: input.intent };
}

// ---------------------------------------------------------------- T1: the media ask
//
// "If you can, send a quick photo or video of the job so we're ready when we call" — asked in the
// SAME message as the ack, never as a follow-up send (brief T1, 29 Aug 2026: two rapid-fire
// messages reads botty). Gated behind firstContactAutoAck.askForMedia (ships false) and CANNED
// ONLY: fixed variants below, no LLM anywhere in this path, so the ack stays content-free by
// construction — no money, no dates, no scope vocabulary, and the ask is a statement, not a
// question, so the "one question per reply" brand rule holds.
//
// Channel decisions (T1 design question 2), investigated 29 Aug 2026:
//
//   · WhatsApp — the natural home. Inbound media already lands on the thread (the Twilio webhook
//     downloads MediaUrl0 and stores mediaUrl on the message row, conversation-engine.ts) and
//     quote-prep reads the actual pixels via get_thread (agents/media-context.ts). No new intake.
//
//   · SMS — ADAPTED, not omitted. A UK long code cannot receive MMS (Twilio MMS is US/Canada
//     only), so "text us a photo" would ask for something that cannot arrive. Instead: "WhatsApp
//     a quick photo ... to this number", which is true because the SMS sender and the WhatsApp
//     sender are the same physical number on this account (whatsapp-sender.ts). That identity is
//     CHECKED at runtime, not assumed: if the numbers ever split (TWILIO_SMS_NUMBER pointed
//     elsewhere), the ask is omitted on SMS rather than pointing a customer at a number that has
//     no WhatsApp on it. A WhatsApp reply from them lands on the same thread (one person = one
//     conversation key across channels, conversation-engine.ts), so intake still holds.
//
//   · Webform — follows whichever pipe carries the ack, which is the brief's rule. A form opens
//     no WhatsApp window, so a webform ack usually goes out as an APPROVED TEMPLATE whose wording
//     is Meta's to freeze — a template body is never modified here (the !contentSid gate at the
//     call site), so on the template path the ask simply does not ride along (web_enquiry_ack_
//     context / video_request already carry their own approved asks). When the ack falls through
//     to SMS, the SMS wording above applies.
//
//   · Out of hours (design question 3) keeps the overnight framing: media sent NOW makes the
//     morning call faster. "now ... first thing" rather than "tonight", because out-of-hours
//     includes 6am, where "tonight" reads wrong.
//
// A prefers_text customer gets the ask with no call vocabulary in it — the suppression rule
// ("never mention a phone to someone who said keep it in writing") holds here like everywhere.

/** The canned photo/video ask, or null when the channel cannot honestly carry one. */
export function mediaAskSentence(input: {
    channel: 'whatsapp' | 'sms';
    outOfHours: boolean;
    prefersText?: boolean;
}): string | null {
    if (input.channel === 'sms') {
        // The adapted ask is only true while SMS and WhatsApp share one number. Checked, not assumed.
        const sms = getSmsSenderE164();
        const wa = getWhatsAppSenderE164();
        if (!sms || !wa || sms !== wa) return null;
        if (input.prefersText) {
            return input.outOfHours
                ? "If you can, WhatsApp a quick photo or video of the job to this number now and we'll have everything ready first thing."
                : 'If you can, WhatsApp a quick photo or video of the job to this number so we can get straight to it.';
        }
        return input.outOfHours
            ? "If you can, WhatsApp a quick photo or video of the job to this number now and we'll be ready first thing."
            : "If you can, WhatsApp a quick photo or video of the job to this number so we're ready when we call.";
    }
    if (input.prefersText) {
        return input.outOfHours
            ? "If you can, send a quick photo or video of the job now and we'll have everything ready first thing."
            : 'If you can, send a quick photo or video of the job so we can get straight to it.';
    }
    return input.outOfHours
        ? "If you can, send a quick photo or video of the job now and we'll be ready first thing."
        : "If you can, send a quick photo or video of the job so we're ready when we call.";
}

// ---------------------------------------------------------------- thread helpers

/** The newest inbound message text on a thread — what the spam screen reads when no text is passed. */
async function latestInboundText(conversationId?: string | null): Promise<string | null> {
    if (!conversationId) return null;
    const [row] = await db.select({ content: messages.content }).from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound')))
        .orderBy(desc(messages.createdAt))
        .limit(1);
    return row?.content ?? null;
}

/** True when any conversation row for this person carries the tag. */
async function threadHasTag(conversationIds: string[], tag: string): Promise<boolean> {
    if (!conversationIds.length) return false;
    const rows = await db.select({ tags: conversations.tags }).from(conversations)
        .where(inArray(conversations.id, conversationIds));
    return rows.some((r) => (r.tags ?? []).includes(tag));
}

const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/**
 * Raise a thread's priority and tag it, never lowering what a human already set.
 *
 * Board priority is how "surface this one first" is expressed, and both the returning-customer
 * bump and the callback-requested bump need exactly this: monotonic, tagged, and safe to run twice.
 */
export async function raiseThreadPriority(
    conversationIds: string[],
    /** null tags without touching the rank — some facts are instructions, not urgency. */
    priority: 'high' | 'urgent' | null,
    tag: string,
): Promise<void> {
    if (!conversationIds.length) return;
    const rows = await db.select({ id: conversations.id, priority: conversations.priority, tags: conversations.tags })
        .from(conversations).where(inArray(conversations.id, conversationIds));

    for (const row of rows) {
        const current = PRIORITY_RANK[row.priority ?? 'normal'] ?? 1;
        const next = priority ? PRIORITY_RANK[priority] : -1;
        const tags = Array.from(new Set([...(row.tags ?? []), tag]));
        await db.update(conversations)
            .set({
                priority: priority && next > current ? priority : (row.priority ?? 'normal'),
                tags,
                updatedAt: new Date(),
            })
            .where(eq(conversations.id, row.id));
    }
    console.log(`[FirstContact] Tagged ${conversationIds.length} thread(s) '${tag}'${priority ? ` and raised to ${priority}` : ''}`);
}

// ---------------------------------------------------------------- the lane entry point

export interface FirstContactAckResult {
    /** True only when a message actually went out. */
    sent: boolean;
    /** Machine-readable, always present — this is the audit trail for "why no ack?". */
    reason:
        | 'SENT'
        | 'DISABLED'
        | 'CHANNEL_NOT_ENABLED'
        | 'NOT_FIRST_CONTACT'
        | 'NO_PHONE'
        | 'QUEUED_NO_TEMPLATE'
        | 'DUPLICATE_DRAFT'
        /** Not a UK number, and not the owner's or a test range. */
        | 'OUT_OF_AREA'
        /** The inbound text matched a marketing/spam pattern. */
        | 'LOOKS_LIKE_SPAM'
        | `SEND_REFUSED:${string}`
        | 'ERROR';
    draftId?: string;
    mode?: 'freeform' | 'template' | 'sms';
    intent?: FirstContactAckIntent;
    outOfHours?: boolean;
    body?: string;
    templateName?: string;
    /** Which rule refused, when one did (e.g. the spam pattern's name). */
    detail?: string;
    /** 'first' or 'returning' when an ack was composed. */
    contactClass?: ContactClass;
}

// ---------------------------------------------------------------- the log
//
// The refusals ARE the product here. A feature that answers strangers automatically can only be
// switched on by someone who can see what it did and, far more often, what it declined to do —
// and until this table existed the only evidence a refusal ever happened was a console line.
//
// Three rules keep it honest and cheap:
//   · ONE insert, fire-and-forget, wrapped in its own try/catch. A logging failure must never turn
//     into a send failure; the worst case is a missing row, never a missing acknowledgement.
//   · EVERY outcome, including DISABLED. "Nothing happened because the feature is off" is the most
//     common answer to "why did nobody get a reply?", and it is worthless if it is not recorded.
//   · The body as SENT, not as composed, so the log shows what the customer actually saw.

/** Record one decision. Never throws, never awaited on the send path. */
export async function logFirstContactAck(
    input: {
        conversationId?: string | null;
        phone: string;
        channel: FirstContactChannel;
        contactName?: string | null;
    },
    result: FirstContactAckResult,
): Promise<void> {
    try {
        await db.insert(firstContactAckLog).values({
            id: `fca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            conversationId: input.conversationId ?? null,
            phone: input.phone || '(none)',
            contactName: input.contactName ?? null,
            channel: input.channel,
            intent: result.intent ?? null,
            contactClass: result.contactClass ?? null,
            sent: result.sent,
            // The reason column is 48 chars; SEND_REFUSED:<code> is the only variable-length one.
            reason: String(result.reason).slice(0, 48),
            detail: result.detail ?? null,
            mode: result.mode ?? null,
            templateName: result.templateName ?? null,
            outOfHours: result.outOfHours ?? null,
            body: result.body ?? null,
            draftId: result.draftId ?? null,
        });
    } catch (error: any) {
        // Deliberately swallowed. A log row is worth less than the send it must not endanger.
        console.warn('[FirstContact] Could not write the audit row:', error?.message);
    }
}

/**
 * Acknowledge a genuinely-first inbound (or a customer coming back after months), or explain why
 * not, and record the decision either way. Never throws: a lane must not be able to break ingest.
 */
export async function maybeAutoAckFirstContact(input: {
    conversationId?: string | null;
    phone: string;
    channel: FirstContactChannel;
    contactName?: string | null;
    hasMedia?: boolean;
    text?: string | null;
    intent?: FirstContactAckIntent;
}): Promise<FirstContactAckResult> {
    const result = await runFirstContactAck(input);
    // Fire and forget: the caller is an ingest path and the customer is already answered.
    void logFirstContactAck(input, result);
    return result;
}

/**
 * The decision itself.
 *
 * Always ends in one of three states — sent, queued for Ben, or a logged reason for doing nothing.
 * It never queues when the feature is off, the thread is mid-conversation, or a screen refused,
 * because in those cases the ordinary comms-agent lane is already going to draft a better reply,
 * and two competing drafts on one thread is worse than none.
 *
 * Order matters. Cheap local checks (flag, channel, geography) come before any query; the spam
 * screen runs before the history query; and everything runs before a single penny of send.
 */
async function runFirstContactAck(input: {
    conversationId?: string | null;
    phone: string;
    channel: FirstContactChannel;
    contactName?: string | null;
    /** Media on the first message makes it an ack_photos rather than an ack_enquiry. */
    hasMedia?: boolean;
    /**
     * The inbound message text, for the spam screen. When omitted, the newest inbound on the
     * conversation is read instead — so every existing caller gets screened without changing.
     */
    text?: string | null;
    /**
     * Override the intent the copy is composed from. The call ingest passes 'ack_missed_call',
     * because "thanks for your message" is the wrong thing to say to someone whose call rang out.
     * Still constrained to FIRST_CONTACT_ACK_INTENTS, so it can never widen what may auto-send.
     */
    intent?: FirstContactAckIntent;
}): Promise<FirstContactAckResult> {
    try {
        if (!input.phone || !input.phone.replace(/\D/g, '')) return { sent: false, reason: 'NO_PHONE' };

        const config = await readConfig();
        if (!config.enabled) return { sent: false, reason: 'DISABLED' };
        if (!config.channels.includes(input.channel)) return { sent: false, reason: 'CHANNEL_NOT_ENABLED' };

        const e164 = input.phone.includes('@c.us')
            ? `+${input.phone.replace('@c.us', '').replace(/\D/g, '')}`
            : input.phone;

        // SCREEN 1 — geography. Free, no query, no message text needed.
        const geo = screenGeography(e164);
        if (!geo.ok) {
            console.log(`[FirstContact] ${e164}: refusing to auto-ack, ${geo.reason} (${geo.detail})`);
            return { sent: false, reason: 'OUT_OF_AREA', detail: geo.detail };
        }

        // SCREEN 2 — spam. Costs one small query when the caller did not pass the text.
        const text = input.text !== undefined ? input.text
            : await latestInboundText(input.conversationId).catch(() => null);
        const spam = looksLikeSpam(text);
        if (!spam.ok) {
            console.log(`[FirstContact] ${e164}: refusing to auto-ack, LOOKS_LIKE_SPAM (${spam.detail})`);
            return { sent: false, reason: 'LOOKS_LIKE_SPAM', detail: spam.detail };
        }

        // The gate. Everything after this line runs only for a number we have never messaged, or
        // one that has been quiet longer than the returning threshold.
        const history = await readContactHistory({ conversationId: input.conversationId, phone: input.phone });
        const contactClass = classifyHistory(history, config.returningAfterDays);
        if (contactClass === 'ongoing') return { sent: false, reason: 'NOT_FIRST_CONTACT' };

        const intent: FirstContactAckIntent = input.intent
            && (FIRST_CONTACT_ACK_INTENTS as readonly string[]).includes(input.intent)
            ? input.intent
            // A returner gets the returning wording unless the caller asked for something more
            // specific (a missed call is still a missed call, whoever they are).
            : contactClass === 'returning' ? 'ack_returning'
                : input.hasMedia ? 'ack_photos' : 'ack_enquiry';

        // A returning customer may already have told us to keep it in writing. Nothing after that
        // may offer to ring them.
        const prefersText = await threadHasTag(history.conversationIds, PREFERS_TEXT_TAG).catch(() => false);
        const composed = composeFirstContactAck({ intent, contactName: input.contactName, prefersText });

        // A customer who came back after months is the best-converting lead this business gets, so
        // the thread goes up the board whether or not the ack itself manages to send.
        if (contactClass === 'returning') {
            await raiseThreadPriority(history.conversationIds, 'high', 'returning_customer')
                .catch((e) => console.warn('[FirstContact] Priority bump failed:', e?.message));
        }

        // Freeform needs an open WhatsApp window. An SMS-first contact never opens one, and
        // neither does a first message on a thread whose 24h has already elapsed.
        const windowOpen = await canSendFreeform(e164).catch(() => false);

        let body = composed.body;
        let contentSid: string | undefined;
        let contentVariables: Record<string, string> | undefined;
        let templateName: string | undefined;

        // Which pipe carries the acknowledgement.
        //
        //   An SMS-first contact gets SMS. Replying by WhatsApp to someone who texted us is the
        //   original bug: their number may not be on WhatsApp at all, and the send would fail.
        //   A UK landline gets SMS for the same reason, decided from the number itself.
        //   Everyone else gets WhatsApp, with the shut-window ladder below.
        const smsOnly = input.channel === 'sms' || isNonMobileUkNumber(e164);

        if (!smsOnly && !windowOpen) {
            // The shut-window ladder, best first:
            //   1. An approved template. It is the channel they used, and Meta's own wording.
            //   2. Failing that, SMS. There is no window and no template requirement on SMS, so
            //      the acknowledgement we actually wrote can go as written. This is new: before
            //      SMS existed as a channel, this branch could only queue and hope.
            //   3. Failing even that (no SMS sender configured), queue it for a human. Never drop.
            // Variable values are positional and shared across the preference list: {{1}} name,
            // {{2}} job context, {{3}} call timing. The context template uses all three; older
            // templates just use fewer. {{2}} is the customer's own words, truncated at a word
            // boundary — quoting them verbatim is grammar-safe where a spliced sentence isn't.
            const enquiryText = text; // already fetched at the top of this function
            const enquirySnippet = (() => {
                let raw = (enquiryText ?? '').replace(/\s+/g, ' ').trim();
                // Quoting "Hi, I have rang earlier," back at someone reads odd — strip leading
                // salutations/filler so the quote starts at the substance. Conservative list.
                raw = raw.replace(/^(hi|hiya|hello|hey|good (morning|afternoon|evening))[\s,.!-]+/i, '')
                    .replace(/^(i have rang earlier[\s,.!-]+|i called earlier[\s,.!-]+)/i, '')
                    .trim();
                if (!raw) return 'your job';
                if (raw.length <= 60) return raw;
                const cut = raw.slice(0, 60);
                return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
            })();
            const picked = await findApprovedTemplateWithValues(
                templatePreferenceFor(intent, prefersText),
                [
                    greetingFor(input.contactName).trim() || 'there',
                    enquirySnippet,
                    composed.outOfHours ? 'in the morning' : 'shortly',
                ],
            );
            if (picked) {
                body = picked.body;          // the approved wording, so the thread records what they saw
                contentSid = picked.template.sid;
                contentVariables = picked.variables;
                templateName = picked.template.name;
            } else if (!isSmsSenderConfigured()) {
                const draftId = await queueDraft({
                    phone: e164,
                    body: composed.body,
                    source: 'first_contact_ack',
                    reason: `[${intent}] First contact on ${input.channel}, window shut, no approved template and no SMS sender. Needs a human.`,
                });
                console.log(`[FirstContact] ${e164}: window shut, no template, no SMS sender — queued ${draftId ?? 'nothing (duplicate)'}`);
                return {
                    sent: false,
                    reason: draftId ? 'QUEUED_NO_TEMPLATE' : 'DUPLICATE_DRAFT',
                    draftId: draftId ?? undefined,
                    intent,
                    contactClass,
                    outOfHours: composed.outOfHours,
                    body: composed.body,
                };
            } else {
                console.log(`[FirstContact] ${e164}: window shut and no approved template — acknowledging by SMS instead`);
            }
        }

        // No template and no open window means SMS carries it (the ladder above already proved a
        // sender exists). queueDraft records the channel so the approver, the thread and the send
        // path all agree.
        const draftChannel: 'whatsapp' | 'sms' = smsOnly || (!windowOpen && !contentSid) ? 'sms' : 'whatsapp';

        // T1 media prompt (design question 1: ONE message). Folded into the last burst of the same
        // send, never a second message. Only on the intents where it makes sense:
        //   ack_photos      — they already sent media; asking again reads blind.
        //   ack_missed_call — a phone-first contact never described a job in writing, and the
        //                     post-call lane owns its own video request. Out of T1's scope.
        // And never on a template send (!contentSid): an approved template's wording is Meta's to
        // freeze, so the ask rides only on freeform and SMS bodies. Appended AFTER the pipe is
        // decided so the wording always matches the channel that actually carries it.
        if (config.askForMedia && !contentSid && (intent === 'ack_enquiry' || intent === 'ack_returning')) {
            const ask = mediaAskSentence({ channel: draftChannel, outOfHours: composed.outOfHours, prefersText });
            if (ask) body = `${body} ${ask}`;
        }

        const draftId = await queueDraft({
            phone: e164,
            body,
            channel: draftChannel,
            source: 'first_contact_ack',
            reason: `[${intent}] ${contactClass === 'returning' ? 'Returning customer' : 'First contact'} on ${input.channel}${composed.outOfHours ? ', out of hours' : ''}${templateName ? `, template ${templateName}` : ''}${draftChannel === 'sms' ? ', by SMS' : ''}. Auto-acknowledged.`,
            contentSid,
            contentVariables,
        });
        if (!draftId) return { sent: false, reason: 'DUPLICATE_DRAFT', intent, contactClass };

        // REALISM HOLD (owner, 22 Aug): a reply 4 seconds after the enquiry reads as a bot, and
        // the whole point of the ack is "someone saw this". The draft is stamped with a due time
        // 60–150s out and the comms-sweep fast tick releases it — deploy-safe (the hold lives in
        // the DB, not a timer), and the release path is the same claimed-row send a human
        // approval uses: logged, deduped, WhatsApp→SMS fallback intact. If the thread gains an
        // outbound before the hold expires (agent or Ben got there first with real context), the
        // release rejects the now-redundant ack instead of sending a generic hello late.
        if (process.env.FIRST_CONTACT_ACK_NO_HOLD === '1') {
            // Test/emergency escape hatch: send immediately, exactly the old behaviour.
            const result = await approveAndSendDraft(draftId, 'rules.first_contact');
            if (!result.ok) {
                console.warn(`[FirstContact] ${e164}: send refused (${result.code}) — draft ${draftId} left for Ben`);
                return { sent: false, reason: `SEND_REFUSED:${result.code}`, draftId, intent, contactClass, body };
            }
            return {
                sent: true, reason: 'SENT', draftId, mode: result.mode,
                intent, contactClass, outOfHours: composed.outOfHours, body,
                templateName: result.channel === 'sms' ? undefined : templateName,
            };
        }
        await holdAckDraft(draftId);
        console.log(`[FirstContact] ${e164}: ack held for realism (${intent}${composed.outOfHours ? ', out of hours' : ''}) via draft ${draftId}`);
        return {
            sent: false, reason: 'HELD', draftId,
            intent, contactClass, outOfHours: composed.outOfHours, body, templateName,
        };
    } catch (error: any) {
        console.error('[FirstContact] Auto-ack failed:', error?.message);
        return { sent: false, reason: 'ERROR' };
    }
}

// ---------------------------------------------------------------- replies to an ack
//
// An acknowledgement that asks a question makes a promise. If the ack says "shall we give you a
// quick call?", then a "yes" that lands on the board like any other message, waits four hours and
// gets answered by text is worse than never having asked. So the reply to an ack is read
// deterministically the moment it arrives, and the thread is tagged with what the customer said.
//
// Deliberately no model call. These are one-word answers to a question WE asked, in a window we
// control, and the comms agent's on-inbound lane still runs a few minutes later for anything
// ambiguous. Cheap and certain beats clever and slow.

/** Set when the customer said yes to a call. Priority goes urgent: a warm lead is on the phone. */
export const CALLBACK_TAG = 'callback_requested';
/** Set when the customer said no, or asked to keep it in writing. Nothing may chase a call after. */
export const PREFERS_TEXT_TAG = 'prefers_text';

/**
 * Unambiguous asks for a call. These beat a generic "no" elsewhere in the sentence, because
 * "no worries, give me a ring" is a yes.
 */
const STRONG_CALL_PATTERNS: RegExp[] = [
    /\b(call|ring|phone)\s+me\b/i,
    /\bgive me a (call|ring|bell|buzz)\b/i,
    /\b(please|pls|plz)\s+(call|ring|phone)\b/i,
    /\bcall (me )?(back|now|later|today|tomorrow|anytime|any time)\b/i,
    /\ba (call|chat|quick word)\b[^.!?]{0,20}\b(would be|is|sounds)\b[^.!?]{0,15}\b(good|great|fine|better|easier|best)\b/i,
    /\bhappy to (talk|chat|speak)\b/i,
    /\bwhen can you (call|ring|phone)\b/i,
    /\byou can (call|ring|phone) me\b/i,
    /\b(feel free to|best to) (call|ring|phone)\b/i,
];

/** Unambiguous refusals of a call, or requests to stay in writing. These beat a generic "yes". */
const STRONG_NO_CALL_PATTERNS: RegExp[] = [
    /\b(don'?t|do not|no need to|rather you didn'?t|would rather you didn'?t)\s+(call|ring|phone)\b/i,
    /\bno (phone )?calls?\b/i,
    /\bprefer\w*\s+(to )?(text|texts|texting|message|messages|messaging|whatsapp|writing|email)\b/i,
    /\b(rather|easier|better)\s+(to )?(text|message|whatsapp|write|keep it in writing)\b/i,
    /\bkeep it (in writing|on (text|whatsapp)|here)\b/i,
    /\b(text|message|whatsapp|write to) me (instead|please|here)\b/i,
    /\bcan'?t (talk|answer|take calls?|speak)\b/i,
    /\b(in|at) (work|meetings?|a meeting)\b/i,
    /\bwriting is (better|easier|fine)\b/i,
    /\bno thanks?\b[^.!?]{0,15}\b(text|message|here|writing)\b/i,
];

/** One-word answers, only trusted on a very short reply — they only mean anything as an answer. */
const WEAK_YES = /^\s*(yes|yeah|yea|yep|yh|yup|ok|okay|sure|please|please do|go ahead|sounds good|that works|fine|perfect)\b/i;
const WEAK_NO = /^\s*(no|nope|nah|not now|not really|no thanks?)\b(?!\s*(worries|problem|rush|bother))/i;

export type AckReplyIntent = typeof CALLBACK_TAG | typeof PREFERS_TEXT_TAG | null;

/**
 * Read a short reply as an answer to "shall we call you?".
 *
 * Returns null whenever it is not confident — the comms agent's ordinary lane will handle it, and
 * a wrong tag is worse than no tag (tagging prefers_text on a customer who wants a call means
 * nobody ever rings them).
 */
export function classifyAckReply(text?: string | null): { intent: AckReplyIntent; matched?: string } {
    const body = (text ?? '').trim();
    if (!body) return { intent: null };

    for (const re of STRONG_NO_CALL_PATTERNS) {
        if (re.test(body)) return { intent: PREFERS_TEXT_TAG, matched: re.source.slice(0, 40) };
    }
    for (const re of STRONG_CALL_PATTERNS) {
        if (re.test(body)) return { intent: CALLBACK_TAG, matched: re.source.slice(0, 40) };
    }

    // A bare yes/no is only an answer when it is genuinely a bare yes/no. Past ~60 characters the
    // customer is telling us something else that happens to start with "no".
    if (body.length <= 60) {
        if (WEAK_NO.test(body)) return { intent: PREFERS_TEXT_TAG, matched: 'weak_no' };
        if (WEAK_YES.test(body)) return { intent: CALLBACK_TAG, matched: 'weak_yes' };
    }
    return { intent: null };
}

export interface AckReplyTriageResult {
    tagged: AckReplyIntent;
    reason: 'TAGGED' | 'NO_RECENT_ACK' | 'UNCLEAR' | 'ALREADY_TAGGED' | 'NO_TEXT' | 'ERROR';
    matched?: string;
    priority?: 'high' | 'urgent';
}

/** How long after an ack a reply is still read as an answer to it. */
const ACK_REPLY_WINDOW_DAYS = 7;

/**
 * Called on every inbound. Does nothing unless this thread recently received a first-contact
 * acknowledgement and the reply is a clear yes or no about a call.
 *
 * Never throws — it runs on the ingest path.
 */
export async function triageAckReply(input: {
    conversationId?: string | null;
    phone: string;
    text?: string | null;
}): Promise<AckReplyTriageResult> {
    try {
        const body = input.text ?? await latestInboundText(input.conversationId).catch(() => null);
        if (!body?.trim()) return { tagged: null, reason: 'NO_TEXT' };

        const digits = input.phone.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) return { tagged: null, reason: 'NO_TEXT' };

        // Only a thread we actually acked recently. Without this, a "yes" to any other question
        // (a quote, a date) would be read as "yes, call me".
        const since = new Date(Date.now() - ACK_REPLY_WINDOW_DAYS * 86_400_000);
        const [ack] = await db.select({
            id: messageDrafts.id,
            at: sql<Date>`coalesce(${messageDrafts.sentAt}, ${messageDrafts.createdAt})`,
        }).from(messageDrafts)
            .where(and(
                sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`,
                eq(messageDrafts.source, 'first_contact_ack'),
                eq(messageDrafts.status, 'sent'),
                sql`coalesce(${messageDrafts.sentAt}, ${messageDrafts.createdAt}) >= ${since}`,
            ))
            .orderBy(desc(messageDrafts.createdAt))
            .limit(1);
        if (!ack) return { tagged: null, reason: 'NO_RECENT_ACK' };

        const { intent, matched } = classifyAckReply(body);
        if (!intent) return { tagged: null, reason: 'UNCLEAR' };

        const history = await readContactHistory({ conversationId: input.conversationId, phone: input.phone });
        const convIds = history.conversationIds;
        if (!convIds.length) return { tagged: null, reason: 'NO_RECENT_ACK' };

        // A bare "ok"/"yes" answers the ack only if it is the FIRST thing the customer has said
        // since the ack went out. Once they have replied with anything else, the conversation has
        // moved on and a later "Ok waiting" is about whatever was said last, not the call offer
        // (Sam, 21 Aug: "Ok waiting" 44 minutes and six messages after the ack opened a false
        // ring-back debt). Explicit phrases ("yes call me") still count for the full window.
        if (matched === 'weak_yes' || matched === 'weak_no') {
            const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messages)
                .where(and(
                    inArray(messages.conversationId, convIds),
                    eq(messages.direction, 'inbound'),
                    sql`${messages.createdAt} > ${ack.at}`,
                ));
            // The triggering inbound is normally already stored, so "first reply" means at most
            // one inbound since the ack.
            if (Number(n) > 1) return { tagged: null, reason: 'UNCLEAR', matched: `${matched}_stale` };
        }

        const [existing] = await db.select({ tags: conversations.tags }).from(conversations)
            .where(inArray(conversations.id, convIds)).limit(1);
        if ((existing?.tags ?? []).includes(intent)) return { tagged: intent, reason: 'ALREADY_TAGGED' };

        // A customer who has just said "yes, call me" is the most winnable thing on the board and
        // decays fastest, so it goes to the top. A "no, text me" is not urgent, it is an
        // instruction: tag it, leave the rank alone, and let nothing chase a call afterwards.
        const priority = intent === CALLBACK_TAG ? 'urgent' : null;
        await raiseThreadPriority(convIds, priority, intent);

        // SOLICITED VOICE BECOMES A DEBT (owner, 21 Aug: "we always want human voice contact").
        // The ack asked "is it OK if we give you a quick call?" on every text-first channel; a yes
        // used to become a tag and a hope. Now it opens the same tracked ring-back the missed-call
        // ladder uses: callback_due + the clock + a ping with the number — and Ben's outbound
        // Groundwire call clears it by itself (call-thread.ts). Not gated behind the post-call
        // outreach flag: this debt was opened by the customer's own words, not by a classifier.
        if (intent === CALLBACK_TAG) {
            try {
                const nowIso = new Date().toISOString();
                await db.update(conversations).set({
                    tags: sql`(SELECT array_agg(DISTINCT t) FROM unnest(array_append(coalesce(${conversations.tags}, '{}'), 'callback_due')) AS t)`,
                    metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('callbackDueAt', ${nowIso}::text)`,
                }).where(inArray(conversations.id, convIds));
                const { notifyCallbackDue } = await import('./pushover');
                await notifyCallbackDue({
                    callerName: null,
                    phoneNumber: input.phone,
                    jobSummary: `Said yes to a call: "${body.trim().slice(0, 80)}"`,
                });
                console.log(`[FirstContact] ${input.phone}: call consent → callback_due debt opened + ping`);
            } catch (e: any) {
                console.warn('[FirstContact] callback debt open failed (tag stands):', e?.message);
            }
        }

        console.log(`[FirstContact] ${input.phone}: reply tagged '${intent}' (${matched})`);
        return { tagged: intent, reason: 'TAGGED', matched, priority: priority ?? undefined };
    } catch (error: any) {
        console.error('[FirstContact] Ack-reply triage failed:', error?.message);
        return { tagged: null, reason: 'ERROR' };
    }
}

/**
 * For callers that compose their own first-touch message and have already queued it (the post-call
 * video request, the webform acknowledgement): decide whether that specific draft may skip the
 * approval queue under the same first-contact rule.
 *
 * Leaves the draft pending on every refusal, so the worst case is the behaviour we had before.
 */
export async function maybeAutoSendFirstContactDraft(draftId: string, input: {
    conversationId?: string | null;
    phone: string;
    channel: FirstContactChannel;
}): Promise<FirstContactAckResult> {
    // Same lane, same question ("why did nobody get a reply?"), so the same log.
    const result = await runAutoSendFirstContactDraft(draftId, input);
    void logFirstContactAck(input, result);
    return result;
}

async function runAutoSendFirstContactDraft(draftId: string, input: {
    conversationId?: string | null;
    phone: string;
    channel: FirstContactChannel;
}): Promise<FirstContactAckResult> {
    try {
        const config = await readConfig();
        if (!config.enabled) return { sent: false, reason: 'DISABLED', draftId };
        if (!config.channels.includes(input.channel)) return { sent: false, reason: 'CHANNEL_NOT_ENABLED', draftId };
        if (!(await isFirstContact({ conversationId: input.conversationId, phone: input.phone }))) {
            return { sent: false, reason: 'NOT_FIRST_CONTACT', draftId };
        }

        if (process.env.FIRST_CONTACT_ACK_NO_HOLD === '1') {
            const result = await approveAndSendDraft(draftId, 'rules.first_contact');
            if (!result.ok) {
                console.warn(`[FirstContact] ${input.phone}: ${input.channel} send refused (${result.code}) — draft ${draftId} left for Ben`);
                return { sent: false, reason: `SEND_REFUSED:${result.code}`, draftId };
            }
            return { sent: true, reason: 'SENT', draftId, mode: result.mode };
        }
        // Same realism hold as the composed ack path — the sweep releases it.
        await holdAckDraft(draftId);
        console.log(`[FirstContact] ${input.phone}: ${input.channel} first-touch ack held for realism via draft ${draftId}`);
        return { sent: false, reason: 'HELD', draftId };
    } catch (error: any) {
        console.error('[FirstContact] Auto-send of queued draft failed:', error?.message);
        return { sent: false, reason: 'ERROR', draftId };
    }
}

// ---------------------------------------------------------------- realism hold

/** Marker parsed by the comms-sweep fast tick: `[ack_hold_until:<iso>]` prefix on the reason. */
export const ACK_HOLD_PREFIX = 'ack_hold_until';

/**
 * Stamp a pending ack draft with a release time 60–150 seconds out. The delay is
 * random per send so acks don't land on a metronome; the floor keeps it quick
 * enough to still feel "they saw it", the ceiling keeps first contact under
 * three minutes at any hour.
 */
async function holdAckDraft(draftId: string): Promise<void> {
    const seconds = 60 + Math.floor(Math.random() * 90);
    const until = new Date(Date.now() + seconds * 1000).toISOString();
    const prefix = `[${ACK_HOLD_PREFIX}:${until}] `;
    await db.update(messageDrafts)
        .set({ reason: sql`${prefix} || coalesce(${messageDrafts.reason}, '')` })
        .where(eq(messageDrafts.id, draftId));
}
