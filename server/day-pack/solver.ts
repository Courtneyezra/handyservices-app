// server/day-pack/solver.ts
//
// Module 06 — Day-Pack Solver: greedy bin-packer.
//
// Given a Builder day-commitment, the unit's row, and a candidate quote pool,
// we walk the candidates in best-fit-first order and run five canAdd()
// constraints per Module 06 §5:
//
//   1. Skill match    — unit.skills ⊇ candidate.profile.skills
//   2. Time fit       — running real_work_minutes + travel + setup/cleanup +
//                       pickup minutes + 30-min trailing margin ≤ commitment window
//   3. Proximity hub  — drive distance from unit home to candidate ≤ 8 miles
//   4. Proximity chain— drive minutes from previous stop ≤ 25 min
//   5. Customer window— candidate's flex window contains commitment.date
//
// Materials are aggregated by supplier into MaterialsPickupSummary[] (ADR-008
// — 30 min for the first pickup, +15 min per additional supplier).
//
// The solver returns the pack PLUS a rejection log so admins / Module 08
// surfaces can render "why job X was skipped".
//
// Refs:
// - docs/architecture/modules/06-day-pack-solver.md §3-6
// - docs/architecture/adrs/adr-005-real-vs-pricing-time.md (real_work_minutes only)
// - docs/architecture/adrs/adr-006-travel-time-engine.md (mobilisation + return)
// - docs/architecture/adrs/adr-008-materials-collection.md (pickup aggregation)

import {
    getDriveTime,
    getMobilisationDrive,
    isChainable,
    isWithinHub,
} from './proximity';
import type { EligibleUnit } from '../routing/types';
import type {
    CandidateJob,
    DayCommitment,
    DayPack,
    MaterialsPickupSummary,
    PackedJob,
    PackRejection,
} from './types';

// ---------------------------------------------------------------------------
// Tunables — see Module 06 §5 + ADR-006/008
// ---------------------------------------------------------------------------

const SETUP_MINUTES_PER_JOB = 12;       // ADR-005 §schema-impact
const CLEANUP_MINUTES_PER_JOB = 15;     // ADR-005 §schema-impact
const PICKUP_FIRST_MINUTES = 30;        // ADR-008
const PICKUP_ADDITIONAL_MINUTES = 15;   // ADR-008
const TRAILING_MARGIN_MINUTES = 30;     // Module 06 §5.2 — protects last-job overrun
const PACK_FULL_VALUE_RATIO = 1.10;     // Stop adding once value ≥ 110% target

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PackAssemblyInput {
    commitment: DayCommitment;
    unit: EligibleUnit;
    candidates: CandidateJob[];
}

export interface PackAssemblyOutput {
    pack: DayPack;
    rejected: PackRejection[];
}

/**
 * Drive the greedy bin-packer over a candidate set.
 * Pure-ish — does NOT persist; the orchestrator handles writes.
 */
export async function assemblePack(input: PackAssemblyInput): Promise<PackAssemblyOutput> {
    const { commitment, unit, candidates } = input;

    const ordered = sortCandidates(candidates, commitment);

    const packed: PackedJob[] = [];
    const rejected: PackRejection[] = [];

    const windowMinutes = computeWindowMinutes(commitment.startTime, commitment.endTime);

    // Running cursor for plannedStart; advances as we add jobs.
    const dayBase = parseDateAtTime(commitment.date, commitment.startTime);

    let totalContractorPay = 0;
    let totalCustomerPay = 0;
    let totalTravelMinutes = 0;
    let totalTravelMiles = 0;

    for (const candidate of ordered) {
        // Stop early if pack is already at value cap.
        if (totalContractorPay >= commitment.targetPence * PACK_FULL_VALUE_RATIO) {
            rejected.push({ candidate, reason: 'pack_full_at_value' });
            continue;
        }

        // ── 1. Skill ─────────────────────────────────────────────────────
        if (!hasRequiredSkills(unit, candidate)) {
            rejected.push({
                candidate,
                reason: 'skill_mismatch',
                detail: `unit lacks: ${diffSkills(candidate.profile.skills, unit.skills).join(',')}`,
            });
            continue;
        }

        // ── 5. Customer window (cheap; check before travel calls) ────────
        if (!candidateWindowAllows(candidate, commitment.date)) {
            rejected.push({ candidate, reason: 'customer_window' });
            continue;
        }

        // ── 3. Hub proximity (Haversine — no DM call) ────────────────────
        const home = unit.homePostcode ?? '';
        if (!home || !isWithinHub(home, candidate.postcode)) {
            rejected.push({
                candidate,
                reason: 'proximity_hub',
                detail: `${home || 'no_home'} → ${candidate.postcode}`,
            });
            continue;
        }

        // ── Travel-from-previous (or mobilisation for the first stop) ────
        let travelMinutes: number;
        let travelMiles: number;
        let isStretch = false;

        if (packed.length === 0) {
            const mob = await getMobilisationDrive(home, candidate.postcode, dayBase);
            travelMinutes = mob.minutes;
            travelMiles = mob.miles;
        } else {
            const prev = packed[packed.length - 1];
            const chain = await isChainable(prev, candidate, prev.plannedEnd);
            travelMinutes = chain.minutes;
            travelMiles = chain.miles;
            if (!chain.ok) {
                // Per Module 06 §5.3 — hub passed, chain failed → accept with
                // stretch=true (offer page renders a "long drive" warning).
                isStretch = true;
            }
        }

        // ── 2. Time envelope ─────────────────────────────────────────────
        const realWork = candidate.profile.real_work_minutes ?? 0;
        const setupCleanup = SETUP_MINUTES_PER_JOB + CLEANUP_MINUTES_PER_JOB;

        // Compute pickup minutes assuming this candidate is added.
        const tentativeJobs = [...packed, { ...candidate } as PackedJob];
        const tentativePickups = aggregateMaterialsPickups(tentativeJobs);
        const pickupMinutes = computePickupMinutes(tentativePickups);

        // Mobilisation already counted in `travelMinutes` for the first stop.
        // Return-to-base is added once at the end (estimated).
        const returnDrive = await getDriveTime(candidate.postcode, home, dayBase);
        const returnMinutes = Math.round(returnDrive.minutes * 1.15);

        const proposedTotal =
            sumPackedTimings(packed) +     // existing time spent
            pickupMinutes +                 // pickup recomputed for the new job set
            travelMinutes +                 // travel to this stop
            setupCleanup + realWork +       // this stop's on-site time
            returnMinutes +                 // return-to-base
            TRAILING_MARGIN_MINUTES;

        if (proposedTotal > windowMinutes) {
            rejected.push({
                candidate,
                reason: 'time_envelope_exceeded',
                detail: `would_total=${proposedTotal} window=${windowMinutes}`,
            });
            continue;
        }

        // ── Accept ───────────────────────────────────────────────────────
        const plannedStart = computeNextStart(packed, dayBase, travelMinutes, pickupMinutes, packed.length === 0);
        const plannedEnd = new Date(plannedStart.getTime() + (realWork + setupCleanup) * 60_000);

        packed.push({
            ...candidate,
            plannedStart,
            plannedEnd,
            travelMinutesFromPrevious: travelMinutes,
            travelMilesFromPrevious: travelMiles,
            isStretch,
        });
        totalContractorPay += candidate.contractorPayPence;
        totalCustomerPay += estimateCustomerPay(candidate);
        totalTravelMinutes += travelMinutes;
        totalTravelMiles += travelMiles;
    }

    // Materials aggregation across the final job set.
    const pickups = aggregateMaterialsPickups(packed);

    // Rough route summary (return-to-base mileage included for accuracy).
    const home = unit.homePostcode ?? '';
    let returnSummary = { minutes: 0, miles: 0 };
    if (home && packed.length > 0) {
        const last = packed[packed.length - 1];
        const back = await getDriveTime(last.postcode, home, dayBase);
        returnSummary = { minutes: Math.round(back.minutes * 1.15), miles: back.miles };
        totalTravelMinutes += returnSummary.minutes;
        totalTravelMiles += returnSummary.miles;
    }

    const estimatedHours =
        Math.round(
            ((sumPackedTimings(packed) + computePickupMinutes(pickups) + totalTravelMinutes) / 60) * 100,
        ) / 100;

    const pack: DayPack = {
        id: '',                                     // assigned at insert
        commitmentId: commitment.id,
        unitId: commitment.unitId,
        date: commitment.date,
        status: 'proposed',
        jobs: packed,
        materialsPickups: pickups,
        totalContractorPayPence: totalContractorPay,
        totalCustomerPayPence: totalCustomerPay,
        estimatedHours,
        travelMinutes: totalTravelMinutes,
        topUpPence: 0,
        completionBonusPence: 0,
        routeSummary: {
            totalMiles: Math.round(totalTravelMiles * 100) / 100,
            totalDriveMinutes: totalTravelMinutes,
        },
    };

    return { pack, rejected };
}

// ---------------------------------------------------------------------------
// Sorting — Module 06 §4 "Best fit first"
// ---------------------------------------------------------------------------

function sortCandidates(candidates: CandidateJob[], commitment: DayCommitment): CandidateJob[] {
    const filterUpper = (commitment.areaFilter ?? []).map((a) => a.toUpperCase());

    return [...candidates].sort((a, b) => {
        // 1. Already-claimed area first
        const aIn = areaMatches(filterUpper, a.postcode);
        const bIn = areaMatches(filterUpper, b.postcode);
        if (aIn !== bIn) return aIn ? -1 : 1;

        // 2. Highest contractor_pay_pence first
        if (a.contractorPayPence !== b.contractorPayPence) {
            return b.contractorPayPence - a.contractorPayPence;
        }

        // 3. Lower complexity first
        const aComplexity = a.profile.complexity_flags?.length ?? 0;
        const bComplexity = b.profile.complexity_flags?.length ?? 0;
        if (aComplexity !== bComplexity) return aComplexity - bComplexity;

        // 4. Customer flexibility ascending: relaxed → flexible → fast.
        const aFlex = flexRank(a.flexTier);
        const bFlex = flexRank(b.flexTier);
        if (aFlex !== bFlex) return aFlex - bFlex;

        // 5. Tiebreak — ID ASC for deterministic replay
        return a.bookingId.localeCompare(b.bookingId);
    });
}

function areaMatches(filterUpper: string[], postcode: string): boolean {
    if (filterUpper.length === 0) return true;
    const head = (postcode ?? '').toUpperCase().split(/\s+/)[0] ?? '';
    return filterUpper.some((p) => head.startsWith(p));
}

function flexRank(tier: 'fast' | 'flexible' | 'relaxed' | undefined): number {
    if (tier === 'relaxed') return 0;
    if (tier === 'flexible') return 1;
    return 2; // fast or undefined → keep last
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasRequiredSkills(unit: EligibleUnit, candidate: CandidateJob): boolean {
    const required = candidate.profile.skills ?? [];
    if (required.length === 0) return true;
    const have = new Set(unit.skills);
    return required.every((s) => have.has(s));
}

function diffSkills(required: string[], have: string[]): string[] {
    const set = new Set(have);
    return required.filter((r) => !set.has(r));
}

function candidateWindowAllows(candidate: CandidateJob, commitmentDate: string): boolean {
    const target = new Date(`${commitmentDate}T00:00:00Z`).getTime();
    const earliest = candidate.earliestStart.getTime();
    const latest = candidate.latestFinish.getTime();
    return target >= startOfDay(earliest) && target <= endOfDay(latest);
}

function startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
}

function endOfDay(ms: number): number {
    const d = new Date(ms);
    d.setUTCHours(23, 59, 59, 999);
    return d.getTime();
}

function parseDateAtTime(date: string, time: string): Date {
    // commitment.startTime can be 'HH:MM' or 'HH:MM:SS'
    const t = time.length >= 5 ? time.slice(0, 5) : '08:00';
    return new Date(`${date}T${t}:00`);
}

function computeWindowMinutes(start: string, end: string): number {
    const s = (start.length >= 5 ? start.slice(0, 5) : '08:00').split(':');
    const e = (end.length >= 5 ? end.slice(0, 5) : '17:00').split(':');
    const startMin = Number(s[0]) * 60 + Number(s[1]);
    const endMin = Number(e[0]) * 60 + Number(e[1]);
    return Math.max(0, endMin - startMin);
}

function sumPackedTimings(packed: PackedJob[]): number {
    let total = 0;
    for (const j of packed) {
        total += j.profile.real_work_minutes ?? 0;
        total += SETUP_MINUTES_PER_JOB + CLEANUP_MINUTES_PER_JOB;
        total += j.travelMinutesFromPrevious ?? 0;
    }
    return total;
}

function computeNextStart(
    packed: PackedJob[],
    dayBase: Date,
    travelMinutes: number,
    pickupMinutes: number,
    isFirst: boolean,
): Date {
    if (isFirst) {
        // After pickup + mobilisation drive.
        return new Date(dayBase.getTime() + (pickupMinutes + travelMinutes) * 60_000);
    }
    const prev = packed[packed.length - 1];
    return new Date(prev.plannedEnd.getTime() + travelMinutes * 60_000);
}

function estimateCustomerPay(candidate: CandidateJob): number {
    // We don't have the full quote-side margin here; assume contractor pay is
    // ~70% of customer revenue (heuristic, used only for control-tower display).
    const ratio = 1 / 0.7;
    return Math.round(candidate.contractorPayPence * ratio);
}

// ---------------------------------------------------------------------------
// Materials aggregation — ADR-008 §"Aggregation into pickup steps"
// ---------------------------------------------------------------------------

export function aggregateMaterialsPickups(jobs: PackedJob[] | CandidateJob[]): MaterialsPickupSummary[] {
    const bySupplier = new Map<string, MaterialsPickupSummary>();

    for (const job of jobs) {
        const items = job.materials ?? [];
        for (const item of items) {
            if (item.supply_status !== 'contractor_pickup') continue;
            const supplier = item.supplier_id ?? 'unknown_supplier';
            const branch = item.branch_name ?? null;
            const key = `${supplier}::${branch ?? ''}`;
            const existing = bySupplier.get(key);
            if (existing) {
                if (!existing.items.includes(item.name)) {
                    existing.items.push(item.name);
                }
            } else {
                bySupplier.set(key, {
                    supplier,
                    branch,
                    postcode: item.branch_postcode ?? '',
                    items: [item.name],
                    estimatedMinutes: 0,    // backfilled below
                });
            }
        }
    }

    const list = Array.from(bySupplier.values());
    for (let i = 0; i < list.length; i += 1) {
        list[i].estimatedMinutes = i === 0 ? PICKUP_FIRST_MINUTES : PICKUP_ADDITIONAL_MINUTES;
    }
    return list;
}

function computePickupMinutes(pickups: MaterialsPickupSummary[]): number {
    if (pickups.length === 0) return 0;
    return pickups.reduce((sum, p) => sum + p.estimatedMinutes, 0);
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

export const __test__ = {
    sortCandidates,
    hasRequiredSkills,
    candidateWindowAllows,
    computeWindowMinutes,
    aggregateMaterialsPickups,
    computePickupMinutes,
    SETUP_MINUTES_PER_JOB,
    CLEANUP_MINUTES_PER_JOB,
    PICKUP_FIRST_MINUTES,
    PICKUP_ADDITIONAL_MINUTES,
    TRAILING_MARGIN_MINUTES,
    PACK_FULL_VALUE_RATIO,
};
