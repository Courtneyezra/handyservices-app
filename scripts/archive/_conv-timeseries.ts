import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NT = sql`(id NOT LIKE 'test\_q\_%' AND (phone IS NULL OR (phone NOT LIKE '%447700900%' AND phone NOT LIKE '%07700900%' AND phone NOT LIKE '%449900001%')) AND (email IS NULL OR email NOT LIKE '%@example.com') AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const FLEX = sql`(flex_booking_within_days IS NOT NULL OR scheduling_tier='flexible')`;
const wk = sql`to_char(date_trunc('week', viewed_at),'MM-DD')`;
const r = await db.execute(sql`
  SELECT ${wk} AS week,
    count(*)::int AS viewed,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND EXTRACT(EPOCH FROM (deposit_paid_at-viewed_at))<7200)::int AS immed,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND EXTRACT(EPOCH FROM (deposit_paid_at-viewed_at))>=7200)::int AS delayed,
    count(*) FILTER (WHERE ${FLEX})::int AS flex_off,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL AND ${FLEX})::int AS flex_paid,
    round(avg(base_price/100.0) FILTER (WHERE deposit_paid_at IS NOT NULL))::int AS avg_paid_gbp
  FROM personalized_quotes
  WHERE ${NT} AND viewed_at >= '2026-06-01' GROUP BY 1 ORDER BY 1`);
console.log('View-wk | viewed paid  CONV%  immed delayed | flexOffer flexPaid | avg£paid');
for(const x of r.rows as any[]){
  const c = x.viewed? (100*x.paid/x.viewed).toFixed(0):'0';
  console.log(`${x.week}   |  ${String(x.viewed).padStart(3)}   ${String(x.paid).padStart(3)}  ${String(c).padStart(3)}%   ${String(x.immed).padStart(3)}   ${String(x.delayed).padStart(3)}    |    ${String(x.flex_off).padStart(3)}     ${String(x.flex_paid).padStart(3)}    | £${x.avg_paid_gbp??'-'}`);
}
// weekly calls answered rate
const EHB = sql`CASE WHEN handled_by IS NOT NULL THEN handled_by WHEN missed_reason IN ('no_answer','busy_agent') OR outcome IN ('MISSED_CALL','NO_ANSWER','FAILED','DROPPED_EARLY') THEN 'missed' WHEN outcome IN ('VOICEMAIL','VOICEMAIL_LEFT') THEN 'voicemail' WHEN eleven_labs_conversation_id IS NOT NULL THEN 'ai_agent' WHEN coalesce(duration,0)>=15 AND length(coalesce(transcription,''))>=120 THEN 'va' ELSE 'missed' END`;
const c = await db.execute(sql`
  SELECT to_char(date_trunc('week', start_time),'MM-DD') AS week, count(*)::int AS calls,
    count(*) FILTER (WHERE ${EHB} IN ('va','ai_agent'))::int AS answered,
    count(*) FILTER (WHERE ${EHB}='va')::int AS by_ben
  FROM calls WHERE start_time >= '2026-06-01' AND (phone_number IS NULL OR (phone_number NOT LIKE '%447700900%' AND phone_number NOT LIKE '%07700900%')) GROUP BY 1 ORDER BY 1`);
console.log('\nCall-wk | calls answered(rate)  benAnswered');
for(const x of c.rows as any[]){ const r=x.calls?(100*x.answered/x.calls).toFixed(0):'0'; console.log(`${x.week}   |  ${String(x.calls).padStart(3)}   ${String(x.answered).padStart(3)} (${String(r).padStart(3)}%)     ${x.by_ben}`); }
process.exit(0);
