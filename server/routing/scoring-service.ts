// server/routing/scoring-service.ts
//
// Module 05 — Stage 4: Scoring & ranking.
//
// Pure-ish service: takes Stage 3's eligible-units list and returns the same
// units annotated with a deterministic score and component breakdown, sorted
// DESC. Per ADR-002 the entire scoring formula is server-side opaque — we
// never echo raw weight values to the contractor app.
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §6 (16 weight keys)
// - docs/architecture/feature-flags.md (advisory mode: weights all 0)
// - docs/architecture/adrs/adr-002-pay-model.md
// - docs/architecture/adrs/adr-006-travel-time-engine.md

import { db } from '../db';
import { routingWeights } from '../../shared/schema';
import { and, isNull, lte, gt, or, sql } from 'drizzle-orm';
import type { EligibleUnit, RoutingContext } from './types';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface ScoredUnit extends EligibleUnit {
    score: number;
    scoreBreakdown: Record<string, number>;
}

export type WeightKey =
    | 'proximity'
    | 'reliability'
    | 'customer_rating'
    | 'pipeline_balance'
    | 'job_fit'
    | 'flex_window_match'
    | 'cert_premium'
    | 'overload_penalty'
    | 'distance_penalty'
    | 'recent_decline'
    | 'tenure_bonus'
    | 'multi_skill_bonus'
    | 'same_area_bonus'
    | 'bond_paid_bonus'
    | 'early_response'
    | 'pack_fit_bonus';

export type WeightTable = Record<WeightKey, number>;

// Module 05 §6 default weights. 16 keys total — positive lifts + four
// penalties + four tie-break bonuses. Tunable per row in `routing_weights`.
export const DEFAULT_WEIGHTS: WeightTable = {
    proximity:           30,
    reliability:         25,
    customer_rating:     15,
    pipeline_balance:    10,
    job_fit:             10,
    flex_window_match:   5,
    cert_premium:        5,
    // Penalties (negative magnitudes — applied as +W * negative score):
    overload_penalty:    -20,
    distance_penalty:    -15,
    recent_decline:      -10,
    // Tie-breakers:
    tenure_bonus:        3,
    multi_skill_bonus:   2,
    same_area_bonus:     2,
    bond_paid_bonus:     1,
    early_response:      1,
    pack_fit_bonus:      5,
};

// ---------------------------------------------------------------------------
// Weight table loader
// ---------------------------------------------------------------------------

/**
 * Load the live weight table from `routing_weights`. The schema stores one
 * row per key with `effective_from`/`effective_to` windows so tuning is a
 * pure INSERT and rollbacks are timestamp tweaks.
 *
 * Falls back to DEFAULT_WEIGHTS for any key without a live row. This keeps
 * fresh installs (no rows seeded) functional out of the box.
 *
 * The keys in DB are the spec's `score.<name>` form (Module 05 §8) — we
 * tolerate either the prefixed or bare form so the seed migration and the
 * code agree without churn.
 */
export async function loadWeights(now: Date = new Date()): Promise<WeightTable> {
    const rows = await db
        .select()
        .from(routingWeights)
        .where(
            and(
                lte(routingWeights.effectiveFrom, now),
                or(
                    isNull(routingWeights.effectiveTo),
                    gt(routingWeights.effectiveTo, now),
                ),
            ),
        );

    const out: WeightTable = { ...DEFAULT_WEIGHTS };
    for (const row of rows) {
        const key = normaliseKey(row.weightKey);
        if (key && key in out) {
            const value = Number(row.weightValue);
            if (Number.isFinite(value)) {
                out[key] = value;
            }
        }
    }
    return out;
}

function normaliseKey(raw: string): WeightKey | null {
    const stripped = raw.replace(/^score\./, '').replace(/^eligibility\./, '').replace(/^offer\./, '');
    // Map a couple of legacy names from Module 05 §8 to the WeightKey enum.
    const aliases: Record<string, WeightKey> = {
        proximity_weight: 'proximity',
        reliability_weight: 'reliability',
        customer_rating_weight: 'customer_rating',
        pipeline_balance_weight: 'pipeline_balance',
        job_fit_weight: 'job_fit',
        tenure_weight: 'tenure_bonus',
        stacking_weight: 'pack_fit_bonus',
        recent_decline_penalty: 'recent_decline',
        overload: 'overload_penalty',
    };
    if (stripped in aliases) return aliases[stripped];
    if ((stripped as WeightKey) in DEFAULT_WEIGHTS) return stripped as WeightKey;
    return null;
}

// ---------------------------------------------------------------------------
// Component sub-scores — each returns 0..1 (penalties are 0..1 magnitudes,
// the negative weight does the sign-flip).
// ---------------------------------------------------------------------------

function proximityScore(unit: EligibleUnit, ctx: RoutingContext): number {
    if (!unit.homePostcode || !ctx.postcode) return 0.5;
    const a = areaOf(unit.homePostcode);
    const b = areaOf(ctx.postcode);
    if (!a || !b) return 0.5;
    if (a === b) return 1.0;            // same outward code (e.g. NG7)
    // Same district group (first 1-2 letters) — coarse fallback while
    // ADR-006's Distance Matrix cache is offline.
    const aL = a.replace(/[0-9]+$/, '');
    const bL = b.replace(/[0-9]+$/, '');
    if (aL === bL) return 0.5;
    return 0.2;
}

function distancePenalty(unit: EligibleUnit, ctx: RoutingContext): number {
    // 1.0 magnitude when *worse* than 15-mile threshold; 0 otherwise.
    // Approximation: anything outside the area-letter group is "far".
    if (!unit.homePostcode || !ctx.postcode) return 0;
    const a = areaOf(unit.homePostcode)?.replace(/[0-9]+$/, '');
    const b = areaOf(ctx.postcode)?.replace(/[0-9]+$/, '');
    if (a && b && a === b) return 0;
    return 1.0;
}

function reliabilityScore(unit: EligibleUnit): number {
    // Already 0..1 in the schema (`reliability_score decimal(3,2)`).
    const v = Number(unit.reliabilityScore);
    if (!Number.isFinite(v)) return 0.7; // floor matches eligibility default
    return Math.max(0, Math.min(1, v));
}

function customerRatingScore(unit: EligibleUnit): number {
    // Placeholder — ADR-002 keeps this pluggable until Module 09 lands real
    // 30-day rolling ratings. We map priorityRoutingScore (which schema
    // stores as decimal 5,2) to 0..1 as a stop-gap.
    const v = Number(unit.priorityRoutingScore);
    if (!Number.isFinite(v)) return 0.5;
    return Math.max(0, Math.min(1, v / 100));
}

function jobFitScore(unit: EligibleUnit, ctx: RoutingContext): number {
    const want = ctx.profile.skills;
    if (want.length === 0) return 0.5;
    const have = unit.skills;
    const overlap = want.filter((s) => have.includes(s)).length;
    return overlap / want.length;
}

function flexWindowMatchScore(unit: EligibleUnit, ctx: RoutingContext): number {
    // Wider flex windows score higher when the unit has lots of slots in
    // window — broader supply, easier to land. Bound 0..1.
    const slotCount = unit.availableSlots.filter((s) => s.status === 'available').length;
    if (ctx.flexWindowDays <= 1) {
        // Fast: slot count matters less; first-available wins.
        return slotCount > 0 ? 1.0 : 0;
    }
    return Math.min(1, slotCount / ctx.flexWindowDays);
}

function certPremiumScore(unit: EligibleUnit, ctx: RoutingContext): number {
    if (ctx.profile.certs.length === 0) return 0;
    return unit.certs.length > 0 ? 1.0 : 0;
}

function pipelineBalanceScore(unit: EligibleUnit): number {
    // Stub: priorityRoutingScore inverted as a proxy for "under-utilised".
    // Higher priority_routing_score historically == more recent assignments,
    // so we invert. Module 03 will migrate this to a recent-assignments count.
    const v = Number(unit.priorityRoutingScore);
    if (!Number.isFinite(v)) return 0.5;
    return Math.max(0, 1 - Math.min(1, v / 100));
}

function overloadPenalty(unit: EligibleUnit): number {
    // 1.0 magnitude if priorityRoutingScore is "high" (>=70 — proxy for
    // recently overloaded). Replaces with weekly slot count when Module 04
    // exposes capacity stats.
    const v = Number(unit.priorityRoutingScore);
    if (!Number.isFinite(v)) return 0;
    return v >= 70 ? 1.0 : 0;
}

function recentDeclinePenalty(_unit: EligibleUnit): number {
    // TODO: Module 05 §6 — pull from routing_decisions where decision_type
    // = 'offer_declined' AND unit_id = X AND decided_at > now()-7d. Until
    // we run for a week, no signal exists. Stage 3 already filters recent
    // decline of *this booking*, so this is a separate cross-booking lookback.
    return 0;
}

function tenureBonus(unit: EligibleUnit): number {
    // Without a `created_at` on EligibleUnit (Phase 4A's contract), we treat
    // priorityRoutingScore != null as a tenure proxy — a unit the engine has
    // already seen rounds for.
    return Number.isFinite(Number(unit.priorityRoutingScore)) ? 1.0 : 0;
}

function multiSkillBonus(unit: EligibleUnit): number {
    if (unit.skills.length >= 3) return 1.0;
    if (unit.skills.length === 2) return 0.5;
    return 0;
}

function sameAreaBonus(unit: EligibleUnit, ctx: RoutingContext): number {
    if (!unit.homePostcode || !ctx.postcode) return 0;
    return areaOf(unit.homePostcode) === areaOf(ctx.postcode) ? 1.0 : 0;
}

function bondPaidBonus(_unit: EligibleUnit): number {
    // Stub — schema doesn't yet expose bond status on the unit shape; left
    // as 0 until Phase 6 surfaces it. Tie-breaker only.
    return 0;
}

function earlyResponseScore(_unit: EligibleUnit): number {
    // Stub — no historical accept-time signal yet. Tie-breaker only.
    return 0;
}

function packFitBonus(_unit: EligibleUnit, ctx: RoutingContext): number {
    // Builder-lane only — gives weight to units that fit into an existing
    // day-pack. Module 06 owns the inverse computation; until we have a
    // pack reference here, return 0 outside the Builder lane.
    return ctx.profile.complexity_flags.includes('builder_eligible') ? 0.5 : 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function areaOf(postcode: string): string | null {
    const t = postcode.trim().toUpperCase();
    if (!t) return null;
    const space = t.indexOf(' ');
    if (space > 0) return t.slice(0, space);
    return t.slice(0, Math.min(4, t.length));
}

// ---------------------------------------------------------------------------
// scoreUnits — main entrypoint
// ---------------------------------------------------------------------------

/**
 * Score every eligible unit and return them sorted DESC. Stable tie-break:
 *   primary: score
 *   secondary: priorityRoutingScore (higher first)
 *   tertiary: unitId (lexicographic — deterministic)
 *
 * Advisory mode: when every weight is 0, every unit returns score=0 with the
 * full breakdown so observers can see *what* the engine evaluated even though
 * the orchestrator suppresses offer fan-out.
 */
export async function scoreUnits(
    ctx: RoutingContext,
    eligibleUnits: EligibleUnit[],
): Promise<ScoredUnit[]> {
    const weights = await loadWeights();
    return scoreUnitsWith(ctx, eligibleUnits, weights);
}

/**
 * Pure variant — pass the weight table in. Used by tests.
 */
export function scoreUnitsWith(
    ctx: RoutingContext,
    eligibleUnits: EligibleUnit[],
    weights: WeightTable,
): ScoredUnit[] {
    const scored: ScoredUnit[] = eligibleUnits.map((unit) => {
        const breakdown: Record<string, number> = {
            proximity:         weights.proximity         * proximityScore(unit, ctx),
            reliability:       weights.reliability       * reliabilityScore(unit),
            customer_rating:   weights.customer_rating   * customerRatingScore(unit),
            pipeline_balance:  weights.pipeline_balance  * pipelineBalanceScore(unit),
            job_fit:           weights.job_fit           * jobFitScore(unit, ctx),
            flex_window_match: weights.flex_window_match * flexWindowMatchScore(unit, ctx),
            cert_premium:      weights.cert_premium      * certPremiumScore(unit, ctx),
            overload_penalty:  weights.overload_penalty  * overloadPenalty(unit),
            distance_penalty:  weights.distance_penalty  * distancePenalty(unit, ctx),
            recent_decline:    weights.recent_decline    * recentDeclinePenalty(unit),
            tenure_bonus:      weights.tenure_bonus      * tenureBonus(unit),
            multi_skill_bonus: weights.multi_skill_bonus * multiSkillBonus(unit),
            same_area_bonus:   weights.same_area_bonus   * sameAreaBonus(unit, ctx),
            bond_paid_bonus:   weights.bond_paid_bonus   * bondPaidBonus(unit),
            early_response:    weights.early_response    * earlyResponseScore(unit),
            pack_fit_bonus:    weights.pack_fit_bonus    * packFitBonus(unit, ctx),
        };
        const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
        return { ...unit, score, scoreBreakdown: breakdown };
    });

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const pa = Number(a.priorityRoutingScore) || 0;
        const pb = Number(b.priorityRoutingScore) || 0;
        if (pb !== pa) return pb - pa;
        return a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0;
    });

    return scored;
}

/**
 * True when every weight in the table is exactly 0 — Module 05's "advisory
 * mode" knob. The orchestrator inspects this and skips the offer fan-out
 * step while still recording the would-be decisions.
 */
export function isAdvisoryMode(weights: WeightTable): boolean {
    return Object.values(weights).every((w) => w === 0);
}
