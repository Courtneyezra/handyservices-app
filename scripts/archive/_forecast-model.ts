/**
 * Scalability forecast, built from Craig's real 2-week delivery economics.
 * Cost structure (per £1 of revenue), all VARIABLE except overhead:
 *   labour = 0.80 of revenue; contractor = 50% of labour; Ben = 10% of labour;
 *   materials at cost = 0.156 of revenue.  → Owner contribution ≈ 36% of revenue.
 * Overhead is a small fixed parameter (user: "expenses are minimal").
 */
const D = { revenue: 5502, labour: 4411, matCost: 860, contractor: 2204, benRate: 0.10 };
const labourFrac = D.labour / D.revenue;              // 0.802
const matCostFrac = D.matCost / D.revenue;            // 0.156
const contractorFrac = (D.contractor / D.labour) * labourFrac; // 0.40 of revenue
const benFrac = D.benRate * labourFrac;               // 0.08 of revenue
const ownerFrac = 1 - matCostFrac - contractorFrac - benFrac;  // ≈ 0.363

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const pct = (f: number) => (100 * f).toFixed(1) + '%';

console.log('=== UNIT ECONOMICS (per £1 revenue, from Craig 2wk real data) ===');
console.log(`  Materials at cost   : ${pct(matCostFrac)}`);
console.log(`  Contractor (50% lab): ${pct(contractorFrac)}   <- biggest cost`);
console.log(`  Ben (10% labour)    : ${pct(benFrac)}`);
console.log(`  OWNER contribution  : ${pct(ownerFrac)}   (before fixed overhead)`);
console.log(`\n  Per full Core contractor: ~${gbp(D.revenue / 2 * 4.333)}/mo revenue  (Craig's current run-rate)`);

// One Core contractor's monthly revenue (Craig's actual run-rate)
const REV_PER_CONTRACTOR = (D.revenue / 2) * 4.333; // ~£11,920/mo

function scenario(overhead: number) {
  console.log(`\n\n=== FORECAST — overhead ${gbp(overhead)}/mo (breakeven revenue ${gbp(overhead / ownerFrac)}/mo) ===`);
  console.log('contractors  revenue/mo   contractor pay   Ben pay    owner net/mo   owner net/yr');
  for (const c of [1, 2, 3, 5, 8]) {
    const rev = c * REV_PER_CONTRACTOR;
    const contractor = rev * contractorFrac;
    const ben = rev * benFrac;
    const ownerNet = rev * ownerFrac - overhead;
    console.log(
      String(c).padEnd(13) +
      gbp(rev).padEnd(13) +
      gbp(contractor).padEnd(17) +
      gbp(ben).padEnd(11) +
      gbp(ownerNet).padEnd(15) +
      gbp(ownerNet * 12)
    );
  }
}

scenario(750);
scenario(1500);

console.log(`\n\n=== JOB-MIX SENSITIVITY (same contractor-day, different avg job value) ===`);
console.log('Small jobs (£99 rev)   -> Handy gross ~£24/job  (before Ben+OH)  -> thin/loss on your time');
console.log('Mid jobs   (£400 rev)  -> Handy gross ~£177/job');
console.log('Big jobs   (£2000 rev) -> Handy gross ~£885/job  (Nasreen/Alicia scale)');
console.log('=> Same day of Craig, a big job earns Handy ~35x a small one. MIX drives health, not just count.');
process.exit(0);
