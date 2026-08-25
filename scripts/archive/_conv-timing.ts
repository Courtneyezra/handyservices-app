import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NOT_TEST = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const mcol = sql`to_char(date_trunc('month', created_at),'YYYY-MM')`;
// Immediate (<2h) vs delayed (>=2h) conversion, as % of VIEWED, by month
const r = await db.execute(sql`
  SELECT ${mcol} AS mth,
    count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND EXTRACT(EPOCH FROM (deposit_paid_at-viewed_at))<7200)::int AS immediate,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND EXTRACT(EPOCH FROM (deposit_paid_at-viewed_at))>=7200)::int AS delayed,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND followup_sent_at IS NOT NULL AND followup_sent_at < deposit_paid_at)::int AS paid_after_followup
  FROM personalized_quotes WHERE ${NOT_TEST} AND created_at >= '2026-05-01' AND viewed_at IS NOT NULL
  GROUP BY 1 ORDER BY 1`);
console.log('month    viewed paid  immediate(<2h)  delayed(>=2h)  paidAfterFollowup');
for(const x of r.rows as any[]){
  const iv=(100*x.immediate/x.viewed).toFixed(0), dv=(100*x.delayed/x.viewed).toFixed(0);
  console.log(`${x.mth}   ${String(x.viewed).padStart(4)}  ${String(x.paid).padStart(3)}   ${String(x.immediate).padStart(2)} (${iv.padStart(2)}% of viewed)   ${String(x.delayed).padStart(2)} (${dv.padStart(2)}% of viewed)   ${x.paid_after_followup}`);
}
process.exit(0);
