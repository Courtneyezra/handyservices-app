/**
 * The contractor desk's write routes: adding a contractor, activating and deactivating one, issuing
 * the /partner/login code and the app link.
 *
 * Mounted the way server/index.ts mounts them, behind the real requireAdmin (over `fake-db.ts`), with
 * an in-memory store and roster source, so each test sees exactly what a route wrote.
 */
import express from 'express';
import http from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', async () => ({ db: (await import('./fake-db')).fakeDb }));
vi.mock('../lib/geocoding', () => ({ geocodeAddress: vi.fn() }));

import { requireAdmin } from '../auth';
import { hashAccessCode } from '../lib/contractor-access';
import type { ContractorDeskStore, NewContractor } from './access-store';
import { resetFakeRows } from './fake-db';
import { placeholderEmail } from './no-email';
import type { RosterProfileRow } from './roster';
import { createContractorDeskRouter } from './routes';

interface Stored {
  profile: RosterProfileRow;
  accessCode: string | null;
  appToken: string | null;
  activatedBy: string | null;
}

const contractors = new Map<string, Stored>();
const calls = { create: [] as NewContractor[], setActivation: 0, setAccessCode: 0, ensureAppToken: 0 };
const taken = { email: false, phone: false };
let accessCodeInUse: (values: string[], exceptId: string) => boolean = () => false;
let setAccessCodeFails: number = 0;

function profileRow(id: string, over: Partial<RosterProfileRow> = {}): RosterProfileRow {
  return {
    id, userId: `user-${id}`, firstName: 'Sam', lastName: 'Signup', email: 'sam@example.test', phone: '+447700900555',
    accountActive: true, businessName: null, bio: null, city: null, postcode: null, radiusMiles: 10, slug: null,
    profileImageUrl: null, heroImageUrl: null, publicProfileEnabled: true, availabilityStatus: 'available',
    lastAvailabilityRefresh: null, deliveryTier: 'adhoc', vertical: 'handyman', deliveryPriority: null,
    vehicleType: null, verificationStatus: 'unverified', publicLiabilityInsuranceUrl: null,
    publicLiabilityExpiryDate: null, dbsCertificateUrl: null, identityDocumentUrl: null,
    partnerStatus: 'not_started', partnerActivatedAt: null, activatedAt: null,
    hasAccessCode: false, hasAppLink: false, createdAt: null,
    ...over,
  };
}

const store: ContractorDeskStore = {
  async find(id) {
    const c = contractors.get(id);
    return c ? { id, activatedAt: c.profile.activatedAt } : null;
  },
  async contactInUse() { return { ...taken }; },
  async create(input) {
    calls.create.push(input);
    const id = `new-${calls.create.length}`;
    contractors.set(id, {
      profile: profileRow(id, {
        firstName: input.firstName, lastName: input.lastName, phone: input.phone,
        email: input.email ?? placeholderEmail(id), deliveryTier: input.deliveryTier, vertical: input.vertical,
        deliveryPriority: input.deliveryPriority, businessName: input.businessName, postcode: input.postcode,
        city: input.city, activatedAt: new Date('2026-09-17T09:00:00Z'),
      }),
      accessCode: null, appToken: null, activatedBy: input.activatedBy,
    });
    return id;
  },
  async setActivation(id, activation) {
    calls.setActivation++;
    const c = contractors.get(id);
    if (!c) return false;
    c.profile.activatedAt = activation?.at ?? null;
    c.activatedBy = activation?.by ?? null;
    return true;
  },
  async accessCodeInUse(values, exceptId) { return accessCodeInUse(values, exceptId); },
  async setAccessCode(id, stored) {
    calls.setAccessCode++;
    if (setAccessCodeFails > 0) {
      setAccessCodeFails--;
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    }
    const c = contractors.get(id)!;
    c.accessCode = stored;
    c.profile.hasAccessCode = true;
  },
  async ensureAppToken(id) {
    calls.ensureAppToken++;
    const c = contractors.get(id)!;
    c.appToken ??= 'APP-TOKEN-abcdefghijklmnop';
    c.profile.hasAppLink = true;
    return c.appToken;
  },
};

const source = {
  async load(ids: string[] | null) {
    const rows = [...contractors.values()].map((c) => ({ ...c.profile }));
    return { profiles: ids ? rows.filter((r) => ids.includes(r.id)) : rows, bookings: [], skills: [] };
  },
};
const clock = { today: () => '2026-09-17', weekStart: () => '2026-09-14' };

const staff = (id: string, role: string) => ({ id, email: `${id}@example.test`, firstName: id, lastName: 'Staff', role, isActive: true });

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/contractor-desk', requireAdmin, createContractorDeskRouter(source, clock, store));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function signIn(userId: string | null) {
  resetFakeRows({
    users: [staff('admin-1', 'admin'), staff('va-1', 'va'), staff('user-self', 'contractor')],
  }, userId);
}

beforeEach(() => {
  contractors.clear();
  contractors.set('self', { profile: profileRow('self'), accessCode: null, appToken: null, activatedBy: null });
  calls.create = []; calls.setActivation = 0; calls.setAccessCode = 0; calls.ensureAppToken = 0;
  taken.email = false; taken.phone = false;
  accessCodeInUse = () => false;
  setAccessCodeFails = 0;
  signIn('admin-1');
});

async function post(route: string, body?: unknown, token: string | null = 'session-token') {
  const res = await fetch(`${base}/api/admin/contractor-desk${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text), headers: res.headers };
}

const SECRET_KEYS = /password|hash|widgettoken|apptoken|accesscode|synctoken/i;
const ALLOWED_KEYS = new Set(['hasAccessCode', 'hasAppLink']);
function secretKeysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(secretKeysIn);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(SECRET_KEYS.test(k) && !ALLOWED_KEYS.has(k) ? [k] : []),
    ...secretKeysIn(v),
  ]);
}

const VALID_ADD = { firstName: 'Robin', lastName: 'Builder', phone: '07700 900123', vertical: 'handyman', deliveryTier: 'core' };

const WRITES: Array<[string, unknown]> = [
  ['/contractors', VALID_ADD],
  ['/contractors/self/activate', undefined],
  ['/contractors/self/deactivate', undefined],
  ['/contractors/self/access-code', undefined],
  ['/contractors/self/app-link', undefined],
];

describe('refusals: every write needs an admin session', () => {
  const untouched = () => {
    expect(calls).toEqual({ create: [], setActivation: 0, setAccessCode: 0, ensureAppToken: 0 });
    expect(contractors.get('self')!.profile.activatedAt).toBeNull();
  };

  it.each(WRITES)('POST %s refuses a request with no session', async (route, body) => {
    signIn(null);
    const res = await post(route, body, null);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Authentication required' });
    untouched();
  });

  it.each(WRITES)('POST %s refuses a token with no live session', async (route, body) => {
    signIn(null);
    const res = await post(route, body, 'stale-token');
    expect(res.status).toBe(401);
    untouched();
  });

  it.each(WRITES)('POST %s refuses a contractor session, so nobody activates themselves', async (route, body) => {
    signIn('user-self');
    const res = await post(route, body);
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Admin access required' });
    untouched();
  });
});

describe('POST /contractors', () => {
  it('adds a contractor, activated by the admin who added them, and answers redacted', async () => {
    const res = await post('/contractors', { ...VALID_ADD, email: ' Robin@Example.TEST ', postcode: 'NG1 1AA', deliveryPriority: 3 });
    expect(res.status).toBe(201);
    expect(calls.create).toEqual([{
      firstName: 'Robin', lastName: 'Builder', phone: '+447700900123', email: 'robin@example.test',
      vertical: 'handyman', deliveryTier: 'core', deliveryPriority: 3, businessName: null,
      postcode: 'NG1 1AA', city: null, activatedBy: 'admin-1',
    }]);
    expect(res.json.contractor).toMatchObject({
      id: 'new-1', name: 'Robin Builder', phone: '+447700900123', email: 'robin@example.test',
      tier: 'core', vertical: 'handyman', priority: 3, hasAccessCode: false, hasAppLink: false,
      activation: { activated: true, activatedAt: '2026-09-17T09:00:00.000Z' },
    });
    expect(secretKeysIn(res.json)).toEqual([]);
  });

  it('a VA may add a contractor too (VAs see everything)', async () => {
    signIn('va-1');
    const res = await post('/contractors', VALID_ADD);
    expect(res.status).toBe(201);
    expect(calls.create[0].activatedBy).toBe('va-1');
  });

  it('a contractor added without an email shows no email', async () => {
    const res = await post('/contractors', { ...VALID_ADD, email: '' });
    expect(res.status).toBe(201);
    expect(calls.create[0].email).toBeNull();
    expect(res.json.contractor.email).toBeNull();
  });

  it('refuses a body missing the required fields, naming each', async () => {
    const res = await post('/contractors', {});
    expect(res.status).toBe(400);
    expect(res.json.details.map((d: { path: string }) => d.path).sort())
      .toEqual(['deliveryTier', 'firstName', 'lastName', 'phone', 'vertical']);
    expect(calls.create).toEqual([]);
  });

  it.each([
    ['a blank first name', { firstName: '   ' }],
    ['an unknown delivery tier', { deliveryTier: 'gold' }],
    ['an unknown vertical', { vertical: 'plumbing' }],
    ['a phone that is not a UK number', { phone: '12345' }],
    ['an invalid email', { email: 'not-an-email' }],
  ])('refuses %s', async (_label, over) => {
    const res = await post('/contractors', { ...VALID_ADD, ...over });
    expect(res.status).toBe(400);
    expect(calls.create).toEqual([]);
  });

  it.each([
    ['a password', { password: 'hunter22' }],
    ['an hourly rate', { hourlyRate: 45 }],
    ['a day rate', { dayRate: 20000 }],
    ['skills with rates', { skills: [{ categorySlug: 'shelving', hourlyRate: 4000 }] }],
    ['an activation date', { activatedAt: '2026-01-01' }],
  ])('refuses %s: no password or money field is taken', async (_label, extra) => {
    const res = await post('/contractors', { ...VALID_ADD, ...extra });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('hunter22');
    expect(calls.create).toEqual([]);
  });

  it('refuses an email another user has', async () => {
    taken.email = true;
    const res = await post('/contractors', { ...VALID_ADD, email: 'robin@example.test' });
    expect(res.status).toBe(409);
    expect(calls.create).toEqual([]);
  });

  it('refuses a phone another contractor has', async () => {
    taken.phone = true;
    const res = await post('/contractors', VALID_ADD);
    expect(res.status).toBe(409);
    expect(calls.create).toEqual([]);
  });
});

describe('activate and deactivate', () => {
  it('a self-signed-up contractor starts inactive and an admin activates them', async () => {
    const res = await post('/contractors/self/activate');
    expect(res.status).toBe(200);
    expect(res.json.contractor.activation.activated).toBe(true);
    expect(contractors.get('self')!.profile.activatedAt).toBeInstanceOf(Date);
    expect(contractors.get('self')!.activatedBy).toBe('admin-1');
  });

  it('activating an active contractor keeps the first activation', async () => {
    const first = new Date('2026-09-01T08:00:00Z');
    contractors.get('self')!.profile.activatedAt = first;
    const res = await post('/contractors/self/activate');
    expect(res.status).toBe(200);
    expect(calls.setActivation).toBe(0);
    expect(res.json.contractor.activation.activatedAt).toBe(first.toISOString());
  });

  it('deactivating clears the activation', async () => {
    contractors.get('self')!.profile.activatedAt = new Date('2026-09-01T08:00:00Z');
    contractors.get('self')!.activatedBy = 'admin-1';
    const res = await post('/contractors/self/deactivate');
    expect(res.status).toBe(200);
    expect(res.json.contractor.activation).toMatchObject({ activated: false, activatedAt: null });
    expect(contractors.get('self')!.activatedBy).toBeNull();
  });

  it('deactivating an inactive contractor writes nothing', async () => {
    const res = await post('/contractors/self/deactivate');
    expect(res.status).toBe(200);
    expect(calls.setActivation).toBe(0);
  });

  it.each(['activate', 'deactivate'])('%s answers 404 for an unknown contractor', async (action) => {
    const res = await post(`/contractors/nobody/${action}`);
    expect(res.status).toBe(404);
    expect(calls.setActivation).toBe(0);
  });
});

describe('POST /contractors/:id/access-code', () => {
  it('issues an eight-digit code once, storing only its hash', async () => {
    const res = await post('/contractors/self/access-code');
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.json).toMatchObject({ contractorId: 'self', loginPath: '/partner/login' });
    expect(res.json.code).toMatch(/^[0-9]{8}$/);
    const stored = contractors.get('self')!.accessCode;
    expect(stored).toBe(hashAccessCode(res.json.code));
    expect(stored).not.toContain(res.json.code);
  });

  it('a reset replaces the code, so the old one no longer matches', async () => {
    const first = (await post('/contractors/self/access-code')).json.code;
    const second = (await post('/contractors/self/access-code')).json.code;
    expect(contractors.get('self')!.accessCode).toBe(hashAccessCode(second));
    if (first !== second) expect(contractors.get('self')!.accessCode).not.toBe(hashAccessCode(first));
  });

  it('never issues a code another contractor holds, hashed or plain', async () => {
    const seen: string[][] = [];
    accessCodeInUse = (values, exceptId) => {
      expect(exceptId).toBe('self');
      seen.push(values);
      return seen.length < 3;
    };
    const res = await post('/contractors/self/access-code');
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(3);
    for (const values of seen) expect(values).toEqual([hashAccessCode(values[1]), values[1]]);
    expect(seen[2][1]).toBe(res.json.code);
  });

  it('tries a fresh code when the unique index refuses one', async () => {
    setAccessCodeFails = 1;
    const res = await post('/contractors/self/access-code');
    expect(res.status).toBe(201);
    expect(calls.setAccessCode).toBe(2);
    expect(contractors.get('self')!.accessCode).toBe(hashAccessCode(res.json.code));
  });

  it('gives up without a code after five taken codes', async () => {
    accessCodeInUse = () => true;
    const res = await post('/contractors/self/access-code');
    expect(res.status).toBe(503);
    expect(res.json.code).toBeUndefined();
    expect(calls.setAccessCode).toBe(0);
  });

  it('answers 404 for an unknown contractor', async () => {
    const res = await post('/contractors/nobody/access-code');
    expect(res.status).toBe(404);
    expect(calls.setAccessCode).toBe(0);
  });
});

describe('POST /contractors/:id/app-link', () => {
  it('issues the field-app link, and the same link again after', async () => {
    const first = await post('/contractors/self/app-link');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.json).toEqual({ contractorId: 'self', path: '/my-week/APP-TOKEN-abcdefghijklmnop' });
    const second = await post('/contractors/self/app-link');
    expect(second.json.path).toBe(first.json.path);
  });

  it('answers 404 for an unknown contractor', async () => {
    const res = await post('/contractors/nobody/app-link');
    expect(res.status).toBe(404);
    expect(calls.ensureAppToken).toBe(0);
  });
});
