/**
 * Seed the SEO keyword universe (keyword_targets) from the Jul 2026 Google
 * Keyword Planner pull (Nottingham + Derby). Idempotent — upserts on
 * (city, keyword), so safe to re-run after a wider Apify pull.
 *
 *   npm run db:push          # create the tables first (one-time)
 *   npx tsx scripts/_seed-keyword-targets.ts
 *
 * Decision (24 Jul 2026): seed BOTH lanes — core (deliver now) AND the
 * regulated sub/pool trades — all with trackRankings=true. But every row
 * lands with pagePublished=false and bookingEnabled=false: RANK != FULFIL.
 * Flip pagePublished when a page ships; flip bookingEnabled only when the
 * pool can actually field that trade same-day.
 */
import { db } from '../server/db';
import { keywordTargets, type InsertKeywordTarget } from '../shared/schema';

type Row = {
    city: string; trade: string; keyword: string;
    intent: InsertKeywordTarget['intent'];
    deliverability: InsertKeywordTarget['deliverability'];
    vol: number; comp: InsertKeywordTarget['competition'];
};

const DATA: Row[] = [
    // ---- Nottingham · core (deliver now) ----
    { city: 'nottingham', trade: 'handyman', keyword: 'handyman nottingham', intent: 'service_head', deliverability: 'core', vol: 480, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'handyman', keyword: 'handyman services in nottingham', intent: 'service_head', deliverability: 'core', vol: 90, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'property-maintenance', keyword: 'property maintenance nottingham', intent: 'upmarket', deliverability: 'core', vol: 110, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'painter and decorator nottingham', intent: 'trade_service', deliverability: 'core', vol: 720, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'decorators nottingham', intent: 'trade_service', deliverability: 'core', vol: 170, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'gutter cleaning nottingham', intent: 'trade_service', deliverability: 'core', vol: 590, comp: 'HIGH' },
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'guttering repairs nottingham', intent: 'trade_service', deliverability: 'core', vol: 260, comp: 'HIGH' },
    { city: 'nottingham', trade: 'fencing', keyword: 'fencing nottingham', intent: 'trade_service', deliverability: 'core', vol: 720, comp: 'HIGH' },
    { city: 'nottingham', trade: 'fencing', keyword: 'fencing companies nottingham', intent: 'trade_service', deliverability: 'core', vol: 210, comp: 'HIGH' },
    { city: 'nottingham', trade: 'plasterer', keyword: 'plasterer nottingham', intent: 'trade_service', deliverability: 'core', vol: 590, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'kitchen-fitting', keyword: 'kitchen fitter nottingham', intent: 'trade_service', deliverability: 'core', vol: 320, comp: 'HIGH' },
    { city: 'nottingham', trade: 'carpenter', keyword: 'carpenter nottingham', intent: 'trade_service', deliverability: 'core', vol: 260, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'tiler', keyword: 'tiler nottingham', intent: 'trade_service', deliverability: 'core', vol: 170, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'bathroom-fitting', keyword: 'bathroom fitter nottingham', intent: 'trade_service', deliverability: 'core', vol: 90, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'landscaping nottingham', intent: 'trade_service', deliverability: 'core', vol: 720, comp: 'HIGH' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'turfing nottingham', intent: 'trade_service', deliverability: 'core', vol: 320, comp: 'HIGH' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'garden maintenance nottingham', intent: 'trade_service', deliverability: 'core', vol: 70, comp: 'HIGH' },
    { city: 'nottingham', trade: 'pressure-washing', keyword: 'pressure washing nottingham', intent: 'trade_service', deliverability: 'core', vol: 90, comp: 'HIGH' },
    { city: 'nottingham', trade: 'pressure-washing', keyword: 'driveway cleaning nottingham', intent: 'trade_service', deliverability: 'core', vol: 70, comp: 'HIGH' },
    { city: 'nottingham', trade: 'decking', keyword: 'composite decking nottingham', intent: 'trade_service', deliverability: 'core', vol: 110, comp: 'HIGH' },
    { city: 'nottingham', trade: 'decking', keyword: 'decking nottingham', intent: 'trade_service', deliverability: 'core', vol: 70, comp: 'HIGH' },
    { city: 'nottingham', trade: 'flatpack', keyword: 'flat pack assembly nottingham', intent: 'trade_service', deliverability: 'core', vol: 10, comp: 'MEDIUM' },
    // ---- Nottingham · sub (vetted-pool fork) ----
    { city: 'nottingham', trade: 'roofer', keyword: 'roofer nottingham', intent: 'trade_service', deliverability: 'sub', vol: 1600, comp: 'HIGH' },
    { city: 'nottingham', trade: 'roofer', keyword: 'roof repairs nottingham', intent: 'trade_service', deliverability: 'sub', vol: 260, comp: 'HIGH' },
    { city: 'nottingham', trade: 'locksmith', keyword: 'locksmith nottingham', intent: 'trade_service', deliverability: 'sub', vol: 1600, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'locksmith', keyword: 'emergency locksmith nottingham', intent: 'emergency', deliverability: 'sub', vol: 140, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'plumber', keyword: 'plumber nottingham', intent: 'trade_service', deliverability: 'sub', vol: 1300, comp: 'HIGH' },
    { city: 'nottingham', trade: 'plumber', keyword: 'emergency plumber nottingham', intent: 'emergency', deliverability: 'sub', vol: 390, comp: 'HIGH' },
    { city: 'nottingham', trade: 'electrician', keyword: 'electrician nottingham', intent: 'trade_service', deliverability: 'sub', vol: 1300, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'electrician', keyword: 'emergency electrician nottingham', intent: 'emergency', deliverability: 'sub', vol: 140, comp: 'HIGH' },
    // ---- Derby · core ----
    { city: 'derby', trade: 'handyman', keyword: 'handyman derby', intent: 'service_head', deliverability: 'core', vol: 480, comp: 'MEDIUM' },
    { city: 'derby', trade: 'handyman', keyword: 'handyman services derby', intent: 'service_head', deliverability: 'core', vol: 70, comp: 'MEDIUM' },
    { city: 'derby', trade: 'property-maintenance', keyword: 'property maintenance derby', intent: 'upmarket', deliverability: 'core', vol: 70, comp: 'MEDIUM' },
    { city: 'derby', trade: 'painter-decorator', keyword: 'painter and decorator derby', intent: 'trade_service', deliverability: 'core', vol: 480, comp: 'MEDIUM' },
    { city: 'derby', trade: 'painter-decorator', keyword: 'decorators derby', intent: 'trade_service', deliverability: 'core', vol: 170, comp: 'MEDIUM' },
    { city: 'derby', trade: 'fencing', keyword: 'fencing derby', intent: 'trade_service', deliverability: 'core', vol: 390, comp: 'HIGH' },
    { city: 'derby', trade: 'fencing', keyword: 'fencing companies derby', intent: 'trade_service', deliverability: 'core', vol: 110, comp: 'HIGH' },
    { city: 'derby', trade: 'gutter-cleaning', keyword: 'gutter cleaning derby', intent: 'trade_service', deliverability: 'core', vol: 260, comp: 'HIGH' },
    { city: 'derby', trade: 'kitchen-fitting', keyword: 'kitchen fitter derby', intent: 'trade_service', deliverability: 'core', vol: 210, comp: 'MEDIUM' },
    { city: 'derby', trade: 'bathroom-fitting', keyword: 'bathroom installers derby', intent: 'trade_service', deliverability: 'core', vol: 390, comp: 'HIGH' },
    { city: 'derby', trade: 'bathroom-fitting', keyword: 'bathroom fitter derby', intent: 'trade_service', deliverability: 'core', vol: 90, comp: 'HIGH' },
    { city: 'derby', trade: 'tiler', keyword: 'tiler derby', intent: 'trade_service', deliverability: 'core', vol: 90, comp: 'MEDIUM' },
    { city: 'derby', trade: 'landscaping', keyword: 'garden maintenance derby', intent: 'trade_service', deliverability: 'core', vol: 70, comp: 'HIGH' },
    // ---- Derby · sub ----
    { city: 'derby', trade: 'roofer', keyword: 'roofer derby', intent: 'trade_service', deliverability: 'sub', vol: 1300, comp: 'HIGH' },
    { city: 'derby', trade: 'roofer', keyword: 'roof repairs derby', intent: 'trade_service', deliverability: 'sub', vol: 320, comp: 'HIGH' },
    { city: 'derby', trade: 'plumber', keyword: 'plumber derby', intent: 'trade_service', deliverability: 'sub', vol: 1900, comp: 'MEDIUM' },
    { city: 'derby', trade: 'plumber', keyword: 'emergency plumber derby', intent: 'emergency', deliverability: 'sub', vol: 210, comp: 'MEDIUM' },
    { city: 'derby', trade: 'electrician', keyword: 'electrician derby', intent: 'trade_service', deliverability: 'sub', vol: 880, comp: 'MEDIUM' },
    { city: 'derby', trade: 'electrician', keyword: 'emergency electrician derby', intent: 'emergency', deliverability: 'sub', vol: 70, comp: 'MEDIUM' },

    // ---- Widened universe (full trade sweep, 24 Jul) — tracked now, pages TBD ----
    // New viable service clusters beyond the original 16. Synonym variants clustered
    // to the head term (e.g. artificial grass ~320, not summed across synonyms).
    // Nottingham
    { city: 'nottingham', trade: 'fitted-wardrobes', keyword: 'fitted wardrobes nottingham', intent: 'trade_service', deliverability: 'core', vol: 320, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'fitted-wardrobes', keyword: 'sliding wardrobes nottingham', intent: 'trade_service', deliverability: 'core', vol: 320, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'flooring', keyword: 'carpet fitters nottingham', intent: 'trade_service', deliverability: 'core', vol: 320, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'flooring', keyword: 'lvt flooring nottingham', intent: 'trade_service', deliverability: 'core', vol: 110, comp: 'HIGH' },
    { city: 'nottingham', trade: 'flooring', keyword: 'floor fitter nottingham', intent: 'trade_service', deliverability: 'core', vol: 50, comp: 'HIGH' },
    { city: 'nottingham', trade: 'artificial-grass', keyword: 'artificial grass nottingham', intent: 'trade_service', deliverability: 'core', vol: 320, comp: 'HIGH' },
    { city: 'nottingham', trade: 'garage-door', keyword: 'garage door repair nottingham', intent: 'trade_service', deliverability: 'core', vol: 210, comp: 'HIGH' },
    { city: 'nottingham', trade: 'roof-cleaning', keyword: 'roof cleaning nottingham', intent: 'trade_service', deliverability: 'core', vol: 170, comp: 'HIGH' },
    { city: 'nottingham', trade: 'loft-boarding', keyword: 'loft boarding nottingham', intent: 'trade_service', deliverability: 'core', vol: 140, comp: 'HIGH' },
    { city: 'nottingham', trade: 'plasterer', keyword: 'rendering nottingham', intent: 'trade_service', deliverability: 'core', vol: 110, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'ev-charger', keyword: 'ev charger installation nottingham', intent: 'trade_service', deliverability: 'sub', vol: 90, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'garden clearance nottingham', intent: 'trade_service', deliverability: 'core', vol: 90, comp: 'HIGH' },
    { city: 'nottingham', trade: 'property-maintenance', keyword: 'facilities management nottingham', intent: 'upmarket', deliverability: 'core', vol: 70, comp: 'LOW' },
    { city: 'nottingham', trade: 'pressure-washing', keyword: 'jet washing nottingham', intent: 'trade_service', deliverability: 'core', vol: 50, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'hedge trimming nottingham', intent: 'trade_service', deliverability: 'core', vol: 40, comp: 'HIGH' },
    // Derby
    { city: 'derby', trade: 'plasterer', keyword: 'plastering derby', intent: 'trade_service', deliverability: 'core', vol: 480, comp: 'HIGH' },
    { city: 'derby', trade: 'carpenter', keyword: 'carpenter derby', intent: 'trade_service', deliverability: 'core', vol: 170, comp: 'MEDIUM' },
    { city: 'derby', trade: 'gutter-cleaning', keyword: 'guttering repairs derby', intent: 'trade_service', deliverability: 'core', vol: 110, comp: 'HIGH' },
    { city: 'derby', trade: 'landscaping', keyword: 'garden clearance derby', intent: 'trade_service', deliverability: 'core', vol: 70, comp: 'HIGH' },
    { city: 'derby', trade: 'pressure-washing', keyword: 'jet washing derby', intent: 'trade_service', deliverability: 'core', vol: 30, comp: 'MEDIUM' },
];

// intent -> page tier in the 5-tier architecture
const TIER: Record<string, InsertKeywordTarget['tier']> = {
    service_head: 'T1_city_hub',
    upmarket: 'T4_segment',
    emergency: 'T5_emergency',
    trade_service: 'T2_service_city',
    informational: 'T4_segment',
    trade_supply: 'T2_service_city',
    brand_competitor: 'T2_service_city',
};

// priority = volume x intent weight x deliverability weight (sub discounted for fulfil friction)
const INTENT_W: Record<string, number> = { emergency: 1.4, upmarket: 1.3, service_head: 1.1, trade_service: 1.0, informational: 0.6, trade_supply: 0.3, brand_competitor: 0.1 };
const DELIV_W: Record<string, number> = { core: 1.0, sub: 0.7, out_of_scope: 0.0 };

async function main() {
    let inserted = 0;
    for (const r of DATA) {
        const priorityScore = Math.round(r.vol * (INTENT_W[r.intent] ?? 1) * (DELIV_W[r.deliverability] ?? 1));
        const row: InsertKeywordTarget = {
            city: r.city, trade: r.trade, keyword: r.keyword,
            intent: r.intent, tier: TIER[r.intent], deliverability: r.deliverability,
            avgMonthlySearches: r.vol, competition: r.comp,
            priorityScore,
            trackRankings: true,        // track everything from day one
            pagePublished: false,       // nothing built yet
            bookingEnabled: false,      // gated on real pool capacity — RANK != FULFIL
            source: 'google_keyword_planner',
        };
        await db.insert(keywordTargets).values(row)
            .onConflictDoUpdate({
                target: [keywordTargets.city, keywordTargets.keyword],
                set: {
                    avgMonthlySearches: row.avgMonthlySearches,
                    competition: row.competition,
                    intent: row.intent,
                    tier: row.tier,
                    deliverability: row.deliverability,
                    priorityScore: row.priorityScore,
                    updatedAt: new Date(),
                },
            });
        inserted++;
    }

    // Summary
    const coreVol = DATA.filter(d => d.deliverability === 'core').reduce((s, d) => s + d.vol, 0);
    const subVol = DATA.filter(d => d.deliverability === 'sub').reduce((s, d) => s + d.vol, 0);
    console.log(`Seeded/updated ${inserted} keyword targets.`);
    console.log(`  Core (deliver now) demand:      ${coreVol.toLocaleString()} searches/mo`);
    console.log(`  Sub  (vetted-pool fork) demand: ${subVol.toLocaleString()} searches/mo`);
    console.log(`  Total tracked universe:         ${(coreVol + subVol).toLocaleString()} searches/mo`);
    console.log(`  All rows: trackRankings=true, pagePublished=false, bookingEnabled=false.`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
