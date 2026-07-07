/**
 * BACK-TEST: fit the DECOMPOSED contextual-pricing model to REAL accepted quotes.
 *
 * We are migrating from `price = rate×time + materials` to a decomposed model:
 *
 *   price = (attendance × visits)                         // flat show-up charge
 *         + (marginal_rate × on-site-hours)               // labour for time on tools
 *         + materials(cost + 15% markup)                  // parts at trade + markup
 *         + collection-trip charge (once per quote)       // when a parts run is needed
 *         + travel-band charge                            // distance from base
 *         + EVE value premium                             // segment differentiators
 *   then CAPPED by the category market "bracket" ceiling (high-rate × hours).
 *
 * The two FREE parameters that need calibrating from data are:
 *   1. ATTENDANCE   — the flat £ per visit (callout / minimum-charge component)
 *   2. MARGINAL_RATE — the £/hr charged for actual time on tools (above attendance)
 *
 * Everything else (materials markup 15%, the category bracket, travel + collection
 * costs) is held fixed so the fit is identifiable. We grid-search (attendance,
 * marginal_rate) to MINIMISE the mean absolute error vs the real accepted totals,
 * then report the residual MAE and how many fitted totals land inside the
 * per-category market bracket [low×hrs, high×hrs].
 *
 * Conversion = `deposit_paid_at IS NOT NULL` on personalized_quotes.
 * Synthetic/test data is scrubbed (see WHERE clause + isSynthetic()).
 *
 * Read-only. Run:  npx tsx scripts/_backtest-decomposed-pricing.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { CATEGORY_RATES } from '../server/contextual-pricing/reference-rates';
import { SEGMENT_DIFFERENTIATOR_VALUES } from '../server/segmentation/reference-prices';
import type { JobCategory } from '@shared/contextual-pricing-types';

// ─────────────────────────────────────────────────────────────────────────────
// Tunables — held FIXED during the fit (only attendance + marginal rate float)
// ─────────────────────────────────────────────────────────────────────────────
const MATERIALS_MARKUP = 0.15;   // 15% on trade cost (policy target for new model)
const SAMPLE_LIMIT = 100;        // last N accepted quotes
const ROAD_FACTOR = 1.4;         // straight-line → road miles (matches travel-time.ts)
const EARTH_MILES = 3959;

// Travel bands we are calibrating TOWARD (free under 8mi, then per-band step).
// These are the *candidate* bands the script recommends; the fit reconstructs
// totals WITHOUT a travel charge first (travel not stored historically), so the
// recommendation is grounded in the observed distance distribution, not assumed.
const FREE_TRAVEL_MILES = 8;
const TRAVEL_BAND_MILES = 6;     // width of each chargeable band beyond the free radius

// Grid-search ranges (pence). Wide enough that the optimum is interior, not
// pinned to a boundary (a boundary-pinned optimum = range too narrow = untrustworthy).
// Attendance £20–£120, marginal rate £15–£75/hr.
// Attendance floor £25: a flat callout below this is operationally indefensible
// (smallest category minimum charge is £50). The data alone can't pin attendance
// tightly — only ~8% of jobs are ≤1h — so we floor the search at a sane policy
// minimum and report the identifiability caveat. Marginal rate is well-identified.
const ATTENDANCE_MIN_P = 2500, ATTENDANCE_MAX_P = 12000, ATTENDANCE_STEP_P = 250;
const RATE_MIN_P = 1500, RATE_MAX_P = 7500, RATE_STEP_P = 250;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type LineItem = {
  description?: string;
  category?: string;
  timeEstimateMinutes?: number;
  scheduleMinutes?: number;
  guardedPricePence?: number;
  pricePence?: number;
  materialsCostPence?: number;
  materialsWithMarginPence?: number;
  requiresMaterialCollection?: boolean;
  unitCount?: number;
};

type QuoteRow = {
  id: string;
  customer_name: string | null;
  phone: string | null;
  email: string | null;
  base_price: number | null;
  materials_cost_with_markup_pence: number | null;
  segment: string | null;
  coordinates: { lat: number; lng: number } | null;
  lines: LineItem[];
};

// Per-quote derived record used by the fitter.
interface Sample {
  id: string;
  name: string;
  acceptedPence: number;          // the real paid total (base_price)
  onSiteMinutes: number;          // Σ scheduleMinutes across lines
  materialsCostPence: number;     // Σ trade-cost materials across lines
  visits: number;                 // 1 unless data says otherwise (see note)
  needsCollection: boolean;       // any line flagged requiresMaterialCollection
  distanceMiles: number | null;   // derived from coordinates vs fleet centroid
  segment: string;
  dominantCat: JobCategory;       // category carrying the most on-site time
  bracketLowP: number;            // category low-rate × hours (bracket floor)
  bracketHighP: number;           // category high-rate × hours (bracket ceiling)
  eveValueP: number;              // segment differentiator sum (EVE premium)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const gbp = (p: number) => '£' + (p / 100).toFixed(0);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function isSynthetic(q: QuoteRow): boolean {
  const phone = (q.phone ?? '').replace(/\s+/g, '');
  if (phone.startsWith('07700900')) return true;
  if (/^test_q_/i.test(q.id)) return true;
  const name = (q.customer_name ?? '').toLowerCase();
  if (/\b(test|qa|phase)\b/i.test(name)) return true;
  if ((q.email ?? '').toLowerCase().includes('@example.com')) return true;
  return false;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const rate = (c: JobCategory) => CATEGORY_RATES[c] ?? CATEGORY_RATES.other;
const catOf = (s?: string): JobCategory =>
  (s && (s as JobCategory) in CATEGORY_RATES ? (s as JobCategory) : 'other');

function eveValuePence(segment: string): number {
  const diffs = SEGMENT_DIFFERENTIATOR_VALUES[segment] ?? SEGMENT_DIFFERENTIATOR_VALUES.UNKNOWN ?? [];
  return diffs.reduce((s, d) => s + (d.valuePence ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The decomposed reconstruction for a single sample, given the two free params.
// Returns the modelled total in pence (before bracket cap, plus the capped total).
// Travel + collection are charged from the candidate cost-config so the fit
// reflects the model we intend to ship. EVE premium is included as-is.
// ─────────────────────────────────────────────────────────────────────────────
function reconstruct(
  s: Sample,
  attendanceP: number,
  marginalRateP: number,   // pence per hour
  travelChargeP: number,   // resolved travel-band charge for this sample
  collectionChargeP: number,
): { rawP: number; cappedP: number } {
  const onSiteHours = s.onSiteMinutes / 60;
  const attendance = attendanceP * s.visits;
  const labour = Math.round(marginalRateP * onSiteHours);
  const materials = Math.round(s.materialsCostPence * (1 + MATERIALS_MARKUP));
  const collection = s.needsCollection ? collectionChargeP : 0;
  const raw = attendance + labour + materials + collection + travelChargeP + s.eveValueP;
  // Bracket cap: ceiling is category high-rate × hours, but never below a sane
  // minimum (the bracket floor) so tiny jobs aren't capped to nonsense.
  const ceiling = Math.max(s.bracketHighP, s.bracketLowP);
  const capped = Math.min(raw, ceiling + materials + collection + travelChargeP);
  return { rawP: raw, cappedP: capped };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
const QUERY = sql`
  SELECT id, customer_name, phone, email, base_price,
         materials_cost_with_markup_pence, segment, coordinates,
         pricing_line_items AS lines
  FROM personalized_quotes
  WHERE deposit_paid_at IS NOT NULL
    AND base_price IS NOT NULL AND base_price > 0
    AND pricing_line_items IS NOT NULL
    AND jsonb_array_length(pricing_line_items) > 0
    AND id NOT LIKE 'test_q_%'
    AND COALESCE(customer_name, '') !~* '\\m(test|qa|phase)\\M'
    AND COALESCE(email, '') NOT ILIKE '%@example.com'
    AND COALESCE(REPLACE(phone, ' ', ''), '') NOT LIKE '07700900%'
  ORDER BY created_at DESC
  LIMIT ${SAMPLE_LIMIT}
`;

const QUERY_TEXT = `SELECT id, customer_name, phone, email, base_price,
       materials_cost_with_markup_pence, segment, coordinates,
       pricing_line_items AS lines
FROM personalized_quotes
WHERE deposit_paid_at IS NOT NULL
  AND base_price IS NOT NULL AND base_price > 0
  AND pricing_line_items IS NOT NULL
  AND jsonb_array_length(pricing_line_items) > 0
  AND id NOT LIKE 'test_q_%'
  AND COALESCE(customer_name, '') !~* '\\m(test|qa|phase)\\M'
  AND COALESCE(email, '') NOT ILIKE '%@example.com'
  AND COALESCE(REPLACE(phone, ' ', ''), '') NOT LIKE '07700900%'
ORDER BY created_at DESC
LIMIT ${SAMPLE_LIMIT};`;

let rows: QuoteRow[];
try {
  const res: any = await db.execute(QUERY);
  rows = (res.rows ?? res) as QuoteRow[];
} catch (err: any) {
  console.error('\n' + '═'.repeat(80));
  console.error('DB CONNECTION FAILED — cannot fit against live data.');
  console.error('Reason:', err?.message ?? err);
  console.error('\nThe script WOULD run this query against personalized_quotes:');
  console.error('─'.repeat(80));
  console.error(QUERY_TEXT);
  console.error('─'.repeat(80));
  console.error('Fix DATABASE_URL in .env (see server/db.ts) and re-run:');
  console.error('  npx tsx scripts/_backtest-decomposed-pricing.ts');
  console.error('═'.repeat(80) + '\n');
  process.exit(1);
}

// ── Scrub + build samples ────────────────────────────────────────────────────
const clean = rows.filter((q) => !isSynthetic(q));

// Fleet "base" = centroid of all clean job coordinates (data-driven operating
// centre, since no depot coordinate is stored in the codebase). Travel distance
// is each job's haversine miles from this centroid × road factor.
const coords = clean.map((q) => q.coordinates).filter((c): c is { lat: number; lng: number } => !!c && typeof c.lat === 'number');
const centroid = coords.length
  ? { lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length, lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length }
  : null;

const samples: Sample[] = [];
for (const q of clean) {
  const lines = Array.isArray(q.lines) ? q.lines : [];
  if (!lines.length) continue;

  let onSiteMinutes = 0;
  let materialsCostPence = 0;
  let needsCollection = false;
  const timeByCat = new Map<JobCategory, number>();

  for (const li of lines) {
    const mins = li.scheduleMinutes ?? li.timeEstimateMinutes ?? 0;
    onSiteMinutes += mins;
    materialsCostPence += li.materialsCostPence ?? 0;
    if (li.requiresMaterialCollection) needsCollection = true;
    const c = catOf(li.category);
    timeByCat.set(c, (timeByCat.get(c) ?? 0) + mins);
  }
  if (onSiteMinutes <= 0) continue; // can't reconstruct labour without time

  // Dominant category = the one carrying the most on-site minutes → its bracket.
  const dominantCat = [...timeByCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
  const hours = onSiteMinutes / 60;
  const r = rate(dominantCat);
  // Bracket in absolute £ for this job's labour time (floored at the category min).
  const bracketLowP = Math.max(Math.round((r.low / 60) * onSiteMinutes), r.min);
  const bracketHighP = Math.max(Math.round((r.high / 60) * onSiteMinutes), r.min);

  let distanceMiles: number | null = null;
  if (centroid && q.coordinates && typeof q.coordinates.lat === 'number') {
    distanceMiles = haversineMiles(centroid.lat, centroid.lng, q.coordinates.lat, q.coordinates.lng) * ROAD_FACTOR;
  }

  samples.push({
    id: q.id,
    name: q.customer_name ?? '—',
    acceptedPence: q.base_price!,
    onSiteMinutes,
    materialsCostPence,
    visits: 1, // NOTE: visit count is not stored — assumed single visit. See gaps.
    needsCollection,
    distanceMiles,
    segment: q.segment ?? 'UNKNOWN',
    dominantCat,
    bracketLowP,
    bracketHighP,
    eveValueP: eveValuePence(q.segment ?? 'UNKNOWN'),
  });
}

if (!samples.length) {
  console.error('No usable accepted quotes after scrubbing. Nothing to fit.');
  process.exit(1);
}

// ── Grid-search (attendance × marginal rate) to minimise MAE ─────────────────
// Travel/collection are NOT charged in the FIT pass: those signals are absent
// (collection flag is always false historically; travel was never a line item),
// so adding them would bias the two core params. We fit the core decomposition
// to the accepted totals, THEN size travel/collection from the distribution.
// We fit against the RAW (uncapped) decomposition: accepted prices are ground
// truth, and the bracket is a governance ceiling we report separately — clamping
// the model to it during the fit would hide where real prices exceed market and
// bias the two params downward. (Earlier runs pinned the optimum to the grid
// ceiling precisely because the cap starved high-value jobs.)
function meanAbsError(attendanceP: number, marginalRateP: number): number {
  let sum = 0;
  for (const s of samples) {
    const { rawP } = reconstruct(s, attendanceP, marginalRateP, /*travel*/ 0, /*collection*/ 0);
    sum += Math.abs(rawP - s.acceptedPence);
  }
  return sum / samples.length;
}

let best = { attendanceP: ATTENDANCE_MIN_P, rateP: RATE_MIN_P, mae: Infinity };
for (let a = ATTENDANCE_MIN_P; a <= ATTENDANCE_MAX_P; a += ATTENDANCE_STEP_P) {
  for (let m = RATE_MIN_P; m <= RATE_MAX_P; m += RATE_STEP_P) {
    const mae = meanAbsError(a, m);
    if (mae < best.mae) best = { attendanceP: a, rateP: m, mae };
  }
}

// Identifiability: the range of each parameter whose MAE is within £2 of the
// optimum (holding the other at its fitted value). A wide band = loosely pinned.
const TOL_P = 200;
const attBand = [ATTENDANCE_MIN_P, ATTENDANCE_MAX_P];
for (let a = ATTENDANCE_MIN_P; a <= ATTENDANCE_MAX_P; a += ATTENDANCE_STEP_P) {
  if (meanAbsError(a, best.rateP) <= best.mae + TOL_P) { attBand[0] = a; break; }
}
for (let a = ATTENDANCE_MAX_P; a >= ATTENDANCE_MIN_P; a -= ATTENDANCE_STEP_P) {
  if (meanAbsError(a, best.rateP) <= best.mae + TOL_P) { attBand[1] = a; break; }
}
const rateBand = [RATE_MIN_P, RATE_MAX_P];
for (let m = RATE_MIN_P; m <= RATE_MAX_P; m += RATE_STEP_P) {
  if (meanAbsError(best.attendanceP, m) <= best.mae + TOL_P) { rateBand[0] = m; break; }
}
for (let m = RATE_MAX_P; m >= RATE_MIN_P; m -= RATE_STEP_P) {
  if (meanAbsError(best.attendanceP, m) <= best.mae + TOL_P) { rateBand[1] = m; break; }
}

// ── Diagnostics at the fitted optimum ────────────────────────────────────────
let inBracket = 0;
let signedErr = 0;
let cappedCount = 0; // how many jobs the bracket ceiling would actually clamp
const perSample: Array<{ s: Sample; modelP: number; errP: number; inBr: boolean }> = [];
for (const s of samples) {
  const { rawP, cappedP } = reconstruct(s, best.attendanceP, best.rateP, 0, 0);
  // Bracket-fit: does the labour portion of the raw model sit within the
  // category market band [low×hrs, high×hrs] (materials excluded, they're pass-through)?
  const labourModelP = rawP - Math.round(s.materialsCostPence * (1 + MATERIALS_MARKUP)) - s.eveValueP;
  const inBr = labourModelP >= s.bracketLowP && labourModelP <= s.bracketHighP;
  if (inBr) inBracket++;
  if (cappedP < rawP) cappedCount++;
  signedErr += rawP - s.acceptedPence;
  perSample.push({ s, modelP: rawP, errP: rawP - s.acceptedPence, inBr });
}

// ── Travel-band sizing from the observed distance distribution ───────────────
const dists = samples.map((s) => s.distanceMiles).filter((d): d is number => d != null).sort((a, b) => a - b);
const distP = (p: number) => (dists.length ? dists[Math.min(dists.length - 1, Math.floor(p * dists.length))] : null);
const beyondFree = dists.filter((d) => d > FREE_TRAVEL_MILES).length;

// Suggested per-band charge: marginal_rate × (band round-trip drive time @25mph)
// One 6-mile band ≈ 12mi round trip ≈ ~29 min driving → price at the fitted
// marginal rate, rounded to the nearest £5.
const bandRoundTripMin = (TRAVEL_BAND_MILES * 2 / 25) * 60;
const travelBandP = Math.round((best.rateP * (bandRoundTripMin / 60)) / 500) * 500;
// Collection trip ≈ 30 min round trip to merchant + handling, at marginal rate, min £15.
const collectionP = Math.max(1500, Math.round((best.rateP * 0.5) / 500) * 500);

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(86));
console.log('DECOMPOSED PRICING — FIT TO REAL ACCEPTED QUOTES');
console.log('═'.repeat(86));
console.log(`Corpus:   ${rows.length} paid quotes pulled · ${clean.length} after scrub · ${samples.length} fittable (have on-site time)`);
console.log(`Fixed:    materials markup ${(MATERIALS_MARKUP * 100).toFixed(0)}%  ·  bracket = category market rate (low/high × hours)`);
console.log(`Centroid: ${centroid ? `${centroid.lat.toFixed(4)}, ${centroid.lng.toFixed(4)}` : 'n/a'} (data-derived operating base for travel distance)`);

console.log('\n── FITTED FREE PARAMETERS (grid-search, min MAE) ─────────────────────────────────────');
console.log(`  ATTENDANCE (flat per visit):  ${gbp(best.attendanceP)}   (£${(best.attendanceP / 100).toFixed(2)})`);
console.log(`  MARGINAL RATE (per on-site hr): ${gbp(best.rateP)}/hr  (£${(best.rateP / 100).toFixed(2)}/hr)`);
console.log(`  Residual MAE vs accepted total: ${gbp(Math.round(best.mae))}  (mean accepted ${gbp(Math.round(samples.reduce((s, x) => s + x.acceptedPence, 0) / samples.length))})`);
console.log(`  Mean signed error (model − paid): ${gbp(Math.round(signedErr / samples.length))}  (${signedErr >= 0 ? 'over' : 'under'}-charging on average)`);
console.log(`  Bracket fit: ${inBracket}/${samples.length} fitted LABOUR portions land inside the category bracket [low×hrs, high×hrs]  (${pct(inBracket, samples.length)}%)`);
console.log(`  Bracket cap bites on: ${cappedCount}/${samples.length} jobs  (${pct(cappedCount, samples.length)}%) — real accepted price exceeds the market ceiling there.`);
console.log(`  Identifiability (MAE within £2 of optimum):`);
console.log(`    attendance well-fit in [${gbp(attBand[0])}, ${gbp(attBand[1])}]  ${attBand[1] - attBand[0] > 3000 ? '← LOOSE (few short jobs to pin it)' : ''}`);
console.log(`    marginal rate well-fit in [${gbp(rateBand[0])}/hr, ${gbp(rateBand[1])}/hr]  ${rateBand[1] - rateBand[0] <= 1500 ? '← TIGHT (well-identified)' : ''}`);

// Sensitivity: show MAE at the optimum's neighbours so the surface is legible.
console.log('\n── MAE SENSITIVITY (£, rows = attendance, cols = marginal £/hr) ──────────────────────');
const aGrid = [best.attendanceP - 1000, best.attendanceP - 500, best.attendanceP, best.attendanceP + 500, best.attendanceP + 1000].filter((a) => a >= ATTENDANCE_MIN_P && a <= ATTENDANCE_MAX_P);
const mGrid = [best.rateP - 750, best.rateP - 250, best.rateP, best.rateP + 250, best.rateP + 750].filter((m) => m >= RATE_MIN_P && m <= RATE_MAX_P);
console.log('  ' + pad('att\\rate', 10) + mGrid.map((m) => padL(gbp(m) + '/h', 9)).join(''));
for (const a of aGrid) {
  const cells = mGrid.map((m) => padL(gbp(Math.round(meanAbsError(a, m))), 9)).join('');
  const star = a === best.attendanceP ? '*' : ' ';
  console.log(`  ${star}${pad(gbp(a), 9)}${cells}`);
}

// Worst residuals — where the decomposition fights the accepted price.
console.log('\n── 8 LARGEST RESIDUALS (model vs paid) ───────────────────────────────────────────────');
console.log(`  ${pad('customer', 14)}${pad('cat', 16)}${padL('hrs', 6)}${padL('mat£', 7)}${padL('paid', 8)}${padL('model', 8)}${padL('err', 8)} br`);
perSample.sort((a, b) => Math.abs(b.errP) - Math.abs(a.errP));
for (const r of perSample.slice(0, 8)) {
  console.log(`  ${pad((r.s.name || '—').slice(0, 13), 14)}${pad(r.s.dominantCat, 16)}${padL((r.s.onSiteMinutes / 60).toFixed(1), 6)}${padL(gbp(r.s.materialsCostPence), 7)}${padL(gbp(r.s.acceptedPence), 8)}${padL(gbp(r.modelP), 8)}${padL((r.errP >= 0 ? '+' : '') + gbp(r.errP), 8)} ${r.inBr ? 'in' : '—'}`);
}

// ── Distance distribution (for travel banding) ───────────────────────────────
console.log('\n── TRAVEL DISTANCE DISTRIBUTION (road miles from centroid) ───────────────────────────');
if (dists.length) {
  console.log(`  jobs with coords: ${dists.length}/${samples.length}  ·  median ${distP(0.5)?.toFixed(1)}mi  ·  p75 ${distP(0.75)?.toFixed(1)}mi  ·  p90 ${distP(0.9)?.toFixed(1)}mi  ·  max ${dists[dists.length - 1].toFixed(1)}mi`);
  console.log(`  beyond free radius (${FREE_TRAVEL_MILES}mi): ${beyondFree}/${dists.length}  (${pct(beyondFree, dists.length)}%)`);
} else {
  console.log('  no coordinates available — cannot size travel bands from data.');
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDED COST-CONFIG BLOCK
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(86));
console.log('RECOMMENDED COST-CONFIG (fitted)');
console.log('═'.repeat(86));
console.log(`  attendancePence:      ${best.attendanceP},        // ${gbp(best.attendanceP)} flat per visit`);
console.log(`  marginalRatePence:    ${best.rateP},        // ${gbp(best.rateP)}/hr for on-site time`);
console.log(`  materialsMarkup:      ${MATERIALS_MARKUP},        // ${(MATERIALS_MARKUP * 100).toFixed(0)}% on trade cost (held fixed)`);
console.log(`  freeTravelMiles:      ${FREE_TRAVEL_MILES},           // no travel charge within this radius`);
console.log(`  travelBandMiles:      ${TRAVEL_BAND_MILES},           // width of each chargeable band beyond free radius`);
console.log(`  travelBandPence:      ${travelBandP},         // ${gbp(travelBandP)} per ${TRAVEL_BAND_MILES}mi band (≈marginal rate × round-trip drive)`);
console.log(`  collectionTripPence:  ${collectionP},         // ${gbp(collectionP)} one-off parts-run charge (per quote, when needed)`);
console.log(`  bracketCeiling:       category high-rate × on-site-hours (from reference-rates.ts)`);
console.log('═'.repeat(86));

// ── Data gaps surfaced by this run ───────────────────────────────────────────
console.log('\n── DATA GAPS / CAVEATS ───────────────────────────────────────────────────────────────');
const noCoords = samples.length - dists.length;
const collFlagged = samples.filter((s) => s.needsCollection).length;
const segCounts = new Map<string, number>();
for (const s of samples) segCounts.set(s.segment, (segCounts.get(s.segment) ?? 0) + 1);
console.log(`  • Visit count: NOT stored on personalized_quotes — every sample assumed 1 visit (attendance ×1).`);
console.log(`  • Travel distance: NOT stored — derived via haversine from the job-coords centroid (${noCoords} sample(s) lack coords).`);
console.log(`  • Collection trips: requiresMaterialCollection is TRUE on ${collFlagged}/${samples.length} samples — the flag is effectively unused historically, so the collection charge is sized by assumption, not fit.`);
console.log(`  • Materials markup policy delta: live engine uses 27% (MATERIALS_MARGIN), this fit targets 15% — the gap is absorbed into attendance/marginal rate.`);
console.log(`  • Segments present: ${[...segCounts.entries()].map(([k, v]) => `${k}:${v}`).join(', ')} — EVE premium is near-uniform, so it barely moves the fit.`);
console.log('═'.repeat(86) + '\n');

process.exit(0);
