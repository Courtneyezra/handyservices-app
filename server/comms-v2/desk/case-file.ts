/**
 * Contract 2 - Case file (docs/comms-v2/contracts.md).
 *
 * The job's folder. One per job, never per channel, with every party on it. It is the only state
 * specialists share; nothing passes between them any other way.
 *
 * Every call here is a pure function over the file's record: it returns a refusal or applies the
 * change in place. Turns are append only. A fact without a source is refused. The seven stages
 * move only through `setStage`. The ask ledger refuses a second ask of an unanswered subject and a
 * second thank; it is also where anything the desk does once per thread is recorded, so a second
 * attempt at it is refused by the same row (the missed-call acknowledgement, checklist 3.5). The hold is a flag, not a stage, released only with the approver's words. A send
 * carries a run id, an approver and the facts it was written from.
 */
import { randomUUID } from 'node:crypto';
import type { CanonicalKey, ChannelKind, ResolveResult, Role } from './identity';
import type { HoldException } from './router';
import type { ChaseRecord } from '../service/chase';

// ---------------------------------------------------------------- the record

export const STAGES = ['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done'] as const;
export type Stage = (typeof STAGES)[number];

/** The moves the seven stages allow: forward one step, back to scoping while nothing is quoted, and done from anywhere. */
export function stageMoveAllowed(from: Stage, to: Stage): boolean {
    if (from === to) return false;
    if (to === 'done') return true;
    const i = STAGES.indexOf(from);
    const j = STAGES.indexOf(to);
    if (j === i + 1) return true;
    if (to === 'scoping' && (from === 'ready')) return true;
    return false;
}

export type ReplyChannel = 'whatsapp' | 'sms' | 'email';
/** Which WhatsApp sender carries the thread: the Twilio number, or the coexistence number Meta serves directly. */
export type WhatsAppTransport = 'twilio' | 'meta';

/** The channels a customer writes on, so writing on one records it: a form and a call are neither written on nor replied to. */
const WRITTEN_ON_CHANNELS: ReadonlySet<ChannelKind> = new Set<ChannelKind>(['whatsapp', 'sms', 'email']);

export interface PartyChannel {
    kind: ChannelKind;
    /** The canonical address on the wire: E.164 for a phone channel, the lowercase email for email. */
    address: string;
    /**
     * When the customer last wrote on this channel, which is what makes it a channel they use rather
     * than one we can reach them on. Null: never. On WhatsApp it is also the 24-hour window clock.
     */
    lastInboundAt: string | null;
    /** WhatsApp only: the sender the customer last wrote to, so the reply goes back the same way. Null: not yet known, Twilio is assumed. */
    transport?: WhatsAppTransport | null;
    /** Email only: the thread the customer wrote on, so the reply stays on it (channels/email-adapter.ts). */
    thread?: { subject: string | null; messageId: string | null; references: string[] } | null;
}

export interface Party {
    personId: string;
    role: Role;
    name: string | null;
    canonical: CanonicalKey;
    channels: PartyChannel[];
    /** The party has said text only; the desk never offers a call again. */
    prefersText: boolean;
    /** The party has already rung us; "is it OK if we call" is never asked. */
    alreadyRung: boolean;
    /** A call has been offered to this party on this file. */
    callOffered: boolean;
}

export type TurnKind = 'text' | 'media' | 'call_transcript' | 'form' | 'portal_action' | 'system';
export type Direction = 'inbound' | 'outbound';

export interface TurnMedia {
    id: string;
    kind: 'image' | 'video';
    mime: string;
    /** Local path once downloaded; the adapter downloads on arrival. */
    path: string | null;
    url: string | null;
    /** Set once by describe_media. */
    description: MediaDescriptionRecord | null;
}

export interface MediaDescriptionRecord {
    kind: 'image' | 'video';
    description: string;
    confidence: 'low' | 'medium' | 'high';
    model: string;
    at: string;
}

export interface Turn {
    id: string;
    at: string;
    channel: ChannelKind;
    direction: Direction;
    partyId: string;
    kind: TurnKind;
    body: string;
    media: TurnMedia[];
    /** Outbound only. */
    runId: string | null;
    approver: string | null;
    /** Only on the desk's reading of a burst (desk/turn-window.ts): the ids of the messages it carries, oldest first. Never on a turn stored on the file. */
    burst?: string[];
    /**
     * Outbound only, on a reply the desk wrote to a customer turn: the ids of the messages that turn
     * carried (`messagesOf`). Absent on a person's own words and on a reply written before it was
     * recorded, which answer everything before them (`customerTurnUnanswered`).
     */
    answers?: string[];
    /**
     * Inbound call turns from the telephony intake only: the `calls` row the turn was made from.
     * The same call passed again (its transcript and summary landing after hang-up) fills in this
     * turn rather than adding one (channels/channel-gateway.ts `attachCall`).
     */
    callId?: string;
    /**
     * Inbound turns handed over by a durable intake only (the inbound email store,
     * channels/inbound-email-store.ts): the provider's delivery, such as `resend:<email id>`. A
     * delivery a file already holds is never landed again (channels/channel-gateway.ts).
     */
    deliveryId?: string;
    /**
     * Inbound only: the CRM client (service_clients.id) this turn's own address proved on a proven
     * channel (desk/identity.ts `resolveKnown`, answer 126). The customer's record is read for this
     * turn only when it carries one; a web-form or call turn, or one from a key linked only through a
     * form, never does, whatever an earlier turn of the same person proved.
     */
    customerId?: string | null;
    /**
     * A delivery's turn only: the desk run that returned a result on it, whatever it decided (a
     * reply, a hold, nothing). A delivery handed over again whose turn has neither this nor a reply
     * covering it (`coveredByReply`) goes to the desk again (channels/channel-gateway.ts).
     */
    handledBy?: string;
    /**
     * Inbound only: how many photos or videos the customer sent that never reached us (an MMS on
     * SMS, a download that failed), so the desk knows they tried rather than reading an empty turn.
     */
    mediaFailed?: number;
    /**
     * Inbound only: what the customer sent that the desk cannot open, as they would call it ("voice
     * note", "document"), one entry each, so it is not mistaken for a photo that failed to arrive.
     */
    unopened?: string[];
}

/** A turn's failure fields from an adapter's failures: photos and videos that did not arrive are counted, anything else is named. */
export function failedMediaFields(failures: ReadonlyArray<{ what?: string }>): Pick<Turn, 'mediaFailed' | 'unopened'> {
    const failed = failures.filter((f) => !f.what).length;
    const unopened = failures.flatMap((f) => (f.what ? [f.what] : []));
    return { ...(failed ? { mediaFailed: failed } : {}), ...(unopened.length ? { unopened } : {}) };
}

/**
 * How many of each kind a turn carried, as the thread shows it: "1 photo", "2 videos", "1 photo and
 * 1 video"; empty for none. A burst can carry both, and naming only the first kind told the router
 * and composer a video was a photo.
 */
export function mediaCountLabel(media: readonly Pick<TurnMedia, 'kind'>[]): string {
    return (['image', 'video'] as const).map((kind) => {
        const n = media.filter((m) => m.kind === kind).length;
        const noun = kind === 'image' ? 'photo' : 'video';
        return n ? `${n} ${noun}${n > 1 ? 's' : ''}` : '';
    }).filter(Boolean).join(' and ');
}

/** The thread's note for media a turn carried that never reached us or cannot be opened; empty when there was none. */
export function mediaFailedNote(turn: Turn): string {
    const n = turn.mediaFailed ?? 0;
    const notes = n > 0 ? [`[${n} photo${n > 1 ? 's or videos' : ' or video'} sent that did not reach us]`] : [];
    const kinds = Array.from(new Set(turn.unopened ?? []));
    if (kinds.length) {
        const counted = kinds.map((k) => { const c = turn.unopened!.filter((u) => u === k).length; return `${c} ${k}${c > 1 ? 's' : ''}`; });
        notes.push(`[${counted.join(' and ')} sent, which you cannot open]`);
    }
    return notes.join(' ');
}

/** The ids of the messages a turn the desk is answering carries: each message of a burst, or the turn itself. */
export function messagesOf(turn: Turn): string[] {
    return turn.burst ?? [turn.id];
}

/**
 * A quick run of customer messages the gateway is holding for the desk (desk/turn-window.ts), kept on
 * the file from the first message until the desk pass that reads them has finished. The quiet window
 * is timed in the gateway's memory, so this is what lets a clock pass tell a burst a live process is
 * still timing or answering from one a restart left behind (desk/gateway.ts `clock`).
 */
export interface TurnWait {
    partyId: string;
    channel: ChannelKind;
    /** The messages, oldest first. */
    turnIds: string[];
    /** When the burst goes to the desk if nothing more arrives: the newest message's arrival plus the quiet window. */
    dueAt: string;
    /** The gateway holding it, one per process; a wait any other gateway holds was left by a restart. */
    holder: string;
    /** When it was handed to the desk; null while it is still waiting for quiet. */
    handedAt: string | null;
}

/** Whether a turn on the file is part of the turn the desk is answering: that turn itself, or one message of a burst read as one turn. */
export function isTurnOf(t: Turn, turn: Turn): boolean {
    return turn.burst ? turn.burst.includes(t.id) : t.id === turn.id;
}

export type FactSource =
    | { kind: 'thread'; turnId: string }
    | { kind: 'quote_line'; quoteRef: string; line: string }
    | { kind: 'knowledge_base'; entryId: string }
    | { kind: 'customer_record'; customerId: string; field: string }
    | { kind: 'diary'; rowId: string }
    | { kind: 'media_description'; turnId: string; mediaId: string }
    | { kind: 'seed'; note: string }
    /**
     * What a person told the Handy Desk to say (answer A2, "His instruction counts as a source"):
     * who said it (their email or user id), the ask message it was said in, and the words, verbatim.
     * Like a diary read it counts only on the run that cited it (`isReadThisRunOnly`), and only the
     * date/time and commitment guards accept it; a figure still needs a quote line (answer 23).
     */
    | { kind: 'instruction'; person: string; askMessageId: string; quote: string };

export interface Fact {
    id: string;
    key: string;
    value: string;
    source: FactSource;
    at: string;
    by: string;
}

/** The subjects the desk asks a customer about. The ledger also carries one-per-thread markers that are not questions. */
export const ASK_SUBJECTS = ['media', 'postcode', 'access', 'handoff', 'job'] as const;
export type AskSubject = string;

export interface LedgerEntry {
    subject: AskSubject;
    askedAt: string | null;
    answeredAt: string | null;
    thankedAt: string | null;
    /** How many times the subject has been asked on this file, across every channel. */
    askCount: number;
}

export type ApproverSlot =
    | { kind: 'human'; id: string }
    /** A rule-based approver is a legal value from day one and has no rules until the landlord service attaches. */
    | { kind: 'rules'; id: string; then: { kind: 'human'; id: string } };

export interface Hold {
    approver: ApproverSlot;
    reason: string;
    /** The router exception that raised it, when one did: a fixed-line exception keeps the specialists off the thread until release. */
    exception: HoldException | null;
    since: string;
    /**
     * Whether a second reason has been added to the card since it was raised. A card one automatic
     * step raised is that step's to clear, but only while it still says what that step wrote: once
     * a customer's question has been added to it, clearing it would take the question with it, so
     * the card stands until the person it is for answers it.
     */
    notedOn: boolean;
    /** The draft and the failures when a guard hold raised it. */
    draft: string | null;
    failures: string[];
    /** Each time a graver reason took the hold over, oldest first: what it was held on, what it is held on now, and when it changed. */
    superseded: HoldSupersede[];
}

export interface HoldSupersede {
    from: { reason: string; exception: HoldException | null };
    to: { reason: string; exception: HoldException | null };
    at: string;
}

export interface HoldRelease {
    approver: ApproverSlot;
    words: string;
    at: string;
    reason: string;
    /** How many turns stood on the thread when the hold was released, so a rule can count what has happened since. Not a timestamp: the sandbox ages those. */
    turnsBefore: number;
    /** Each subject's ask count at the release, so a rule can count the asks since it without clearing the ledger. */
    asksBefore: Record<AskSubject, number>;
}

export interface Job {
    type: string | null;
    location: string | null;
    quoteRef: string | null;
    bookingRef: string | null;
}

export interface ModelCallRecord {
    role: 'router' | 'specialist' | 'composer' | 'vision';
    model: string;
    /** The effort the call was asked for; Haiku 4.5 has no effort control, so it is the intent only. */
    effort: 'low' | 'medium' | 'high' | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costPence: number | null;
    durationMs: number;
}

export interface RenderedBubble {
    text: string;
    /** The typing gap before this bubble, in milliseconds. */
    gapMs: number;
}

export interface SendRecord {
    runId: string;
    approver: string;
    partyId: string;
    channel: ReplyChannel;
    windowState: 'open' | 'shut';
    templateId: string | null;
    bubbles: RenderedBubble[];
    factIds: string[];
    kbIds: string[];
    /** Every model call behind this reply, so cost per thread is a number from day one. */
    calls: ModelCallRecord[];
    at: string;
    mode: 'dry_run' | 'live';
    /** Live delivery failed part way: `bubbles` are the ones that reached the customer. */
    partial: boolean;
    /** The outbound turn the send landed on the thread. */
    turnId: string | null;
}

export interface StageChange { from: Stage | null; to: Stage; at: string; why: string }

export interface CaseFile {
    id: string;
    openedAt: string;
    parties: Party[];
    turns: Turn[];
    stage: Stage;
    stageHistory: StageChange[];
    facts: Fact[];
    ledger: LedgerEntry[];
    hold: Hold | null;
    releases: HoldRelease[];
    /** How many turns stood on the thread when it was first found being scoped, so convergence counts only the replies since. Null until then. */
    scopingFrom: number | null;
    job: Job;
    sends: SendRecord[];
    /** Run ids that have been sent, so one run id sends once. */
    sentRunIds: string[];
    /** Ben's chase on the standing hold (service/chase.ts), kept with the file so a restart never chases again. Absent or null when nothing is being chased. */
    chase?: ChaseRecord | null;
    /** Bursts of customer messages the gateway is holding for the desk or has handed to it and not yet seen answered (`TurnWait`). Absent or empty when none. */
    waits?: TurnWait[];
    /** What a person changed on the file that is not a message (`SystemTurn`), oldest first. Absent or empty when none. */
    systemTurns?: SystemTurn[];
}

/**
 * The record of a change a person confirmed on the Handy Desk that sent nothing: a booking moved, a
 * call started (server/comms-v2/ask/actions.ts). A message a person confirmed is recorded as its
 * send, as any send is. Kept apart from `turns`, because every reply-order rule reads `turns` (who
 * wrote last, what a reply answered, the window) and a system line is none of those; the thread
 * surface shows the two together, in time order.
 */
export interface SystemTurn {
    id: string;
    at: string;
    kind: 'system';
    /** What happened, in one line, naming who did it. */
    body: string;
    /** `human:<email or user id>`: the person who confirmed it. */
    approver: string;
    /** The ask action it ran under (`comms_v2_ask_actions.id`). */
    actionId: string;
    runId: string;
}

export type Refusal = { ok: false; reason: string };
export type Outcome<T = void> = { ok: true; value: T } | Refusal;

const refuse = (reason: string): Refusal => ({ ok: false, reason });
const accept = <T>(value: T): Outcome<T> => ({ ok: true, value });

export type Clock = () => Date;

export interface CaseFileDeps {
    now?: Clock;
    newId?: (prefix: string) => string;
}

const defaultNewId = (prefix: string) => `${prefix}_${randomUUID()}`;

// ---------------------------------------------------------------- open

export interface OpenInput {
    identity: ResolveResult;
    channel: ChannelKind;
    address: string;
    firstTurn: Omit<Turn, 'id' | 'partyId' | 'direction' | 'runId' | 'approver'>;
}

/**
 * Creates a file from an identity result and the first turn, stage first contact. Refuses when
 * identity returned candidates rather than one person. The "already has an open file" refusal is
 * the store's (store.ts findOpenFor): a file cannot know about other files.
 */
export function open(input: OpenInput, deps: CaseFileDeps = {}): Outcome<CaseFile> {
    const now = deps.now ?? (() => new Date());
    const newId = deps.newId ?? defaultNewId;
    if (!input.identity.ok) return refuse(input.identity.reason === 'candidates' ? 'identity returned candidates; no file until a person picks one' : input.identity.detail);
    const id = input.identity;
    const at = now().toISOString();
    const party: Party = {
        personId: id.personId, role: id.role, name: id.name, canonical: id.canonical,
        channels: [{ kind: input.channel, address: input.address, lastInboundAt: WRITTEN_ON_CHANNELS.has(input.channel) ? input.firstTurn.at : null }],
        prefersText: false, alreadyRung: input.channel === 'call', callOffered: false,
    };
    const file: CaseFile = {
        id: newId('case'), openedAt: at, parties: [party], turns: [], stage: 'first_contact',
        stageHistory: [{ from: null, to: 'first_contact', at, why: 'opened' }],
        facts: [], ledger: [], hold: null, releases: [], scopingFrom: null, job: { type: null, location: null, quoteRef: null, bookingRef: null }, sends: [], sentRunIds: [],
    };
    const turn = appendTurn(file, { ...input.firstTurn, partyId: party.personId, direction: 'inbound', runId: null, approver: null }, deps);
    if (!turn.ok) return turn;
    return accept(file);
}

export interface OpenForPersonInput {
    /** The person identity resolved the address to; candidates are refused. */
    identity: ResolveResult;
    /** Where the person can be reached. None has been written on, so each has no inbound time. */
    channels: Array<Pick<PartyChannel, 'kind' | 'address'> & Partial<Pick<PartyChannel, 'transport'>>>;
    /** Who opened it, `human:<email or user id>`, recorded as the stage's why. */
    by: string;
}

/**
 * A file a person opens to write first (the Handy Desk's person-started message, ask-agent
 * specification N6): the party and their channels, stage first contact, and no turn, because
 * nobody has written yet. The send that follows is its first turn. A channel carries no inbound
 * time, so a WhatsApp window on it is shut until the customer writes. Refuses candidates, as `open`
 * does, and a person with no channel.
 */
export function openForPerson(input: OpenForPersonInput, deps: CaseFileDeps = {}): Outcome<CaseFile> {
    const now = deps.now ?? (() => new Date());
    const newId = deps.newId ?? defaultNewId;
    if (!input.identity.ok) return refuse(input.identity.reason === 'candidates' ? 'identity returned candidates; no file until a person picks one' : input.identity.detail);
    if (!input.channels.length) return refuse('the person has no channel to write on');
    const id = input.identity;
    const at = now().toISOString();
    const party: Party = {
        personId: id.personId, role: id.role, name: id.name, canonical: id.canonical,
        channels: input.channels.map((c) => ({ kind: c.kind, address: c.address, lastInboundAt: null, ...(c.transport ? { transport: c.transport } : {}) })),
        prefersText: false, alreadyRung: false, callOffered: false,
    };
    return accept({
        id: newId('case'), openedAt: at, parties: [party], turns: [], stage: 'first_contact',
        stageHistory: [{ from: null, to: 'first_contact', at, why: `opened by ${input.by} to write first` }],
        facts: [], ledger: [], hold: null, releases: [], scopingFrom: null, job: { type: null, location: null, quoteRef: null, bookingRef: null }, sends: [], sentRunIds: [],
    });
}

// ---------------------------------------------------------------- parties

export function partyOf(file: CaseFile, personId: string): Party | null {
    return file.parties.find((p) => p.personId === personId) ?? null;
}

/** Adds a party. Refuses when two parties would share a channel address. */
export function addParty(file: CaseFile, party: Party): Outcome<Party> {
    if (partyOf(file, party.personId)) return refuse('the party is already on the file');
    for (const existing of file.parties) for (const c of existing.channels) {
        if (party.channels.some((pc) => pc.kind === c.kind && pc.address === c.address)) return refuse(`two parties would share the ${c.kind} address`);
    }
    file.parties.push(party);
    return accept(party);
}

// ---------------------------------------------------------------- turns

/**
 * Adds a turn. Refuses when the party is not on the file or the turn is out of order. An inbound
 * WhatsApp turn opens the window on the party's WhatsApp channel; the channel itself is the
 * gateway's to put there from the address the turn proves, never invented from another channel's.
 */
export function appendTurn(file: CaseFile, turn: Omit<Turn, 'id'> & { id?: string }, deps: CaseFileDeps = {}): Outcome<Turn> {
    const newId = deps.newId ?? defaultNewId;
    const party = partyOf(file, turn.partyId);
    if (!party) return refuse('the party is not on the file');
    const last = file.turns[file.turns.length - 1];
    if (last && Date.parse(turn.at) < Date.parse(last.at)) return refuse('the turn is out of order');
    if (turn.direction === 'outbound' && (!turn.runId || !turn.approver)) return refuse('an outbound turn carries a run id and an approver');
    const t: Turn = { ...turn, id: turn.id ?? newId('turn') };
    file.turns.push(t);
    if (t.direction === 'inbound' && WRITTEN_ON_CHANNELS.has(t.channel)) {
        const ch = party.channels.find((c) => c.kind === t.channel);
        if (ch) ch.lastInboundAt = t.at;
    }
    return accept(t);
}

/** The newest turn, and whether the customer has written since the desk last replied to them. */
export function lastTurn(file: CaseFile): Turn | null {
    return file.turns[file.turns.length - 1] ?? null;
}

/**
 * Whether the party has written something the desk's replies to them have not answered: an inbound
 * turn after the newest turn any reply to them answered. A reply the desk wrote records the messages
 * it answered (`Turn.answers`), so a message that landed while that reply was being written - after
 * the turn it answers, before it was sent, so before it on the file - still counts; a reply with no
 * record (a person's own words, a reply written before the record) answers everything before it.
 * True when nothing has been sent to the party yet. The one-reply guard's question.
 */
export function customerTurnUnanswered(file: CaseFile, partyId: string): boolean {
    const upTo = answeredUpTo(file, partyId);
    return upTo === null || file.turns.some((t, i) => i > upTo && t.partyId === partyId && t.direction === 'inbound');
}

/** Whether the replies to the turn's party cover this turn, by `customerTurnUnanswered`'s position rule. */
export function coveredByReply(file: CaseFile, turn: Turn): boolean {
    const upTo = answeredUpTo(file, turn.partyId);
    return upTo !== null && file.turns.findIndex((t) => t.id === turn.id) <= upTo;
}

/** The position of the newest turn the replies to a party answer; null when nothing has been sent to them. */
function answeredUpTo(file: CaseFile, partyId: string): number | null {
    const index = new Map(file.turns.map((t, i) => [t.id, i]));
    let answeredTo: number | null = null;
    file.turns.forEach((t, i) => {
        if (t.partyId !== partyId || t.direction !== 'outbound') return;
        const upTo = t.answers ? Math.max(-1, ...t.answers.map((id) => index.get(id) ?? i)) : i;
        answeredTo = Math.max(answeredTo ?? -1, upTo);
    });
    return answeredTo;
}

/** Whether a reply on the file records answering this message (`Turn.answers`). */
export function answeredByReply(file: CaseFile, turnId: string): boolean {
    return file.turns.some((t) => t.direction === 'outbound' && !!t.answers?.includes(turnId));
}

// ---------------------------------------------------------------- stage

/** Moves the stage and records why. Refuses a move the seven do not allow, and ready without type and location. */
export function setStage(file: CaseFile, to: Stage, why: string, deps: CaseFileDeps = {}): Outcome<StageChange> {
    const now = deps.now ?? (() => new Date());
    if (!STAGES.includes(to)) return refuse(`${to} is not one of the seven stages`);
    if (!stageMoveAllowed(file.stage, to)) return refuse(`the move ${file.stage} -> ${to} is not one the seven allow`);
    if (to === 'ready' && !(file.job.type && file.job.location)) return refuse('ready needs the job type and the location');
    const change: StageChange = { from: file.stage, to, at: now().toISOString(), why };
    file.stage = to;
    file.stageHistory.push(change);
    return accept(change);
}

// ---------------------------------------------------------------- facts

const FIGURE_SOURCES: ReadonlySet<FactSource['kind']> = new Set<FactSource['kind']>(['quote_line', 'customer_record']);
const RE_FIGURE_VALUE = /£\s*\d|\b\d[\d,]*(?:\.\d+)?\s*(?:pounds?|quid|gbp)\b|\b\d+p\b/i;

/** Adds an established fact with its source. Refuses no source, and a figure whose source is not a live quote line or a customer record. */
export function recordFact(file: CaseFile, input: { key: string; value: string; source: FactSource | null | undefined; by: string }, deps: CaseFileDeps = {}): Outcome<Fact> {
    const now = deps.now ?? (() => new Date());
    const newId = deps.newId ?? defaultNewId;
    if (!input.source || !input.source.kind) return refuse('a fact without a source is refused');
    if (!input.key.trim() || !input.value.trim()) return refuse('a fact needs a key and a value');
    if (RE_FIGURE_VALUE.test(input.value) && !FIGURE_SOURCES.has(input.source.kind)) return refuse('a figure may only come from a live quote line or a customer record');
    const fact: Fact = { id: newId('fact'), key: input.key.trim(), value: input.value.trim(), source: input.source, at: now().toISOString(), by: input.by };
    file.facts.push(fact);
    if (fact.key === 'job_type') file.job.type = fact.value;
    if (fact.key === 'location') file.job.location = fact.value;
    const party = file.parties[0];
    if (party && fact.key === 'prefers_text' && /^(true|yes)$/i.test(fact.value)) party.prefersText = true;
    if (party && fact.key === 'already_rung' && /^(true|yes)$/i.test(fact.value)) party.alreadyRung = true;
    return accept(fact);
}

/**
 * Facts the desk writes for Ben, never for a customer: each carries an admin link, an internal note
 * or what he may want to request before pricing. They sit on the file like any other fact, so the
 * one place they are kept out of a customer reply is the composer boundary
 * (`customerVisibleFacts`). Any new fact written for Ben's eyes belongs in this list on the day it
 * is written.
 */
export const INTERNAL_FACT_KEYS: readonly string[] = ['ben_instruction', 'ben_notified', 'ben_chased', 'ben_to_request', 'quote_accepted', 'quote_drafting', 'quote_reissued'];

/** True when the fact was written for Ben, not for the customer. Matches the key and any `key:label` form. */
export function isInternalFact(fact: Pick<Fact, 'key'>): boolean {
    return INTERNAL_FACT_KEYS.some((k) => fact.key === k || fact.key.startsWith(`${k}:`));
}

/**
 * A quote figure the quote has moved on from. Facts are append-only, so when a line's amount changes
 * (the desk reissuing an expired quote at a new price, most often) the old `quote_line:<label>` fact
 * stays beside the new one; the newest for a key on a quote is that quote's current figure, and
 * only it is shown to the composer or accepted by the figure guard.
 */
export function isSupersededFigure(file: CaseFile, fact: Fact): boolean {
    if (fact.source.kind !== 'quote_line' || !fact.key.startsWith('quote_line:')) return false;
    const ref = fact.source.quoteRef;
    const at = file.facts.indexOf(fact);
    return file.facts.some((f, i) => i > at && f.key === fact.key && f.source.kind === 'quote_line' && f.source.quoteRef === ref);
}

/** The source field prefix of a fact read from the customer's CRM record (service/customer-record.ts). */
export const RECORD_READ_FIELD_PREFIX = 'crm:';

/**
 * A fact that is true only as of the read that wrote it: a diary date, anything read from the
 * customer's CRM record (an invoice's status and balance, a visit day), or a person's instruction on
 * the Handy Desk, which licenses the one message it was given for. The composer is shown one,
 * and the figure and date guards accept one, only when this run looked it up; one from an earlier
 * turn may have moved since (an invoice paid, a visit moved).
 */
export function isReadThisRunOnly(fact: Pick<Fact, 'source'>): boolean {
    return fact.source.kind === 'diary' || fact.source.kind === 'instruction' || (fact.source.kind === 'customer_record' && fact.source.field.startsWith(RECORD_READ_FIELD_PREFIX));
}

/** The facts a customer reply may be written from: everything on the file except Ben's own. */
export function customerVisibleFacts(file: CaseFile): Fact[] {
    return file.facts.filter((f) => !isInternalFact(f));
}

/** The newest fact for a key. */
export function factFor(file: CaseFile, key: string): Fact | null {
    for (let i = file.facts.length - 1; i >= 0; i--) if (file.facts[i].key === key) return file.facts[i];
    return null;
}

// ---------------------------------------------------------------- the ask ledger

export function ledgerEntry(file: CaseFile, subject: AskSubject): LedgerEntry | null {
    return file.ledger.find((l) => l.subject === subject) ?? null;
}

export function askedUnanswered(file: CaseFile, subject: AskSubject): boolean {
    const l = ledgerEntry(file, subject);
    return !!l && !!l.askedAt && !l.answeredAt;
}

export function everAsked(file: CaseFile, subject: AskSubject): boolean {
    return !!ledgerEntry(file, subject)?.askedAt;
}

/** Writes the ledger: asked. Refuses a subject already asked and unanswered. */
export function ask(file: CaseFile, subject: AskSubject, deps: CaseFileDeps = {}): Outcome<LedgerEntry> {
    const now = deps.now ?? (() => new Date());
    if (askedUnanswered(file, subject)) return refuse(`${subject} is already asked and unanswered`);
    let l = ledgerEntry(file, subject);
    if (!l) { l = { subject, askedAt: null, answeredAt: null, thankedAt: null, askCount: 0 }; file.ledger.push(l); }
    l.askedAt = now().toISOString();
    l.answeredAt = null;
    l.askCount += 1;
    return accept(l);
}

export function answered(file: CaseFile, subject: AskSubject, deps: CaseFileDeps = {}): Outcome<LedgerEntry> {
    const now = deps.now ?? (() => new Date());
    let l = ledgerEntry(file, subject);
    if (!l) { l = { subject, askedAt: null, answeredAt: null, thankedAt: null, askCount: 0 }; file.ledger.push(l); }
    l.answeredAt = now().toISOString();
    return accept(l);
}

/** Writes the ledger: thanked. Refuses a subject already thanked. */
export function thanked(file: CaseFile, subject: AskSubject, deps: CaseFileDeps = {}): Outcome<LedgerEntry> {
    const now = deps.now ?? (() => new Date());
    let l = ledgerEntry(file, subject);
    if (l?.thankedAt) return refuse(`${subject} is already thanked`);
    if (!l) { l = { subject, askedAt: null, answeredAt: null, thankedAt: null, askCount: 0 }; file.ledger.push(l); }
    l.thankedAt = now().toISOString();
    return accept(l);
}

// ---------------------------------------------------------------- the hold

export function approverLabel(slot: ApproverSlot): string {
    return slot.kind === 'human' ? slot.id : `rules:${slot.id}`;
}

export function sameApprover(a: ApproverSlot, b: ApproverSlot): boolean {
    return a.kind === b.kind && a.id === b.id;
}

/** Sets the hold with the approver. Refuses a second hold; the first stands until released. */
export function hold(file: CaseFile, input: { approver: ApproverSlot; reason: string; exception?: HoldException | null; draft?: string | null; failures?: string[] }, deps: CaseFileDeps = {}): Outcome<Hold> {
    const now = deps.now ?? (() => new Date());
    if (file.hold) return refuse(`the file is already held for ${approverLabel(file.hold.approver)}: ${file.hold.reason}`);
    if (!input.reason.trim()) return refuse('a hold needs a reason');
    file.hold = { approver: input.approver, reason: input.reason, exception: input.exception ?? null, since: now().toISOString(), notedOn: false, draft: input.draft ?? null, failures: input.failures ?? [], superseded: [] };
    return accept(file.hold);
}

/**
 * Takes a standing hold over with a graver reason, so one thread has one record of what it is
 * held on. The hold itself is not raised again: `since` stands, so the chase clock is not reset,
 * and the change is recorded on the hold for Ben's card. Refuses a file that is not held.
 */
export function supersede(file: CaseFile, input: { approver: ApproverSlot; reason: string; exception?: HoldException | null }, deps: CaseFileDeps = {}): Outcome<Hold> {
    const now = deps.now ?? (() => new Date());
    if (!file.hold) return refuse('the file is not held');
    if (!input.reason.trim()) return refuse('a hold needs a reason');
    const from = { reason: file.hold.reason, exception: file.hold.exception };
    const to = { reason: input.reason, exception: input.exception ?? null };
    file.hold = { ...file.hold, approver: input.approver, reason: to.reason, exception: to.exception, superseded: [...file.hold.superseded, { from, to, at: now().toISOString() }] };
    return accept(file.hold);
}

/**
 * What the desk nearly sent and what stopped it, written onto a hold that already stands. A hold
 * raised before the composer ran (an exception, a specialist) carries no draft, so the reply that
 * then failed the guards would otherwise be lost to the card Ben reads. The reason it was raised
 * for is never overwritten by another's: a later one is added after it.
 *
 * `ownCard` says the note is the desk's own automatic step speaking rather than another voice on
 * the card, and names the opening that step writes on every card it raises. Two things follow.
 * Where the standing card opens with it and nobody else has written on it since, the step is saying
 * the same card again with what stopped it this time, so its reason is replaced rather than a
 * near-duplicate added. Where it is not, the note is still that step's own - a shut window, no
 * approved template, a reply the guards refused - so it joins the card without marking it.
 *
 * Only a note with no `ownCard` marks the card as noted on, because that is a reason carrying
 * someone else's words: a customer's question routed onto the card. Clearing the card would take
 * that question with it, so from then on the card is nobody's to clear automatically and only the
 * person it is for may answer it.
 */
export function noteOnHold(file: CaseFile, input: { reason: string; draft?: string | null; failures?: string[]; ownCard?: string }): Outcome<Hold> {
    if (!file.hold) return refuse('the file is not held');
    const reason = input.reason.trim();
    const restating = !!input.ownCard && !file.hold.notedOn && file.hold.reason.startsWith(input.ownCard);
    if (reason && restating) file.hold.reason = reason;
    else if (reason && !file.hold.reason.includes(reason)) { file.hold.reason = `${file.hold.reason}; ${reason}`; if (!input.ownCard) file.hold.notedOn = true; }
    if (input.draft && !file.hold.draft) file.hold.draft = input.draft;
    if (input.failures?.length) file.hold.failures = Array.from(new Set([...file.hold.failures, ...input.failures]));
    return accept(file.hold);
}

/** Clears the hold. Refuses release without words, and by anyone other than the named approver. */
export function release(file: CaseFile, approver: ApproverSlot, words: string, deps: CaseFileDeps = {}): Outcome<HoldRelease> {
    const now = deps.now ?? (() => new Date());
    if (!file.hold) return refuse('the file is not held');
    if (!words.trim()) return refuse('release needs the approver\'s words');
    if (!sameApprover(file.hold.approver, approver)) return refuse(`only ${approverLabel(file.hold.approver)} may release this hold`);
    const rel: HoldRelease = { approver, words: words.trim(), at: now().toISOString(), reason: file.hold.reason, turnsBefore: file.turns.length, asksBefore: Object.fromEntries(file.ledger.map((l) => [l.subject, l.askCount])) };
    file.releases.push(rel);
    file.hold = null;
    return accept(rel);
}

// ---------------------------------------------------------------- sends

/** Records an outbound reply after the sender confirms it. Refuses no run id or approver, and facts not on the file. */
export function recordSend(file: CaseFile, send: SendRecord): Outcome<SendRecord> {
    if (!send.runId?.trim()) return refuse('a send needs a run id');
    if (!send.approver?.trim()) return refuse('a send needs an approver');
    if (!partyOf(file, send.partyId)) return refuse('the party is not on the file');
    const known = new Set(file.facts.map((f) => f.id));
    const missing = send.factIds.filter((id) => !known.has(id));
    if (missing.length) return refuse(`facts named that are not on the file: ${missing.join(', ')}`);
    if (file.sentRunIds.includes(send.runId)) return refuse(`run ${send.runId} has already sent`);
    file.sends.push(send);
    file.sentRunIds.push(send.runId);
    return accept(send);
}

/** Records a confirmed change that sent nothing. Refuses no words, no approver, no action id, and an action already recorded. */
export function recordSystemTurn(file: CaseFile, input: { body: string; approver: string; actionId: string; runId: string }, deps: CaseFileDeps = {}): Outcome<SystemTurn> {
    const now = deps.now ?? (() => new Date());
    const newId = deps.newId ?? defaultNewId;
    if (!input.body.trim()) return refuse('a system turn needs words');
    if (!input.approver.trim()) return refuse('a system turn needs an approver');
    if (!input.actionId.trim() || !input.runId.trim()) return refuse('a system turn carries its action id and run id');
    const turns = file.systemTurns ?? (file.systemTurns = []);
    if (turns.some((t) => t.actionId === input.actionId)) return refuse(`action ${input.actionId} is already recorded`);
    const turn: SystemTurn = { id: newId('sys'), at: now().toISOString(), kind: 'system', body: input.body.trim(), approver: input.approver.trim(), actionId: input.actionId, runId: input.runId };
    turns.push(turn);
    return accept(turn);
}

// ---------------------------------------------------------------- readiness

/** Ready means job type and location both present. Photos are optional, per the captain. */
export function isReady(file: CaseFile): boolean {
    return !!(file.job.type && file.job.location);
}

// ---------------------------------------------------------------- invariants a test can check

/** Every invariant the contract names, as one check. Empty means the file holds. */
export function invariantViolations(file: CaseFile): string[] {
    const out: string[] = [];
    const factIds = new Set(file.facts.map((f) => f.id));
    for (const s of file.sends) for (const id of s.factIds) if (!factIds.has(id)) out.push(`send ${s.runId} cites fact ${id} which is not on the file`);
    for (const f of file.facts) if (!f.source || !f.source.kind) out.push(`fact ${f.id} has no source`);
    for (const l of file.ledger) {
        const asks = file.ledger.filter((x) => x.subject === l.subject);
        if (asks.length > 1) out.push(`subject ${l.subject} has ${asks.length} ledger rows`);
    }
    let prev: Stage | null = null;
    for (const c of file.stageHistory) {
        if (c.from !== prev) out.push(`stage history breaks at ${c.to}: from ${c.from}, expected ${prev}`);
        if (prev !== null && !stageMoveAllowed(prev, c.to)) out.push(`stage move ${prev} -> ${c.to} is not allowed`);
        prev = c.to;
    }
    if (file.hold && !file.hold.approver?.id) out.push('a held file has no named approver');
    const addresses = new Map<string, string>();
    for (const p of file.parties) for (const c of p.channels) {
        const k = `${c.kind}:${c.address}`;
        const owner = addresses.get(k);
        if (owner && owner !== p.personId) out.push(`two parties share ${k}`);
        addresses.set(k, p.personId);
    }
    for (const s of file.sends) if (!s.approver) out.push(`send ${s.runId} has no approver`);
    const runs = file.sends.map((s) => s.runId);
    if (new Set(runs).size !== runs.length) out.push('a run id sent twice');
    return out;
}

/** A deep copy for a report or a door response. */
export function snapshot(file: CaseFile): CaseFile {
    return JSON.parse(JSON.stringify(file)) as CaseFile;
}
