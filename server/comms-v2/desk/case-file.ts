/**
 * Contract 2 - Case file (docs/comms-v2/contracts.md).
 *
 * The job's folder. One per job, never per channel, with every party on it. It is the only state
 * specialists share; nothing passes between them any other way.
 *
 * Every call here is a pure function over the file's record: it returns a refusal or applies the
 * change in place. Turns are append only. A fact without a source is refused. The seven stages
 * move only through `setStage`. The ask ledger refuses a second ask of an unanswered subject and a
 * second thank. The hold is a flag, not a stage, released only with the approver's words. A send
 * carries a run id, an approver and the facts it was written from.
 */
import { randomUUID } from 'node:crypto';
import type { CanonicalKey, ChannelKind, ResolveResult, Role } from './identity';
import type { Exception } from './router';

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

export interface PartyChannel {
    kind: ChannelKind;
    /** The canonical address on the wire: E.164 for a phone channel, the lowercase email for email. */
    address: string;
    /** WhatsApp only: when the customer last wrote, which opens the 24-hour window. Null: never. */
    lastInboundAt: string | null;
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
}

export type FactSource =
    | { kind: 'thread'; turnId: string }
    | { kind: 'quote_line'; quoteRef: string; line: string }
    | { kind: 'knowledge_base'; entryId: string }
    | { kind: 'customer_record'; customerId: string; field: string }
    | { kind: 'diary'; rowId: string }
    | { kind: 'media_description'; turnId: string; mediaId: string }
    | { kind: 'seed'; note: string };

export interface Fact {
    id: string;
    key: string;
    value: string;
    source: FactSource;
    at: string;
    by: string;
}

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
    exception: Exception | null;
    since: string;
    /** The draft and the failures when a guard hold raised it. */
    draft: string | null;
    failures: string[];
}

export interface HoldRelease {
    approver: ApproverSlot;
    words: string;
    at: string;
    reason: string;
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
    job: Job;
    sends: SendRecord[];
    /** Run ids that have been sent, so one run id sends once. */
    sentRunIds: string[];
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
        channels: [{ kind: input.channel, address: input.address, lastInboundAt: input.channel === 'whatsapp' ? input.firstTurn.at : null }],
        prefersText: false, alreadyRung: input.channel === 'call', callOffered: false,
    };
    const file: CaseFile = {
        id: newId('case'), openedAt: at, parties: [party], turns: [], stage: 'first_contact',
        stageHistory: [{ from: null, to: 'first_contact', at, why: 'opened' }],
        facts: [], ledger: [], hold: null, releases: [], job: { type: null, location: null, quoteRef: null, bookingRef: null }, sends: [], sentRunIds: [],
    };
    const turn = appendTurn(file, { ...input.firstTurn, partyId: party.personId, direction: 'inbound', runId: null, approver: null }, deps);
    if (!turn.ok) return turn;
    return accept(file);
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

/** Adds a turn. Refuses when the party is not on the file or the turn is out of order. */
export function appendTurn(file: CaseFile, turn: Omit<Turn, 'id'> & { id?: string }, deps: CaseFileDeps = {}): Outcome<Turn> {
    const newId = deps.newId ?? defaultNewId;
    const party = partyOf(file, turn.partyId);
    if (!party) return refuse('the party is not on the file');
    const last = file.turns[file.turns.length - 1];
    if (last && Date.parse(turn.at) < Date.parse(last.at)) return refuse('the turn is out of order');
    if (turn.direction === 'outbound' && (!turn.runId || !turn.approver)) return refuse('an outbound turn carries a run id and an approver');
    const t: Turn = { ...turn, id: turn.id ?? newId('turn') };
    file.turns.push(t);
    if (t.direction === 'inbound' && t.channel === 'whatsapp') {
        const ch = party.channels.find((c) => c.kind === 'whatsapp');
        if (ch) ch.lastInboundAt = t.at;
        else party.channels.push({ kind: 'whatsapp', address: party.channels[0]?.address ?? '', lastInboundAt: t.at });
    }
    return accept(t);
}

/** The newest turn, and whether the customer has written since the desk last replied to them. */
export function lastTurn(file: CaseFile): Turn | null {
    return file.turns[file.turns.length - 1] ?? null;
}

export function customerWroteSinceLastReply(file: CaseFile, partyId: string): boolean {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId !== partyId) continue;
        if (t.direction === 'inbound') return true;
        if (t.direction === 'outbound') return false;
    }
    return true;
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
export function hold(file: CaseFile, input: { approver: ApproverSlot; reason: string; exception?: Exception | null; draft?: string | null; failures?: string[] }, deps: CaseFileDeps = {}): Outcome<Hold> {
    const now = deps.now ?? (() => new Date());
    if (file.hold) return refuse(`the file is already held for ${approverLabel(file.hold.approver)}: ${file.hold.reason}`);
    if (!input.reason.trim()) return refuse('a hold needs a reason');
    file.hold = { approver: input.approver, reason: input.reason, exception: input.exception ?? null, since: now().toISOString(), draft: input.draft ?? null, failures: input.failures ?? [] };
    return accept(file.hold);
}

/** Clears the hold. Refuses release without words, and by anyone other than the named approver. */
export function release(file: CaseFile, approver: ApproverSlot, words: string, deps: CaseFileDeps = {}): Outcome<HoldRelease> {
    const now = deps.now ?? (() => new Date());
    if (!file.hold) return refuse('the file is not held');
    if (!words.trim()) return refuse('release needs the approver\'s words');
    if (!sameApprover(file.hold.approver, approver)) return refuse(`only ${approverLabel(file.hold.approver)} may release this hold`);
    const rel: HoldRelease = { approver, words: words.trim(), at: now().toISOString(), reason: file.hold.reason };
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
