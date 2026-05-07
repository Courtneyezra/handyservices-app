// server/pay-protection/completion-bonus.ts
//
// Guarantee 7 — all-or-nothing day-pack completion bonus (ADR-007).
//
// Eligibility:
//   completedStops.size === pack.totalStops
//   AND (pickupDone || !pickupRequired)
//
// Carve-outs (count as complete-for-bonus when not contractor's fault):
//   customer_cancelled, weather, missing_materials.
//
// Bonus amount lives on `day_packs.completion_bonus_pence` (Module 06).
// Until that wiring lands populated, we read from dispatch metadata — the
// solver will start writing it there in Phase 5/6 transition.
//
// State-machine hook: when a dispatch's booking enters `paid_out`, the
// orchestrator (or the cron tick fallback) calls `evaluateAndFile`. The
// row is `auto_approved` at write time per spec §4 ("set at write time
// (the row is for audit, not review)"), which lets the contractor app
// surface the bonus payout in the recent-adjustments list.

import { db } from '../db';
import { payAdjustments } from '../../shared/schema';
import { rowToAdjustment, ensureNotDisputed } from './_shared';
import type { FileAdjustmentResult } from './types';

export interface BonusEvaluationInput {
    dispatchId: string;
    contractorId: string;
    /** Total stops in the pack (including the dispatch itself). */
    totalStops: number;
    /** Set of stop ids the contractor marked complete. */
    completedStopIds: string[];
    /** Carve-out stop ids — count as complete-for-bonus. */
    carveoutStopIds?: string[];
    /** Whether materials pickup was required. */
    pickupRequired: boolean;
    /** Whether materials pickup was actually completed. */
    pickupDone: boolean;
    /** Bonus amount (pence) read from `day_packs.completion_bonus_pence`. */
    bonusAmountPence: number;
}

export interface BonusEvaluation {
    eligible: boolean;
    reason: string;
    effectiveStopsDone: number;
    requiredStops: number;
}

export function evaluateBonus(input: BonusEvaluationInput): BonusEvaluation {
    const completed = new Set(input.completedStopIds);
    const carveouts = new Set(input.carveoutStopIds ?? []);
    // A stop in carveouts is treated as complete for bonus purposes.
    const effective = new Set<string>([...completed, ...carveouts]);

    if (effective.size < input.totalStops) {
        return {
            eligible: false,
            reason: `incomplete_stops: ${effective.size}/${input.totalStops}`,
            effectiveStopsDone: effective.size,
            requiredStops: input.totalStops,
        };
    }
    if (input.pickupRequired && !input.pickupDone) {
        return {
            eligible: false,
            reason: 'pickup_not_done',
            effectiveStopsDone: effective.size,
            requiredStops: input.totalStops,
        };
    }
    return {
        eligible: true,
        reason: `all_stops_done (${effective.size}/${input.totalStops}, pickup ${input.pickupDone ? 'done' : 'n/a'})`,
        effectiveStopsDone: effective.size,
        requiredStops: input.totalStops,
    };
}

export async function evaluateAndFile(
    input: BonusEvaluationInput,
): Promise<FileAdjustmentResult | { skipped: true; reason: string }> {
    await ensureNotDisputed(input.dispatchId);

    const evaluation = evaluateBonus(input);
    if (!evaluation.eligible) {
        return { skipped: true, reason: evaluation.reason };
    }

    const [row] = await db
        .insert(payAdjustments)
        .values({
            dispatchId: input.dispatchId,
            unitId: input.contractorId,
            type: 'completion_bonus',
            amountPence: input.bonusAmountPence,
            reason: `completion_bonus | ${evaluation.reason}`,
            evidencePhotos: [],
            status: 'auto_approved',
            resolvedAt: new Date(),
            resolvedBy: 'system',
        })
        .returning();

    // TODO: integrate with payout-engine for ledger crediting. Module 06
    //       writes `day_packs.completion_bonus_pence` at offer time;
    //       once that field is wired in we can populate from there
    //       directly rather than relying on caller-supplied amounts.
    console.log(
        `[pay-protection][completion_bonus] would credit unit=${input.contractorId} dispatch=${input.dispatchId} amount=${input.bonusAmountPence}p (auto_approved)`,
    );

    return {
        adjustment: rowToAdjustment(row, 'completion_bonus'),
        autoApproved: true,
        requiresReview: false,
    };
}
