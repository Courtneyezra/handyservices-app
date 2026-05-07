// server/day-pack/release-policy.ts
//
// Module 06 — Day-Pack Solver: release SLA per ADR-007 §release.
//
// Builder pulls a commitment → reliability impact depends on lead-time vs the
// committed date:
//
//   > 48h before date          → free (no penalty)
//   24–48h                     → soft strike (-0.05 reliability)
//   < 24h                      → hard breach (-0.20 reliability + admin alert)
//
// The Builder is allowed one free soft strike per calendar month — the
// orchestrator passes that through to ensure consistent enforcement.

import type { DayCommitment } from './types';

const HOURS_24 = 24 * 60 * 60 * 1000;
const HOURS_48 = 48 * 60 * 60 * 1000;

export type ReleaseImpact =
    | { type: 'free'; reliabilityDelta: 0 }
    | { type: 'soft_strike'; reliabilityDelta: number; freeStrikeUsed: boolean }
    | { type: 'hard_breach'; reliabilityDelta: number };

export interface ReleaseImpactOptions {
    /** Already-used free soft-strike count in the current calendar month. */
    monthlyFreeSoftStrikesUsed?: number;
}

const SOFT_DELTA = -0.05;
const HARD_DELTA = -0.20;

/**
 * Compute the reliability impact of releasing this commitment at `releaseAt`.
 * The first soft strike each calendar month is free (Builder consumed it
 * already → soft strike applies normally).
 */
export function computeReleaseImpact(
    commitment: DayCommitment,
    releaseAt: Date,
    options: ReleaseImpactOptions = {},
): ReleaseImpact {
    const commitDate = new Date(`${commitment.date}T00:00:00`);
    const leadMs = commitDate.getTime() - releaseAt.getTime();

    if (leadMs > HOURS_48) {
        return { type: 'free', reliabilityDelta: 0 };
    }
    if (leadMs > HOURS_24) {
        const freeUsed = (options.monthlyFreeSoftStrikesUsed ?? 0) >= 1;
        return {
            type: 'soft_strike',
            reliabilityDelta: freeUsed ? SOFT_DELTA : 0,
            freeStrikeUsed: freeUsed,
        };
    }
    return { type: 'hard_breach', reliabilityDelta: HARD_DELTA };
}

export const __test__ = {
    HOURS_24,
    HOURS_48,
    SOFT_DELTA,
    HARD_DELTA,
};
