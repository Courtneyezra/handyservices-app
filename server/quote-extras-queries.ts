/**
 * The extras catalog's raw SQL, kept apart from the router so it can be compiled without a
 * database. `quote-extras-catalog.ts` imports `./db` at module level, which throws without
 * DATABASE_URL; the test for the query below needs neither.
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
