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
async function dist(label:string, expr:string){
  console.log(`\n=== ${label} (created>=Apr, clean) ===`);
  for(const r of await q(`SELECT ${expr} v, COUNT(*) n,
    COUNT(*) FILTER (WHERE viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
    COUNT(*) FILTER (WHERE deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes pq WHERE created_at>='2026-04-01' AND ${ND}
    GROUP BY 1 ORDER BY 2 DESC;`))
    console.log(`  ${String(r.v).padEnd(16)} n=${String(r.n).padStart(3)} viewed=${String(r.viewed).padStart(3)} paid=${String(r.paid).padStart(3)}`);
}
async function main(){
  await dist("segment", "COALESCE(segment,'(null)')");
  await dist("persona", "COALESCE(persona,'(null)')");
  await dist("client_type", "COALESCE(client_type,'(null)')");
  await dist("job_type", "COALESCE(job_type,'(null)')");
  await dist("ownership_context", "COALESCE(ownership_context,'(null)')");
  await dist("delivery_channel", "COALESCE(delivery_channel,'(null)')");
  await dist("created_by", "COALESCE(created_by_name,'(null)')");
  // leads.source via join
  console.log(`\n=== leads.source (joined via lead_id, created>=Apr, clean) ===`);
  for(const r of await q(`SELECT COALESCE(l.source,'(no lead)') v, COUNT(*) n,
    COUNT(*) FILTER (WHERE pq.viewed_at IS NOT NULL OR COALESCE(pq.view_count,0)>0) viewed,
    COUNT(*) FILTER (WHERE pq.deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes pq LEFT JOIN leads l ON l.id = pq.lead_id
    WHERE pq.created_at>='2026-04-01' AND ${ND}
    GROUP BY 1 ORDER BY 2 DESC;`))
    console.log(`  ${String(r.v).padEnd(16)} n=${String(r.n).padStart(3)} viewed=${String(r.viewed).padStart(3)} paid=${String(r.paid).padStart(3)}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
