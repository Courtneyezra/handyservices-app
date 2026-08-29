import { describe, it, expect } from 'vitest';
import {
  classifySparseDay,
  quoteJobValuePence,
  SPARSE_DAY_FEE_PENCE,
  type BookedDayJob,
} from './sparse-day-fees';

// Floor £150 (15000p) → 50% threshold = 7500p unless a test says otherwise.
const FLOOR = 15000;

const ctx = (over: Partial<Parameters<typeof classifySparseDay>[0]>) => classifySparseDay({
  incomingValuePence: 0,
  incomingLat: null,
  incomingLng: null,
  dayRateFloorPence: FLOOR,
  existingJobs: [],
  ...over,
});

// Central London base point; ~0.0145° latitude ≈ 1 mile, so pure-latitude
// offsets give predictable haversine miles.
const BASE = { lat: 51.5, lng: -0.12 };
const milesNorth = (m: number) => ({ lat: BASE.lat + m * 0.014472, lng: BASE.lng });

const job = (valuePence: number, coords: { lat: number; lng: number } | null = null): BookedDayJob => ({
  valuePence,
  lat: coords?.lat ?? null,
  lng: coords?.lng ?? null,
});

describe('classifySparseDay', () => {
  it('1 — empty day + £80 incoming is fee-free on value (8000 ≥ 7500)', () => {
    expect(ctx({ incomingValuePence: 8000 })).toEqual({ feePence: 0, reason: 'value_threshold' });
  });

  it('2 — empty day + £40 incoming is sparse (£25 fee)', () => {
    expect(ctx({ incomingValuePence: 4000 })).toEqual({ feePence: SPARSE_DAY_FEE_PENCE, reason: 'sparse' });
  });

  it('3 — £50 booked + £30 incoming = £80 ≥ £75 → fee-free on value', () => {
    expect(ctx({ incomingValuePence: 3000, existingJobs: [job(5000)] }))
      .toEqual({ feePence: 0, reason: 'value_threshold' });
  });

  it('4 — below threshold: 5-mile neighbour does NOT anchor, 2.9-mile one does', () => {
    const incoming = { incomingValuePence: 4000, incomingLat: BASE.lat, incomingLng: BASE.lng };
    expect(ctx({ ...incoming, existingJobs: [job(1000, milesNorth(5))] }))
      .toEqual({ feePence: SPARSE_DAY_FEE_PENCE, reason: 'sparse' });
    expect(ctx({ ...incoming, existingJobs: [job(1000, milesNorth(2.9))] }))
      .toEqual({ feePence: 0, reason: 'distance_anchor' });
  });

  it('5 — below threshold with null incoming coords: no anchor possible → sparse', () => {
    expect(ctx({ incomingValuePence: 4000, existingJobs: [job(1000, milesNorth(0.1))] }))
      .toEqual({ feePence: SPARSE_DAY_FEE_PENCE, reason: 'sparse' });
  });

  it('6 — dayRateFloorPence 0 never charges (bad config)', () => {
    expect(ctx({ incomingValuePence: 0, dayRateFloorPence: 0 }))
      .toEqual({ feePence: 0, reason: 'value_threshold' });
  });

  it('7 — multi-day: £600 over 2 days → per-day £300 ≥ £75 → fee-free', () => {
    expect(ctx({ incomingValuePence: 60000, requiredDays: 2 }))
      .toEqual({ feePence: 0, reason: 'value_threshold' });
  });

  it('8 — exact 50% boundary is INCLUSIVE (7500 vs floor 15000 → fee-free)', () => {
    expect(ctx({ incomingValuePence: 7500 })).toEqual({ feePence: 0, reason: 'value_threshold' });
  });

  it('existing job with null coords is skipped by the anchor but counts toward value', () => {
    // Value path: 3500 (null coords) + 4000 = 7500 → fee-free on value.
    expect(ctx({ incomingValuePence: 4000, incomingLat: BASE.lat, incomingLng: BASE.lng, existingJobs: [job(3500)] }))
      .toEqual({ feePence: 0, reason: 'value_threshold' });
    // Anchor path: same neighbour with no coords can never anchor → sparse.
    expect(ctx({ incomingValuePence: 4000, incomingLat: BASE.lat, incomingLng: BASE.lng, existingJobs: [job(1000)] }))
      .toEqual({ feePence: SPARSE_DAY_FEE_PENCE, reason: 'sparse' });
  });
});

describe('quoteJobValuePence', () => {
  it('uses basePrice when there is no split', () => {
    expect(quoteJobValuePence({ basePrice: 12300 })).toBe(12300);
    expect(quoteJobValuePence({ basePrice: 12300, deferredLineItems: [] })).toBe(12300);
  });

  it('sums ACTIVE line items when lines are deferred (basePrice still carries the full amount)', () => {
    const q = {
      basePrice: 10000,
      pricingLineItems: [
        { lineId: 'a', guardedPricePence: 4000 },
        { lineId: 'b', pricePence: 6000 },
      ],
      deferredLineItems: [{ lineId: 'b', label: 'later', pricePence: 6000 }],
    };
    expect(quoteJobValuePence(q)).toBe(4000);
  });

  it('falls back to summing lines when basePrice is null, and 0 on malformed input', () => {
    expect(quoteJobValuePence({ basePrice: null, pricingLineItems: [{ lineId: 'a', price_pence: 2500 }] })).toBe(2500);
    expect(quoteJobValuePence({ basePrice: null, pricingLineItems: 'garbage' })).toBe(0);
    expect(quoteJobValuePence({})).toBe(0);
  });
});
