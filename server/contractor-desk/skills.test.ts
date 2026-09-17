/**
 * Ben's skills tick list: the category list, the per-contractor read, the proficiency upsert and
 * the untick, with their refusals. The routes are mounted the way server/index.ts mounts them,
 * behind the real requireAdmin over `fake-db.ts`; the skill rows live in an in-memory SkillStore.
 * The database store is checked against the SQL it sends, through drizzle's pg-proxy driver.
 */
import express from 'express';
import http from 'http';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const proxy = { calls: [] as { sql: string; params: unknown[] }[], rows: [] as unknown[][] };

vi.mock('../db', async () => ({ db: (await import('./fake-db')).fakeDb }));

import * as schema from '../../shared/schema';
import { CATEGORY_LABELS } from '../../shared/categories';
import { requireAdmin } from '../auth';
import { createContractorDeskRouter } from './routes';
import { resetFakeRows } from './fake-db';
import {
  dbSkillStore,
  deskCategories,
  lastPerSlug,
  shapeSkills,
  type Proficiency,
  type SkillStore,
  type StoredSkillRow,
} from './skills';

type Row = StoredSkillRow & { handymanId: string; hourlyRate: number | null; dayRate: number | null };

const CONTRACTORS = new Set(['c1', 'c2']);
let rows: Row[] = [];
let writes = 0;

const memoryStore: SkillStore = {
  async contractorExists(id) { return CONTRACTORS.has(id); },
  async list(contractorId) { return rows.filter((r) => r.handymanId === contractorId); },
  async upsert(contractorId, slug, proficiency) {
    writes++;
    const found = rows.find((r) => r.handymanId === contractorId && r.categorySlug === slug);
    if (found) { found.proficiency = proficiency; return { created: false }; }
    rows.push({ handymanId: contractorId, categorySlug: slug, proficiency, hourlyRate: null, dayRate: null });
    return { created: true };
  },
  async remove(contractorId, slug) {
    writes++;
    const before = rows.length;
    rows = rows.filter((r) => !(r.handymanId === contractorId && r.categorySlug === slug));
    return { removed: rows.length < before };
  },
};

const staff = (id: string, role: string) => ({ id, email: `${id}@example.test`, role, isActive: true });

function seed(sessionUserId: string | null) {
  resetFakeRows({ users: [staff('admin-1', 'admin'), staff('va-1', 'va'), staff('user-c1', 'contractor')] }, sessionUserId);
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/contractor-desk', requireAdmin, createContractorDeskRouter(undefined, undefined, memoryStore));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/contractor-desk`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  seed('admin-1');
  writes = 0;
  rows = [
    { handymanId: 'c1', categorySlug: 'shelving', proficiency: 'expert', hourlyRate: 4000, dayRate: 20000 },
    { handymanId: 'c1', categorySlug: 'flat_pack', proficiency: null, hourlyRate: null, dayRate: null },
    { handymanId: 'c2', categorySlug: 'tiling', proficiency: 'basic', hourlyRate: null, dayRate: null },
  ];
});

async function call(method: string, route: string, body?: unknown, token: string | null = 'session-token') {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

describe('shaping', () => {
  it('lists every category once, with its label and trade, and no rate', () => {
    const cats = deskCategories();
    expect(cats.map((c) => c.slug).sort()).toEqual(Object.keys(CATEGORY_LABELS).sort());
    expect(cats).toHaveLength(24);
    expect(cats.find((c) => c.slug === 'tiling')).toEqual({ slug: 'tiling', label: 'Tiling', trade: 'tiling' });
    expect(cats.find((c) => c.slug === 'other')).toEqual({ slug: 'other', label: 'Other', trade: null });
  });

  it('shows known categories once in list order, reading an unknown proficiency as competent', () => {
    expect(shapeSkills([
      { categorySlug: 'tv_mounting', proficiency: 'expert' },
      { categorySlug: 'general_fixing', proficiency: 'wizard' },
      { categorySlug: 'tv_mounting', proficiency: 'basic' },
      { categorySlug: 'plumbing', proficiency: 'expert' },
      { categorySlug: null, proficiency: 'expert' },
    ])).toEqual([
      { slug: 'general_fixing', label: 'General Fixing', trade: 'handyman', proficiency: 'competent' },
      { slug: 'tv_mounting', label: 'TV Mounting', trade: 'handyman', proficiency: 'expert' },
    ]);
  });

  it('keeps the last entry per slug and every entry with no slug', () => {
    const out = lastPerSlug([
      { categorySlug: 'tiling', n: 1 },
      { categorySlug: null, n: 2 },
      { categorySlug: 'painting', n: 3 },
      { categorySlug: 'tiling', n: 4 },
      { n: 5 },
    ]);
    expect(out.map((s) => s.n).sort()).toEqual([2, 3, 4, 5]);
  });
});

describe.each([
  ['an admin', 'admin-1'],
  ['a VA', 'va-1'],
])('for %s session', (_label, userId) => {
  beforeEach(() => seed(userId));

  it('GET /categories answers the 24 categories', async () => {
    const res = await call('GET', '/categories');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ categories: deskCategories() });
    expect(res.text).not.toMatch(/rate|hourly/i);
  });

  it('GET /contractors/:id/skills answers the ticked categories without their rates', async () => {
    const res = await call('GET', '/contractors/c1/skills');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      skills: [
        { slug: 'flat_pack', label: 'Flat Pack Assembly', trade: 'handyman', proficiency: 'competent' },
        { slug: 'shelving', label: 'Shelving', trade: 'handyman', proficiency: 'expert' },
      ],
    });
    expect(res.text).not.toMatch(/rate|4000|20000/i);
  });

  it('PUT ticks a new category with 201', async () => {
    const res = await call('PUT', '/contractors/c1/skills/tiling', { proficiency: 'basic' });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ created: true, skill: { slug: 'tiling', label: 'Tiling', trade: 'tiling', proficiency: 'basic' } });
    expect(rows.filter((r) => r.handymanId === 'c1' && r.categorySlug === 'tiling')).toHaveLength(1);
  });

  it('PUT re-grades a ticked category with 200, leaving its stored rates alone', async () => {
    const res = await call('PUT', '/contractors/c1/skills/shelving', { proficiency: 'competent', hourlyRate: 1, dayRate: 2 });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(false);
    expect(res.json.skill.proficiency).toBe('competent');
    expect(rows.filter((r) => r.categorySlug === 'shelving')).toEqual([
      { handymanId: 'c1', categorySlug: 'shelving', proficiency: 'competent', hourlyRate: 4000, dayRate: 20000 },
    ]);
  });

  it('DELETE unticks a category and says whether anything was removed', async () => {
    expect((await call('DELETE', '/contractors/c1/skills/shelving')).json).toEqual({ removed: true });
    expect(rows.map((r) => r.categorySlug)).toEqual(['flat_pack', 'tiling']);
    const again = await call('DELETE', '/contractors/c1/skills/shelving');
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ removed: false });
    expect(rows.find((r) => r.handymanId === 'c2')?.categorySlug).toBe('tiling');
  });
});

describe('refusals', () => {
  const ROUTES: [string, string, unknown?][] = [
    ['GET', '/categories'],
    ['GET', '/contractors/c1/skills'],
    ['PUT', '/contractors/c1/skills/tiling', { proficiency: 'expert' }],
    ['DELETE', '/contractors/c1/skills/shelving'],
  ];

  it.each(ROUTES)('%s %s refuses a request with no session', async (method, route, body) => {
    const res = await call(method, route, body, null);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Authentication required' });
    expect(writes).toBe(0);
  });

  it.each(ROUTES)('%s %s refuses a token with no live session', async (method, route, body) => {
    seed(null);
    const res = await call(method, route, body, 'stale-token');
    expect(res.status).toBe(401);
    expect(writes).toBe(0);
  });

  it.each(ROUTES)('%s %s refuses a contractor session', async (method, route, body) => {
    seed('user-c1');
    const res = await call(method, route, body);
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Admin access required' });
    expect(writes).toBe(0);
  });

  it.each([
    ['PUT', 'plumbing', { proficiency: 'expert' }],
    ['PUT', 'SHELVING', { proficiency: 'expert' }],
    ['PUT', '__proto__', { proficiency: 'expert' }],
    ['DELETE', 'plumbing', undefined],
  ])('%s refuses the unknown category %s with 400', async (method, slug, body) => {
    const res = await call(method, `/contractors/c1/skills/${slug}`, body);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Unknown category' });
    expect(writes).toBe(0);
  });

  it.each([
    [{}],
    [{ proficiency: 'master' }],
    [{ proficiency: 3 }],
    [{ proficiency: 'Expert' }],
    [undefined],
  ])('PUT refuses the body %j with 400', async (body) => {
    const res = await call('PUT', '/contractors/c1/skills/tiling', body);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'proficiency must be basic, competent or expert' });
    expect(writes).toBe(0);
  });

  it.each([
    ['GET', '/contractors/nobody/skills', undefined],
    ['PUT', '/contractors/nobody/skills/tiling', { proficiency: 'basic' }],
    ['DELETE', '/contractors/nobody/skills/tiling', undefined],
  ])('%s %s answers 404 for an unknown contractor and writes nothing', async (method, route, body) => {
    const res = await call(method, route, body);
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'Contractor not found' });
    expect(writes).toBe(0);
    expect(rows).toHaveLength(3);
  });

  it('a store failure is a 500 with no detail', async () => {
    const failing: SkillStore = { ...memoryStore, upsert: async () => { throw new Error('db exploded: secret'); } };
    const app = express();
    app.use(express.json());
    app.use('/d', createContractorDeskRouter(undefined, undefined, failing));
    const s = http.createServer(app);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await fetch(`http://127.0.0.1:${(s.address() as { port: number }).port}/d/contractors/c1/skills/tiling`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proficiency: 'basic' }),
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Failed to save skill' });
    } finally {
      spy.mockRestore();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

describe('dbSkillStore SQL', () => {
  const proxyDb = drizzle(async (sql, params) => {
    proxy.calls.push({ sql, params });
    return { rows: proxy.rows };
  }, { schema });

  beforeEach(async () => {
    proxy.calls = [];
    proxy.rows = [];
    const dbModule: any = await import('../db');
    for (const k of ['select', 'insert', 'delete']) dbModule.db[k] = proxyDb[k as 'select'].bind(proxyDb);
  });
  afterAll(async () => {
    const dbModule: any = await import('../db');
    for (const k of ['insert', 'delete']) delete dbModule.db[k];
    dbModule.db.select = (await import('./fake-db')).fakeDb.select;
  });

  it('upserts on (handyman_id, category_slug) and sets only the proficiency', async () => {
    proxy.rows = [[true]];
    expect(await dbSkillStore.upsert('c1', 'tiling', 'expert' as Proficiency)).toEqual({ created: true });
    const [{ sql, params }] = proxy.calls;
    expect(sql).toMatch(/^insert into "handyman_skills"/);
    expect(sql).toMatch(/on conflict \("handyman_id","category_slug"\) do update set "proficiency" = \$\d+/);
    expect(sql).not.toMatch(/do update set .*rate/);
    expect(sql).toMatch(/returning \(xmax = 0\)/);
    expect(params).toEqual(expect.arrayContaining(['c1', 'tiling', 'expert']));

    proxy.rows = [[false]];
    expect(await dbSkillStore.upsert('c1', 'tiling', 'basic')).toEqual({ created: false });
  });

  it('removes only the one category of the one contractor', async () => {
    proxy.rows = [['s1']];
    expect(await dbSkillStore.remove('c1', 'tiling')).toEqual({ removed: true });
    const [{ sql, params }] = proxy.calls;
    expect(sql).toMatch(/^delete from "handyman_skills" where \("handyman_skills"."handyman_id" = \$1 and "handyman_skills"."category_slug" = \$2\)/);
    expect(params).toEqual(['c1', 'tiling']);
    proxy.rows = [];
    expect(await dbSkillStore.remove('c1', 'tiling')).toEqual({ removed: false });
  });

  it('reads slug and proficiency only, never a rate', async () => {
    proxy.rows = [['tiling', 'basic']];
    expect(await dbSkillStore.list('c1')).toEqual([{ categorySlug: 'tiling', proficiency: 'basic' }]);
    expect(proxy.calls[0].sql).toMatch(/^select "category_slug", "proficiency" from "handyman_skills"/);
    expect(proxy.calls[0].sql).not.toMatch(/rate/);
  });

  it('checks the contractor by id', async () => {
    proxy.rows = [];
    expect(await dbSkillStore.contractorExists('nobody')).toBe(false);
    proxy.rows = [['c1']];
    expect(await dbSkillStore.contractorExists('c1')).toBe(true);
    expect(proxy.calls[0].params).toEqual(['nobody', 1]);
  });
});
