import { describe, it, expect } from 'vitest';
import {
  EVE_SEGMENT_RATES,
  REFERENCE_RATE_PENCE,
  generateEVEPricingQuote,
  type EVEPricingInputs,
} from '../eve-pricing-engine';

// ---------------------------------------------------------------------------
// Helper: build EVEPricingInputs with sensible defaults
// ---------------------------------------------------------------------------
function makeInputs(overrides: Partial<EVEPricingInputs> = {}): EVEPricingInputs {
  return {
    segment: 'UNKNOWN',
    timeEstimateMinutes: 60,
    urgencyReason: 'med',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'week',
    baseJobPrice: 10000,
    clientType: 'residential',
    jobComplexity: 'low',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Segment Rate Pricing
// ---------------------------------------------------------------------------
describe('Segment Rate Pricing', () => {
  it('BUSY_PRO at 60 min should produce a price near 7400 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(7200);
    expect(result.essential.price).toBeLessThanOrEqual(7600);
  });

  it('PROP_MGR at 60 min should produce a price near 7200 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'PROP_MGR', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(7000);
    expect(result.essential.price).toBeLessThanOrEqual(7400);
  });

  it('LANDLORD at 60 min should produce a price near 6700 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'LANDLORD', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(6500);
    expect(result.essential.price).toBeLessThanOrEqual(6900);
  });

  it('SMALL_BIZ at 60 min should produce a price near 8100 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'SMALL_BIZ', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(7900);
    expect(result.essential.price).toBeLessThanOrEqual(8300);
  });

  it('BUDGET at 60 min should produce a price near 3500 pence (at reference)', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUDGET', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(3400);
    expect(result.essential.price).toBeLessThanOrEqual(3600);
  });

  it('UNKNOWN at 60 min should produce a price near 4500 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'UNKNOWN', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(4300);
    expect(result.essential.price).toBeLessThanOrEqual(4700);
  });

  it('DIY_DEFERRER at 60 min should produce a price near 3800 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'DIY_DEFERRER', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(3600);
    expect(result.essential.price).toBeLessThanOrEqual(4000);
  });

  it('EMERGENCY at 60 min should produce a price near 9500 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'EMERGENCY', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(9300);
    expect(result.essential.price).toBeLessThanOrEqual(9700);
  });

  it('TRUST_SEEKER at 60 min should produce a price near 5500 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'TRUST_SEEKER', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(5300);
    expect(result.essential.price).toBeLessThanOrEqual(5700);
  });

  it('OLDER_WOMAN at 60 min should produce a price near 5500 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'OLDER_WOMAN', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(5300);
    expect(result.essential.price).toBeLessThanOrEqual(5700);
  });

  it('RENTER at 60 min should produce a price near 4000 pence', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'RENTER', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(3800);
    expect(result.essential.price).toBeLessThanOrEqual(4200);
  });
});

// ---------------------------------------------------------------------------
// 2. Linear Scaling
// ---------------------------------------------------------------------------
describe('Linear Scaling', () => {
  it('BUSY_PRO at 120 min should be approximately 2x the 60 min price', () => {
    const result60 = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 60 }));
    const result120 = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 120 }));
    const ratio = result120.essential.price / result60.essential.price;
    expect(ratio).toBeGreaterThan(1.85);
    expect(ratio).toBeLessThan(2.15);
  });

  it('BUSY_PRO at 30 min should be approximately 0.5x the 60 min price', () => {
    const result60 = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 60 }));
    const result30 = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 30 }));
    const ratio = result30.essential.price / result60.essential.price;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('price should scale proportionally with time for LANDLORD', () => {
    const result60 = generateEVEPricingQuote(makeInputs({ segment: 'LANDLORD', timeEstimateMinutes: 60 }));
    const result90 = generateEVEPricingQuote(makeInputs({ segment: 'LANDLORD', timeEstimateMinutes: 90 }));
    const ratio = result90.essential.price / result60.essential.price;
    // 90/60 = 1.5x
    expect(ratio).toBeGreaterThan(1.35);
    expect(ratio).toBeLessThan(1.65);
  });

  it('price should scale proportionally with time for SMALL_BIZ', () => {
    const result60 = generateEVEPricingQuote(makeInputs({ segment: 'SMALL_BIZ', timeEstimateMinutes: 60 }));
    const result180 = generateEVEPricingQuote(makeInputs({ segment: 'SMALL_BIZ', timeEstimateMinutes: 180 }));
    const ratio = result180.essential.price / result60.essential.price;
    // 180/60 = 3x
    expect(ratio).toBeGreaterThan(2.8);
    expect(ratio).toBeLessThan(3.2);
  });
});

// ---------------------------------------------------------------------------
// 3. Floor Guardrail
// ---------------------------------------------------------------------------
describe('Floor Guardrail', () => {
  it('no segment price should fall below reference rate x time', () => {
    const segments = Object.keys(EVE_SEGMENT_RATES);
    for (const segment of segments) {
      const result = generateEVEPricingQuote(makeInputs({ segment, timeEstimateMinutes: 60 }));
      const referenceFloor = (REFERENCE_RATE_PENCE / 60) * 60; // 3500 for 60 min
      // Allow for psychological pricing adjustment (ends-in-9 can go 1 below)
      expect(result.essential.price).toBeGreaterThanOrEqual(referenceFloor - 10);
    }
  });

  it('BUDGET at 60 min should be >= 3400 (reference rate adjusted for ends-in-9)', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUDGET', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(3400);
  });

  it('BUDGET at 30 min should be >= reference rate for 30 min', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUDGET', timeEstimateMinutes: 30 }));
    const referenceFloor30 = (REFERENCE_RATE_PENCE / 60) * 30; // 1750 pence
    expect(result.essential.price).toBeGreaterThanOrEqual(referenceFloor30 - 10);
  });

  it('DIY_DEFERRER at 60 min should be >= reference rate', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'DIY_DEFERRER', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBeGreaterThanOrEqual(REFERENCE_RATE_PENCE - 10);
  });
});

// ---------------------------------------------------------------------------
// 4. Psychological Pricing
// ---------------------------------------------------------------------------
describe('Psychological Pricing', () => {
  it('all prices should end in digit 9', () => {
    const segments = ['BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'BUDGET', 'UNKNOWN', 'EMERGENCY'];
    const times = [30, 60, 90, 120];

    for (const segment of segments) {
      for (const time of times) {
        const result = generateEVEPricingQuote(makeInputs({ segment, timeEstimateMinutes: time }));
        expect(result.essential.price % 10).toBe(9);
        expect(result.hassleFree.price % 10).toBe(9);
        expect(result.highStandard.price % 10).toBe(9);
      }
    }
  });

  it('BUSY_PRO at various times should always end in 9', () => {
    for (const time of [15, 45, 75, 100, 150, 240]) {
      const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: time }));
      expect(result.essential.price % 10).toBe(9);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Edge Cases
// ---------------------------------------------------------------------------
describe('Edge Cases', () => {
  it('timeEstimateMinutes = 0 should default to 60 min (not produce 0 price)', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 0 }));
    expect(result.essential.price).toBeGreaterThan(0);
    // Should be roughly the same as the 60 min default
    const resultDefault = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBe(resultDefault.essential.price);
  });

  it('timeEstimateMinutes undefined should default to 60 min', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: undefined }));
    const resultDefault = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBe(resultDefault.essential.price);
  });

  it('unknown segment string should use UNKNOWN rate', () => {
    const resultUnknown = generateEVEPricingQuote(makeInputs({ segment: 'UNKNOWN', timeEstimateMinutes: 60 }));
    const resultGarbage = generateEVEPricingQuote(makeInputs({ segment: 'NOT_A_REAL_SEGMENT', timeEstimateMinutes: 60 }));
    expect(resultGarbage.essential.price).toBe(resultUnknown.essential.price);
  });

  it('very large time (480 min / 8 hours) should still produce a reasonable price', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 480 }));
    // 8 hours at 7400/hr = ~59200, allow tolerance
    expect(result.essential.price).toBeGreaterThan(50000);
    expect(result.essential.price).toBeLessThan(65000);
    // Price should still end in 9
    expect(result.essential.price % 10).toBe(9);
  });

  it('very short time (15 min) should still produce a positive price', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUDGET', timeEstimateMinutes: 15 }));
    expect(result.essential.price).toBeGreaterThan(0);
    expect(result.essential.price % 10).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 6. Backward Compatibility (PricingResult shape)
// ---------------------------------------------------------------------------
describe('Backward Compatibility', () => {
  it('result should have all PricingResult fields', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO' }));

    // Top-level fields
    expect(result).toHaveProperty('valueMultiplier');
    expect(result).toHaveProperty('adjustedJobPrice');
    expect(result).toHaveProperty('recommendedTier');
    expect(result).toHaveProperty('essential');
    expect(result).toHaveProperty('hassleFree');
    expect(result).toHaveProperty('highStandard');
    expect(result).toHaveProperty('quoteStyle');
    expect(result).toHaveProperty('isMultiOption');
  });

  it('isMultiOption should be false (single product model)', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO' }));
    expect(result.isMultiOption).toBe(false);
  });

  it('quoteStyle should be "hhh"', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'LANDLORD' }));
    expect(result.quoteStyle).toBe('hhh');
  });

  it('each tier should have required TierPackage fields', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'PROP_MGR' }));

    for (const tierKey of ['essential', 'hassleFree', 'highStandard'] as const) {
      const tier = result[tierKey];
      expect(tier).toHaveProperty('tier');
      expect(tier).toHaveProperty('name');
      expect(tier).toHaveProperty('coreDescription');
      expect(tier).toHaveProperty('price');
      expect(tier).toHaveProperty('warrantyMonths');
      expect(tier).toHaveProperty('perks');

      // price should be a positive number
      expect(typeof tier.price).toBe('number');
      expect(tier.price).toBeGreaterThan(0);

      // warrantyMonths should be a number
      expect(typeof tier.warrantyMonths).toBe('number');

      // perks should be an array
      expect(Array.isArray(tier.perks)).toBe(true);
    }
  });

  it('valueMultiplier should be a number', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO' }));
    expect(typeof result.valueMultiplier).toBe('number');
  });

  it('adjustedJobPrice should be a positive number', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO' }));
    expect(typeof result.adjustedJobPrice).toBe('number');
    expect(result.adjustedJobPrice).toBeGreaterThan(0);
  });

  it('recommendedTier should be a valid tier string', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO' }));
    expect(['essential', 'hassleFree', 'highStandard']).toContain(result.recommendedTier);
  });
});

// ---------------------------------------------------------------------------
// 7. Single Product Model
// ---------------------------------------------------------------------------
describe('Single Product Model', () => {
  it('essential.price === hassleFree.price === highStandard.price for BUSY_PRO', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUSY_PRO', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBe(result.hassleFree.price);
    expect(result.hassleFree.price).toBe(result.highStandard.price);
  });

  it('all three tier prices are equal for LANDLORD', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'LANDLORD', timeEstimateMinutes: 90 }));
    expect(result.essential.price).toBe(result.hassleFree.price);
    expect(result.hassleFree.price).toBe(result.highStandard.price);
  });

  it('all three tier prices are equal for BUDGET', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'BUDGET', timeEstimateMinutes: 60 }));
    expect(result.essential.price).toBe(result.hassleFree.price);
    expect(result.hassleFree.price).toBe(result.highStandard.price);
  });

  it('all three tier prices are equal for EMERGENCY', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'EMERGENCY', timeEstimateMinutes: 120 }));
    expect(result.essential.price).toBe(result.hassleFree.price);
    expect(result.hassleFree.price).toBe(result.highStandard.price);
  });

  it('all three tier prices are equal for UNKNOWN segment', () => {
    const result = generateEVEPricingQuote(makeInputs({ segment: 'UNKNOWN', timeEstimateMinutes: 45 }));
    expect(result.essential.price).toBe(result.hassleFree.price);
    expect(result.hassleFree.price).toBe(result.highStandard.price);
  });

  it('all three tier prices are equal across all known segments', () => {
    const segments = Object.keys(EVE_SEGMENT_RATES);
    for (const segment of segments) {
      const result = generateEVEPricingQuote(makeInputs({ segment, timeEstimateMinutes: 60 }));
      expect(result.essential.price).toBe(result.hassleFree.price);
      expect(result.hassleFree.price).toBe(result.highStandard.price);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Exported Constants Sanity Checks
// ---------------------------------------------------------------------------
describe('Exported Constants', () => {
  it('EVE_SEGMENT_RATES should contain all expected segments', () => {
    const expectedSegments = [
      'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ',
      'DIY_DEFERRER', 'BUDGET', 'EMERGENCY', 'TRUST_SEEKER',
      'OLDER_WOMAN', 'RENTER', 'UNKNOWN',
    ];
    for (const seg of expectedSegments) {
      expect(EVE_SEGMENT_RATES).toHaveProperty(seg);
      expect(typeof EVE_SEGMENT_RATES[seg]).toBe('number');
    }
  });

  it('REFERENCE_RATE_PENCE should be 3500', () => {
    expect(REFERENCE_RATE_PENCE).toBe(3500);
  });

  it('all segment rates should be positive integers', () => {
    for (const [segment, rate] of Object.entries(EVE_SEGMENT_RATES)) {
      expect(rate).toBeGreaterThan(0);
      expect(Number.isInteger(rate)).toBe(true);
    }
  });

  it('BUDGET rate should equal the reference rate', () => {
    expect(EVE_SEGMENT_RATES['BUDGET']).toBe(REFERENCE_RATE_PENCE);
  });

  it('EMERGENCY should have the highest rate', () => {
    const maxRate = Math.max(...Object.values(EVE_SEGMENT_RATES));
    expect(EVE_SEGMENT_RATES['EMERGENCY']).toBe(maxRate);
  });
});
