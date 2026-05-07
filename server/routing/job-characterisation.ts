// server/routing/job-characterisation.ts
//
// Module 05 — Stage 1: Job Characterisation
//
// Pure-ish helper that bundles a `JobProfile` (Module 02) with the timing &
// geography context Stage 2-5 need. Reads only — never edits the quote row.
//
// The orchestrator (Phase 4B) calls this once at pipeline entry. Downstream
// stages treat the returned RoutingContext as immutable.
//
// Refs:
// - docs/architecture/modules/05-routing-engine.md §2 Stage 1
// - server/job-profile.ts (computeJobProfile)

import { computeJobProfile } from '../job-profile';
import {
    type RoutingContext,
    type FlexTier,
    FLEX_WINDOW_DAYS,
} from './types';

const VALID_FLEX_TIERS: readonly FlexTier[] = ['fast', 'flexible', 'relaxed'] as const;

function isFlexTier(value: string): value is FlexTier {
    return (VALID_FLEX_TIERS as readonly string[]).includes(value);
}

/**
 * Build the RoutingContext for a booking about to enter the routing pipeline.
 *
 * Throws on:
 * - quote not found (propagated from `computeJobProfile`)
 * - empty / whitespace `bookingId` or `postcode`
 * - invalid `flexTier` (must be one of fast | flexible | relaxed)
 * - mismatch between `flexTier` and `flexWindowDays` (must equal the
 *   canonical mapping in `FLEX_WINDOW_DAYS`)
 * - profile.crew_size < 1 (defensive — Module 02 already guarantees ≥ 1, but
 *   this stage is the boundary so we re-check)
 * - earliestStart >= latestFinish
 *
 * Note on logging: Stage 1 is preparation. The `lane_selected` decision row
 * is written by Phase 4B's orchestrator after Stage 2 returns; Stage 1 by
 * itself does not write to `routing_decisions`.
 */
export async function characteriseJob(
    bookingId: string,
    quoteId: string,
    postcode: string,
    flexTier: string,
    flexWindowDays: number,
    earliestStart: Date,
    latestFinish: Date,
): Promise<RoutingContext> {
    if (!bookingId || !bookingId.trim()) {
        throw new Error('characteriseJob: bookingId is required');
    }
    if (!quoteId || !quoteId.trim()) {
        throw new Error('characteriseJob: quoteId is required');
    }
    if (!postcode || !postcode.trim()) {
        throw new Error('characteriseJob: postcode is required');
    }
    if (!isFlexTier(flexTier)) {
        throw new Error(
            `characteriseJob: invalid flexTier "${flexTier}" — expected one of ${VALID_FLEX_TIERS.join('|')}`,
        );
    }
    const expectedWindow = FLEX_WINDOW_DAYS[flexTier];
    if (flexWindowDays !== expectedWindow) {
        throw new Error(
            `characteriseJob: flexWindowDays=${flexWindowDays} does not match flexTier="${flexTier}" (expected ${expectedWindow})`,
        );
    }
    if (!(earliestStart instanceof Date) || Number.isNaN(earliestStart.getTime())) {
        throw new Error('characteriseJob: earliestStart must be a valid Date');
    }
    if (!(latestFinish instanceof Date) || Number.isNaN(latestFinish.getTime())) {
        throw new Error('characteriseJob: latestFinish must be a valid Date');
    }
    if (earliestStart.getTime() >= latestFinish.getTime()) {
        throw new Error(
            `characteriseJob: earliestStart (${earliestStart.toISOString()}) must be before latestFinish (${latestFinish.toISOString()})`,
        );
    }

    const profile = await computeJobProfile(quoteId);

    if (profile.crew_size < 1) {
        throw new Error(
            `characteriseJob: profile.crew_size=${profile.crew_size} for quote ${quoteId}; expected ≥ 1`,
        );
    }

    return {
        bookingId,
        quoteId,
        profile,
        postcode: postcode.trim(),
        flexTier,
        flexWindowDays,
        earliestStart,
        latestFinish,
    };
}
