/**
 * The channel gateway and the Desk API: one entry per customer turn. A normalised inbound turn
 * passes through Identity, lands on the person's one open case file (opened if none), and is
 * handed to the desk. A clock pass and time passing enter here too, so the desk has one door.
 */
import { randomUUID } from 'node:crypto';
import { appendTurn, open, partyOf, recordFact, ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, snapshot, type CaseFile, type Turn, type CaseFileDeps } from './case-file';
import { Identity, e164Of, type ResolveResult } from './identity';
import { MemoryCaseFileStore, type CaseFileStore } from './store';
import type { InboundTurn } from './whatsapp-adapter';
import type { DeskResult, DeskLike } from './desk-types';

export interface GatewayDeps {
    identity?: Identity;
    store?: CaseFileStore;
    desk: DeskLike;
    now?: () => Date;
    newId?: (prefix: string) => string;
    log?: (line: string) => void;
}

export type InboundOutcome =
    | { kind: 'handled'; file: CaseFile; turn: Turn; result: DeskResult }
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

    constructor(deps: GatewayDeps) {
        this.identity = deps.identity ?? new Identity();
        this.store = deps.store ?? new MemoryCaseFileStore();
        this.desk = deps.desk;
        this.now = deps.now ?? (() => new Date());
        this.newId = deps.newId ?? ((prefix) => `${prefix}_${randomUUID()}`);
        this.log = deps.log ?? (() => undefined);
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
        const result = await this.desk.handleTurn(file, landed);
        return { kind: 'handled', file, turn: landed, result };
    }

    /** A clock pass with no new message. The desk never chases, so this is where "then quiet" is proven. */
    async clock(fileId: string): Promise<DeskResult | null> {
        const file = this.store.get(fileId);
        if (!file) return null;
        return this.desk.clockPass(file);
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
