/**
 * Diff: matrix vs fit endpoints
 *
 * Read-only investigation script. Picks ~3 active contractors and compares the
 * "available dates" each endpoint exposes for them, over today..today+14d.
 *
 * Mirrors the underlying queries from server/availability-routes.ts:
 *   - GET /api/admin/availability/matrix
 *   - GET /api/admin/availability/fit
 *
 * Run: npx tsx scripts/_diff-fit-vs-matrix.ts
 */
import 'dotenv/config';
import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { db } from '../server/db';
import {
    contractorAvailabilityDates,
    contractorBookingRequests,
    handymanAvailability,
    handymanProfiles,
    handymanSkills,
    users,
} from '../shared/schema';
import { slotFromWindow } from '../shared/slot-times';
import { findCandidateContractors } from '../server/contractor-matcher';

// ---------- Helpers ----------
const dateKey = (d: Date | string) => new Date(d).toISOString().split('T')[0];

// Replicates the matrix endpoint's *override-only* labelling.
// Per the matrix endpoint (and the client board's resolveSlot/overrideToSlot),
// the per-day status is:
//   - if override row exists → 'am' | 'pm' | 'full_day' | 'off' (per startTime/endTime)
//   - else                   → 'unset' (board renders this as blank; NOT "free")
// Jobs are layered on top as booked time but do not change the slot state itself.
function matrixLabelForDate(opts: {
    overrides: Array<{ date: Date | string; isAvailable: boolean; startTime: string | null; endTime: string | null }>;
    jobs: Array<{ scheduledDate: Date | string | null; assignmentStatus: string | null; status: string | null; scheduledSlot: string | null; scheduledStartTime: string | null }>;
    dateStr: string;
    dayOfWeek: number;
    patterns: Array<{ dayOfWeek: number | null; isActive: boolean | null }>;
}): { matrixLabel: string; hasOverride: boolean; isBooked: boolean; patternActiveOnDay: boolean } {
    const ov = opts.overrides.find(o => dateKey(o.date) === opts.dateStr);
    const dayJobs = opts.jobs.filter(j => {
        if (!j.scheduledDate) return false;
        if (dateKey(j.scheduledDate) !== opts.dateStr) return false;
        const a = j.assignmentStatus || '';
        const s = j.status || '';
        return ['assigned', 'accepted', 'in_progress', 'completed'].includes(a) || ['accepted', 'completed'].includes(s);
    });
    const isBooked = dayJobs.length > 0;
    const patternActive = !!opts.patterns.find(p => p.dayOfWeek === opts.dayOfWeek && p.isActive);

    let matrixLabel: string;
    if (ov) {
        if (!ov.isAvailable) matrixLabel = 'off';
        else {
            const slot = slotFromWindow(ov.startTime, ov.endTime);
            matrixLabel = slot === 'full_day' ? 'full' : slot;
        }
    } else {
        matrixLabel = 'unset';
    }
    if (isBooked) matrixLabel = matrixLabel === 'unset' ? `booked` : `${matrixLabel}+booked`;
    return { matrixLabel, hasOverride: !!ov, isBooked, patternActiveOnDay: patternActive };
}

// Replicates the fit endpoint's availableDays computation.
function fitAvailableDays(opts: {
    overrides: Array<{ date: Date | string; isAvailable: boolean; startTime: string | null; endTime: string | null }>;
    jobs: Array<{ scheduledDate: Date | string | null; assignmentStatus: string | null; status: string | null }>;
    patterns: Array<{ dayOfWeek: number | null; isActive: boolean | null }>;
    start: Date;
    days: number;
}): Array<{ date: string; slot: string }> {
    const slotOf = (o: { startTime: string | null; endTime: string | null }): string => {
        const s = slotFromWindow(o.startTime, o.endTime);
        return s === 'full_day' ? 'full' : s === 'other' ? 'full' : s;
    };
    const booked = new Set(
        opts.jobs
            .filter(j => {
                if (!j.scheduledDate) return false;
                const a = j.assignmentStatus || '';
                const s = j.status || '';
                return ['assigned', 'accepted', 'in_progress', 'completed'].includes(a) || ['accepted', 'completed'].includes(s);
            })
            .map(j => dateKey(j.scheduledDate!)),
    );
    const out: Array<{ date: string; slot: string }> = [];
    for (let i = 0; i < opts.days; i++) {
        const d = new Date(opts.start);
        d.setUTCDate(opts.start.getUTCDate() + i);
        const ds = dateKey(d);
        if (booked.has(ds)) continue;
        const ov = opts.overrides.find(o => dateKey(o.date) === ds);
        if (ov) {
            if (ov.isAvailable) out.push({ date: ds, slot: slotOf(ov) });
        } else {
            const pat = opts.patterns.find(p => p.dayOfWeek === d.getUTCDay() && p.isActive);
            if (pat) out.push({ date: ds, slot: 'full' });
        }
    }
    return out;
}

async function main() {
    const days = 14;
    // Match the fit endpoint exactly: new Date() then setUTCHours(0,0,0,0)
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + days);

    const todayLocal = new Date();
    console.log(`\n[Window] today (local server clock) = ${todayLocal.toISOString()}`);
    console.log(`[Window] start (UTC midnight)        = ${start.toISOString()} (${dateKey(start)})`);
    console.log(`[Window] end                          = ${end.toISOString()} (${dateKey(end)})`);
    console.log(`[Window] days                         = ${days}\n`);

    // Pick contractors:
    //   - have user.isActive = true
    //   - pass fit's gate (verified OR public profile enabled)
    //   - have at least one skill (so we can use their categories for fit)
    const profiles = await db
        .select({
            id: handymanProfiles.id,
            userId: handymanProfiles.userId,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            verificationStatus: handymanProfiles.verificationStatus,
            publicProfileEnabled: handymanProfiles.publicProfileEnabled,
            userActive: users.isActive,
        })
        .from(handymanProfiles)
        .innerJoin(users, eq(users.id, handymanProfiles.userId));

    const eligible = profiles.filter(p =>
        p.userActive === true &&
        (p.verificationStatus === 'verified' || p.publicProfileEnabled === true),
    );

    // Get skills for eligible contractors so we can build their category list
    const eligibleIds = eligible.map(e => e.id);
    const skillRows = eligibleIds.length
        ? await db.select().from(handymanSkills).where(inArray(handymanSkills.handymanId, eligibleIds))
        : [];
    const skillsByContractor = new Map<string, string[]>();
    for (const s of skillRows) {
        if (!s.categorySlug) continue;
        const arr = skillsByContractor.get(s.handymanId) ?? [];
        arr.push(s.categorySlug);
        skillsByContractor.set(s.handymanId, arr);
    }

    const withSkills = eligible.filter(e => (skillsByContractor.get(e.id)?.length ?? 0) > 0);
    console.log(`[Selection] eligible+active+skilled contractors: ${withSkills.length}`);

    // Up-front: which of those have weekly patterns? Patterns are where the
    // matrix-vs-fit semantics diverge most sharply.
    const eligibleIdsArr = withSkills.map(e => e.id);
    const allPatternsForEligible = eligibleIdsArr.length
        ? await db.select().from(handymanAvailability).where(inArray(handymanAvailability.handymanId, eligibleIdsArr))
        : [];
    const patternsByContractor = new Map<string, Array<{ dayOfWeek: number | null; isActive: boolean | null; startTime: string | null; endTime: string | null }>>();
    for (const p of allPatternsForEligible) {
        const arr = patternsByContractor.get(p.handymanId) ?? [];
        arr.push(p);
        patternsByContractor.set(p.handymanId, arr);
    }
    const withPatterns = withSkills.filter(e =>
        (patternsByContractor.get(e.id) ?? []).some(p => p.isActive),
    );
    console.log(`[Selection]   ...of which have an active weekly pattern: ${withPatterns.length}`);

    // Sample = up to 2 with patterns + 1 without (so we see both regimes).
    // If nobody has patterns, sample up to 3 from the skilled+active pool so
    // we can still examine override/booking behaviour.
    const sample = [
        ...withPatterns.slice(0, 2),
        ...withSkills.filter(e => !withPatterns.includes(e)).slice(0, 3),
    ].slice(0, 3);
    if (sample.length === 0) {
        console.log('No eligible contractors with skills. Bailing.');
        return;
    }
    for (const s of sample) {
        const hasPat = (patternsByContractor.get(s.id) ?? []).some(p => p.isActive);
        console.log(`  - ${s.firstName} ${s.lastName} <${s.email}>  id=${s.id}  pattern=${hasPat ? 'YES' : 'no'}`);
    }

    // Bulk-load all data for the sample
    const sampleIds = sample.map(s => s.id);
    const [allOverrides, allJobs, allPatterns] = await Promise.all([
        db.select().from(contractorAvailabilityDates).where(and(
            inArray(contractorAvailabilityDates.contractorId, sampleIds),
            gte(contractorAvailabilityDates.date, start),
            lte(contractorAvailabilityDates.date, end),
        )),
        db.select().from(contractorBookingRequests).where(and(
            or(
                inArray(contractorBookingRequests.assignedContractorId, sampleIds),
                inArray(contractorBookingRequests.contractorId, sampleIds),
            ),
            gte(contractorBookingRequests.scheduledDate, start),
            lte(contractorBookingRequests.scheduledDate, end),
        )),
        db.select().from(handymanAvailability).where(inArray(handymanAvailability.handymanId, sampleIds)),
    ]);

    // Sanity check: who's in matrix-eligible set but NOT in fit's matcher
    // result for their own categories? That would be Symptom B (contractor not
    // showing up on fit when they should be free).
    console.log(`\n[Cross-gate check] every skilled+active contractor vs findCandidateContractors:`);
    for (const c of withSkills) {
        const cats = skillsByContractor.get(c.id) ?? [];
        const m = await findCandidateContractors({ categorySlugs: cats });
        const present = m.candidates.some(cc => cc.contractorId === c.id);
        console.log(`  ${present ? 'PASS' : 'FAIL'}  ${c.firstName} ${c.lastName}  (cats: ${cats.length})  → ${m.candidates.length} candidates returned`);
    }

    // For each sample contractor, run both the matrix-style and fit-style logic
    for (const c of sample) {
        const cOverrides = allOverrides.filter(o => o.contractorId === c.id);
        const cJobs = allJobs.filter(j => (j.assignedContractorId || j.contractorId) === c.id);
        const cPatterns = allPatterns.filter(p => p.handymanId === c.id);
        const cCats = skillsByContractor.get(c.id) ?? [];

        // Build the per-day matrix-style label (no location, no skill restriction —
        // matrix returns ALL profiles)
        const dayRows: Array<{
            date: string; dow: number; matrixLabel: string; hasOverride: boolean; isBooked: boolean;
            patternActiveOnDay: boolean; fitSlot: string | null;
        }> = [];

        const fitDays = fitAvailableDays({
            overrides: cOverrides, jobs: cJobs, patterns: cPatterns, start, days,
        });
        const fitMap = new Map(fitDays.map(d => [d.date, d.slot]));

        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setUTCDate(start.getUTCDate() + i);
            const ds = dateKey(d);
            const dow = d.getUTCDay();
            const m = matrixLabelForDate({
                overrides: cOverrides, jobs: cJobs, dateStr: ds, dayOfWeek: dow, patterns: cPatterns,
            });
            dayRows.push({
                date: ds, dow, ...m,
                fitSlot: fitMap.get(ds) ?? null,
            });
        }

        // Also run findCandidateContractors with this contractor's categories —
        // to surface whether they pass the fit gate at all.
        // (No customer location passed → no radius filter.)
        const matchResult = await findCandidateContractors({ categorySlugs: cCats });
        const passedFitGate = matchResult.candidates.some(cand => cand.contractorId === c.id);

        console.log(`\n=========================`);
        console.log(`Contractor: ${c.firstName} ${c.lastName}   id=${c.id}`);
        console.log(`Email: ${c.email}`);
        console.log(`verificationStatus=${c.verificationStatus}  publicProfileEnabled=${c.publicProfileEnabled}`);
        console.log(`skill categories: [${cCats.join(', ')}]`);
        console.log(`passes findCandidateContractors gate? ${passedFitGate ? 'YES' : 'NO'}`);
        console.log(`weeklyPatterns (active, dow:start-end): ${cPatterns
            .filter(p => p.isActive)
            .map(p => `${p.dayOfWeek}:${p.startTime}-${p.endTime}`)
            .join(', ') || '(none)'}`);
        console.log(`overrides in window: ${cOverrides.length}`);
        for (const o of cOverrides) {
            console.log(`  override: id=${o.id} date=${o.date instanceof Date ? o.date.toISOString() : o.date} ` +
                `dateKey=${dateKey(o.date)} isAvailable=${o.isAvailable} start=${o.startTime} end=${o.endTime}`);
        }
        console.log(`booking-rows in window: ${cJobs.length}`);
        for (const j of cJobs) {
            console.log(`  job: id=${j.id} scheduledDate=${j.scheduledDate instanceof Date ? j.scheduledDate.toISOString() : j.scheduledDate} ` +
                `dateKey=${j.scheduledDate ? dateKey(j.scheduledDate) : 'null'} status=${j.status} ` +
                `assignmentStatus=${j.assignmentStatus} scheduledSlot=${j.scheduledSlot} scheduledStart=${j.scheduledStartTime}`);
        }

        // Tabular print of the 14 days
        const fmt = (s: string) => s.padEnd(14);
        console.log(`\n  date         dow  matrixSays      fitSays`);
        for (const r of dayRows) {
            console.log(`  ${r.date}   ${r.dow}    ${fmt(r.matrixLabel)}  ${r.fitSlot ?? '(absent)'}`);
        }

        // Diff: matrix-style "available" semantics vs fit-presence
        // The bug: matrix shows 'unset' (blank in UI) for days with no override
        // and only a weekly pattern; fit shows them as 'full' (available).
        const diffs = dayRows.filter(r => {
            const fitPresent = r.fitSlot !== null;
            // "Matrix shows free-by-default" if no override and not booked
            const matrixSaysExplicitFree =
                (r.matrixLabel === 'am' || r.matrixLabel === 'pm' || r.matrixLabel === 'full') && !r.isBooked;
            const matrixSaysOff = r.matrixLabel === 'off';

            if (fitPresent && r.matrixLabel === 'unset') return true; // pattern-only days
            if (fitPresent && matrixSaysOff) return true;             // shouldn't happen
            if (!fitPresent && matrixSaysExplicitFree) return true;   // mismatch direction
            // Also flag: pattern says active for this dow but fit absent (no booking and no override)
            if (!fitPresent && !r.isBooked && r.patternActiveOnDay && !r.hasOverride) return true;
            return false;
        });

        console.log(`\n  Divergences: ${diffs.length}`);
        for (const d of diffs) {
            const ov = cOverrides.find(o => dateKey(o.date) === d.date);
            const jobsOnDate = cJobs.filter(j => j.scheduledDate && dateKey(j.scheduledDate) === d.date);
            console.log(`    - ${d.date} (dow=${d.dow})`);
            console.log(`        matrix=${d.matrixLabel}   fit=${d.fitSlot ?? '(absent)'}`);
            console.log(`        override-row: ${ov ? JSON.stringify({ date: dateKey(ov.date), isAvailable: ov.isAvailable, start: ov.startTime, end: ov.endTime, notes: ov.notes }) : '(none)'}`);
            console.log(`        booking-rows: ${jobsOnDate.length === 0 ? '(none)' : jobsOnDate.map(j => `id=${j.id} status=${j.status} assignmentStatus=${j.assignmentStatus} scheduledSlot=${j.scheduledSlot} scheduledDate=${j.scheduledDate ? dateKey(j.scheduledDate) : 'null'}`).join('; ')}`);
            console.log(`        weekly-pattern-active-on-dow=${d.patternActiveOnDay}`);
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
