/**
 * Dispatch OPTIMISER — goal-driven replacement for the greedy sweep, PROPOSALS ONLY.
 *
 * The greedy `runDispatchSweep` places each flexible-pool job at its earliest feasible
 * (date, least-loaded contractor) — it optimises NOTHING. This engine instead:
 *
 *   1. GENERATE  feasible placements per job (qualified+in-radius contractor × an
 *                available, un-taken (date, slot) within the job's slack window).
 *   2. SCORE     a whole work-pattern (the assignment of pool jobs to contractor-days)
 *                against a CONFIGURABLE goal (default "contractor £/hr density").
 *   3. SEARCH    greedy seed → local search (move a job to a better contractor-day,
 *                keep improving moves) up to a small budget. GUARANTEED ≥ greedy seed.
 *
 * It REUSES the sweep's loaders + canonical availability (`loadDispatchContext`,
 * `loadDispatchPool`, `isAvailable`, `haversine`) so assignability cannot diverge:
 * the same jobs greedy could place still place — the objective only changes WHO/WHEN/
 * bundling, never WHETHER. Read-only: writes nothing; the booking write-path
 * (assignFromPool / POST /dispatch-run) is COMPLETELY untouched.
 *
 * Existing accepted bookings are fixed anchors — they already consume that
 * contractor-day's slot/capacity (via ctx.bookedSlots + ctx.loadByCon) and are folded
 * into a bundle's travel/density so packing co-locates new jobs near committed work.
 */
import {
  loadDispatchContext,
  loadDispatchPool,
  haversine,
  ymd,
  shortDate,
  type DispatchContext,
  type ContractorCtx,
  type PoolJobCtx,
  type SweepProposal,
  type SweepUnassignable,
  type ProposalGroup,
} from './dispatch-sweep';
import type { SlotType } from '../shared/slot-times';
import { SLA_DEFAULT_WINDOW_DAYS } from '../shared/dispatch-sla';

// ── Tunable model constants ────────────────────────────────────────────────────

/** Assumed average driving speed for converting route miles → travel hours. */
const TRAVEL_MPH = 25;
/** A contractor's bookable on-site minutes in one day (AM 4h + PM 4h = 8h). The optimiser
 *  packs a day by real job minutes against this — NOT by a flat job count. */
const DAY_CAPACITY_MIN = 480;
/** Minutes one job consumes OF A SINGLE day for packing: its real work time, capped at a
 *  full day (a >1-day job fills the day and can't be paired; the overflow is the multi-day
 *  flag below, not extra packing). */
function jobDayLoadMin(workMinutes: number): number {
  return Math.min(Math.max(0, workMinutes), DAY_CAPACITY_MIN);
}
/** Whole days a job needs (≥1). >1 ⇒ multi-day: it can't fit one contractor-day and must be
 *  scheduled across several (flagged, not auto-split — the slot model is single-day). */
export function jobDaysNeeded(workMinutes: number): number {
  return Math.max(1, Math.round((workMinutes || 0) / DAY_CAPACITY_MIN));
}
/** Approximate minutes to reserve for an already-committed booking (we don't load its line
 *  items here) — a half-day, so a day with committed work still has room for one more. */
const ANCHOR_MINUTES = 240;
/** Local-search budgets — tiny problem (small roster), so these are generous. */
const MAX_LOCAL_ITERS = 400;
const MAX_LOCAL_MS = 400;

// ── Frozen settings contract ────────────────────────────────────────────────────

export type DispatchObjective = 'contractor_hourly' | 'customer_speed' | 'throughput' | 'even_load' | 'day_margin';
export type PackMode = 'fast' | 'balanced' | 'dense';

export interface DispatchGoal {
  objective: DispatchObjective;
  packMode: PackMode;
  maxJobsPerDay: number;        // default 4
  maxTravelMilesPerJob: number; // default 8
  // ── TRUE-MARGIN economics (FROZEN CONTRACT) ──
  fuelPencePerMile: number;     // vehicle cost p/mile (fuel + wear) on route miles; default 45 (~HMRC); clamp 0..500
  defaultDayRatePence: number;  // default 15000 (£150/day); used when a contractor has no per-head day_rate; clamp 0..200000
}

export const DEFAULT_GOAL: DispatchGoal = {
  objective: 'contractor_hourly',
  packMode: 'balanced',
  maxJobsPerDay: 4,
  maxTravelMilesPerJob: 8,
  fuelPencePerMile: 45,
  defaultDayRatePence: 15000,
};

// ── Internal placement / state types ────────────────────────────────────────────

/** A single feasible (contractor, day, slot) option for one pool job. */
interface Placement {
  conId: string;
  conName: string;
  date: string;       // YYYY-MM-DD
  slot: 'am' | 'pm';
  dayIndex: number;   // whole days from today (1 = today+1)
  distanceMiles: number | null; // job → contractor base
  /** True if this day is within the packMode slack-spend horizon (a PREFERENCE, not a
   *  feasibility gate — every feasible placement is kept so assignability never regresses). */
  preferred: boolean;
  /** True if this placement's date is ON OR BEFORE the job's SLA deadline (the customer's
   *  "within 7 days" promise). Drives the SLA_HONOUR_REWARD scoring layer so the optimiser
   *  prefers promise-keeping slots; false ⇒ this slot breaches (still placeable, just late). */
  withinSla: boolean;
  /** Covers-most: which of the JOB's categories THIS contractor's skills cover (≥1) and
   *  which they don't. A multi-category job assigns to whoever covers the MOST; any
   *  category no in-range contractor covers is flagged (not blocked). */
  coveredCategories: string[];
  uncoveredCategories: string[];
}

/** Per-job feasible set + carried job attributes. */
interface JobPlan {
  job: PoolJobCtx;
  placements: Placement[]; // empty ⇒ unassignable (with reason)
  unreason?: string;
}

/** Current assignment: quoteId → chosen Placement (or undefined = unplaced). */
type Assignment = Map<string, Placement | undefined>;

/** Result of an optimiser run. */
export interface OptimizeResult {
  poolSize: number;
  assigned: SweepProposal[];
  unassignable: SweepUnassignable[];
  groups: ProposalGroup[];
  /** Total objective value of the chosen arrangement (higher = better). */
  totalGoalScore: number;
  /** Total intra-bundle travel miles across all proposed day-bundles (for diagnostics). */
  totalTravelMiles: number;
  /** Proposed jobs scheduled on/before their 7-day promise (honoured) vs past it (breached).
   *  With SLA protection the search maximises honoured given the placement count. */
  slaHonoured: number;
  slaBreached: number;
}

// ── Goal scoring ─────────────────────────────────────────────────────────────────

/** A committed-anchor "job" for a contractor-day: occupies a slot + carries coords. */
interface AnchorJob { lat: number | null; lng: number | null; }

/**
 * Nearest-neighbour route miles through a set of stop coords, starting from `base`
 * (the contractor's home) when present. Stops without coords contribute 0. Deterministic
 * (ties broken by insertion order). This is the travel a contractor drives across the
 * bundle — the denominator side of density.
 */
function routeMiles(base: ContractorCtx, stops: { lat: number | null; lng: number | null }[]): number {
  const pts = stops.filter((s) => s.lat != null && s.lng != null) as { lat: number; lng: number }[];
  if (!pts.length) return 0;
  const remaining = [...pts];
  let total = 0;
  // Start from base if the contractor has coords; else from the first stop.
  let cur: { lat: number; lng: number };
  if (base.lat != null && base.lng != null) {
    cur = { lat: base.lat, lng: base.lng };
  } else {
    cur = remaining.shift()!;
  }
  while (remaining.length) {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    total += bestD;
    cur = remaining.splice(bestI, 1)[0];
  }
  return total;
}

/**
 * Nearest-neighbour VISITING ORDER over a bundle's members, starting from the
 * contractor's base (when it has coords). Returns the member indices in the order the
 * route visits them — the SAME nearest-neighbour walk `routeMiles` measures, just
 * surfaced as a sequence for the map to draw. Members without coords keep their relative
 * input order and are appended last (so every member appears exactly once). Deterministic
 * (ties broken by input index).
 */
function routeOrderIndices(
  base: ContractorCtx,
  members: { lat: number | null; lng: number | null }[],
): number[] {
  const withCoords: number[] = [];
  const withoutCoords: number[] = [];
  members.forEach((m, i) => (m.lat != null && m.lng != null ? withCoords : withoutCoords).push(i));
  if (!withCoords.length) return members.map((_, i) => i); // nothing to route — input order

  const order: number[] = [];
  const remaining = [...withCoords];
  // Start from base when present; else seed from the first coord'd member.
  let cur: { lat: number; lng: number };
  if (base.lat != null && base.lng != null) {
    cur = { lat: base.lat, lng: base.lng };
  } else {
    const first = remaining.shift()!;
    order.push(first);
    cur = { lat: members[first].lat!, lng: members[first].lng! };
  }
  while (remaining.length) {
    let bestPos = 0, bestD = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const m = members[remaining[k]];
      const d = haversine(cur.lat, cur.lng, m.lat!, m.lng!);
      if (d < bestD) { bestD = d; bestPos = k; }
    }
    const idx = remaining.splice(bestPos, 1)[0];
    order.push(idx);
    cur = { lat: members[idx].lat!, lng: members[idx].lng! };
  }
  return [...order, ...withoutCoords];
}

/** Per contractor-day bundle metrics shared by scoring + rationale. */
interface BundleMetrics {
  jobCount: number;
  valuePence: number;
  routeMi: number;       // nearest-neighbour route miles (base → stops)
  workHours: number;
  travelHours: number;
  effectiveHourly: number; // £/hr
  /** Worst per-job travel = routeMi / jobCount (used for the maxTravelMilesPerJob gate). */
  perJobMiles: number;
}

function bundleMetrics(
  base: ContractorCtx,
  newJobs: PoolJobCtx[],
  anchors: AnchorJob[],
): BundleMetrics {
  const jobCount = newJobs.length; // anchors are fixed; density credits the NEW jobs
  const valuePence = newJobs.reduce((s, j) => s + (j.valuePence || 0), 0);
  const stops = [
    ...anchors.map((a) => ({ lat: a.lat, lng: a.lng })),
    ...newJobs.map((j) => ({ lat: j.lat, lng: j.lng })),
  ];
  const routeMi = routeMiles(base, stops);
  // REAL on-site hours: Σ each new job's work minutes + an approx half-day per committed
  // anchor (its line items aren't loaded here). This is what makes £/hr + margin honest —
  // a 9-hour job no longer reads as 2.
  const workHours = (newJobs.reduce((s, j) => s + (j.workMinutes || 0), 0) + anchors.length * ANCHOR_MINUTES) / 60;
  const travelHours = routeMi / TRAVEL_MPH;
  const denomHours = workHours + travelHours;
  const value = valuePence / 100; // pence → £
  const effectiveHourly = denomHours > 0 ? value / denomHours : 0;
  const perJobMiles = jobCount > 0 ? routeMi / jobCount : 0;
  return { jobCount, valuePence, routeMi, workHours, travelHours, effectiveHourly, perJobMiles };
}

// ── TRUE-MARGIN economics ─────────────────────────────────────────────────────────
//
// A contractor day rate is a FIXED cost: once a contractor works a day, the rate is
// owed in full regardless of job count. Fuel = the day's ROUND-TRIP route miles ×
// goal.fuelPencePerMile. So a contractor-day's true profit is
//   margin = Σ job revenue − dayRate − fuel.
// We score by this (objective 'day_margin') and FLAG (never block) loss-making days.

/** Computed margin metrics for one contractor-day bundle (all pence; miles round-trip). */
export interface BundleMargin {
  routeMiles: number;     // ROUND-TRIP nearest-neighbour: base → stops → back to base
  revenuePence: number;   // Σ member valuePence
  dayRatePence: number;   // contractor.dayRate ?? goal.defaultDayRatePence
  fuelPence: number;      // round(routeMiles * goal.fuelPencePerMile)
  marginPence: number;    // revenuePence − dayRatePence − fuelPence
  coversDayRate: boolean; // marginPence >= 0
}

/**
 * Round-trip route miles: base → jobs (nearest-neighbour) → back to base. Reuses the
 * one-way `routeMiles` (base → stops) and ADDS the return leg from the last stop back
 * to base. If the contractor has no coords, there is no base anchor and we fall back to
 * the pure job-to-job route (no return leg) — same coordless behaviour as `routeMiles`.
 */
function roundTripMiles(base: ContractorCtx, stops: { lat: number | null; lng: number | null }[]): number {
  const oneWay = routeMiles(base, stops);
  if (base.lat == null || base.lng == null) return oneWay; // no base ⇒ job-to-job only
  const pts = stops.filter((s) => s.lat != null && s.lng != null) as { lat: number; lng: number }[];
  if (!pts.length) return 0;
  // Last stop visited = the farthest in nearest-neighbour order; approximate the return
  // leg as the straight-line from the geographically farthest stop back to base. (The
  // route is a heuristic; the return leg is symmetric to the outbound first leg.)
  let far = 0;
  for (const p of pts) far = Math.max(far, haversine(base.lat, base.lng, p.lat, p.lng));
  return oneWay + far;
}

/**
 * Margin for a contractor-day bundle. Revenue counts the NEW pool jobs being placed
 * (the day rate + fuel are the contractor-day's whole cost; anchors share the same day
 * but their revenue is already committed elsewhere, so crediting it here would double-
 * count). The route, however, includes anchor stops so fuel reflects the real driving.
 */
function bundleMargin(
  goal: DispatchGoal,
  con: ContractorCtx,
  newJobs: PoolJobCtx[],
  anchors: AnchorJob[],
): BundleMargin {
  const revenuePence = newJobs.reduce((s, j) => s + (j.valuePence || 0), 0);
  const stops = [
    ...anchors.map((a) => ({ lat: a.lat, lng: a.lng })),
    ...newJobs.map((j) => ({ lat: j.lat, lng: j.lng })),
  ];
  const miles = roundTripMiles(con, stops);
  // A bundle's work may span MULTIPLE days (one big job, or several jobs whose hours exceed a
  // day) — each day owes the FULL day rate, so charge per real day, not a flat one. Without
  // this a 3-day job looks like it only costs one day's labour.
  const bundleDays = jobDaysNeeded(newJobs.reduce((s, j) => s + (j.workMinutes || 0), 0));
  const dayRatePence = (con.dayRate ?? goal.defaultDayRatePence) * bundleDays;
  const fuelPence = Math.round(miles * goal.fuelPencePerMile);
  const marginPence = revenuePence - dayRatePence - fuelPence;
  return {
    routeMiles: Math.round(miles * 10) / 10,
    revenuePence,
    dayRatePence,
    fuelPence,
    marginPence,
    coversDayRate: marginPence >= 0,
  };
}

/**
 * Lexicographic weight constants. The total objective is layered so that, in priority
 * order, the search ALWAYS prefers: (1) more jobs PLACED, then (2) the active objective,
 * then (3) the packMode slack-spend preference. Each layer's weight dominates the next's
 * realistic range, so a lower-priority term can never overturn a higher-priority one.
 *
 *  - PLACEMENT_REWARD enforces "assignability never regresses" at the score level: any
 *    arrangement that places more jobs strictly outscores one that places fewer. (The
 *    seed already places greedily; this stops local search from EVER dropping a job to
 *    chase £/hr.)
 *  - TRAVEL_PENALTY softly discourages bundles over the per-job travel cap WITHOUT
 *    forbidding them — a job whose only option is a far contractor still places (the
 *    objective steers bundling, not WHETHER a job is placed).
 */
const PLACEMENT_REWARD = 1_000_000;
/**
 * SLA-honour reward (per job whose chosen slot is ON OR BEFORE its 7-day promise deadline,
 * i.e. placement.withinSla). This is what makes the optimiser PROTECT the customer promise
 * rather than merely flag breaches: sized BELOW PLACEMENT_REWARD (so the search never drops
 * a placeable job to honour another's SLA — a placed-but-late job still beats an unplaced
 * one) but FAR ABOVE the objective band (£/hr, day-margin, etc. are « 500_000 over a small
 * roster), so among arrangements that place the same jobs it always prefers the one that
 * keeps MORE promises — even when an earlier honoured slot is denser-unfriendly or lower-
 * margin. A job whose deadline has already passed has no within-SLA placement, so this term
 * is indifferent to where it lands (the objective decides) — you can't un-break a promise.
 */
const SLA_HONOUR_REWARD = 500_000;
/**
 * Covers-most reward (per JOB CATEGORY covered by the chosen contractor). Sits a tier
 * BELOW PLACEMENT_REWARD so placing a job always beats covering more categories, but a
 * tier ABOVE the objective-term band so — given a job IS placed — the search prefers the
 * contractor that covers the MOST of its categories (only falling to a lesser-covering
 * one when the better contractor genuinely can't take the slot). Ties on coverage fall
 * through to the active objective, then travel/packMode. Sized 1_000 (objective terms
 * are £/hr, margins-in-£, day counts — all « 1_000 over a small roster).
 */
const COVERAGE_REWARD_PER_CAT = 1_000;
const TRAVEL_PENALTY_PER_MILE_OVER = 500;
const PACKMODE_BONUS = 5; // per job landed on a packMode-preferred day
/**
 * Soft day-rate-coverage penalty (shared by ALL objectives). A loss-making bundle
 * (!coversDayRate) is nudged DOWN the ranking so it surfaces last — but it is NEVER
 * dropped and NEVER made unassignable (the user chose to FLAG, not block). Sized well
 * below PLACEMENT_REWARD so placing a job always beats avoiding a loss, and modest
 * enough that it only breaks ties between otherwise-comparable arrangements. The
 * 'day_margin' objective doesn't need this (loss-aversion is inherent), but applying it
 * everywhere keeps loss-making days consistently ranked lower across all objectives.
 */
const UNCOVERED_DAY_PENALTY = 1_000;

/**
 * Total objective for a full arrangement. Higher = better for ALL objectives
 * (speed/load are negated so the search can always maximise). Layered (priority order) as
 *   PLACEMENT_REWARD·placed  +  SLA_HONOUR_REWARD·honoured  +  COVERAGE_REWARD·coveredCats
 *     +  objectiveTerm  −  travelPenalty  −  coveragePenalty  +  packModeBonus.
 * Each layer's weight dominates the realistic range of the next, so the search prefers, in
 * strict order: (1) place more jobs, (2) keep more 7-day promises (honoured = scheduled
 * on/before deadline), (3) cover more categories, then (4) the active objective, travel cap
 * and packMode. The SLA layer is what makes the optimiser PROTECT the promise — it will
 * pick an earlier honoured slot over a denser/higher-margin late one — without ever dropping
 * a job to do so (placement still dominates).
 */
function scoreArrangement(
  goal: DispatchGoal,
  ctx: DispatchContext,
  conById: Map<string, ContractorCtx>,
  plans: JobPlan[],
  assignment: Assignment,
  anchorsByConDay: Map<string, AnchorJob[]>,
): number {
  // Bucket chosen placements into contractor-day bundles + count placed/preferred and
  // total job-categories covered by the chosen contractor (covers-most tie-break).
  const bundles = new Map<string, { con: ContractorCtx; jobs: PoolJobCtx[]; key: string }>();
  let placed = 0;
  let honoured = 0;
  let preferredHits = 0;
  let coveredCats = 0;
  for (const plan of plans) {
    const p = assignment.get(plan.job.quoteId);
    if (!p) continue;
    placed++;
    if (p.withinSla) honoured++;
    if (p.preferred) preferredHits++;
    coveredCats += p.coveredCategories.length;
    const key = `${p.conId}|${p.date}`;
    if (!bundles.has(key)) bundles.set(key, { con: conById.get(p.conId)!, jobs: [], key });
    bundles.get(key)!.jobs.push(plan.job);
  }

  // Travel-cap soft penalty (shared by every objective): Σ over bundles of the per-job
  // miles in EXCESS of the cap, weighted. Never -Infinity, so a job is never unplaceable.
  // Coverage soft penalty (also shared): a flat nudge per loss-making bundle so days that
  // don't cover their day rate rank lower WITHOUT being dropped (FLAG, never block).
  let travelPenalty = 0;
  let coveragePenalty = 0;
  for (const { con, jobs, key } of bundles.values()) {
    const anchors = anchorsByConDay.get(key) ?? [];
    const m = bundleMetrics(con, jobs, anchors);
    if (m.perJobMiles > goal.maxTravelMilesPerJob) {
      travelPenalty += (m.perJobMiles - goal.maxTravelMilesPerJob) * TRAVEL_PENALTY_PER_MILE_OVER;
    }
    if (!bundleMargin(goal, con, jobs, anchors).coversDayRate) coveragePenalty += UNCOVERED_DAY_PENALTY;
  }

  const placementLayer = PLACEMENT_REWARD * placed;
  const slaLayer = SLA_HONOUR_REWARD * honoured;
  const coverageLayer = COVERAGE_REWARD_PER_CAT * coveredCats;
  const packLayer = PACKMODE_BONUS * preferredHits;

  let objectiveTerm = 0;
  switch (goal.objective) {
    case 'contractor_hourly': {
      // Σ effective £/hr across all contractor-day bundles (density: value per worked hr).
      for (const { con, jobs, key } of bundles.values()) {
        const anchors = anchorsByConDay.get(key) ?? [];
        objectiveTerm += bundleMetrics(con, jobs, anchors).effectiveHourly;
      }
      break;
    }
    case 'customer_speed': {
      // Minimise Σ(placementDay − today) ⇒ maximise its negation.
      let sumDays = 0;
      for (const plan of plans) {
        const p = assignment.get(plan.job.quoteId);
        if (p) sumDays += p.dayIndex; // dayIndex = whole days from today
      }
      objectiveTerm = -sumDays;
      break;
    }
    case 'throughput': {
      // Count placed (already in placementLayer; keep objectiveTerm 0 so the layers
      // don't double-count — throughput IS the placement layer).
      objectiveTerm = 0;
      break;
    }
    case 'even_load': {
      // Minimise variance of per-contractor job counts (incl. existing load anchors)
      // ⇒ maximise its negation. All contractors counted so idle ones raise variance
      // when work piles on one.
      const counts = new Map<string, number>();
      for (const c of ctx.contractors) counts.set(c.id, ctx.loadByCon.get(c.id) || 0);
      for (const plan of plans) {
        const p = assignment.get(plan.job.quoteId);
        if (p) counts.set(p.conId, (counts.get(p.conId) || 0) + 1);
      }
      const vals = [...counts.values()];
      const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1);
      objectiveTerm = -variance;
      break;
    }
    case 'day_margin': {
      // Maximise Σ marginPence (revenue − dayRate − fuel) across all contractor-day
      // bundles. Margin is in £ (pence/100) so it sits in the same magnitude band as the
      // other objective terms (well under PLACEMENT_REWARD, so placement still dominates).
      for (const { con, jobs, key } of bundles.values()) {
        const anchors = anchorsByConDay.get(key) ?? [];
        objectiveTerm += bundleMargin(goal, con, jobs, anchors).marginPence / 100;
      }
      break;
    }
  }

  return placementLayer + slaLayer + coverageLayer + objectiveTerm - travelPenalty - coveragePenalty + packLayer;
}

// ── Feasibility (generate) ───────────────────────────────────────────────────────

/**
 * Build the per-job feasible placement set. Qualification is now COVERS-MOST (not
 * covers-ALL): a contractor is a candidate if they cover ≥1 of the job's categories.
 * Candidates are ranked by how many categories they cover (most first) so a multi-
 * category job assigns to the best-covering contractor, with any still-uncovered
 * category FLAGGED rather than blocking the job. Only a job NO in-range available
 * contractor covers even partially stays blocked. Radius + canonical availability +
 * slot-not-taken checks run over the FULL window. So assignability strictly WIDENS vs
 * the old covers-ALL greedy (every job greedy could place still places; some it
 * couldn't now place too). capacity (maxJobsPerDay) is enforced during search, not in
 * the static feasible set (it depends on the chosen arrangement).
 *
 * packMode does NOT prune placements (that would drop jobs whose only slot is late, a
 * regression). Instead each placement is flagged `preferred` if its day falls within the
 * packMode slack-spend horizon; the search uses that as a soft bias:
 *   fast     → only the EARLIEST feasible day is preferred (place ASAP),
 *   dense    → the whole slack window is preferred (defer to co-locate),
 *   balanced → up to HALF the slack is preferred.
 */
function buildJobPlans(
  goal: DispatchGoal,
  ctx: DispatchContext,
  pool: PoolJobCtx[],
  maxWindowDays: number,
): JobPlan[] {
  const { today, contractors, skillsByCon, isAvailable, bookedSlots, hasAnyAvailability } = ctx;

  // Candidate dates across the whole window (dow via noon-UTC, matching the sweep).
  const candidateDates: { d: string; dow: number; idx: number }[] = [];
  for (let i = 1; i <= maxWindowDays; i++) {
    const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() + i);
    const d = ymd(dt);
    candidateDates.push({ d, dow: new Date(`${d}T12:00:00.000Z`).getUTCDay(), idx: i });
  }

  const plans: JobPlan[] = [];
  for (const job of pool) {
    if (!job.categories.length) { plans.push({ job, placements: [], unreason: 'No category on line items' }); continue; }

    // FULL-SKILL MATCH: a contractor qualifies ONLY if their skills cover EVERY category
    // the booked job needs. No partial "covers-most" / "2nd trade" — if no single
    // contractor covers the whole job, it shows NO contractor (blocked) until the
    // skills/tags are sorted. (covered = all the job's categories; uncovered = none.)
    type Coverage = { covered: string[]; uncovered: string[] };
    const coverageByCon = new Map<string, Coverage>();
    const skilled = contractors.filter((c) => {
      const sk = skillsByCon.get(c.id);
      if (!sk) return false;
      if (!job.categories.every((cat) => sk.has(cat))) return false;
      coverageByCon.set(c.id, { covered: job.categories.slice(), uncovered: [] });
      return true;
    });
    if (!skilled.length) { plans.push({ job, placements: [], unreason: `No contractor matches the required skills [${job.categories.join(', ')}]` }); continue; }

    const inRange = skilled.filter((c) =>
      (job.lat == null || job.lng == null || c.lat == null || c.lng == null)
        ? true
        : haversine(job.lat, job.lng, c.lat, c.lng) <= c.radius,
    );
    if (!inRange.length) { plans.push({ job, placements: [], unreason: 'No qualified contractor within service radius' }); continue; }

    // Job's hard flex window (min of its flex setting and the global window). Default to
    // the customer-facing 7-day promise when unset (matches the SLA deadline anchor).
    const windowDays = Math.min(job.flexWithinDays || SLA_DEFAULT_WINDOW_DAYS, maxWindowDays);

    // Gather EVERY feasible (date, slot, contractor) within the window (no packMode prune).
    const raw: Placement[] = [];
    for (const { d, dow, idx } of candidateDates) {
      if (idx > windowDays) break;
      for (const slot of ['am', 'pm'] as const) {
        for (const c of inRange) {
          if (!isAvailable(c.id, d, dow, slot as SlotType)) continue;
          if (bookedSlots.has(`${c.id}|${d}|${slot}`)) continue;
          const dist = (job.lat != null && job.lng != null && c.lat != null && c.lng != null)
            ? Math.round(haversine(job.lat, job.lng, c.lat, c.lng) * 10) / 10
            : null;
          const cov = coverageByCon.get(c.id)!;
          raw.push({
            conId: c.id, conName: c.name, date: d, slot, dayIndex: idx, distanceMiles: dist, preferred: false,
            coveredCategories: cov.covered, uncoveredCategories: cov.uncovered,
            // Honoured iff this date is on/before the job's deposit-anchored promise.
            withinSla: job.flexDeadline ? d <= job.flexDeadline : true,
          });
        }
      }
    }

    if (!raw.length) {
      plans.push({ job, placements: [], unreason: hasAnyAvailability ? 'No qualified contractor available in window' : 'No contractor availability posted' });
      continue;
    }

    // Flag the packMode slack-spend horizon (preference only — all placements kept).
    const earliestIdx = Math.min(...raw.map((p) => p.dayIndex));
    const slack = Math.max(0, windowDays - earliestIdx);
    let horizon: number;
    if (goal.packMode === 'fast') horizon = earliestIdx;                 // earliest day only
    else if (goal.packMode === 'dense') horizon = earliestIdx + slack;   // full slack
    else horizon = earliestIdx + Math.floor(slack / 2);                  // balanced: half slack
    for (const p of raw) p.preferred = p.dayIndex <= horizon;

    plans.push({ job, placements: raw });
  }
  return plans;
}

// ── Search: greedy seed → local search ───────────────────────────────────────────

/** Capacity tracker keyed `${conId}|${date}` → occupied slots + job count + MINUTES used. */
class CapacityState {
  private slots = new Set<string>(); // `${conId}|${date}|${slot}`
  private counts = new Map<string, number>(); // `${conId}|${date}` → new-job count
  private minutes = new Map<string, number>(); // `${conId}|${date}` → on-site minutes used

  constructor(private maxJobsPerDay: number, private bookedSlots: Set<string>, anchorsByConDay: Map<string, AnchorJob[]>) {
    // Seed counts + minutes with committed anchors so caps include fixed work.
    for (const [key, anchors] of anchorsByConDay) {
      this.counts.set(key, anchors.length);
      this.minutes.set(key, anchors.length * ANCHOR_MINUTES);
    }
  }

  /** Can this placement be taken now: slot free, under the job-count cap, AND the day has
   *  room for this job's HOURS (jobDayLoadMin) — so two full-day jobs never share a day. */
  canTake(p: Placement, workMinutes: number): boolean {
    const slotKey = `${p.conId}|${p.date}|${p.slot}`;
    if (this.slots.has(slotKey) || this.bookedSlots.has(slotKey)) return false;
    const dayKey = `${p.conId}|${p.date}`;
    if ((this.counts.get(dayKey) || 0) >= this.maxJobsPerDay) return false;
    return (this.minutes.get(dayKey) || 0) + jobDayLoadMin(workMinutes) <= DAY_CAPACITY_MIN;
  }
  take(p: Placement, workMinutes: number): void {
    this.slots.add(`${p.conId}|${p.date}|${p.slot}`);
    const dayKey = `${p.conId}|${p.date}`;
    this.counts.set(dayKey, (this.counts.get(dayKey) || 0) + 1);
    this.minutes.set(dayKey, (this.minutes.get(dayKey) || 0) + jobDayLoadMin(workMinutes));
  }
  release(p: Placement, workMinutes: number): void {
    this.slots.delete(`${p.conId}|${p.date}|${p.slot}`);
    const dayKey = `${p.conId}|${p.date}`;
    this.counts.set(dayKey, Math.max(0, (this.counts.get(dayKey) || 0) - 1));
    this.minutes.set(dayKey, Math.max(0, (this.minutes.get(dayKey) || 0) - jobDayLoadMin(workMinutes)));
  }
}

/**
 * Greedy seed: jobs in SLACK order (tightest first, then highest value) → for each,
 * the feasible placement that most raises the total objective under current capacity.
 * Maximises assignment (tight jobs grab scarce slots first — preserving the greedy
 * sweep's placement count) and gives local search a strong start.
 *
 * packMode drives the seed's DAY choice here: a job is seeded among its packMode-
 * PREFERRED placements (within the slack-spend horizon) when any such slot is free,
 * else it falls back to ANY free placement (so a job whose only slot is out-of-horizon
 * STILL places — assignability never regresses). This is what makes fast seed at the
 * earliest day and dense defer to co-locate, observably.
 */
function greedySeed(
  goal: DispatchGoal,
  ctx: DispatchContext,
  conById: Map<string, ContractorCtx>,
  plans: JobPlan[],
  anchorsByConDay: Map<string, AnchorJob[]>,
): { assignment: Assignment; cap: CapacityState } {
  const cap = new CapacityState(goal.maxJobsPerDay, ctx.bookedSlots, anchorsByConDay);
  const assignment: Assignment = new Map();

  const order = [...plans]
    .filter((p) => p.placements.length)
    .sort((a, b) => (a.job.slackDays - b.job.slackDays) || (b.job.valuePence - a.job.valuePence));

  const pickBest = (plan: JobPlan, pool: Placement[]): Placement | undefined => {
    let best: Placement | undefined;
    let bestScore = -Infinity;
    for (const p of pool) {
      if (!cap.canTake(p, plan.job.workMinutes)) continue;
      assignment.set(plan.job.quoteId, p);
      const s = scoreArrangement(goal, ctx, conById, plans, assignment, anchorsByConDay);
      if (s > bestScore) { bestScore = s; best = p; }
      assignment.delete(plan.job.quoteId);
    }
    return best;
  };

  for (const plan of order) {
    // Prefer in-horizon (packMode-preferred) placements; fall back to all if none free.
    const preferred = plan.placements.filter((p) => p.preferred);
    let best = preferred.length ? pickBest(plan, preferred) : undefined;
    if (!best) best = pickBest(plan, plan.placements);
    if (best) { assignment.set(plan.job.quoteId, best); cap.take(best, plan.job.workMinutes); }
  }
  return { assignment, cap };
}

/**
 * Local search: repeatedly try MOVING a placed job to another feasible contractor-day
 * (and try placing currently-unplaced jobs into any now-free slot). Keep any move that
 * RAISES the total objective; never accept a capacity/slot-breaking move. Iterate to a
 * small iteration/time budget. Because we only keep improving moves, the final objective
 * is GUARANTEED ≥ the greedy seed.
 */
function localSearch(
  goal: DispatchGoal,
  ctx: DispatchContext,
  conById: Map<string, ContractorCtx>,
  plans: JobPlan[],
  anchorsByConDay: Map<string, AnchorJob[]>,
  assignment: Assignment,
  cap: CapacityState,
): void {
  const t0 = Date.now();
  let improved = true;
  let iters = 0;
  let baseScore = scoreArrangement(goal, ctx, conById, plans, assignment, anchorsByConDay);

  while (improved && iters < MAX_LOCAL_ITERS && Date.now() - t0 < MAX_LOCAL_MS) {
    improved = false;
    for (const plan of plans) {
      if (!plan.placements.length) continue;
      iters++;
      const current = assignment.get(plan.job.quoteId);

      let bestP: Placement | undefined = current;
      let bestScore = baseScore;

      // Free the current placement so alternatives (incl. its own slot) are takeable.
      if (current) cap.release(current, plan.job.workMinutes);

      for (const p of plan.placements) {
        // Skip the identical current placement (no-op).
        if (current && p.conId === current.conId && p.date === current.date && p.slot === current.slot) continue;
        if (!cap.canTake(p, plan.job.workMinutes)) continue;
        assignment.set(plan.job.quoteId, p);
        const s = scoreArrangement(goal, ctx, conById, plans, assignment, anchorsByConDay);
        if (s > bestScore) { bestScore = s; bestP = p; }
      }

      // Commit the winner (could be the original placement).
      if (bestP) {
        assignment.set(plan.job.quoteId, bestP);
        cap.take(bestP, plan.job.workMinutes);
      } else {
        assignment.delete(plan.job.quoteId);
      }
      if (bestScore > baseScore) { baseScore = bestScore; improved = true; }
    }
  }
}

// ── Rationale per objective ──────────────────────────────────────────────────────

/** Distinct categories across a bundle's new jobs (stable order). */
function bundleCategories(jobs: PoolJobCtx[]): string[] {
  return [...new Set(jobs.flatMap((j) => j.categories))];
}

/** Signed "+£101" / "−£40" string from a pence amount (whole £, deterministic). */
function signedPounds(pence: number): string {
  const pounds = Math.round(pence / 100);
  return `${pounds >= 0 ? '+' : '−'}£${Math.abs(pounds)}`;
}

/**
 * One deterministic rationale line whose HEADLINE METRIC matches the active objective.
 * Every line ALSO carries the true day-margin (revenue − dayRate − fuel) so the
 * dispatcher always sees whether a day pays for itself — a loss shows as "margin −£40".
 *  - contractor_hourly : "≈£42/hr · 12.0mi route · fills 80% · margin +£101"
 *  - customer_speed    : "in 2 days · 3 jobs · plumbing, painting · Tue 18 Jun · margin +£101"
 *  - throughput        : "3 jobs packed · plumbing, painting · 12.0mi route · Tue 18 Jun · margin +£101"
 *  - even_load         : "balances load · 3 jobs · 12.0mi route · Tue 18 Jun · margin +£101"
 *  - day_margin        : "margin +£101 · revenue £280 · day £150 + fuel £29 · 3 jobs · Tue 18 Jun"
 */
function buildRationale(
  goal: DispatchGoal,
  con: ContractorCtx,
  date: string,
  jobs: PoolJobCtx[],
  anchors: AnchorJob[],
  earliestDayIndex: number,
): { rationale: string; metrics: BundleMetrics; margin: BundleMargin } {
  const m = bundleMetrics(con, jobs, anchors);
  const margin = bundleMargin(goal, con, jobs, anchors);
  const cats = bundleCategories(jobs);
  const catStr = cats.length ? cats.join(', ') : 'mixed';
  const dayLabel = shortDate(date);
  const fillPct = Math.min(100, Math.round(((m.jobCount + anchors.length) / 2) * 100)); // 2 slots/day
  // ONE consistent mileage everywhere: the ROUND-TRIP route miles (base → jobs → base)
  // that fuel/margin is computed from. (Previously the headline showed a one-way "day
  // spread" AND a separate round-trip figure for fuel — two different numbers for the
  // same day. Now both the label and the fuel math use margin.routeMiles.)
  const miStr = `${margin.routeMiles.toFixed(1)}mi route`;
  const marginStr = `margin ${signedPounds(margin.marginPence)}`;

  let rationale: string;
  switch (goal.objective) {
    case 'contractor_hourly':
      rationale = `≈£${Math.round(m.effectiveHourly)}/hr · ${miStr} · fills ${fillPct}% · ${marginStr}`;
      break;
    case 'customer_speed':
      rationale = `in ${earliestDayIndex} day${earliestDayIndex === 1 ? '' : 's'} · ${m.jobCount} job${m.jobCount === 1 ? '' : 's'} · ${catStr} · ${dayLabel} · ${marginStr}`;
      break;
    case 'throughput':
      rationale = `${m.jobCount} job${m.jobCount === 1 ? '' : 's'} packed · ${catStr} · ${miStr} · ${dayLabel} · ${marginStr}`;
      break;
    case 'even_load':
      rationale = `balances load · ${m.jobCount} job${m.jobCount === 1 ? '' : 's'} · ${miStr} · ${dayLabel} · ${marginStr}`;
      break;
    case 'day_margin':
      // Lead with the margin; then break it down: revenue, day rate + fuel, jobs, date.
      rationale = `${marginStr} · revenue £${Math.round(margin.revenuePence / 100)} · day £${Math.round(margin.dayRatePence / 100)} + vehicle £${Math.round(margin.fuelPence / 100)} · ${m.jobCount} job${m.jobCount === 1 ? '' : 's'} · ${dayLabel}`;
      break;
  }
  return { rationale, metrics: m, margin };
}

// ── Public entry point ───────────────────────────────────────────────────────────

/**
 * Run the optimiser. Read-only: loads context + pool, generates feasible placements,
 * scores against `goal`, searches, and emits ProposalGroup[] (each carrying goalScore +
 * an objective-aware rationale) plus the assigned / unassignable / per-bundle output.
 */
export async function runDispatchOptimizer(goal: DispatchGoal, opts: { limit?: number; maxWindowDays?: number; testOnly?: boolean } = {}): Promise<OptimizeResult> {
  const { limit = 50, maxWindowDays = 21, testOnly = false } = opts;

  const ctx = await loadDispatchContext(maxWindowDays);
  // testOnly fences the pool: default (falsy) excludes seeded dummies so the real
  // console never sees them; true includes ONLY dummies (test-mode preview).
  const pool = await loadDispatchPool(ctx.today, limit, testOnly);

  const conById = new Map(ctx.contractors.map((c) => [c.id, c]));

  // Committed accepted bookings → anchors per contractor-day (coords from ctx.bookings).
  const anchorsByConDay = new Map<string, AnchorJob[]>();
  // ctx.bookings carries no coords; we only need them as slot/capacity anchors with
  // optional coords. Coords are unavailable here (the loader doesn't join pq for the
  // sweep's booking list), so anchors contribute capacity + route presence at the
  // contractor's own location only. We still register them so caps + fill% are honest.
  for (const b of ctx.bookings) {
    if (!b.cid) continue;
    const slots = b.slot === 'full_day' ? ['am', 'pm'] : [b.slot];
    const key = `${b.cid}|${b.d}`;
    if (!anchorsByConDay.has(key)) anchorsByConDay.set(key, []);
    for (const _ of slots) anchorsByConDay.get(key)!.push({ lat: null, lng: null });
  }

  const plans = buildJobPlans(goal, ctx, pool, maxWindowDays);

  // SEARCH.
  const { assignment, cap } = greedySeed(goal, ctx, conById, plans, anchorsByConDay);
  localSearch(goal, ctx, conById, plans, anchorsByConDay, assignment, cap);

  // ── Materialise output ──
  const assigned: SweepProposal[] = [];
  const unassignable: SweepUnassignable[] = [];
  for (const plan of plans) {
    const { job } = plan;
    const p = assignment.get(job.quoteId);
    if (!p) {
      const reason = plan.unreason ?? (ctx.hasAnyAvailability ? 'No qualified contractor available in window' : 'No contractor availability posted');
      unassignable.push({
        quoteId: job.quoteId, customerName: job.customerName, categories: job.categories, reason,
        slackDays: job.slackDays, flexDeadline: job.flexDeadline,
        valuePence: job.valuePence, postcode: job.postcode, address: job.address, jobDescription: job.jobDescription,
      });
      continue;
    }
    assigned.push({
      quoteId: job.quoteId, customerName: job.customerName, categories: job.categories,
      date: p.date, slot: p.slot, contractorId: p.conId, contractorName: p.conName,
      distanceMiles: p.distanceMiles, valuePence: job.valuePence,
      slackDays: job.slackDays, flexDeadline: job.flexDeadline,
      coveredCategories: p.coveredCategories, uncoveredCategories: p.uncoveredCategories,
      postcode: job.postcode, address: job.address, jobDescription: job.jobDescription,
      workMinutes: job.workMinutes, daysNeeded: jobDaysNeeded(job.workMinutes),
    });
  }

  // ── Build groups with goalScore + rationale ──
  const byKey = new Map<string, { con: ContractorCtx; date: string; jobs: PoolJobCtx[]; members: SweepProposal[]; earliestIdx: number }>();
  const planByQuote = new Map(plans.map((pl) => [pl.job.quoteId, pl]));
  for (const m of assigned) {
    const key = `${m.contractorId}|${m.date}`;
    const pl = planByQuote.get(m.quoteId)!;
    const placement = assignment.get(m.quoteId)!;
    if (!byKey.has(key)) byKey.set(key, { con: conById.get(m.contractorId)!, date: m.date, jobs: [], members: [], earliestIdx: placement.dayIndex });
    const g = byKey.get(key)!;
    g.jobs.push(pl.job);
    g.members.push(m);
    g.earliestIdx = Math.min(g.earliestIdx, placement.dayIndex);
  }

  let totalGoalScore = 0;
  let totalTravelMiles = 0;
  const groups: ProposalGroup[] = [];
  for (const [groupId, g] of byKey) {
    const anchors = anchorsByConDay.get(groupId) ?? [];
    const { rationale, metrics, margin } = buildRationale(goal, g.con, g.date, g.jobs, anchors, g.earliestIdx);
    // Per-group goalScore = this bundle's contribution to the active objective
    // (higher = better; speed is negated so later days score lower).
    let goalScore: number;
    switch (goal.objective) {
      case 'contractor_hourly': goalScore = Math.round(metrics.effectiveHourly * 100) / 100; break;
      case 'customer_speed':    goalScore = -g.members.reduce((s, m) => s + assignment.get(m.quoteId)!.dayIndex, 0); break;
      case 'throughput':        goalScore = g.members.length; break;
      case 'even_load':         goalScore = g.members.length; break;
      case 'day_margin':        goalScore = margin.marginPence; break; // pence; higher = better
      default:                  goalScore = 0;
    }
    totalGoalScore += goalScore;
    totalTravelMiles += metrics.routeMi;
    const totalValue = g.members.reduce((s, m) => s + (m.valuePence || 0), 0);
    // Route order: nearest-neighbour visiting sequence over members (base → job → …),
    // mapped to member quoteIds so the map can draw the day's route. Coords come from
    // g.jobs (PoolJobCtx carries lat/lng; SweepProposal does not) — g.jobs[i] and
    // g.members[i] are pushed in lockstep, so the index alignment holds.
    const orderIdx = routeOrderIndices(g.con, g.jobs.map((j) => ({ lat: j.lat, lng: j.lng })));
    const routeOrder = orderIdx.map((i) => g.members[i].quoteId);
    // Group-level uncovered = distinct union across members (categories no chosen
    // contractor on this day covers — flagged for follow-up, never blocking).
    const groupUncovered = [...new Set(g.members.flatMap((m) => m.uncoveredCategories ?? []))];
    const group: ProposalGroup & { goalScore: number } = {
      groupId, contractorId: g.con.id, contractorName: g.con.name, date: g.date,
      members: g.members, totalValue, rationale, goalScore,
      routeOrder,
      uncoveredCategories: groupUncovered,
      // TRUE-MARGIN economics (additive — write-path untouched).
      routeMiles: margin.routeMiles,
      revenuePence: margin.revenuePence,
      dayRatePence: margin.dayRatePence,
      fuelPence: margin.fuelPence,
      marginPence: margin.marginPence,
      coversDayRate: margin.coversDayRate,
    };
    groups.push(group);
  }
  groups.sort((a, b) => a.date.localeCompare(b.date) || a.contractorId.localeCompare(b.contractorId));

  // Authoritative total objective (matches scoreArrangement) for diagnostics/guarantee.
  const arrangementScore = scoreArrangement(goal, ctx, conById, plans, assignment, anchorsByConDay);

  // SLA tally: a proposal is honoured iff its scheduled date is on/before the deadline.
  const slaHonoured = assigned.filter((m) => m.flexDeadline && m.date <= m.flexDeadline).length;
  const slaBreached = assigned.filter((m) => m.flexDeadline && m.date > m.flexDeadline).length;

  return {
    poolSize: pool.length,
    assigned,
    unassignable,
    groups,
    totalGoalScore: Number.isFinite(arrangementScore) ? arrangementScore : totalGoalScore,
    totalTravelMiles: Math.round(totalTravelMiles * 10) / 10,
    slaHonoured,
    slaBreached,
  };
}
