// scripts/inspect-stress-routing.ts
//
// Read-only inspection of the 12 stress quotes after dispatchRouting() has
// run.  Prints decisions, offers, final booking_state.
//
// Usage: npx tsx scripts/inspect-stress-routing.ts

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
import { personalizedQuotes, routingDecisions, routingOffers, handymanProfiles, dayPacks } from '../shared/schema';
import { eq, asc, like } from 'drizzle-orm';

async function main() {
    const stressQuotes = await db
        .select()
        .from(personalizedQuotes)
        .where(like(personalizedQuotes.shortSlug, 't-q%'))
        .orderBy(asc(personalizedQuotes.shortSlug));

    console.log(`Found ${stressQuotes.length} stress quotes`);

    // Sort numerically by slug suffix for readability.
    stressQuotes.sort((a: any, b: any) => {
        const na = parseInt(String(a.shortSlug).replace('t-q', ''), 10);
        const nb = parseInt(String(b.shortSlug).replace('t-q', ''), 10);
        return na - nb;
    });

    for (const q of stressQuotes as any[]) {
        const offers = await db
            .select()
            .from(routingOffers)
            .where(eq(routingOffers.bookingId, q.id))
            .orderBy(asc(routingOffers.createdAt));
        const decisions = await db
            .select()
            .from(routingDecisions)
            .where(eq(routingDecisions.bookingId, q.id))
            .orderBy(asc(routingDecisions.decidedAt));

        console.log(`\n--- ${q.shortSlug} (${q.postcode}) ---`);
        console.log(`  duration_estimate_minutes = ${q.durationEstimateMinutes}`);
        console.log(`  flex_tier=${q.flexTier} (${q.flexWindowDays}d) crew=${q.crewSizeRequired} skills=${JSON.stringify(q.skillsRequired)} cert=${JSON.stringify(q.certRequired)} heavy=${q.heavyLifting}`);
        console.log(`  booking_state = ${q.bookingState}`);
        console.log(`  offers (${offers.length}):`);
        for (const o of offers as any[]) {
            // pull unit name
            const [u] = await db
                .select({ businessName: handymanProfiles.businessName, segment: handymanProfiles.contractorSegment })
                .from(handymanProfiles)
                .where(eq(handymanProfiles.id, o.unitId))
                .limit(1);
            console.log(`    - id=${o.id.slice(0, 12)} unit=${o.unitId.slice(0, 8)} (${u?.businessName ?? '?'} / ${u?.segment ?? '?'}) round=${o.round} status=${o.status}`);
        }
        console.log(`  decisions (${decisions.length}):`);
        for (const d of decisions as any[]) {
            const inputs = JSON.stringify(d.inputs ?? {})?.slice(0, 140);
            const outputs = JSON.stringify(d.outputs ?? {})?.slice(0, 140);
            console.log(`    - ${String(d.decisionType).padEnd(28)} lane=${d.lane ?? '-'}  in=${inputs}  out=${outputs}`);
        }
    }

    // Day packs touching stress quotes
    console.log(`\n=== Day packs touching stress quotes ===`);
    const allPacks = await db.select().from(dayPacks);
    let any = false;
    for (const p of allPacks as any[]) {
        const ids: string[] = Array.isArray(p.bookingIds) ? p.bookingIds : (p.bookingIds ?? []);
        const hits = stressQuotes.filter((q: any) => ids.includes(q.id));
        if (hits.length === 0) continue;
        any = true;
        console.log(`  pack ${p.id} unit=${p.unitId} date=${p.commitDate} status=${p.state} value=${p.totalValuePence} hits=[${hits.map((h: any) => h.shortSlug).join(', ')}]`);
    }
    if (!any) console.log('  (none)');

    process.exit(0);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
