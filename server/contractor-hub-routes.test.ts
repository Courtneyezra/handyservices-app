import { describe, it, expect } from 'vitest';
import { assembleHub, type HubContractorInput, type CapacityGap } from './lib/contractor-hub';

const mk = (over: Partial<HubContractorInput>): HubContractorInput => ({
  id: 'x', name: 'X', tier: 'core', priority: null, imageUrl: null, skills: [], bookedDaysThisWeek: 0, committedDaysPerWeek: null, pipelineCount: 0,
  ...over,
});

describe('assembleHub', () => {
  it('groups into partner/core/adhoc bands in fixed order with labels', () => {
    const hub = assembleHub([mk({ id: 'd', name: 'Dwaine', tier: 'adhoc' }), mk({ id: 'c', name: 'Craig', tier: 'core', priority: 1 })], []);
    expect(hub.bands.map((b) => b.tier)).toEqual(['partner', 'core', 'adhoc']);
    expect(hub.bands.map((b) => b.label)).toEqual(['Partner', 'Core', 'Ad-hoc']);
    expect(hub.bands[1].contractors.map((c) => c.id)).toEqual(['c']);
    expect(hub.bands[2].contractors.map((c) => c.id)).toEqual(['d']);
  });

  it('sorts within a band Craig-first by priority (nulls last, then name)', () => {
    const hub = assembleHub(
      [
        mk({ id: 'joe', name: 'Joe', tier: 'core', priority: 3 }),
        mk({ id: 'craig', name: 'Craig', tier: 'core', priority: 1 }),
        mk({ id: 'bez', name: 'Bezent', tier: 'core', priority: 2 }),
        mk({ id: 'z', name: 'Zed', tier: 'core', priority: null }),
      ],
      [],
    );
    expect(hub.bands[1].contractors.map((c) => c.id)).toEqual(['craig', 'bez', 'joe', 'z']);
  });

  it('computes fill % against committed days, falling back to a 5-day target', () => {
    const hub = assembleHub(
      [
        mk({ id: 'a', tier: 'core', bookedDaysThisWeek: 3, committedDaysPerWeek: 4 }), // 75%
        mk({ id: 'b', tier: 'core', bookedDaysThisWeek: 2, committedDaysPerWeek: null }), // 2/5 = 40%
      ],
      [],
    );
    const core = hub.bands[1].contractors;
    expect(core.find((c) => c.id === 'a')!.fillPercent).toBe(75);
    expect(core.find((c) => c.id === 'b')!.fillPercent).toBe(40);
  });

  it('clamps fill % to 100 when over-booked', () => {
    const hub = assembleHub([mk({ id: 'a', tier: 'core', bookedDaysThisWeek: 6, committedDaysPerWeek: 4 })], []);
    expect(hub.bands[1].contractors[0].fillPercent).toBe(100);
  });

  it('passes capacity gaps through', () => {
    const gaps: CapacityGap[] = [{ quoteId: 'q1', slug: 'QTE-1', postcode: 'NG7', uncoveredCategories: ['gas_safe'] }];
    const hub = assembleHub([], gaps);
    expect(hub.capacityGaps).toEqual(gaps);
    expect(hub.bands.every((b) => b.contractors.length === 0)).toBe(true);
  });
});
