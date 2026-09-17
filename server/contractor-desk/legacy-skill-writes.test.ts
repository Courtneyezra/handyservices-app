/**
 * The older skill writes stay working now that handyman_skills is unique on
 * (handyman_id, category_slug): a replace-all write that names a category twice stores it once
 * (its last entry), and the hub's add is an insert that does nothing on a conflict.
 *
 * The routers run bare (no admin guard; their guards have their own tests) over a fake database
 * that records every handyman_skills insert.
 */
import express, { type Router } from 'express';
import http from 'http';
import { describe, expect, it, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  inserts: [] as { values: Row; onConflict?: { kind: string; target: unknown } }[],
  contractorUser: { id: 'user-c1', role: 'contractor' } as Row,
}));

vi.mock('../db', async () => {
  const schema = await import('../../shared/schema');
  const profile = { id: 'c1', userId: 'user-c1' };
  const rowsFor = (table: unknown): Row[] => {
    if (table === schema.contractorSessions) return [{ sessionToken: 't', userId: 'user-c1', expiresAt: new Date(Date.now() + 60_000) }];
    if (table === schema.users) return [state.contractorUser];
    if (table === schema.handymanProfiles) return [profile];
    return [];
  };
  const chain = (resolve: () => unknown, onChain?: (m: string, arg: any) => void): any => {
    const p: any = { then: (ok: any, err: any) => Promise.resolve().then(resolve).then(ok, err) };
    for (const m of ['where', 'orderBy', 'limit', 'returning', 'innerJoin', 'leftJoin', 'onConflictDoUpdate', 'onConflictDoNothing']) {
      p[m] = (arg: any) => { onChain?.(m, arg); return p; };
    }
    return p;
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => chain(() => rowsFor(table)) }),
      insert: (table: unknown) => ({
        values: (values: Row) => {
          const entry: (typeof state.inserts)[number] = { values };
          if (table === schema.handymanSkills) state.inserts.push(entry);
          return chain(() => [], (m, arg) => {
            if (m.startsWith('onConflict')) entry.onConflict = { kind: m, target: arg?.target };
          });
        },
      }),
      update: () => ({ set: () => chain(() => []) }),
      delete: () => ({ where: () => chain(() => []) }),
      query: {
        users: { findFirst: async () => state.contractorUser },
        handymanProfiles: { findFirst: async () => profile },
      },
    },
  };
});
vi.mock('../lib/geocoding', () => ({ geocodeAddress: vi.fn(async () => null) }));
vi.mock('../services/auto-sku-generator', () => ({ AutoSkuGenerator: class {} }));
vi.mock('../roles', () => ({ invalidateRoleCache: vi.fn() }));

import { handymanSkills } from '../../shared/schema';
import adminContractorsRouter from '../admin-contractors-routes';
import contractorAuthRouter from '../contractor-auth';
import contractorHubRouter from '../contractor-hub-routes';

async function send(router: Router, method: string, path: string, body: unknown) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const stored = () => state.inserts.map((i) => ({ slug: i.values.categorySlug, proficiency: i.values.proficiency }));

beforeEach(() => { state.inserts = []; });

describe('replace-all skill writes store a repeated category once', () => {
  const skills = [
    { categorySlug: 'tiling', proficiency: 'basic' },
    { categorySlug: 'painting' },
    { categorySlug: 'tiling', proficiency: 'expert' },
  ];

  it('POST /api/admin/contractors', async () => {
    const res = await send(adminContractorsRouter, 'POST', '/', { firstName: 'Casey', lastName: 'Fixer', email: 'c@example.test', skills });
    expect(res.status).toBe(201);
    expect(stored().sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: 'painting', proficiency: 'competent' },
      { slug: 'tiling', proficiency: 'expert' },
    ]);
  });

  it('PUT /api/admin/contractors/:id', async () => {
    const res = await send(adminContractorsRouter, 'PUT', '/c1', { skills });
    expect(res.status).toBe(200);
    expect(stored().sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: 'painting', proficiency: 'competent' },
      { slug: 'tiling', proficiency: 'expert' },
    ]);
  });

  it('PUT /api/contractor/skills, where the category may come as the trade', async () => {
    const res = await send(contractorAuthRouter, 'PUT', '/skills', {
      services: [
        { trade: 'tiling', hourlyRatePence: 3000 },
        { categorySlug: 'painting', hourlyRatePence: 2500 },
        { categorySlug: 'tiling', hourlyRatePence: 4000 },
        { hourlyRatePence: 1000 },
      ],
    });
    expect(res.status).toBe(200);
    const rows = state.inserts.map((i) => ({ slug: i.values.categorySlug, hourlyRate: i.values.hourlyRate }));
    expect(rows.sort((a, b) => String(a.slug).localeCompare(String(b.slug)))).toEqual([
      { slug: null, hourlyRate: 10 },
      { slug: 'painting', hourlyRate: 25 },
      { slug: 'tiling', hourlyRate: 40 },
    ]);
  });
});

describe('POST /api/admin/contractor-hub/:id/skills', () => {
  it('inserts a competent row that does nothing when the category is already there', async () => {
    const res = await send(contractorHubRouter, 'POST', '/c1/skills', { categorySlug: 'tiling' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].values).toMatchObject({ handymanId: 'c1', categorySlug: 'tiling', proficiency: 'competent' });
    expect(state.inserts[0].onConflict).toEqual({
      kind: 'onConflictDoNothing',
      target: [handymanSkills.handymanId, handymanSkills.categorySlug],
    });
  });

  it('still refuses a missing slug', async () => {
    const res = await send(contractorHubRouter, 'POST', '/c1/skills', {});
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});
