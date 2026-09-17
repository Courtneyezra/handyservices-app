import { describe, expect, it } from 'vitest';
import {
  bookedDatesInWeek,
  nextBookedJob,
  shapeContractor,
  shapeContractorDetail,
  sortRoster,
  type RosterBookingRow,
  type RosterProfileRow,
} from './roster';

const profile = (over: Partial<RosterProfileRow> = {}): RosterProfileRow => ({
  id: 'c1', userId: 'u1', firstName: 'Casey', lastName: 'Fixer', email: 'c@example.test', phone: null,
  accountActive: true, businessName: null, bio: null, city: null, postcode: null, radiusMiles: 10,
  slug: null, profileImageUrl: null, heroImageUrl: null, publicProfileEnabled: false,
  availabilityStatus: 'available', lastAvailabilityRefresh: null, deliveryTier: 'core', vertical: 'handyman',
  deliveryPriority: null, vehicleType: null, verificationStatus: null, publicLiabilityInsuranceUrl: null,
  publicLiabilityExpiryDate: null, dbsCertificateUrl: null, identityDocumentUrl: null, partnerStatus: null,
  partnerActivatedAt: null, hasAccessCode: false, hasAppLink: false, createdAt: null,
  ...over,
});

const booking = (over: Partial<RosterBookingRow> = {}): RosterBookingRow => ({
  id: 'b1', quoteId: 'q1', contractorId: 'c1', assignedContractorId: null, status: 'accepted',
  assignmentStatus: 'accepted', scheduledDate: new Date('2026-09-16T00:00:00Z'), scheduledDates: null,
  durationDays: 1, slot: 'am', customerName: 'Sam', description: 'Shelves', postcode: 'NG1 1AA',
  ...over,
});

const WEEK = '2026-09-14'; // Monday
const TODAY = '2026-09-17'; // Thursday
const ctx = (bookings: RosterBookingRow[] = []) => ({ bookings, skills: [], today: TODAY, weekStart: WEEK });

describe('bookedDatesInWeek', () => {
  it('counts distinct days, expanding a multi-day span and clipping it to the week', () => {
    const rows = [
      booking({ id: 'a', scheduledDate: new Date('2026-09-15T00:00:00Z') }),
      booking({ id: 'b', scheduledDate: new Date('2026-09-15T00:00:00Z'), slot: 'pm' }),
      booking({ id: 'c', scheduledDate: new Date('2026-09-10T00:00:00Z'), scheduledDates: ['2026-09-11', '2026-09-14'], durationDays: 2 }),
      booking({ id: 'd', scheduledDate: new Date('2026-09-20T00:00:00Z'), durationDays: 2 }),
    ];
    expect(bookedDatesInWeek(rows, 'c1', WEEK)).toEqual(['2026-09-14', '2026-09-15', '2026-09-20']);
  });

  it('ignores bookings that are not booked or belong to someone else', () => {
    const rows = [
      booking({ id: 'pending', status: 'pending', assignmentStatus: 'unassigned' }),
      booking({ id: 'moved', assignedContractorId: 'c2' }),
      booking({ id: 'other', contractorId: 'c2' }),
      booking({ id: 'undated', scheduledDate: null }),
    ];
    expect(bookedDatesInWeek(rows, 'c1', WEEK)).toEqual([]);
    expect(bookedDatesInWeek(rows, 'c2', WEEK)).toEqual(['2026-09-16']);
  });
});

describe('nextBookedJob', () => {
  it('picks the earliest day on or after today, morning before afternoon', () => {
    const rows = [
      booking({ id: 'past', scheduledDate: new Date('2026-09-16T00:00:00Z') }),
      booking({ id: 'later', scheduledDate: new Date('2026-09-22T00:00:00Z') }),
      booking({ id: 'pm', scheduledDate: new Date('2026-09-18T00:00:00Z'), slot: 'pm' }),
      booking({ id: 'am', scheduledDate: new Date('2026-09-18T00:00:00Z'), slot: 'am' }),
    ];
    expect(nextBookedJob(rows, 'c1', TODAY)).toEqual({
      bookingId: 'am', quoteId: 'q1', date: '2026-09-18', slot: 'am', durationDays: 1,
      customerName: 'Sam', postcode: 'NG1 1AA', description: 'Shelves',
    });
  });

  it('shows a span already under way on its next day, and skips completed jobs', () => {
    const rows = [
      booking({ id: 'span', scheduledDate: new Date('2026-09-16T00:00:00Z'), durationDays: 3, slot: 'am' }),
      booking({ id: 'done', scheduledDate: new Date('2026-09-17T00:00:00Z'), status: 'completed', assignmentStatus: 'completed' }),
    ];
    expect(nextBookedJob(rows, 'c1', TODAY)).toMatchObject({ bookingId: 'span', date: '2026-09-17', slot: 'full_day', durationDays: 3 });
  });

  it('is null with nothing ahead', () => {
    expect(nextBookedJob([booking()], 'c1', TODAY)).toBeNull();
  });
});

describe('shapeContractor', () => {
  it('outputs only its named fields, even when the row carries more', () => {
    const leaky = { ...profile(), password: 'hash', appToken: 'tok', accessCode: '1234', widgetToken: 'w', calendarSyncToken: 's', hourlyRate: 50 } as RosterProfileRow;
    const out = shapeContractorDetail(leaky, ctx());
    const json = JSON.stringify(out);
    for (const k of ['password', 'appToken', 'accessCode', 'widgetToken', 'calendarSyncToken', 'hourlyRate']) {
      expect(json).not.toContain(`"${k}"`);
    }
    expect(out.hasAccessCode).toBe(false);
    expect(out.hasAppLink).toBe(false);
  });

  it('reports documents as present or not, and defaults tier, vertical and status', () => {
    const out = shapeContractor(profile({
      deliveryTier: 'weird', vertical: null, verificationStatus: null, accountActive: false,
      dbsCertificateUrl: 'https://x/dbs.pdf', identityDocumentUrl: '  ', hasAccessCode: true, hasAppLink: true,
    }), ctx());
    expect(out).toMatchObject({
      tier: 'adhoc', vertical: 'handyman', hasAccessCode: true, hasAppLink: true,
      activation: { accountActive: false },
      verification: { status: 'unverified', insurance: { present: false, expiresAt: null }, dbs: { present: true }, identity: { present: false } },
    });
  });

  it('counts distinct skill slugs and names a contractor without a name by business', () => {
    const out = shapeContractor(profile({ firstName: null, lastName: null, businessName: 'Fix Co' }), {
      ...ctx(),
      skills: [
        { handymanId: 'c1', categorySlug: 'tiling' },
        { handymanId: 'c1', categorySlug: 'tiling' },
        { handymanId: 'c1', categorySlug: null },
        { handymanId: 'c2', categorySlug: 'painting' },
      ],
    });
    expect(out.skillsCount).toBe(1);
    expect(out.name).toBe('Fix Co');
  });
});

describe('sortRoster', () => {
  it('orders partner, core, ad-hoc, then by priority with unranked last, then name', () => {
    const rows = [
      profile({ id: 'adhoc', firstName: 'Al', deliveryTier: 'adhoc' }),
      profile({ id: 'core-z', firstName: 'Zed', deliveryPriority: null }),
      profile({ id: 'core-1', firstName: 'Craig', deliveryPriority: 1 }),
      profile({ id: 'core-a', firstName: 'Abe', deliveryPriority: null }),
      profile({ id: 'partner', firstName: 'Pat', deliveryTier: 'partner' }),
    ].map((p) => shapeContractor(p, ctx()));
    expect(sortRoster(rows).map((r) => r.id)).toEqual(['partner', 'core-1', 'core-a', 'core-z', 'adhoc']);
  });
});
