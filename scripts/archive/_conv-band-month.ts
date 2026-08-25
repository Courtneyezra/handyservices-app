import { db } from "../server/db";
import { sql } from "drizzle-orm";
const ND = `NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%'
  OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%'
  OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%'
  OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %'
  OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%'
  OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com'
  OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
const cv=(p:number,v:number)=> v? ((100*p/v).toFixed(0)+'%').padStart(5):'  -  ';
async function main(){
  console.log("=== job-size band x month — viewed / paid / conv ===");
  console.log("band         Apr            May            Jun");
  const rows:any = await q(`WITH b AS (SELECT
      CASE WHEN COALESCE(base_price,0) < 15000 THEN '<£150'
           WHEN base_price < 30000 THEN '£150-300'
           ELSE '£300+' END band,
      to_char(date_trunc('month',created_at),'MM') m,
      (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
      (deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND})
    SELECT band, m, COUNT(*) FILTER (WHERE viewed) v, COUNT(*) FILTER (WHERE paid) p
    FROM b GROUP BY band,m ORDER BY band,m;`);
  const M:any={};
  for(const r of rows){ M[r.band]=M[r.band]||{}; M[r.band][r.m]={v:+r.v,p:+r.p}; }
  for(const band of ['<£150','£150-300','£300+']){
    const c=(m:string)=>{const x=M[band]?.[m]; return x?`${String(x.p).padStart(2)}/${String(x.v).padStart(2)} ${cv(x.p,x.v)}`:'  -      ';};
    console.log(`${band.padEnd(10)}  ${c('04').padEnd(13)}  ${c('05').padEnd(13)}  ${c('06')}`);
  }
  // median quote price by month — did pricing shift up?
  console.log("\n=== median quoted base_price (£) by month, viewed quotes ===");
  for(const r of await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m,
     COUNT(*) n, ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY base_price)/100.0) med_gbp,
     ROUND(AVG(base_price)/100.0) avg_gbp
     FROM personalized_quotes WHERE created_at>='2026-03-01'
       AND (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) AND base_price>0 AND ${ND}
     GROUP BY 1 ORDER BY 1;`))
     console.log(`  ${r.m}  n=${String(r.n).padStart(3)}  median £${r.med_gbp}  avg £${r.avg_gbp}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
