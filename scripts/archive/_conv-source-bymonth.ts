import { db } from "../server/db";
import { sql } from "drizzle-orm";
const ND = `NOT (COALESCE(pq.phone,'') LIKE '07700900%' OR COALESCE(pq.phone,'') LIKE '+447700900%'
  OR COALESCE(pq.phone,'') LIKE '07700000%' OR COALESCE(pq.phone,'') LIKE '+449900%'
  OR COALESCE(pq.id,'') LIKE 'test_q_%' OR COALESCE(pq.id,'') LIKE 'pq_test_%'
  OR COALESCE(pq.customer_name,'') ILIKE '%test%' OR COALESCE(pq.customer_name,'') ILIKE 'qa %'
  OR COALESCE(pq.created_by_name,'') ILIKE '%test%' OR COALESCE(pq.created_by_name,'') ILIKE '%qa%'
  OR COALESCE(pq.created_by_name,'') ILIKE 'phase %' OR COALESCE(pq.email,'') ILIKE '%@example.com'
  OR COALESCE(pq.customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(pq.customer_name,'')))='ben')`;
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
const cv=(p:number,v:number)=> v? ((100*p/v).toFixed(1)+'%').padStart(6):'   -  ';
async function main(){
  console.log("=== leads.source x month (paid % of viewed) ===");
  console.log("source         month   viewed  paid   conv");
  for(const r of await q(`SELECT COALESCE(l.source,'(no lead)') src,
      to_char(date_trunc('month',pq.created_at),'YYYY-MM') m,
      COUNT(*) FILTER (WHERE pq.viewed_at IS NOT NULL OR COALESCE(pq.view_count,0)>0) viewed,
      COUNT(*) FILTER (WHERE pq.deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes pq LEFT JOIN leads l ON l.id=pq.lead_id
    WHERE pq.created_at>='2026-04-01' AND ${ND}
    GROUP BY 1,2 ORDER BY 1,2;`))
    console.log(`  ${String(r.src).padEnd(12)} ${r.m}  ${String(r.viewed).padStart(5)}  ${String(r.paid).padStart(4)}  ${cv(+r.paid,+r.viewed)}`);

  console.log("\n=== Ben-created quotes by month (the dominant funnel) ===");
  console.log("month   viewed  paid   conv");
  for(const r of await q(`SELECT to_char(date_trunc('month',pq.created_at),'YYYY-MM') m,
      COUNT(*) FILTER (WHERE pq.viewed_at IS NOT NULL OR COALESCE(pq.view_count,0)>0) viewed,
      COUNT(*) FILTER (WHERE pq.deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes pq
    WHERE pq.created_at>='2026-04-01' AND COALESCE(pq.created_by_name,'')='ben@handyservices.com' AND ${ND}
    GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.m}  ${String(r.viewed).padStart(5)}  ${String(r.paid).padStart(4)}  ${cv(+r.paid,+r.viewed)}`);

  console.log("\n=== conversion by quote PRICE band (does drop hit big jobs?) Apr vs MayJun ===");
  for(const r of await q(`WITH b AS (SELECT
      CASE WHEN COALESCE(base_price,0) < 15000 THEN '1 <£150'
           WHEN base_price < 30000 THEN '2 £150-300'
           WHEN base_price < 60000 THEN '3 £300-600'
           ELSE '4 £600+' END band,
      CASE WHEN created_at<'2026-05-01' THEN 'Apr' ELSE 'MayJun' END period,
      (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
      (deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes pq WHERE created_at>='2026-04-01' AND ${ND})
    SELECT band, period, COUNT(*) FILTER (WHERE viewed) v, COUNT(*) FILTER (WHERE paid) p
    FROM b GROUP BY band,period ORDER BY band,period;`))
    console.log(`  ${String(r.band).padEnd(11)} ${String(r.period).padEnd(6)} viewed=${String(r.v).padStart(3)} paid=${String(r.p).padStart(3)}  ${cv(+r.p,+r.v)}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
