// Live verification of the decomposed-pricing FOLD through the real engine.
// POSTs to /api/pricing/multi-quote with previewDecomposed:true (the exact path
// the admin live-preview uses) and asserts the customer-facing invariants:
//   1. job-whole buckets are computed deterministically (attendance×visits + travel + collection)
//   2. Σ structuralSharePence == foldDelta (shares sum to the buckets folded in)
//   3. customer reconciliation: Σ(guarded+materials+share) − batchSavings == finalPrice
//   4. single-line job: the one line carries the WHOLE call-out
//
// Usage: node scripts/verify-fold-live.mjs <port>
const PORT = process.argv[2] || process.env.PORT || '5001';
const URL = `http://localhost:${PORT}/api/pricing/multi-quote`;

const signals = {
  urgency: 'standard',
  materialsSupply: 'we_supply',
  timeOfService: 'standard',
  isReturningCustomer: false,
  previousJobCount: 0,
  previousAvgPricePence: 0,
};

const multi = {
  lines: [
    { id: 'l1', description: 'Mount 55-inch TV on plasterboard wall', category: 'tv_mounting', timeEstimateMinutes: 90, priceOverridePence: 12000 },
    { id: 'l2', description: 'Hang 3 floating shelves (we supply fixings)', category: 'general_fixing', timeEstimateMinutes: 45, priceOverridePence: 6000, materialsCostPence: 2000, requiresMaterialCollection: true },
    { id: 'l3', description: 'Replace kitchen mixer tap', category: 'plumbing_minor', timeEstimateMinutes: 60, priceOverridePence: 8000 },
  ],
  signals,
  visitCount: 2,
  travelDistanceMiles: 14,
  previewDecomposed: true,
};

const single = {
  lines: [
    { id: 's1', description: 'Mount 55-inch TV on plasterboard wall', category: 'tv_mounting', timeEstimateMinutes: 90, priceOverridePence: 12000 },
  ],
  signals,
  visitCount: 1,
  travelDistanceMiles: 3,
  previewDecomposed: true,
};

const gbp = (p) => `£${(p / 100).toFixed(2)}`;
let failures = 0;
function check(label, cond, detail) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function run(name, body, expectedBuckets) {
  console.log(`\n=== ${name} ===`);
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`  HTTP ${res.status}: ${await res.text()}`);
    failures++;
    return;
  }
  const r = await res.json();
  const lines = r.lineItems || [];
  const buckets = r.priceBuckets;
  const final = r.finalPricePence;
  const savings = r.batchDiscount?.applied ? r.batchDiscount.savingsPence : 0;

  console.log(`  finalPrice=${gbp(final)}  batchSavings=${gbp(savings)}`);
  console.log(`  buckets:`, buckets ? `attend=${gbp(buckets.attendancePence)}×${buckets.visitCount} travel=${gbp(buckets.travelPence)}@${buckets.travelDistanceMiles}mi collection=${gbp(buckets.materialCollectionPence)} TOTAL=${gbp(buckets.totalBucketsPence)}` : 'ABSENT');
  for (const li of lines) {
    console.log(`    ${li.lineId}: labour=${gbp(li.guardedPricePence)} materials=${gbp(li.materialsWithMarginPence || 0)} share=${gbp(li.structuralSharePence || 0)} → display=${gbp(li.guardedPricePence + (li.materialsWithMarginPence||0) + (li.structuralSharePence||0))}`);
  }

  // 1. buckets present + deterministic
  check('priceBuckets present', !!buckets);
  if (buckets) {
    check('attendance = £25 × visitCount', buckets.attendancePence === expectedBuckets.attendance, `${gbp(buckets.attendancePence)} vs ${gbp(expectedBuckets.attendance)}`);
    check('travel band correct', buckets.travelPence === expectedBuckets.travel, `${gbp(buckets.travelPence)} vs ${gbp(expectedBuckets.travel)}`);
    check('collection correct', buckets.materialCollectionPence === expectedBuckets.collection, `${gbp(buckets.materialCollectionPence)} vs ${gbp(expectedBuckets.collection)}`);
    check('total buckets correct', buckets.totalBucketsPence === expectedBuckets.total, `${gbp(buckets.totalBucketsPence)} vs ${gbp(expectedBuckets.total)}`);
  }

  // 2 + 3. fold reconciliation (the customer-facing invariant)
  const sumShares = lines.reduce((s, li) => s + (li.structuralSharePence || 0), 0);
  const sumDisplay = lines.reduce((s, li) => s + li.guardedPricePence + (li.materialsWithMarginPence || 0) + (li.structuralSharePence || 0), 0);
  const sumGuarded = lines.reduce((s, li) => s + li.guardedPricePence, 0);
  const sumMaterials = lines.reduce((s, li) => s + (li.materialsWithMarginPence || 0), 0);
  const priceBeforeBuckets = (sumGuarded - savings) + sumMaterials;
  const foldDelta = Math.max(0, final - priceBeforeBuckets);
  check('Σ structuralShares == foldDelta', sumShares === foldDelta, `${gbp(sumShares)} vs ${gbp(foldDelta)}`);
  check('customer reconciles: Σ(display) − batchSavings == finalPrice', (sumDisplay - savings) === final, `${gbp(sumDisplay - savings)} vs ${gbp(final)}`);

  // VISUAL fix: every share is a whole pound ⇒ every displayed line is an exact
  // pound, so the customer's Math.round(£) itemisation reconciles to the Total too.
  const sharesWhole = lines.every((li) => (li.structuralSharePence || 0) % 100 === 0);
  const linesWhole = lines.every((li) => (li.guardedPricePence + (li.materialsWithMarginPence || 0) + (li.structuralSharePence || 0)) % 100 === 0);
  check('every structuralShare is a whole pound', sharesWhole);
  check('every folded line is an exact pound', linesWhole);
  const roundedLines = lines.reduce((s, li) => s + Math.round((li.guardedPricePence + (li.materialsWithMarginPence || 0) + (li.structuralSharePence || 0)) / 100), 0);
  const roundedReconciles = (roundedLines - Math.round(savings / 100)) === Math.round(final / 100);
  check('ROUNDED itemisation reconciles: Σround(line) − round(saving) == round(total)', roundedReconciles, `£${roundedLines} − £${Math.round(savings/100)} vs £${Math.round(final/100)}`);

  return { lines, buckets, final };
}

(async () => {
  const m = await run('MULTI-LINE (2 visits, 14mi, 1 collection)', multi, { attendance: 5000, travel: 2000, collection: 2000, total: 9000 });
  const s = await run('SINGLE-LINE (1 visit, 3mi, no collection)', single, { attendance: 2500, travel: 0, collection: 0, total: 2500 });

  // 4. single line carries the WHOLE call-out
  if (s && s.lines.length === 1 && s.buckets) {
    check('single line carries whole call-out (share == totalBuckets)', s.lines[0].structuralSharePence === s.buckets.totalBucketsPence, `${gbp(s.lines[0].structuralSharePence)} vs ${gbp(s.buckets.totalBucketsPence)}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED ✅' : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
