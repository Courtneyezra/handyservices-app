import { db } from "../server/db"; import { sql } from "drizzle-orm";
const ND=`NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%' OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%' OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%' OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %' OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%' OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com' OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
async function main(){
  // does payment_intent_id mean "started checkout"? correlate with paid
  console.log("=== does stripe_payment_intent_id predict paid? (validates it = checkout started) ===");
  for(const r of await q(`SELECT (stripe_payment_intent_id IS NOT NULL) has_pi, COUNT(*) n,
     COUNT(*) FILTER (WHERE deposit_paid_at IS NOT NULL) paid
     FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND} GROUP BY 1;`))
     console.log(`  has_payment_intent=${r.has_pi}  n=${r.n}  paid=${r.paid}`);

  // among VIEWED, started-checkout rate and finish rate, big vs small, before/after Apr 28
  console.log("\n=== VIEWED quotes: started checkout (has PI) vs finished (paid), by size & period ===");
  console.log("group                     viewed  started  finished  start%  finish-of-started%");
  for(const r of await q(`WITH b AS (
     SELECT CASE WHEN base_price>=30000 THEN 'BIG £300+' ELSE 'small' END size,
       CASE WHEN created_at < '2026-04-28' THEN 'pre Apr28' ELSE 'Apr28+' END period,
       (stripe_payment_intent_id IS NOT NULL) started, (deposit_paid_at IS NOT NULL) paid
     FROM personalized_quotes WHERE created_at>='2026-04-01'
       AND (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) AND ${ND})
     SELECT size, period, COUNT(*) viewed, COUNT(*) FILTER (WHERE started) started, COUNT(*) FILTER (WHERE paid) paid
     FROM b GROUP BY size,period ORDER BY size DESC, period DESC;`)){
     const v=+r.viewed,s=+r.started,p=+r.paid;
     console.log(`  ${(r.size+' / '+r.period).padEnd(24)} ${String(v).padStart(5)}  ${String(s).padStart(6)}  ${String(p).padStart(7)}   ${(100*s/v).toFixed(0).padStart(3)}%   ${s?(100*p/s).toFixed(0)+'%':'-'}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
