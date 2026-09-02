/**
 * Every case file under eval-cases/ must load and validate, and the eight customer intents
 * (customer.default + customer.post_quote) must each have a regression family of ≥ 5 cases whose
 * positive cases declare that intent — the input the Phase 3 autonomy job reads.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadCases, validateCase } from './case-schema';
import { SCOPER_INTENTS, POST_QUOTE_INTENTS } from '../spine/vocab';

const ROOT = path.resolve(__dirname, '..', '..', 'eval-cases');

describe('eval-cases', () => {
    const { cases, errors } = loadCases(ROOT);
    it('every file loads and validates, ids are unique', () => {
        expect(errors).toEqual([]);
        expect(cases.length).toBeGreaterThan(200);
    });
    it('validateCase rejects the shapes the loader must refuse', () => {
        expect(validateCase({}, 'f')).toContain('f: missing id');
        expect(validateCase({ id: 'x', family: 'f', context: [] }, 'f')).toContain('f: x missing expected');
        expect(validateCase({ id: 'x', family: 'f', expected: {} }, 'f')).toContain('f: x needs caseFile or context');
        expect(validateCase({ id: 'x', family: 'f', context: [], expected: {}, kind: 'weird' }, 'f')).toContain('f: x bad kind');
    });
    it.each([...SCOPER_INTENTS.filter((i) => i !== 'holding'), ...POST_QUOTE_INTENTS])('intent family %s has ≥ 5 regression cases and positives declare the intent', (intent) => {
        const fam = cases.filter((c) => c.family === intent);
        expect(fam.length).toBeGreaterThanOrEqual(5);
        for (const c of fam) {
            expect(c.kind ?? 'regression').toBe('regression');
            if (!c.expected.mustFlag) {
                expect(c.expected.mustNotEscalate, `${c.id} should be a positive or an absence case`).toBe(true);
                if (c.expected.intent) expect(c.expected.intent).toBe(intent);
            }
            expect(c.expected.lane).toBeDefined();
        }
        expect(fam.some((c) => c.expected.mustFlag), `${intent} needs a must-flag case`).toBe(true);
        expect(fam.some((c) => c.expected.intent === intent), `${intent} needs a positive case`).toBe(true);
    });
});
