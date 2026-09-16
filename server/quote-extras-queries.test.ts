/**
 * The extras pick-count query, compiled not executed: no database.
 *
 * The regression: the UPDATE interpolated the JS label list straight into the sql template, and
 * drizzle expands an array in place — `($1, $2)`, a record — so `::text[]` failed with "cannot cast
 * type record to text[]" and no pick count ever incremented. Unlike the same bug in the price queue
 * (`server/spine/price-queue.ts`) it never showed as a 500: a warn-only catch around the execute
 * swallowed it. The list has to arrive as ONE bound array parameter whatever its length.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { extrasPickCountQuery, newlyPickedExtraLabels } from './quote-extras-queries';

const compile = (labels: string[]) => new PgDialect().sqlToQuery(extrasPickCountQuery(labels));

describe('the extras pick-count query binds the label list as one array parameter', () => {
    for (const [label, labels] of [
        ['one extra', ['Extra socket']],
        ['two extras', ['Extra socket', 'Cable tidy']],
        ['a realistic pick', ['Extra socket', 'Cable tidy', 'Soundbar bracket', 'Old TV removal']],
    ] as const) {
        it(`${label}: any($1::text[]), one parameter holding the whole list`, () => {
            const q = compile([...labels]);
            expect(q.sql).toContain('label = ANY($1::text[])');
            expect(q.params).toEqual([[...labels]]);
        });

        it(`${label}: the list is never expanded into a record`, () => {
            const q = compile([...labels]);
            expect(q.sql).not.toContain('$2');
            expect(q.sql).not.toMatch(/ANY\(\(/);
        });
    }

    it('still bumps pick_count on the catalog table', () => {
        const q = compile(['Extra socket']);
        expect(q.sql).toContain('UPDATE quote_extras_catalog');
        expect(q.sql).toContain('SET pick_count = pick_count + 1');
    });
});

describe('a pick counts once per quote, not once per save', () => {
    const extra = (label: string) => ({
        label,
        description: `${label} — fitted on the day`,
        priceInPence: 4500,
    });

    it('a create counts every picked label: no stored quote', () => {
        expect(newlyPickedExtraLabels([extra('Extra socket'), extra('Cable tidy')], null))
            .toEqual(['Extra socket', 'Cable tidy']);
    });

    it('re-saving a quote whose extras are unchanged counts nothing', () => {
        const picked = [extra('Extra socket'), extra('Cable tidy')];
        const stored = [extra('Extra socket'), extra('Cable tidy')];
        expect(newlyPickedExtraLabels(picked, stored)).toEqual([]);
    });

    it('an extra added during an edit counts once, and only that one', () => {
        const stored = [extra('Extra socket'), extra('Cable tidy')];
        const picked = [extra('Extra socket'), extra('Cable tidy'), extra('Soundbar bracket')];
        expect(newlyPickedExtraLabels(picked, stored)).toEqual(['Soundbar bracket']);
    });

    it('dropping an extra during an edit counts nothing: pick_count never falls', () => {
        const stored = [extra('Extra socket'), extra('Cable tidy')];
        expect(newlyPickedExtraLabels([extra('Extra socket')], stored)).toEqual([]);
    });

    it('a quote stored with no extras counts every picked label', () => {
        expect(newlyPickedExtraLabels([extra('Extra socket')], undefined)).toEqual(['Extra socket']);
        expect(newlyPickedExtraLabels([extra('Extra socket')], [])).toEqual(['Extra socket']);
    });

    it('nothing picked leaves an empty list, so no query runs', () => {
        expect(newlyPickedExtraLabels([], [extra('Extra socket')])).toEqual([]);
        expect(newlyPickedExtraLabels(undefined, null)).toEqual([]);
    });
});
