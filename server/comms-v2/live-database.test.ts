/**
 * The refusal every live dependency of the new desk makes first: the database in use must be the
 * branch COMMS_V2_DATABASE_URL names. The case that matters is the deployed server, where the
 * sandbox door is mounted on the production database and used to write real quote rows.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCTION_DB_HOST_MARKER } from '../worker-gate';
import { COMMS_V2_DATABASE_ENV } from './desk/door-host';
import { CommsV2DatabaseRefused, IN_USE_DATABASE_ENV, assertCommsV2Database, commsV2DatabaseCheck } from './live-database';
import { liveQuoteStore } from './quoting/quote-store';

const BRANCH = 'postgres://user:secret@ep-branch-example.eu-west-2.aws.neon.tech/neondb?sslmode=require';
const BRANCH_POOLED = 'postgres://user:secret@ep-branch-example-pooler.eu-west-2.aws.neon.tech/neondb';
const OTHER_BRANCH = 'postgres://user:secret@ep-other-branch.eu-west-2.aws.neon.tech/neondb';
const PROD = `postgres://user:secret@${PRODUCTION_DB_HOST_MARKER}-a1b2.eu-west-2.aws.neon.tech/neondb`;

const env = (over: Record<string, string>) => over as NodeJS.ProcessEnv;

describe('commsV2DatabaseCheck', () => {
    it('refuses a production connection, naming the requirement and no value', () => {
        const r = commsV2DatabaseCheck(env({ [COMMS_V2_DATABASE_ENV]: BRANCH, [IN_USE_DATABASE_ENV]: PROD }));
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toBe('production');
            expect(r.message).toContain(COMMS_V2_DATABASE_ENV);
            expect(r.message).not.toContain('secret');
        }
    });

    it('refuses a database in use that is a different branch from the one named', () => {
        const r = commsV2DatabaseCheck(env({ [COMMS_V2_DATABASE_ENV]: BRANCH, [IN_USE_DATABASE_ENV]: OTHER_BRANCH }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('not_the_branch');
    });

    it('refuses when the desk variable is unset, whatever is in use', () => {
        const r = commsV2DatabaseCheck(env({ [IN_USE_DATABASE_ENV]: BRANCH }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('missing');
    });

    it('refuses when the desk variable itself names production', () => {
        const r = commsV2DatabaseCheck(env({ [COMMS_V2_DATABASE_ENV]: PROD, [IN_USE_DATABASE_ENV]: PROD }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('production');
    });

    it('refuses when nothing is in use to check against', () => {
        const r = commsV2DatabaseCheck(env({ [COMMS_V2_DATABASE_ENV]: BRANCH }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('not_the_branch');
    });

    it('allows the branch it names, pooler suffix and parameters aside', () => {
        expect(commsV2DatabaseCheck(env({ [COMMS_V2_DATABASE_ENV]: BRANCH, [IN_USE_DATABASE_ENV]: BRANCH_POOLED }))).toEqual({ ok: true });
    });
});

describe('assertCommsV2Database', () => {
    it('throws a refusal that names who asked', () => {
        expect(() => assertCommsV2Database('the quote store', env({ [COMMS_V2_DATABASE_ENV]: BRANCH, [IN_USE_DATABASE_ENV]: PROD })))
            .toThrow(/the quote store refused/);
    });
});

describe('the live quote store', () => {
    /**
     * The deployed server mounts the sandbox door (/api/comms-v2/sandbox) on the production
     * database. Every method refuses there rather than opening it, so no real quote row is written
     * and no quote page is published with real prices on it.
     */
    const onProduction = async <T>(run: () => Promise<T>): Promise<unknown> => {
        const before = { [COMMS_V2_DATABASE_ENV]: process.env[COMMS_V2_DATABASE_ENV], [IN_USE_DATABASE_ENV]: process.env[IN_USE_DATABASE_ENV] };
        process.env[COMMS_V2_DATABASE_ENV] = BRANCH;
        process.env[IN_USE_DATABASE_ENV] = PROD;
        try {
            return await run().then(() => null, (err) => err);
        } finally {
            for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    };

    it('refuses every method on a production-shaped connection', async () => {
        const calls: Array<[string, () => Promise<unknown>]> = [
            ['read', () => liveQuoteStore.read('abc123')],
            ['insertDraft', () => liveQuoteStore.insertDraft({ id: 'q1', shortSlug: 'abc123' })],
            ['price', () => liveQuoteStore.price('abc123', { by: 'human:ben' })],
            ['markSent', () => liveQuoteStore.markSent('abc123')],
            ['accept', () => liveQuoteStore.accept('abc123', new Date())],
            ['addPhotos', () => liveQuoteStore.addPhotos('abc123', ['https://example.test/a.jpg'])],
            ['deleteSandbox', () => liveQuoteStore.deleteSandbox('+447700900942')],
        ];
        for (const [name, call] of calls) {
            const thrown = await onProduction(call);
            expect(thrown, `${name} opened the database instead of refusing`).toBeInstanceOf(CommsV2DatabaseRefused);
            expect(String((thrown as Error).message)).toContain(COMMS_V2_DATABASE_ENV);
        }
    });
});
