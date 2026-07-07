import { q } from "./lib";
async function main(){
  console.log("=== CONTRACTORS (handyman_profiles) ===");
  console.dir((await q(`SELECT COUNT(*) total,
    COUNT(*) FILTER (WHERE verification_status='verified') verified,
    COUNT(*) FILTER (WHERE availability_status='available') available,
    COUNT(*) FILTER (WHERE latitude IS NOT NULL) geocoded FROM handyman_profiles;`))[0]);
  console.log("\n=== SKILL GRAPH (handyman_skills) ===");
  console.dir((await q(`SELECT COUNT(*) skill_rows, COUNT(DISTINCT handyman_id) tagged_contractors,
    COUNT(*) FILTER (WHERE category_slug IS NOT NULL) with_category,
    COUNT(*) FILTER (WHERE service_id IS NOT NULL) with_sku FROM handyman_skills;`))[0]);
  console.log("\n=== AVAILABILITY ===");
  console.dir((await q(`SELECT
    (SELECT COUNT(DISTINCT handyman_id) FROM handyman_availability WHERE is_active) recurring_contractors,
    (SELECT COUNT(DISTINCT contractor_id) FROM contractor_availability_dates) date_override_contractors,
    (SELECT COUNT(*) FROM contractor_availability_dates WHERE date>=now()) future_date_rows;`))[0]);
  console.log("\n=== BOOKING REQUESTS (contractor_booking_requests) by status ===");
  for(const r of await q(`SELECT COALESCE(assignment_status,'(null)') asg, COALESCE(status,'(null)') st, COUNT(*) n
    FROM contractor_booking_requests GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15;`))
    console.log(`  asg=${String(r.asg).padEnd(12)} status=${String(r.st).padEnd(12)} ${r.n}`);
  console.log("\n=== unassigned/pending dispatch backlog ===");
  console.dir((await q(`SELECT COUNT(*) total,
    COUNT(*) FILTER (WHERE assigned_contractor_id IS NULL) no_assignee,
    COUNT(*) FILTER (WHERE created_at>=now()-interval '30 days') last_30d FROM contractor_booking_requests;`))[0]);
  process.exit(0);
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
