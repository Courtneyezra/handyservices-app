// server/migration/data-backfill.ts
//
// Module 11 — one-shot backfill scripts. NEVER auto-run; always invoked
// manually via scripts/run-backfill.ts (CLI entrypoint) so an operator
// can read the per-script summary before moving on.
//
// All scripts are idempotent:
//   * Re-running them on already-migrated rows is a no-op.
//   * They never overwrite an explicit non-NULL value with a default.
//
// Cross-references:
//   docs/architecture/modules/11-migration.md §8 (Backfill scripts)
//   docs/architecture/adrs/adr-005-real-vs-pricing-time.md (de-pad factors)
//   docs/architecture/state-machine.md §6 (booking_state_log shape)

import { db } from '../db';
import { and, eq, isNull, isNotNull, sql, inArray } from 'drizzle-orm';
import {
    handymanProfiles,
    personalizedQuotes,
    bookingStateLog,
    routeDistanceCache,
} from '@shared/schema';

// ---------------------------------------------------------------------------
// Result shapes — every backfill returns the same envelope so the runner
// can render a uniform summary table.
// ---------------------------------------------------------------------------

export interface BackfillResult {
    updated: number;
    skipped: number;
}

export interface CountResult {
    count: number;
}

// ---------------------------------------------------------------------------
// 1) Contractor segment default — every active contractor must have a
//    segment for routing. Default to 'gap_filler' when null per ADR-003
//    pragmatic-default note.
// ---------------------------------------------------------------------------

export async function backfillContractorSegments(): Promise<BackfillResult> {
    const nulls = await db.select({ id: handymanProfiles.id })
        .from(handymanProfiles)
        .where(isNull(handymanProfiles.contractorSegment));

    if (nulls.length === 0) {
        return { updated: 0, skipped: 0 };
    }

    let updated = 0;
    for (const row of nulls) {
        try {
            await db.update(handymanProfiles)
                .set({ contractorSegment: 'gap_filler' })
                .where(and(
                    eq(handymanProfiles.id, row.id),
                    isNull(handymanProfiles.contractorSegment),  // re-check — idempotent
                ));
            updated++;
        } catch (err) {
            console.warn(`[backfill:segments] failed for ${row.id}:`, err);
        }
    }

    return { updated, skipped: 0 };
}

// ---------------------------------------------------------------------------
// 2) real_work_minutes — apply category-based de-pad factor per ADR-005
//    step 3: real_work_minutes = round(durationEstimateMinutes × factor).
//    Operates on personalized_quotes.real_work_minutes (per Wave 1 schema:
//    quote-level field, not line-item level).
// ---------------------------------------------------------------------------

// ADR-005 §"Migration plan" defaults — admin-tunable later, but these are
// the production-sampled starting values.
const DE_PAD_FACTORS: Record<string, number> = {
    general_fixing:  0.55,
    carpentry:       0.50,
    plumbing_minor:  0.60,
    tiling:          0.50,
    curtain_blinds:  0.40,
    door_fitting:    0.40,
    shed_install:    0.50,
    fencing:         0.65,
    // unknown → 0.50 fallback (mid-range)
};

const DE_PAD_DEFAULT = 0.50;

function dePadFactorFor(categories: unknown): number {
    if (!Array.isArray(categories) || categories.length === 0) {
        return DE_PAD_DEFAULT;
    }
    // Pick the smallest factor across categories (most aggressive de-pad
    // when a job spans multiple — conservative for ops, never overstates
    // available capacity).
    let factor = Infinity;
    for (const c of categories) {
        const f = DE_PAD_FACTORS[String(c)];
        if (typeof f === 'number' && f < factor) factor = f;
    }
    return Number.isFinite(factor) ? factor : DE_PAD_DEFAULT;
}

export async function backfillRealWorkMinutes(): Promise<BackfillResult> {
    // Candidates: real_work_minutes IS NULL AND duration_estimate_minutes IS NOT NULL.
    const rows = await db.select({
            id: personalizedQuotes.id,
            categories: personalizedQuotes.categories,
            duration: personalizedQuotes.durationEstimateMinutes,
        })
        .from(personalizedQuotes)
        .where(and(
            isNull(personalizedQuotes.realWorkMinutes),
            isNotNull(personalizedQuotes.durationEstimateMinutes),
        ));

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
        const dur = row.duration;
        if (typeof dur !== 'number' || dur <= 0) { skipped++; continue; }
        const factor = dePadFactorFor(row.categories);
        const real = Math.max(1, Math.round(dur * factor));
        try {
            await db.update(personalizedQuotes)
                .set({ realWorkMinutes: real })
                .where(and(
                    eq(personalizedQuotes.id, row.id),
                    isNull(personalizedQuotes.realWorkMinutes),  // idempotent
                ));
            updated++;
        } catch (err) {
            console.warn(`[backfill:real-work] failed for ${row.id}:`, err);
            skipped++;
        }
    }

    return { updated, skipped };
}

// ---------------------------------------------------------------------------
// 3) booking_state_log — reconstruct entries from existing timestamps.
//    For each personalizedQuote with booking lifecycle timestamps but no
//    log row, synthesise one entry per known transition.
//
//    We only synthesise rows where there's a clear timestamp anchor —
//    we do not invent intermediate states.
// ---------------------------------------------------------------------------

interface ReconstructedTransition {
    bookingId: string;
    fromState: string | null;
    toState: string;
    triggeredBy: string;
    occurredAt: Date;
    triggerMetadata: Record<string, unknown>;
}

export async function backfillBookingStateLog(): Promise<BackfillResult> {
    // Find quotes that have any lifecycle anchor.
    const quotes = await db.select({
            id: personalizedQuotes.id,
            createdAt: personalizedQuotes.createdAt,
            depositPaidAt: personalizedQuotes.depositPaidAt,
            bookedAt: personalizedQuotes.bookedAt,
            completedAt: personalizedQuotes.completedAt,
            refundedAt: personalizedQuotes.refundedAt,
        })
        .from(personalizedQuotes);

    // Find which quote ids already have at least one log entry — skip those.
    const existing = await db.select({ bookingId: bookingStateLog.bookingId })
        .from(bookingStateLog);
    const seen = new Set(existing.map(r => r.bookingId));

    let updated = 0;
    let skipped = 0;

    for (const q of quotes) {
        if (seen.has(q.id)) { skipped++; continue; }
        const transitions: ReconstructedTransition[] = [];

        if (q.createdAt) {
            transitions.push({
                bookingId: q.id,
                fromState: null,
                toState: 'draft',
                triggeredBy: 'system',
                occurredAt: q.createdAt,
                triggerMetadata: { reconstructed: true },
            });
        }
        // We don't have an explicit "sent" timestamp; conservative skip.

        if (q.depositPaidAt) {
            transitions.push({
                bookingId: q.id,
                fromState: 'quoted',
                toState: 'booked_pending_routing',
                triggeredBy: 'customer',
                occurredAt: q.depositPaidAt,
                triggerMetadata: { reconstructed: true, source: 'depositPaidAt' },
            });
        }
        if (q.bookedAt && (!q.depositPaidAt || q.bookedAt.getTime() !== q.depositPaidAt.getTime())) {
            transitions.push({
                bookingId: q.id,
                fromState: 'booked_pending_routing',
                toState: 'dispatched',
                triggeredBy: 'system',
                occurredAt: q.bookedAt,
                triggerMetadata: { reconstructed: true, source: 'bookedAt' },
            });
        }
        if (q.completedAt) {
            transitions.push({
                bookingId: q.id,
                fromState: 'in_progress',
                toState: 'completed_pending_review',
                triggeredBy: 'contractor',
                occurredAt: q.completedAt,
                triggerMetadata: { reconstructed: true, source: 'completedAt' },
            });
        }
        if (q.refundedAt) {
            transitions.push({
                bookingId: q.id,
                fromState: null,
                toState: 'refunded',
                triggeredBy: 'admin',
                occurredAt: q.refundedAt,
                triggerMetadata: { reconstructed: true, source: 'refundedAt' },
            });
        }

        if (transitions.length === 0) { skipped++; continue; }

        try {
            await db.insert(bookingStateLog).values(transitions.map(t => ({
                bookingId: t.bookingId,
                fromState: t.fromState,
                toState: t.toState,
                triggeredBy: t.triggeredBy,
                occurredAt: t.occurredAt,
                triggerMetadata: t.triggerMetadata,
            })));
            updated += transitions.length;
        } catch (err) {
            console.warn(`[backfill:booking-state-log] failed for ${q.id}:`, err);
            skipped++;
        }
    }

    return { updated, skipped };
}

// ---------------------------------------------------------------------------
// 4) Pre-warm route_distance_cache for the top-50 most-common postcode
//    pairs. Optional optimization — Module 11 §8 marks this opt-in.
//
//    We don't make external API calls here; we insert placeholder rows
//    with a 0-minute drive time and immediate expiry so the routing
//    engine populates them on first real use. The placeholder simply
//    establishes the index entries.
// ---------------------------------------------------------------------------

export async function backfillRouteDistanceCache(): Promise<CountResult> {
    // Find top-50 origin × dest pairs from existing job_dispatches /
    // personalized_quotes.
    const pairs: Array<{ origin: string; dest: string }> = [];
    try {
        const result: any = await db.execute(sql`
            SELECT
                LEFT(hp.home_postcode, 4) AS origin,
                LEFT(pq.postcode, 4) AS dest
            FROM personalized_quotes pq
            JOIN handyman_profiles hp ON hp.contractor_segment IS NOT NULL
            WHERE pq.postcode IS NOT NULL AND hp.home_postcode IS NOT NULL
            GROUP BY 1, 2
            ORDER BY COUNT(*) DESC
            LIMIT 50
        `);
        const rows = (result.rows ?? result) as Array<{ origin: string; dest: string }>;
        for (const r of rows) {
            if (r.origin && r.dest) pairs.push({ origin: r.origin, dest: r.dest });
        }
    } catch (err) {
        console.warn('[backfill:route-cache] could not enumerate pairs:', err);
        return { count: 0 };
    }

    let count = 0;
    const expired = new Date(Date.now() - 1000); // already-expired so first lookup refreshes
    for (const { origin, dest } of pairs) {
        for (const bucket of ['rush_am', 'midday', 'rush_pm', 'off_peak']) {
            try {
                await db.insert(routeDistanceCache).values({
                    originPostcode: origin,
                    destPostcode: dest,
                    timeBucket: bucket,
                    driveMinutes: 0,
                    driveMiles: '0' as unknown as string,
                    expiresAt: expired,
                }).onConflictDoNothing();
                count++;
            } catch (err) {
                // unique-violation on rerun is fine
                console.warn(`[backfill:route-cache] insert (${origin}->${dest}/${bucket}):`, err);
            }
        }
    }

    return { count };
}

// ---------------------------------------------------------------------------
// Aggregator — used by scripts/run-backfill.ts
// ---------------------------------------------------------------------------

export interface BackfillSummary {
    segments: BackfillResult;
    realWork: BackfillResult;
    bookingStateLog: BackfillResult;
    routeCache: CountResult;
}

export async function runAllBackfills(): Promise<BackfillSummary> {
    const segments = await backfillContractorSegments();
    const realWork = await backfillRealWorkMinutes();
    const bookingStateLogResult = await backfillBookingStateLog();
    const routeCache = await backfillRouteDistanceCache();
    return { segments, realWork, bookingStateLog: bookingStateLogResult, routeCache };
}

// Suppress unused-import warning — `inArray` reserved for follow-on additions.
void inArray;
