// scripts/run-volume-routing.ts
//
// Runs dispatchRouting() across all 50 v-q* volume quotes sequentially.
// Captures lane / state / errors and prints summary.
//
// Usage: npx tsx scripts/run-volume-routing.ts

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
import { personalizedQuotes, routingDecisions } from '../shared/schema';
import { eq, asc, like } from 'drizzle-orm';
import { dispatchRouting } from '../server/routing';

interface RoutingResult {
    slug: string;
    bookingId: string;
    postcode: string;
    flexTier: string | null;
    skills: string[];
    duration: number | null;
    initialState: string;
    dispatchStatus: string;
    dispatchLane?: string;
    dispatchOfferId?: string;
    dispatchError?: string;
    finalState?: string;
}

async function main() {
    const quotes = await db
        .select({
            id: personalizedQuotes.id,
            slug: personalizedQuotes.shortSlug,
            postcode: personalizedQuotes.postcode,
            flexTier: personalizedQuotes.flexTier,
            skills: personalizedQuotes.skillsRequired,
            duration: personalizedQuotes.durationEstimateMinutes,
            bookingState: personalizedQuotes.bookingState,
        })
        .from(personalizedQuotes)
        .where(like(personalizedQuotes.shortSlug, 'v-q%'))
        .orderBy(asc(personalizedQuotes.shortSlug));

    console.log(`Found ${quotes.length} volume quotes`);

    if (quotes.length !== 50) {
        console.warn(`! Expected 50 volume quotes, found ${quotes.length}`);
    }

    const results: RoutingResult[] = [];

    let i = 0;
    for (const q of quotes) {
        i++;
        process.stdout.write(`[${String(i).padStart(2)}/${quotes.length}] ${q.slug} (${q.postcode}) state=${q.bookingState} → `);
        try {
            const result = await dispatchRouting(q.id);
            results.push({
                slug: q.slug ?? '(null)',
                bookingId: q.id,
                postcode: q.postcode ?? '',
                flexTier: q.flexTier ?? null,
                skills: (q.skills as string[]) ?? [],
                duration: q.duration ?? null,
                initialState: q.bookingState ?? '',
                dispatchStatus: result.status,
                dispatchLane: result.lane,
                dispatchOfferId: result.offerId,
            });
            console.log(`${result.status} (lane=${result.lane ?? '-'} offer=${result.offerId ?? '-'})`);
        } catch (err: any) {
            results.push({
                slug: q.slug ?? '(null)',
                bookingId: q.id,
                postcode: q.postcode ?? '',
                flexTier: q.flexTier ?? null,
                skills: (q.skills as string[]) ?? [],
                duration: q.duration ?? null,
                initialState: q.bookingState ?? '',
                dispatchStatus: 'THREW',
                dispatchError: err?.message ?? String(err),
            });
            console.log(`THREW: ${err?.message}`);
        }
    }

    // Get final booking_states
    for (const r of results) {
        const [q] = await db
            .select({ bookingState: personalizedQuotes.bookingState })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, r.bookingId))
            .limit(1);
        r.finalState = q?.bookingState ?? '?';
    }

    // ----------------- SUMMARY -----------------
    console.log('\n=== Volume routing summary ===\n');

    // Lane breakdown
    const laneTally: Record<string, number> = {};
    const stateTally: Record<string, number> = {};
    const dispatchStatusTally: Record<string, number> = {};
    const errorSamples: string[] = [];

    for (const r of results) {
        laneTally[r.dispatchLane ?? '(none)'] = (laneTally[r.dispatchLane ?? '(none)'] ?? 0) + 1;
        stateTally[r.finalState ?? '?'] = (stateTally[r.finalState ?? '?'] ?? 0) + 1;
        dispatchStatusTally[r.dispatchStatus] = (dispatchStatusTally[r.dispatchStatus] ?? 0) + 1;
        if (r.dispatchError && errorSamples.length < 5) errorSamples.push(`${r.slug}: ${r.dispatchError}`);
    }

    console.log('Lane breakdown:');
    for (const [k, v] of Object.entries(laneTally).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(20)} ${v}`);
    }

    console.log('\nDispatch status breakdown:');
    for (const [k, v] of Object.entries(dispatchStatusTally).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(28)} ${v}`);
    }

    console.log('\nFinal booking_state breakdown:');
    for (const [k, v] of Object.entries(stateTally).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(28)} ${v}`);
    }

    if (errorSamples.length > 0) {
        console.log('\nError samples:');
        for (const e of errorSamples) console.log(`  ${e}`);
    }

    // Per-postcode breakdown
    console.log('\nFinal state by postcode prefix:');
    const pcStateTally: Record<string, Record<string, number>> = {};
    for (const r of results) {
        const head = r.postcode.split(/\s+/)[0];
        if (!pcStateTally[head]) pcStateTally[head] = {};
        pcStateTally[head][r.finalState ?? '?'] = (pcStateTally[head][r.finalState ?? '?'] ?? 0) + 1;
    }
    for (const [pc, tally] of Object.entries(pcStateTally).sort()) {
        const parts = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(', ');
        console.log(`  ${pc.padEnd(6)} ${parts}`);
    }

    // Per-tier breakdown
    console.log('\nFinal state by flex_tier:');
    const tierStateTally: Record<string, Record<string, number>> = {};
    for (const r of results) {
        const tier = r.flexTier ?? 'null';
        if (!tierStateTally[tier]) tierStateTally[tier] = {};
        tierStateTally[tier][r.finalState ?? '?'] = (tierStateTally[tier][r.finalState ?? '?'] ?? 0) + 1;
    }
    for (const [tier, tally] of Object.entries(tierStateTally).sort()) {
        const parts = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(', ');
        console.log(`  ${tier.padEnd(10)} ${parts}`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
