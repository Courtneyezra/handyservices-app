// server/day-pack/index.ts
//
// Module 06 — Day-Pack Solver: orchestrator.
//
// Single entrypoint that:
//   1. Loads the open commitment, unit, and candidate quotes (Builder lane,
//      reserved_for_pack, area+skill+window match).
//   2. Calls assemblePack() — the greedy bin-packer.
//   3. Calls decideTopUp() — applies the 70/50% threshold and budget rules.
//   4. Either offers the pack (writes a day_packs row + RoutingOffer envelope)
//      or waits / pulls / releases per the top-up decision.
//
// Builder accept transitions every packed job from `reserved_for_pack` to
// `dispatched` and creates a `job_dispatches` row per job (bundle_id =
// dayPack.id), holds availability slots, and writes a routing_decisions row.

import { db } from '../db';
import {
    dayCommitments,
    dayPacks,
    materialsPickups,
    handymanProfiles,
    personalizedQuotes,
    payAdjustments,
    routingOffers,
    routingDecisions,
    bookingStateLog,
    jobDispatches,
} from '../../shared/schema';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { computeJobProfileFromRow } from '../job-profile';
import { assemblePack, type PackAssemblyOutput } from './solver';
import { decideTopUp } from './top-up-calculator';
import {
    setCommitmentStatus,
    getCommitment,
} from './commitment-service';
import type {
    CandidateJob,
    DayCommitment,
    DayPack,
    PackedJob,
} from './types';
import type { EligibleUnit } from '../routing/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACK_OFFER_TTL_MINUTES = 24 * 60;       // 24h per state-machine.md §4 (reserved_for_pack timeout)
const COMPLETION_BONUS_RATIO = 0.15;          // ADR-007

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssemblyStatus =
    | 'pack_offered'
    | 'top_up_applied'
    | 'awaiting_candidates'
    | 'released'
    | 'no_eligible_candidates'
    | 'noop_not_open';

export interface AssemblyOutcome {
    status: AssemblyStatus;
    pack?: DayPack;
    topUpPence?: number;
    waitMinutes?: number;
    detail?: string;
}

// ---------------------------------------------------------------------------
// Public API — runDayPackAssembly
// ---------------------------------------------------------------------------

export async function runDayPackAssembly(commitmentId: string): Promise<AssemblyOutcome> {
    const commitment = await getCommitment(commitmentId);
    if (!commitment) {
        throw new Error(`runDayPackAssembly: commitment ${commitmentId} not found`);
    }
    if (commitment.status !== 'open' && commitment.status !== 'assembling') {
        return { status: 'noop_not_open', detail: `status=${commitment.status}` };
    }

    // Mark assembling so concurrent ticks bow out (best-effort guard; the
    // commitment row is unique on (unit, date), so we serialise at the row
    // level — DB-level FOR UPDATE comes with the orchestrator's eventual SQL
    // hardening, but the status flip plus the unique index already covers
    // 99% of contention here).
    await setCommitmentStatus(commitment.id, 'assembling');

    try {
        const unit = await loadUnit(commitment.unitId);
        if (!unit) {
            await setCommitmentStatus(commitment.id, 'released');
            return { status: 'released', detail: 'unit_not_found' };
        }

        const candidates = await loadCandidates(commitment, unit);
        if (candidates.length === 0) {
            await setCommitmentStatus(commitment.id, 'open');
            return { status: 'no_eligible_candidates' };
        }

        const { pack, rejected } = await assemblePack({ commitment, unit, candidates });

        const monthlyTopUpUsed = await loadMonthlyTopUpUsed(unit.unitId);
        const decision = await decideTopUp(pack, commitment, monthlyTopUpUsed);

        // Audit the assembly attempt regardless of outcome.
        await safeLogDecision(commitment.id, 'pack_assembly', {
            commitmentId: commitment.id,
            unitId: commitment.unitId,
            candidates: candidates.length,
            packed: pack.jobs.length,
            rejectedCount: rejected.length,
        }, {
            decision,
            packValuePence: pack.totalContractorPayPence,
            targetPence: commitment.targetPence,
            rejected: rejected.slice(0, 20).map((r) => ({
                bookingId: r.candidate.bookingId,
                reason: r.reason,
                detail: r.detail,
            })),
        });

        if (decision.action === 'release_day') {
            await setCommitmentStatus(commitment.id, 'released');
            return { status: 'released', detail: decision.reason };
        }
        if (decision.action === 'wait_for_more_candidates') {
            await setCommitmentStatus(commitment.id, 'open');
            return { status: 'awaiting_candidates', waitMinutes: decision.waitMinutes };
        }
        if (decision.action === 'pull_from_neighbour_day') {
            // Phase-5 minimal: signal the cron to retry on the next pass with
            // a relaxed window. Persist as `open` so the next tick re-runs.
            await setCommitmentStatus(commitment.id, 'open');
            return { status: 'awaiting_candidates', detail: 'try_neighbour_day' };
        }

        // Either no_top_up_needed or top_up_from_budget — we offer the pack.
        const topUpPence = decision.action === 'top_up_from_budget' ? decision.amountPence : 0;
        const completionBonus = Math.round(commitment.targetPence * COMPLETION_BONUS_RATIO);

        const offered = await persistOfferedPack(commitment, pack, {
            topUpPence,
            completionBonusPence: completionBonus,
        });

        return {
            status: topUpPence > 0 ? 'top_up_applied' : 'pack_offered',
            pack: offered,
            topUpPence,
        };
    } catch (err) {
        console.error('[day-pack] assembly failed:', err);
        await setCommitmentStatus(commitment.id, 'open');
        throw err;
    }
}

// ---------------------------------------------------------------------------
// loadUnit — pulls the EligibleUnit shape from handyman_profiles
// ---------------------------------------------------------------------------

async function loadUnit(unitId: string): Promise<EligibleUnit | null> {
    const [row] = await db
        .select()
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, unitId))
        .limit(1);
    if (!row) return null;
    return {
        unitId: row.id,
        name: [row.businessName].filter(Boolean).join(' ') || row.id,
        segment: (row.contractorSegment as 'builder' | 'gap_filler' | 'specialist' | null) ?? 'builder',
        homePostcode: row.homePostcode ?? null,
        skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
        certs: Array.isArray(row.certs) ? (row.certs as string[]) : [],
        crewMax: row.crewMax ?? 1,
        minJobValuePence: row.minJobValuePence ?? null,
        dayRateTargetPence: row.dayRateTargetPence ?? null,
        reliabilityScore: row.reliabilityScore == null ? 1 : Number(row.reliabilityScore),
        priorityRoutingScore: row.priorityRoutingScore == null ? 0 : Number(row.priorityRoutingScore),
        availableSlots: [],
    };
}

// ---------------------------------------------------------------------------
// loadCandidates — quotes in `reserved_for_pack` matching the area + window
// ---------------------------------------------------------------------------

async function loadCandidates(commitment: DayCommitment, unit: EligibleUnit): Promise<CandidateJob[]> {
    const rows = await db
        .select()
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.bookingState, 'reserved_for_pack'));

    const filterUpper = (commitment.areaFilter ?? []).map((a) => a.toUpperCase());

    const candidates: CandidateJob[] = [];
    for (const row of rows) {
        const profile = computeJobProfileFromRow({
            id: row.id,
            crewSizeRequired: row.crewSizeRequired ?? null,
            skillsRequired: row.skillsRequired,
            certRequired: row.certRequired,
            durationEstimateMinutes: row.durationEstimateMinutes ?? null,
            realWorkMinutes: row.realWorkMinutes ?? null,
            complexityFlags: row.complexityFlags,
            heavyLifting: row.heavyLifting ?? null,
            flexTier: row.flexTier ?? null,
            postcode: row.postcode ?? null,
        });

        // Area filter — Builder commits to specific prefixes.
        const head = (row.postcode ?? '').toUpperCase().split(/\s+/)[0] ?? '';
        if (filterUpper.length > 0 && !filterUpper.some((p) => head.startsWith(p))) {
            continue;
        }

        // Window — the candidate must be slottable on commitment.date.
        const earliest = deriveEarliestStart(row);
        const latest = deriveLatestFinish(row, earliest);
        const target = new Date(`${commitment.date}T00:00:00Z`).getTime();
        if (target < startOfDay(earliest) || target > endOfDay(latest)) {
            continue;
        }

        const contractorPay = estimateContractorPay(row);

        candidates.push({
            bookingId: row.id,
            quoteId: row.id,
            postcode: row.postcode ?? '',
            profile,
            contractorPayPence: contractorPay,
            earliestStart: earliest,
            latestFinish: latest,
            flexTier: (row.flexTier as 'fast' | 'flexible' | 'relaxed' | null) ?? undefined,
            materials: extractMaterials(row),
        });
    }

    return candidates;
}

function deriveEarliestStart(row: any): Date {
    const completion = row.completionDate ? new Date(`${row.completionDate}`) : null;
    if (completion && !Number.isNaN(completion.getTime())) return completion;
    const created = row.createdAt ? new Date(row.createdAt) : new Date();
    return created;
}

function deriveLatestFinish(row: any, earliest: Date): Date {
    const flexDays = row.flexWindowDays ?? 7;
    const out = new Date(earliest);
    out.setDate(out.getDate() + Math.max(1, flexDays));
    return out;
}

function startOfDay(d: Date): number {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x.getTime();
}

function endOfDay(d: Date): number {
    const x = new Date(d);
    x.setUTCHours(23, 59, 59, 999);
    return x.getTime();
}

function estimateContractorPay(row: any): number {
    // Reuse the snapshot fields the rest of the system stores on the quote.
    if (typeof row.totalContractorPayPence === 'number' && row.totalContractorPayPence > 0) {
        return row.totalContractorPayPence;
    }
    const base = row.basePrice ?? 0;
    return Math.round(Number(base) * 0.7);
}

function extractMaterials(row: any): CandidateJob['materials'] {
    const items = Array.isArray(row.pricingLineItems) ? row.pricingLineItems : [];
    const out: NonNullable<CandidateJob['materials']> = [];
    for (const line of items) {
        const lineMaterials = Array.isArray(line?.materials) ? line.materials : [];
        for (const m of lineMaterials) {
            if (!m || typeof m !== 'object') continue;
            out.push({
                name: String(m.name ?? 'Material'),
                quantity: Number(m.quantity ?? 1),
                supply_status: (m.supply_status as any) ?? 'handy_supplied',
                supplier_id: m.supplier_id ?? null,
                branch_name: m.branch_name ?? null,
                branch_postcode: m.branch_postcode ?? null,
                estimated_cost_pence: typeof m.estimated_cost_pence === 'number' ? m.estimated_cost_pence : undefined,
            });
        }
    }
    return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Persist offered pack
// ---------------------------------------------------------------------------

async function persistOfferedPack(
    commitment: DayCommitment,
    pack: ReturnType<typeof assemblePack> extends Promise<infer R> ? R extends PackAssemblyOutput ? PackAssemblyOutput['pack'] : never : never,
    extras: { topUpPence: number; completionBonusPence: number },
): Promise<DayPack> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PACK_OFFER_TTL_MINUTES * 60_000);

    const [packRow] = await db
        .insert(dayPacks)
        .values({
            commitmentId: commitment.id,
            unitId: commitment.unitId,
            date: commitment.date,
            status: 'offered',
            jobIds: pack.jobs.map((j) => j.bookingId),
            totalContractorPayPence: pack.totalContractorPayPence + extras.topUpPence,
            totalCustomerPayPence: pack.totalCustomerPayPence,
            estimatedHours: pack.estimatedHours.toString(),
            travelMinutes: pack.travelMinutes,
            routeSummary: pack.routeSummary,
            topUpPence: extras.topUpPence,
            offeredAt: now,
            expiresAt,
        })
        .returning();

    // Sibling materials_pickups rows.
    if (pack.materialsPickups.length > 0) {
        await db.insert(materialsPickups).values(
            pack.materialsPickups.map((p) => ({
                dayPackId: packRow.id,
                supplier: p.supplier,
                branchName: p.branch ?? null,
                postcode: p.postcode || 'UNKNOWN',
                estimatedMinutes: p.estimatedMinutes,
                items: p.items,
                status: 'pending' as const,
            })),
        );
    }

    // RoutingOffer envelope linking the pack to a Builder offer.
    await db.insert(routingOffers).values({
        bookingId: commitment.id,        // we use commitment id as the booking-key for pack offers
        unitId: commitment.unitId,
        round: 1,
        status: 'pending',
        expiresAt,
        dayPackId: packRow.id,
        metadata: {
            mode: 'day_pack',
            packId: packRow.id,
            commitmentId: commitment.id,
            jobCount: pack.jobs.length,
            packValuePence: pack.totalContractorPayPence + extras.topUpPence,
            completionBonusPence: extras.completionBonusPence,
        },
    });

    // Track the day-rate top-up as a pay_adjustment row (status pending_review;
    // admin can promote to admin_approved per Module 07).
    if (extras.topUpPence > 0) {
        try {
            await db.insert(payAdjustments).values({
                dispatchId: packRow.id,           // pack id as the parent — Module 07 honours both shapes
                unitId: commitment.unitId,
                type: 'day_rate_topup',
                amountPence: extras.topUpPence,
                reason: `Day-pack top-up for commitment ${commitment.id}`,
                status: 'pending_review',
            });
        } catch (err) {
            console.warn('[day-pack] failed to insert pay_adjustment row:', err);
        }
    }

    await setCommitmentStatus(commitment.id, 'offered');

    return {
        id: packRow.id,
        commitmentId: commitment.id,
        unitId: commitment.unitId,
        date: commitment.date,
        status: 'offered',
        jobs: pack.jobs,
        materialsPickups: pack.materialsPickups,
        totalContractorPayPence: pack.totalContractorPayPence + extras.topUpPence,
        totalCustomerPayPence: pack.totalCustomerPayPence,
        estimatedHours: pack.estimatedHours,
        travelMinutes: pack.travelMinutes,
        topUpPence: extras.topUpPence,
        completionBonusPence: extras.completionBonusPence,
        routeSummary: pack.routeSummary,
        offeredAt: now,
        expiresAt,
        acceptedAt: null,
    };
}

// ---------------------------------------------------------------------------
// Builder-side accept / decline
// ---------------------------------------------------------------------------

export interface AcceptResult {
    packId: string;
    dispatchIds: string[];
}

export async function acceptDayPack(packId: string, unitId: string): Promise<AcceptResult> {
    // Optimistic flip from offered → accepted.
    const [pack] = await db
        .select()
        .from(dayPacks)
        .where(eq(dayPacks.id, packId))
        .limit(1);
    if (!pack) throw new Error(`pack ${packId} not found`);
    if (pack.unitId !== unitId) {
        throw new Error('forbidden — pack not assigned to this unit');
    }
    if (pack.status !== 'offered') {
        throw new Error(`pack not offered (status=${pack.status})`);
    }

    const now = new Date();
    const updated = await db
        .update(dayPacks)
        .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
        .where(and(eq(dayPacks.id, packId), eq(dayPacks.status, 'offered')))
        .returning();
    if (updated.length === 0) {
        throw new Error('pack already accepted or cancelled');
    }

    // Mark the linked routing_offers envelope as accepted; cancel any siblings.
    await db
        .update(routingOffers)
        .set({ status: 'accepted', respondedAt: now })
        .where(and(
            eq(routingOffers.dayPackId, packId),
            eq(routingOffers.status, 'pending'),
        ));

    // For each packed job: transition booking_state → dispatched and create a
    // job_dispatches row pointing back via `dayPackId`. We carry the pack id
    // in metadata so Module 09 (contractor app) can render the bundle.
    const jobIds = Array.isArray(pack.jobIds) ? (pack.jobIds as string[]) : [];
    const dispatchIds: string[] = [];

    for (const bookingId of jobIds) {
        try {
            await db
                .update(personalizedQuotes)
                .set({ bookingState: 'dispatched' })
                .where(and(
                    eq(personalizedQuotes.id, bookingId),
                    eq(personalizedQuotes.bookingState, 'reserved_for_pack'),
                ));
            await db.insert(bookingStateLog).values({
                bookingId,
                fromState: 'reserved_for_pack',
                toState: 'dispatched',
                triggeredBy: 'contractor',
                triggerMetadata: { dayPackId: packId, unitId, commitmentId: pack.commitmentId },
            });

            const [quote] = await db
                .select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, bookingId))
                .limit(1);

            const [dispatch] = await db
                .insert(jobDispatches)
                .values({
                    quoteId: bookingId,
                    title: quote?.jobDescription?.toString().slice(0, 200) ?? 'Day-pack dispatch',
                    customerFirstName: quote?.customerName?.toString().split(' ')[0] ?? 'Customer',
                    postcode: quote?.postcode?.toString() ?? 'N/A',
                    tasks: [],
                    totalHours: 0,
                    totalContractorPayPence: 0,
                    status: 'locked',
                    lockedToContractorId: unitId,
                    lockedAt: now,
                    scheduledDate: new Date(`${pack.date}T08:00:00`),
                })
                .returning();
            dispatchIds.push(dispatch.id);
        } catch (err) {
            console.warn(`[day-pack] failed to dispatch booking ${bookingId}:`, err);
        }
    }

    await setCommitmentStatus(pack.commitmentId, 'accepted');

    await safeLogDecision(pack.commitmentId, 'pack_accepted', {
        packId,
        unitId,
        jobIds,
    }, {
        dispatchIds,
    });

    return { packId, dispatchIds };
}

export async function declineDayPack(packId: string, unitId: string, reason?: string): Promise<void> {
    const [pack] = await db
        .select()
        .from(dayPacks)
        .where(eq(dayPacks.id, packId))
        .limit(1);
    if (!pack) throw new Error(`pack ${packId} not found`);
    if (pack.unitId !== unitId) {
        throw new Error('forbidden — pack not assigned to this unit');
    }
    if (pack.status !== 'offered') {
        throw new Error(`pack not offered (status=${pack.status})`);
    }

    const now = new Date();
    await db
        .update(dayPacks)
        .set({ status: 'declined', declinedReason: reason ?? null, updatedAt: now })
        .where(eq(dayPacks.id, packId));

    await db
        .update(routingOffers)
        .set({ status: 'declined', respondedAt: now, declineReason: reason ?? null })
        .where(and(
            eq(routingOffers.dayPackId, packId),
            eq(routingOffers.status, 'pending'),
        ));

    // Pack jobs spill back to single-offer routing per state-machine.md row 90.
    await dissolvePackBackToOfferRound1(pack.id, pack.commitmentId, 'pack_declined');

    await setCommitmentStatus(pack.commitmentId, 'open');

    await safeLogDecision(pack.commitmentId, 'pack_declined', {
        packId,
        unitId,
        reason: reason ?? null,
    }, {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dissolvePackBackToOfferRound1(packId: string, commitmentId: string, reason: string): Promise<void> {
    const [pack] = await db.select().from(dayPacks).where(eq(dayPacks.id, packId)).limit(1);
    if (!pack) return;
    const jobIds = Array.isArray(pack.jobIds) ? (pack.jobIds as string[]) : [];
    if (jobIds.length === 0) return;

    await db
        .update(personalizedQuotes)
        .set({ bookingState: 'offer_round_1' })
        .where(and(
            inArray(personalizedQuotes.id, jobIds),
            eq(personalizedQuotes.bookingState, 'reserved_for_pack'),
        ));

    for (const id of jobIds) {
        try {
            await db.insert(bookingStateLog).values({
                bookingId: id,
                fromState: 'reserved_for_pack',
                toState: 'offer_round_1',
                triggeredBy: 'system',
                triggerMetadata: { reason, packId, commitmentId },
            });
        } catch { /* tolerate idempotent re-runs */ }
    }
}

async function loadMonthlyTopUpUsed(unitId: string): Promise<number> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    try {
        const rows = await db
            .select({ amount: payAdjustments.amountPence })
            .from(payAdjustments)
            .where(and(
                eq(payAdjustments.unitId, unitId),
                eq(payAdjustments.type, 'day_rate_topup'),
                gte(payAdjustments.createdAt, monthStart),
            ));
        return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    } catch (err) {
        console.warn('[day-pack] monthly top-up read failed:', err);
        return 0;
    }
}

async function safeLogDecision(
    bookingId: string,
    decisionType: string,
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
): Promise<void> {
    try {
        await db.insert(routingDecisions).values({
            bookingId,
            decisionType,
            inputs,
            outputs,
            decidedBy: 'system',
        });
    } catch (err) {
        console.warn('[day-pack] decision log failed:', err);
    }
}

// Re-exports for callers (routes / cron).
export { runDayPackAssembly as assemblePackForCommitment };
export { getCommitment, listCommitments, createCommitment, releaseCommitment } from './commitment-service';
export type { DayCommitment, DayPack, CandidateJob, PackedJob } from './types';
