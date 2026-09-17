/**
 * message.send: a message to a customer that Ben asked the Handy Desk to write and send (ask-agent
 * specification N6 and N7; answers A2, A3 and A6). The words are the writing model's, from Ben's
 * brief, and are fixed in the proposal; one proposal carries exactly one message (A6, "One each").
 *
 * Who it goes to: the customer on a named case file, or a person by their address. For an address,
 * identity is read, never guessed: an address two people share is refused (pick one first), one of
 * ours is refused, and a person with a file open has the message land on it. Anyone else gets a new
 * file, opened by the confirm and not before (desk/case-file.ts `openForPerson`).
 *
 * Where and how: desk/person-send.ts `planPersonSend`. A reply on the thread the customer wrote on
 * goes through the board's own reply path (`humanReply`); otherwise the words go on the channel
 * wanted, and a shut WhatsApp window takes an approved template that is true for the thread, else a
 * text (A3, "Yes, with fallback"). The preview tile names the channel, the window and any fallback,
 * so nothing changes channel silently.
 *
 * The words are composed, so every guard runs over them (answer 43), as the person's action. The one
 * difference is Ben's instruction (A2, "His instruction counts as a source"): the words he gave in
 * his ask, cited as an `instruction` fact, let the date/time and commitment guards pass a claim that
 * the instruction says word for word, and the preview says so ("'this afternoon' is from your
 * instruction"). Nothing else is relaxed: a figure still needs a quote line (answer 23), so a
 * message with any figure in it is refused, and a claim the instruction does not say is refused.
 * On the send the instruction is recorded on the file as that fact (`ben_instruction`, kept out of
 * the desk's own replies), and the send record cites it.
 *
 * Sent as `human:<person>` under the confirm's run id. A thread kept with a person may still be
 * written on: it is a person's send on Ben's confirm.
 */
import type { OpsOutgoing } from '@shared/ops-types';
import { canonical, e164Of, type Person } from '../../desk/identity';
import {
    openForPerson, recordFact, sameApprover, approverLabel,
    type CaseFile, type Fact, type OpenForPersonInput, type Party, type ReplyChannel, type Turn,
} from '../../desk/case-file';
import { approverFor, instructedClaims, noReplyToCheck, runGuards, type GuardInput, type GuardOutcome } from '../../desk/guards';
import { renderPersonWords } from '../../desk/human-reply';
import { planPersonSend, personSend, type PersonSendPlan } from '../../desk/person-send';
import { liveTemplateStatus, windowOf, type TemplateStatusSource } from '../../desk/sender';
import { withoutDashPunctuation } from '../../desk/dashes';
import type { ActionContext, ActionKindDef } from '../action-kinds';
import { PREVIEW_CHANGED } from '../actions';

/** Ben's words the message relays: who said them, the ask they were said in, verbatim. */
export interface MessageInstruction { person: string; askMessageId: string; quote: string }

export interface MessageSendArgs {
    /** The file the message goes on; null when it goes to `to`. */
    caseFileId: string | null;
    /** A person by address (E.164 or email), and their name as the record gives it; null when `caseFileId` names the file. */
    to: { address: string; name: string | null } | null;
    /** The channel Ben asked for; null for the customer's own. */
    channel: ReplyChannel | null;
    /** The message, exactly as it would go. */
    words: string;
    instruction: MessageInstruction | null;
}

/** The fact key Ben's instruction is recorded under (desk/case-file.ts INTERNAL_FACT_KEYS: never a desk reply's source). */
export const INSTRUCTION_FACT_KEY = 'ben_instruction';
const PREVIEW_FACT_ID = 'fact_instruction_preview';
const NEW_FILE_ID = 'case_new';
const CHANNELS: readonly ReplyChannel[] = ['whatsapp', 'sms', 'email'];
const WIRE_CHANNEL = { whatsapp: 'wa', sms: 'sms', email: 'email' } as const;
const MAX_WORDS_CHARS = 1500;

const text = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function parseMessageSendArgs(raw: unknown): MessageSendArgs | null {
    const r = (raw ?? {}) as Record<string, any>;
    const caseFileId = text(r.caseFileId, 200);
    const address = text(r.to?.address, 200);
    if (!caseFileId === !address) return null;
    const words = typeof r.words === 'string' ? withoutDashPunctuation(r.words.replace(/\r\n/g, '\n')).trim() : '';
    if (!words || words.length > MAX_WORDS_CHARS) return null;
    const channel = r.channel == null ? null : CHANNELS.includes(r.channel) ? (r.channel as ReplyChannel) : undefined;
    if (channel === undefined) return null;
    let instruction: MessageInstruction | null = null;
    if (r.instruction != null) {
        const person = text(r.instruction.person, 320);
        const askMessageId = text(r.instruction.askMessageId, 200);
        const quote = text(r.instruction.quote, 1000);
        if (!person || !askMessageId || !quote) return null;
        instruction = { person, askMessageId, quote };
    }
    return {
        caseFileId,
        to: address ? { address, name: text(r.to?.name, 200) } : null,
        channel,
        words,
        instruction,
    };
}

type Target =
    | { ok: true; file: CaseFile; opened: null }
    /** Nobody has a file open: the confirm opens this one. `person` is who identity already knows, if anyone. */
    | { ok: true; file: CaseFile; opened: { person: Person | null; open: Omit<OpenForPersonInput, 'identity' | 'by'> } }
    | { ok: false; reason: string };

/** The channels a person with no file can be reached on, from their address alone: a number takes WhatsApp and SMS, an email address email. */
function channelsFor(address: string): OpenForPersonInput['channels'] | null {
    const key = canonical(address);
    if (!key) return null;
    if (key.startsWith('email:')) return [{ kind: 'email', address: key.slice('email:'.length) }];
    const e164 = e164Of(key);
    return e164 ? [{ kind: 'whatsapp', address: e164 }, { kind: 'sms', address: e164 }] : null;
}

/** Who the message goes to, read without changing anything. */
function targetOf(ctx: ActionContext, args: MessageSendArgs): Target {
    if (args.caseFileId) return ctx.file ? { ok: true, file: ctx.file, opened: null } : { ok: false, reason: 'no such case file' };
    const to = args.to!;
    const key = canonical(to.address);
    if (!key) return { ok: false, reason: `${to.address} is not a phone number or an email address` };
    const identity = ctx.src.identity;
    if (!identity) return { ok: false, reason: 'this desk cannot look people up, so a message can only go on an open case file' };
    const people = Array.from(new Map(identity.directory.byKey(key).map((p) => [p.id, p])).values());
    if (people.length > 1) return { ok: false, reason: `${to.address} belongs to ${people.length} people on the desk; pick the case file to write on` };
    const person = people[0] ?? null;
    if (person?.role === 'internal') return { ok: false, reason: `${to.address} is one of the business's own numbers, not a customer` };
    if (person) {
        const file = ctx.src.store.findOpenFor(person.id);
        if (file) {
            const owner = file.hold?.approver ?? approverFor(file, null);
            if (!sameApprover(owner, ctx.approver)) return { ok: false, reason: `only ${approverLabel(owner)} may message on this file` };
            return { ok: true, file, opened: null };
        }
    }
    const channels = channelsFor(to.address);
    if (!channels) return { ok: false, reason: `${to.address} is not an address a message can go to` };
    const name = to.name ?? person?.name ?? null;
    const draft = openForPerson({
        identity: { ok: true, personId: person?.id ?? 'person_new', customerId: person?.customerId ?? null, role: person?.role ?? 'homeowner', isNew: !person, canonical: key, propertyId: null, landlordId: null, name },
        channels, by: `human:${ctx.person}`,
    }, { now: () => ctx.now, newId: () => NEW_FILE_ID });
    if (!draft.ok) return { ok: false, reason: draft.reason };
    return { ok: true, file: draft.value, opened: { person, open: { channels } } };
}

function instructionFact(i: MessageInstruction, id: string, at: Date, by: string): Fact {
    return { id, key: INSTRUCTION_FACT_KEY, value: i.quote, source: { kind: 'instruction', person: i.person, askMessageId: i.askMessageId, quote: i.quote }, at: at.toISOString(), by };
}

export interface MessageCheck { guards: GuardOutcome; instructed: string[]; factIds: string[] }

/**
 * Every guard over the words, as a person's action, with Ben's instruction cited when there is one
 * (the fact is looked at on a copy of the file; nothing is written). `turn` is the customer's newest
 * turn, or none when they have not written.
 */
export function checkMessageWords(input: { file: CaseFile; party: Party; turn: Turn | null; channel: ReplyChannel; words: string; instruction: MessageInstruction | null; now: Date; factId?: string }): MessageCheck {
    const factId = input.factId ?? PREVIEW_FACT_ID;
    const fact = input.instruction ? instructionFact(input.instruction, factId, input.now, `human:${input.instruction.person}`) : null;
    const file: CaseFile = fact ? { ...input.file, facts: [...input.file.facts, fact] } : input.file;
    const turn: Turn = input.turn ?? { id: 'turn_none', at: input.now.toISOString(), channel: input.channel, direction: 'inbound', partyId: input.party.personId, kind: 'text', body: '', media: [], runId: null, approver: null };
    const ids = fact ? [fact.id] : [];
    const guardInput: GuardInput = {
        file, party: input.party, turn, reply: input.words, factIds: ids, kbIds: [], kbRows: [], fixedLines: [], lookedUp: ids,
        proposedSubject: null, prompted: 'human_action', liveQuoteRefs: new Set<string>(),
    };
    return { guards: runGuards(guardInput), instructed: instructedClaims(guardInput), factIds: ids };
}

type Prepared =
    | { ok: true; target: Extract<Target, { ok: true }>; plan: Extract<PersonSendPlan, { ok: true }>; check: MessageCheck | null; text: string; outgoing: OpsOutgoing[] }
    | { ok: false; reason: string };

async function prepare(ctx: ActionContext, args: MessageSendArgs, templates: TemplateStatusSource, factId?: string): Promise<Prepared> {
    const target = targetOf(ctx, args);
    if (!target.ok) return target;
    const plan = await planPersonSend({ file: target.file, approver: ctx.approver, person: ctx.person, channel: args.channel, now: ctx.now }, templates);
    if (!plan.ok) return plan;

    let check: MessageCheck | null = null;
    let words = args.words;
    const notes: string[] = [];
    if (plan.how === 'template') {
        words = plan.template!.body;
    } else {
        check = checkMessageWords({ file: target.file, party: plan.party, turn: plan.turn, channel: plan.channel, words, instruction: args.instruction, now: ctx.now, factId });
        if (!check.guards.ok) return { ok: false, reason: `the message did not pass the desk's guards: ${check.guards.failures.join('; ')}` };
        const rendered = renderPersonWords(plan.channel, words, { name: plan.party.name, deskDraft: true });
        if (!rendered.ok) return rendered;
        notes.push(...check.instructed.map((c) => `'${c}' is from your instruction`));
    }
    if (plan.note) notes.push(plan.note);
    if (target.opened) notes.push(`${plan.party.name ?? 'This customer'} has no case file open, so sending opens one`);

    const shownWindow = plan.fallback ? windowOf(plan.party, 'whatsapp', ctx.now) : plan.window;
    const tile: OpsOutgoing = {
        to: plan.address,
        channel: WIRE_CHANNEL[plan.channel],
        text: words,
        window: { state: shownWindow.state, until: shownWindow.opensUntil, reason: shownWindow.reason },
        ...(notes.length ? { guardNote: notes.join('. ') } : {}),
    };
    return { ok: true, target, plan, check, text: words, outgoing: [tile] };
}

export function messageSendKind(opts: { templates?: TemplateStatusSource } = {}): ActionKindDef<MessageSendArgs> {
    const templates = opts.templates ?? liveTemplateStatus;
    return {
        kind: 'message.send',
        label: 'Send this',
        sends: true,
        parseArgs: parseMessageSendArgs,
        caseFileOf: (args) => args.caseFileId,
        async preconditions(ctx, args) {
            if (args.instruction && args.instruction.person !== ctx.person) return 'the instruction was given by someone else, so it cannot license this message';
            const target = targetOf(ctx, args);
            return target.ok ? null : target.reason;
        },
        async preview(ctx, args) {
            const p = await prepare(ctx, args, templates);
            return p.ok ? { ok: true, text: p.text, outgoing: p.outgoing } : p;
        },
        async execute(ctx, args) {
            const factId = args.instruction ? `fact_${ctx.runId.replace(/^run_/, '')}` : undefined;
            const p = await prepare(ctx, args, templates, factId);
            if (!p.ok) return p;
            if (p.text !== ctx.expectedPreview) return { ok: false, reason: PREVIEW_CHANGED };
            const approverName = ctx.approverName;

            let file = p.target.file;
            let plan = p.plan;
            if (p.target.opened) {
                // The file is opened now, on the person identity resolves the address to, and kept only if the message goes.
                const to = args.to!;
                const resolved = ctx.src.identity!.resolve(p.target.opened.open.channels[0].kind, to.address, { name: to.name });
                if (!resolved.ok) return { ok: false, reason: resolved.reason === 'candidates' ? `${to.address} now belongs to more than one person; pick the case file to write on` : resolved.detail };
                if (ctx.src.store.findOpenFor(resolved.personId)) return { ok: false, reason: PREVIEW_CHANGED };
                const opened = openForPerson({ identity: resolved, channels: p.target.opened.open.channels, by: approverName }, { now: () => ctx.now });
                if (!opened.ok) return opened;
                file = opened.value;
                const replanned = await planPersonSend({ file, approver: ctx.approver, person: ctx.person, channel: args.channel, now: ctx.now }, templates);
                if (!replanned.ok) return replanned;
                plan = replanned;
            }

            // A template's wording is approved, not composed: there were no words of the desk's to check.
            const checked = { guards: p.check?.guards ?? { ok: true, guards: noReplyToCheck(), failures: [] }, factIds: p.check?.factIds ?? [], calls: [] };
            // The send record may cite only facts on the file, so the instruction goes on first, and comes off again if nothing is sent.
            if (args.instruction && p.check?.factIds.length) {
                const fact = recordFact(file, { key: INSTRUCTION_FACT_KEY, value: args.instruction.quote, source: { kind: 'instruction', ...args.instruction }, by: approverName }, { now: () => ctx.now, newId: () => factId! });
                if (!fact.ok) return { ok: false, reason: `the instruction could not be recorded as a source: ${fact.reason}` };
            }
            const out = await personSend({ file, plan, words: args.words, approver: ctx.approver, person: ctx.person, runId: ctx.runId, mode: ctx.mode, checked }, { now: () => ctx.now, templates });
            if (!out.ok) {
                if (factId && !file.sends.some((s) => s.runId === ctx.runId)) file.facts = file.facts.filter((f) => f.id !== factId);
                return { ok: false, reason: out.reason };
            }
            // actions.ts puts back only a file the arguments name; one reached by address is put here.
            if (!args.caseFileId) ctx.src.store.put(file);
            return {
                ok: true,
                result: {
                    approver: out.result.approver, runId: out.result.runId, channel: out.result.channel, turnId: out.result.turnId,
                    bubbles: out.result.bubbles.map((b) => ({ text: b.text })), released: !!out.release,
                    caseFileId: file.id, opened: !!p.target.opened, how: plan.how, fallback: plan.fallback,
                },
            };
        },
    };
}

export const messageSend = messageSendKind();
