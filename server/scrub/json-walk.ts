/**
 * Scrubbing inside json and jsonb.
 *
 * A third of this schema's free text is not in a column at all: it is a string leaf somewhere
 * inside a quote's line items, a call's live analysis, an agent run's transcript or a case file's
 * facts. The column name says nothing about it, so the leaf is classified by the KEY IT SITS
 * UNDER, through exactly the same classifier the columns go through. A `description` inside
 * `personalized_quotes.jobs` is treated as a job description; a `phone` inside
 * `calls.metadata_json` is treated as a telephone number.
 *
 * Leaves whose key means nothing to the classifier are still swept for the identifying strings
 * the run collected, so a customer's name inside an unnamed array element does not survive.
 */
import { classify } from './plan';
import { scrubScalar, type ValueContext } from './values';
import { fakeCoordinate } from './synthetic';

const MAX_DEPTH = 12;

/** Keys whose numeric value is a coordinate and must be moved off the real one. */
const LAT_KEYS = new Set(['lat', 'latitude']);
const LNG_KEYS = new Set(['lng', 'lon', 'long', 'longitude']);

/**
 * Return a scrubbed copy of `value`. The shape is preserved exactly: objects keep their keys,
 * arrays keep their length, numbers stay numbers, nulls stay null.
 */
export function scrubJson(value: unknown, ctx: ValueContext, path: string[] = [], depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (depth > MAX_DEPTH) return value;

    if (Array.isArray(value)) {
        return value.map((v, i) => scrubJson(v, ctx, [...path, String(i)], depth + 1));
    }

    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            out[key] = scrubJsonLeaf(key, v, ctx, [...path, key], depth);
        }
        return out;
    }

    if (typeof value === 'string') {
        // A bare string with no key above it: nothing to classify, so sweep it.
        return ctx.subs.apply(value);
    }

    return value;
}

function scrubJsonLeaf(key: string, value: unknown, ctx: ValueContext, path: string[], depth: number): unknown {
    if (typeof value === 'number') {
        const snake = toSnake(key);
        if (LAT_KEYS.has(snake)) return fakeCoordinate(ctx.seed, 'coord', ctx.table, ctx.rowKey).lat;
        if (LNG_KEYS.has(snake)) return fakeCoordinate(ctx.seed, 'coord', ctx.table, ctx.rowKey).lng;
        return value;
    }

    if (typeof value === 'string') {
        const snake = toSnake(key);
        // Table-scoped so a table's own overrides apply to its json leaves too.
        const treatment = classify(ctx.table, snake);
        if (!treatment || treatment === 'keep' || treatment === 'json_deep') return ctx.subs.apply(value);
        return scrubScalar(treatment, value, {
            ...ctx,
            // The json path keys the row so two leaves never collapse to the same invented text.
            column: [ctx.column, ...path].join('.'),
        }) ?? value;
    }

    return scrubJson(value, ctx, path, depth + 1);
}

/** `customerName` and `customer_name` are the same key as far as the classifier is concerned. */
export function toSnake(key: string): string {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
}
