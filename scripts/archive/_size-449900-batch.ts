import { db } from "../server/db";
import { sql } from "drizzle-orm";
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
async function main(){
  console.log("=== +449900 synthetic rows by created-month ===");
  for(const r of await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m,
     COUNT(*) n,
     COUNT(*) FILTER (WHERE viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
     COUNT(*) FILTER (WHERE deposit_paid_at IS NOT NULL) paid
     FROM personalized_quotes WHERE COALESCE(phone,'') LIKE '+449900%' GROUP BY 1 ORDER BY 1;`))
     console.log(`  ${r.m}  n=${r.n}  viewed=${r.viewed}  paid=${r.paid}`);
  console.log("\n=== other suspicious +44 ranges (not real UK mobile +447) ===");
  for(const r of await q(`SELECT LEFT(phone,7) pfx, COUNT(*) n FROM personalized_quotes
     WHERE phone LIKE '+44%' AND phone NOT LIKE '+447%' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;`))
     console.log(`  ${r.pfx}...  ${r.n}`);
  console.log("\n=== CLEAN monthly volume after removing +449900 batch ===");
  for(const r of await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m,
     COUNT(*) gen,
     COUNT(*) FILTER (WHERE viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
     COUNT(*) FILTER (WHERE deposit_paid_at IS NOT NULL) paid
     FROM personalized_quotes
     WHERE COALESCE(phone,'') NOT LIKE '+449900%'
       AND NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%'
         OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(id,'') LIKE 'test_q_%'
         OR COALESCE(id,'') LIKE 'pq_test_%' OR COALESCE(customer_name,'') ILIKE '%test%'
         OR COALESCE(customer_name,'') ILIKE 'qa %' OR COALESCE(created_by_name,'') ILIKE '%test%'
         OR COALESCE(created_by_name,'') ILIKE '%qa%' OR COALESCE(created_by_name,'') ILIKE 'phase %'
         OR COALESCE(email,'') ILIKE '%@example.com' OR COALESCE(customer_name,'') ILIKE 'courtnee%'
         OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')
     GROUP BY 1 ORDER BY 1;`)){
     const g=+r.gen,v=+r.viewed,p=+r.paid;
     console.log(`  ${r.m}  gen=${String(g).padStart(3)}  viewed=${String(v).padStart(3)}  view%=${g?((100*v/g).toFixed(0)+'%').padStart(4):'-'}  paid=${String(p).padStart(3)}  conv(ofView)=${v?((100*p/v).toFixed(1)+'%').padStart(5):'-'}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
