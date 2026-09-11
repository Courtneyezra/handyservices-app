/**
 * Contract 5 - Sender and bubble rules. The only exit. Chooses the channel per party, renders
 * for it, respects the window, picks a template when the window is shut, and records the send.
 *
 * Dry run (the sandbox, the judge) runs everything up to delivery for real and then lands the
 * planned reply on the case file's thread as an outbound turn, so later turns see it. Live
 * delivery goes through the surviving outbound send (server/outbound.ts) whose registry gate
 * refuses an approver it does not know; the desk's approver gets its registry row at cutover.
 *
 * Invariants: one run id sends once; every send has an approver; nothing reaches a customer that
 * did not pass the guards; a shut window never produces freeform text on any channel.
 */
import { appendTurn, recordSend, partyOf, type CaseFile, type ModelCallRecord, type Party, type RenderedBubble, type ReplyChannel, type SendRecord, type CaseFileDeps } from './case-file';
import type { GuardOutcome } from './guards';

export const WINDOW_HOURS = 24;
export const BUBBLE_MAX_CHARS = 300;
export const BUBBLE_CEILING = 4;
export const GAP_MIN_MS = 1000;
export const GAP_MAX_MS = 3000;

/** The desk's own approver name for an unattended send. Needs a row in server/sender-registry.ts at cutover; until then the live gate refuses it, which is the point. */
export const DESK_APPROVER = 'agent.comms_v2';

export type ReplyPurpose = 'service_reply';

// ---------------------------------------------------------------- choose_channel

export type ChannelChoice = { ok: true; channel: ReplyChannel; address: string } | { ok: false; reason: string };

/** The channel the party wrote on; for a form or a call, WhatsApp if the number is on it, then SMS, then email. */
export function chooseChannel(party: Party, wroteOn: Party['channels'][number]['kind'] | null): ChannelChoice {
    const carry = (kind: ReplyChannel) => party.channels.find((c) => c.kind === kind);
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

export type RenderResult = { ok: true; bubbles: RenderedBubble[] } | { ok: false; reason: 'ceiling' | 'empty'; bubbles: RenderedBubble[] };

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

/**
 * WhatsApp: the one reply split into bubbles at the breaks a person would use: the composer's
 * blank lines first, then sentence boundaries for anything over about three hundred characters.
 * Typing gaps of one to three seconds scaled to length. A ceiling reached returns the reply to
 * the composer to shorten rather than sending a wall.
 */
export function renderWhatsApp(reply: string): RenderResult {
    const paragraphs = reply.replace(/\r\n/g, '\n').split(/\n\s*\n+/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    const texts = paragraphs.flatMap(splitLong);
    const bubbles = texts.map((text) => ({ text, gapMs: typingGap(text) }));
    if (!bubbles.length) return { ok: false, reason: 'empty', bubbles };
    if (bubbles.length > BUBBLE_CEILING) return { ok: false, reason: 'ceiling', bubbles };
    return { ok: true, bubbles };
}

/** SMS: one message, two segments at most (306 GSM characters). */
export function renderSms(reply: string): RenderResult {
    const text = reply.replace(/\s*\n+\s*/g, ' ').trim();
    if (!text) return { ok: false, reason: 'empty', bubbles: [] };
    if (text.length > 306) return { ok: false, reason: 'ceiling', bubbles: [{ text, gapMs: 0 }] };
    return { ok: true, bubbles: [{ text, gapMs: 0 }] };
}

/** Email: greeting, body, sign-off, on the same thread. Goal 3 wires it; the shape exists so the exit has one render per channel. */
export function renderEmail(reply: string, name: string | null): RenderResult {
    const body = reply.trim();
    if (!body) return { ok: false, reason: 'empty', bubbles: [] };
    return { ok: true, bubbles: [{ text: `Hi ${name ?? 'there'},\n\n${body}\n\nBen`, gapMs: 0 }] };
}

export function render(channel: ReplyChannel, reply: string, party: Party): RenderResult {
    if (channel === 'whatsapp') return renderWhatsApp(reply);
    if (channel === 'sms') return renderSms(reply);
    return renderEmail(reply, party.name);
}

// ---------------------------------------------------------------- pick_template

export interface TemplateStatusSource {
    /** Whether Meta has approved this template name, from the live sync, never from the registry's own idea of itself. */
    approved(name: string): Promise<boolean>;
}

/** The live status from server/whatsapp-template-sync.ts, loaded on first use: it opens the database. */
export const liveTemplateStatus: TemplateStatusSource = {
    async approved(name) {
        try {
            const { findApprovedTemplate } = await import('../../whatsapp-template-sync');
            return !!(await findApprovedTemplate(name));
        } catch {
            return false;
        }
    },
};

export const noTemplateApproved: TemplateStatusSource = { async approved() { return false; } };

/** Which registry triggers carry a reply of each purpose. Branches on purpose, never on a name. */
const TRIGGERS_FOR_PURPOSE: Record<ReplyPurpose, readonly string[]> = { service_reply: ['question_unanswered'] };

export type TemplatePick = { ok: true; templateId: string; body: string; variables: Record<string, string> } | { ok: false; reason: string };

/** When the window is shut: one approved template for the reply's purpose from the registry. None approved: the reply is held as a pending draft for Ben. Never an SMS fallback. */
export async function pickTemplate(purpose: ReplyPurpose, vars: { name: string | null; topic: string }, status: TemplateStatusSource = liveTemplateStatus): Promise<TemplatePick> {
    const { WINDOW_TEMPLATES } = await import('../../window-templates');
    const candidates = WINDOW_TEMPLATES.filter((t) => t.purpose === purpose && TRIGGERS_FOR_PURPOSE[purpose].includes(t.trigger.id));
    for (const t of candidates) for (const name of t.names) {
        if (await status.approved(name)) {
            const variables = { '1': vars.name ?? 'there', '2': vars.topic.slice(0, 120) };
            return { ok: true, templateId: name, body: t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => variables[n as '1' | '2'] ?? ''), variables };
        }
    }
    return { ok: false, reason: `no approved template for purpose ${purpose}; held as a pending draft for Ben` };
}

// ---------------------------------------------------------------- send

export interface Deliverer {
    deliver(input: { to: string; channel: ReplyChannel; bubbles: RenderedBubble[]; templateId: string | null; runId: string; approver: string }): Promise<{ ok: true; sid: string | null } | { ok: false; reason: string }>;
}

/** The surviving outbound send. Its registry gate refuses an unregistered approver, which the desk's is until cutover. */
export const liveDeliverer: Deliverer = {
    async deliver(input) {
        const { registryEntryFor } = await import('../../sender-registry');
        if (!registryEntryFor(input.approver)) return { ok: false, reason: `approver ${input.approver} has no row in the sender registry; the live send is refused` };
        const { sendCustomerMessage } = await import('../../outbound');
        let sid: string | null = null;
        for (const b of input.bubbles) {
            if (b.gapMs > 0) await new Promise((r) => setTimeout(r, b.gapMs));
            const res = await sendCustomerMessage({ approver: input.approver as any, runId: input.runId, to: input.to, body: b.text, channel: input.channel === 'email' ? 'whatsapp' : input.channel, allowSmsFallback: false, purpose: 'service_reply', context: 'comms_v2' });
            if (!res.ok) return { ok: false, reason: res.error ?? res.reason ?? 'delivery failed' };
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
    templateId: string | null;
    runId: string;
    approver: string;
    guards: GuardOutcome | null;
    factIds: string[];
    kbIds: string[];
    calls: ModelCallRecord[];
    mode: 'dry_run' | 'live';
}

export type SendOutcome = { ok: true; record: SendRecord } | { ok: false; reason: string };

export interface SenderDeps extends CaseFileDeps {
    deliverer?: Deliverer;
}

/**
 * Delivers the rendered reply with an approver and a run id, then records the send on the file
 * with the facts it was written from. Refuses: no approver or run id; guards not passed; window
 * shut and no template; the party not on the file; a run id already sent.
 */
export async function send(input: SendInput, deps: SenderDeps = {}): Promise<SendOutcome> {
    const now = deps.now ?? (() => new Date());
    if (!input.approver?.trim()) return { ok: false, reason: 'no approver' };
    if (!input.runId?.trim()) return { ok: false, reason: 'no run id' };
    if (!input.guards || !input.guards.ok) return { ok: false, reason: 'guards not passed' };
    if (input.window.state === 'shut' && !input.templateId) return { ok: false, reason: 'window shut and no template' };
    const party = partyOf(input.file, input.partyId);
    if (!party) return { ok: false, reason: 'the party is not on the file' };
    if (input.file.sentRunIds.includes(input.runId)) return { ok: false, reason: `run ${input.runId} has already sent` };
    if (!input.bubbles.length) return { ok: false, reason: 'nothing to send' };
    const address = party.channels.find((c) => c.kind === input.channel)?.address;
    if (!address) return { ok: false, reason: `the party has no ${input.channel} address` };

    if (input.mode === 'live') {
        const delivered = await (deps.deliverer ?? liveDeliverer).deliver({ to: address, channel: input.channel, bubbles: input.bubbles, templateId: input.templateId, runId: input.runId, approver: input.approver });
        if (!delivered.ok) return { ok: false, reason: delivered.reason };
    }
    // In dry run and live alike the reply lands on the thread as an outbound turn, so later turns see it.
    // A reply is never dated before the turn it answers: a provider's own timestamp can run ahead of this clock.
    const last = input.file.turns[input.file.turns.length - 1];
    const at = new Date(Math.max(now().getTime(), last ? Date.parse(last.at) + 1 : 0)).toISOString();
    const turn = appendTurn(input.file, { at, channel: input.channel, direction: 'outbound', partyId: input.partyId, kind: 'text', body: input.bubbles.map((b) => b.text).join('\n'), media: [], runId: input.runId, approver: input.approver }, deps);
    if (!turn.ok) return { ok: false, reason: turn.reason };
    const record: SendRecord = {
        runId: input.runId, approver: input.approver, partyId: input.partyId, channel: input.channel, windowState: input.window.state, templateId: input.templateId,
        bubbles: input.bubbles, factIds: input.factIds, kbIds: input.kbIds, calls: input.calls, at: turn.value.at, mode: input.mode, turnId: turn.value.id,
    };
    const rec = recordSend(input.file, record);
    if (!rec.ok) return { ok: false, reason: rec.reason };
    return { ok: true, record };
}

/** A desk-started send, template only, for chasing an approver or a maintenance reminder. Unused in Goal 1; exists so the landlord service can attach without a new exit. */
export async function initiate(_input: { file: CaseFile; partyId: string; purpose: ReplyPurpose; runId: string; approver: string }): Promise<SendOutcome> {
    return { ok: false, reason: 'initiate is not used in Goal 1: the homeowner desk never starts a thread' };
}
