import { describe, it, expect } from 'vitest';
import { resolveQuoteTeam, deriveTeamFit, type TeamCandidate } from './quote-team';

// Roster mirrors the founder-confirmed tiers: Core = Craig, Bezent, Joe (Craig
// first via priority); ad-hoc = Dwaine. Each fixture sets coveredCategories to
// the required cats the contractor can do.
const craig = (cats: string[]): TeamCandidate => ({ contractorId: 'craig', tier: 'core', priority: 1, coveredCategories: cats });
const bezent = (cats: string[]): TeamCandidate => ({ contractorId: 'bezent', tier: 'core', priority: 2, coveredCategories: cats });
const joe = (cats: string[]): TeamCandidate => ({ contractorId: 'joe', tier: 'core', priority: 3, coveredCategories: cats });
const dwaine = (cats: string[]): TeamCandidate => ({ contractorId: 'dwaine', tier: 'adhoc', priority: null, coveredCategories: cats });

describe('resolveQuoteTeam', () => {
  it('AC1 — solo when one contractor covers every category', () => {
    const plan = resolveQuoteTeam(['joinery', 'decorating'], [craig(['joinery', 'decorating'])]);
    expect(plan.bookable).toBe(true);
    expect(plan.kind).toBe('solo');
    expect(plan.leadContractorId).toBe('craig');
    expect(plan.assignments).toEqual([
      { contractorId: 'craig', role: 'lead', coveredCategories: ['joinery', 'decorating'] },
    ]);
    expect(plan.uncoveredCategories).toEqual([]);
  });

  it('AC2 — Craig-first: committed lowest-priority wins the lead over an ad-hoc that also covers all', () => {
    const plan = resolveQuoteTeam(
      ['joinery', 'decorating'],
      [dwaine(['joinery', 'decorating']), craig(['joinery', 'decorating'])],
    );
    expect(plan.kind).toBe('solo');
    expect(plan.leadContractorId).toBe('craig');
  });

  it('AC3 — compose (the bug fix): multi-trade no one covers alone is now bookable', () => {
    // The classic zero-pool quote: plumbing + Part P electrical.
    const plan = resolveQuoteTeam(
      ['plumbing_minor', 'electrical_part_p'],
      [craig(['plumbing_minor']), joe(['electrical_part_p'])],
    );
    expect(plan.bookable).toBe(true);
    expect(plan.kind).toBe('composed');
    expect(plan.leadContractorId).toBe('craig');
    expect(plan.assignments).toContainEqual({ contractorId: 'craig', role: 'lead', coveredCategories: ['plumbing_minor'] });
    expect(plan.assignments).toContainEqual({ contractorId: 'joe', role: 'specialist', coveredCategories: ['electrical_part_p'] });
    expect(plan.uncoveredCategories).toEqual([]);
  });

  it('AC4 — no supply: a category nobody covers is not bookable and is surfaced', () => {
    const plan = resolveQuoteTeam(
      ['plumbing_minor', 'gas_safe'],
      [craig(['plumbing_minor']), joe([]), dwaine([])],
    );
    expect(plan.bookable).toBe(false);
    expect(plan.kind).toBe('no_supply');
    expect(plan.uncoveredCategories).toEqual(['gas_safe']);
    expect(plan.leadContractorId).toBeNull();
  });

  it('AC5 — steer: lead stays committed even when an ad-hoc covers more lines', () => {
    // Craig (core) covers 1 of 3; Dwaine (ad-hoc) covers the other 2.
    const plan = resolveQuoteTeam(
      ['joinery', 'tiling', 'flooring'],
      [craig(['joinery']), dwaine(['tiling', 'flooring'])],
    );
    expect(plan.kind).toBe('composed');
    expect(plan.leadContractorId).toBe('craig');
    const lead = plan.assignments.find((a) => a.role === 'lead');
    const spec = plan.assignments.find((a) => a.role === 'specialist');
    expect(lead).toEqual({ contractorId: 'craig', role: 'lead', coveredCategories: ['joinery'] });
    expect(spec).toEqual({ contractorId: 'dwaine', role: 'specialist', coveredCategories: ['tiling', 'flooring'] });
  });

  it('AC6 — dedupe: duplicate category slugs from multi-line quotes do not break coverage', () => {
    // 4 line items, 2 distinct cats with a repeat — Craig covers both distinct → solo.
    const plan = resolveQuoteTeam(
      ['pressure_washing', 'garden', 'pressure_washing', 'garden'],
      [craig(['pressure_washing', 'garden'])],
    );
    expect(plan.kind).toBe('solo');
    expect(plan.leadContractorId).toBe('craig');
    expect(plan.assignments[0].coveredCategories).toEqual(['pressure_washing', 'garden']);
  });

  it('empty required categories → not bookable, no assignments', () => {
    const plan = resolveQuoteTeam([], [craig(['joinery'])]);
    expect(plan.bookable).toBe(false);
    expect(plan.kind).toBe('no_supply');
    expect(plan.assignments).toEqual([]);
  });

  it('composes across three contractors, grouping each specialist once', () => {
    const plan = resolveQuoteTeam(
      ['joinery', 'plumbing_minor', 'electrical_part_p'],
      [craig(['joinery']), bezent(['plumbing_minor']), joe(['electrical_part_p'])],
    );
    expect(plan.bookable).toBe(true);
    expect(plan.leadContractorId).toBe('craig');
    expect(plan.assignments).toHaveLength(3);
    expect(plan.assignments.filter((a) => a.role === 'specialist').map((a) => a.contractorId).sort()).toEqual(['bezent', 'joe']);
  });
});

describe('deriveTeamFit — availability anchoring', () => {
  it('solo → calendar reflects the UNION of everyone who can solo the job', () => {
    const fit = deriveTeamFit(
      ['joinery', 'decorating'],
      [craig(['joinery', 'decorating']), bezent(['joinery', 'decorating'])],
    );
    expect(fit.plan.kind).toBe('solo');
    expect(fit.availabilityContractorIds.sort()).toEqual(['bezent', 'craig']);
    expect(fit.fullCoverageCandidateIds.sort()).toEqual(['bezent', 'craig']);
  });

  it('composed → calendar is ANCHORED on the lead only (specialists hold no availability)', () => {
    const fit = deriveTeamFit(
      ['plumbing_minor', 'electrical_part_p'],
      [craig(['plumbing_minor']), joe(['electrical_part_p'])],
    );
    expect(fit.plan.kind).toBe('composed');
    expect(fit.availabilityContractorIds).toEqual(['craig']); // Ben coordinates Joe post-confirm
    expect(fit.fullCoverageCandidateIds).toEqual([]);
  });

  it('no_supply → empty availability (dead calendar only on a true gap)', () => {
    const fit = deriveTeamFit(['plumbing_minor', 'gas_safe'], [craig(['plumbing_minor'])]);
    expect(fit.plan.kind).toBe('no_supply');
    expect(fit.availabilityContractorIds).toEqual([]);
    expect(fit.plan.uncoveredCategories).toEqual(['gas_safe']);
  });
});
