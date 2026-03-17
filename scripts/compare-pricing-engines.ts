/**
 * EVE vs Old Engine — Pricing Comparison Script
 *
 * Generates dummy quotes for every segment with random jobs,
 * runs both old (multiplier) and new (EVE) engines on identical inputs,
 * and prints a comparison report.
 *
 * Run: npx tsx scripts/compare-pricing-engines.ts
 * No database needed — pure function calls.
 */

import { generateValuePricingQuote } from '../server/value-pricing-engine';
import { generateEVEPricingQuote, EVE_SEGMENT_RATES, REFERENCE_RATE_PENCE } from '../server/eve-pricing-engine';
import type { EVEPricingInputs } from '../server/eve-pricing-engine';

// ============================================================================
// JOB POOL — realistic descriptions with estimated times
// ============================================================================

interface TestJob {
  description: string;
  basePricePence: number;
  timeMinutes: number;
}

const JOB_POOL: TestJob[] = [
  { description: 'Fix leaking kitchen tap', basePricePence: 9500, timeMinutes: 60 },
  { description: 'Unblock downstairs toilet', basePricePence: 12000, timeMinutes: 60 },
  { description: 'Mount 55" TV on plasterboard wall', basePricePence: 8500, timeMinutes: 60 },
  { description: 'Replace bathroom light fitting', basePricePence: 8500, timeMinutes: 45 },
  { description: 'Assemble IKEA PAX wardrobe', basePricePence: 6000, timeMinutes: 90 },
  { description: 'Reseal bath silicone', basePricePence: 9000, timeMinutes: 90 },
  { description: 'Replace 3 cracked sockets', basePricePence: 7500, timeMinutes: 45 },
  { description: 'Hang 4 shelves in living room', basePricePence: 7000, timeMinutes: 60 },
  { description: 'Fix sticking internal door', basePricePence: 6500, timeMinutes: 45 },
  { description: 'Repair fence panel blown down', basePricePence: 11000, timeMinutes: 120 },
  { description: 'Patch and paint ceiling water damage', basePricePence: 15000, timeMinutes: 180 },
  { description: 'Install cat flap in back door', basePricePence: 7500, timeMinutes: 45 },
];

const SEGMENTS = [
  'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ',
  'DIY_DEFERRER', 'BUDGET', 'EMERGENCY', 'TRUST_SEEKER',
  'OLDER_WOMAN', 'RENTER', 'UNKNOWN',
];

// ============================================================================
// HELPERS
// ============================================================================

/** Deterministic pseudo-random — seeded so results are reproducible */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function pickJobs(rand: () => number, count: number): TestJob[] {
  const picked: TestJob[] = [];
  const pool = [...JOB_POOL];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function penceToPounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

// ============================================================================
// COMPARISON RUNNER
// ============================================================================

interface ComparisonRow {
  segment: string;
  jobsDescription: string;
  timeMinutes: number;
  baseJobPrice: number;
  // Old engine
  oldMultiplier: number;
  oldEssential: number;
  oldHassleFree: number;
  oldHighStandard: number;
  oldIsMultiOption: boolean;
  // New engine
  newPrice: number;
  newEffectiveRate: number; // pence/hr
  newMultiplier: number;
  // Delta
  delta: number;
  deltaPercent: number;
  // Validation
  endsIn9: boolean;
  aboveFloor: boolean;
  allTiersEqual: boolean;
}

function runComparison(segment: string, jobs: TestJob[]): ComparisonRow {
  const baseJobPrice = jobs.reduce((sum, j) => sum + j.basePricePence, 0);
  const timeMinutes = jobs.reduce((sum, j) => sum + j.timeMinutes, 0);
  const jobsDescription = jobs.map(j => j.description).join(' + ');

  const inputs: EVEPricingInputs = {
    segment,
    baseJobPrice,
    timeEstimateMinutes: timeMinutes,
    urgencyReason: 'med',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'week',
    clientType: 'residential',
    jobComplexity: 'low',
  };

  const oldResult = generateValuePricingQuote(inputs);
  const newResult = generateEVEPricingQuote(inputs);

  const newPrice = newResult.hassleFree.price;
  const oldHF = oldResult.hassleFree.price;
  const delta = newPrice - oldHF;
  const deltaPercent = oldHF > 0 ? (delta / oldHF) * 100 : 0;
  const effectiveRate = timeMinutes > 0 ? Math.round((newPrice / timeMinutes) * 60) : 0;
  const floor = Math.round(REFERENCE_RATE_PENCE * (timeMinutes / 60));

  return {
    segment,
    jobsDescription,
    timeMinutes,
    baseJobPrice,
    oldMultiplier: oldResult.valueMultiplier,
    oldEssential: oldResult.essential.price,
    oldHassleFree: oldHF,
    oldHighStandard: oldResult.highStandard.price,
    oldIsMultiOption: oldResult.isMultiOption,
    newPrice,
    newEffectiveRate: effectiveRate,
    newMultiplier: newResult.valueMultiplier,
    delta,
    deltaPercent,
    endsIn9: newPrice % 10 === 9,
    aboveFloor: newPrice >= floor,
    allTiersEqual: newResult.essential.price === newPrice && newResult.highStandard.price === newPrice,
  };
}

// ============================================================================
// EDGE CASE RUNNER
// ============================================================================

interface EdgeCaseRow {
  name: string;
  segment: string;
  timeMinutes: number | undefined;
  baseJobPrice: number;
  oldHassleFree: number;
  newPrice: number;
  notes: string;
}

function runEdgeCase(name: string, overrides: Partial<EVEPricingInputs>): EdgeCaseRow {
  const inputs: EVEPricingInputs = {
    segment: 'BUSY_PRO',
    baseJobPrice: 9500,
    urgencyReason: 'med',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'week',
    clientType: 'residential',
    jobComplexity: 'low',
    ...overrides,
  };

  const oldResult = generateValuePricingQuote(inputs);
  const newResult = generateEVEPricingQuote(inputs);

  let notes = '';
  const newPrice = newResult.hassleFree.price;
  if (newPrice % 10 === 9) notes += 'Ends in 9. ';
  if (newResult.essential.price === newPrice && newResult.highStandard.price === newPrice) {
    notes += 'All tiers equal. ';
  }

  return {
    name,
    segment: inputs.segment || 'BUSY_PRO',
    timeMinutes: inputs.timeEstimateMinutes,
    baseJobPrice: inputs.baseJobPrice,
    oldHassleFree: oldResult.hassleFree.price,
    newPrice,
    notes: notes.trim(),
  };
}

// ============================================================================
// REPORT PRINTER
// ============================================================================

function printReport(rows: ComparisonRow[], edgeCases: EdgeCaseRow[]) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║            EVE vs OLD ENGINE — PRICING COMPARISON REPORT                ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════╣');
  console.log('');

  // Detailed per-segment
  for (const r of rows) {
    const segRate = EVE_SEGMENT_RATES[r.segment] ?? EVE_SEGMENT_RATES.UNKNOWN;
    const direction = r.delta > 0 ? 'MORE EXPENSIVE' : r.delta < 0 ? 'CHEAPER' : 'SAME';

    console.log(`── SEGMENT: ${r.segment} ${'─'.repeat(Math.max(0, 60 - r.segment.length))}`)
    console.log(`   Jobs: ${r.jobsDescription}`);
    console.log(`   Time: ${r.timeMinutes} min | Base Price (old input): ${penceToPounds(r.baseJobPrice)}`);
    console.log('');
    console.log(`   OLD ENGINE (multiplier-based):`);
    console.log(`     Multiplier:    ${r.oldMultiplier.toFixed(2)}x`);
    console.log(`     Essential:     ${padLeft(penceToPounds(r.oldEssential), 10)}  (80%)`);
    console.log(`     Hassle-Free:   ${padLeft(penceToPounds(r.oldHassleFree), 10)}  (100%)`);
    console.log(`     High Standard: ${padLeft(penceToPounds(r.oldHighStandard), 10)}  (135%)`);
    console.log(`     Multi-option:  ${r.oldIsMultiOption ? 'YES (3 tiers)' : 'NO (single)'}`);
    console.log('');
    console.log(`   NEW ENGINE (EVE contextual):`);
    console.log(`     Segment Rate:  ${penceToPounds(segRate)}/hr`);
    console.log(`     Price:         ${padLeft(penceToPounds(r.newPrice), 10)}`);
    console.log(`     Effective:     ${penceToPounds(r.newEffectiveRate)}/hr`);
    console.log(`     Value Ratio:   ${r.newMultiplier.toFixed(2)}x reference`);
    console.log('');
    console.log(`   DELTA: ${r.delta >= 0 ? '+' : ''}${penceToPounds(r.delta)} (${r.deltaPercent >= 0 ? '+' : ''}${r.deltaPercent.toFixed(1)}%) ← New is ${direction}`);
    console.log('');
  }

  // Summary table
  console.log('══ SUMMARY TABLE ══════════════════════════════════════════════════════════');
  console.log('');
  const hdr = `| ${padRight('Segment', 14)} | ${padLeft('Jobs', 5)} | ${padLeft('Time', 6)} | ${padLeft('Old(HF)', 10)} | ${padLeft('New(EVE)', 10)} | ${padLeft('Delta', 10)} | ${padLeft('%', 8)} | ${padLeft('Rate/hr', 8)} |`;
  const sep = '|' + '-'.repeat(hdr.length - 2) + '|';
  console.log(hdr);
  console.log(sep);
  for (const r of rows) {
    const jobCount = r.jobsDescription.split(' + ').length;
    console.log(`| ${padRight(r.segment, 14)} | ${padLeft(String(jobCount), 5)} | ${padLeft(r.timeMinutes + 'm', 6)} | ${padLeft(penceToPounds(r.oldHassleFree), 10)} | ${padLeft(penceToPounds(r.newPrice), 10)} | ${padLeft((r.delta >= 0 ? '+' : '') + penceToPounds(r.delta), 10)} | ${padLeft((r.deltaPercent >= 0 ? '+' : '') + r.deltaPercent.toFixed(1) + '%', 8)} | ${padLeft(penceToPounds(r.newEffectiveRate), 8)} |`);
  }
  console.log('');

  // Edge cases
  console.log('══ EDGE CASES ═════════════════════════════════════════════════════════════');
  console.log('');
  const eHdr = `| ${padRight('Case', 28)} | ${padLeft('Segment', 12)} | ${padLeft('Time', 6)} | ${padLeft('Old(HF)', 10)} | ${padLeft('New(EVE)', 10)} | Notes`;
  console.log(eHdr);
  console.log('|' + '-'.repeat(90) + '|');
  for (const e of edgeCases) {
    const timeStr = e.timeMinutes === undefined ? 'undef' : String(e.timeMinutes) + 'm';
    console.log(`| ${padRight(e.name, 28)} | ${padLeft(e.segment, 12)} | ${padLeft(timeStr, 6)} | ${padLeft(penceToPounds(e.oldHassleFree), 10)} | ${padLeft(penceToPounds(e.newPrice), 10)} | ${e.notes}`);
  }
  console.log('');

  // Validation summary
  console.log('══ VALIDATION ═════════════════════════════════════════════════════════════');
  console.log('');

  const allEndsIn9 = rows.every(r => r.endsIn9);
  const allAboveFloor = rows.every(r => r.aboveFloor);
  const allTiersEqual = rows.every(r => r.allTiersEqual);

  console.log(`  ${allEndsIn9 ? '✅' : '❌'} All EVE prices end in 9`);
  console.log(`  ${allAboveFloor ? '✅' : '❌'} No EVE price below floor (£35/hr × time)`);
  console.log(`  ${allTiersEqual ? '✅' : '❌'} All EVE tier prices equal (single product model)`);

  // Check specific validation issues
  for (const r of rows) {
    if (!r.endsIn9) console.log(`     ❌ ${r.segment}: price ${r.newPrice} does not end in 9`);
    if (!r.aboveFloor) console.log(`     ❌ ${r.segment}: price ${r.newPrice} below floor`);
    if (!r.allTiersEqual) console.log(`     ❌ ${r.segment}: tier prices not equal`);
  }

  // Highlight interesting findings
  console.log('');
  console.log('══ KEY FINDINGS ═══════════════════════════════════════════════════════════');
  console.log('');

  const cheaperSegments = rows.filter(r => r.delta < 0);
  const moreExpensive = rows.filter(r => r.delta > 0);
  const biggest = rows.reduce((max, r) => Math.abs(r.deltaPercent) > Math.abs(max.deltaPercent) ? r : max, rows[0]);

  console.log(`  Segments where NEW is cheaper: ${cheaperSegments.length > 0 ? cheaperSegments.map(r => r.segment).join(', ') : 'None'}`);
  console.log(`  Segments where NEW is more expensive: ${moreExpensive.length > 0 ? moreExpensive.map(r => r.segment).join(', ') : 'None'}`);
  console.log(`  Largest delta: ${biggest.segment} at ${biggest.deltaPercent >= 0 ? '+' : ''}${biggest.deltaPercent.toFixed(1)}%`);

  const premiumSegments = ['BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ'];
  const premiumRows = rows.filter(r => premiumSegments.includes(r.segment));
  const avgPremiumDelta = premiumRows.reduce((sum, r) => sum + r.deltaPercent, 0) / premiumRows.length;
  console.log(`  Avg premium segment delta: ${avgPremiumDelta >= 0 ? '+' : ''}${avgPremiumDelta.toFixed(1)}%`);

  const disqualified = ['DIY_DEFERRER', 'BUDGET'];
  const disqualifiedRows = rows.filter(r => disqualified.includes(r.segment));
  for (const r of disqualifiedRows) {
    console.log(`  ${r.segment} (disqualified): ${penceToPounds(r.newPrice)} — effective ${penceToPounds(r.newEffectiveRate)}/hr (ref: £35/hr)`);
  }

  console.log('');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const rand = seededRandom(42); // Reproducible results

  // Run comparison for each segment
  const rows: ComparisonRow[] = [];
  for (const segment of SEGMENTS) {
    const jobCount = Math.floor(rand() * 3) + 1; // 1-3 jobs
    const jobs = pickJobs(rand, jobCount);
    rows.push(runComparison(segment, jobs));
  }

  // Run edge cases
  const edgeCases: EdgeCaseRow[] = [
    runEdgeCase('time = 0', { timeEstimateMinutes: 0 }),
    runEdgeCase('time = undefined', { timeEstimateMinutes: undefined }),
    runEdgeCase('unknown segment "FOOBAR"', { segment: 'FOOBAR' }),
    runEdgeCase('very large job (480 min)', { timeEstimateMinutes: 480, baseJobPrice: 50000 }),
    runEdgeCase('very small job (15 min)', { timeEstimateMinutes: 15, baseJobPrice: 3000 }),
    runEdgeCase('BUDGET + 60 min', { segment: 'BUDGET', timeEstimateMinutes: 60, baseJobPrice: 9500 }),
    runEdgeCase('EMERGENCY + 60 min', { segment: 'EMERGENCY', timeEstimateMinutes: 60, baseJobPrice: 9500 }),
    runEdgeCase('high urgency (old boost)', { urgencyReason: 'high', timeEstimateMinutes: 60 }),
    runEdgeCase('ASAP timeframe (old boost)', { desiredTimeframe: 'asap', timeEstimateMinutes: 60 }),
  ];

  printReport(rows, edgeCases);
}

main();
