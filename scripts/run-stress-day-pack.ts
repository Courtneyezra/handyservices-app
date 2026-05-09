// scripts/run-stress-day-pack.ts
//
// Creates a temporary "open" day_commitment for Mark covering NG7+NG8 area,
// runs runDayPackAssembly, prints the outcome, then leaves the commitment in
// place so the report can inspect it.
//
// Usage: npx tsx scripts/run-stress-day-pack.ts

import dotenv from 'dotenv';
import dns from 'dns';
dotenv.config({ path: ['.env', '.env.local'], override: true });

const originalLookup = dns.lookup;
// @ts-ignore
dns.lookup = (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    else if (!options) { options = {}; }
    // @ts-ignore
    options.family = 4;
    // @ts-ignore
    return originalLookup(hostname, options, callback);
};

import { db } from '../server/db';
import { dayCommitments, dayPacks, personalizedQuotes } from '../shared/schema';
import { and, eq, like } from 'drizzle-orm';
import { createCommitment } from '../server/day-pack/commitment-service';
import { runDayPackAssembly } from '../server/day-pack';

const MARK_ID = '402a5350-86b3-4c05-90aa-d9307bcd9bcf';

async function main() {
    // Pick a date inside flex windows of stress quotes (tomorrow + 3 days
    // works for flexible (7d) and relaxed (14d) tiers).
    const target = new Date();
    target.setUTCHours(0, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + 3);
    const targetIso = target.toISOString().slice(0, 10);

    console.log(`Creating commitment for Mark (NG7+NG8) on ${targetIso}`);

    // Avoid duplicating: drop any existing stress commitment for this date if
    // present, then insert.
    await db.delete(dayCommitments).where(and(
        eq(dayCommitments.unitId, MARK_ID),
        eq(dayCommitments.date, targetIso as any),
    ));

    const commitment = await createCommitment({
        unitId: MARK_ID,
        date: targetIso,
        startTime: '08:00',
        endTime: '16:30',
        areaFilter: ['NG7', 'NG8'],
        targetPence: 24000,    // £240/day
    });
    console.log(`Created commitment ${commitment.id} (target £${(commitment.targetPence / 100).toFixed(0)})`);

    // Show stress quotes that COULD be candidates (state=reserved_for_pack,
    // postcode in NG7|NG8).
    const candidates = await db
        .select()
        .from(personalizedQuotes)
        .where(and(
            eq(personalizedQuotes.bookingState, 'reserved_for_pack'),
            like(personalizedQuotes.shortSlug, 't-q%'),
        ));
    console.log(`\nCandidate stress quotes in reserved_for_pack: ${candidates.length}`);
    for (const c of candidates as any[]) {
        console.log(`  ${c.shortSlug}\tpc=${c.postcode}\tdur=${c.durationEstimateMinutes}\tskills=${JSON.stringify(c.skillsRequired)}\tcrew=${c.crewSizeRequired}`);
    }

    console.log(`\nRunning assembly...`);
    const outcome = await runDayPackAssembly(commitment.id);
    console.log(`Outcome: ${JSON.stringify(outcome, null, 2)}`);

    if (outcome.pack) {
        const pack = outcome.pack;
        console.log(`\nPack ${pack.id}:`);
        console.log(`  status=${pack.status}`);
        console.log(`  jobs=${pack.jobs.length}`);
        for (const j of pack.jobs) {
            console.log(`    - ${j.bookingId}`);
        }
        console.log(`  totalContractorPay=£${(pack.totalContractorPayPence / 100).toFixed(2)}`);
        console.log(`  totalCustomerPay=£${(pack.totalCustomerPayPence / 100).toFixed(2)}`);
        console.log(`  estimatedHours=${pack.estimatedHours}`);
        console.log(`  travelMinutes=${pack.travelMinutes}`);
        console.log(`  topUpPence=${pack.topUpPence}`);
    }

    // Show stress quotes whose state changed
    const after = await db
        .select()
        .from(personalizedQuotes)
        .where(like(personalizedQuotes.shortSlug, 't-q%'));
    console.log(`\nStress quotes after assembly:`);
    for (const q of after as any[]) {
        console.log(`  ${q.shortSlug.padEnd(6)} state=${q.bookingState}`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
