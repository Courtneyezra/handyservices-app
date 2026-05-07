// server/day-pack/top-up-calculator.ts
//
// Module 06 — Day-Pack Solver: top-up logic per spec §6 + §11.
//
// Decision tree:
//
//   pack value ≥ 70% target          → no_top_up_needed (offer as-is)
//   50–70% AND > 48h before date     → wait_for_more_candidates
//   50–70% AND < 48h before date     → pull_from_neighbour_day
//   50–70% AND no neighbours useable → top_up_from_budget   (capped £200/Builder/month)
//   pack value < 50%                 → release_day
//   monthly cap exhausted in budget  → release_day (instead of top-up)
//
// The orchestrator handles persistence; this module is pure computation.

import type { DayCommitment, DayPack } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACK_OK_RATIO = 0.70;       // ≥70% target → offer as-is
const PACK_RELEASE_RATIO = 0.50;  // <50% target → release day
const HOURS_48 = 48 * 60 * 60 * 1000;
const MONTHLY_TOP_UP_CAP_PENCE = 20_000;   // £200 per Builder/month

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopUpDecision =
    | { action: 'no_top_up_needed' }
    | { action: 'wait_for_more_candidates'; waitMinutes: number }
    | { action: 'pull_from_neighbour_day'; days: number }
    | { action: 'top_up_from_budget'; amountPence: number }
    | { action: 'release_day'; reason: string };

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export async function decideTopUp(
    pack: DayPack,
    commitment: DayCommitment,
    monthlyTopUpUsedPence: number,
    now: Date = new Date(),
): Promise<TopUpDecision> {
    const target = commitment.targetPence;
    if (target <= 0) {
        return { action: 'no_top_up_needed' };
    }

    const value = pack.totalContractorPayPence;
    const ratio = value / target;

    if (ratio >= PACK_OK_RATIO) {
        return { action: 'no_top_up_needed' };
    }

    if (ratio < PACK_RELEASE_RATIO) {
        return {
            action: 'release_day',
            reason: `pack_value_below_${Math.round(PACK_RELEASE_RATIO * 100)}pct`,
        };
    }

    // 50–70% region. Branch by lead-time.
    const commitDate = new Date(`${commitment.date}T00:00:00`);
    const leadMs = commitDate.getTime() - now.getTime();

    if (leadMs > HOURS_48) {
        // Plenty of runway — don't top up yet; wait for the next assembly tick.
        return {
            action: 'wait_for_more_candidates',
            waitMinutes: Math.min(360, Math.round(leadMs / (60 * 1000) / 2)),
        };
    }

    // < 48h; try the neighbour-day swap first (orchestrator implements the
    // candidate retry; we just signal intent + days to inspect).
    if (leadMs > 0) {
        return { action: 'pull_from_neighbour_day', days: 1 };
    }

    // Day already started or passed (edge) — fall through to budget top-up.
    const shortfall = target - value;
    const remainingBudget = Math.max(0, MONTHLY_TOP_UP_CAP_PENCE - monthlyTopUpUsedPence);

    if (remainingBudget <= 0) {
        return {
            action: 'release_day',
            reason: 'monthly_top_up_cap_exhausted',
        };
    }
    if (shortfall > remainingBudget) {
        return {
            action: 'release_day',
            reason: 'top_up_exceeds_remaining_budget',
        };
    }

    return { action: 'top_up_from_budget', amountPence: shortfall };
}

// Helper exposed so tests + the cron tick can opt into the budget branch
// without going through the full decision tree.
export function topUpBudgetRemaining(monthlyTopUpUsedPence: number): number {
    return Math.max(0, MONTHLY_TOP_UP_CAP_PENCE - monthlyTopUpUsedPence);
}

export const __test__ = {
    PACK_OK_RATIO,
    PACK_RELEASE_RATIO,
    MONTHLY_TOP_UP_CAP_PENCE,
    HOURS_48,
};
