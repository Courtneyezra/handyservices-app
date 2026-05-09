// scripts/run-volume-day-pack.ts
//
// Runs runDayPackAssembly() across all of Mark's open day commitments
// (where unit_id = Mark, status='open'). Captures the result per commit.
//
// Usage: npx tsx scripts/run-volume-day-pack.ts

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
import { and, eq, like, asc, gte, lte } from 'drizzle-orm';
import { runDayPackAssembly } from '../server/day-pack';

const MARK_ID = '402a5350-86b3-4c05-90aa-d9307bcd9bcf';

async function main() {
    // Pull Mark's commitments for next week
    const commits = await db
        .select()
        .from(dayCommitments)
        .where(and(
            eq(dayCommitments.unitId, MARK_ID),
            gte(dayCommitments.date, '2026-05-12'),
            lte(dayCommitments.date, '2026-05-16'),
        ))
        .orderBy(asc(dayCommitments.date));

    console.log(`Found ${commits.length} Mark commitments for week of 2026-05-12`);
    for (const c of commits) {
        console.log(`  ${c.date} status=${c.status} target=£${(c.targetPence/100).toFixed(0)} areas=${JSON.stringify(c.areaFilter)}`);
    }
    console.log('');

    // Filter to OPEN commits
    const openCommits = commits.filter(c => c.status === 'open');
    console.log(`Running assembly on ${openCommits.length} open commitments...\n`);

    const results: Array<{
        commitId: string;
        date: string;
        areaFilter: any;
        targetPence: number;
        status: string;
        packId?: string;
        packValue?: number;
        jobCount?: number;
        topUpPence?: number;
        detail?: string;
        error?: string;
    }> = [];

    for (const c of openCommits) {
        process.stdout.write(`[${c.date}] target=£${(c.targetPence/100).toFixed(0)} areas=${JSON.stringify(c.areaFilter)} → assembly... `);
        try {
            const outcome = await runDayPackAssembly(c.id);
            const r = {
                commitId: c.id,
                date: typeof c.date === 'string' ? c.date : new Date(c.date).toISOString().slice(0, 10),
                areaFilter: c.areaFilter,
                targetPence: c.targetPence,
                status: outcome.status,
                packId: outcome.pack?.id,
                packValue: outcome.pack?.totalContractorPayPence,
                jobCount: outcome.pack?.jobs.length,
                topUpPence: outcome.topUpPence,
                detail: outcome.detail,
            };
            results.push(r);
            console.log(`${outcome.status}`);
            if (outcome.pack) {
                console.log(`  pack=${outcome.pack.id} jobs=${outcome.pack.jobs.length} pay=£${(outcome.pack.totalContractorPayPence/100).toFixed(0)} hours=${outcome.pack.estimatedHours} travel=${outcome.pack.travelMinutes}min`);
                console.log(`  topUp=£${((outcome.topUpPence ?? 0)/100).toFixed(2)}`);
                for (const j of outcome.pack.jobs) {
                    const [pq] = await db.select({ slug: personalizedQuotes.shortSlug, postcode: personalizedQuotes.postcode, dur: personalizedQuotes.durationEstimateMinutes, base: personalizedQuotes.basePrice }).from(personalizedQuotes).where(eq(personalizedQuotes.id, j.bookingId)).limit(1);
                    console.log(`    - ${pq?.slug} pc=${pq?.postcode} dur=${pq?.dur}min base=£${(Number(pq?.base ?? 0)/100).toFixed(0)}`);
                }
            }
            if (outcome.detail) console.log(`  detail: ${outcome.detail}`);
        } catch (err: any) {
            results.push({
                commitId: c.id,
                date: typeof c.date === 'string' ? c.date : new Date(c.date).toISOString().slice(0, 10),
                areaFilter: c.areaFilter,
                targetPence: c.targetPence,
                status: 'THREW',
                error: err?.message ?? String(err),
            });
            console.log(`THREW: ${err?.message}`);
        }

        // brief pause between solver runs
        await new Promise(r => setTimeout(r, 500));
    }

    // ---- Final report ----
    console.log('\n=== Day-pack assembly summary ===\n');
    console.log('| Date | Areas | Target £ | Pack £ | % | Jobs | Status |');
    console.log('|------|-------|----------|--------|---|------|--------|');
    for (const r of results) {
        const pctTarget = r.packValue ? Math.round(r.packValue / r.targetPence * 100) : 0;
        console.log(`| ${r.date} | ${JSON.stringify(r.areaFilter)} | £${(r.targetPence/100).toFixed(0)} | £${((r.packValue ?? 0)/100).toFixed(0)} | ${pctTarget}% | ${r.jobCount ?? 0} | ${r.status} |`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
