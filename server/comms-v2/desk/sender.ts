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
 * own authority and no verdicts (behaviour.md answer 43); a shut window never produces freeform
 * text on any channel; one of the four fixed lines that are Ben's to review sends in dry run only
 * until he has.
 *
 * A template is named by the registry (server/window-templates.ts) and approved by the live sync
 * (server/whatsapp-template-sync.ts), which also holds Twilio's content SID for it. The wire shape
 * follows the transport the customer wrote on: Twilio takes the content SID and variables, Meta
 * takes the name, language and body components.
 */
import { appendTurn, recordSend, partyOf, type CaseFile, type ModelCallRecord, type Party, type RenderedBubble, type ReplyChannel, type SendRecord, type CaseFileDeps, type WhatsAppTransport } from './case-file';
import { KB_BACKED, type FixedLine } from './fixed-lines';
import type { GuardOutcome } from './guards';
import { isHumanApprover, type Approver } from '../../approver';
import { emailThreadingFor, renderEmail, type EmailThreading } from '../channels/email-adapter';
import { renderSms, smsCost, smsSegmentCount, SMS_MAX_SEGMENTS, GSM7_MULTI, UCS2_MULTI } from '../channels/sms-adapter';
import type { ChannelReplyPurpose } from '../channels/templates';

export const WINDOW_HOURS = 24;
export const BUBBLE_MAX_CHARS = 300;
export const BUBBLE_CEILING = 4;
export const GAP_MIN_MS = 1000;
export const GAP_MAX_MS = 3000;

/** The desk's own approver name for an unattended send: `agent.comms_v2` in server/sender-registry.ts, switch key `comms_v2`. */
export const DESK_APPROVER: Approver = 'agent.comms_v2';

export type ReplyPurpose = 'service_reply' | ChannelReplyPurpose;

// ---------------------------------------------------------------- choose_channel

export type ChannelChoice = { ok: true; channel: ReplyChannel; address: string } | { ok: false; reason: string };

/**
 * The channel the party wrote on; for a form or a call, WhatsApp if the number is on it, then SMS,
 * then email. An SMS from a party whose WhatsApp window is open is answered on WhatsApp (the
 * design's "if a known customer also has WhatsApp, prefer it"), never on a shut one.
 */
export function chooseChannel(party: Party, wroteOn: Party['channels'][number]['kind'] | null, now: Date = new Date()): ChannelChoice {
    const carry = (kind: ReplyChannel) => party.channels.find((c) => c.kind === kind);
    if (wroteOn === 'sms' && carry('whatsapp') && windowOf(party, 'whatsapp', now).state === 'open') return { ok: true, channel: 'whatsapp', address: carry('whatsapp')!.address };
    if (wroteOn === 'whatsapp' || wroteOn === 'sms' || wroteOn === 'email') {
        const c = carry(wroteOn);
        if (c) return { ok: true, channel: wroteOn, address: c.address };
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

export type RenderResult = { ok: true; bubbles: RenderedBubble[] } | { ok: false; reason: 'ceiling' | 'empty' | 'channel'; bubbles: RenderedBubble[] };

function typingGap(text: string): number {
    return Math.max(GAP_MIN_MS, Math.min(GAP_MAX_MS, Math.round(GAP_MIN_MS + text.length * 8)));
}

/** Split one bubble that is too long at sentence boundaries; a single sentence over the limit stays whole (never cut mid-sentence). */
function splitLong(text: string): string[] {
    if (text.length <= BUBBLE_MAX_CHARS) return [text];
    const sentences = text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const s of sentences) {
        if (!cur) { cur = s; continue; }
        if ((cur + ' ' + s).length <= BUBBLE_MAX_CHARS) cur = `${cur} ${s}`;
        else { out.push(cur); cur = s; }
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
}

/**
 * WhatsApp: the one reply split into bubbles at the breaks a person would use: the composer's
 * blank lines first, then sentence boundaries for anything over about three hundred characters.
 * Typing gaps of one to three seconds scaled to length. A ceiling reached returns the reply to
 * the composer to shorten rather than sending a wall. `asTyped` is the human path: blank lines
 * still break bubbles, nothing inside one is reflowed.
 */
export function renderWhatsApp(reply: string, opts: RenderOptions = {}): RenderResult {
    const paragraphs = reply.replace(/\r\n/g, '\n').split(/\n\s*\n+/)
        .map((p) => opts.asTyped ? p.split('\n').map((l) => l.trimEnd()).join('\n').trim() : p.replace(/\s*\n\s*/g, ' ').trim())
        .filter(Boolean);
    const texts = opts.asTyped ? paragraphs : paragraphs.flatMap(splitLong);
    const bubbles = texts.map((text) => ({ text, gapMs: typingGap(text) }));
    if (!bubbles.length) return { ok: false, reason: 'empty', bubbles };
    if (bubbles.length > BUBBLE_CEILING) return { ok: false, reason: 'ceiling', bubbles };
    return { ok: true, bubbles };
}

/** Per channel: WhatsApp bubbles; SMS one message of at most two segments; email a letter with a greeting and a sign-off (channels/). */
export function render(channel: ReplyChannel, reply: string, opts: RenderOptions & { name?: string | null } = {}): RenderResult {
    if (channel === 'whatsapp') return renderWhatsApp(reply, opts);
    if (channel === 'sms') return renderSms(reply);
    if (channel === 'email') return renderEmail(reply, opts);
    return { ok: false, reason: 'channel', bubbles: [] };
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
};

/** The rows of the one registry (server/window-templates.ts) that carry a reply of this purpose. */
export function templateRowsFor<T extends { purpose: string; trigger: { id: string } }>(purpose: ReplyPurpose, registry: readonly T[]): T[] {
    return registry.filter((t) => t.purpose === 'service_reply' && TRIGGERS_FOR_PURPOSE[purpose].includes(t.trigger.id));
}

/** The variables a template body takes: {{1}} the first name or 'there', {{2}} the topic, {{3}} 'shortly' (the web form's "a quick call {{3}}"). */
export function templateVariables(body: string, vars: { name: string | null; topic: string }): Record<string, string> {
    const first = (vars.name ?? '').trim().split(/\s+/)[0] || 'there';
    const out: Record<string, string> = {};
    const re = /\{\{\s*(\d+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) out[m[1]] = m[1] === '1' ? first : m[1] === '2' ? vars.topic.slice(0, 120) : 'shortly';
    return out;
}

/** A template body with its variables filled in. */
export function fillTemplate(body: string, variables: Record<string, string>): string {
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => variables[n] ?? '');
}

/** The words a template of this purpose carries off WhatsApp, where no approval is needed: the best rung's body as one SMS or one email. Null when no row exists. */
export async function templateBodyFor(purpose: ReplyPurpose, vars: { name: string | null; topic: string }): Promise<{ name: string; body: string } | null> {
    const { WINDOW_TEMPLATES } = await import('../../window-templates');
    const t = templateRowsFor(purpose, WINDOW_TEMPLATES)[0];
    if (!t) return null;
    const rung = t.rungs[0];
    return { name: rung.name, body: fillTemplate(rung.body, templateVariables(rung.body, vars)) };
}

/** An approved template with everything either transport needs to carry it. */
export interface TemplateSend { name: string; language: string; contentSid: string; variables: Record<string, string> }

export type TemplatePick = { ok: true; template: TemplateSend; body: string } | { ok: false; reason: string };

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
export async function pickTemplate(purpose: ReplyPurpose, vars: { name: string | null; topic: string }, status: TemplateStatusSource = liveTemplateStatus): Promise<TemplatePick> {
    const { WINDOW_TEMPLATES } = await import('../../window-templates');
    for (const t of templateRowsFor(purpose, WINDOW_TEMPLATES)) for (const rung of t.rungs) {
        const live = await status.approved(rung.name);
        if (live) {
            const variables = templateVariables(rung.body, vars);
            return { ok: true, template: { name: rung.name, language: t.language, contentSid: live.contentSid, variables }, body: fillTemplate(rung.body, variables) };
        }
    }
    return { ok: false, reason: `no approved template for purpose ${purpose}; held as a pending draft for Ben` };
}

// ---------------------------------------------------------------- send

export interface Deliverer {
    deliver(input: { to: string; channel: ReplyChannel; transport: WhatsAppTransport; bubbles: RenderedBubble[]; template: TemplateSend | null; runId: string; approver: Approver; email?: EmailThreading }): Promise<DeliveryOutcome>;
}

/** A failure names the bubbles that had already reached the customer, so the file can record them. */
export type DeliveryOutcome = { ok: true; sid: string | null } | { ok: false; reason: string; delivered: RenderedBubble[] };

/**
 * The surviving outbound send. The registry gate inside it refuses an unknown or switched-off
 * approver; the desk adds one rule of its own on top: its switch is off until someone writes
 * `spine.senders.comms_v2.enabled = true`, because an absent switch is on for every other sender
 * and the new desk must not go live by default.
 */
export const liveDeliverer: Deliverer = {
    async deliver(input) {
        const delivered: RenderedBubble[] = [];
        const { registryEntryFor } = await import('../../sender-registry');
        const entry = registryEntryFor(input.approver);
        if (!entry) return { ok: false, reason: `approver ${input.approver} has no row in the sender registry; the live send is refused`, delivered };
        const { getSpineConfig } = await import('../../spine/config');
        const cfg = await getSpineConfig();
        if (!entry.switchKey || cfg.senders?.[entry.switchKey]?.enabled !== true) return { ok: false, reason: `spine.senders.${entry.switchKey}.enabled is not true; the new desk stays in the sandbox until it is`, delivered };
        if (input.channel !== 'whatsapp' && input.channel !== 'sms') return { ok: false, reason: `live delivery on ${input.channel} is refused: the one outbound send, which is the only path that checks the opt-out ledger, carries WhatsApp and SMS only`, delivered };
        const { sendCustomerMessage } = await import('../../outbound');
        let sid: string | null = null;
        for (const b of input.bubbles) {
            if (b.gapMs > 0) await new Promise((r) => setTimeout(r, b.gapMs));
            const res = await sendCustomerMessage({
                approver: input.approver, runId: input.runId, to: input.to, body: b.text, channel: input.channel, allowSmsFallback: false, purpose: 'service_reply', context: 'comms_v2',
                ...(input.template && input.channel === 'whatsapp' ? templateWire(input.transport, input.template) : {}),
                ...(input.channel === 'whatsapp' ? { via: input.transport } : {}),
            });
            if (!res.ok) return { ok: false, reason: res.error ?? res.reason ?? 'delivery failed', delivered };
            delivered.push(b);
            sid = res.sid ?? sid;
        }
        return { ok: true, sid };
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
    /** The verdicts on a composed reply. Null for a person's own words, which the guards never gate. */
    guards: GuardOutcome | null;
    factIds: string[];
    kbIds: string[];
    /** The fixed lines the reply carries; one of the four that are Ben's to review sends in dry run only until he has. */
    fixedLines: FixedLine[];
    calls: ModelCallRecord[];
    mode: 'dry_run' | 'live';
}

export type SendOutcome = { ok: true; record: SendRecord } | { ok: false; reason: string };

export interface SenderDeps extends CaseFileDeps {
    deliverer?: Deliverer;
}

/**
 * Delivers the rendered reply with an approver and a run id, then records the send on the file
 * with the facts it was written from. Refuses: no approver or run id; guards not passed on
 * anything but a person's own `human:` words; window shut and no template; the party not on the
 * file; a run id already sent; live, one of the four fixed lines Ben has not yet reviewed. A live
 * delivery that fails part way records the bubbles that went, marked partial, before the failure
 * is returned.
 */
export async function send(input: SendInput, deps: SenderDeps = {}): Promise<SendOutcome> {
    const now = deps.now ?? (() => new Date());
    if (!input.approver?.trim()) return { ok: false, reason: 'no approver' };
    if (!input.runId?.trim()) return { ok: false, reason: 'no run id' };
    if (!isHumanApprover(input.approver) && !input.guards?.ok) return { ok: false, reason: 'guards not passed' };
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
        const turn = appendTurn(input.file, { at, channel: input.channel, direction: 'outbound', partyId: input.partyId, kind: 'text', body: bubbles.map((b) => b.text).join('\n'), media: [], runId: input.runId, approver: input.approver }, deps);
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
        const delivered = await (deps.deliverer ?? liveDeliverer).deliver({ to: channel.address, channel: input.channel, transport: channel.transport ?? 'twilio', bubbles: input.bubbles, template: input.template, runId: input.runId, approver: input.approver, ...(input.channel === 'email' ? { email: emailThreadingFor(channel) } : {}) });
        if (!delivered.ok) {
            if (delivered.delivered.length) land(delivered.delivered, true);
            return { ok: false, reason: delivered.reason };
        }
    }
    return land(input.bubbles, false);
}

/** A desk-started send, template only, for chasing an approver or a maintenance reminder. Unused in Goal 1; exists so the landlord service can attach without a new exit. */
export async function initiate(_input: { file: CaseFile; partyId: string; purpose: ReplyPurpose; runId: string; approver: Approver }): Promise<SendOutcome> {
    return { ok: false, reason: 'initiate is not used in Goal 1: the homeowner desk never starts a thread' };
}
