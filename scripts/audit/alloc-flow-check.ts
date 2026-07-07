import { q } from "./lib";
async function main(){
  for(const t of ["v2_bookings","contractor_jobs"]){
    try{ const r=await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m, COUNT(*) n FROM ${t} WHERE created_at>='2026-03-01' GROUP BY 1 ORDER BY 1;`);
      console.log(`${t}:`, r.map((x:any)=>`${x.m}:${x.n}`).join("  ")||"(empty)"); }catch(e:any){ console.log(`${t}: ERR ${e.message}`);} }
  // do paid quotes have booked_at / completed?
  console.dir((await q(`SELECT COUNT(*) paid, COUNT(*) FILTER (WHERE booked_at IS NOT NULL) booked_at, COUNT(*) FILTER (WHERE completed_at IS NOT NULL) completed FROM personalized_quotes WHERE deposit_paid_at IS NOT NULL AND created_at>='2026-03-01';`))[0]);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
