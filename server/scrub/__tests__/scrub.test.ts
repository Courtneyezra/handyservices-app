/**
 * The refusals, and the engine over a case file, against a stand-in for `pg.Client`. No test here
 * opens a socket: a refusal has to happen before anything is written, and the stand-in records
 * every statement so that can be checked rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Client } from 'pg';
import { scrubDatabase, refusalFor, ScrubRefusal, type ScrubOptions } from '../scrub';
import { residualsIn } from '../detect';
import { isSyntheticName, isSyntheticPhone, isSyntheticPostcode, nationalDigits } from '../synthetic';

const PRODUCTION_URL = 'postgres://user:pass@ep-broad-king-000000.eu-west-2.aws.neon.tech/neondb';
const THROWAWAY_URL = 'postgres://user:pass@127.0.0.1:9/throwaway';

interface Col { column: string; dataType: string; elementType?: string; isEnum?: boolean }
interface Table { table: string; primaryKey: string[]; columns: Col[]; rows?: Record<string, unknown>[] }

/** A `pg.Client` that answers the scrub's schema queries from `tables` and records every statement. */
function fakeClient(tables: Table[]) {
    const statements: { sql: string; params?: unknown[] }[] = [];
    const client = {
        async query(sql: string, params?: unknown[]) {
            statements.push({ sql, params });
            if (sql.includes('from information_schema.columns')) {
                return {
                    rows: tables.flatMap((t) => t.columns.map((c, i) => ({
                        table_name: t.table, column_name: c.column, data_type: c.dataType,
                        ordinal_position: i + 1, character_maximum_length: null,
                        element_type: c.elementType ?? null, is_enum: c.isEnum === true,
                    }))),
                };
            }
            if (sql.includes("constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')")) {
                return { rows: tables.flatMap((t) => t.primaryKey.map((k) => ({ table_name: t.table, column_name: k, constraint_type: 'PRIMARY KEY' }))) };
            }
            if (sql.includes("constraint_type = 'PRIMARY KEY'")) {
                return { rows: tables.flatMap((t) => t.primaryKey.map((k, i) => ({ table_name: t.table, column_name: k, ordinal_position: i + 1 }))) };
            }
            const from = /from "([^"]+)"/.exec(sql)?.[1];
            const table = tables.find((t) => t.table === from);
            if (!table?.rows || !/offset 0\b/.test(sql)) return { rows: [] };
            // `select "file"::text as v` in pass 1 reads json as text; the page read in pass 2 reads it parsed.
            const asText = /::text as v/.exec(sql);
            if (asText) {
                const col = /select "([^"]+)"::text as v/.exec(sql)![1];
                return { rows: table.rows.map((r) => ({ v: typeof r[col] === 'string' ? r[col] : JSON.stringify(r[col]) })) };
            }
            return { rows: table.rows };
        },
    };
    const writes = () => statements.filter((s) => /^\s*(update|insert|delete|truncate|alter|drop)\b/i.test(s.sql));
    return { client: client as unknown as Client, statements, writes };
}

const options = (over: Partial<ScrubOptions> = {}): ScrubOptions => ({
    connectionString: THROWAWAY_URL, seed: 'test-seed', confirmed: true, ...over,
});

describe('refusals before connecting', () => {
    it('refuses the production database', () => {
        expect(refusalFor(options({ connectionString: PRODUCTION_URL }))).toMatch(/production/);
    });

    it('refuses the production database even when confirmed and only a dry run', () => {
        expect(refusalFor(options({ connectionString: PRODUCTION_URL, dryRun: true }))).toMatch(/production/);
    });

    it('refuses without the operator confirming', () => {
        expect(refusalFor(options({ confirmed: false }))).toMatch(/--confirm/);
    });

    it('refuses without a seed', () => {
        expect(refusalFor(options({ seed: '' }))).toMatch(/--seed/);
    });

    it('lets a confirmed run with a seed against a non-production database through', () => {
        expect(refusalFor(options())).toBeNull();
    });

    it.each([
        ['the production database', { connectionString: PRODUCTION_URL }],
        ['an unconfirmed run', { confirmed: false }],
    ])('sends not one statement for %s', async (_label, over) => {
        const { client, statements } = fakeClient([]);
        await expect(scrubDatabase(client, options(over))).rejects.toBeInstanceOf(ScrubRefusal);
        expect(statements).toEqual([]);
    });
});

describe('the unclassified-column refusal', () => {
    const schema: Table[] = [{
        table: 'leads', primaryKey: ['id'],
        columns: [
            { column: 'id', dataType: 'character varying' },
            { column: 'customer_name', dataType: 'text' },
            { column: 'some_column_added_next_week', dataType: 'text' },
            { column: 'another_new_blob', dataType: 'jsonb' },
        ],
        rows: [{ id: 'l1', customer_name: 'Margaret Wilkinson', some_column_added_next_week: 'x', another_new_blob: {} }],
    }];

    it('names every unclassified column and writes nothing, even on a confirmed run', async () => {
        const { client, statements, writes } = fakeClient(schema);
        const run = scrubDatabase(client, options());
        await expect(run).rejects.toBeInstanceOf(ScrubRefusal);
        await expect(run).rejects.toThrow(/2 column\(s\) are not classified.*leads\.some_column_added_next_week, leads\.another_new_blob/);
        expect(writes()).toEqual([]);
        // Only the three schema reads: nothing about the rows was even read.
        expect(statements).toHaveLength(3);
    });

    it('does not ask about an enum column, which can only hold its declared labels', async () => {
        const { client, writes } = fakeClient([{
            table: 'leads', primaryKey: ['id'],
            columns: [
                { column: 'id', dataType: 'character varying' },
                { column: 'some_enum_added_next_week', dataType: 'USER-DEFINED', isEnum: true },
            ],
        }]);
        await expect(scrubDatabase(client, options({ dryRun: true }))).resolves.toMatchObject({ textualColumns: 1 });
        expect(writes()).toEqual([]);
    });

    it('does ask about an array of text, and refuses it unclassified', async () => {
        const { client } = fakeClient([{
            table: 'leads', primaryKey: ['id'],
            columns: [{ column: 'id', dataType: 'text' }, { column: 'new_list', dataType: 'ARRAY', elementType: 'text' }],
        }]);
        await expect(scrubDatabase(client, options())).rejects.toThrow(/leads\.new_list/);
    });
});

describe('the comms desk case file', () => {
    const REAL_FILE = {
        id: 'case_1', openedAt: '2026-09-13T10:00:00.000Z', stage: 'scoping',
        parties: [{
            personId: 'person_1', role: 'homeowner', name: 'Margaret Wilkinson', canonical: 'phone:07812345678',
            channels: [{ kind: 'whatsapp', address: '+447812345678', lastInboundAt: '2026-09-13T10:00:00.000Z', transport: 'twilio' }],
            prefersText: false, alreadyRung: false, callOffered: false,
        }],
        turns: [{
            id: 'turn_1', at: '2026-09-13T10:00:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'person_1', kind: 'text',
            body: "Hi it's Margaret Wilkinson at 14 Beechdale Road, NG8 3EY, my tap is dripping. Ring 07812345678.",
            media: [{ id: 'm1', kind: 'image', mime: 'image/jpeg', path: '/data/media/margaret-wilkinson.jpg', url: 'https://api.twilio.com/2010/Media/ME1.jpg', description: { kind: 'image', description: 'A dripping tap at 14 Beechdale Road', confidence: 'high', model: 'gemini', at: '2026-09-13T10:00:01.000Z' } }],
            runId: null, approver: null,
        }],
        stageHistory: [{ from: null, to: 'first_contact', at: '2026-09-13T10:00:00.000Z', why: 'opened' }],
        facts: [{ id: 'fact_1', key: 'postcode', value: 'NG8 3EY', source: { kind: 'thread', turnId: 'turn_1' }, at: '2026-09-13T10:00:00.000Z', by: 'specialist:scoper' }],
        ledger: [{ subject: 'media', askedAt: null, answeredAt: null, thankedAt: '2026-09-13T10:00:02.000Z', askCount: 0 }],
        // A hold reason a specialist writes verbatim onto the file, in the shape
        // `changeOfDetails` (server/comms-v2/service/service-tools.ts) actually raises: the new
        // address rides on it unmasked. Nowhere else in this fixture is this address a classified
        // value, so only regenerating this leaf (not the sweep) can catch it.
        hold: { approver: { kind: 'human', id: 'ben' }, reason: 'change_of_details: address -> 19 Sourdough Lane, Ruddington', exception: null, since: '2026-09-13T10:00:02.000Z', notedOn: false, draft: 'Thanks Margaret, Ben will price 14 Beechdale Road.', failures: [], superseded: [] },
        releases: [{ approver: { kind: 'human', id: 'ben' }, words: 'Fine, tell Margaret Wilkinson Tuesday', at: '2026-09-13T10:05:00.000Z', reason: 'change_of_details: address -> 19 Sourdough Lane, Ruddington', turnsBefore: 1, asksBefore: { media: 0 } }],
        scopingFrom: 1,
        job: { type: 'tap repair', location: 'NG8 3EY', quoteRef: null, bookingRef: null },
        sends: [{ runId: 'run_1', approver: 'human:u-123', partyId: 'person_1', channel: 'whatsapp', windowState: 'open', templateId: null, bubbles: [{ text: 'Thanks Margaret, we will be in touch about 14 Beechdale Road.', gapMs: 0 }], factIds: ['fact_1'], kbIds: [], calls: [], at: '2026-09-13T10:00:03.000Z', mode: 'dry_run', partial: false, turnId: null }],
        sentRunIds: ['run_1'],
    };

    const caseFileTable = (): Table => ({
        table: 'comms_v2_case_files', primaryKey: ['id'],
        columns: [
            { column: 'id', dataType: 'text' },
            { column: 'stage', dataType: 'text' },
            { column: 'opened_at', dataType: 'timestamp with time zone' },
            { column: 'person_ids', dataType: 'ARRAY', elementType: 'text' },
            { column: 'file', dataType: 'jsonb' },
            { column: 'created_at', dataType: 'timestamp with time zone' },
            { column: 'updated_at', dataType: 'timestamp with time zone' },
        ],
        rows: [{ id: 'case_1', stage: 'scoping', person_ids: ['person_1'], file: structuredClone(REAL_FILE) }],
    });

    it('the migrated table is fully classified, so the scrub does not refuse it', async () => {
        const { client, writes } = fakeClient([caseFileTable()]);
        const report = await scrubDatabase(client, options({ dryRun: true }));
        expect(report.textualColumns).toBe(4);
        expect(report.tables.find((t) => t.table === 'comms_v2_case_files')?.columns.map((c) => c.column)).toEqual(['file']);
        expect(writes()).toEqual([]);
    });

    it('rewrites every identifying leaf and keeps what the desk reads back', async () => {
        const { client, writes } = fakeClient([caseFileTable()]);
        const report = await scrubDatabase(client, options());
        // A number held only inside the file still got a reserved one.
        expect(report.phonesAllocated).toBe(1);

        const update = writes().find((w) => w.sql.startsWith('update "comms_v2_case_files"'))!;
        expect(update.sql).toMatch(/set "file" = \$1::jsonb where "id" = \$2$/);
        const after = JSON.parse(update.params![0] as string) as typeof REAL_FILE;
        const text = JSON.stringify(after);

        for (const real of ['Margaret', 'Wilkinson', 'Beechdale', 'NG8 3EY', '07812345678', '7812345678', 'Sourdough', 'Ruddington']) {
            expect(text).not.toContain(real);
        }
        expect(residualsIn(text)).toEqual([]);

        const party = after.parties[0];
        expect(isSyntheticName(party.name)).toBe(true);
        expect(party.canonical.startsWith('phone:')).toBe(true);
        expect(isSyntheticPhone(party.canonical.slice('phone:'.length))).toBe(true);
        expect(party.channels[0].address.startsWith('+44')).toBe(true);
        expect(nationalDigits(party.channels[0].address)).toBe(party.canonical.slice('phone:'.length));
        expect(isSyntheticPostcode(after.job.location)).toBe(true);
        expect(after.facts[0].key).toBe('postcode');

        // What the desk reads back is untouched: shape, ids, enumerations, its own words.
        expect(Object.keys(after)).toEqual(Object.keys(REAL_FILE));
        expect(after.id).toBe('case_1');
        expect(party.personId).toBe('person_1');
        expect(after.stage).toBe('scoping');
        expect(after.ledger[0].subject).toBe('media');
        // The hold and release reason are free text, not kept: a customer's own words (here, a
        // change-of-details address) never survive into them.
        expect(after.hold!.reason).not.toBe(REAL_FILE.hold.reason);
        expect(after.releases[0].reason).not.toBe(REAL_FILE.releases[0].reason);
        expect(after.sends[0].approver).toBe('human:u-123');
        expect(after.sends[0].factIds).toEqual(['fact_1']);
        expect(after.turns[0].partyId).toBe('person_1');
        expect(after.turns[0].media[0].url).not.toBe(REAL_FILE.turns[0].media[0].url);
    });
});

describe('the CLI refuses before it connects', () => {
    const root = path.resolve(__dirname, '../../..');
    const cli = (args: string[], env: Record<string, string>) => spawnSync(
        process.execPath,
        [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'scripts/scrub-database.ts'), ...args],
        // A clean environment, so nothing from the test process can name a real database.
        { cwd: root, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } },
    );

    it('exits 2 when the named variable is unset', () => {
        const r = cli(['--dry-run', '--url-env', 'SCRUB_TEST_UNSET'], {});
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('SCRUB_TEST_UNSET is not set');
    }, 60_000);

    it('exits 3 on a production database, even for a dry run, and never prints the URL', () => {
        for (const flag of ['--confirm', '--dry-run', '--verify']) {
            const r = cli([flag, '--url-env', 'SCRUB_TEST_URL'], { SCRUB_TEST_URL: PRODUCTION_URL });
            expect(r.status).toBe(3);
            expect(r.stderr).toMatch(/refusing: the target is the production database/);
            expect(r.stdout + r.stderr).not.toContain('user:pass');
        }
    }, 120_000);

    it('exits 3 without --confirm', () => {
        const r = cli(['--url-env', 'SCRUB_TEST_URL'], { SCRUB_TEST_URL: THROWAWAY_URL });
        expect(r.status).toBe(3);
        expect(r.stderr).toMatch(/re-run with --confirm/);
    }, 60_000);
});
