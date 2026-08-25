import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NOT_TEST = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const r = await db.execute(sql`
  SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS mth,
    count(*)::int AS created,
    count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid,
    count(*) FILTER (WHERE source_channel IS NOT NULL)::int AS has_channel,
    count(*) FILTER (WHERE source_call_id IS NOT NULL)::int AS has_call,
    count(*) FILTER (WHERE segment IS NOT NULL AND segment <> 'UNKNOWN')::int AS has_segment
  FROM personalized_quotes
  WHERE ${NOT_TEST} AND created_at >= '2026-05-01'
  GROUP BY 1 ORDER BY 1`);
console.log('month   created viewed paid  hasChannel hasCall hasSegment');
for (const x of r.rows as any[]) console.log(`${x.mth}   ${String(x.created).padStart(6)} ${String(x.viewed).padStart(5)} ${String(x.paid).padStart(4)}  ${String(x.has_channel).padStart(9)} ${String(x.has_call).padStart(6)} ${String(x.has_segment).padStart(9)}`);
process.exit(0);
