/**
 * The in-process door connects only to the judge's own database. It refuses to open without
 * COMMS_V2_JUDGE_DATABASE_URL or when that names the production database, never reads
 * DATABASE_URL, and names no variable's value.
 */
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTION_DB_HOST_MARKER } from '../../worker-gate';
import { DoorError, JUDGE_DATABASE_ENV, openDoor } from './door';

const seen = vi.hoisted(() => ({ databaseUrlAtImport: null as string | null | undefined, imports: 0 }));

vi.mock('../../spine/sandbox-routes', async () => {
    seen.imports++;
    seen.databaseUrlAtImport = process.env.DATABASE_URL;
    const { Router } = await import('express');
    return { commsSandboxRouter: Router() };
});

const PRODUCTION = 'postgres://prod-user:prod-secret@prod.example/prod';
const BRANCH = 'postgres://branch-user:branch-secret@branch.example/judge';

describe('openDoor in-process', () => {
    afterEach(() => { vi.unstubAllEnvs(); seen.imports = 0; seen.databaseUrlAtImport = null; });

    it('refuses without the judge database, leaves DATABASE_URL alone, and names neither value', async () => {
        vi.stubEnv('COMMS_V2_DOOR_URL', '');
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
        vi.stubEnv('COMMS_V2_DOOR_URL', '');
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

    it('opens on the judge database, which is what the router sees at import, and reports host only', async () => {
        vi.stubEnv('COMMS_V2_DOOR_URL', '');
        vi.stubEnv(JUDGE_DATABASE_ENV, BRANCH);
        vi.stubEnv('DATABASE_URL', PRODUCTION);
        const door = await openDoor();
        try {
            expect(seen.imports).toBe(1);
            expect(seen.databaseUrlAtImport).toBe(BRANCH);
            expect(process.env.DATABASE_URL).toBe(BRANCH);
            expect(door.mode).toBe('in_process');
            expect(door.host).toMatch(/^127\.0\.0\.1:\d+$/);
        } finally {
            await door.close();
        }
    });
});

describe('openDoor over HTTP', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('needs no database and carries the host, not the URL', async () => {
        vi.stubEnv(JUDGE_DATABASE_ENV, '');
        const door = await openDoor({ url: 'http://door.example:5000/api/comms-sandbox', token: 't' });
        expect(door.mode).toBe('http');
        expect(door.host).toBe('door.example:5000');
        await door.close();
    });

    it('refuses a door URL that is not absolute', async () => {
        const err = await openDoor({ url: 'not a url' }).catch((e) => e);
        expect(err).toBeInstanceOf(DoorError);
        expect(err.kind).toBe('refused');
        expect(err.message).not.toContain('not a url');
    });

    it('reaches a running server on the loopback', async () => {
        const app = express();
        app.get('/api/comms-sandbox/', (_req, res) => { res.json({ ok: true, state: {} }); });
        const server = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const port = (server.address() as { port: number }).port;
        try {
            const door = await openDoor({ url: `http://127.0.0.1:${port}/api/comms-sandbox` });
            expect(await door.state()).toEqual({ ok: true, state: {} });
            await door.close();
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
