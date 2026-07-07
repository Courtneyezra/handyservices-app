import { q } from "./lib";
async function main(){
  console.log("=== paid quotes WITHOUT a booking request — what match-data do they carry? ===");
  console.dir((await q(`
    SELECT COUNT(*) total,
      COUNT(*) FILTER (WHERE categories IS NOT NULL AND array_length(categories,1)>0) with_categories,
      COUNT(*) FILTER (WHERE candidate_contractor_ids IS NOT NULL AND jsonb_array_length(candidate_contractor_ids)>0) with_candidates,
      COUNT(*) FILTER (WHERE coordinates IS NOT NULL) with_coords,
      COUNT(*) FILTER (WHERE pricing_line_items IS NOT NULL) with_line_items
    FROM personalized_quotes pq
    LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id=pq.id
    WHERE pq.deposit_paid_at IS NOT NULL AND cbr.id IS NULL;`))[0]);
  console.log("\n=== sample paid-unassigned: candidate ids + line-item categories ===");
  for(const r of await q(`
    SELECT LEFT(customer_name,14) nm,
      COALESCE(jsonb_array_length(candidate_contractor_ids),0) n_cand,
      COALESCE(array_length(categories,1),0) n_cat,
      LEFT(COALESCE(pricing_line_items::text,'[]'),60) line_items
    FROM personalized_quotes pq
    LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id=pq.id
    WHERE pq.deposit_paid_at IS NOT NULL AND cbr.id IS NULL
    ORDER BY deposit_paid_at DESC LIMIT 8;`))
    console.log(`  ${r.nm.padEnd(14)} candidates=${r.n_cand} categories=${r.n_cat}  lineitems=${r.line_items}`);
  process.exit(0);
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
