import { describe, it, expect } from 'vitest';
import { computeContractorPay } from './contractor-pay';
import { deliveryTierUplift } from '../revenue-share-tiers';

describe('deliveryTierUplift', () => {
  it('Core gets +5 points, everyone else 0', () => {
    expect(deliveryTierUplift('core')).toBe(5);
    expect(deliveryTierUplift('adhoc')).toBe(0);
    expect(deliveryTierUplift(null)).toBe(0);
    expect(deliveryTierUplift('partner')).toBe(0); // overlay handled later
  });
});

describe('computeContractorPay', () => {
  // £400 labour, 4h specialist → share (55% = £220) beats the floor (£112).
  const kitchen = { category: 'kitchen_fitting', guardedPricePence: 40000, scheduleMinutes: 240 };

  it('labour-only: pay is a share of LABOUR, materials excluded by construction', () => {
    const r = computeContractorPay([{ ...kitchen }], 'adhoc');
    expect(r.lines[0].method).toBe('share');
    expect(r.totalPayPence).toBe(22000); // 55% of £400 labour
  });

  it('Core earns +5 points vs ad-hoc on the same job', () => {
    const adhoc = computeContractorPay([{ ...kitchen }], 'adhoc');
    const core = computeContractorPay([{ ...kitchen }], 'core');
    expect(core.totalPayPence).toBeGreaterThan(adhoc.totalPayPence);
    expect(core.totalPayPence).toBe(24000); // 60% of £400
    expect(core.sharePctUplift).toBe(5);
  });

  it('the floor protects a cheap job (share < floor)', () => {
    // £30 labour, 2h specialist → share 55% = £16.50 but floor £28×2 = £56.
    const r = computeContractorPay([{ category: 'kitchen_fitting', guardedPricePence: 3000, scheduleMinutes: 120 }], 'adhoc');
    expect(r.lines[0].method).toBe('floor');
    expect(r.totalPayPence).toBe(5600);
  });

  it('uses HONEST time for the floor — an inflated pricing minute cannot inflate the floor', () => {
    // door_fitting caps at 90min; a 480-min pricing time is clamped for the floor.
    const inflated = computeContractorPay([{ category: 'door_fitting', guardedPricePence: 5000, timeEstimateMinutes: 480 }], 'adhoc');
    const honest = computeContractorPay([{ category: 'door_fitting', guardedPricePence: 5000, scheduleMinutes: 90 }], 'adhoc');
    expect(inflated.totalPayPence).toBe(honest.totalPayPence); // both use clamped 90min
  });

  it('a verified override drives the floor when set', () => {
    // Verified 4h door job → floor uses 4h, not the 90min cap.
    const r = computeContractorPay([{ category: 'door_fitting', guardedPricePence: 5000, verifiedMinutes: 240 }], 'adhoc');
    // skilled 50% of £50 = £25 vs floor £22×4 = £88 → floor wins.
    expect(r.lines[0].method).toBe('floor');
    expect(r.totalPayPence).toBe(8800);
  });
});
