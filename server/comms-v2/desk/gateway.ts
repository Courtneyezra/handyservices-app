/**
 * The channel gateway and the Desk API: one entry per customer turn. A normalised inbound turn
 * passes through Identity, lands on the person's one open case file (opened if none), and is
 * handed to the desk. A quick run of messages from one party is handed over as one turn once they
 * go quiet (turn-window.ts), held on the file as a wait until the desk has answered it, and the
 * desk runs on one file one pass at a time. A clock pass and time passing enter here too, so the
 * desk has one door.
 */
import { randomUUID } from 'node:crypto';
import { answeredByReply, appendTurn, messagesOf, open, partyOf, recordFact, ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, snapshot, type CaseFile, type Turn, type TurnWait, type CaseFileDeps } from './case-file';
import { Identity, e164Of, type ResolveResult } from './identity';
import { MemoryCaseFileStore, type CaseFileStore } from './store';
import type { InboundTurn } from './whatsapp-adapter';
import type { DeskResult, DeskLike, GuardName, GuardVerdict } from './desk-types';
import { customerTurnOf, waitsForQuiet } from './turn-window';

export interface GatewayDeps {
    identity?: Identity;
    store?: CaseFileStore;
    desk: DeskLike;
    now?: () => Date;
    newId?: (prefix: string) => string;
    log?: (line: string) => void;
    /**
     * How long a party must be quiet on WhatsApp or SMS before their messages go to the desk as one
     * turn (turn-window.ts). The sandbox door and the live intake pass CUSTOMER_TURN_QUIET_MS; unset
     * is 0, every message its own turn, which is what a test's scripted gateway wants.
     */
    quietMs?: number;
}

/** What one message came to: the desk's result, and the ids of the messages the desk read as the one turn this message was part of. */
export interface HandedTurn { result: DeskResult; burst: string[] }

/** Messages from one party on one channel of one file, waiting out the quiet window; `wait` is the same burst as the file records it. */
interface Burst {
    key: string;
    file: CaseFile;
    turns: Turn[];
    wait: TurnWait;
    timer: ReturnType<typeof setTimeout> | null;
    waiters: Array<{ turnId: string; resolve: (h: HandedTurn) => void; reject: (e: unknown) => void }>;
}

export type InboundOutcome =
    | { kind: 'handled'; file: CaseFile; turn: Turn; result: DeskResult; burst: string[] }
    /** A call already on a file, passed again: its turn filled in where the new pass says more, and no desk run. */
    | { kind: 'attached'; file: CaseFile; turn: Turn; changed: boolean }
    /** A delivery already on a file (`Turn.deliveryId`) whose turn the desk has handled, handed over again: nothing added, no desk run. */
    | { kind: 'duplicate'; file: CaseFile; turn: Turn }
    /** Identity returned candidates: nothing is sent until a person picks one. */
    | { kind: 'candidates'; candidates: number; address: string }
    | { kind: 'refused'; reason: string };

/** Why an inbound was not handled, for a door to say. */
export function notHandledReason(out: Exclude<InboundOutcome, { kind: 'handled' }>): string {
    if (out.kind === 'candidates') return 'identity returned candidates';
    if (out.kind === 'attached') return 'this call is already on the file; its turn was filled in and the desk did not run';
    if (out.kind === 'duplicate') return 'this delivery is already on the file and the desk has handled it; the desk did not run again';
    return out.reason;
}

export interface SeedInput {
    prefersText?: boolean;
    alreadyRung?: boolean;
    known?: boolean;
    facts?: Array<{ key: string; value: string; source: string }>;
    ledger?: Array<{ subject: string; state: 'asked' | 'answered' | 'thanked' }>;
}

export class Gateway {
    readonly identity: Identity;
    readonly store: CaseFileStore;
    readonly desk: DeskLike;
    protected readonly now: () => Date;
    protected readonly newId: (prefix: string) => string;
    protected readonly log: (line: string) => void;
    private readonly quietMs: number;
    /** Who holds the waits this gateway records on a file (`TurnWait.holder`): new with every process, so a wait any other holder left is one a restart left behind. */
    private readonly holder = `gateway_${randomUUID()}`;
    private readonly waiting = new Map<string, Burst>();
    /** The tail of each file's desk passes, so a pass starts only once the one before it on that file has finished. */
    private readonly passes = new Map<string, Promise<unknown>>();

    constructor(deps: GatewayDeps) {
        this.identity = deps.identity ?? new Identity();
        this.store = deps.store ?? new MemoryCaseFileStore();
        this.desk = deps.desk;
        this.now = deps.now ?? (() => new Date());
        this.newId = deps.newId ?? ((prefix) => `${prefix}_${randomUUID()}`);
        this.log = deps.log ?? (() => undefined);
        this.quietMs = Math.max(0, deps.quietMs ?? 0);
    }

    protected fileDeps(): CaseFileDeps { return { now: this.now, newId: this.newId }; }

    /** A customer WhatsApp turn: identity, the one file, then the desk. */
    async inbound(turn: InboundTurn, seed: SeedInput = {}): Promise<InboundOutcome> {
        const resolved: ResolveResult = this.identity.resolve('whatsapp', turn.address, { name: turn.name });
        if (!resolved.ok) {
            if (resolved.reason === 'candidates') { this.log(`identity: ${resolved.candidates.length} candidates for a whatsapp address; no reply`); return { kind: 'candidates', candidates: resolved.candidates.length, address: turn.address }; }
            return { kind: 'refused', reason: resolved.detail };
        }
        if (resolved.role === 'internal') return { kind: 'refused', reason: 'an internal number is not a customer; nothing to scope' };
        const address = e164Of(resolved.canonical) ?? turn.address;
        const turnBody = { at: turn.at, channel: 'whatsapp' as const, kind: (turn.media.length ? 'media' : 'text') as Turn['kind'], body: turn.text, media: turn.media.map((m) => ({ id: m.id, kind: m.kind, mime: m.mime, path: m.path, url: m.url, description: null })) };
        let file = this.store.findOpenFor(resolved.personId);
        let landed: Turn;
        if (!file) {
            const opened = open({ identity: resolved, channel: 'whatsapp', address, firstTurn: turnBody }, this.fileDeps());
            if (!opened.ok) return { kind: 'refused', reason: opened.reason };
            file = opened.value;
            landed = file.turns[0];
            this.applySeed(file, seed);
            this.store.put(file);
        } else {
            const party = partyOf(file, resolved.personId)!;
            if (!party.name && resolved.name) party.name = resolved.name;
            const appended = appendTurn(file, { ...turnBody, partyId: resolved.personId, direction: 'inbound', runId: null, approver: null }, this.fileDeps());
            if (!appended.ok) return { kind: 'refused', reason: appended.reason };
            landed = appended.value;
        }
        if (turn.via === 'twilio' || turn.via === 'meta') {
            const ch = partyOf(file, resolved.personId)!.channels.find((c) => c.kind === 'whatsapp');
            if (ch) ch.transport = turn.via;
        }
        const { result, burst } = await this.handTurn(file, landed);
        return { kind: 'handled', file, turn: landed, result, burst };
    }

    /**
     * The landed turn to the desk. The file is put once the turn has landed and again once the desk
     * has done with it, even when the desk throws, so a durable store holds the customer's words
     * whatever the run does.
     *
     * A message that waits for quiet (turn-window.ts) joins its party's burst and resolves when the
     * burst has been answered: the newest message with the desk's result, each earlier one with a
     * result saying the same run answered it and nothing went on it alone. Anything else goes to the
     * desk now, after whatever that party still had waiting on the file, a burst a restart left
     * behind included.
     */
    protected async handTurn(file: CaseFile, landed: Turn): Promise<HandedTurn> {
        this.store.put(file);
        if (this.quietMs > 0 && waitsForQuiet(landed)) return this.joinBurst(file, landed);
        for (const b of Array.from(this.waiting.values())) if (b.file.id === file.id && b.turns[0].partyId === landed.partyId) this.flush(b);
        for (const w of this.leftBehind(file)) if (w.partyId === landed.partyId) this.recover(file, w).catch((err) => this.log(`recovering a burst on case ${file.id} failed: ${err?.message ?? err}`));
        return { result: await this.deskPass(file, (f) => this.handle(f, landed)), burst: [landed.id] };
    }

    /**
     * A delivery's turn already on the file, to the desk again unless the desk has handled it: a
     * reply answers it or a run recorded its result on it. Checked inside the file's queue, so a
     * pass still running on it counts; null when there was nothing to do.
     */
    protected handAgain(file: CaseFile, turn: Turn): Promise<DeskResult | null> {
        return this.deskPass(file, async (f) => {
            if (deskHandled(f, turn)) return null;
            this.log(`delivery turn ${turn.id} on case ${f.id} has no desk result; handing it to the desk again`);
            return this.handle(f, turn);
        });
    }

    /** The desk on one turn; a delivery's turn records the run that handled it, in the pass's own put. */
    private async handle(file: CaseFile, turn: Turn): Promise<DeskResult> {
        const result = await this.desk.handleTurn(file, turn);
        if (turn.deliveryId) turn.handledBy = result.runId;
        return result;
    }

    /**
     * The message into its party's burst on this channel, recorded on the file as the burst's wait
     * with the time it falls due. A fresh burst takes in what a restart left waiting on the same
     * party's channel, so those messages and this one go to the desk as one turn, not answered
     * separately or left behind this message's own reply.
     */
    private joinBurst(file: CaseFile, landed: Turn): Promise<HandedTurn> {
        const key = `${file.id}|${landed.partyId}|${landed.channel}`;
        let burst = this.waiting.get(key);
        if (!burst) {
            const left = this.leftBehind(file).filter((w) => w.partyId === landed.partyId && w.channel === landed.channel);
            const turns = left.flatMap((w) => this.unanswered(file, w));
            dropWaits(file, left);
            const wait: TurnWait = { partyId: landed.partyId, channel: landed.channel, turnIds: [], dueAt: landed.at, holder: this.holder, handedAt: null };
            file.waits = [...(file.waits ?? []), wait];
            burst = { key, file, turns, wait, timer: null, waiters: [] };
            this.waiting.set(key, burst);
        }
        burst.turns.push(landed);
        burst.wait.turnIds = burst.turns.map((t) => t.id);
        burst.wait.dueAt = new Date(this.now().getTime() + this.quietMs).toISOString();
        this.store.put(file);
        if (burst.timer) clearTimeout(burst.timer);
        const live = burst;
        burst.timer = setTimeout(() => this.flush(live), this.quietMs);
        return new Promise((resolve, reject) => live.waiters.push({ turnId: landed.id, resolve, reject }));
    }

    /** The burst to the desk as one turn. A new message from the party after this starts the next burst. */
    private flush(burst: Burst): void {
        if (this.waiting.get(burst.key) !== burst) return;
        this.waiting.delete(burst.key);
        if (burst.timer) clearTimeout(burst.timer);
        const ids = burst.turns.map((t) => t.id);
        const newest = ids[ids.length - 1];
        const turn = customerTurnOf(burst.turns);
        if (ids.length > 1) this.log(`one customer turn from ${ids.length} messages on case ${burst.file.id}`);
        this.answerWait(burst.file, burst.wait, turn).then(
            (result) => { for (const w of burst.waiters) w.resolve({ result: w.turnId === newest ? result : answeredWith(result, ids.length, this.quietMs), burst: ids }); },
            (err) => { for (const w of burst.waiters) w.reject(err); },
        );
    }

    /**
     * A wait's messages to the desk as one turn. The wait stays on the file, marked handed, until the
     * pass has finished, and comes off in the same put that lands the pass's reply: a clock pass
     * while the desk is still writing never reads those messages as lost, and a restart before the
     * pass lands leaves the wait for the next process to recover.
     */
    private answerWait(file: CaseFile, wait: TurnWait, turn: Turn): Promise<DeskResult> {
        wait.handedAt = this.now().toISOString();
        this.store.put(file);
        return this.deskPass(file, async (f) => {
            try {
                const folded = this.foldQueued(f, wait, turn);
                if (!folded) return alreadyAnswered(f, wait, turn);
                if (folded !== turn) this.log(`one customer turn from ${messagesOf(folded).length} messages on case ${f.id}: bursts queued behind a pass answered together`);
                return await this.desk.handleTurn(f, folded);
            } finally {
                dropWaits(f, [wait]);
            }
        });
    }

    /**
     * The turn a wait's pass answers, taken when the pass starts rather than when the burst closed
     * (the Kiran thread, 16 Sep 2026): every message of this wait that no reply has answered since,
     * and every message of the same party's later bursts on this channel that are already queued
     * behind this pass, as one turn. A queued burst taken in here finds nothing left when its own
     * pass starts, and sends nothing. Null when a reply already answers every message of this wait
     * and nothing is queued.
     */
    private foldQueued(file: CaseFile, wait: TurnWait, turn: Turn): Turn | null {
        const ids = new Set(messagesOf(turn));
        for (const w of file.waits ?? []) {
            if (w === wait || !w.handedAt || w.holder !== this.holder || w.partyId !== wait.partyId || w.channel !== wait.channel) continue;
            for (const id of w.turnIds) ids.add(id);
        }
        const turns = file.turns.filter((t) => ids.has(t.id) && t.direction === 'inbound' && !answeredByReply(file, t.id));
        if (!turns.length) return null;
        const own = messagesOf(turn);
        if (turns.length === own.length && turns.every((t, i) => t.id === own[i])) return turn;
        return customerTurnOf(turns);
    }

    /** One desk pass on a file, after any pass already running or queued on it; the file is put when the pass is done, even when it throws. */
    private deskPass<T>(file: CaseFile, pass: (file: CaseFile) => Promise<T>): Promise<T> {
        const run = async () => {
            try {
                return await pass(file);
            } finally {
                this.store.put(file);
            }
        };
        const next = (this.passes.get(file.id) ?? Promise.resolve()).then(run);
        const tail = next.catch(() => undefined);
        this.passes.set(file.id, tail);
        void tail.then(() => { if (this.passes.get(file.id) === tail) this.passes.delete(file.id); });
        return next;
    }

    /**
     * A clock pass with no new message. The desk never chases, so this is where "then quiet" is
     * proven - unless the file holds a wait a restart left behind (another gateway's, `TurnWait`)
     * that has fallen due, in which case every such wait goes to the desk now, once each, through the
     * same path a live burst flushes on: a restart mid-window or mid-pass never leaves a landed
     * message unanswered. A wait this gateway holds is still being timed or answered, and is left alone.
     */
    async clock(fileId: string): Promise<DeskResult | null> {
        const file = this.store.get(fileId);
        if (!file) return null;
        const now = this.now().getTime();
        const due = this.leftBehind(file).filter((w) => Date.parse(w.dueAt) <= now);
        if (due.length) {
            // Queued together, so each goes after the one before it on the file and none is taken twice.
            const runs = await Promise.allSettled(due.map((w) => this.recover(file, w)));
            const failed = runs.find((r): r is PromiseRejectedResult => r.status === 'rejected');
            if (failed) throw failed.reason;
            const answered = runs.map((r) => (r as PromiseFulfilledResult<DeskResult | null>).value).filter((r): r is DeskResult => !!r);
            if (answered.length) return answered[answered.length - 1];
        }
        return this.deskPass(file, (f) => this.desk.clockPass(f));
    }

    /** Waits on the file this gateway does not hold: left by the process before a restart. */
    private leftBehind(file: CaseFile): TurnWait[] {
        return (file.waits ?? []).filter((w) => w.holder !== this.holder);
    }

    /** A wait's messages still on the file that no reply records answering, oldest first. */
    private unanswered(file: CaseFile, wait: TurnWait): Turn[] {
        return wait.turnIds.map((id) => file.turns.find((t) => t.id === id)).filter((t): t is Turn => !!t && !answeredByReply(file, t.id));
    }

    /**
     * A wait a restart left behind, taken over by this gateway and answered as one turn. Null, with
     * the wait dropped, when a reply already answers every message on it: the process before the
     * restart landed its reply but not the put that took the wait off.
     */
    private recover(file: CaseFile, wait: TurnWait): Promise<DeskResult | null> {
        wait.holder = this.holder;
        const turns = this.unanswered(file, wait);
        if (!turns.length) {
            dropWaits(file, [wait]);
            this.store.put(file);
            return Promise.resolve(null);
        }
        this.log(`recovered ${turns.length === 1 ? 'a message' : `a burst of ${turns.length} messages`} lost to a restart on case ${file.id}`);
        return this.answerWait(file, wait, customerTurnOf(turns));
    }

    /** Time passes: every timestamp on the file moves back by N hours, which shuts the window past 24. */
    age(fileId: string, hours: number): CaseFile | null {
        const file = this.store.get(fileId);
        if (!file) return null;
        const shift = (iso: string | null) => (iso ? new Date(Date.parse(iso) - hours * 3_600_000).toISOString() : iso);
        file.openedAt = shift(file.openedAt)!;
        for (const t of file.turns) t.at = shift(t.at)!;
        for (const p of file.parties) for (const c of p.channels) c.lastInboundAt = shift(c.lastInboundAt);
        for (const f of file.facts) f.at = shift(f.at)!;
        for (const l of file.ledger) { l.askedAt = shift(l.askedAt); l.answeredAt = shift(l.answeredAt); l.thankedAt = shift(l.thankedAt); }
        for (const s of file.sends) s.at = shift(s.at)!;
        for (const h of file.stageHistory) h.at = shift(h.at)!;
        if (file.hold) file.hold.since = shift(file.hold.since)!;
        for (const w of file.waits ?? []) { w.dueAt = shift(w.dueAt)!; w.handedAt = shift(w.handedAt); }
        this.store.put(file);
        return file;
    }

    /** The door's seed (POST /start), honoured as facts and ledger rows on the file. */
    protected applySeed(file: CaseFile, seed: SeedInput): void {
        const by = 'seed';
        const deps = this.fileDeps();
        const source = (note: string) => ({ kind: 'seed' as const, note });
        if (seed.prefersText) recordFact(file, { key: 'prefers_text', value: 'true', source: source('scenario seed prefersText'), by }, deps);
        if (seed.alreadyRung) recordFact(file, { key: 'already_rung', value: 'true', source: source('scenario seed alreadyRung'), by }, deps);
        for (const f of seed.facts ?? []) recordFact(file, { key: f.key, value: f.value, source: source(f.source), by }, deps);
        for (const l of seed.ledger ?? []) {
            if (l.state === 'asked') ledgerAsk(file, l.subject, deps);
            if (l.state === 'answered') { ledgerAsk(file, l.subject, deps); ledgerAnswered(file, l.subject, deps); }
            if (l.state === 'thanked') { ledgerAsk(file, l.subject, deps); ledgerAnswered(file, l.subject, deps); ledgerThanked(file, l.subject, deps); }
        }
    }

    snapshotOf(fileId: string): CaseFile | null {
        const f = this.store.get(fileId);
        return f ? snapshot(f) : null;
    }
}

/** Whether the desk has handled a turn: a reply answers it, or a run recorded its result on it. */
function deskHandled(file: CaseFile, turn: Turn): boolean {
    return !!turn.handledBy || answeredByReply(file, turn.id);
}

/** Takes waits off the file; the key goes with the last one, so a file with nothing waiting reads as it did before waits were recorded. */
function dropWaits(file: CaseFile, gone: TurnWait[]): void {
    if (!file.waits || !gone.length) return;
    file.waits = file.waits.filter((w) => !gone.includes(w));
    if (!file.waits.length) delete file.waits;
}

/** A wait whose messages a reply already answers, because an earlier pass took them in: nothing is sent. */
function alreadyAnswered(file: CaseFile, wait: TurnWait, turn: Turn): DeskResult {
    const ids = messagesOf(turn);
    const reply = [...file.turns].reverse().find((t) => t.direction === 'outbound' && t.answers?.some((id) => ids.includes(id)));
    const note = `already answered: ${reply?.runId ? `run ${reply.runId}` : 'an earlier reply'} took these messages in, so nothing goes on them again`;
    const guards = Object.fromEntries((['figure', 'date_time_duration', 'commitment_fault', 'business_claim', 'disclosure', 'one_reply', 'ask_ledger', 'regulated'] as GuardName[]).map((g) => [g, { result: 'pass', note: 'no reply was written; the reply that answered these messages carries the guards' }])) as Record<GuardName, GuardVerdict>;
    return {
        runId: `run_${randomUUID()}`, decision: 'none', partyId: wait.partyId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards, approver: null,
        hold: file.hold, delivered: false, stageAfter: file.stage, calls: [], note, summary: null, error: null, landedTurnId: null, composerCalls: 0, chase: null,
    };
}

/** An earlier message of a burst: the run that answered the burst, with nothing sent on this message itself. */
function answeredWith(answer: DeskResult, messages: number, quietMs: number): DeskResult {
    const note = 'no reply went on this message alone; the run that answered the turn carries the guards';
    const guards = Object.fromEntries(Object.keys(answer.guards).map((g) => [g, { result: 'pass', note }])) as Record<GuardName, GuardVerdict>;
    return {
        ...answer, decision: 'none', templateId: null, bubbles: [], factIds: [], kbIds: [], guards, approver: null, delivered: false, calls: [], error: null, landedTurnId: null, composerCalls: 0, chase: null,
        note: `one customer turn: ${messages} messages from the same party inside the ${quietMs / 1000}s quiet window went to the desk together, and run ${answer.runId} answered them once`,
    };
}
