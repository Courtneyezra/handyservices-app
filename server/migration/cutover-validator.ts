// server/migration/cutover-validator.ts
//
// Module 11 — pre-cutover safety check.
//
// Phase 9 of the rollout flips FF_LEGACY_BRIDGE OFF. Before that flag
// flip happens, an admin runs `validateCutoverReadiness()` and reviews
// the report. Every assertion must pass (or be explicitly waived) before
// the cutover proceeds — flipping the flag is a one-way decision (legacy
// rows go stale and cannot be retro-synced cheaply).
//
// This module DOES NOT auto-flip the flag. It only reports.
//
// Cross-references:
//   docs/architecture/modules/11-migration.md §7 (Phase 9 cutover)
//   docs/architecture/cutover-playbook.md (Phase I)

import { db } from '../db';
import { sql, isNull, and, gte, isNotNull } from 'drizzle-orm';
import {
    handymanProfiles,
    routingOffers,
    routingDecisions,
    dayPacks,
    payAdjustments,
    jobDispatches,
    contractorBookingRequests,
} from '@shared/schema';
import { getRecentWriteWindowCounts } from './legacy-bridge';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CutoverCheck {
    name: string;
    status: CheckStatus;
    details: string;
}

export interface CutoverReport {
    ready: boolean;            // true when all checks pass (warn allowed)
    checks: CutoverCheck[];
    generatedAt: Date;
}

const DUAL_WRITE_MIN_DAYS = 30;

// ---------------------------------------------------------------------------
// Individual checks — each returns a CutoverCheck.
// ---------------------------------------------------------------------------

/**
 * Check 1: dual-write window. Both tables must have been receiving writes
 * for at least 30 days. We sample row counts in the recent window and
 * verify the canonical side is non-empty AND the legacy side is non-empty.
 */
async function checkDualWriteWindow(): Promise<CutoverCheck> {
    try {
        const { canonicalRows, legacyRows } =
            await getRecentWriteWindowCounts(DUAL_WRITE_MIN_DAYS);

        if (canonicalRows === 0) {
            return {
                name: 'dual_write_window',
                status: 'warn',
                details: `No job_dispatches rows in last ${DUAL_WRITE_MIN_DAYS}d. Routing engine may not be live.`,
            };
        }
        if (legacyRows === 0) {
            return {
                name: 'dual_write_window',
                status: 'fail',
                details: `Legacy table has zero writes in last ${DUAL_WRITE_MIN_DAYS}d. Bridge may be off already; cannot verify.`,
            };
        }
        return {
            name: 'dual_write_window',
            status: 'pass',
            details: `${DUAL_WRITE_MIN_DAYS}d window: canonical=${canonicalRows}, legacy=${legacyRows}.`,
        };
    } catch (err) {
        return {
            name: 'dual_write_window',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Check 2: no active disputes referencing legacy-only fields. If any
 * dispute is open and lives only in contractor_booking_requests
 * (no matching job_dispatch), retiring the legacy table would orphan it.
 */
async function checkNoActiveLegacyDisputes(): Promise<CutoverCheck> {
    try {
        const result: any = await db.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM contractor_booking_requests cbr
            WHERE cbr.status IN ('pending', 'accepted')
              AND NOT EXISTS (
                SELECT 1 FROM job_dispatches jd WHERE jd.id = cbr.id
              )
        `);
        const row = (result.rows ?? result)[0];
        const orphans = Number(row?.count ?? 0);
        if (orphans === 0) {
            return {
                name: 'no_active_legacy_disputes',
                status: 'pass',
                details: 'No legacy-only active bookings.',
            };
        }
        return {
            name: 'no_active_legacy_disputes',
            status: 'fail',
            details: `${orphans} active legacy bookings without a canonical mirror. Migrate or close before cutover.`,
        };
    } catch (err) {
        return {
            name: 'no_active_legacy_disputes',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Check 3: in-flight bookings present in BOTH tables (no orphans). For
 * every active job_dispatch, verify a legacy mirror exists. Failure
 * indicates the bridge missed writes; reconcile before flipping.
 */
async function checkInFlightParity(): Promise<CutoverCheck> {
    try {
        const result: any = await db.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM job_dispatches jd
            WHERE jd.status IN ('pending', 'accepted', 'in_progress')
              AND jd.locked_to_contractor_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM contractor_booking_requests cbr WHERE cbr.id = jd.id
              )
        `);
        const row = (result.rows ?? result)[0];
        const orphans = Number(row?.count ?? 0);
        if (orphans === 0) {
            return {
                name: 'in_flight_parity',
                status: 'pass',
                details: 'All in-flight canonical dispatches mirror to legacy.',
            };
        }
        return {
            name: 'in_flight_parity',
            status: 'fail',
            details: `${orphans} in-flight canonical dispatches lack legacy mirror. Run reconcile before cutover.`,
        };
    } catch (err) {
        return {
            name: 'in_flight_parity',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Check 4: handyman_profiles.contractor_segment non-null for active
 * contractors. Routing engine refuses to consider null-segment units;
 * leaving them null means they'd be invisible post-cutover.
 */
async function checkContractorSegmentsAssigned(): Promise<CutoverCheck> {
    try {
        const rows = await db.select({ id: handymanProfiles.id })
            .from(handymanProfiles)
            .where(isNull(handymanProfiles.contractorSegment));
        const count = rows.length;
        if (count === 0) {
            return {
                name: 'contractor_segments_assigned',
                status: 'pass',
                details: 'All contractors have a segment.',
            };
        }
        return {
            name: 'contractor_segments_assigned',
            status: 'warn',
            details: `${count} contractors have NULL segment. Run backfillContractorSegments() to default to gap_filler.`,
        };
    } catch (err) {
        return {
            name: 'contractor_segments_assigned',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Check 5: routing tables have data. If routing_offers and
 * routing_decisions are empty, the routing engine has not exercised
 * meaningfully — cutover would push live traffic onto unproven code.
 */
async function checkRoutingActive(): Promise<CutoverCheck> {
    try {
        const offers = await db.select({ id: routingOffers.id }).from(routingOffers).limit(1);
        const decisions = await db.select({ id: routingDecisions.id }).from(routingDecisions).limit(1);
        const offerCount = offers.length;
        const decisionCount = decisions.length;
        if (offerCount > 0 && decisionCount > 0) {
            return {
                name: 'routing_active',
                status: 'pass',
                details: 'routing_offers and routing_decisions both populated.',
            };
        }
        return {
            name: 'routing_active',
            status: 'fail',
            details: `routing_offers=${offerCount}, routing_decisions=${decisionCount}. Engine has not run.`,
        };
    } catch (err) {
        return {
            name: 'routing_active',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Check 6: at least 1 day_pack accepted. Confirms the day-pack solver
 * is live and Builders are accepting packs.
 */
async function checkDayPackAccepted(): Promise<CutoverCheck> {
    try {
        const rows = await db.select({ id: dayPacks.id })
            .from(dayPacks)
            .where(isNotNull(dayPacks.acceptedAt))
            .limit(1);
        if (rows.length > 0) {
            return {
                name: 'day_pack_accepted',
                status: 'pass',
                details: 'At least one day_pack accepted.',
            };
        }
        return {
            name: 'day_pack_accepted',
            status: 'warn',
            details: 'No day_pack accepted yet. Cutover OK if not running Builder lane in production.',
        };
    } catch (err) {
        return {
            name: 'day_pack_accepted',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

/**
 * Check 7: at least 1 pay_adjustments row. Confirms pay-protection
 * workflows have fired at least once.
 */
async function checkPayProtectionActive(): Promise<CutoverCheck> {
    try {
        const rows = await db.select({ id: payAdjustments.id }).from(payAdjustments).limit(1);
        if (rows.length > 0) {
            return {
                name: 'pay_protection_active',
                status: 'pass',
                details: 'pay_adjustments has rows.',
            };
        }
        return {
            name: 'pay_protection_active',
            status: 'warn',
            details: 'No pay_adjustments rows yet. Cutover OK if pay protection is intentionally idle.',
        };
    } catch (err) {
        return {
            name: 'pay_protection_active',
            status: 'fail',
            details: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function validateCutoverReadiness(): Promise<CutoverReport> {
    const checks = await Promise.all([
        checkDualWriteWindow(),
        checkNoActiveLegacyDisputes(),
        checkInFlightParity(),
        checkContractorSegmentsAssigned(),
        checkRoutingActive(),
        checkDayPackAccepted(),
        checkPayProtectionActive(),
    ]);

    const ready = checks.every(c => c.status !== 'fail');
    return { ready, checks, generatedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Pretty-printer for CLI runs.
// ---------------------------------------------------------------------------

export function formatCutoverReport(report: CutoverReport): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('=== CUTOVER READINESS REPORT ===');
    lines.push(`Generated: ${report.generatedAt.toISOString()}`);
    lines.push(`Ready: ${report.ready ? 'YES' : 'NO'}`);
    lines.push('');
    for (const c of report.checks) {
        const tag = c.status === 'pass' ? '[PASS]' : c.status === 'warn' ? '[WARN]' : '[FAIL]';
        lines.push(`${tag} ${c.name} — ${c.details}`);
    }
    lines.push('');
    if (!report.ready) {
        lines.push('Resolve all FAIL checks before flipping FF_LEGACY_BRIDGE off.');
    }
    return lines.join('\n');
}

// Suppress unused-import warning — these may be needed by future checks.
void and; void gte; void jobDispatches; void contractorBookingRequests;
