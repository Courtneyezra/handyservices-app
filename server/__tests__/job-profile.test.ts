// server/__tests__/job-profile.test.ts
//
// Tests for the JobProfile derivation rules in server/job-profile.ts.
// Module 02 §10 calls these out as the v1 must-pass set:
//   - solo crew, no certs → no team / no specialist
//   - crew_size > 1 → requires_team
//   - heavy_lifting alone (crew_size 1) → requires_team
//   - any cert → requires_specialist
//
// We test computeJobProfileFromRow directly (the synchronous variant) so the
// suite stays DB-free; computeJobProfile is the same code path with a SELECT
// in front of it.

import { describe, it, expect } from 'vitest';
import {
    computeJobProfileFromRow,
    type PersonalizedQuoteRow,
} from '../job-profile';

function makeRow(overrides: Partial<PersonalizedQuoteRow> = {}): PersonalizedQuoteRow {
    return {
        id: 'quote-test-1',
        crewSizeRequired: 1,
        skillsRequired: [],
        certRequired: [],
        durationEstimateMinutes: 60,
        realWorkMinutes: 30,
        complexityFlags: [],
        heavyLifting: false,
        flexTier: null,
        postcode: 'NG2 1AA',
        ...overrides,
    };
}

describe('computeJobProfileFromRow — derived rules', () => {
    it('crew_size=1 with no certs and no heavy_lifting → no team, no specialist', () => {
        const profile = computeJobProfileFromRow(makeRow());
        expect(profile.requires_team).toBe(false);
        expect(profile.requires_specialist).toBe(false);
        expect(profile.crew_size).toBe(1);
    });

    it('crew_size=3 → requires_team', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ crewSizeRequired: 3 }),
        );
        expect(profile.requires_team).toBe(true);
        expect(profile.crew_size).toBe(3);
    });

    it('heavy_lifting=true with crew_size=1 → requires_team (denormalised flag)', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ crewSizeRequired: 1, heavyLifting: true }),
        );
        expect(profile.requires_team).toBe(true);
        expect(profile.heavy_lifting).toBe(true);
    });

    it('certs=["gas_safe"] → requires_specialist', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ certRequired: ['gas_safe'] }),
        );
        expect(profile.requires_specialist).toBe(true);
        expect(profile.certs).toContain('gas_safe');
    });

    it('multiple certs → requires_specialist (count > 0 is the gate)', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ certRequired: ['gas_safe', 'part_p'] }),
        );
        expect(profile.requires_specialist).toBe(true);
        expect(profile.certs.length).toBe(2);
    });

    it('real_work_minutes within a day → multi_day_capable=false', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ realWorkMinutes: 6 * 60 }),  // 6h
        );
        expect(profile.multi_day_capable).toBe(false);
    });

    it('real_work_minutes spanning multiple days → multi_day_capable=true', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ realWorkMinutes: 12 * 60 }),  // 12h on-site
        );
        expect(profile.multi_day_capable).toBe(true);
    });

    it('flex_tier=fast maps customer_flexibility=rigid', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ flexTier: 'fast' }),
        );
        expect(profile.customer_flexibility).toBe('rigid');
    });

    it('flex_tier=relaxed maps customer_flexibility=very_flexible', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ flexTier: 'relaxed' }),
        );
        expect(profile.customer_flexibility).toBe('very_flexible');
    });

    it('flex_tier unset and no sentinel → customer_flexibility defaults to flexible', () => {
        const profile = computeJobProfileFromRow(makeRow());
        expect(profile.customer_flexibility).toBe('flexible');
    });

    it('admin sentinel "rigid" in complexity_flags is honoured when flex_tier missing', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ flexTier: null, complexityFlags: ['rigid'] }),
        );
        expect(profile.customer_flexibility).toBe('rigid');
    });

    it('NULL columns in the row default to safe values (no exception)', () => {
        const profile = computeJobProfileFromRow({
            id: 'quote-null',
            crewSizeRequired: null,
            skillsRequired: null,
            certRequired: null,
            durationEstimateMinutes: null,
            realWorkMinutes: null,
            complexityFlags: null,
            heavyLifting: null,
            postcode: null,
        });
        expect(profile.crew_size).toBe(1);
        expect(profile.skills).toEqual([]);
        expect(profile.certs).toEqual([]);
        expect(profile.duration_minutes).toBe(0);
        expect(profile.real_work_minutes).toBe(0);
        expect(profile.heavy_lifting).toBe(false);
        expect(profile.requires_team).toBe(false);
        expect(profile.requires_specialist).toBe(false);
    });

    it('non-string entries in skillsRequired are filtered out', () => {
        const profile = computeJobProfileFromRow(
            makeRow({ skillsRequired: ['carpentry', 42, null, 'plumbing_minor'] as unknown[] }),
        );
        expect(profile.skills).toEqual(['carpentry', 'plumbing_minor']);
    });
});
