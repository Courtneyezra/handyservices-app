// scripts/run-stress-routing.ts
//
// Drives the 12 stress-test quotes through dispatchRouting() one at a time,
// then prints the routing decisions, offers, and final booking_state per slug.
//
// Run AFTER scripts/seed-stress-test-quotes.mjs.
// Usage: npx tsx scripts/run-stress-routing.ts

import dotenv from 'dotenv';
import dns from 'dns';

dotenv.config({ path: ['.env', '.env.local'], override: true });

// Force IPv4 (matches server/db.ts).
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
import { personalizedQuotes, routingDecisions, routingOffers, bookingStateLog } from '../shared/schema';
import { eq, asc, like } from 'drizzle-orm';
import { dispatchRouting } from '../server/routing';

async function main() {
    const stressQuotes = await db
        .select({
            id: personalizedQuotes.id,
            slug: personalizedQuotes.shortSlug,
            postcode: personalizedQuotes.postcode,
            flexTier: personalizedQuotes.flexTier,
            bookingState: personalizedQuotes.bookingState,
        })
        .from(personalizedQuotes)
        .where(like(personalizedQuotes.shortSlug, 't-q%'))
        .orderBy(asc(personalizedQuotes.shortSlug));

    if (stressQuotes.length !== 12) {
        console.warn(`! Expected 12 stress quotes, found ${stressQuotes.length}`);
    }

    console.log(`Found ${stressQuotes.length} stress quotes`);

    const results: Array<{
        slug: string;
        bookingId: string;
        dispatchStatus: string;
        dispatchLane?: string;
        dispatchOfferId?: string;
        dispatchError?: string;
    }> = [];

    for (const q of stressQuotes) {
        process.stdout.write(`\n[${q.slug}] state=${q.bookingState} → dispatchRouting()... `);
        try {
            const result = await dispatchRouting(q.id);
            results.push({
                slug: q.slug ?? '(null)',
                bookingId: q.id,
                dispatchStatus: result.status,
                dispatchLane: result.lane,
                dispatchOfferId: result.offerId,
            });
            console.log(`${result.status} (lane=${result.lane ?? '-'} offer=${result.offerId ?? '-'})`);
        } catch (err: any) {
            results.push({
                slug: q.slug ?? '(null)',
                bookingId: q.id,
                dispatchStatus: 'THREW',
                dispatchError: err?.message ?? String(err),
            });
            console.log(`THREW: ${err?.message}`);
        }
    }

    console.log('\n=== Per-quote final state ===');
    for (const r of results) {
        // Get final state + offer + decisions
        const [quote] = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, r.bookingId))
            .limit(1);
        const offers = await db
            .select()
            .from(routingOffers)
            .where(eq(routingOffers.bookingId, r.bookingId))
            .orderBy(asc(routingOffers.createdAt));
        const decisions = await db
            .select()
            .from(routingDecisions)
            .where(eq(routingDecisions.bookingId, r.bookingId))
            .orderBy(asc(routingDecisions.decidedAt));

        console.log(`\n--- ${r.slug} ---`);
        console.log(`  dispatch.status      = ${r.dispatchStatus}`);
        console.log(`  dispatch.lane        = ${r.dispatchLane ?? '-'}`);
        console.log(`  dispatch.error       = ${r.dispatchError ?? '-'}`);
        console.log(`  final booking_state  = ${(quote as any)?.bookingState ?? '?'}`);
        console.log(`  offers (${offers.length}):`);
        for (const o of offers) {
            console.log(`    - id=${o.id.slice(0, 8)} unit=${o.unitId.slice(0, 8)} round=${o.round} status=${o.status} expires=${o.expiresAt?.toISOString?.() ?? o.expiresAt}`);
        }
        console.log(`  decisions (${decisions.length}):`);
        for (const d of decisions) {
            const dType = (d as any).decisionType ?? '?';
            const lane = (d as any).lane ?? '-';
            const inputs = JSON.stringify((d as any).inputs ?? {})?.slice(0, 120);
            const outputs = JSON.stringify((d as any).outputs ?? {})?.slice(0, 120);
            console.log(`    - ${String(dType).padEnd(28)} lane=${lane} in=${inputs} out=${outputs}`);
        }
    }

    console.log('\n=== Summary ===');
    for (const r of results) {
        console.log(`${r.slug.padEnd(6)} → ${r.dispatchStatus.padEnd(22)} lane=${r.dispatchLane ?? '-'}`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
