/**
 * Dispatch Sweep — Phase 1 of the allocation fix.
 *
 * Processes the flexible ("I'm flexible") pending pool: for each paid job with no
 * assignment yet, find the earliest feasible (date, contractor). Read-only — returns
 * proposals; the write-path (assignFromPool) is invoked separately by /dispatch-run.
 *
 * Performance: loads ALL contractor data (skills, availability, locations, current
 * bookings) ONCE, then matches every job in-memory — instant for a small roster.
 *
 * Availability mirrors the canonical `isContractorAvailableForSlot` (booking-engine):
 * master-blocked dates → per-date override (authoritative, incl. explicit blocks) →
 * weekly recurring pattern, with the same `timeRangeCoversSlot` slot check. (Earlier
 * it read only available per-date rows, diverging from how confirmBooking validates.)
 *
 * The shared loader (`loadDispatchContext`) is factored out so the schedule grid
 * (`buildSchedule`) reuses the EXACT same availability model + booking/skill loads —
 * no second, drifting copy of the canonical check.
 *
 * Phase 2 will add date-clustering + the slack governor.
 */
import { db } from './db';
import { sql, type SQL } from 'drizzle-orm';
import { timeRangeCoversSlot, type SlotType } from '../shared/slot-times';
import { SLA_DEFAULT_WINDOW_DAYS, slaStateScheduled, type SlaState } from '../shared/dispatch-sla';
import { TEST_QUOTE_LIKE } from './dispatch-test-mode';

/**
 * Test-mode pool fence (SAFETY-CRITICAL). Appended to EVERY flexible-pool SELECT so a
 * dummy job and a real job can never appear in the same result set:
 *   testOnly === true  → ONLY ids LIKE 'test_q_flex_%'  (dummies only)
 *   testOnly falsy      → EXCLUDE ids LIKE 'test_q_flex_%' (real jobs only — DEFAULT)
 * The default-exclude is what keeps seeded dummies invisible in the normal console.
 * `pq` is the personalized_quotes alias used in the calling query.
 */
function testModeFilter(testOnly: boolean | undefined): SQL {
  return testOnly
    ? sql`AND pq.id LIKE ${TEST_QUOTE_LIKE}`
    : sql`AND pq.id NOT LIKE ${TEST_QUOTE_LIKE}`;
}

export interface SweepProposal {
  quoteId: string; customerName: string; categories: string[];
  date: string; slot: 'am' | 'pm' | 'full_day'; contractorId: string; contractorName: string;
  /** True for a COMMITTED anchor member (an already-accepted booking shown so flexible jobs
   *  can be bundled onto its contractor-day). Read-only — never reassigned by the optimiser.
   *  Falsy/undefined for a normal optimiser-proposed pool job. */
  fixed?: boolean;
  distanceMiles: number | null;
  valuePence: number;
  slackDays: number;
  flexDeadline: string;
  /** Covers-most (added by the optimiser; the greedy sweep covers ALL so these are the
   *  full category list / empty respectively). Which of this job's categories the chosen
   *  contractor covers, and which they DON'T (flagged, not blocked). */
  coveredCategories?: string[];
  uncoveredCategories?: string[];
  /** Job-detail fields (optimiser only; the greedy sweep leaves them undefined). Surfaced
   *  in the console's job-detail modal — not used by matching. */
  postcode?: string | null;
  address?: string | null;
  jobDescription?: string | null;
  /** Real on-site work time (Σ line-item scheduleMinutes) + whole days it needs (≥1).
   *  daysNeeded > 1 ⇒ MULTI-DAY: can't fit one contractor-day, must be scheduled across
   *  several (flagged for the dispatcher, never auto-bundled into a half-day). */
  workMinutes?: number;
  daysNeeded?: number;
}
export interface ProposalGroup {
  groupId: string;          // `${contractorId}|${date}`
  contractorId: string; contractorName: string; date: string;
  members: SweepProposal[]; // committed (fixed:true) members FIRST, then bundled pool jobs
  /** How many of `members` are committed anchors (fixed:true). >0 ⇒ this card is anchored
   *  on already-booked work; the rest are flexible jobs bundled onto that contractor-day. */
  committedCount?: number;
  totalValue: number;       // pence, sum of members' valuePence
  rationale: string;        // ONE deterministic line, e.g. "3 jobs · plumbing, painting · 2.1mi spread · Tue 18 Jun"
  // ── Map / covers-most additions (optimiser only) ──
  /** Member quoteIds in nearest-neighbour visiting order (base → job → job → …). The map
   *  draws the day's route from this. Same membership as `members`, reordered. */
  routeOrder?: string[];
  /** Distinct union of every member's uncoveredCategories — the job-categories NO chosen
   *  contractor on this day covers (flagged for manual follow-up, never blocking). */
  uncoveredCategories?: string[];
  // ── TRUE-MARGIN economics (added by the optimiser; the greedy sweep leaves these
  //    undefined). A contractor-day's day rate is a FIXED cost owed in full regardless
  //    of job count; fuel = route miles × £/mile. margin = revenue − dayRate − fuel. ──
  routeMiles?: number;      // round-trip nearest-neighbour: base → jobs → base (job-to-job only if no base coords)
  revenuePence?: number;    // Σ member valuePence (same value as totalValue)
  dayRatePence?: number;    // contractor.dayRate ?? goal.defaultDayRatePence
  fuelPence?: number;       // round(routeMiles * goal.fuelPencePerMile)
  marginPence?: number;     // revenuePence − dayRatePence − fuelPence
  coversDayRate?: boolean;  // marginPence >= 0 (a FLAG — loss-making days are still proposed)
}
export interface SweepUnassignable {
  quoteId: string; customerName: string; categories: string[]; reason: string;
  slackDays: number; flexDeadline: string;
  /** Job-detail fields (optimiser only; the greedy sweep leaves them undefined). Surfaced
   *  in the console's job-detail modal — not used by matching. */
  valuePence?: number;
  postcode?: string | null;
  address?: string | null;
  jobDescription?: string | null;
}
export interface SweepResult {
  poolSize: number;
  assigned: SweepProposal[];
  unassignable: SweepUnassignable[];
  groups: ProposalGroup[];
}

// ── Fixed / committed lane ─────────────────────────────────────────────────────

export type CoverageStatus = 'covered' | 'at_risk' | 'uncovered' | 'conflict';
/**
 * Read-only resolution hint for an uncovered/conflict committed job: the nearest
 * qualified + available BACKUP contractor that could take it. `null` when none is found
 * (or the job is covered/at_risk). Surfacing only — nothing is reassigned.
 */
export interface SuggestedFix {
  contractorId: string;
  contractorName: string;
  note: string;
}
export interface FixedJob {
  quoteId: string; bookingId: string; customerName: string; categories: string[];
  date: string;            // YYYY-MM-DD
  slot: 'am' | 'pm' | 'full_day';
  contractorId: string; contractorName: string;
  lat: number | null; lng: number | null;
  status: CoverageStatus;
  reason: string | null;   // present for non-covered
  valuePence: number;
  /** Nearest qualified+available backup for uncovered/conflict jobs (read-only); else null. */
  suggestedFix: SuggestedFix | null;
  // ── SLA (the customer's "within N days" promise) ──
  /** deposit_paid_at + flexBookingWithinDays (YYYY-MM-DD). Null ⇒ no recorded flex promise
   *  (e.g. a pick-a-date booking), so no SLA applies. */
  slaDeadline: string | null;
  /** 'honoured' if scheduled on/before slaDeadline, 'breached' if booked past it; null when
   *  no SLA applies. A breach surfaces even when coverage status is 'covered'. */
  slaState: SlaState | null;
}
export interface FixedLaneResult {
  summary: { covered: number; atRisk: number; uncovered: number; conflict: number; total: number };
  jobs: FixedJob[];
}

/**
 * Great-circle miles between two lat/lng points. Exported so the dispatch
 * OPTIMISER (dispatch-optimizer.ts) routes day-bundles with the EXACT same
 * distance math the sweep uses — no second, drifting copy.
 */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959, toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const rows = (r: any) => r.rows ?? r;

// ── Shared deterministic helpers ──────────────────────────────────────────────

/** UTC midnight for "today" — the anchor every date calc derives from. */
function todayUtcMidnight(): Date {
  const t = new Date(); t.setUTCHours(0, 0, 0, 0); return t;
}

/** Format a Date as YYYY-MM-DD (UTC). Exported for the optimiser's date math. */
export function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * Job value in pence, derived the same way dispatch-map-routes.ts derives basePrice:
 * the `base_price` column (already stored in pence). Falls back to summing the
 * line-item price-ish field (guarded/price pence) if the column is null; 0 if neither.
 */
export function jobValuePence(job: any): number {
  if (job.base_price != null) {
    const n = Number(job.base_price);
    if (Number.isFinite(n)) return n;
  }
  const lineItems = Array.isArray(job.pricing_line_items) ? job.pricing_line_items : [];
  let sum = 0;
  for (const li of lineItems) {
    sum += Number(li?.guardedPricePence ?? li?.guarded_price_pence ?? li?.pricePence ?? li?.price_pence ?? 0) || 0;
  }
  return sum;
}

/**
 * flexDeadline + slackDays for a pool job.
 * flexDeadline = (deposit_paid_at date, or today if null) + flex_booking_within_days days.
 * slackDays = whole days from today to flexDeadline (floor; NEGATIVE if already past).
 */
export function computeSlack(job: any, today: Date): { flexDeadline: string; slackDays: number } {
  // No explicit window ⇒ the customer-facing default promise (7 days), NOT 0. (A 0-day
  // window would mark every null-window flex job instantly overdue.)
  const within = Number(job.flex_booking_within_days) || SLA_DEFAULT_WINDOW_DAYS;
  let anchor: Date;
  if (job.deposit_paid_at) {
    const dp = new Date(job.deposit_paid_at);
    anchor = isNaN(dp.getTime()) ? new Date(today) : new Date(`${ymd(dp)}T00:00:00.000Z`);
  } else {
    anchor = new Date(today);
  }
  const deadline = new Date(anchor); deadline.setUTCDate(deadline.getUTCDate() + within);
  const flexDeadline = ymd(deadline);
  const slackDays = Math.floor((Date.parse(`${flexDeadline}T00:00:00.000Z`) - today.getTime()) / 86_400_000);
  return { flexDeadline, slackDays };
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue 18 Jun" from a YYYY-MM-DD string (UTC). Exported for optimiser rationales. */
export function shortDate(dStr: string): string {
  const d = new Date(`${dStr}T12:00:00.000Z`);
  return `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}

// ── Shared loaded context (used by both the sweep and the schedule grid) ───────

export interface ContractorCtx {
  id: string; name: string; radius: number; lat: number | null; lng: number | null;
  /** FIXED daily cost in PENCE (null ⇒ optimiser falls back to goal.defaultDayRatePence). */
  dayRate: number | null;
}
export interface DispatchContext {
  today: Date;
  contractors: ContractorCtx[];
  skillsByCon: Map<string, Set<string>>;
  /** Canonical availability check (blocked → override → weekly). */
  isAvailable: (cid: string, dStr: string, dow: number, slot: SlotType) => boolean;
  /** `${conId}|${date}|${slot}` for every accepted booking half-day. */
  bookedSlots: Set<string>;
  /** Round-robin fairness load by contractor (accepted bookings count). */
  loadByCon: Map<string, number>;
  /** Accepted bookings mapped to their quote, for the schedule grid AND as committed
   *  route anchors. lat/lng/value/categories come from the joined quote so the optimiser
   *  can route-bundle pool jobs around a committed job's REAL location (not the home base)
   *  and surface the committed job as a card. */
  bookings: {
    cid: string; d: string; slot: string; quoteId: string | null; customerName: string | null;
    lat: number | null; lng: number | null; valuePence: number; categories: string[];
  }[];
  hasAnyAvailability: boolean;
}

/**
 * Loads the roster, skills, the canonical availability inputs (per-date overrides,
 * weekly patterns, master blocks) and accepted bookings in ONE round-trip, then
 * exposes a single `isAvailable` closure that mirrors isContractorAvailableForSlot.
 */
export async function loadDispatchContext(maxWindowDays: number): Promise<DispatchContext> {
  const [contractorsR, skillsR, overridesR, weeklyR, blockedR, bookingsR] = await Promise.all([
    db.execute(sql`
      SELECT hp.id, hp.latitude, hp.longitude, hp.radius_miles, hp.day_rate,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),''), hp.business_name, 'Contractor') AS name
      FROM handyman_profiles hp LEFT JOIN users u ON u.id = hp.user_id;`),
    db.execute(sql`SELECT handyman_id, category_slug FROM handyman_skills WHERE category_slug IS NOT NULL;`),
    db.execute(sql`
      SELECT contractor_id, to_char(date::date,'YYYY-MM-DD') AS d, is_available, start_time, end_time
      FROM contractor_availability_dates
      WHERE date >= now()::date AND date < (now()::date + (${maxWindowDays})::int);`),
    db.execute(sql`SELECT handyman_id, day_of_week, start_time, end_time FROM handyman_availability WHERE is_active = true;`),
    db.execute(sql`
      SELECT to_char(date,'YYYY-MM-DD') AS d FROM master_blocked_dates
      WHERE date >= now()::date AND date < (now()::date + (${maxWindowDays})::int);`),
    db.execute(sql`
      SELECT COALESCE(cbr.assigned_contractor_id, cbr.contractor_id) AS cid,
             to_char(cbr.scheduled_date::date,'YYYY-MM-DD') AS d, cbr.scheduled_slot AS slot,
             cbr.quote_id AS quote_id, cbr.customer_name AS customer_name,
             pq.coordinates AS coordinates, pq.base_price AS base_price,
             pq.pricing_line_items AS pricing_line_items
      FROM contractor_booking_requests cbr
      LEFT JOIN personalized_quotes pq ON pq.id = cbr.quote_id
      WHERE cbr.status = 'accepted' AND cbr.scheduled_date >= now()::date;`),
  ]);

  const contractors: ContractorCtx[] = rows(contractorsR).map((c: any) => ({
    id: c.id, name: c.name, radius: c.radius_miles ?? 10,
    lat: c.latitude ? parseFloat(c.latitude) : null, lng: c.longitude ? parseFloat(c.longitude) : null,
    dayRate: c.day_rate != null && Number.isFinite(Number(c.day_rate)) ? Number(c.day_rate) : null,
  }));

  const skillsByCon = new Map<string, Set<string>>();
  for (const s of rows(skillsR)) {
    if (!skillsByCon.has(s.handyman_id)) skillsByCon.set(s.handyman_id, new Set());
    skillsByCon.get(s.handyman_id)!.add(s.category_slug);
  }

  type TimeWin = { startTime: string | null; endTime: string | null };
  const overridesByCon = new Map<string, Map<string, TimeWin & { isAvailable: boolean }>>();
  for (const o of rows(overridesR)) {
    if (!overridesByCon.has(o.contractor_id)) overridesByCon.set(o.contractor_id, new Map());
    overridesByCon.get(o.contractor_id)!.set(o.d, { isAvailable: !!o.is_available, startTime: o.start_time, endTime: o.end_time });
  }
  const weeklyByCon = new Map<string, Map<number, TimeWin>>();
  for (const w of rows(weeklyR)) {
    if (!weeklyByCon.has(w.handyman_id)) weeklyByCon.set(w.handyman_id, new Map());
    weeklyByCon.get(w.handyman_id)!.set(Number(w.day_of_week), { startTime: w.start_time, endTime: w.end_time });
  }
  const masterBlocked = new Set<string>(rows(blockedR).map((m: any) => m.d));
  const hasAnyAvailability = overridesByCon.size > 0 || weeklyByCon.size > 0;

  // Mirrors isContractorAvailableForSlot: blocked → override (incl. explicit false) → weekly.
  const isAvailable = (cid: string, dStr: string, dow: number, slot: SlotType): boolean => {
    if (masterBlocked.has(dStr)) return false;
    const ov = overridesByCon.get(cid)?.get(dStr);
    if (ov) return ov.isAvailable && timeRangeCoversSlot(ov.startTime, ov.endTime, slot);
    const wp = weeklyByCon.get(cid)?.get(dow);
    if (wp) return timeRangeCoversSlot(wp.startTime, wp.endTime, slot);
    return false;
  };

  const bookedSlots = new Set<string>();
  const loadByCon = new Map<string, number>();
  const bookings: DispatchContext['bookings'] = [];
  for (const b of rows(bookingsR)) {
    if (!b.cid) continue;
    loadByCon.set(b.cid, (loadByCon.get(b.cid) || 0) + 1);
    for (const s of (b.slot === 'full_day' ? ['am', 'pm'] : [b.slot])) bookedSlots.add(`${b.cid}|${b.d}|${s}`);
    const bCoords = (b.coordinates || null) as { lat?: number; lng?: number } | null;
    const bLat = bCoords?.lat != null && Number.isFinite(Number(bCoords.lat)) ? Number(bCoords.lat) : null;
    const bLng = bCoords?.lng != null && Number.isFinite(Number(bCoords.lng)) ? Number(bCoords.lng) : null;
    const bLines = Array.isArray(b.pricing_line_items) ? b.pricing_line_items : [];
    const bCats = [...new Set(
      bLines.map((li: any) => (typeof li?.category === 'string' ? li.category : null)).filter(Boolean),
    )] as string[];
    bookings.push({
      cid: b.cid, d: b.d, slot: b.slot, quoteId: b.quote_id ?? null, customerName: b.customer_name ?? null,
      lat: bLat, lng: bLng,
      valuePence: jobValuePence({ base_price: b.base_price, pricing_line_items: bLines }),
      categories: bCats,
    });
  }

  // SOFT-HOLD customer slot-offers: while an offer is 'sent' (awaiting the customer's pick),
  // reserve EVERY candidate slot so the optimiser can't hand one to another job before they
  // answer — otherwise the slot could be gone when they confirm. Cleared on pick/decline.
  const offersR = await db.execute(sql`
    SELECT slot_offer FROM personalized_quotes
    WHERE slot_offer IS NOT NULL AND slot_offer->>'status' = 'sent';`);
  for (const o of rows(offersR)) {
    const cands = ((o.slot_offer as any)?.candidates || []) as Array<{ contractorId?: string; date?: string; slot?: string }>;
    for (const c of cands) {
      if (c.contractorId && c.date && c.slot) bookedSlots.add(`${c.contractorId}|${c.date}|${c.slot}`);
    }
  }

  return { today: todayUtcMidnight(), contractors, skillsByCon, isAvailable, bookedSlots, loadByCon, bookings, hasAnyAvailability };
}

/**
 * A pool job normalised exactly as the greedy sweep normalises it: categories from
 * line items, coords, value (pence), flexDeadline + slackDays. Exported so the
 * OPTIMISER consumes the IDENTICAL pool the greedy path consumes — assignability
 * (which jobs are placeable at all) cannot diverge between the two code paths.
 */
export interface PoolJobCtx {
  quoteId: string;
  customerName: string;
  categories: string[];
  lat: number | null;
  lng: number | null;
  valuePence: number;
  /** Real on-site work time in minutes (Σ line-item scheduleMinutes). Drives the optimiser's
   *  hours-aware day capacity + the multi-day flag. */
  workMinutes: number;
  slackDays: number;
  flexDeadline: string;
  /** Raw flex_booking_within_days (un-clamped); the optimiser clamps to its window. */
  flexWithinDays: number;
  /** Job-detail fields (surfaced in the console's job-detail modal; not used by matching). */
  postcode: string | null;
  address: string | null;
  jobDescription: string | null;
}

/** Fallback on-site minutes for a line item with no scheduleMinutes/timeEstimateMinutes. */
export const DEFAULT_LINE_MINUTES = 60;
/** Fallback total for a job whose line items carry no time at all. */
export const DEFAULT_JOB_MINUTES = 120;

/**
 * Loads + normalises the flexible pending pool using the SAME query + value/slack
 * derivation as runDispatchSweep. Returns rows in deposit-paid-desc order. The
 * optimiser calls this so its candidate set is byte-for-byte the sweep's.
 *
 * `testOnly` fences the pool (see testModeFilter): default (falsy) EXCLUDES seeded
 * dummies so the real console never sees them; true includes ONLY dummies.
 */
export async function loadDispatchPool(today: Date, limit = 50, testOnly = false): Promise<PoolJobCtx[]> {
  const poolR = await db.execute(sql`
    SELECT pq.id, pq.customer_name, pq.pricing_line_items, pq.coordinates,
           pq.flex_booking_within_days, pq.base_price, pq.deposit_paid_at,
           pq.postcode, pq.address, pq.job_description
    FROM personalized_quotes pq
    LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id = pq.id
    WHERE pq.deposit_paid_at IS NOT NULL AND cbr.id IS NULL AND pq.pricing_line_items IS NOT NULL AND pq.completed_at IS NULL AND pq.slot_offer IS NULL
    ${testModeFilter(testOnly)}
    ORDER BY pq.deposit_paid_at DESC LIMIT ${limit};`);

  return rows(poolR).map((job: any): PoolJobCtx => {
    const lineItems = (job.pricing_line_items || []) as Array<{ category?: string; scheduleMinutes?: number; timeEstimateMinutes?: number }>;
    const categories = [...new Set(lineItems.map((li) => li.category).filter(Boolean))] as string[];
    const { flexDeadline, slackDays } = computeSlack(job, today);
    const coords = (job.coordinates || null) as { lat?: number; lng?: number } | null;
    const jLat = coords?.lat != null && Number.isFinite(Number(coords.lat)) ? Number(coords.lat) : null;
    const jLng = coords?.lng != null && Number.isFinite(Number(coords.lng)) ? Number(coords.lng) : null;
    // Real on-site work time: sum each line's scheduleMinutes (canonical capacity field) →
    // timeEstimateMinutes → a per-line default. This is what the optimiser packs a day with.
    // Job on-site time = Σ each line's scheduleMinutes (the canonical, per-line editable
    // capacity field). Editing a line's minutes at dispatch re-flows this on the next sweep.
    const workMinutes = lineItems.reduce(
      (s, li) => s + (Number(li.scheduleMinutes ?? li.timeEstimateMinutes ?? DEFAULT_LINE_MINUTES) || 0), 0,
    ) || DEFAULT_JOB_MINUTES;
    return {
      quoteId: job.id,
      customerName: job.customer_name,
      categories,
      lat: jLat,
      lng: jLng,
      valuePence: jobValuePence(job),
      workMinutes,
      slackDays,
      flexDeadline,
      flexWithinDays: Number(job.flex_booking_within_days) || SLA_DEFAULT_WINDOW_DAYS,
      postcode: job.postcode ?? null,
      address: job.address ?? null,
      jobDescription: job.job_description ?? null,
    };
  });
}

export async function runDispatchSweep(opts: { dryRun?: boolean; limit?: number; maxWindowDays?: number; testOnly?: boolean } = {}): Promise<SweepResult> {
  const { limit = 50, maxWindowDays = 21, testOnly = false } = opts;

  // Pool load runs alongside the shared context load. testModeFilter fences the pool:
  // default (falsy) excludes seeded dummies; true includes ONLY dummies.
  const [poolR, ctx] = await Promise.all([
    db.execute(sql`
      SELECT pq.id, pq.customer_name, pq.pricing_line_items, pq.coordinates,
             pq.flex_booking_within_days, pq.base_price, pq.deposit_paid_at
      FROM personalized_quotes pq
      LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id = pq.id
      WHERE pq.deposit_paid_at IS NOT NULL AND cbr.id IS NULL AND pq.pricing_line_items IS NOT NULL AND pq.completed_at IS NULL AND pq.slot_offer IS NULL
      ${testModeFilter(testOnly)}
      ORDER BY pq.deposit_paid_at DESC LIMIT ${limit};`),
    loadDispatchContext(maxWindowDays),
  ]);

  const pool = rows(poolR);
  const { today, contractors, skillsByCon, isAvailable, bookedSlots, loadByCon, hasAnyAvailability } = ctx;

  // Candidate dates = every day in the window. dow via noon-UTC to match canonical weekday calc.
  const candidateDates: { d: string; dow: number }[] = [];
  for (let i = 1; i <= maxWindowDays; i++) {
    const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() + i);
    const d = ymd(dt);
    candidateDates.push({ d, dow: new Date(`${d}T12:00:00.000Z`).getUTCDay() });
  }

  const assigned: SweepProposal[] = [];
  const unassignable: SweepUnassignable[] = [];

  for (const job of pool) {
    const lineItems = (job.pricing_line_items || []) as Array<{ category?: string }>;
    const categories = [...new Set(lineItems.map((li) => li.category).filter(Boolean))] as string[];
    const { flexDeadline, slackDays } = computeSlack(job, today);
    const valuePence = jobValuePence(job);
    const base = { quoteId: job.id, customerName: job.customer_name, categories };
    const unBase = { ...base, slackDays, flexDeadline };
    if (!categories.length) { unassignable.push({ ...unBase, reason: 'No category on line items' }); continue; }

    const coords = (job.coordinates || null) as { lat?: number; lng?: number } | null;
    const jLat = coords?.lat, jLng = coords?.lng;
    const windowDays = Math.min(job.flex_booking_within_days || SLA_DEFAULT_WINDOW_DAYS, maxWindowDays);
    const cutoff = new Date(today); cutoff.setUTCDate(cutoff.getUTCDate() + windowDays);
    const cutoffStr = ymd(cutoff);

    const skilled = contractors.filter((c) => { const sk = skillsByCon.get(c.id); return sk && categories.every((cat) => sk.has(cat)); });
    if (!skilled.length) { unassignable.push({ ...unBase, reason: `No contractor covers ALL categories [${categories.join(', ')}]` }); continue; }

    const inRange = skilled.filter((c) => (jLat == null || jLng == null || c.lat == null || c.lng == null) ? true : haversine(jLat, jLng, c.lat, c.lng) <= c.radius);
    if (!inRange.length) { unassignable.push({ ...unBase, reason: 'No qualified contractor within service radius' }); continue; }

    let placed = false;
    for (const { d, dow } of candidateDates) {
      if (placed || d > cutoffStr) break;
      for (const slot of ['am', 'pm'] as const) {
        const free = inRange.filter((c) => isAvailable(c.id, d, dow, slot) && !bookedSlots.has(`${c.id}|${d}|${slot}`));
        if (!free.length) continue;
        free.sort((a, b) => (loadByCon.get(a.id) || 0) - (loadByCon.get(b.id) || 0));
        const pick = free[0];
        const dist = (jLat != null && jLng != null && pick.lat != null && pick.lng != null) ? Math.round(haversine(jLat, jLng, pick.lat, pick.lng) * 10) / 10 : null;
        assigned.push({ ...base, date: d, slot, contractorId: pick.id, contractorName: pick.name, distanceMiles: dist, valuePence, slackDays, flexDeadline });
        bookedSlots.add(`${pick.id}|${d}|${slot}`); loadByCon.set(pick.id, (loadByCon.get(pick.id) || 0) + 1); // reserve in-sweep
        placed = true; break;
      }
    }
    if (!placed) unassignable.push({ ...unBase, reason: hasAnyAvailability ? 'No qualified contractor available in window' : 'No contractor availability posted' });
  }

  const groups = buildProposalGroups(assigned);
  return { poolSize: pool.length, assigned, unassignable, groups };
}

/**
 * Group assigned proposals by (contractorId, date) into route-ready bundles with a
 * single deterministic rationale line (no LLM): job count, distinct categories,
 * geographic spread (max pairwise distance among members, miles, 1dp), and the date.
 */
function buildProposalGroups(assigned: SweepProposal[]): ProposalGroup[] {
  const byKey = new Map<string, SweepProposal[]>();
  for (const p of assigned) {
    const key = `${p.contractorId}|${p.date}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(p);
  }

  const groups: ProposalGroup[] = [];
  for (const [groupId, members] of byKey) {
    const [contractorId, date] = groupId.split('|');
    const categories = [...new Set(members.flatMap((m) => m.categories))];
    const totalValue = members.reduce((s, m) => s + (m.valuePence || 0), 0);

    // Geographic spread = max pairwise distance among members that have coords.
    // distanceMiles is job→contractor; for inter-job spread we need member coords,
    // which proposals don't carry — so approximate spread from the distanceMiles
    // span (max − min) when ≥2 members have it, else 0. (Deterministic.)
    const dists = members.map((m) => m.distanceMiles).filter((d): d is number => d != null);
    const spread = dists.length >= 2 ? Math.round((Math.max(...dists) - Math.min(...dists)) * 10) / 10 : 0;

    const catStr = categories.length ? categories.join(', ') : 'mixed';
    const rationale = `${members.length} job${members.length === 1 ? '' : 's'} · ${catStr} · ${spread.toFixed(1)}mi spread · ${shortDate(date)}`;

    groups.push({
      groupId, contractorId, contractorName: members[0].contractorName, date,
      members, totalValue, rationale,
    });
  }
  // Deterministic order: by date, then contractor.
  groups.sort((a, b) => a.date.localeCompare(b.date) || a.contractorId.localeCompare(b.contractorId));
  return groups;
}

// ── Schedule grid ──────────────────────────────────────────────────────────────

export interface ScheduleCellJob {
  quoteId: string; customerName: string; slot: 'am' | 'pm' | 'full_day'; source: 'booked' | 'proposed';
}
export interface ScheduleCell {
  date: string; dow: number;
  available: boolean;
  amBooked: boolean; pmBooked: boolean;
  jobs: ScheduleCellJob[];
  fillPct: number;
}
export interface ScheduleContractor { id: string; name: string; cells: ScheduleCell[]; }
export interface ScheduleResult {
  windowDays: number;
  days: string[];
  contractors: ScheduleContractor[];
}

/**
 * Contractor-day grid for the schedule UI. REUSES loadDispatchContext (same canonical
 * availability + bookings) and runs the sweep once to overlay "proposed" assignments.
 *
 * - "booked"   jobs come from accepted contractor_booking_requests.
 * - "proposed" jobs come from the sweep's `assigned` proposals.
 * - available  = any availability that day under the SAME canonical model the sweep uses
 *                (AM or PM coverage counts).
 * - fillPct    = (booked + proposed half-day slots / 2) * 100, capped 100.
 */
export async function buildSchedule(opts: { windowDays?: number } = {}): Promise<ScheduleResult> {
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 14, 21));

  // Load context wide enough to cover the window; run the sweep over the same window
  // so proposed overlays line up. (Sweep loads its own context internally; that's fine
  // — both use the identical canonical model, so results are consistent.)
  const [ctx, sweep] = await Promise.all([
    loadDispatchContext(windowDays + 1),
    runDispatchSweep({ dryRun: true, maxWindowDays: windowDays + 1 }),
  ]);
  const { today, contractors, isAvailable, bookings } = ctx;

  // Ordered window: today+1 .. today+windowDays.
  const days: { d: string; dow: number }[] = [];
  for (let i = 1; i <= windowDays; i++) {
    const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() + i);
    const d = ymd(dt);
    days.push({ d, dow: new Date(`${d}T12:00:00.000Z`).getUTCDay() });
  }
  const dayStrs = days.map((x) => x.d);
  const dayStrSet = new Set(dayStrs);

  // Index booked jobs by contractor|date (only within the window).
  type DayJobMap = Map<string, ScheduleCellJob[]>;
  const bookedByConDay = new Map<string, DayJobMap>();
  const addJob = (store: Map<string, DayJobMap>, cid: string, d: string, job: ScheduleCellJob) => {
    if (!store.has(cid)) store.set(cid, new Map());
    const m = store.get(cid)!;
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(job);
  };
  for (const b of bookings) {
    if (!dayStrSet.has(b.d) || !b.quoteId) continue;
    const slot = (b.slot === 'full_day' ? 'full_day' : b.slot) as 'am' | 'pm' | 'full_day';
    addJob(bookedByConDay, b.cid, b.d, { quoteId: b.quoteId, customerName: b.customerName ?? 'Customer', slot, source: 'booked' });
  }

  // Index proposed jobs by contractor|date (only within the window).
  const proposedByConDay = new Map<string, DayJobMap>();
  for (const p of sweep.assigned) {
    if (!dayStrSet.has(p.date)) continue;
    addJob(proposedByConDay, p.contractorId, p.date, { quoteId: p.quoteId, customerName: p.customerName, slot: p.slot, source: 'proposed' });
  }

  // Count occupied half-day slots (am/pm) for a list of jobs (full_day = 2).
  const occupiedHalfDays = (jobs: ScheduleCellJob[]): { am: boolean; pm: boolean; count: number } => {
    let am = false, pm = false;
    for (const j of jobs) {
      if (j.slot === 'full_day') { am = true; pm = true; }
      else if (j.slot === 'am') am = true;
      else if (j.slot === 'pm') pm = true;
    }
    return { am, pm, count: (am ? 1 : 0) + (pm ? 1 : 0) };
  };

  const contractorsOut: ScheduleContractor[] = contractors.map((c) => {
    const cells: ScheduleCell[] = days.map(({ d, dow }) => {
      const booked = bookedByConDay.get(c.id)?.get(d) ?? [];
      const proposed = proposedByConDay.get(c.id)?.get(d) ?? [];
      const jobs = [...booked, ...proposed];

      const occ = occupiedHalfDays(jobs);
      const fillPct = Math.min(100, Math.round((occ.count / 2) * 100));
      const available = isAvailable(c.id, d, dow, 'am') || isAvailable(c.id, d, dow, 'pm');

      return {
        date: d, dow,
        available,
        amBooked: occ.am, pmBooked: occ.pm,
        jobs,
        fillPct,
      };
    });
    return { id: c.id, name: c.name, cells };
  });

  return { windowDays, days: dayStrs, contractors: contractorsOut };
}

// ── Fixed / committed lane ─────────────────────────────────────────────────────

/**
 * Builds the fixed-lane data: accepted bookings (date+slot+contractor already
 * committed) within the next `windowDays`, each tagged with a COVERAGE STATUS.
 *
 * REUSES loadDispatchContext() for the canonical `isAvailable` model, contractor
 * names, and the FULL accepted-booking set (used for conflict + heavy-day counting —
 * which must consider ALL of a contractor's accepted bookings on a date, not just the
 * ones inside the output window). The output rows themselves come from a cbr→pq join
 * so each carries its quote-derived categories / coords / value.
 *
 * Status precedence (per booking): conflict → uncovered → at_risk → covered.
 *  - conflict  : assigned contractor has 2+ accepted bookings on the SAME date+slot
 *                (full_day collides with am/pm and vice-versa).
 *  - uncovered : assigned contractor NOT available that date/slot per `isAvailable`.
 *  - at_risk   : covered, but contractor has 3+ accepted bookings that same date.
 *  - covered   : otherwise.
 */
export async function buildFixedLane(opts: { windowDays?: number } = {}): Promise<FixedLaneResult> {
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 21, 21));

  // Load shared context (wide enough to cover the window for availability inputs) and
  // the in-window committed bookings joined to their quote, in parallel.
  const [ctx, fixedR] = await Promise.all([
    loadDispatchContext(windowDays + 1),
    db.execute(sql`
      SELECT cbr.id AS booking_id,
             cbr.quote_id AS quote_id,
             COALESCE(cbr.assigned_contractor_id, cbr.contractor_id) AS cid,
             to_char(cbr.scheduled_date::date,'YYYY-MM-DD') AS d,
             cbr.scheduled_slot AS slot,
             pq.customer_name AS customer_name,
             pq.pricing_line_items AS pricing_line_items,
             pq.coordinates AS coordinates,
             pq.base_price AS base_price,
             pq.deposit_paid_at AS deposit_paid_at,
             pq.flex_booking_within_days AS flex_booking_within_days
      FROM contractor_booking_requests cbr
      LEFT JOIN personalized_quotes pq ON pq.id = cbr.quote_id
      WHERE cbr.status = 'accepted'
        AND cbr.scheduled_date >= now()::date
        AND cbr.scheduled_date < (now()::date + (${windowDays})::int)
      ORDER BY cbr.scheduled_date ASC;`),
  ]);

  // Contractor display names from the shared roster.
  const nameById = new Map(ctx.contractors.map((c) => [c.id, c.name]));

  // Count accepted bookings per contractor|date and per contractor|date|slot across the
  // FULL accepted set (ctx.bookings), so conflict/heavy-day logic sees every commitment,
  // not just the ones inside the output window. full_day occupies both am+pm half-slots.
  const perDay = new Map<string, number>();          // `${cid}|${date}` → count
  const perSlot = new Map<string, number>();         // `${cid}|${date}|${am|pm}` → count
  for (const b of ctx.bookings) {
    if (!b.cid) continue;
    const dayKey = `${b.cid}|${b.d}`;
    perDay.set(dayKey, (perDay.get(dayKey) || 0) + 1);
    for (const s of (b.slot === 'full_day' ? ['am', 'pm'] : [b.slot])) {
      const slotKey = `${b.cid}|${b.d}|${s}`;
      perSlot.set(slotKey, (perSlot.get(slotKey) || 0) + 1);
    }
  }

  // Max overlap among the half-slots this booking occupies (full_day → max of am & pm).
  // Used to detect a double-book: 2+ accepted bookings sharing a half-day.
  const maxSlotOverlap = (cid: string, dStr: string, slot: string): number => {
    const halves = slot === 'full_day' ? ['am', 'pm'] : [slot];
    let max = 0;
    for (const s of halves) max = Math.max(max, perSlot.get(`${cid}|${dStr}|${s}`) || 0);
    return max;
  };

  // True if every half-day the slot occupies is free for this contractor (no accepted
  // booking already holds it). full_day needs BOTH am and pm clear.
  const slotFree = (cid: string, dStr: string, slot: 'am' | 'pm' | 'full_day'): boolean => {
    const halves = slot === 'full_day' ? ['am', 'pm'] : [slot];
    return halves.every((s) => !ctx.bookedSlots.has(`${cid}|${dStr}|${s}`));
  };

  /**
   * Nearest qualified + available BACKUP for an uncovered/conflict job (read-only). A
   * backup must: be a DIFFERENT contractor, cover ≥1 of the job's categories (covers-
   * most; ranks the contractor covering the MOST first), be available that date+slot per
   * the canonical `isAvailable`, have that slot FREE, and (when both have coords) be
   * within their service radius. Returns the closest such contractor, or null if none.
   * Uses the SAME availability + haversine + skills already loaded — no second model.
   */
  const findSuggestedFix = (
    excludeCid: string,
    dStr: string,
    dow: number,
    slot: 'am' | 'pm' | 'full_day',
    categories: string[],
    jLat: number | null,
    jLng: number | null,
  ): SuggestedFix | null => {
    const halves: SlotType[] = slot === 'full_day' ? ['am', 'pm'] : [slot as SlotType];
    type Cand = { c: ContractorCtx; coverCount: number; dist: number | null };
    const cands: Cand[] = [];
    for (const c of ctx.contractors) {
      if (c.id === excludeCid) continue;
      const sk = ctx.skillsByCon.get(c.id);
      if (!sk) continue;
      const coverCount = categories.filter((cat) => sk.has(cat)).length;
      if (coverCount < 1) continue; // must cover at least one category
      // Available across EVERY half-day the slot needs, and that slot must be free.
      if (!halves.every((s) => ctx.isAvailable(c.id, dStr, dow, s))) continue;
      if (!slotFree(c.id, dStr, slot)) continue;
      let dist: number | null = null;
      if (jLat != null && jLng != null && c.lat != null && c.lng != null) {
        dist = haversine(jLat, jLng, c.lat, c.lng);
        if (dist > c.radius) continue; // out of the backup's service radius
      }
      cands.push({ c, coverCount, dist });
    }
    if (!cands.length) return null;
    // Rank: most categories covered, then nearest (coord-less candidates sort last).
    cands.sort((a, b) =>
      (b.coverCount - a.coverCount) ||
      ((a.dist ?? Infinity) - (b.dist ?? Infinity)),
    );
    const best = cands[0];
    const total = categories.length || 1;
    const distNote = best.dist != null ? `${Math.round(best.dist * 10) / 10}mi away` : 'distance unknown';
    const coverNote = best.coverCount >= total
      ? 'covers all skills'
      : `covers ${best.coverCount}/${total} skills`;
    return {
      contractorId: best.c.id,
      contractorName: best.c.name,
      note: `${best.c.name} is free ${slot.toUpperCase()} on ${shortDate(dStr)} · ${coverNote} · ${distNote}`,
    };
  };

  const jobs: FixedJob[] = [];
  const summary = { covered: 0, atRisk: 0, uncovered: 0, conflict: 0, total: 0 };

  for (const r of rows(fixedR)) {
    const cid: string | null = r.cid ?? null;
    if (!cid) continue; // a committed booking must have an assigned contractor
    const dStr: string = r.d;
    const slot = (r.slot === 'full_day' ? 'full_day' : r.slot) as 'am' | 'pm' | 'full_day';
    const dow = new Date(`${dStr}T12:00:00.000Z`).getUTCDay();

    const lineItems = Array.isArray(r.pricing_line_items) ? r.pricing_line_items : [];
    const categories = [...new Set(
      lineItems.map((li: any) => (typeof li?.category === 'string' ? li.category : null)).filter(Boolean),
    )] as string[];

    const coords = (r.coordinates || null) as { lat?: number; lng?: number } | null;
    const lat = coords?.lat != null && Number.isFinite(Number(coords.lat)) ? Number(coords.lat) : null;
    const lng = coords?.lng != null && Number.isFinite(Number(coords.lng)) ? Number(coords.lng) : null;
    const valuePence = jobValuePence({ base_price: r.base_price, pricing_line_items: lineItems });

    // Coverage status precedence: conflict → uncovered → at_risk → covered.
    let status: CoverageStatus;
    let reason: string | null;
    const slotOverlap = maxSlotOverlap(cid, dStr, slot);
    const dayCount = perDay.get(`${cid}|${dStr}`) || 0;
    if (slotOverlap >= 2) {
      status = 'conflict';
      reason = `Double-booked with ${slotOverlap - 1} other job${slotOverlap - 1 === 1 ? '' : 's'}`;
    } else if (!ctx.isAvailable(cid, dStr, dow, slot as SlotType)) {
      status = 'uncovered';
      reason = 'Assigned contractor not available that day';
    } else if (dayCount >= 3) {
      status = 'at_risk';
      reason = `Heavy day — ${dayCount} jobs`;
    } else {
      status = 'covered';
      reason = null;
    }

    if (status === 'covered') summary.covered++;
    else if (status === 'at_risk') summary.atRisk++;
    else if (status === 'uncovered') summary.uncovered++;
    else summary.conflict++;
    summary.total++;

    // Read-only resolution hint: only for the two ACTIONABLE failure statuses.
    const suggestedFix = (status === 'uncovered' || status === 'conflict')
      ? findSuggestedFix(cid, dStr, dow, slot, categories, lat, lng)
      : null;

    // SLA: only flexible jobs carry the "within N days" promise (flex_booking_within_days
    // > 0). A pick-a-date booking has no window ⇒ no SLA. Breach = scheduled past deadline,
    // independent of coverage status (a covered job booked on day 10 still broke the promise).
    const flexWithin = Number(r.flex_booking_within_days) || 0;
    let slaDeadline: string | null = null;
    let slaState: SlaState | null = null;
    if (flexWithin > 0 && r.deposit_paid_at) {
      slaDeadline = computeSlack({ deposit_paid_at: r.deposit_paid_at, flex_booking_within_days: flexWithin }, ctx.today).flexDeadline;
      slaState = slaStateScheduled(dStr, slaDeadline);
    }

    jobs.push({
      quoteId: r.quote_id, bookingId: r.booking_id, customerName: r.customer_name ?? 'Customer',
      categories, date: dStr, slot,
      contractorId: cid, contractorName: nameById.get(cid) ?? 'Contractor',
      lat, lng, status, reason, valuePence, suggestedFix,
      slaDeadline, slaState,
    });
  }

  return { summary, jobs };
}
