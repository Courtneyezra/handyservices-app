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

const PHONE_LEAF_TREATMENTS = new Set(['phone', 'phone_e164', 'phone_key', 'contact']);

/**
 * Every string leaf in `value` whose key classifies as a telephone number, as written. Pass 1 needs
 * these so that a number held only inside json (a case file's channel address, say) is allocated a
 * reserved number like any other and does not survive the rewrite for want of one. A `contact`
 * leaf holding an e-mail address is not a telephone number and is left out.
 */
export function phoneLeavesIn(table: string, value: unknown, depth = 0): string[] {
    if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return [];
    const out: string[] = [];
    const entries: Array<[string | null, unknown]> = Array.isArray(value)
        ? value.map((v) => [null, v])
        : Object.entries(value as Record<string, unknown>);
    for (const [key, v] of entries) {
        if (typeof v === 'string') {
            if (key === null || v.includes('@')) continue;
            const treatment = classify(table, toSnake(key));
            if (treatment && PHONE_LEAF_TREATMENTS.has(treatment)) out.push(v);
        } else {
            out.push(...phoneLeavesIn(table, v, depth + 1));
        }
    }
    return out;
}

const EMAIL_LEAF_TREATMENTS = new Set(['email', 'contact']);

/**
 * Every string leaf in `value` whose key classifies as an e-mail address, as written (any
 * `email:`/`phone:`-style prefix included). Pass 1 needs these so an address held only inside json
 * (a case file's channel address, say) still reaches the pass-3 sweep like any classified column.
 * A `contact` leaf holding a telephone number is not an e-mail address and is left out.
 */
export function emailLeavesIn(table: string, value: unknown, depth = 0): string[] {
    if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return [];
    const out: string[] = [];
    const entries: Array<[string | null, unknown]> = Array.isArray(value)
        ? value.map((v) => [null, v])
        : Object.entries(value as Record<string, unknown>);
    for (const [key, v] of entries) {
        if (typeof v === 'string') {
            if (key === null || !v.includes('@')) continue;
            const treatment = classify(table, toSnake(key));
            if (treatment && EMAIL_LEAF_TREATMENTS.has(treatment)) out.push(v);
        } else {
            out.push(...emailLeavesIn(table, v, depth + 1));
        }
    }
    return out;
}

/** `customerName` and `customer_name` are the same key as far as the classifier is concerned. */
export function toSnake(key: string): string {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
}
