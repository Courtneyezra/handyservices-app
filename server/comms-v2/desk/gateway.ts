/**
 * The channel gateway and the Desk API: one entry per customer turn. A normalised inbound turn
 * passes through Identity, lands on the person's one open case file (opened if none), and is
 * handed to the desk. A quick run of messages from one party is handed over as one turn once they
 * go quiet (turn-window.ts), and the desk runs on one file one pass at a time. A clock pass and
 * time passing enter here too, so the desk has one door.
 */
import { randomUUID } from 'node:crypto';
import { appendTurn, open, partyOf, recordFact, ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, snapshot, type CaseFile, type Turn, type CaseFileDeps } from './case-file';
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

/** Messages from one party on one channel of one file, waiting out the quiet window. */
interface Burst {
    key: string;
    file: CaseFile;
    turns: Turn[];
    timer: ReturnType<typeof setTimeout> | null;
    waiters: Array<{ turnId: string; resolve: (h: HandedTurn) => void; reject: (e: unknown) => void }>;
}

export type InboundOutcome =
    | { kind: 'handled'; file: CaseFile; turn: Turn; result: DeskResult; burst: string[] }
    /** Identity returned candidates: nothing is sent until a person picks one. */
    | { kind: 'candidates'; candidates: number; address: string }
    | { kind: 'refused'; reason: string };

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
     * desk now, after whatever that party still had waiting on the file.
     */
    protected async handTurn(file: CaseFile, landed: Turn): Promise<HandedTurn> {
        this.store.put(file);
        if (this.quietMs > 0 && waitsForQuiet(landed)) return this.joinBurst(file, landed);
        for (const b of Array.from(this.waiting.values())) if (b.file.id === file.id && b.turns[0].partyId === landed.partyId) this.flush(b);
        return { result: await this.deskPass(file, (f) => this.desk.handleTurn(f, landed)), burst: [landed.id] };
    }

    private joinBurst(file: CaseFile, landed: Turn): Promise<HandedTurn> {
        const key = `${file.id}|${landed.partyId}|${landed.channel}`;
        const burst = this.waiting.get(key) ?? { key, file, turns: [], timer: null, waiters: [] };
        this.waiting.set(key, burst);
        burst.turns.push(landed);
        if (burst.timer) clearTimeout(burst.timer);
        burst.timer = setTimeout(() => this.flush(burst), this.quietMs);
        return new Promise((resolve, reject) => burst.waiters.push({ turnId: landed.id, resolve, reject }));
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
        this.deskPass(burst.file, (f) => this.desk.handleTurn(f, turn)).then(
            (result) => { for (const w of burst.waiters) w.resolve({ result: w.turnId === newest ? result : answeredWith(result, ids.length, this.quietMs), burst: ids }); },
            (err) => { for (const w of burst.waiters) w.reject(err); },
        );
    }

    /** One desk pass on a file, after any pass already running or queued on it; the file is put when the pass is done, even when it throws. */
    private deskPass(file: CaseFile, pass: (file: CaseFile) => Promise<DeskResult>): Promise<DeskResult> {
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
     * proven - unless a burst this process lost to a restart is sitting on the file past its
     * window, in which case every such burst (one party can lose more than one, across different
     * channels) goes to the desk now, once each, through the same turn path a live burst flushes
     * on: a process restart mid-window never leaves an already-landed message unanswered.
     */
    async clock(fileId: string): Promise<DeskResult | null> {
        const file = this.store.get(fileId);
        if (!file) return null;
        // Found once, from the file as it stands before any recovery reply lands: answering the
        // first stale channel appends an outbound turn, and re-scanning after that would read that
        // turn as "the party has been replied to" and hide a second, older channel's stale group
        // behind it (the file has no per-channel record of what has been answered).
        const stale = this.staleBurstsOf(file);
        if (stale.length) {
            let result: DeskResult | null = null;
            for (const turns of stale) {
                this.log(`recovered ${turns.length === 1 ? 'a message' : `a burst of ${turns.length} messages`} lost to a restart on case ${file.id}`);
                result = await this.deskPass(file, (f) => this.desk.handleTurn(f, customerTurnOf(turns)));
            }
            return result;
        }
        return this.deskPass(file, (f) => this.desk.clockPass(f));
    }

    /**
     * Every party-and-channel's trailing inbound messages, quiet past the window, that this process
     * has no live timer for: a burst `joinBurst` was holding in memory when the process restarted,
     * so it landed on the file (turns are append-only) but was never handed to the desk. A party can
     * lose a burst on more than one channel across the same restart (WhatsApp and SMS both pending),
     * so every channel with turns since its own last reply is checked on its own: each channel's
     * boundary (its own newest outbound turn, or its own newest non-waiting turn, already dispatched
     * at once when it landed) closes only that channel's search, so an ordinary reply or an
     * immediately-dispatched turn on one channel - SMS answered, an email in between, whatever -
     * never hides an older channel's still-open stale group behind it. Empty when nothing on the
     * file is in that state, including a burst this process is still timing normally.
     */
    private staleBurstsOf(file: CaseFile): Turn[][] {
        if (this.quietMs <= 0) return [];
        const groups: Turn[][] = [];
        for (const party of file.parties) {
            const byChannel = new Map<string, Turn[]>();
            const closed = new Set<string>();
            for (let i = file.turns.length - 1; i >= 0; i--) {
                const t = file.turns[i];
                if (t.partyId !== party.personId || closed.has(t.channel)) continue;
                if (t.direction === 'outbound' || !waitsForQuiet(t)) { closed.add(t.channel); continue; }
                const list = byChannel.get(t.channel);
                if (list) list.unshift(t); else byChannel.set(t.channel, [t]);
            }
            for (const [channel, turns] of byChannel) {
                const newest = turns[turns.length - 1];
                if (this.waiting.has(`${file.id}|${party.personId}|${channel}`)) continue;
                if (this.now().getTime() - Date.parse(newest.at) < this.quietMs) continue;
                groups.push(turns);
            }
        }
        return groups;
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

/** An earlier message of a burst: the run that answered the burst, with nothing sent on this message itself. */
function answeredWith(answer: DeskResult, messages: number, quietMs: number): DeskResult {
    const note = 'no reply went on this message alone; the run that answered the turn carries the guards';
    const guards = Object.fromEntries(Object.keys(answer.guards).map((g) => [g, { result: 'pass', note }])) as Record<GuardName, GuardVerdict>;
    return {
        ...answer, decision: 'none', templateId: null, bubbles: [], factIds: [], kbIds: [], guards, approver: null, delivered: false, calls: [], error: null, landedTurnId: null, composerCalls: 0, chase: null,
        note: `one customer turn: ${messages} messages from the same party inside the ${quietMs / 1000}s quiet window went to the desk together, and run ${answer.runId} answered them once`,
    };
}
