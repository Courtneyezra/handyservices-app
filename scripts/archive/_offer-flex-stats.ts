import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const TEST = sql`(COALESCE(q.customer_name,'') !~* 'test|qa|demo|dummy|sample')`;

async function main() {
  const rawEvents = await db.execute(sql`
    SELECT event, COUNT(*)::int AS events, COUNT(DISTINCT quote_id)::int AS quotes
    FROM quote_offer_events GROUP BY event ORDER BY event`);
  console.log('\n=== Offer events (raw, all rows) ===');
  console.table(rawEvents.rows);

  const funnel = await db.execute(sql`
    WITH ev AS (
      SELECT short_slug,
             MAX((event='impression')::int) AS shown,
             MAX((event='accept')::int)     AS accepted,
             MAX((event='decline')::int)    AS declined
      FROM quote_offer_events WHERE short_slug IS NOT NULL GROUP BY short_slug)
    SELECT
      COUNT(*) FILTER (WHERE ev.shown=1)::int    AS shown,
      COUNT(*) FILTER (WHERE ev.accepted=1)::int AS accepted,
      COUNT(*) FILTER (WHERE ev.declined=1)::int AS declined,
      COUNT(*) FILTER (WHERE ev.accepted=1 AND q.deposit_paid_at IS NOT NULL)::int AS accepted_and_booked,
      COUNT(*) FILTER (WHERE ev.accepted=1 AND q.flex_booking_within_days IS NOT NULL)::int AS accepted_flex_flag,
      COUNT(*) FILTER (WHERE ev.accepted=1 AND q.deposit_paid_at IS NOT NULL AND q.flex_booking_within_days IS NOT NULL)::int AS booked_on_flex
    FROM ev JOIN personalized_quotes q ON q.short_slug = ev.short_slug
    WHERE ${TEST}`);
  console.log('\n=== Offer funnel (per quote, test data excluded) ===');
  console.table(funnel.rows);

  const flexAll = await db.execute(sql`
    SELECT
      COUNT(*)::int AS all_quotes,
      COUNT(*) FILTER (WHERE q.flex_booking_within_days IS NOT NULL)::int AS flex_sold,
      COUNT(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL)::int AS booked_total,
      COUNT(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL AND q.flex_booking_within_days IS NOT NULL)::int AS booked_flex
    FROM personalized_quotes q WHERE ${TEST}`);
  console.log('\n=== Flex context (all quotes, independent of offer) ===');
  console.table(flexAll.rows);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
