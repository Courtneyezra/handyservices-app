// server/migration/legacy-bridge.ts
//
// Module 11 — Migration & Compatibility Shim.
//
// Per ADR-001 + Module 11, the v2 system treats `jobDispatches` as the single
// canonical store for contractor work assignment. The legacy
// `contractorBookingRequests` table is still read by `/admin/daily-planner`
// during the Phase 0-8 rollout. This bridge mirrors every canonical write
// into the legacy table so the planner keeps working unchanged.
//
// IMPORTANT — one-way decision:
//   Turning FF_LEGACY_BRIDGE OFF stops mirroring. Legacy rows go stale; new
//   v2 dispatches will NOT appear in the daily planner. This is the Phase 9
//   cutover; reverting OFF → ON later cannot recover the gap. See Module 11
//   §10 (Rollback) and §7 (Phase 9 cutover).
//
// Design rules:
//   * One-way: canonical → legacy. New code never reads
//     `contractorBookingRequests`.
//   * Idempotent: insert uses ON CONFLICT DO NOTHING; updates are naturally
//     idempotent (overwrite-with-same-value is fine).
//   * Failure-soft: a bridge error must NEVER block a canonical write. We
//     log a warning and swallow.
//   * Pre-accept broadcasts (lockedToContractorId IS NULL) are NOT bridged
//     — legacy has no concept of an unaccepted offer.
//
// Cross-references:
//   docs/architecture/modules/11-migration.md (full spec)
//   docs/architecture/adrs/adr-001-legacy-table.md
//   docs/architecture/feature-flags.md (FF_LEGACY_BRIDGE row)

import { db } from '../db';
import { eq, sql } from 'drizzle-orm';
import {
    contractorBookingRequests,
    type JobDispatch,
} from '@shared/schema';
import { FLAGS } from '../feature-flags';

// ---------------------------------------------------------------------------
// Status mapping — jobDispatches.status → contractor_booking_requests.{status,assignmentStatus}
// ---------------------------------------------------------------------------

type LegacyStatusPair = {
    status: string;            // 'pending' | 'accepted' | 'declined' | 'completed'
    assignmentStatus: string;  // 'unassigned' | 'assigned' | 'accepted' | ...
};

function mapDispatchStatus(dispatchStatus: string | null | undefined,
                           hasContractor: boolean): LegacyStatusPair {
    // Module 11 §4 + §5 mapping. Pre-assigned-to-contractor bridge does not
    // fire; once it does, we mirror through the bridge state machine.
    switch (dispatchStatus) {
        case 'accepted':
            return { status: 'accepted', assignmentStatus: 'accepted' };
        case 'in_progress':
            return { status: 'accepted', assignmentStatus: 'in_progress' };
        case 'completed':
            return { status: 'completed', assignmentStatus: 'completed' };
        case 'cancelled':
            return { status: 'declined', assignmentStatus: 'rejected' };
        case 'pending':
        default:
            // We only bridge dispatches that have a contractor locked, so
            // 'pending' here means assigned-but-not-yet-accepted.
            return {
                status: 'pending',
                assignmentStatus: hasContractor ? 'assigned' : 'unassigned',
            };
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeName(d: JobDispatch): string {
    return (d.customerFullName ?? d.customerFirstName ?? 'Customer').toString();
}

function logBridgeFailure(op: string, dispatchId: string, err: unknown): void {
    // Bridge failures must never bubble. We log loudly so ops can spot drift
    // — Module 11 reconcile script will catch any mirror gaps before cutover.
    console.warn(`[legacy-bridge] ${op} failed for dispatch ${dispatchId}: ${
        err instanceof Error ? err.message : String(err)
    }`);
}

// ---------------------------------------------------------------------------
// Public API — one function per canonical lifecycle event
// ---------------------------------------------------------------------------

/**
 * Mirror a newly-created or newly-locked dispatch into the legacy table.
 *
 * Skipped when:
 *   - FF_LEGACY_BRIDGE is OFF (cutover-or-later)
 *   - dispatch has no lockedToContractorId (pre-accept broadcast — legacy
 *     has no concept of an unclaimed offer; we mirror on first accept)
 *
 * Idempotent — safe to call multiple times. ON CONFLICT DO NOTHING means
 * a re-call is a no-op rather than a duplicate row.
 */
export async function dualWriteOnDispatchCreate(dispatch: JobDispatch): Promise<void> {
    if (!FLAGS.LEGACY_BRIDGE) return;
    if (!dispatch.lockedToContractorId) return;

    const { status, assignmentStatus } = mapDispatchStatus(dispatch.status, true);

    try {
        await db.insert(contractorBookingRequests).values({
            id: dispatch.id,                                    // re-use dispatch PK
            quoteId: dispatch.quoteId ?? null,
            contractorId: dispatch.lockedToContractorId,
            assignedContractorId: dispatch.lockedToContractorId,
            customerName: safeName(dispatch),
            customerEmail: null,                                // not on dispatch
            customerPhone: dispatch.customerPhone ?? null,
            description: dispatch.subtitle ?? '[v2 dispatch]',
            scheduledDate: dispatch.scheduledDate ?? null,
            requestedDate: dispatch.scheduledDate ?? null,
            requestedSlot: null,                                // legacy stores '09:00 - 11:00'-style strings; v2 uses scheduledDate
            assignmentStatus,
            status,
            assignedAt: dispatch.lockedAt ?? new Date(),
            acceptedAt: dispatch.status === 'accepted' || dispatch.status === 'in_progress'
                ? (dispatch.lockedAt ?? new Date())
                : null,
            createdAt: dispatch.createdAt ?? new Date(),
        }).onConflictDoNothing();
    } catch (err) {
        logBridgeFailure('dualWriteOnDispatchCreate', dispatch.id, err);
    }
}

/**
 * Mirror a status/lifecycle update into the legacy row.
 *
 * Idempotent. If the legacy row is missing (e.g. dispatch was created
 * before the bridge was deployed), this is a no-op — the reconcile script
 * surfaces those gaps separately.
 */
export async function dualWriteOnDispatchUpdate(dispatch: JobDispatch): Promise<void> {
    if (!FLAGS.LEGACY_BRIDGE) return;
    if (!dispatch.lockedToContractorId) return;

    const { status, assignmentStatus } = mapDispatchStatus(dispatch.status, true);

    try {
        // First try to update an existing row.
        const updateValues: Record<string, unknown> = {
            status,
            assignmentStatus,
            assignedContractorId: dispatch.lockedToContractorId,
            scheduledDate: dispatch.scheduledDate ?? null,
            updatedAt: new Date(),
        };
        if (dispatch.status === 'accepted' || dispatch.status === 'in_progress') {
            updateValues.acceptedAt = dispatch.lockedAt ?? new Date();
        }
        if (dispatch.status === 'completed') {
            updateValues.completedAt = dispatch.completedAt ?? new Date();
        }

        const result = await db.update(contractorBookingRequests)
            .set(updateValues as any)
            .where(eq(contractorBookingRequests.id, dispatch.id))
            .returning({ id: contractorBookingRequests.id });

        // Self-heal: if the legacy row never existed (bridge was off when
        // create fired), create it now. Insert is idempotent.
        if (result.length === 0) {
            await dualWriteOnDispatchCreate(dispatch);
        }
    } catch (err) {
        logBridgeFailure('dualWriteOnDispatchUpdate', dispatch.id, err);
    }
}

/**
 * Bridge cancellation. Legacy row is NEVER deleted (audit preservation).
 */
export async function dualWriteOnDispatchCancel(
    dispatch: JobDispatch,
    reason: string,
): Promise<void> {
    if (!FLAGS.LEGACY_BRIDGE) return;
    if (!dispatch.lockedToContractorId) return;

    try {
        await db.update(contractorBookingRequests)
            .set({
                status: 'declined',
                assignmentStatus: 'rejected',
                declineReason: 'other',
                declineNotes: reason,
                rejectedAt: new Date(),
                updatedAt: new Date(),
            } as any)
            .where(eq(contractorBookingRequests.id, dispatch.id));
    } catch (err) {
        logBridgeFailure('dualWriteOnDispatchCancel', dispatch.id, err);
    }
}

/**
 * Day-pack bridge. The solver assigns one Builder unit to N jobs. Legacy
 * has no pack concept — we write N rows (one per job in the pack) so the
 * daily planner shows each job individually.
 *
 * Per Module 11 §6: "Pack identity is lost on the legacy side."
 */
export async function dualWriteOnDayPackAssigned(
    dispatchIds: string[],
): Promise<void> {
    if (!FLAGS.LEGACY_BRIDGE) return;
    // Caller hydrates each dispatch via dualWriteOnDispatchCreate; this
    // wrapper exists so day-pack call-sites can express intent clearly.
    // No additional work needed beyond what dualWriteOnDispatchCreate does
    // per dispatch.
    void dispatchIds;
}

// ---------------------------------------------------------------------------
// Diagnostic helper — used by cutover-validator.ts
// ---------------------------------------------------------------------------

/**
 * Returns true iff a legacy row exists for this dispatch id.
 * Read-only; safe to call regardless of flag state.
 */
export async function hasLegacyMirror(dispatchId: string): Promise<boolean> {
    const rows = await db
        .select({ id: contractorBookingRequests.id })
        .from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, dispatchId))
        .limit(1);
    return rows.length > 0;
}

/**
 * Counts of recent writes on both sides — used by the cutover validator to
 * confirm dual-write has been live long enough.
 */
export async function getRecentWriteWindowCounts(daysBack: number): Promise<{
    canonicalRows: number;
    legacyRows: number;
}> {
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const canonicalResult: any = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM job_dispatches WHERE created_at >= ${cutoff}`,
    );
    const legacyResult: any = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM contractor_booking_requests WHERE created_at >= ${cutoff}`,
    );
    // drizzle-orm/node-postgres returns { rows: [...] }; some setups return the array directly.
    const canonicalRow = (canonicalResult.rows ?? canonicalResult)[0];
    const legacyRow = (legacyResult.rows ?? legacyResult)[0];
    return {
        canonicalRows: Number(canonicalRow?.count ?? 0),
        legacyRows: Number(legacyRow?.count ?? 0),
    };
}
