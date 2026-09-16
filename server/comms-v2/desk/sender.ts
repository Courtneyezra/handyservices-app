/**
 * Contract 5 - Sender and bubble rules. The only exit. Chooses the channel per party, renders
 * for it, respects the window, picks a template when the window is shut, and records the send.
 *
 * Dry run (the sandbox door) runs everything up to delivery for real and then lands the
 * planned reply on the case file's thread as an outbound turn, so later turns see it. Live
 * delivery goes through the surviving outbound send (server/outbound.ts) under the desk's own
 * registered approver, and only once its switch has been turned on by hand: the desk is
 * sandbox-only until cutover. SMS and email render through server/comms-v2/channels (Goal 3); a
 * form or a call cannot carry a reply, so `chooseChannel` opens a real channel. Live delivery is
 * WhatsApp and SMS only, because the surviving outbound send is the one path that consults the
 * opt-out ledger; a live email send is refused rather than routed around it.
 *
 * Invariants: one run id sends once; every send has an approver; nothing the desk composed reaches
 * a customer without passing the guards, while a person's own words from Ben's board carry their
 * own authority and no verdicts (behaviour.md answer 43); verdicts once supplied decide, whoever
 * the approver is; a shut window never produces freeform text on any channel; one of the four
 * fixed lines that are Ben's to review sends in dry run only until he has.
 *
 * A template is named by the registry (server/window-templates.ts) and approved by the live sync
 * (server/whatsapp-template-sync.ts), which also holds Twilio's content SID for it. The wire shape
 * follows the transport the customer wrote on: Twilio takes the content SID and variables, Meta
 * takes the name, language and body components.
 */
import { appendTurn, recordSend, partyOf, type CaseFile, type ModelCallRecord, type Party, type RenderedBubble, type ReplyChannel, type SendRecord, type CaseFileDeps, type WhatsAppTransport } from './case-file';
import { KB_BACKED, type FixedLine } from './fixed-lines';
import { withoutDashPunctuation } from './dashes';
import type { GuardOutcome } from './guards';
import { isHumanApprover, type Approver } from '../../approver';
import { renderEmail } from '../channels/email-adapter';
import { firstNameOf } from '../channels/envelope';
import { renderSms, smsCost, smsSegmentCount, SMS_MAX_SEGMENTS, GSM7_MULTI, UCS2_MULTI } from '../channels/sms-adapter';
import type { ChannelReplyPurpose } from '../channels/templates';
import type { OutboundPurpose } from '../../opt-out';
import { isOutOfHours, ukHour } from '../../working-hours';
import { WINDOW_TEMPLATES } from '../../window-templates';

export const WINDOW_HOURS = 24;
/**
 * What one bubble the desk writes may hold (behaviour.md answer 93, 16 Sep 2026: "About 160, 1-2
 * sentences"): a soft ceiling of about 160 characters, at most three bubbles a reply (answers 82
 * and 93). Soft because a single sentence over it is only cut at a comma, never mid-phrase.
 */
export const BUBBLE_MAX_CHARS = 160;
export const BUBBLE_CEILING = 3;
/**
 * The limits bubbles had before answer 93: a person's typed reply (`asTyped`) is never refused for a
 * fourth paragraph, and words sent with `wideBubbles` are split only where they run past three
 * hundred characters, as they always were.
 */
export const TYPED_BUBBLE_CEILING = 4;
export const WIDE_BUBBLE_MAX_CHARS = 300;
/**
 * The pause before each bubble the desk writes, scaled to roughly the time a person takes to type it
 * (answer 91, 16 Sep 2026: "Longer gaps only"): about 30 ms a character, from 2.5 to 7 seconds, so a
 * 160-character bubble waits about five. The quiet window before the desk reads a turn is not this
 * (desk/turn-window.ts) and stays eight seconds.
 */
export const GAP_MIN_MS = 2500;
export const GAP_MAX_MS = 7000;
export const GAP_PER_CHAR_MS = 30;
/** A person's own words were typed before he pressed send: the short gaps they always had. */
export const TYPED_GAP_MIN_MS = 1000;
export const TYPED_GAP_MAX_MS = 3000;

/** The desk's own approver name for an unattended send: `agent.comms_v2` in server/sender-registry.ts, switch key `comms_v2`. */
export const DESK_APPROVER: Approver = 'agent.comms_v2';

export type ReplyPurpose = 'service_reply' | 'quote_ready' | ChannelReplyPurpose;
/** A desk-started send has one of these purposes; neither is a reply to a customer. */
export type InitiatePurpose = 'approver_chase' | 'owner_escalation';
/** What a delivery is for: a reply to a customer, or a send the desk started itself. */
export type DeliveryPurpose = ReplyPurpose | InitiatePurpose;

const INITIATE_PURPOSES: readonly DeliveryPurpose[] = ['approver_chase', 'owner_escalation'] satisfies InitiatePurpose[];

/**
 * How the one outbound send labels, gates and records a delivery of this purpose. A reply to a
 * customer is a `service_reply` under the desk's context, as it always has been. A desk-started send
 * is not one: server/outbound.ts keeps `service_reply` for a reply or a message the job requires and
 * never for something the system started on its own, so a chase or an escalation takes the
 * fail-closed `marketing` class at the opt-out ledger, where a plain STOP blocks it, and carries its
 * own purpose in the context the ledger and the logs record. So does a reply whose template row the
 * registry records as marketing (the missed-call acknowledgement, which Meta approved as MARKETING):
 * the row's `purpose` decides, on every channel its words go out on, never the reply purpose's name.
 */
export function outboundLabelFor(purpose: DeliveryPurpose): OutboundLabel {
    if (INITIATE_PURPOSES.includes(purpose)) return { purpose: 'marketing', context: `comms_v2:${purpose}` };
    const marketingRow = templateRowsFor(purpose as ReplyPurpose, WINDOW_TEMPLATES).some((t) => t.purpose === 'marketing');
    return marketingRow ? { purpose: 'marketing', context: `comms_v2:${purpose}` } : { purpose: 'service_reply', context: 'comms_v2' };
}

/** The class the opt-out ledger gates a send under, and the context the ledger and the logs record it with. */
export interface OutboundLabel { purpose: OutboundPurpose; context: string }

// ---------------------------------------------------------------- choose_channel

export type ChannelChoice = { ok: true; channel: ReplyChannel; address: string } | { ok: false; reason: string };

/**
 * The channel the party wrote on; for a form or a call, one they have written on before that can
 * carry the reply, and failing that WhatsApp if the number is on it, then SMS, then email. An SMS
 * from a party whose WhatsApp window is open is answered on WhatsApp (the design's "if a known
 * customer also has WhatsApp, prefer it"), never on a shut one.
 *
 * `noTemplate` is for a send no approved template can carry, which today is the quote delivery: its
 * link is on no template of ours. Where the channel the order lands on is one the customer has
 * never written on and whose window is shut - the WhatsApp record a form or a call lead is given
 * for a number known to be on WhatsApp - that window would take a template and none carries the
 * link, so the send takes the next channel that needs no template rather than never reaching them.
 * A channel the customer chose keeps its normal treatment: a genuine WhatsApp thread gone quiet for
 * a day still comes back shut, and the caller holds it for Ben.
 */
export function chooseChannel(party: Party, wroteOn: Party['channels'][number]['kind'] | null, now: Date = new Date(), opts: { noTemplate?: boolean } = {}): ChannelChoice {
    const choice = channelFor(party, wroteOn, now);
    if (!choice.ok || !opts.noTemplate) return choice;
    const chosen = party.channels.find((c) => c.kind === choice.channel);
    if (chosen?.lastInboundAt || windowOf(party, choice.channel, now).state === 'open') return choice;
    for (const kind of ['sms', 'email'] as const) {
        const next = party.channels.find((c) => c.kind === kind);
        if (next) return { ok: true, channel: kind, address: next.address };
    }
    return choice;
}

function channelFor(party: Party, wroteOn: Party['channels'][number]['kind'] | null, now: Date): ChannelChoice {
    const carry = (kind: ReplyChannel) => party.channels.find((c) => c.kind === kind);
    if (wroteOn === 'sms' && carry('whatsapp') && windowOf(party, 'whatsapp', now).state === 'open') return { ok: true, channel: 'whatsapp', address: carry('whatsapp')!.address };
    if (wroteOn === 'whatsapp' || wroteOn === 'sms' || wroteOn === 'email') {
        const c = carry(wroteOn);
        if (c) return { ok: true, channel: wroteOn, address: c.address };
    }
    // A form and a call are not channels a reply goes out on. Before the order below, the reply
    // follows a channel this customer has actually written on and whose window can carry it: someone
    // who scoped the job by text and then accepts on the quote page is answered by text, not nudged
    // on a WhatsApp record that has never opened. A first contact who has written on nothing, the
    // web form the order was written for, still takes the order and its approved template.
    for (const kind of ['whatsapp', 'sms', 'email'] as const) {
        const c = carry(kind);
        if (c?.lastInboundAt && windowOf(party, kind, now).state === 'open') return { ok: true, channel: kind, address: c.address };
    }
    for (const kind of ['whatsapp', 'sms', 'email'] as const) {
        const c = carry(kind);
        if (c) return { ok: true, channel: kind, address: c.address };
    }
    return { ok: false, reason: 'the party has no channel that can carry a reply' };
}

// ---------------------------------------------------------------- window

export interface WindowState { state: 'open' | 'shut'; reason: string; opensUntil: string | null }

/** For WhatsApp, open or shut with the reason, from the party's channel record. Never guessed: no recorded state is shut. */
export function windowOf(party: Party, channel: ReplyChannel, now: Date): WindowState {
    if (channel !== 'whatsapp') return { state: 'open', reason: `${channel} has no window`, opensUntil: null };
    const c = party.channels.find((x) => x.kind === 'whatsapp');
    if (!c || !c.lastInboundAt) return { state: 'shut', reason: 'no inbound WhatsApp recorded on the party\'s channel; a channel with no recorded window state is shut', opensUntil: null };
    const until = Date.parse(c.lastInboundAt) + WINDOW_HOURS * 3_600_000;
    if (now.getTime() < until) return { state: 'open', reason: `the customer wrote on WhatsApp at ${c.lastInboundAt}`, opensUntil: new Date(until).toISOString() };
    return { state: 'shut', reason: `the customer last wrote on WhatsApp at ${c.lastInboundAt}, more than ${WINDOW_HOURS} hours ago`, opensUntil: null };
}

// ---------------------------------------------------------------- render

export type RenderResult = { ok: true; bubbles: RenderedBubble[] } | { ok: false; reason: 'ceiling' | 'empty'; bubbles: RenderedBubble[] };

/** The pause before a bubble the desk wrote: roughly its typing time. */
export function typingGap(text: string): number {
    return Math.max(GAP_MIN_MS, Math.min(GAP_MAX_MS, Math.round(text.length * GAP_PER_CHAR_MS)));
}

function typedGap(text: string): number {
    return Math.max(TYPED_GAP_MIN_MS, Math.min(TYPED_GAP_MAX_MS, Math.round(TYPED_GAP_MIN_MS + text.length * 8)));
}

/** The shortest piece a comma split may leave, so a long sentence is never broken into a fragment. */
const MIN_CLAUSE_CHARS = 40;

/**
 * A sentence over the soft ceiling, cut at its commas into pieces a person would send on their own.
 * Each piece is at least a short clause; a sentence with no such comma stays whole. The comma that
 * ended a piece is dropped, as a person splitting a thought across two messages would.
 */
function splitAtCommas(sentence: string, max: number): string[] {
    const parts = sentence.split(/,\s+/);
    if (parts.length < 2) return [sentence];
    const out: string[] = [];
    let cur = '';
    for (const part of parts) {
        const joined = cur ? `${cur}, ${part}` : part;
        if (cur && joined.length > max && cur.length >= MIN_CLAUSE_CHARS) { out.push(cur); cur = part; }
        else cur = joined;
    }
    if (cur) {
        // A last piece too short to stand alone goes back on the one before it.
        if (out.length && cur.length < MIN_CLAUSE_CHARS) out[out.length - 1] = `${out[out.length - 1]}, ${cur}`;
        else out.push(cur);
    }
    return out;
}

/**
 * One bubble over the soft ceiling split the way a person would: at sentence boundaries first, one or
 * two sentences a bubble, then a sentence still over the ceiling at its commas. Never mid-phrase: a
 * sentence with no comma to split at stays whole.
 */
/** `wideBubbles`: split only past three hundred characters, at sentence boundaries, as before answer 93. */
function splitWide(text: string): string[] {
    if (text.length <= WIDE_BUBBLE_MAX_CHARS) return [text];
    const sentences = text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const s of sentences) {
        if (!cur) { cur = s; continue; }
        if ((cur + ' ' + s).length <= WIDE_BUBBLE_MAX_CHARS) cur = `${cur} ${s}`;
        else { out.push(cur); cur = s; }
    }
    if (cur) out.push(cur);
    return out;
}

function splitLong(text: string): string[] {
    if (text.length <= BUBBLE_MAX_CHARS) return [text];
    const sentences = text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean).flatMap((s) => (s.length > BUBBLE_MAX_CHARS ? splitAtCommas(s, BUBBLE_MAX_CHARS) : [s]));
    const out: string[] = [];
    let cur = '';
    let inCur = 0;
    for (const s of sentences) {
        if (!cur) { cur = s; inCur = 1; continue; }
        if (inCur < 2 && (cur + ' ' + s).length <= BUBBLE_MAX_CHARS) { cur = `${cur} ${s}`; inCur++; }
        else { out.push(cur); cur = s; inCur = 1; }
    }
    if (cur) out.push(cur);
    return out;
}

export interface RenderOptions {
    /**
     * A person's own words (behaviour.md answer 43): a blank line still starts a new bubble, and
     * inside one his line breaks stay as he typed them, with nothing re-split at a sentence.
     */
    asTyped?: boolean;
    /**
     * The limits bubbles had before answer 93: split only past three hundred characters, a ceiling of
     * four, the desk's typing gaps. For words that must not be refused for length: one of Ben's fixed
     * lines sent on its own (desk.ts), and a quote delivery the render would otherwise hold
     * (quoting/deliver-quote.ts), which has no shorten round to fall back on.
     */
    wideBubbles?: boolean;
}

/** Ben's two-line sign-off, which closes the four knowledge-base fixed lines (desk/fixed-lines.ts). */
export const SIGN_OFF_LINES = 'Thanks\nBen';
export const RE_SIGN_OFF_PARAGRAPH = /^\s*thanks\s*\n\s*ben\s*$/i;

/**
 * WhatsApp: the one reply split into bubbles at the breaks a person would use: the composer's
 * blank lines first, then sentence boundaries (one or two sentences a bubble) and commas for
 * anything over about 160 characters. Typing gaps of roughly each bubble's typing time. A ceiling reached returns the reply to
 * the composer to shorten rather than sending a wall. `asTyped` is the human path: blank lines
 * still break bubbles, nothing inside one is reflowed. Anything else the desk wrote leaves with no
 * dash used as punctuation, checked after the reflow, which is what turns a line-leading "- " into
 * one between words (dashes.ts).
 */
export function renderWhatsApp(reply: string, opts: RenderOptions = {}): RenderResult {
    const paragraphs = reply.replace(/\r\n/g, '\n').split(/\n\s*\n+/)
        // Ben's "Thanks / Ben" keeps its line break: folded, it reads as the customer thanking Ben.
        .map((p) => opts.asTyped ? p.split('\n').map((l) => l.trimEnd()).join('\n').trim() : RE_SIGN_OFF_PARAGRAPH.test(p) ? SIGN_OFF_LINES : withoutDashPunctuation(p.replace(/\s*\n\s*/g, ' ').trim()))
        .filter(Boolean);
    const texts = opts.asTyped ? paragraphs : paragraphs.flatMap(opts.wideBubbles ? splitWide : splitLong);
    const bubbles = texts.map((text) => ({ text, gapMs: opts.asTyped ? typedGap(text) : typingGap(text) }));
    if (!bubbles.length) return { ok: false, reason: 'empty', bubbles };
    if (bubbles.length > (opts.asTyped || opts.wideBubbles ? TYPED_BUBBLE_CEILING : BUBBLE_CEILING)) return { ok: false, reason: 'ceiling', bubbles };
    return { ok: true, bubbles };
}

/** Per channel: WhatsApp bubbles; SMS one message of at most two segments; email a letter with a greeting and a sign-off (channels/). Every one of them honours `asTyped`: a person's own words are never reflowed, rewritten or wrapped. Whatever else goes out carries no dash used as punctuation. */
export function render(channel: ReplyChannel, reply: string, opts: RenderOptions & { name?: string | null } = {}): RenderResult {
    if (channel === 'sms') return renderSms(opts.asTyped ? reply : withoutDashPunctuation(reply), opts);
    if (channel === 'email') return renderEmail(opts.asTyped ? reply : withoutDashPunctuation(reply), opts);
    return renderWhatsApp(reply, opts);
}

/**
 * What the composer is told when a render refuses for length, in the refusing channel's own
 * measure. Only SMS carries a character budget: the WhatsApp brief counts bubbles, and a character
 * number there is read by nobody.
 */
export type ShortenBrief =
    | { previous: string; channel: 'sms'; measured: number; ceiling: number; charBudget: number }
    | { previous: string; channel: Exclude<ReplyChannel, 'sms'>; measured: number; ceiling: number };

/**
 * A reply too long for its channel, described the way that channel counts: WhatsApp counts bubbles
 * against the ceiling, SMS counts segments against the two a single text message may use. Telling
 * the composer the other channel's numbers gives it no reason to shorten, so the retry fails too.
 * The SMS budget is the refusing text's own encoding: one character outside GSM 03.38 halves what
 * two segments hold, so a GSM7 number would send the shortened reply back over the ceiling again.
 */
export function shortenBriefFor(channel: ReplyChannel, previous: string, rendered: RenderedBubble[]): ShortenBrief {
    if (channel === 'sms') {
        const text = rendered[0]?.text ?? '';
        const multi = smsCost(text).encoding === 'ucs2' ? UCS2_MULTI : GSM7_MULTI;
        return { previous, channel, measured: smsSegmentCount(text), ceiling: SMS_MAX_SEGMENTS, charBudget: multi * SMS_MAX_SEGMENTS };
    }
    return { previous, channel, measured: rendered.length, ceiling: BUBBLE_CEILING };
}

// ---------------------------------------------------------------- pick_template

export interface TemplateStatusSource {
    /** Meta's approval for this template name and Twilio's content SID for it, from the live sync, never from the registry's own idea of itself. Null: not approved. */
    approved(name: string): Promise<{ contentSid: string } | null>;
}

/** The live status from server/whatsapp-template-sync.ts, loaded on first use: it opens the database. */
export const liveTemplateStatus: TemplateStatusSource = {
    async approved(name) {
        try {
            const { findApprovedTemplate } = await import('../../whatsapp-template-sync');
            const row = await findApprovedTemplate(name);
            return row ? { contentSid: row.contentSid } : null;
        } catch {
            return null;
        }
    },
};

export const noTemplateApproved: TemplateStatusSource = { async approved() { return null; } };

/** Which registry triggers carry a reply of each purpose. Branches on purpose, never on a name. */
const TRIGGERS_FOR_PURPOSE: Record<ReplyPurpose, readonly string[]> = {
    service_reply: ['question_unanswered'], web_form_ack: ['webform_first_contact'], web_form_ack_no_call: ['webform_first_contact_no_call'],
    post_call_followup: ['post_call_followup'], missed_call: ['missed_call'],
    // Ben's priced quote on a shut window: `quote_ready_link`, whose {{2}} is the quote link (quoting/deliver-quote.ts).
    quote_ready: ['quote_ready'],
};

/**
 * What a template body is filled from: the party's name, the turn's topic, and the instant the reply
 * goes. `link` is for a template whose second variable is a link rather than a topic (the quote
 * delivery's `quote_ready_link`); it is copied whole, never cut.
 */
export interface TemplateVars { name: string | null; topic: string; at: Date; link?: string | null }

/**
 * The customer-facing rows of the one registry (server/window-templates.ts) that carry a reply of
 * this purpose. A row's own `purpose` does not filter it out: the missed-call row is marketing by
 * Meta's decision and still the missed-call reply, gated as marketing by `outboundLabelFor`.
 */
export function templateRowsFor<T extends { purpose: string | null; audience: string; trigger: { id: string } }>(purpose: ReplyPurpose, registry: readonly T[]): T[] {
    return registry.filter((t) => t.audience === 'customer' && (TRIGGERS_FOR_PURPOSE[purpose] ?? []).includes(t.trigger.id));
}

/**
 * The variables a template body takes: {{1}} the first name or 'there', {{2}} the topic, {{3}} when
 * we would ring (the web form's "a quick call {{3}}"), by the UK hour of the desk's own clock:
 * 'shortly' inside Ben's hours, 'in the morning' outside them. The same rule and the same words the
 * live acknowledgement fills this template with today (server/first-contact-ack.ts).
 */
export function templateVariables(body: string, vars: TemplateVars): Record<string, string> {
    const first = firstNameOf(vars.name) ?? 'there';
    const when = isOutOfHours(ukHour(vars.at)) ? 'in the morning' : 'shortly';
    const out: Record<string, string> = {};
    const re = /\{\{\s*(\d+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) out[m[1]] = m[1] === '1' ? first : m[1] === '2' ? (vars.link ?? vars.topic.slice(0, 120)) : when;
    return out;
}

/** A template body with its variables filled in. */
export function fillTemplate(body: string, variables: Record<string, string>): string {
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => variables[n] ?? '');
}

/** The words a template of this purpose carries off WhatsApp, where no approval is needed: the best rung's body as one SMS or one email. Null when no row exists. */
export async function templateBodyFor(purpose: ReplyPurpose, vars: TemplateVars): Promise<{ name: string; body: string } | null> {
    const { WINDOW_TEMPLATES } = await import('../../window-templates');
    const t = templateRowsFor(purpose, WINDOW_TEMPLATES)[0];
    if (!t) return null;
    const rung = t.rungs[0];
    return { name: rung.name, body: fillTemplate(rung.body, templateVariables(rung.body, vars)) };
}

/** An approved template with everything either transport needs to carry it. */
export interface TemplateSend { name: string; language: string; contentSid: string; variables: Record<string, string> }

/**
 * An approved template picked for a purpose: the wire fields, the body with its variables filled
 * in for the customer, and the rung's approved wording with the placeholders left unfilled. The
 * wording is the sentences the business itself says; a filled variable is the customer's own words
 * quoted back, which is why the ask ledger reads the wording and never the body (desk.ts).
 */
export type TemplatePick = { ok: true; template: TemplateSend; body: string; wording: string } | { ok: false; reason: string };

/** The fields the outbound gate needs for this template on this transport, and nothing for the other one. */
export type TemplateWire =
    | { via: 'twilio'; contentSid: string; contentVariables: Record<string, string> }
    | { via: 'meta'; templateName: string; templateLanguage: string; templateComponents: Array<{ type: 'body'; parameters: Array<{ type: 'text'; text: string }> }> };

export function templateWire(transport: WhatsAppTransport, t: TemplateSend): TemplateWire {
    if (transport === 'twilio') return { via: 'twilio', contentSid: t.contentSid, contentVariables: t.variables };
    const parameters = Object.keys(t.variables).sort((a, b) => Number(a) - Number(b)).map((n) => ({ type: 'text' as const, text: t.variables[n] }));
    return { via: 'meta', templateName: t.name, templateLanguage: t.language, templateComponents: [{ type: 'body', parameters }] };
}

/**
 * When the window is shut: one approved template for the reply's purpose from the registry. None
 * approved: the reply is held as a pending draft for Ben. Never an SMS fallback.
 *
 * The words and the variables come from the rung that is actually approved, never from the best
 * rung: a fallback rung is a different template with different wording, and filling a variable it
 * has no slot for would send one message while the file, the board and the send record another.
 */
export async function pickTemplate(purpose: ReplyPurpose, vars: TemplateVars, status: TemplateStatusSource = liveTemplateStatus): Promise<TemplatePick> {
    const { WINDOW_TEMPLATES } = await import('../../window-templates');
    for (const t of templateRowsFor(purpose, WINDOW_TEMPLATES)) for (const rung of t.rungs) {
        const live = await status.approved(rung.name);
        if (live) {
            const variables = templateVariables(rung.body, vars);
            return { ok: true, template: { name: rung.name, language: t.language, contentSid: live.contentSid, variables }, body: fillTemplate(rung.body, variables), wording: rung.body };
        }
    }
    return { ok: false, reason: `no approved template for purpose ${purpose}; held as a pending draft for Ben` };
}

// ---------------------------------------------------------------- send

export interface Deliverer {
    deliver(input: { to: string; channel: ReplyChannel; transport: WhatsAppTransport; bubbles: RenderedBubble[]; template: TemplateSend | null; runId: string; approver: Approver; purpose: DeliveryPurpose }): Promise<DeliveryOutcome>;
}

/** A failure names the bubbles that had already reached the customer, so the file can record them. Both carry the label the delivery was, or would have been, sent under. */
export type DeliveryOutcome = { ok: true; sid: string | null; label?: OutboundLabel } | { ok: false; reason: string; delivered: RenderedBubble[]; label?: OutboundLabel };

/**
 * The surviving outbound send. The registry gate inside it refuses an unknown or switched-off
 * approver; the desk adds one rule of its own on top: its switch is off until someone writes
 * `spine.senders.comms_v2.enabled = true`, because an absent switch is on for every other sender
 * and the new desk must not go live by default. Every send is labelled, gated at the opt-out ledger
 * and recorded under its own purpose (`outboundLabelFor`), never as a customer reply by default; the
 * label is decided before any gate and returned on every outcome, a refusal included, so a send the
 * switch stopped is on the record with what it would have gone as.
 */
export const liveDeliverer: Deliverer = {
    async deliver(input) {
        const delivered: RenderedBubble[] = [];
        const label = outboundLabelFor(input.purpose);
        const { registryEntryFor } = await import('../../sender-registry');
        const entry = registryEntryFor(input.approver);
        if (!entry) return { ok: false, reason: `approver ${input.approver} has no row in the sender registry; the live send is refused`, delivered, label };
        const { getSpineConfig } = await import('../../spine/config');
        const cfg = await getSpineConfig();
        // The desk's own switch gates every send, whoever licensed it. A row with a switch key of its
        // own must have that switch on as well; a person's `human:*` row has none by design (nothing
        // may stop a person replying), and reading that missing key as the switch refused every send
        // Ben pressed on the live desk ("spine.senders.null.enabled is not true").
        const switches = [registryEntryFor(DESK_APPROVER)?.switchKey ?? null, ...(entry.switchKey ? [entry.switchKey] : [])];
        const off = switches.find((key) => !key || cfg.senders?.[key]?.enabled !== true);
        if (off !== undefined) return { ok: false, reason: `spine.senders.${off}.enabled is not true; the new desk stays in the sandbox until it is`, delivered, label };
        if (input.channel !== 'whatsapp' && input.channel !== 'sms') return { ok: false, reason: `live delivery on ${input.channel} is refused: the one outbound send, which is the only path that checks the opt-out ledger, carries WhatsApp and SMS only`, delivered, label };
        const { sendCustomerMessage } = await import('../../outbound');
        let sid: string | null = null;
        for (const b of input.bubbles) {
            if (b.gapMs > 0) await new Promise((r) => setTimeout(r, b.gapMs));
            const res = await sendCustomerMessage({
                approver: input.approver, runId: input.runId, to: input.to, body: b.text, channel: input.channel, allowSmsFallback: false, purpose: label.purpose, context: label.context,
                ...(input.template && input.channel === 'whatsapp' ? templateWire(input.transport, input.template) : {}),
                ...(input.channel === 'whatsapp' ? { via: input.transport } : {}),
            });
            if (!res.ok) return { ok: false, reason: res.error ?? res.reason ?? 'delivery failed', delivered, label };
            delivered.push(b);
            sid = res.sid ?? sid;
        }
        return { ok: true, sid, label };
    },
};

export interface SendInput {
    file: CaseFile;
    partyId: string;
    channel: ReplyChannel;
    window: WindowState;
    bubbles: RenderedBubble[];
    template: TemplateSend | null;
    runId: string;
    approver: Approver;
    /** The verdicts on a composed reply. Null only for a person's own words, which the guards never gate. */
    guards: GuardOutcome | null;
    factIds: string[];
    kbIds: string[];
    /** The fixed lines the reply carries; one of the four that are Ben's to review sends in dry run only until he has. */
    fixedLines: FixedLine[];
    calls: ModelCallRecord[];
    mode: 'dry_run' | 'live';
    /** What the reply is for, so the delivery is gated under its row's opt-out class (`outboundLabelFor`). Omitted: a service reply. */
    purpose?: ReplyPurpose;
    /** The messages of the customer turn the reply answers (case-file.ts `messagesOf`), recorded on its outbound turn. Omitted when it answers no one turn: a person's words, a quote Ben sent. */
    answers?: string[];
}

export type SendOutcome = { ok: true; record: SendRecord } | { ok: false; reason: string };

export interface SenderDeps extends CaseFileDeps {
    deliverer?: Deliverer;
}

/**
 * Delivers the rendered reply with an approver and a run id, then records the send on the file
 * with the facts it was written from. Refuses: verdicts that did not pass, whoever the approver
 * is, and a send with no verdicts at all unless a person wrote the words; no approver or run id;
 * window shut and no template; the party not on the file; a run id already sent; live, one of the
 * four fixed lines Ben has not yet reviewed. A live delivery that fails part way records the
 * bubbles that went, marked partial, before the failure is returned.
 */
export async function send(input: SendInput, deps: SenderDeps = {}): Promise<SendOutcome> {
    const now = deps.now ?? (() => new Date());
    if (!input.approver?.trim()) return { ok: false, reason: 'no approver' };
    if (!input.runId?.trim()) return { ok: false, reason: 'no run id' };
    // Verdicts, once supplied, decide: a reply the desk composed is refused on a failure whoever
    // licensed it, Ben included, because the question answer 43 asks is who WROTE the words and
    // not who licensed the send. Only a send carrying no verdicts at all rests on the approver,
    // and only an explicit `human:` prefix is a person there. Everything else is refused: the
    // automated enum, a legacy string, a contractor relay the desk has no path for, and any
    // approver this build does not recognise.
    if (input.guards ? !input.guards.ok : !isHumanApprover(input.approver)) return { ok: false, reason: 'guards not passed' };
    if (input.window.state === 'shut' && !input.template) return { ok: false, reason: 'window shut and no template' };
    const party = partyOf(input.file, input.partyId);
    if (!party) return { ok: false, reason: 'the party is not on the file' };
    if (input.file.sentRunIds.includes(input.runId)) return { ok: false, reason: `run ${input.runId} has already sent` };
    if (!input.bubbles.length) return { ok: false, reason: 'nothing to send' };
    const channel = party.channels.find((c) => c.kind === input.channel);
    if (!channel) return { ok: false, reason: `the party has no ${input.channel} address` };
    const unreviewed = input.fixedLines.filter((l) => KB_BACKED.has(l.kind) && !l.kbId).map((l) => l.kind);
    if (input.mode === 'live' && unreviewed.length) return { ok: false, reason: `fixed line ${unreviewed.join(', ')} has no reviewed knowledge-base row; a default for one of Ben's four lines sends in dry run only` };

    // In dry run and live alike the reply lands on the thread as an outbound turn, so later turns see it.
    // A reply is never dated before the turn it answers: a provider's own timestamp can run ahead of this clock.
    const land = (bubbles: RenderedBubble[], partial: boolean): SendOutcome => {
        const last = input.file.turns[input.file.turns.length - 1];
        const at = new Date(Math.max(now().getTime(), last ? Date.parse(last.at) + 1 : 0)).toISOString();
        const turn = appendTurn(input.file, { at, channel: input.channel, direction: 'outbound', partyId: input.partyId, kind: 'text', body: bubbles.map((b) => b.text).join('\n'), media: [], runId: input.runId, approver: input.approver, ...(input.answers ? { answers: input.answers } : {}) }, deps);
        if (!turn.ok) return { ok: false, reason: turn.reason };
        const record: SendRecord = {
            runId: input.runId, approver: input.approver, partyId: input.partyId, channel: input.channel, windowState: input.window.state, templateId: input.template?.name ?? null,
            bubbles, factIds: input.factIds, kbIds: input.kbIds, calls: input.calls, at: turn.value.at, mode: input.mode, partial, turnId: turn.value.id,
        };
        const rec = recordSend(input.file, record);
        if (!rec.ok) return { ok: false, reason: rec.reason };
        return { ok: true, record };
    };

    if (input.mode === 'live') {
        const delivered = await (deps.deliverer ?? liveDeliverer).deliver({ to: channel.address, channel: input.channel, transport: channel.transport ?? 'twilio', bubbles: input.bubbles, template: input.template, runId: input.runId, approver: input.approver, purpose: input.purpose ?? 'service_reply' });
        if (!delivered.ok) {
            if (delivered.delivered.length) land(delivered.delivered, true);
            return { ok: false, reason: delivered.reason };
        }
    }
    return land(input.bubbles, false);
}

// ---------------------------------------------------------------- initiate

/** A template the desk itself defines for a desk-started send; approval still comes only from the live sync, by name. */
export interface TemplateDefinition { name: string; language: string; body: string; variables: Record<string, string> }

export interface InitiateInput {
    file: CaseFile;
    /** The recipient: an approver's own address (Ben, the owner), never a party's reply channel. */
    to: { address: string; name: string | null };
    purpose: InitiatePurpose;
    template: TemplateDefinition;
    runId: string;
    approver: Approver;
    mode: 'dry_run' | 'live';
}

export interface InitiatedSend {
    runId: string;
    approver: Approver;
    purpose: InitiatePurpose;
    to: { address: string; name: string | null };
    templateId: string;
    contentSid: string;
    body: string;
    /** The provider's message id for a live send; null in dry run. */
    sid: string | null;
    at: string;
    mode: 'dry_run' | 'live';
    /** The label it went under: the deliverer's own on a live send, the one it would carry in dry run. */
    label: OutboundLabel;
}

export type InitiateOutcome = { ok: true; send: InitiatedSend } | { ok: false; reason: string; label?: OutboundLabel };

export interface InitiateDeps extends SenderDeps {
    templates?: TemplateStatusSource;
}

/**
 * A desk-started send, template only, for chasing an approver (Goal 6, checklist 7.5) or, later,
 * a maintenance reminder. Live, it goes through the same deliverer as a reply, gated the same way
 * (the registry, the desk's own switch, the opt-out ledger in server/outbound.ts), but carrying its
 * own purpose, so it is labelled and recorded as a chase or an escalation and never as a customer
 * `service_reply` (`outboundLabelFor`). It goes on WhatsApp as the approved template through Twilio,
 * the transport whose content SID the live sync holds; nothing else can carry a template.
 * Refuses: no approver or run id; no address; a template the live sync has not approved (never
 * freeform); a run id already used on the file; a live delivery that fails, which spends nothing.
 * Nothing lands on the thread, because the recipient is not a party on the file; the caller keeps
 * the record (server/comms-v2/service/chase.ts). The run id is still spent on the file so one run id
 * sends once.
 */
export async function initiate(input: InitiateInput, deps: InitiateDeps = {}): Promise<InitiateOutcome> {
    const now = deps.now ?? (() => new Date());
    if (!input.approver?.trim()) return { ok: false, reason: 'no approver' };
    if (!input.runId?.trim()) return { ok: false, reason: 'no run id' };
    if (!input.to.address?.trim()) return { ok: false, reason: `no address for the ${input.purpose === 'approver_chase' ? 'approver' : 'owner'}: the chase has nowhere to go` };
    if (input.file.sentRunIds.includes(input.runId)) return { ok: false, reason: `run ${input.runId} has already sent` };
    const live = await (deps.templates ?? liveTemplateStatus).approved(input.template.name);
    if (!live) return { ok: false, reason: `template ${input.template.name} is not approved; a desk-started send is template only, never freeform` };
    const body = input.template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => input.template.variables[n] ?? '');
    const template: TemplateSend = { name: input.template.name, language: input.template.language, contentSid: live.contentSid, variables: input.template.variables };
    let sid: string | null = null;
    let label = outboundLabelFor(input.purpose);
    if (input.mode === 'live') {
        const delivered = await (deps.deliverer ?? liveDeliverer).deliver({ to: input.to.address, channel: 'whatsapp', transport: 'twilio', bubbles: [{ text: body, gapMs: 0 }], template, runId: input.runId, approver: input.approver, purpose: input.purpose });
        label = delivered.label ?? label;
        if (!delivered.ok) {
            if (delivered.delivered.length) input.file.sentRunIds.push(input.runId);
            return { ok: false, reason: delivered.reason, label };
        }
        sid = delivered.sid;
    }
    input.file.sentRunIds.push(input.runId);
    return { ok: true, send: { runId: input.runId, approver: input.approver, purpose: input.purpose, to: { address: input.to.address, name: input.to.name }, templateId: template.name, contentSid: template.contentSid, body, sid, at: now().toISOString(), mode: input.mode, label } };
}
