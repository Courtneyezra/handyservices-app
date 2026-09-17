/**
 * /partner/login's code login lets in only a contractor an admin has activated, looks the code up by
 * its hash (or the plain code stored before hashing), rehashes a plain code on login, and never takes
 * a stored hash as a code. The login picker and the password login hold the same activation rule.
 *
 * The fake database answers each select with `state.rows` and records the WHERE it was given, which
 * the tests render to SQL to see what the route asked for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
    rows: [] as Row[],
    wheres: [] as unknown[],
    updates: [] as { values: Row; where: unknown }[],
    inserts: [] as unknown[],
}));

vi.mock('./db', () => {
    const chain = (resolve: () => unknown): any => {
        const p: any = { then: (ok: any, err: any) => Promise.resolve().then(resolve).then(ok, err) };
        for (const m of ['orderBy', 'limit', 'innerJoin', 'leftJoin', 'returning']) p[m] = () => p;
        return p;
    };
    const selectChain = (): any => {
        const p: any = chain(() => state.rows);
        p.from = () => p;
        p.where = (w: unknown) => { state.wheres.push(w); return p; };
        return p;
    };
    return {
        db: {
            select: () => selectChain(),
            insert: () => ({ values: (v: unknown) => chain(() => { state.inserts.push(v); return []; }) }),
            update: () => ({
                set: (values: Row) => ({
                    where: (where: unknown) => chain(() => { state.updates.push({ values, where }); return []; }),
                }),
            }),
            delete: () => ({ where: () => chain(() => []) }),
        },
    };
});
vi.mock('./lib/geocoding', () => ({ geocodeAddress: vi.fn() }));
vi.mock('./services/auto-sku-generator', () => ({ AutoSkuGenerator: class {} }));

import bcrypt from 'bcrypt';
import contractorAuthRouter from './contractor-auth';
import { hashAccessCode } from './lib/contractor-access';

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

let ipSeq = 0;
async function call(method: 'GET' | 'POST', route: string, body?: unknown) {
    const app = express();
    app.use(express.json());
    app.use('/api/contractor', contractorAuthRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/contractor${route}`, {
            method,
            // A fresh client per request, so the brute-force lock never interferes.
            headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++ipSeq % 250}` },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

const contractor = (over: Row = {}): Row => ({
    profileId: 'c1', appToken: 'APP-TOKEN-0123456789abcdef', accessCode: hashAccessCode('12345678'),
    activatedAt: new Date('2026-09-01T00:00:00Z'), firstName: 'Casey', lastName: 'Fixer', isActive: true,
    imageUrl: null, heroUrl: null,
    ...over,
});

beforeEach(() => {
    state.rows = [];
    state.wheres = [];
    state.updates = [];
    state.inserts = [];
});

describe('POST /api/contractor/code-login', () => {
    it('lets an activated contractor in, looking the code up by its hash or the plain code', async () => {
        state.rows = [contractor()];
        const res = await call('POST', '/code-login', { code: '12345678' });
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ success: true, firstName: 'Casey', appToken: 'APP-TOKEN-0123456789abcdef' });
        expect(res.json.accessCode).toBeUndefined();
        const q = render(state.wheres[0]);
        expect(q.sql).toContain('"access_code" in');
        expect(q.params).toEqual([hashAccessCode('12345678'), '12345678']);
        expect(state.updates).toEqual([]);
    });

    it('refuses a self-signed-up contractor an admin has not activated, and mints them no app link', async () => {
        state.rows = [contractor({ activatedAt: null, appToken: null })];
        const res = await call('POST', '/code-login', { code: '12345678' });
        expect(res.status).toBe(403);
        expect(res.json).toEqual({ error: 'Account is not active yet' });
        expect(state.updates).toEqual([]);
    });

    it('still refuses a deactivated account', async () => {
        state.rows = [contractor({ isActive: false })];
        const res = await call('POST', '/code-login', { code: '12345678' });
        expect(res.status).toBe(403);
        expect(res.json).toEqual({ error: 'Account is deactivated' });
    });

    it('rehashes a code stored before hashing on a successful login', async () => {
        state.rows = [contractor({ accessCode: '4321' })];
        const res = await call('POST', '/code-login', { code: '4321' });
        expect(res.status).toBe(200);
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0].values.accessCode).toBe(hashAccessCode('4321'));
        // Only while the row still holds that plain code.
        expect(render(state.updates[0].where).params).toEqual(['c1', '4321']);
    });

    it('takes a stored hash as no code at all', async () => {
        state.rows = [contractor()];
        const res = await call('POST', '/code-login', { code: hashAccessCode('12345678') });
        expect(res.status).toBe(401);
        expect(state.wheres).toEqual([]);
    });

    it('refuses a code nobody holds', async () => {
        const res = await call('POST', '/code-login', { code: '00000000' });
        expect(res.status).toBe(401);
        expect(res.json).toEqual({ error: 'Name or code not recognised' });
    });
});

describe('GET /api/contractor/roster', () => {
    it('lists only contractors an admin has activated', async () => {
        state.rows = [{ id: 'c1', firstName: 'Casey', imageUrl: null, heroUrl: null }];
        const res = await call('GET', '/roster');
        expect(res.status).toBe(200);
        expect(render(state.wheres[0]).sql).toContain('"activated_at" is not null');
    });
});

describe('POST /api/contractor/login', () => {
    const passwordHash = bcrypt.hashSync('correct-horse', 4);
    const user = { id: 'user-c1', email: 'casey@example.test', firstName: 'Casey', lastName: 'Fixer', role: 'contractor', isActive: true, password: passwordHash };

    it('signs a contractor who is not activated in without a field-app link', async () => {
        state.rows = [{ ...user, id: 'c1', userId: 'user-c1', appToken: null, activatedAt: null }];
        const res = await call('POST', '/login', { email: 'casey@example.test', password: 'correct-horse' });
        expect(res.status).toBe(200);
        expect(res.json.appToken).toBeNull();
        expect(state.updates.some((u) => 'appToken' in u.values)).toBe(false);
    });

    it('gives an activated contractor their field-app link', async () => {
        state.rows = [{ ...user, id: 'c1', userId: 'user-c1', appToken: 'APP-TOKEN-0123456789abcdef', activatedAt: new Date() }];
        const res = await call('POST', '/login', { email: 'casey@example.test', password: 'correct-horse' });
        expect(res.status).toBe(200);
        expect(res.json.appToken).toBe('APP-TOKEN-0123456789abcdef');
    });
});
