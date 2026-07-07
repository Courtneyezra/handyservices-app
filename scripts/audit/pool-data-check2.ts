import { q } from "./lib";
async function main(){
  console.log("=== geocodable? (postcode/address present on paid-unassigned) ===");
  console.dir((await q(`SELECT COUNT(*) total,
    COUNT(*) FILTER (WHERE pq.postcode IS NOT NULL AND pq.postcode<>'') with_postcode,
    COUNT(*) FILTER (WHERE pq.address IS NOT NULL AND pq.address<>'') with_address,
    COUNT(*) FILTER (WHERE pq.coordinates IS NOT NULL) with_coords
    FROM personalized_quotes pq LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id=pq.id
    WHERE pq.deposit_paid_at IS NOT NULL AND cbr.id IS NULL;`))[0]);
  console.log("\n=== pricing_line_items structure (do lines carry a category/SKU?) ===");
  for(const r of await q(`SELECT LEFT(pq.customer_name,12) nm, jsonb_array_length(pq.pricing_line_items) n,
     LEFT(pq.pricing_line_items::text, 240) sample
     FROM personalized_quotes pq LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id=pq.id
     WHERE pq.deposit_paid_at IS NOT NULL AND cbr.id IS NULL AND pq.pricing_line_items IS NOT NULL
     ORDER BY pq.deposit_paid_at DESC LIMIT 4;`)){
    console.log(`\n  [${r.nm}] ${r.n} lines:`); console.log("   "+r.sample);
  }
  // what keys exist across line items?
  console.log("\n=== distinct keys present in line-item objects ===");
  for(const r of await q(`SELECT DISTINCT jsonb_object_keys(li) k FROM personalized_quotes pq,
     jsonb_array_elements(pq.pricing_line_items) li
     WHERE pq.deposit_paid_at IS NOT NULL AND pq.pricing_line_items IS NOT NULL LIMIT 30;`))
    console.log(`  ${r.k}`);
  process.exit(0);
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
