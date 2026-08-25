import { db } from "../server/db"; import { sql } from "drizzle-orm";
const ND=`NOT (COALESCE(pq.phone,'') LIKE '07700900%' OR COALESCE(pq.phone,'') LIKE '+447700900%' OR COALESCE(pq.phone,'') LIKE '07700000%' OR COALESCE(pq.phone,'') LIKE '+449900%' OR COALESCE(pq.id,'') LIKE 'test_q_%' OR COALESCE(pq.id,'') LIKE 'pq_test_%' OR COALESCE(pq.customer_name,'') ILIKE '%test%' OR COALESCE(pq.customer_name,'') ILIKE 'qa %' OR COALESCE(pq.created_by_name,'') ILIKE '%test%' OR COALESCE(pq.created_by_name,'') ILIKE '%qa%' OR COALESCE(pq.created_by_name,'') ILIKE 'phase %' OR COALESCE(pq.email,'') ILIKE '%@example.com' OR COALESCE(pq.customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(pq.customer_name,'')))='ben')`;
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
async function main(){
  // does an invoices table exist & link to quotes?
  console.log("=== signals of a 'job happened' beyond deposit_paid, by month ===");
  console.log("month   deposit_paid  completed_at  has_invoice  bookedAt  DONE_no_deposit");
  for(const r of await q(`
    SELECT to_char(date_trunc('month',pq.created_at),'YYYY-MM') m,
      COUNT(*) FILTER (WHERE pq.deposit_paid_at IS NOT NULL) paid,
      COUNT(*) FILTER (WHERE pq.completed_at IS NOT NULL) completed,
      COUNT(*) FILTER (WHERE inv.quote_id IS NOT NULL) invoiced,
      COUNT(*) FILTER (WHERE pq.booked_at IS NOT NULL) booked,
      COUNT(*) FILTER (WHERE pq.deposit_paid_at IS NULL AND (pq.completed_at IS NOT NULL OR inv.quote_id IS NOT NULL)) done_no_dep
    FROM personalized_quotes pq
    LEFT JOIN (SELECT DISTINCT quote_id FROM invoices) inv ON inv.quote_id = pq.id
    WHERE pq.created_at>='2026-04-01' AND ${ND}
    GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.m}  ${String(r.paid).padStart(11)}  ${String(r.completed).padStart(12)}  ${String(r.invoiced).padStart(11)}  ${String(r.booked).padStart(8)}  ${String(r.done_no_dep).padStart(14)}`);
  process.exit(0);
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
