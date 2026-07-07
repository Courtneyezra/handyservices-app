/**
 * PRODUCTIZATION RESEARCH v2 — Semantic + Strict-Sent Filter
 *
 * Improvements vs v1:
 *   - Stricter "actually delivered to customer" filter:
 *       delivery_status IN ('delivered', 'read')
 *       OR viewed_at IS NOT NULL
 *       OR booked_at IS NOT NULL
 *   - Semantic matching via OpenAI text-embedding-3-small instead of lexical
 *       token overlap. Cosine similarity drives SKU matching and clustering.
 *
 * Outputs:
 *   1. Quote-level stats (constrained to genuinely-sent quotes)
 *   2. Semantic SKU coverage — what % of line items match existing SKU
 *      catalog by meaning, not words
 *   3. Semantic clustering — how many line items have ≥N close neighbours
 *      = "productizable pattern"
 *   4. Discovered SKU candidates — clusters that should become real SKUs
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getEmbeddingBatch } from "../server/skuDetector";

function pct(n: number, total: number): string {
    if (!total) return "0%";
    return `${((n / total) * 100).toFixed(1)}%`;
}

function bar(n: number, max: number, width = 30): string {
    if (!max) return "";
    return "█".repeat(Math.max(0, Math.round((n / max) * width)));
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
    console.log("\n=========================================");
    console.log("  PRODUCTIZATION RESEARCH v2");
    console.log("  Strict-sent filter + semantic matching");
    console.log("=========================================\n");

    // ============================================================
    // STEP 1 — Stricter pull: only quotes that REACHED a customer
    // ============================================================
    const quotesRes = await db.execute(sql`
        SELECT
            id, short_slug, customer_name, segment, job_description,
            base_price, categories, pricing_line_items,
            delivery_status, delivery_channel,
            viewed_at, booked_at, created_at
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL
          AND jsonb_typeof(pricing_line_items) = 'array'
          AND jsonb_array_length(pricing_line_items) > 0
          AND base_price IS NOT NULL
          AND base_price > 0
          AND customer_name IS NOT NULL
          AND customer_name NOT ILIKE '%test%'
          AND customer_name NOT ILIKE '%demo%'
          AND customer_name NOT ILIKE '%sample%'
          AND length(job_description) > 10
          AND (
                delivery_status IN ('delivered', 'read', 'sent')
             OR viewed_at IS NOT NULL
             OR booked_at IS NOT NULL
          )
        ORDER BY created_at DESC NULLS LAST
        LIMIT 100
    `);

    const quotes = quotesRes.rows as any[];
    console.log(`✓ Pulled ${quotes.length} quotes that genuinely reached a customer`);

    if (quotes.length === 0) {
        console.log("\nNo quotes matched the strict filter. Aborting.");
        process.exit(1);
    }

    const dates = quotes.map(q => q.created_at).filter(Boolean).map(d => new Date(d));
    if (dates.length) {
        const minD = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxD = new Date(Math.max(...dates.map(d => d.getTime())));
        console.log(`  Date range: ${minD.toISOString().slice(0,10)} → ${maxD.toISOString().slice(0,10)}`);
    }

    // Delivery breakdown
    let dDelivered = 0, dRead = 0, dSent = 0, dViewedOnly = 0, dBookedOnly = 0;
    for (const q of quotes) {
        const ds = q.delivery_status;
        if (ds === 'delivered') dDelivered++;
        else if (ds === 'read') dRead++;
        else if (ds === 'sent') dSent++;
        else if (q.viewed_at) dViewedOnly++;
        else if (q.booked_at) dBookedOnly++;
    }
    console.log(`  Delivery status: delivered=${dDelivered}, read=${dRead}, sent=${dSent}, viewed-no-status=${dViewedOnly}, booked-no-status=${dBookedOnly}`);

    // ============================================================
    // STEP 2 — Quote-level stats
    // ============================================================
    console.log("\n=== QUOTE STATS (verified-sent only) ===\n");
    const totalRevenue = quotes.reduce((s, q) => s + (q.base_price || 0), 0);
    const prices = quotes.map(q => q.base_price).filter(Boolean).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const segments: Record<string, number> = {};
    const viewed = quotes.filter(q => q.viewed_at).length;
    const booked = quotes.filter(q => q.booked_at).length;
    for (const q of quotes) {
        const s = q.segment || "UNKNOWN";
        segments[s] = (segments[s] || 0) + 1;
    }
    console.log(`Total quoted value: £${(totalRevenue/100).toFixed(0)}`);
    console.log(`Avg / Median quote: £${(totalRevenue/quotes.length/100).toFixed(0)} / £${(median/100).toFixed(0)}`);
    console.log(`Viewed: ${viewed} (${pct(viewed, quotes.length)})`);
    console.log(`Booked: ${booked} (${pct(booked, quotes.length)})`);

    // ============================================================
    // STEP 3 — Expand line items
    // ============================================================
    type LineItem = {
        quoteId: string;
        quoteIdx: number;
        desc: string;
        category: string;
        pricePence: number;
        minutes: number;
        embedding?: number[];
    };
    const allItems: LineItem[] = [];
    for (let i = 0; i < quotes.length; i++) {
        const q = quotes[i];
        const items = q.pricing_line_items;
        if (!Array.isArray(items)) continue;
        for (const li of items) {
            const desc = String(li.description || li.label || li.name || "").trim();
            if (!desc) continue;
            allItems.push({
                quoteId: q.id,
                quoteIdx: i,
                desc,
                category: String(li.category || "(none)"),
                pricePence: parseInt(li.guardedPricePence || li.llmSuggestedPricePence || li.priceInPence || "0", 10),
                minutes: parseInt(li.timeEstimateMinutes || li.estimatedMinutes || "0", 10),
            });
        }
    }
    console.log(`\nTotal line items: ${allItems.length}  (avg ${(allItems.length/quotes.length).toFixed(2)}/quote)`);

    // ============================================================
    // STEP 4 — Get embeddings for all line items + SKU catalog
    // ============================================================
    console.log("\n=== EMBEDDING (OpenAI text-embedding-3-small) ===\n");
    console.log(`Embedding ${allItems.length} line items + SKU catalog...`);

    const lineTexts = allItems.map(li => li.desc);
    const t0 = Date.now();
    const lineEmbs = await getEmbeddingBatch(lineTexts);
    console.log(`  Line items embedded in ${((Date.now()-t0)/1000).toFixed(1)}s`);

    for (let i = 0; i < allItems.length; i++) {
        const e = lineEmbs[i];
        if (e) allItems[i].embedding = e;
    }
    const validItems = allItems.filter(it => it.embedding);
    console.log(`  Valid embeddings: ${validItems.length}/${allItems.length}`);

    // SKU catalog with embeddings
    const skuRows = await db.execute(sql`
        SELECT sku_code, name, description, price_pence, time_estimate_minutes, category, keywords
        FROM productized_services
        WHERE is_active = true
    `);
    const skus = skuRows.rows as any[];
    const skuTexts = skus.map(s => {
        const keywordsStr = Array.isArray(s.keywords) ? s.keywords.join(' ') : (s.keywords || '');
        return `${s.name}. ${s.description || ''}. ${keywordsStr}`.trim();
    });
    const t1 = Date.now();
    const skuEmbs = await getEmbeddingBatch(skuTexts);
    console.log(`  ${skus.length} SKUs embedded in ${((Date.now()-t1)/1000).toFixed(1)}s`);

    // ============================================================
    // STEP 5 — Semantic SKU coverage
    // ============================================================
    console.log("\n=== SEMANTIC SKU COVERAGE ===\n");
    const SKU_MATCH_THRESHOLD = 0.55; // cosine — same SKU/closely related
    const SKU_LOOSE_THRESHOLD = 0.45; // same broad service

    let strictMatched = 0;
    let looseMatched = 0;
    const matchByCode: Record<string, { count: number; avgSim: number; sims: number[] }> = {};
    const unmatched: { item: LineItem; bestSim: number; bestCode: string }[] = [];

    for (const it of validItems) {
        let bestSim = -1, bestIdx = -1;
        for (let j = 0; j < skus.length; j++) {
            const skuE = skuEmbs[j];
            if (!skuE) continue;
            const sim = cosine(it.embedding!, skuE);
            if (sim > bestSim) { bestSim = sim; bestIdx = j; }
        }
        if (bestSim >= SKU_MATCH_THRESHOLD) {
            strictMatched++;
            const code = skus[bestIdx].sku_code;
            if (!matchByCode[code]) matchByCode[code] = { count: 0, avgSim: 0, sims: [] };
            matchByCode[code].count++;
            matchByCode[code].sims.push(bestSim);
        } else if (bestSim >= SKU_LOOSE_THRESHOLD) {
            looseMatched++;
            unmatched.push({ item: it, bestSim, bestCode: skus[bestIdx]?.sku_code || "?" });
        } else {
            unmatched.push({ item: it, bestSim, bestCode: skus[bestIdx]?.sku_code || "?" });
        }
    }

    for (const k of Object.keys(matchByCode)) {
        const sims = matchByCode[k].sims;
        matchByCode[k].avgSim = sims.reduce((a,b)=>a+b,0) / sims.length;
    }

    console.log(`Lines that semantically MATCH a SKU (cosine ≥ ${SKU_MATCH_THRESHOLD}):  ${strictMatched}  (${pct(strictMatched, validItems.length)})`);
    console.log(`Lines that LOOSELY match a SKU (${SKU_LOOSE_THRESHOLD} ≤ cosine < ${SKU_MATCH_THRESHOLD}):       ${looseMatched}  (${pct(looseMatched, validItems.length)})`);
    console.log(`Lines that DON'T match any SKU (cosine < ${SKU_LOOSE_THRESHOLD}):              ${validItems.length - strictMatched - looseMatched}  (${pct(validItems.length - strictMatched - looseMatched, validItems.length)})`);

    console.log("\n--- TOP SEMANTIC SKU MATCHES ---");
    Object.entries(matchByCode).sort((a, b) => b[1].count - a[1].count).slice(0, 20).forEach(([code, v]) => {
        const sku = skus.find(s => s.sku_code === code);
        console.log(`  ${String(v.count).padStart(3)}  sim=${v.avgSim.toFixed(2)}  ${code.padEnd(28)}  ${(sku?.name || "").slice(0, 40)}`);
    });

    // ============================================================
    // STEP 6 — Semantic clustering (the real productizability signal)
    // ============================================================
    console.log("\n=== SEMANTIC CLUSTERING (line item ↔ line item) ===\n");
    console.log("For each line item, count how many OTHER line items are semantically close (cosine ≥ 0.65)");
    console.log("This reveals productizable patterns INDEPENDENT of word choice.\n");

    const CLUSTER_THRESHOLD = 0.65;
    const neighbours: number[] = new Array(validItems.length).fill(0);

    for (let i = 0; i < validItems.length; i++) {
        for (let j = i + 1; j < validItems.length; j++) {
            const sim = cosine(validItems[i].embedding!, validItems[j].embedding!);
            if (sim >= CLUSTER_THRESHOLD) {
                neighbours[i]++;
                neighbours[j]++;
            }
        }
    }

    let n0 = 0, n1 = 0, n2 = 0, n3plus = 0;
    for (const n of neighbours) {
        if (n === 0) n0++;
        else if (n === 1) n1++;
        else if (n === 2) n2++;
        else n3plus++;
    }

    console.log(`Lines with 0 close neighbours (truly unique):       ${n0}  (${pct(n0, validItems.length)})`);
    console.log(`Lines with 1 close neighbour (rare):                ${n1}  (${pct(n1, validItems.length)})`);
    console.log(`Lines with 2 close neighbours (emerging pattern):   ${n2}  (${pct(n2, validItems.length)})`);
    console.log(`Lines with 3+ close neighbours (productizable):     ${n3plus}  (${pct(n3plus, validItems.length)})`);

    const semProductizable = n3plus + n2;
    console.log(`\n► Semantically productizable (≥2 neighbours):     ${semProductizable}  (${pct(semProductizable, validItems.length)})`);

    // ============================================================
    // STEP 7 — Discover SKU candidates from clusters
    // ============================================================
    console.log("\n=== DISCOVERED SKU CANDIDATES (greedy clustering) ===\n");
    console.log("Greedy: pick highest-degree item as cluster centroid, attach all close neighbours, remove, repeat.\n");

    const used = new Set<number>();
    type Cluster = { centroid: number; members: number[]; avgPrice: number; avgMinutes: number; samples: string[] };
    const clusters: Cluster[] = [];

    // Compute pairs once
    const SIMS: number[][] = Array.from({ length: validItems.length }, () => []);
    // re-compute (small n, no big cost)
    for (let i = 0; i < validItems.length; i++) {
        for (let j = 0; j < validItems.length; j++) {
            if (i === j) { SIMS[i][j] = 1; continue; }
            if (j < i) { SIMS[i][j] = SIMS[j][i]; continue; }
            SIMS[i][j] = cosine(validItems[i].embedding!, validItems[j].embedding!);
        }
    }

    while (used.size < validItems.length) {
        // Pick item with most unused close neighbours
        let bestIdx = -1, bestCount = -1;
        for (let i = 0; i < validItems.length; i++) {
            if (used.has(i)) continue;
            let count = 0;
            for (let j = 0; j < validItems.length; j++) {
                if (i === j || used.has(j)) continue;
                if (SIMS[i][j] >= CLUSTER_THRESHOLD) count++;
            }
            if (count > bestCount) { bestCount = count; bestIdx = i; }
        }
        if (bestIdx === -1) break;

        const members = [bestIdx];
        used.add(bestIdx);
        for (let j = 0; j < validItems.length; j++) {
            if (j === bestIdx || used.has(j)) continue;
            if (SIMS[bestIdx][j] >= CLUSTER_THRESHOLD) {
                members.push(j);
                used.add(j);
            }
        }

        if (members.length >= 2) {
            const mItems = members.map(m => validItems[m]);
            const avgPrice = mItems.reduce((s, x) => s + x.pricePence, 0) / mItems.length / 100;
            const avgMinutes = mItems.reduce((s, x) => s + x.minutes, 0) / mItems.length;
            clusters.push({
                centroid: bestIdx,
                members,
                avgPrice,
                avgMinutes,
                samples: mItems.slice(0, 4).map(x => x.desc.slice(0, 80)),
            });
        }
    }

    const clusterCovered = clusters.reduce((s, c) => s + c.members.length, 0);
    console.log(`Clusters of size ≥2: ${clusters.length}`);
    console.log(`Line items covered by a cluster: ${clusterCovered} (${pct(clusterCovered, validItems.length)})`);
    console.log(`Singletons (no semantic neighbours):  ${validItems.length - clusterCovered}  (${pct(validItems.length - clusterCovered, validItems.length)})\n`);

    console.log("Top 25 discovered clusters (= candidate new SKUs):");
    console.log("  size  £avg  min   sample-1 / sample-2 / sample-3");
    clusters.sort((a, b) => b.members.length - a.members.length).slice(0, 25).forEach((c, i) => {
        console.log(`  ${String(c.members.length).padStart(3)}  £${String(Math.round(c.avgPrice)).padStart(4)}  ${String(Math.round(c.avgMinutes)).padStart(4)}m`);
        c.samples.forEach(s => console.log(`        • ${s}`));
        console.log("");
    });

    // ============================================================
    // STEP 8 — Verdict
    // ============================================================
    console.log("\n=========================================");
    console.log("  VERDICT (semantic + verified-sent)");
    console.log("=========================================\n");

    const skuCoverageTotal = strictMatched + looseMatched;
    console.log(`Semantic SKU coverage (existing 60 SKUs):`);
    console.log(`  Strict matches (cosine ≥ ${SKU_MATCH_THRESHOLD}):       ${pct(strictMatched, validItems.length)}`);
    console.log(`  + loose matches (≥ ${SKU_LOOSE_THRESHOLD}):              ${pct(skuCoverageTotal, validItems.length)}`);
    console.log("");
    console.log(`Intrinsic productizability (clustering):`);
    console.log(`  Lines in a cluster of ≥2 (semantically repeats):   ${pct(clusterCovered, validItems.length)}`);
    console.log(`  Lines with ≥3 close neighbours (strong patterns):  ${pct(n3plus, validItems.length)}`);
    console.log(`  Truly unique singletons (custom):                  ${pct(validItems.length - clusterCovered, validItems.length)}`);
    console.log("");
    console.log(`Distinct discovered SKU candidates: ${clusters.length}`);

    const semP = clusterCovered / validItems.length;
    console.log("\n— Interpretation —\n");
    if (semP >= 0.6) {
        console.log("  ✓ STRONG productization signal.");
        console.log("    Most work clusters semantically — your line items ARE repeating,");
        console.log("    just phrased differently each time. Build SKUs from these clusters.");
    } else if (semP >= 0.35) {
        console.log("  ◐ HYBRID model is the right answer.");
        console.log("    A meaningful share of work clusters; the rest is genuinely one-off.");
        console.log("    Build ~15-30 parametric SKUs from the discovered clusters; allow");
        console.log("    free-form lines for the tail.");
    } else {
        console.log("  ✗ Work is genuinely custom even semantically.");
        console.log("    Productize the process (templates, time/price estimators), not the catalog.");
    }

    console.log("\n=========================================\n");
    process.exit(0);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
