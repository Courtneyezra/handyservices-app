/**
 * Expand the Wave-1 T2 pages into full keyword CLUSTERS (tracked, not published).
 *
 * The base seed (_seed-keyword-targets.ts) gives each page a head term + a
 * synonym or two — enough to publish and rank the head. This script adds the
 * long-tail + question layer around each Wave-1 (city, trade) so /admin/seo
 * shows the whole cluster's rank coverage, not just the head.
 *
 * Source: Google Keyword Planner via Apify (aitorsm/keyword-volume, mode=ideas,
 * geo=gb) pulled 8 Aug 2026 off the 12 Wave-1 head terms. The 194 raw ideas were
 * hand-curated to genuine SERVICE intent — competitor brand names (ag fencing,
 * barnard…), DIY/product intent (fence panels, posts, trellis) and suburb-level
 * terms (those belong to T3 pages) were dropped.
 *
 * KEY DIFFERENCE from the base seed: every row here is
 *   trackRankings=true, pagePublished=FALSE
 * The page is already published via its seeded head keyword — these rows are
 * pure rank-tracking, so they never touch the rollout gate (which publishes a
 * page when ANY of its keyword rows is pagePublished=true).
 *
 *   npx tsx scripts/_expand-wave1-clusters.ts
 *
 * Idempotent — upserts on (city, keyword); re-running only refreshes metrics.
 */
import { db } from '../server/db';
import { keywordTargets, type InsertKeywordTarget } from '../shared/schema';

type Row = {
    city: string; trade: string; keyword: string;
    intent: InsertKeywordTarget['intent'];
    vol: number; comp: InsertKeywordTarget['competition'];
};

// All Wave-1 trades are 'core' (Handy delivers directly).
const DATA: Row[] = [
    // ---- fencing · nottingham ----
    { city: 'nottingham', trade: 'fencing', keyword: 'fencing contractors nottingham', intent: 'trade_service', vol: 210, comp: 'HIGH' },
    { city: 'nottingham', trade: 'fencing', keyword: 'best fencing nottingham', intent: 'trade_service', vol: 210, comp: 'LOW' },
    { city: 'nottingham', trade: 'fencing', keyword: 'garden fencing nottingham', intent: 'trade_service', vol: 50, comp: 'HIGH' },
    { city: 'nottingham', trade: 'fencing', keyword: 'security fencing nottingham', intent: 'trade_service', vol: 20, comp: 'HIGH' },
    { city: 'nottingham', trade: 'fencing', keyword: 'fence installation nottingham', intent: 'trade_service', vol: 20, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'fencing', keyword: 'fencing services nottingham', intent: 'trade_service', vol: 10, comp: 'MEDIUM' },
    // ---- fencing · derby ----
    { city: 'derby', trade: 'fencing', keyword: 'fencing contractors derby', intent: 'trade_service', vol: 70, comp: 'HIGH' },
    { city: 'derby', trade: 'fencing', keyword: 'derby fencing services', intent: 'trade_service', vol: 40, comp: 'MEDIUM' },
    { city: 'derby', trade: 'fencing', keyword: 'garden fencing derby', intent: 'trade_service', vol: 40, comp: 'HIGH' },
    // ---- plasterer · nottingham ----
    { city: 'nottingham', trade: 'plasterer', keyword: 'venetian plastering nottingham', intent: 'trade_service', vol: 20, comp: 'LOW' },
    { city: 'nottingham', trade: 'plasterer', keyword: 'plastering companies in nottingham', intent: 'trade_service', vol: 20, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'plasterer', keyword: 'plastering contractors nottingham', intent: 'trade_service', vol: 10, comp: 'LOW' },
    { city: 'nottingham', trade: 'plasterer', keyword: 'plasterer nottingham prices', intent: 'informational', vol: 10, comp: 'HIGH' },
    // ---- landscaping · nottingham ----
    { city: 'nottingham', trade: 'landscaping', keyword: 'landscape gardeners nottingham', intent: 'trade_service', vol: 170, comp: 'HIGH' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'nottingham landscaping services', intent: 'trade_service', vol: 110, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'lawn care nottingham', intent: 'trade_service', vol: 70, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'garden designers nottingham', intent: 'trade_service', vol: 40, comp: 'HIGH' },
    { city: 'nottingham', trade: 'landscaping', keyword: 'hard landscaping nottingham', intent: 'trade_service', vol: 10, comp: 'HIGH' },
    // ---- landscaping · derby ----
    { city: 'derby', trade: 'landscaping', keyword: 'garden landscaping derby', intent: 'trade_service', vol: 140, comp: 'HIGH' },
    { city: 'derby', trade: 'landscaping', keyword: 'garden designers derby', intent: 'trade_service', vol: 40, comp: 'HIGH' },
    { city: 'derby', trade: 'landscaping', keyword: 'landscaping services derby', intent: 'trade_service', vol: 10, comp: 'UNKNOWN' },
    // ---- painter-decorator · nottingham ----
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'painters nottingham', intent: 'trade_service', vol: 590, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'painter decorator nottingham', intent: 'trade_service', vol: 590, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'exterior painters nottingham', intent: 'trade_service', vol: 20, comp: 'HIGH' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'commercial decorators nottingham', intent: 'trade_service', vol: 10, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'commercial painters nottingham', intent: 'trade_service', vol: 10, comp: 'LOW' },
    { city: 'nottingham', trade: 'painter-decorator', keyword: 'cheap painter and decorator nottingham', intent: 'trade_service', vol: 10, comp: 'LOW' },
    // ---- painter-decorator · derby ----
    { city: 'derby', trade: 'painter-decorator', keyword: 'commercial decorators derby', intent: 'trade_service', vol: 10, comp: 'HIGH' },
    // ---- handyman · derby ----
    { city: 'derby', trade: 'handyman', keyword: 'derby handyman services', intent: 'service_head', vol: 70, comp: 'MEDIUM' },
    { city: 'derby', trade: 'handyman', keyword: 'local handyman derby', intent: 'service_head', vol: 10, comp: 'UNKNOWN' },
    // ---- gutter-cleaning · nottingham ----
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'gutters nottingham', intent: 'trade_service', vol: 50, comp: 'HIGH' },
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'gutter cleaning nottingham prices', intent: 'informational', vol: 30, comp: 'HIGH' },
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'gutter cleaning services nottingham', intent: 'trade_service', vol: 20, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'guttering services nottingham', intent: 'trade_service', vol: 10, comp: 'MEDIUM' },
    { city: 'nottingham', trade: 'gutter-cleaning', keyword: 'gutter maintenance nottingham', intent: 'trade_service', vol: 10, comp: 'LOW' },
];

const TIER: Record<string, InsertKeywordTarget['tier']> = {
    service_head: 'T1_city_hub',
    upmarket: 'T4_segment',
    emergency: 'T5_emergency',
    trade_service: 'T2_service_city',
    informational: 'T4_segment',
    trade_supply: 'T2_service_city',
    brand_competitor: 'T2_service_city',
};
const INTENT_W: Record<string, number> = { emergency: 1.4, upmarket: 1.3, service_head: 1.1, trade_service: 1.0, informational: 0.6, trade_supply: 0.3, brand_competitor: 0.1 };

async function main() {
    let n = 0;
    for (const r of DATA) {
        const priorityScore = Math.round(r.vol * (INTENT_W[r.intent] ?? 1)); // all core → DELIV_W=1.0
        const row: InsertKeywordTarget = {
            city: r.city, trade: r.trade, keyword: r.keyword,
            intent: r.intent, tier: TIER[r.intent], deliverability: 'core',
            avgMonthlySearches: r.vol, competition: r.comp,
            priorityScore,
            trackRankings: true,        // track the whole cluster
            pagePublished: false,       // page already published via its head keyword — these are tracking-only
            bookingEnabled: false,
            source: 'google_keyword_planner',
            notes: 'wave1 cluster expansion (Apify ideas 8 Aug 2026)',
        };
        await db.insert(keywordTargets).values(row)
            .onConflictDoUpdate({
                target: [keywordTargets.city, keywordTargets.keyword],
                set: {
                    avgMonthlySearches: row.avgMonthlySearches,
                    competition: row.competition,
                    intent: row.intent,
                    tier: row.tier,
                    priorityScore: row.priorityScore,
                    updatedAt: new Date(),
                    // NB: does NOT touch pagePublished — never un-publishes a live page.
                },
            });
        n++;
    }
    const byTrade = new Map<string, number>();
    for (const r of DATA) byTrade.set(r.trade, (byTrade.get(r.trade) ?? 0) + 1);
    console.log(`Expanded Wave-1 clusters: +${n} tracked keywords (pagePublished=false).`);
    for (const [t, c] of byTrade) console.log(`  ${t}: +${c}`);
    console.log(`  All: trackRankings=true, tracking-only. Head terms already publish the pages.`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
