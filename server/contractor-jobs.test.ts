/**
 * The contractor app's job reads (`/jobs`, `/past-jobs`, `/scorecard`) answer exactly as they did
 * before their loaders moved to `contractor-jobs.ts`: these bodies were recorded against the
 * loaders while they still lived in `contractor-app-routes.ts`.
 *
 * The database is `contractor-desk/fake-db.ts`, which evaluates each select's `where`, so the
 * seeded rows other contractors own, pending requests and out-of-window weeks are really filtered.
 */
import express from 'express';
import http from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', async () => ({ db: (await import('./contractor-desk/fake-db')).fakeDb }));
vi.mock('./spine/job-pack-readers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spine/job-pack-readers')>()),
  loadPacksForQuotes: vi.fn(async () => new Map()),
}));

import contractorAppRouter from './contractor-app-routes';
import { resetFakeRows } from './contractor-desk/fake-db';

const APP_TOKEN = 'APP-TOKEN-c1-0123456789';
const NOW = new Date('2026-09-17T10:00:00Z'); // a Thursday; the UK week began Monday 14 Sep

const line = (lineId: string, description: string, guardedPricePence: number, minutes: number) => ({
  lineId, description, category: 'shelving', guardedPricePence, timeEstimateMinutes: minutes,
  materialsWithMarginPence: 1500, materialsCostPence: 1200, structuralSharePence: 0,
  materials: [{ name: `${description} bracket`, qty: 2, supplierItemNumber: `SKU-${lineId}` }],
});

const quote = (id: string, extra: Record<string, unknown> = {}) => ({
  id, slug: `slug-${id}`, customerName: `Customer ${id}`, postcode: 'NG1 1AA', address: `1 ${id} Street, Nottingham`,
  customerPhotoUrls: [`https://files.example.test/${id}.jpg`], jobDescription: `Job for ${id}`, basePrice: 12000,
  pricingLineItems: [line(`${id}-l1`, 'Shelves', 8000, 90)], deferredLineItems: null,
  depositPaidAt: new Date('2026-09-01T00:00:00Z'), flexBookingWithinDays: null, bookedAt: new Date('2026-09-02T00:00:00Z'),
  leadContractorId: 'c1', ...extra,
});

const booking = (id: string, quoteId: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, quoteId, contractorId: 'c1', assignedContractorId: null, scheduledDate: new Date(`${day}T09:00:00Z`),
  scheduledSlot: 'am', durationDays: 1, scheduledDates: null, status: 'accepted', assignmentStatus: null,
  acceptedAt: new Date('2026-09-02T12:00:00Z'), completedAt: null, evidenceUrls: null, signatureDataUrl: null,
  completionNotes: null, customerName: `Customer ${quoteId}`, description: null, ...extra,
});

function seedJobs(sessionUserId: string | null = null) {
  resetFakeRows({
    users: [
      { id: 'admin-1', role: 'admin', isActive: true, email: 'admin-1@example.test' },
      { id: 'va-1', role: 'va', isActive: true, email: 'va-1@example.test' },
      { id: 'user-c1', role: 'contractor', isActive: true, email: 'c1@example.test' },
    ],
    handyman_profiles: [
      { id: 'c1', userId: 'user-c1', appToken: APP_TOKEN, deliveryTier: 'core', profileImageUrl: null, heroImageUrl: null, lastAvailabilityRefresh: null },
      { id: 'c2', userId: 'user-c2', appToken: 'APP-TOKEN-c2-0123456789', deliveryTier: 'partner', profileImageUrl: null, heroImageUrl: null, lastAvailabilityRefresh: null },
    ],
    personalized_quotes: [
      quote('q-up'),
      quote('q-split', {
        pricingLineItems: [line('s1', 'Kept shelves', 6000, 300), line('s2', 'Later door', 4000, 60)],
        deferredLineItems: [{ lineId: 's2' }],
      }),
      quote('q-done'),
      quote('q-past'),
      quote('q-early'),
      quote('q-flex', {
        depositPaidAt: new Date('2026-09-16T08:00:00Z'), flexBookingWithinDays: 14, bookedAt: null,
        pricingLineItems: [line('f1', 'Flat pack', 5000, 60)],
      }),
      quote('q-flex-c2', { depositPaidAt: new Date('2026-09-16T08:00:00Z'), flexBookingWithinDays: 14, bookedAt: null, leadContractorId: 'c2' }),
      quote('q-flex-booked', { flexBookingWithinDays: 14 }),
    ],
    contractor_booking_requests: [
      booking('b-up', 'q-up', '2026-09-18'),
      // Booked to c2, reassigned to c1, two working days over the weekend.
      booking('b-span', 'q-split', '2026-09-25', {
        contractorId: 'c2', assignedContractorId: 'c1', status: 'pending', assignmentStatus: 'accepted',
        scheduledSlot: 'full_day', durationDays: 2, scheduledDates: ['2026-09-25', '2026-09-28'],
      }),
      booking('b-done', 'q-done', '2026-09-19', { status: 'completed', completedAt: new Date('2026-09-17T08:00:00Z') }),
      booking('b-past', 'q-past', '2026-09-08', {
        scheduledSlot: 'pm', status: 'completed', completedAt: new Date('2026-09-08T15:00:00Z'),
        evidenceUrls: ['https://files.example.test/after.jpg'], signatureDataUrl: 'data:image/png;base64,AAAA',
        completionNotes: 'All done',
      }),
      booking('b-early', 'q-early', '2026-09-15', { assignmentStatus: 'in_progress', status: 'pending' }),
      booking('b-away', 'q-up', '2026-09-18', { assignedContractorId: 'c2' }),
      booking('b-pending', 'q-up', '2026-09-18', { status: 'pending' }),
      booking('b-old', 'q-past', '2026-08-01'),
    ],
    booking_assignments: [
      { id: 'a1', bookingId: 'b-up', contractorId: 'c1', payoutPence: 5000, status: 'accepted' },
      { id: 'a2', bookingId: 'b-past', contractorId: 'c1', payoutPence: 6000, status: 'completed' },
      { id: 'a3', bookingId: 'b-early', contractorId: 'c1', payoutPence: 2500, status: 'accepted' },
      { id: 'a4', bookingId: 'b-away', contractorId: 'c2', payoutPence: 9999, status: 'accepted' },
    ],
    contractor_diary_items: [
      {
        id: 'd1', contractorId: 'c1', date: new Date('2026-09-18T00:00:00Z'), slot: 'pm', startTime: '14:00', minutes: 45,
        kind: 'quote_visit', customerName: 'Visit Person', customerPhone: '+447700900123', address: '2 Visit Road',
        postcode: 'NG2 2BB', notes: 'Measure up', status: 'open',
      },
      {
        id: 'd2', contractorId: 'c1', date: new Date('2026-09-10T00:00:00Z'), slot: 'am', startTime: null, minutes: 45,
        kind: 'quote_visit', customerName: 'Old Visit', customerPhone: null, address: null, postcode: null, notes: null, status: 'done',
      },
    ],
    handyman_availability: [1, 2, 3, 4, 5].map((dow) => ({
      id: `p${dow}`, handymanId: 'c1', dayOfWeek: dow, startTime: '08:00', endTime: '17:00', isActive: true,
    })),
    contractor_availability_dates: [
      { id: 'o1', contractorId: 'c1', date: new Date('2026-09-22T00:00:00Z'), isAvailable: false, startTime: null, endTime: null },
    ],
  }, sessionUserId);
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const app = express();
  app.use(express.json());
  app.use('/api/contractor-app', contractorAppRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  vi.useRealTimers();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => seedJobs());

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: await res.json() };
}

describe('the contractor app job reads', () => {
  it('refuses an unknown link', async () => {
    const res = await get('/api/contractor-app/APP-TOKEN-nobody-0123456789/jobs');
    expect(res).toEqual({ status: 404, json: { error: 'Link not recognised' } });
  });

  it('/jobs answers as before', async () => {
    const res = await get(`/api/contractor-app/${APP_TOKEN}/jobs`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchInlineSnapshot(`
      {
        "booked": [
          {
            "customerName": "Customer q-up",
            "date": "2026-09-18",
            "durationDays": 1,
            "fullDescription": "Job for q-up",
            "id": "b-up",
            "jobDescription": "Job for q-up",
            "jobPack": null,
            "mapQuery": "1 q-up Street, Nottingham",
            "materials": [
              {
                "name": "Shelves bracket",
                "qty": 2,
                "supplierItemNumber": "SKU-q-up-l1",
              },
            ],
            "materialsAllowancePence": 1200,
            "minutes": 90,
            "packChip": null,
            "payLines": [
              {
                "category": "shelving",
                "description": "Shelves",
                "labourPence": 8000,
                "materialsPence": 1200,
                "method": "share",
                "payPence": 4000,
                "tier": "general",
              },
            ],
            "payoutPence": 5000,
            "photoUrls": [
              "https://files.example.test/q-up.jpg",
            ],
            "postcodeArea": "NG1",
            "quoteId": "q-up",
            "slot": "am",
            "valuePence": 12000,
          },
          {
            "customerName": "Customer q-split",
            "date": "2026-09-25",
            "durationDays": 2,
            "fullDescription": "Kept shelves",
            "id": "b-span",
            "jobDescription": "Kept shelves",
            "jobPack": null,
            "mapQuery": "1 q-split Street, Nottingham",
            "materials": [
              {
                "name": "Kept shelves bracket",
                "qty": 2,
                "supplierItemNumber": "SKU-s1",
              },
            ],
            "materialsAllowancePence": 1200,
            "minutes": 90,
            "packChip": null,
            "payLines": [
              {
                "category": "shelving",
                "description": "Kept shelves",
                "labourPence": 6000,
                "materialsPence": 1200,
                "method": "visit_minimum",
                "payPence": 4000,
                "tier": "general",
              },
            ],
            "payoutPence": null,
            "photoUrls": [
              "https://files.example.test/q-split.jpg",
            ],
            "postcodeArea": "NG1",
            "quoteId": "q-split",
            "slot": "full_day",
            "valuePence": 7500,
          },
        ],
        "diaryItems": [
          {
            "address": "2 Visit Road",
            "customerName": "Visit Person",
            "date": "2026-09-18",
            "id": "d1",
            "kind": "quote_visit",
            "minutes": 45,
            "notes": "Measure up",
            "phone": "+447700900123",
            "postcode": "NG2 2BB",
            "slot": "pm",
            "startTime": "14:00",
            "status": "open",
          },
        ],
        "flex": [
          {
            "blockStarts": [],
            "deadline": "2026-09-30",
            "fullDescription": "Job for q-flex",
            "jobDescription": "Job for q-flex",
            "mapQuery": "1 q-flex Street, Nottingham",
            "materials": [
              {
                "name": "Flat pack bracket",
                "qty": 2,
                "supplierItemNumber": "SKU-f1",
              },
            ],
            "materialsAllowancePence": 1200,
            "multiDay": false,
            "needsFullDay": false,
            "payLines": [
              {
                "category": "shelving",
                "description": "Flat pack",
                "labourPence": 5000,
                "materialsPence": 1200,
                "method": "visit_minimum",
                "payPence": 4000,
                "tier": "general",
              },
            ],
            "payoutPence": 4000,
            "photoUrls": [
              "https://files.example.test/q-flex.jpg",
            ],
            "postcodeArea": "NG1",
            "quoteId": "q-flex",
            "requiredDays": 1,
            "suggestions": [
              {
                "date": "2026-09-18",
                "packed": true,
                "reasons": [
                  "pairs with your NG1 job that day",
                  "completes a full paid day",
                ],
                "slot": "am",
              },
              {
                "date": "2026-09-25",
                "packed": true,
                "reasons": [
                  "pairs with your NG1 job that day",
                  "completes a full paid day",
                ],
                "slot": "am",
              },
              {
                "date": "2026-09-25",
                "packed": true,
                "reasons": [
                  "pairs with your NG1 job that day",
                  "completes a full paid day",
                ],
                "slot": "pm",
              },
            ],
            "valuePence": 12000,
          },
        ],
      }
    `);
  });

  it('/past-jobs answers as before for this week so far and an earlier week', async () => {
    const thisWeek = await get(`/api/contractor-app/${APP_TOKEN}/past-jobs?weeksBack=1`);
    const lastWeek = await get(`/api/contractor-app/${APP_TOKEN}/past-jobs?weeksBack=2`);
    expect(thisWeek.status).toBe(200);
    expect(lastWeek.status).toBe(200);
    expect(thisWeek.json).toMatchInlineSnapshot(`
      {
        "earnedPence": 2500,
        "hasMore": true,
        "jobs": [
          {
            "completed": false,
            "completedAt": null,
            "completionNotes": null,
            "customerName": "Customer q-early",
            "date": "2026-09-15",
            "durationDays": 1,
            "evidenceUrls": null,
            "fullDescription": "Job for q-early",
            "id": "b-early",
            "jobDescription": "Job for q-early",
            "mapQuery": "1 q-early Street, Nottingham",
            "materialsAllowancePence": 1200,
            "payLines": [
              {
                "category": "shelving",
                "description": "Shelves",
                "labourPence": 8000,
                "materialsPence": 1200,
                "method": "share",
                "payPence": 4000,
                "tier": "general",
              },
            ],
            "payoutPence": 2500,
            "photoUrls": [
              "https://files.example.test/q-early.jpg",
            ],
            "postcodeArea": "NG1",
            "signatureDataUrl": null,
            "valuePence": 12000,
          },
        ],
        "label": "Earlier this week",
        "weekEnd": "2026-09-16",
        "weekStart": "2026-09-14",
        "weeksBack": 1,
      }
    `);
    expect(lastWeek.json).toMatchInlineSnapshot(`
      {
        "earnedPence": 6000,
        "hasMore": true,
        "jobs": [
          {
            "completed": true,
            "completedAt": "2026-09-08",
            "completionNotes": "All done",
            "customerName": "Customer q-past",
            "date": "2026-09-08",
            "durationDays": 1,
            "evidenceUrls": [
              "https://files.example.test/after.jpg",
            ],
            "fullDescription": "Job for q-past",
            "id": "b-past",
            "jobDescription": "Job for q-past",
            "mapQuery": "1 q-past Street, Nottingham",
            "materialsAllowancePence": 1200,
            "payLines": [
              {
                "category": "shelving",
                "description": "Shelves",
                "labourPence": 8000,
                "materialsPence": 1200,
                "method": "share",
                "payPence": 4000,
                "tier": "general",
              },
            ],
            "payoutPence": 6000,
            "photoUrls": [
              "https://files.example.test/q-past.jpg",
            ],
            "postcodeArea": "NG1",
            "signatureDataUrl": "data:image/png;base64,AAAA",
            "valuePence": 12000,
          },
        ],
        "label": "Week of 7 Sep",
        "weekEnd": "2026-09-13",
        "weekStart": "2026-09-07",
        "weeksBack": 2,
      }
    `);
  });

  it('/scorecard still reads the week fill from the shared grid', async () => {
    const res = await get(`/api/contractor-app/${APP_TOKEN}/scorecard`);
    expect(res.status).toBe(200);
    expect({ weekOpen: res.json.weekOpen, weekBooked: res.json.weekBooked }).toMatchInlineSnapshot(`
      {
        "weekBooked": 2,
        "weekOpen": 3,
      }
    `);
  });
});
