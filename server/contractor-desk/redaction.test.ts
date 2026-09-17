/**
 * The contractor reads Ben's page and the old contractor pages use never send a login secret or a
 * password field to anyone, admin or VA, and refuse a request with no admin session.
 *
 * Both routers are mounted the way server/index.ts mounts them, behind the real requireAdmin. The
 * database is `fake-db.ts`: it holds the contractor's password hash, widget token, app token,
 * access code and calendar sync token, and answers each query with only the columns it named, so
 * the tests prove what the routes' own column lists let out.
 */
import express from 'express';
import http from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', async () => ({ db: (await import('./fake-db')).fakeDb }));
vi.mock('../lib/geocoding', () => ({ geocodeAddress: vi.fn() }));

import { requireAdmin } from '../auth';
import adminContractorsRouter from '../admin-contractors-routes';
import { createContractorDeskRouter } from './routes';
import { resetFakeRows } from './fake-db';

const SECRETS = {
  password: '$2b$10$SECRET-PASSWORD-HASH',
  widgetToken: 'SECRET-WIDGET-TOKEN',
  appToken: 'SECRET-APP-TOKEN-0123456789',
  accessCode: 'SECRET-CODE',
  calendarSyncToken: 'SECRET-SYNC-TOKEN',
};
const SECRET_KEYS = /password|hash|widgettoken|apptoken|accesscode|synctoken/i;
const ALLOWED_KEYS = new Set(['hasAccessCode', 'hasAppLink']);

const staff = (id: string, role: string) => ({
  id, email: `${id}@example.test`, firstName: id, lastName: 'Staff', phone: null,
  password: '$2b$10$STAFF-HASH', role, isActive: true, widgetToken: `STAFF-WIDGET-${id}`,
});

function seed(sessionUserId: string | null) {
  resetFakeRows({
    users: [
      staff('admin-1', 'admin'),
      staff('va-1', 'va'),
      {
        id: 'user-c1', email: 'contractor@example.test', firstName: 'Casey', lastName: 'Fixer',
        phone: '+447700900001', password: SECRETS.password, role: 'contractor', isActive: true,
        widgetToken: SECRETS.widgetToken,
      },
    ],
    handyman_profiles: [{
      id: 'c1', userId: 'user-c1', businessName: 'Casey Fixes', bio: 'Shelves', city: 'Nottingham',
      postcode: 'NG1 1AA', radiusMiles: 10, hourlyRate: 50, dayRate: 20000, slug: 'casey-fixer',
      publicProfileEnabled: true, profileImageUrl: null, heroImageUrl: null,
      availabilityStatus: 'available', verificationStatus: 'pending', deliveryTier: 'core',
      vertical: 'handyman', deliveryPriority: 2, vehicleType: 'small_van',
      publicLiabilityInsuranceUrl: 'https://files.example.test/insurance.pdf',
      publicLiabilityExpiryDate: new Date('2027-01-31T00:00:00Z'),
      dbsCertificateUrl: null, identityDocumentUrl: '', partnerStatus: 'not_started',
      partnerActivatedAt: null, lastAvailabilityRefresh: null,
      appToken: SECRETS.appToken, accessCode: SECRETS.accessCode, calendarSyncToken: SECRETS.calendarSyncToken,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
    }],
    handyman_skills: [
      { id: 's1', handymanId: 'c1', categorySlug: 'shelving', hourlyRate: 4000, dayRate: null, proficiency: 'expert' },
      { id: 's2', handymanId: 'c1', categorySlug: 'flat_pack', hourlyRate: null, dayRate: null, proficiency: 'competent' },
    ],
    contractor_booking_requests: [],
  }, sessionUserId);
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/contractors', requireAdmin, adminContractorsRouter);
  app.use('/api/admin/contractor-desk', requireAdmin, createContractorDeskRouter());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => seed(null));

async function get(route: string, token?: string) {
  const res = await fetch(`${base}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

function secretKeysIn(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => secretKeysIn(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(SECRET_KEYS.test(k) && !ALLOWED_KEYS.has(k) ? [`${path}.${k}`] : []),
    ...secretKeysIn(v, `${path}.${k}`),
  ]);
}

function expectNoSecrets(body: { text: string; json: unknown }) {
  expect(secretKeysIn(body.json)).toEqual([]);
  for (const secret of [...Object.values(SECRETS), 'STAFF-HASH', 'STAFF-WIDGET']) {
    expect(body.text).not.toContain(secret);
  }
}

const READS = [
  '/api/admin/contractor-desk/contractors',
  '/api/admin/contractor-desk/contractors/c1',
  '/api/admin/contractors',
  '/api/admin/contractors/c1',
];

describe.each([
  ['an admin', 'admin-1'],
  ['a VA', 'va-1'],
])('for %s session', (_label, userId) => {
  beforeEach(() => seed(userId));

  it.each(READS)('%s answers without a password, hash or login secret', async (route) => {
    const res = await get(route, 'session-token');
    expect(res.status).toBe(200);
    expectNoSecrets(res);
  });

  it('the desk list says whether a code and an app link exist, and gives the read-only status', async () => {
    const res = await get('/api/admin/contractor-desk/contractors', 'session-token');
    expect(res.json.contractors).toHaveLength(1);
    const c = res.json.contractors[0];
    expect(c).toMatchObject({
      id: 'c1', name: 'Casey Fixer', tier: 'core', vertical: 'handyman', priority: 2,
      skillsCount: 2, bookedDaysThisWeek: 0, nextJob: null,
      activation: { accountActive: true, availabilityStatus: 'available', partnerStatus: 'not_started' },
      verification: {
        status: 'pending',
        insurance: { present: true, expiresAt: '2027-01-31T00:00:00.000Z' },
        dbs: { present: false },
        identity: { present: false },
      },
    });
    expect(typeof c.hasAccessCode).toBe('boolean');
    expect(typeof c.hasAppLink).toBe('boolean');
    // Presence, never the document itself.
    expect(res.text).not.toContain('insurance.pdf');
  });

  it('the old detail still carries what its pages read', async () => {
    const res = await get('/api/admin/contractors/c1', 'session-token');
    expect(res.json).toMatchObject({
      id: 'c1', businessName: 'Casey Fixes', radiusMiles: 10, hourlyRate: 50, slug: 'casey-fixer',
      availabilityStatus: 'available', publicProfileEnabled: true,
      user: { id: 'user-c1', firstName: 'Casey', lastName: 'Fixer', email: 'contractor@example.test', phone: '+447700900001' },
    });
    expect(res.json.skills.map((s: any) => s.categorySlug)).toEqual(['shelving', 'flat_pack']);
    expect(Object.keys(res.json.user).sort()).toEqual(['email', 'firstName', 'id', 'isActive', 'lastName', 'phone']);
  });
});

describe('refusals', () => {
  it.each(READS)('%s refuses a request with no session', async (route) => {
    const res = await get(route);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Authentication required' });
  });

  it.each(READS)('%s refuses a token with no live session', async (route) => {
    seed(null);
    const res = await get(route, 'stale-token');
    expect(res.status).toBe(401);
    expectNoSecrets(res);
  });

  it.each(READS)('%s refuses a contractor session', async (route) => {
    seed('user-c1');
    const res = await get(route, 'session-token');
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Admin access required' });
  });

  it('the desk detail answers 404 for an unknown contractor', async () => {
    seed('admin-1');
    const router = createContractorDeskRouter({ load: async () => ({ profiles: [], bookings: [], skills: [] }) });
    const app = express();
    app.use('/d', router);
    const s = http.createServer(app);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(s.address() as { port: number }).port}/d/contractors/nobody`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Contractor not found' });
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});
