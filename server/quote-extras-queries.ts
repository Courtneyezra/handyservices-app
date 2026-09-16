/**
 * The extras catalog's raw SQL and the rule for which picks it counts, kept apart from the router
 * so both can be exercised without a database. `quote-extras-catalog.ts` imports `./db` at module
 * level, which throws without DATABASE_URL; the tests below need neither.
 */
import { sql } from 'drizzle-orm';

/**
 * Bump `pick_count` for every catalog row whose label is in the list, as one query.
 *
 * The label list has to reach Postgres as ONE bound array parameter, hence `sql.param`.
 * Interpolating the JS array straight into the template does NOT bind an array: drizzle expands it
 * in place into `($1, $2, ...)`, which Postgres reads as a record, and the `::text[]` cast that
 * follows fails the whole query with "cannot cast type record to text[]" (a single label expands to
 * `($1)::text[]` and fails just the same). That failure used to be swallowed by a warn-only catch,
 * so pick counts simply never incremented and nothing said so. Same fix, same shape, as the price
 * queue's estimates read (`server/spine/price-queue.ts`).
 */
export function extrasPickCountQuery(labels: string[]) {
    return sql`
      UPDATE quote_extras_catalog
      SET pick_count = pick_count + 1
      WHERE label = ANY(${sql.param(labels)}::text[])
    `;
}

/**
 * The labels a save should count as picks.
 *
 * `pick_count` answers "how many quotes picked this extra", so a pick counts once per quote, not
 * once per save. On a create there is no stored quote and every picked label counts; on an in-place
 * edit only the labels that were not already on the stored quote count, so re-saving unchanged
 * extras bumps nothing while an extra added during the edit still bumps once.
 *
 * `storedExtras` is the quote's `optional_extras` JSONB — entries of the shape
 * `{label, description, priceInPence, badge?}`. Null, absent or malformed means no stored labels.
 */
export function newlyPickedExtraLabels(
    picked: readonly { label: string }[] | null | undefined,
    storedExtras: unknown,
): string[] {
    const labels = (picked ?? []).map((x) => x.label);
    if (labels.length === 0) return [];

    const stored = new Set(
        (Array.isArray(storedExtras) ? storedExtras : [])
            .map((entry) =>
                entry && typeof entry === 'object' ? (entry as { label?: unknown }).label : undefined,
            )
            .filter((label): label is string => typeof label === 'string'),
    );

    return labels.filter((label) => !stored.has(label));
}
