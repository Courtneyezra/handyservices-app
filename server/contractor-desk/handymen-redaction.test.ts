/**
 * The old `/api/handymen` reads answer with no login (HandymanMap, the fleet dashboard, dispatch and
 * the daily planner call them), so they must never send a login secret or a password field.
 *
 * The router is mounted the way server/index.ts mounts it, with no auth. The database is
 * `fake-db.ts`: it holds the contractor's password hash, widget token, app token, access code and
 * calendar sync token, and answers each query with only the columns it named.
 */
import express from 'express';
import http from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', async () => ({ db: (await import('./fake-db')).fakeDb }));

import handymenRouter from '../handymen';
import { resetFakeRows } from './fake-db';

const SECRETS = {
  password: '$2b$10$SECRET-PASSWORD-HASH',
  widgetToken: 'SECRET-WIDGET-TOKEN',
  appToken: 'SECRET-APP-TOKEN-0123456789',
  accessCode: 'SECRET-CODE',
  calendarSyncToken: 'SECRET-SYNC-TOKEN',
};
const SECRET_KEYS = /password|hash|widgettoken|apptoken|accesscode|synctoken/i;

function seed() {
  resetFakeRows({
    users: [{
      id: 'user-c1', email: 'contractor@example.test', firstName: 'Casey', lastName: 'Fixer',
      phone: '+447700900001', password: SECRETS.password, role: 'contractor', isActive: true,
      widgetToken: SECRETS.widgetToken,
    }],
    handyman_profiles: [{
      id: 'c1', userId: 'user-c1', businessName: 'Casey Fixes', bio: 'Shelves', address: '1 High St',
      city: 'Nottingham', postcode: 'NG1 1AA', latitude: '52.95', longitude: '-1.15', radiusMiles: 10,
      hourlyRate: 50, availabilityStatus: 'available', verificationStatus: 'pending',
      deliveryTier: 'core', vertical: 'handyman',
      appToken: SECRETS.appToken, accessCode: SECRETS.accessCode, calendarSyncToken: SECRETS.calendarSyncToken,
    }],
    handyman_skills: [{ id: 's1', handymanId: 'c1', serviceId: 'sku-1', categorySlug: 'shelving' }],
    handyman_availability: [{ id: 'a1', handymanId: 'c1', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isActive: true }],
  }, null);
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/handymen', handymenRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(seed);

async function get(route: string) {
  const res = await fetch(`${base}${route}`);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

function secretKeysIn(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => secretKeysIn(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(SECRET_KEYS.test(k) ? [`${path}.${k}`] : []),
    ...secretKeysIn(v, `${path}.${k}`),
  ]);
}

describe('/api/handymen with no session', () => {
  it.each(['/api/handymen', '/api/handymen?lat=52.95&lng=-1.15&radius=5', '/api/handymen/c1'])(
    '%s answers without a password, hash or login secret',
    async (route) => {
      const res = await get(route);
      expect(res.status).toBe(200);
      expect(secretKeysIn(res.json)).toEqual([]);
      for (const secret of Object.values(SECRETS)) expect(res.text).not.toContain(secret);
    },
  );

  it('the list still carries what the map, fleet dashboard and planner read', async () => {
    const res = await get('/api/handymen');
    expect(res.json).toHaveLength(1);
    expect(res.json[0]).toMatchObject({
      id: 'c1', businessName: 'Casey Fixes', city: 'Nottingham', postcode: 'NG1 1AA',
      latitude: '52.95', longitude: '-1.15', radiusMiles: 10, verificationStatus: 'pending',
      user: { firstName: 'Casey', lastName: 'Fixer', email: 'contractor@example.test' },
    });
    expect(res.json[0].skills).toHaveLength(1);
    expect(Object.keys(res.json[0].user).sort()).toEqual(['email', 'firstName', 'id', 'lastName']);
  });

  it('the detail still carries what the handyman dashboard reads', async () => {
    const res = await get('/api/handymen/c1');
    expect(res.json).toMatchObject({
      userId: 'user-c1', bio: 'Shelves', address: '1 High St', city: 'Nottingham', radiusMiles: 10,
      latitude: '52.95', longitude: '-1.15',
      skills: [{ serviceId: 'sku-1' }],
      availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '17:00' }],
    });
  });
});
