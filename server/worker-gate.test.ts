import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isCommsWorker, isProductionDatabaseUrl, databaseHostOf, describeWorkerState,
    assertCommsWorkerAtBoot, gateCustomerLoop, skippedLoops, PRODUCTION_DB_HOST_MARKER,
} from './worker-gate';

const PROD_URL = `postgresql://user:secret@${PRODUCTION_DB_HOST_MARKER}-a1b2c3.eu-west-2.aws.neon.tech/neondb?sslmode=require`;
const BRANCH_URL = 'postgresql://user:secret@ep-quiet-lake-x9y8z7.eu-west-2.aws.neon.tech/neondb?sslmode=require';

describe('isCommsWorker', () => {
    it('is true only for the literal "1"', () => {
        expect(isCommsWorker({ COMMS_WORKER: '1' })).toBe(true);
        expect(isCommsWorker({ COMMS_WORKER: 'true' })).toBe(false);
        expect(isCommsWorker({ COMMS_WORKER: '' })).toBe(false);
        expect(isCommsWorker({})).toBe(false);
    });
});

describe('production database detection', () => {
    it('recognises the production Neon host and nothing else', () => {
        expect(isProductionDatabaseUrl(PROD_URL)).toBe(true);
        expect(isProductionDatabaseUrl(BRANCH_URL)).toBe(false);
        expect(isProductionDatabaseUrl(undefined)).toBe(false);
        expect(isProductionDatabaseUrl('')).toBe(false);
    });
    it('reports only the host, never credentials', () => {
        const host = databaseHostOf(PROD_URL)!;
        expect(host).toContain(PRODUCTION_DB_HOST_MARKER);
        expect(host).not.toContain('secret');
        expect(databaseHostOf('not a url')).toBeNull();
    });
});

describe('describeWorkerState', () => {
    it('production + flag = worker', () => {
        const s = describeWorkerState({ NODE_ENV: 'production', COMMS_WORKER: '1', DATABASE_URL: PROD_URL });
        expect(s.role).toBe('worker');
        expect(s.production).toBe(true);
        expect(s.summary).toMatch(/loops run here/);
    });
    it('production without the flag is the 31 Aug failure mode, named as such', () => {
        const s = describeWorkerState({ NODE_ENV: 'production', DATABASE_URL: PROD_URL });
        expect(s.role).toBe('passive');
        expect(s.summary).toMatch(/COMMS_WORKER absent on production/);
    });
    it('dev on the production DB is called out', () => {
        const s = describeWorkerState({ NODE_ENV: 'development', DATABASE_URL: PROD_URL });
        expect(s.pointedAtProductionDb).toBe(true);
        expect(s.role).toBe('passive');
        expect(s.summary).toMatch(/PRODUCTION database/);
    });
    it('dev on a branch is a plain passive process', () => {
        const s = describeWorkerState({ NODE_ENV: 'development', DATABASE_URL: BRANCH_URL });
        expect(s.pointedAtProductionDb).toBe(false);
        expect(s.summary).toMatch(/passive process/);
    });
});

describe('assertCommsWorkerAtBoot', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('pages when production boots without the flag', async () => {
        const notify = vi.fn(async () => {});
        await assertCommsWorkerAtBoot({ NODE_ENV: 'production', DATABASE_URL: PROD_URL }, notify);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toBe('COMMS_WORKER flag absent on production: no sweeps will run');
        expect(console.error).toHaveBeenCalled();
    });

    it('does not page a correctly flagged production worker', async () => {
        const notify = vi.fn(async () => {});
        await assertCommsWorkerAtBoot({ NODE_ENV: 'production', COMMS_WORKER: '1', DATABASE_URL: PROD_URL }, notify);
        expect(notify).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('warns loudly (no page) when a dev process is on the production DB', async () => {
        const notify = vi.fn(async () => {});
        await assertCommsWorkerAtBoot({ NODE_ENV: 'development', DATABASE_URL: PROD_URL }, notify);
        expect(notify).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(String((console.warn as any).mock.calls[0][0])).toMatch(/PRODUCTION DATABASE/);
    });

    it('never throws, even if paging throws', async () => {
        const notify = vi.fn(async () => { throw new Error('pushover down'); });
        await expect(assertCommsWorkerAtBoot({ NODE_ENV: 'production' }, notify)).resolves.toMatchObject({ role: 'passive' });
    });
});

describe('gateCustomerLoop', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => vi.restoreAllMocks());

    it('registers only in the worker', () => {
        const register = vi.fn();
        expect(gateCustomerLoop('loop A', register, { COMMS_WORKER: '1' })).toBe(true);
        expect(register).toHaveBeenCalledTimes(1);
    });

    it('skips, logs once, and records the skipped loop elsewhere', () => {
        const register = vi.fn();
        const before = skippedLoops().length;
        expect(gateCustomerLoop('loop B', register, {})).toBe(false);
        expect(register).not.toHaveBeenCalled();
        expect(skippedLoops().slice(before)).toEqual(['loop B']);
        expect(console.log).toHaveBeenCalledTimes(1);
        expect(String((console.log as any).mock.calls[0][0])).toMatch(/SKIPPED "loop B"/);
    });
});
