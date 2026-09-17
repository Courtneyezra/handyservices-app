/**
 * A message a person starts from the Handy Desk (ask-agent specification N6, answer A3 "Yes, with
 * fallback"): to a customer who has not written on this file, or on a channel other than the one
 * they wrote on, or whose WhatsApp window is shut. The ask agent's `message.send` confirm is the
 * only caller (server/comms-v2/ask/kinds/message-send.ts); nothing here is reached by the desk.
 *
 * `planPersonSend` decides where the message goes, and says so, before anything is sent:
 *   - a reply on the thread the customer wrote on, while that is the channel wanted and it can carry
 *     freeform words: the board's own reply path (`humanReply`), unchanged;
 *   - WhatsApp while its window is open, SMS, or email: the words as they are;
 *   - WhatsApp with its window shut: never freeform (Contract 5). An approved template, when one is
 *     true for the thread (answer 58, `planWindowTemplate`: the quote link that was sent, or a
 *     question nothing has answered), goes instead of the words; otherwise a text to the same
 *     number, when the customer has one. Either way the plan names the fallback and why, so the
 *     preview shows it and nothing changes channel silently. With neither, it refuses.
 *
 * `personSend` carries the plan out through the desk's one sender under `human:<person>` and the run
 * id it is given, with the guard verdicts and facts the words were checked against, and leaves on
 * the file what any person's send leaves (`afterPersonSend`). A text to a number the party is known
 * on only through WhatsApp adds an SMS channel for that number to the party first; it records no
 * inbound time, so it opens no window.
 */
import type { ApproverSlot, CaseFile, CaseFileDeps, ModelCallRecord, Party, ReplyChannel, Turn } from './case-file';
import { approverLabel, sameApprover } from './case-file';
import { approverFor, type GuardOutcome } from './guards';
import { e164Of } from './identity';
import { afterPersonSend, humanReply, planWindowTemplate, renderPersonWords, replyRouteOf, sendWindowTemplate, type HumanReplyOutcome } from './human-reply';
import { chooseChannel, liveTemplateStatus, send, windowOf, type SenderDeps, type TemplateStatusSource, type WindowState } from './sender';
import { humanApprover } from '../../approver';

/** How a planned message goes. */
export type PersonSendHow =
    /** The board's reply on the thread the customer wrote on. */
    | 'reply'
    /** The words, on a channel the customer has not written on, or with no customer turn to answer. */
    | 'freeform'
    /** An approved template instead of the words: the WhatsApp window is shut. */
    | 'template';

export type PersonSendPlan =
    | {
        ok: true;
        how: PersonSendHow;
        party: Party;
        channel: ReplyChannel;
        /** The address it goes to: E.164 for WhatsApp and SMS, the email address for email. */
        address: string;
        window: WindowState;
        /** What stood in for WhatsApp freeform because its window is shut; null when nothing did. */
        fallback: 'template' | 'sms' | null;
        /** Why the fallback was taken, for the preview. Null when there is none. */
        note: string | null;
        /** The template and its filled wording, when `how` is template. */
        template: { name: string; body: string } | null;
        /** The party has no channel of this kind yet; the send adds it for `address`. */
        addChannel: boolean;
        /** The customer's newest turn on the file; null when they have not written. */
        turn: Turn | null;
    }
    | { ok: false; reason: string };

export interface PlanPersonSendInput {
    file: CaseFile;
    approver: ApproverSlot;
    /** The signed-in person: their email or user id. */
    person: string;
    /** The channel the person asked for; the customer's reply channel, else the usual order, when absent. */
    channel?: ReplyChannel | null;
    now: Date;
}

/** The customer on the file: the first party who is not one of ours. */
function customerParty(file: CaseFile): Party | null {
    return file.parties.find((p) => p.role !== 'internal') ?? null;
}

function lastInbound(file: CaseFile, partyId: string): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId === partyId && t.direction === 'inbound') return t;
    }
    return null;
}

/** The number a text goes to: the party's SMS channel, else their phone key or WhatsApp number. */
function textAddress(party: Party): { address: string; add: boolean } | null {
    const sms = party.channels.find((c) => c.kind === 'sms');
    if (sms) return { address: sms.address, add: false };
    const fromKey = e164Of(party.canonical);
    if (fromKey) return { address: fromKey, add: true };
    const wa = party.channels.find((c) => c.kind === 'whatsapp');
    return wa && /^\+\d{8,15}$/.test(wa.address) ? { address: wa.address, add: true } : null;
}

const CHANNEL_NAME: Record<ReplyChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'email' };

/** Where a person's message would go and how, or why it cannot. Reads the file; changes nothing. */
export async function planPersonSend(input: PlanPersonSendInput, templates: TemplateStatusSource = liveTemplateStatus): Promise<PersonSendPlan> {
    const { file, approver, now } = input;
    const refuse = (reason: string): PersonSendPlan => ({ ok: false, reason });
    if (approver.kind !== 'human') return refuse('only a person sends from the Handy Desk; a rule-based approver has no words');
    const owner = file.hold?.approver ?? approverFor(file, null);
    if (!sameApprover(owner, approver)) return refuse(`only ${approverLabel(owner)} may message on this file`);
    if (file.stage === 'done') return refuse('the case file is done; message the customer by their number to open a new one');
    const party = customerParty(file);
    if (!party) return refuse('the file has no customer to message');
    const turn = lastInbound(file, party.personId);
    const reply = turn ? replyRouteOf(file, now) : null;

    let wanted = input.channel ?? null;
    if (!wanted) {
        if (reply?.ok) wanted = reply.channel;
        else {
            const choice = chooseChannel(party, null, now);
            if (!choice.ok) return refuse(choice.reason);
            wanted = choice.channel;
        }
    }
    const base = { ok: true as const, party, turn, template: null, addChannel: false, fallback: null, note: null };
    const asReply = (channel: ReplyChannel) => reply?.ok === true && reply.channel === channel;

    if (wanted === 'email') {
        const email = party.channels.find((c) => c.kind === 'email');
        if (!email) return refuse('there is no email address on file for this customer');
        return { ...base, how: asReply('email') ? 'reply' : 'freeform', channel: 'email', address: email.address, window: windowOf(party, 'email', now) };
    }

    if (wanted === 'sms') {
        const text = textAddress(party);
        if (!text) return refuse('there is no number on file to text');
        return { ...base, how: asReply('sms') ? 'reply' : 'freeform', channel: 'sms', address: text.address, window: windowOf(party, 'sms', now), addChannel: text.add };
    }

    const wa = party.channels.find((c) => c.kind === 'whatsapp');
    const window = windowOf(party, 'whatsapp', now);
    if (wa && window.state === 'open') return { ...base, how: asReply('whatsapp') ? 'reply' : 'freeform', channel: 'whatsapp', address: wa.address, window };

    // Shut: an approved template that is true for the thread, else a text, never freeform words.
    const shut = wa ? `the WhatsApp window is shut (${window.reason})` : 'the customer has no WhatsApp thread with us, so its window is shut';
    let noTemplate = 'no template is true for a thread the customer has not written on';
    if (wa && asReply('whatsapp')) {
        const t = await planWindowTemplate({ file, approver, person: input.person }, now, templates);
        if (t.ok) {
            return {
                ...base, how: 'template', channel: 'whatsapp', address: wa.address, window, fallback: 'template',
                note: `${shut}, so the approved template ${t.template.name} goes instead of these words`,
                template: { name: t.template.name, body: t.body },
            };
        }
        noTemplate = t.reason;
    }
    const text = textAddress(party);
    if (!text) return refuse(`${shut}; ${noTemplate}; and there is no number to text instead`);
    return {
        ...base, how: 'freeform', channel: 'sms', address: text.address, window: windowOf(party, 'sms', now), addChannel: text.add, fallback: 'sms',
        note: `${shut} and ${noTemplate.replace(/^no template/, 'no approved template')}, so this goes by ${CHANNEL_NAME.sms} to ${text.address} instead`,
    };
}

export interface PersonSendInput {
    file: CaseFile;
    plan: Extract<PersonSendPlan, { ok: true }>;
    /** The words, as the preview showed them; a template plan sends its own wording instead. */
    words: string;
    approver: ApproverSlot;
    person: string;
    runId: string;
    mode: 'dry_run' | 'live';
    /** What the words were checked against: every guard's verdict and the facts they cite. */
    checked: { guards: GuardOutcome; factIds: string[]; calls: ModelCallRecord[] };
}

/** Sends the planned message as the person, through the desk's one sender. Changes the file in place; the caller puts it back. */
export async function personSend(input: PersonSendInput, deps: SenderDeps & { templates?: TemplateStatusSource } = {}): Promise<HumanReplyOutcome> {
    const { file, plan, approver, person, runId, mode } = input;
    const refuse = (reason: string): HumanReplyOutcome => ({ ok: false, reason });
    if (!input.checked.guards.ok) return refuse(`the message did not pass the desk's guards: ${input.checked.guards.failures.join('; ')}`);
    if (plan.how === 'reply') return humanReply({ file, approver, person, words: input.words, mode, deskDraft: true, runId, checked: input.checked }, deps);
    if (plan.how === 'template') return sendWindowTemplate({ file, approver, person, mode, runId }, deps, deps.templates ?? liveTemplateStatus);

    const words = input.words.replace(/\r\n/g, '\n').trim();
    const rendered = renderPersonWords(plan.channel, words, { name: plan.party.name, deskDraft: true });
    if (!rendered.ok) return refuse(rendered.reason);
    const party = file.parties.find((p) => p.personId === plan.party.personId);
    if (!party) return refuse('the party is not on the file');
    const added = plan.addChannel && !party.channels.some((c) => c.kind === plan.channel);
    if (added) {
        if (file.parties.some((p) => p !== party && p.channels.some((c) => c.kind === plan.channel && c.address === plan.address))) return refuse(`another party on the file already has the ${plan.channel} address ${plan.address}`);
        party.channels.push({ kind: plan.channel, address: plan.address, lastInboundAt: null });
    }
    const approverName = humanApprover(person);
    const sent = await send({
        file, partyId: party.personId, channel: plan.channel, window: plan.window, bubbles: rendered.bubbles, template: null, runId, approver: approverName,
        guards: input.checked.guards, factIds: input.checked.factIds, kbIds: [], fixedLines: [], calls: input.checked.calls, mode,
    }, deps);
    if (!sent.ok) {
        // Nothing went: the channel added for it goes too, unless a partial delivery landed on it.
        if (added && !file.sends.some((r) => r.runId === runId)) party.channels = party.channels.filter((c) => !(c.kind === plan.channel && c.address === plan.address));
        return refuse(`send refused: ${sent.reason}`);
    }
    const release = afterPersonSend(file, party, approver, words, deps as CaseFileDeps);
    return { ok: true, result: { runId, approver: approverName, channel: plan.channel, bubbles: rendered.bubbles, turnId: sent.record.turnId }, release };
}
