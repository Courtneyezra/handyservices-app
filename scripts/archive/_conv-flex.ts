import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NOT_TEST = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const mcol = sql`to_char(date_trunc('month', created_at),'YYYY-MM')`;
const FLEX = sql`(flex_booking_within_days IS NOT NULL OR scheduling_tier='flexible')`;
const r = await db.execute(sql`
  SELECT ${mcol} AS mth,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND ${FLEX})::int AS paid_flex,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND EXTRACT(EPOCH FROM (deposit_paid_at-viewed_at))>=7200)::int AS delayed,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND EXTRACT(EPOCH FROM (deposit_paid_at-viewed_at))>=7200 AND ${FLEX})::int AS delayed_flex,
    count(*) FILTER (WHERE viewed_at IS NOT NULL AND ${FLEX})::int AS viewed_flex,
    count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed
  FROM personalized_quotes WHERE ${NOT_TEST} AND created_at >= '2026-05-01' AND viewed_at IS NOT NULL
  GROUP BY 1 ORDER BY 1`);
console.log('month    paid  paidFlex  delayed  delayedFlex   flexOffered(ofViewed)');
for(const x of r.rows as any[]){
  console.log(`${x.mth}   ${String(x.paid).padStart(3)}   ${String(x.paid_flex).padStart(4)}      ${String(x.delayed).padStart(3)}      ${String(x.delayed_flex).padStart(3)}         ${x.viewed_flex}/${x.viewed}`);
}
process.exit(0);
