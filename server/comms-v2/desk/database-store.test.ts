/**
 * The durable case file store: a file written whole behind the synchronous store, a restart that
 * loses no thread, a failing write that neither throws nor holds up another file, and the live rows
 * refusing anything but the branch. The last block runs against the branch database itself when
 * COMMS_V2_DATABASE_URL names the database in use (a pipeline run copy inherits both through direnv).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { ChannelGateway } from '../channels/channel-gateway';
import { fromTwilioSms } from '../channels/sms-adapter';
import { CommsV2DatabaseRefused, IN_USE_DATABASE_ENV, commsV2DatabaseCheck, commsV2Db } from '../live-database';
import { PRODUCTION_DB_HOST_MARKER } from '../../worker-gate';
import type { CaseFile, Turn } from './case-file';
import { DatabaseCaseFileStore, identityFromCaseFiles, liveCaseFileRows, openCaseFileStore, recordOf, type CaseFileRows } from './database-store';
import type { DeskLike, DeskResult } from './desk-types';
import { COMMS_V2_DATABASE_ENV } from './door-host';

/** The table, in memory: rows kept as the JSON a jsonb column would hand back. */
class TableRows implements CaseFileRows {
    readonly rows = new Map<string, string>();
    failing: (id: string) => boolean = () => false;
    async loadAll(): Promise<CaseFile[]> { return Array.from(this.rows.values()).map((j) => JSON.parse(j) as CaseFile); }
    async upsert(file: CaseFile): Promise<void> {
        if (this.failing(file.id)) throw new Error('Connection terminated unexpectedly');
        this.rows.set(file.id, JSON.stringify(file));
    }
    async deleteAll(): Promise<void> { this.rows.clear(); }
    stored(id: string): CaseFile | null { const j = this.rows.get(id); return j ? (JSON.parse(j) as CaseFile) : null; }
}

const resultOf = (file: CaseFile): DeskResult => ({ runId: 'r', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 });

/** A desk that changes the file in place, the way the real one does, and puts nothing itself. */
const changingDesk: DeskLike = {
    async handleTurn(file: CaseFile, _turn: Turn) { file.parties[0].prefersText = true; return resultOf(file); },
    async clockPass(file: CaseFile) { return resultOf(file); },
};

const sms = (body: string, from = '+447700900942') => fromTwilioSms({ From: from, Body: body, MessageSid: `SM${randomUUID()}` } as any);
const inboundOf = (file: CaseFile) => file.turns.filter((t) => t.direction === 'inbound').map((t) => t.body);

function handled(out: Awaited<ReturnType<ChannelGateway['inbound']>>): CaseFile {
    if (out.kind !== 'handled') throw new Error(`expected a handled turn, got ${out.kind}`);
    return out.file;
}

describe('the durable case file store', () => {
    it('writes a file whole once its turn lands, and the desk\'s change in place is on the row once the desk is done', async () => {
        const rows = new TableRows();
        const store = new DatabaseCaseFileStore(rows);
        const file = handled(await new ChannelGateway({ desk: changingDesk, store }).inbound(sms('my gate has dropped')));
        await store.flush();
        expect(rows.stored(file.id)).toEqual(recordOf(file));
        expect(rows.stored(file.id)!.parties[0].prefersText).toBe(true);
        expect(store.pending()).toBe(0);
    });

    it('loses no thread across a restart: a store opened on the same rows finds the open file, and the next turn lands on it rather than on a second file', async () => {
        const rows = new TableRows();
        const before = new DatabaseCaseFileStore(rows);
        const opened = handled(await new ChannelGateway({ desk: changingDesk, store: before }).inbound(sms('my gate has dropped')));
        await before.flush();

        const store = await openCaseFileStore({}, rows);
        const after = new ChannelGateway({ desk: changingDesk, store, identity: identityFromCaseFiles(store.all()) });
        const next = handled(await after.inbound(sms('it is the left hinge')));
        expect(next.id).toBe(opened.id);
        expect(inboundOf(next)).toEqual(['my gate has dropped', 'it is the left hinge']);
        await store.flush();
        expect(rows.rows.size).toBe(1);
        expect(inboundOf(rows.stored(opened.id)!)).toEqual(['my gate has dropped', 'it is the left hinge']);
    });

    it('a restored identity is only as sure as the files: a number on two people\'s parties comes back as candidates for Ben, never a guess', async () => {
        const rows = new TableRows();
        const store = new DatabaseCaseFileStore(rows);
        const g = new ChannelGateway({ desk: changingDesk, store });
        const a = handled(await g.inbound(sms('first job', '+447700900941')));
        const b = handled(await g.inbound(sms('second job', '+447700900943')));
        b.parties[0].channels.push({ kind: 'sms', address: '+447700900941', lastInboundAt: null });
        const identity = identityFromCaseFiles([a, b]);
        const shared = identity.resolve('sms', '+447700900941');
        expect(shared.ok).toBe(false);
        if (!shared.ok) expect(shared.reason).toBe('candidates');
        const own = identity.resolve('sms', '+447700900943');
        expect(own.ok && own.personId).toBe(b.parties[0].personId);
    });

    it('keeps a finished job finished: a done file is read back as done and a new turn from that person opens a new file', async () => {
        const rows = new TableRows();
        const first = new DatabaseCaseFileStore(rows);
        const done = handled(await new ChannelGateway({ desk: changingDesk, store: first }).inbound(sms('first job')));
        done.stage = 'done';
        first.put(done);
        await first.flush();

        const store = await openCaseFileStore({}, rows);
        expect(store.get(done.id)?.stage).toBe('done');
        expect(store.findOpenFor(done.parties[0].personId)).toBeNull();
        const fresh = handled(await new ChannelGateway({ desk: changingDesk, store, identity: identityFromCaseFiles(store.all()) }).inbound(sms('a new job')));
        expect(fresh.id).not.toBe(done.id);
        expect(fresh.parties[0].personId).toBe(done.parties[0].personId);
    });

    it('a failing write never throws out of put and never holds up another file\'s, is logged without a word of the file, and lands once the database is back', async () => {
        const rows = new TableRows();
        const lines: string[] = [];
        const store = new DatabaseCaseFileStore(rows, { log: (l) => lines.push(l), retryMs: 60_000 });
        const g = new ChannelGateway({ desk: changingDesk, store });
        let blocked: string | null = null;
        rows.failing = (id) => { if (blocked === null) blocked = id; return id === blocked; };

        const a = handled(await g.inbound(sms('first job', '+447700900941')));
        const b = handled(await g.inbound(sms('second job', '+447700900943')));
        await expect(store.flush()).rejects.toThrow(/Connection terminated/);
        expect(blocked).toBe(a.id);
        expect(rows.rows.has(b.id)).toBe(true);
        expect(rows.rows.has(a.id)).toBe(false);
        expect(store.pending()).toBe(1);
        expect(lines.some((l) => l.includes(`case ${a.id} failed, will retry`))).toBe(true);
        expect(lines.join('\n')).not.toContain('first job');

        rows.failing = () => false;
        await store.flush();
        expect(rows.stored(a.id)).toEqual(recordOf(a));
        expect(store.pending()).toBe(0);
    });

    it('clear forgets every file and deletes every row, and a put after it is not deleted by it', async () => {
        const rows = new TableRows();
        const store = new DatabaseCaseFileStore(rows);
        const g = new ChannelGateway({ desk: changingDesk, store });
        handled(await g.inbound(sms('first job', '+447700900941')));
        await store.flush();
        store.clear();
        const later = handled(await g.inbound(sms('second job', '+447700900943')));
        await store.flush();
        expect(store.all().map((f) => f.id)).toEqual([later.id]);
        expect(Array.from(rows.rows.keys())).toEqual([later.id]);
    });

    it('writes a copy taken when the write starts, with any NUL dropped, since Postgres refuses one in jsonb', async () => {
        const file = handled(await new ChannelGateway({ desk: changingDesk }).inbound(sms('hi')));
        file.turns[0].body = `left${String.fromCharCode(0)}hinge`;
        const record = recordOf(file);
        expect(record.turns[0].body).toBe('lefthinge');
        expect(file.turns[0].body).toContain(String.fromCharCode(0));
        expect(record).not.toBe(file);
    });
});

describe('the live case file rows', () => {
    const BRANCH = 'postgres://user:secret@ep-branch-example.eu-west-2.aws.neon.tech/neondb?sslmode=require';
    const PROD = `postgres://user:secret@${PRODUCTION_DB_HOST_MARKER}-a1b2.eu-west-2.aws.neon.tech/neondb`;

    const withEnv = async (over: Record<string, string | undefined>, run: () => Promise<unknown>): Promise<unknown> => {
        const keys = [COMMS_V2_DATABASE_ENV, IN_USE_DATABASE_ENV];
        const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
        for (const k of keys) { if (over[k] === undefined) delete process.env[k]; else process.env[k] = over[k]; }
        try {
            return await run().then(() => null, (err) => err);
        } finally {
            for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
        }
    };

    it('refuses every method, and the store refuses to open, on a production connection or with no branch named, before opening anything', async () => {
        const file = handled(await new ChannelGateway({ desk: changingDesk }).inbound(sms('hi')));
        const calls: Array<[string, () => Promise<unknown>]> = [
            ['loadAll', () => liveCaseFileRows.loadAll()],
            ['upsert', () => liveCaseFileRows.upsert(file)],
            ['deleteAll', () => liveCaseFileRows.deleteAll()],
            ['openCaseFileStore', () => openCaseFileStore()],
        ];
        for (const env of [{ [COMMS_V2_DATABASE_ENV]: BRANCH, [IN_USE_DATABASE_ENV]: PROD }, { [COMMS_V2_DATABASE_ENV]: undefined, [IN_USE_DATABASE_ENV]: BRANCH }]) {
            for (const [name, call] of calls) {
                const thrown = await withEnv(env, call);
                expect(thrown, `${name} opened the database instead of refusing`).toBeInstanceOf(CommsV2DatabaseRefused);
                expect(String((thrown as Error).message)).toContain(COMMS_V2_DATABASE_ENV);
                expect(String((thrown as Error).message)).not.toContain('secret');
            }
        }
    });
});

describe.runIf(commsV2DatabaseCheck().ok)('the case file rows on the branch database', () => {
    const written: string[] = [];
    const newId = (prefix: string) => `${prefix}_storetest_${randomUUID()}`;

    afterAll(async () => {
        if (!written.length) return;
        const db = await commsV2Db('the case file store test');
        const { commsV2CaseFiles: t } = await import('@shared/schema');
        const { inArray } = await import('drizzle-orm');
        await db.delete(t).where(inArray(t.id, written));
    }, 60_000);

    it('writes a file, a store opened afresh reads it back whole, and the thread continues on the same row', async () => {
        const phone = `+447700900${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
        const store = await openCaseFileStore();
        const opened = handled(await new ChannelGateway({ desk: changingDesk, store, newId }).inbound(sms('my gate has dropped', phone)));
        written.push(opened.id);
        await store.flush();

        // Only this test's file restores identity, so a row another run left behind cannot make the number ambiguous.
        const reopened = await openCaseFileStore();
        expect(reopened.get(opened.id)).toEqual(recordOf(opened));
        const mine = reopened.all().filter((f) => written.includes(f.id));
        const next = handled(await new ChannelGateway({ desk: changingDesk, store: reopened, identity: identityFromCaseFiles(mine), newId }).inbound(sms('it is the left hinge', phone)));
        expect(next.id).toBe(opened.id);
        await reopened.flush();

        const db = await commsV2Db('the case file store test');
        const { commsV2CaseFiles: t } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const [row] = await db.select().from(t).where(eq(t.id, opened.id));
        expect(row.stage).toBe(next.stage);
        expect(row.personIds).toEqual([next.parties[0].personId]);
        expect(inboundOf(row.file as CaseFile)).toEqual(['my gate has dropped', 'it is the left hinge']);
    }, 60_000);
});
