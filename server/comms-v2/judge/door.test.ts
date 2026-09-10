/**
 * The door connects only to the judge's own database. It refuses to open without
 * COMMS_V2_JUDGE_DATABASE_URL or when that names the production database, never reads
 * DATABASE_URL, and names no variable's value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTION_DB_HOST_MARKER } from '../../worker-gate';
import { DoorError, JUDGE_DATABASE_ENV, openDoor } from './door';

const seen = vi.hoisted(() => ({ databaseUrlAtImport: null as string | null | undefined, imports: 0 }));

vi.mock('../../spine/sandbox-routes', async () => {
    seen.imports++;
    seen.databaseUrlAtImport = process.env.DATABASE_URL;
    const { Router } = await import('express');
    const router = Router();
    router.get('/', (_req, res) => { res.json({ ok: true, state: {} }); });
    return { commsSandboxRouter: router };
});

const PRODUCTION = 'postgres://prod-user:prod-secret@prod.example/prod';
const BRANCH = 'postgres://branch-user:branch-secret@branch.example/judge';

describe('openDoor', () => {
    afterEach(() => { vi.unstubAllEnvs(); seen.imports = 0; seen.databaseUrlAtImport = null; });

    it('refuses without the judge database, leaves DATABASE_URL alone, and names neither value', async () => {
        vi.stubEnv(JUDGE_DATABASE_ENV, '');
        vi.stubEnv('DATABASE_URL', PRODUCTION);
        const err = await openDoor().catch((e) => e);
        expect(err).toBeInstanceOf(DoorError);
        expect(err.kind).toBe('refused');
        expect(err.message).toContain(JUDGE_DATABASE_ENV);
        expect(err.message).not.toContain('prod');
        expect(seen.imports).toBe(0);
        expect(process.env.DATABASE_URL).toBe(PRODUCTION);
    });

    it('refuses a judge database that names the production project, and neither imports the router nor touches DATABASE_URL', async () => {
        const productionInJudgeVar = `postgres://prod-user:prod-secret@${PRODUCTION_DB_HOST_MARKER}-a1b2c3.eu-west-2.aws.neon.tech/prod`;
        vi.stubEnv(JUDGE_DATABASE_ENV, productionInJudgeVar);
        vi.stubEnv('DATABASE_URL', BRANCH);
        const err = await openDoor().catch((e) => e);
        expect(err).toBeInstanceOf(DoorError);
        expect(err.kind).toBe('refused');
        expect(err.message).toContain(JUDGE_DATABASE_ENV);
        expect(err.message).not.toContain('prod-secret');
        expect(err.message).not.toContain(PRODUCTION_DB_HOST_MARKER);
        expect(seen.imports).toBe(0);
        expect(process.env.DATABASE_URL).toBe(BRANCH);
    });

    it('opens on the judge database, which is what the router sees at import, reports host only, and reaches the router over the loopback', async () => {
        vi.stubEnv(JUDGE_DATABASE_ENV, BRANCH);
        vi.stubEnv('DATABASE_URL', PRODUCTION);
        const door = await openDoor();
        try {
            expect(seen.imports).toBe(1);
            expect(seen.databaseUrlAtImport).toBe(BRANCH);
            expect(process.env.DATABASE_URL).toBe(BRANCH);
            expect(door.mode).toBe('in_process');
            expect(door.host).toMatch(/^127\.0\.0\.1:\d+$/);
            expect(await door.state()).toEqual({ ok: true, state: {} });
        } finally {
            await door.close();
        }
    });

    it('ignores any door URL in the environment: there is no door to a running server', async () => {
        vi.stubEnv('COMMS_V2_DOOR_URL', 'http://door.example:5000/api/comms-sandbox');
        vi.stubEnv(JUDGE_DATABASE_ENV, '');
        const err = await openDoor().catch((e) => e);
        expect(err).toBeInstanceOf(DoorError);
        expect(err.kind).toBe('refused');
        expect(seen.imports).toBe(0);
    });
});
