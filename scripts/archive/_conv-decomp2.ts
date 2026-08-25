import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NT = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const FLEX = sql`(q.flex_booking_within_days IS NOT NULL OR q.scheduling_tier='flexible')`;
// July quotes: call-linked (to a Ben-answered call) vs not → conversion + flex-take
const r = await db.execute(sql`
  SELECT
    CASE WHEN q.source_call_id IS NOT NULL AND c.handled_by='va' THEN '1 Ben-answered call'
         WHEN q.source_call_id IS NOT NULL THEN '2 other call-linked'
         ELSE '3 no call link' END AS kind,
    count(*) FILTER (WHERE q.viewed_at IS NOT NULL)::int AS viewed,
    count(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL)::int AS paid,
    count(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL AND ${FLEX})::int AS flex_paid
  FROM personalized_quotes q LEFT JOIN calls c ON c.id=q.source_call_id
  WHERE ${sql`(q.id NOT LIKE 'test\_q\_%')`} AND q.created_at>='2026-07-01'
  GROUP BY 1 ORDER BY 1`);
console.log('July quotes by lead origin:\n');
console.log('kind                    viewed paid  conv%  flexPaid');
for(const x of r.rows as any[]){ const c=x.viewed?(100*x.paid/x.viewed).toFixed(0):'-'; console.log(`${String(x.kind).padEnd(22)}  ${String(x.viewed).padStart(4)}  ${String(x.paid).padStart(3)}  ${String(c).padStart(3)}%   ${x.flex_paid}`);}
process.exit(0);
