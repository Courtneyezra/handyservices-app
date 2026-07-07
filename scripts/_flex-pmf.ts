import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const rows = (r: any) => r.rows ?? r;
const J = (x:any)=>JSON.stringify(x,null,2);
const NOTTEST = sql`(id NOT LIKE 'test_q_%' AND COALESCE(phone,'') NOT LIKE '07700900%' AND COALESCE(email,'') NOT LIKE '%@example.com' AND COALESCE(customer_name,'') NOT ILIKE 'test%' AND COALESCE(customer_name,'') NOT ILIKE 'qa%')`;
(async () => {
  const cols = rows(await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='personalized_quotes' AND table_schema='public' AND (column_name ILIKE '%flex%' OR column_name ILIKE '%book%' OR column_name ILIKE '%deposit%' OR column_name ILIKE '%complete%' OR column_name ILIKE '%segment%' OR column_name ILIKE '%customer_kind%') ORDER BY column_name`));
  console.log('FLEX/BOOKING COLS:', cols.map((c:any)=>c.column_name).join(', '));

  const total = rows(await db.execute(sql`SELECT COUNT(*)::int n FROM personalized_quotes WHERE ${NOTTEST}`));
  const paid = rows(await db.execute(sql`SELECT COUNT(*)::int n FROM personalized_quotes WHERE deposit_paid_at IS NOT NULL AND ${NOTTEST}`));
  console.log(`\nNon-test quotes: ${total[0].n} total · ${paid[0].n} paid`);

  const flexDist = rows(await db.execute(sql`SELECT flex_booking_within_days AS days, COUNT(*)::int n FROM personalized_quotes WHERE deposit_paid_at IS NOT NULL AND ${NOTTEST} GROUP BY 1 ORDER BY 1`));
  console.log('\nflex_booking_within_days (paid):', J(flexDist));

  const funnel = rows(await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM contractor_booking_requests c WHERE c.quote_id=pq.id))::int AS booked,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM contractor_booking_requests c WHERE c.quote_id=pq.id) AND completed_at IS NULL)::int AS unbooked
    FROM personalized_quotes pq WHERE deposit_paid_at IS NOT NULL AND ${NOTTEST}`));
  console.log('PAID FUNNEL:', J(funnel));
  process.exit(0);
})().catch((e)=>{console.error('ERR',e?.message||e);process.exit(1);});
