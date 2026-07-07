/**
 * PRODUCTIZATION RESEARCH — Last 100 Real Customer Quotes
 *
 * Question: Can we productize our handyman business with SKUs, or are
 * line items too custom?
 *
 * Approach:
 *   1. Pull last 100 quotes with real line items (exclude test/empty).
 *   2. Expand line items, count repetition, fuzzy-group descriptions.
 *   3. Match line items to existing SKU catalog to compute coverage.
 *   4. Bucket by duration / price to see SKU-shape feasibility.
 *   5. Score each quote: % "productizable" vs "custom".
 *   6. Output a decision-grade report.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

function normWords(text: string, n: number): string {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\b(a|an|the|and|or|of|in|on|to|for|with|my|your|please|need|some|just|new|old|already|customer|supplied|approx|approximately|x|that|this|is|are|be|have|has|had|do|does|will|would|should|could|may|might|must|shall|small|large|big|medium|main|extra|other|same|like|first|second|third|fourth|fifth)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, n)
        .join(" ");
}

function pct(n: number, total: number): string {
    if (!total) return "0%";
    return `${((n / total) * 100).toFixed(1)}%`;
}

function bar(n: number, max: number, width = 30): string {
    if (!max) return "";
    return "█".repeat(Math.round((n / max) * width));
}

async function main() {
    console.log("\n=========================================");
    console.log("  PRODUCTIZATION RESEARCH");
    console.log("  Last 100 Real Customer Quotes");
    console.log("=========================================\n");

    // ============================================================
    // STEP 1 — Pull last 100 REAL quotes (filter test/empty)
    // ============================================================
    const quotesRes = await db.execute(sql`
        SELECT
            id,
            short_slug,
            customer_name,
            phone,
            segment,
            job_description,
            base_price,
            categories,
            pricing_line_items,
            booked_at,
            viewed_at,
            payment_type,
            created_at,
            cost_pence,
            margin_percent
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
        ORDER BY created_at DESC NULLS LAST
        LIMIT 100
    `);

    const quotes = quotesRes.rows as any[];
    console.log(`✓ Pulled ${quotes.length} real customer quotes\n`);

    if (quotes.length === 0) {
        console.log("No quotes found — aborting.");
        process.exit(1);
    }

    // Date range
    const dates = quotes.map(q => q.created_at).filter(Boolean).map(d => new Date(d));
    if (dates.length) {
        const minD = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxD = new Date(Math.max(...dates.map(d => d.getTime())));
        console.log(`Date range: ${minD.toISOString().slice(0,10)} → ${maxD.toISOString().slice(0,10)}\n`);
    }

    // ============================================================
    // STEP 2 — Quote-level summary stats
    // ============================================================
    console.log("=== QUOTE-LEVEL STATS ===\n");
    const totalRevenue = quotes.reduce((s, q) => s + (q.base_price || 0), 0);
    const prices = quotes.map(q => q.base_price).filter(Boolean).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const p25 = prices[Math.floor(prices.length * 0.25)];
    const p75 = prices[Math.floor(prices.length * 0.75)];
    const segments: Record<string, number> = {};
    const booked = quotes.filter(q => q.booked_at).length;
    const viewed = quotes.filter(q => q.viewed_at).length;

    for (const q of quotes) {
        const s = q.segment || "UNKNOWN";
        segments[s] = (segments[s] || 0) + 1;
    }

    console.log(`Total quoted value: £${(totalRevenue / 100).toFixed(0)}`);
    console.log(`Avg quote: £${(totalRevenue / quotes.length / 100).toFixed(0)}`);
    console.log(`Median quote: £${(median / 100).toFixed(0)}`);
    console.log(`P25 / P75: £${(p25 / 100).toFixed(0)} / £${(p75 / 100).toFixed(0)}`);
    console.log(`Viewed by customer: ${viewed} (${pct(viewed, quotes.length)})`);
    console.log(`Booked: ${booked} (${pct(booked, quotes.length)})`);
    console.log(`\nSegment mix:`);
    Object.entries(segments).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => {
        console.log(`  ${s.padEnd(20)} ${String(n).padStart(3)}  ${bar(n, quotes.length)}`);
    });

    // ============================================================
    // STEP 3 — Expand all line items
    // ============================================================
    console.log("\n=== LINE-ITEM EXPANSION ===\n");
    type LineItem = {
        quoteId: string;
        quoteIdx: number;
        desc: string;
        category: string;
        pricePence: number;
        minutes: number;
        materialsCostPence: number;
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
                materialsCostPence: parseInt(li.materialsCostPence || "0", 10),
            });
        }
    }

    console.log(`Total line items: ${allItems.length}`);
    console.log(`Avg lines per quote: ${(allItems.length / quotes.length).toFixed(2)}`);

    // Quotes by # of lines
    const linesPerQuote: Record<number, number> = {};
    for (let i = 0; i < quotes.length; i++) {
        const n = (quotes[i].pricing_line_items?.length || 0);
        linesPerQuote[n] = (linesPerQuote[n] || 0) + 1;
    }
    console.log(`\nLine count distribution:`);
    Object.entries(linesPerQuote).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([k, v]) => {
        console.log(`  ${k.padStart(2)} lines: ${String(v).padStart(3)}  ${bar(v, quotes.length, 20)}`);
    });

    // ============================================================
    // STEP 4 — Category frequency
    // ============================================================
    console.log("\n=== CATEGORY FREQUENCY ===\n");
    const catCounts: Record<string, { count: number; revenue: number; mins: number }> = {};
    for (const it of allItems) {
        if (!catCounts[it.category]) catCounts[it.category] = { count: 0, revenue: 0, mins: 0 };
        catCounts[it.category].count++;
        catCounts[it.category].revenue += it.pricePence;
        catCounts[it.category].mins += it.minutes;
    }
    const catEntries = Object.entries(catCounts).sort((a, b) => b[1].count - a[1].count);
    console.log("  cnt   share   revenue  avg£   avg-min  category");
    catEntries.forEach(([cat, v]) => {
        const share = pct(v.count, allItems.length);
        const avgP = v.count ? Math.round(v.revenue / v.count / 100) : 0;
        const avgM = v.count ? Math.round(v.mins / v.count) : 0;
        console.log(
            `  ${String(v.count).padStart(3)}   ${share.padStart(5)}  £${String(Math.round(v.revenue / 100)).padStart(5)}  £${String(avgP).padStart(4)}  ${String(avgM).padStart(4)}m   ${cat}`
        );
    });

    // ============================================================
    // STEP 5 — Description repetition (the productization signal)
    // ============================================================
    console.log("\n=== DESCRIPTION REPETITION (THE KEY SIGNAL) ===\n");

    type Bucket = {
        count: number;
        samples: string[];
        cats: Set<string>;
        prices: number[];
        mins: number[];
    };

    const buckets3: Record<string, Bucket> = {};
    const buckets5: Record<string, Bucket> = {};
    for (const it of allItems) {
        const k3 = normWords(it.desc, 3);
        const k5 = normWords(it.desc, 5);
        if (k3) {
            buckets3[k3] = buckets3[k3] || { count: 0, samples: [], cats: new Set(), prices: [], mins: [] };
            buckets3[k3].count++;
            buckets3[k3].cats.add(it.category);
            buckets3[k3].prices.push(it.pricePence);
            buckets3[k3].mins.push(it.minutes);
            if (buckets3[k3].samples.length < 3) buckets3[k3].samples.push(it.desc.slice(0, 90));
        }
        if (k5) {
            buckets5[k5] = buckets5[k5] || { count: 0, samples: [], cats: new Set(), prices: [], mins: [] };
            buckets5[k5].count++;
            buckets5[k5].cats.add(it.category);
            buckets5[k5].prices.push(it.pricePence);
            buckets5[k5].mins.push(it.minutes);
            if (buckets5[k5].samples.length < 2) buckets5[k5].samples.push(it.desc.slice(0, 90));
        }
    }

    const totalBuckets3 = Object.keys(buckets3).length;
    const totalBuckets5 = Object.keys(buckets5).length;

    // Repetition coverage
    const sorted3 = Object.entries(buckets3).sort((a, b) => b[1].count - a[1].count);
    const repeatedLines3 = sorted3.filter(([, v]) => v.count >= 2).reduce((s, [, v]) => s + v.count, 0);
    const uniqueLines3 = allItems.length - repeatedLines3;

    console.log(`Total line items:          ${allItems.length}`);
    console.log(`Distinct 3-word prefixes:  ${totalBuckets3}`);
    console.log(`Distinct 5-word prefixes:  ${totalBuckets5}`);
    console.log(`Lines that repeat (3w):    ${repeatedLines3} (${pct(repeatedLines3, allItems.length)})`);
    console.log(`Lines that are one-off:    ${uniqueLines3} (${pct(uniqueLines3, allItems.length)})`);

    console.log("\n--- TOP 40 REPEATING JOB-TYPES (3-word fingerprint) ---\n");
    console.log("  cnt  share  £avg  range       min   sample");
    sorted3.slice(0, 40).forEach(([k, v]) => {
        const share = pct(v.count, allItems.length);
        const avgP = Math.round(v.prices.reduce((a, b) => a + b, 0) / v.prices.length / 100);
        const minP = Math.round(Math.min(...v.prices) / 100);
        const maxP = Math.round(Math.max(...v.prices) / 100);
        const avgM = Math.round(v.mins.reduce((a, b) => a + b, 0) / v.mins.length);
        console.log(
            `  ${String(v.count).padStart(3)}  ${share.padStart(5)}  £${String(avgP).padStart(4)}  £${String(minP).padStart(4)}-£${String(maxP).padEnd(5)}  ${String(avgM).padStart(4)}m  ${k}`
        );
        console.log(`        ↳ ${v.samples[0]}`);
    });

    // ============================================================
    // STEP 6 — SKU coverage analysis
    // ============================================================
    console.log("\n=== SKU CATALOG MATCH ===\n");
    const skus = await db.execute(sql`
        SELECT sku_code, name, price_pence, time_estimate_minutes, keywords, category
        FROM productized_services
        WHERE is_active = true
    `);
    const skuList = skus.rows as any[];
    console.log(`Active SKUs in catalog: ${skuList.length}`);

    // Build a simple keyword-bag matcher
    type SkuMatcher = { code: string; name: string; price: number; tokens: Set<string> };
    const skuMatchers: SkuMatcher[] = skuList.map(s => {
        const tokens = new Set<string>();
        for (const t of (s.name || "").toLowerCase().split(/[^a-z0-9]+/)) if (t.length > 2) tokens.add(t);
        const kws = s.keywords;
        if (Array.isArray(kws)) {
            for (const kw of kws) {
                for (const t of String(kw).toLowerCase().split(/[^a-z0-9]+/)) if (t.length > 2) tokens.add(t);
            }
        } else if (typeof kws === "string") {
            for (const t of kws.toLowerCase().split(/[^a-z0-9]+/)) if (t.length > 2) tokens.add(t);
        }
        return { code: s.sku_code, name: s.name, price: s.price_pence, tokens };
    });

    let matched = 0;
    const matchByCode: Record<string, number> = {};
    const unmatched: LineItem[] = [];
    for (const it of allItems) {
        const itTokens = new Set(it.desc.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2));
        let best: { sku: SkuMatcher; score: number } | null = null;
        for (const sku of skuMatchers) {
            let overlap = 0;
            for (const t of sku.tokens) if (itTokens.has(t)) overlap++;
            // Require at least 2 matching tokens AND coverage of >= 40% of SKU tokens to claim a match
            if (overlap >= 2 && overlap / sku.tokens.size >= 0.4) {
                if (!best || overlap > best.score) best = { sku, score: overlap };
            }
        }
        if (best) {
            matched++;
            matchByCode[best.sku.code] = (matchByCode[best.sku.code] || 0) + 1;
        } else {
            unmatched.push(it);
        }
    }

    console.log(`Line items matchable to existing SKU: ${matched} (${pct(matched, allItems.length)})`);
    console.log(`Line items NOT matchable:             ${allItems.length - matched} (${pct(allItems.length - matched, allItems.length)})`);

    console.log("\n--- TOP 25 MATCHED SKUs ---");
    Object.entries(matchByCode).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([code, n]) => {
        const sku = skuList.find(s => s.sku_code === code);
        console.log(`  ${String(n).padStart(3)}  ${code.padEnd(34)}  ${(sku?.name || "").slice(0, 50)}`);
    });

    console.log("\n--- SAMPLE OF UNMATCHED LINE ITEMS (10) ---");
    unmatched.slice(0, 10).forEach((it, i) => {
        console.log(`  [${i + 1}] £${(it.pricePence / 100).toFixed(0)} ${it.minutes}m [${it.category}]`);
        console.log(`        ${it.desc.slice(0, 110)}`);
    });

    // ============================================================
    // STEP 7 — Duration distribution (SKU shape)
    // ============================================================
    console.log("\n=== DURATION DISTRIBUTION (SKU-shape check) ===\n");
    const durBuckets: Record<string, number> = {
        "0-30m": 0, "31-60m": 0, "61-90m": 0, "91-120m": 0,
        "2-3h": 0, "3-4h": 0, "4-6h": 0, "6-8h": 0, "8h+": 0,
    };
    for (const it of allItems) {
        const m = it.minutes;
        if (!m) continue;
        if (m <= 30) durBuckets["0-30m"]++;
        else if (m <= 60) durBuckets["31-60m"]++;
        else if (m <= 90) durBuckets["61-90m"]++;
        else if (m <= 120) durBuckets["91-120m"]++;
        else if (m <= 180) durBuckets["2-3h"]++;
        else if (m <= 240) durBuckets["3-4h"]++;
        else if (m <= 360) durBuckets["4-6h"]++;
        else if (m <= 480) durBuckets["6-8h"]++;
        else durBuckets["8h+"]++;
    }
    const durTotal = Object.values(durBuckets).reduce((a, b) => a + b, 0);
    const skuShape = durBuckets["0-30m"] + durBuckets["31-60m"] + durBuckets["61-90m"] + durBuckets["91-120m"];
    Object.entries(durBuckets).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}  ${pct(v, durTotal).padStart(6)}  ${bar(v, Math.max(...Object.values(durBuckets)), 25)}`);
    });
    console.log(`\n  Lines ≤ 2h (typical SKU shape):  ${skuShape}/${durTotal} = ${pct(skuShape, durTotal)}`);
    console.log(`  Lines > 4h (custom/day-job):     ${durBuckets["4-6h"] + durBuckets["6-8h"] + durBuckets["8h+"]}/${durTotal} = ${pct(durBuckets["4-6h"] + durBuckets["6-8h"] + durBuckets["8h+"], durTotal)}`);

    // ============================================================
    // STEP 8 — Quote-level productizability score
    // ============================================================
    console.log("\n=== PER-QUOTE PRODUCTIZABILITY ===\n");
    // For each quote, what % of its lines were matchable to a SKU?
    const quoteScores: { id: string; idx: number; lines: number; matched: number; pct: number; desc: string; price: number }[] = [];
    for (let i = 0; i < quotes.length; i++) {
        const q = quotes[i];
        const lis: LineItem[] = allItems.filter(li => li.quoteIdx === i);
        if (!lis.length) continue;
        const itTokens = lis.map(li => new Set(li.desc.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2)));
        let qMatched = 0;
        for (const tokSet of itTokens) {
            for (const sku of skuMatchers) {
                let overlap = 0;
                for (const t of sku.tokens) if (tokSet.has(t)) overlap++;
                if (overlap >= 2 && overlap / sku.tokens.size >= 0.4) { qMatched++; break; }
            }
        }
        quoteScores.push({
            id: q.id,
            idx: i,
            lines: lis.length,
            matched: qMatched,
            pct: qMatched / lis.length,
            desc: (q.job_description || "").slice(0, 80),
            price: q.base_price || 0,
        });
    }

    const fullyProductizable = quoteScores.filter(q => q.pct >= 0.9).length;
    const mostlyProductizable = quoteScores.filter(q => q.pct >= 0.5 && q.pct < 0.9).length;
    const partlyCustom = quoteScores.filter(q => q.pct >= 0.2 && q.pct < 0.5).length;
    const fullyCustom = quoteScores.filter(q => q.pct < 0.2).length;

    console.log(`Quotes ≥90% productizable:     ${fullyProductizable}  (${pct(fullyProductizable, quoteScores.length)})  ← drop-in SKU candidates`);
    console.log(`Quotes 50-89% productizable:   ${mostlyProductizable}  (${pct(mostlyProductizable, quoteScores.length)})  ← SKU + 1-2 custom adds`);
    console.log(`Quotes 20-49% productizable:   ${partlyCustom}  (${pct(partlyCustom, quoteScores.length)})  ← mixed jobs`);
    console.log(`Quotes <20% productizable:     ${fullyCustom}  (${pct(fullyCustom, quoteScores.length)})  ← truly custom`);

    // Revenue weighted
    const revFully = quoteScores.filter(q => q.pct >= 0.9).reduce((s, q) => s + q.price, 0);
    const revMostly = quoteScores.filter(q => q.pct >= 0.5 && q.pct < 0.9).reduce((s, q) => s + q.price, 0);
    const revPartly = quoteScores.filter(q => q.pct >= 0.2 && q.pct < 0.5).reduce((s, q) => s + q.price, 0);
    const revCustom = quoteScores.filter(q => q.pct < 0.2).reduce((s, q) => s + q.price, 0);
    const totalRev = revFully + revMostly + revPartly + revCustom;
    console.log(`\nRevenue mix:`);
    console.log(`  Fully SKU-able:     £${(revFully / 100).toFixed(0).padStart(5)}  (${pct(revFully, totalRev)})`);
    console.log(`  Mostly SKU-able:    £${(revMostly / 100).toFixed(0).padStart(5)}  (${pct(revMostly, totalRev)})`);
    console.log(`  Partly custom:      £${(revPartly / 100).toFixed(0).padStart(5)}  (${pct(revPartly, totalRev)})`);
    console.log(`  Fully custom:       £${(revCustom / 100).toFixed(0).padStart(5)}  (${pct(revCustom, totalRev)})`);

    // ============================================================
    // STEP 9 — Sample customer quotes (last 15) with classification
    // ============================================================
    console.log("\n=== SAMPLE CUSTOMER QUOTES (15 most recent) ===\n");
    quotes.slice(0, 15).forEach((q, i) => {
        const score = quoteScores.find(s => s.idx === i);
        const lis = allItems.filter(l => l.quoteIdx === i);
        const verdict = !score ? "?" :
            score.pct >= 0.9 ? "SKU-able    " :
            score.pct >= 0.5 ? "Mostly SKU  " :
            score.pct >= 0.2 ? "Mixed       " :
            "Custom      ";
        console.log(`\n[${i + 1}] £${((q.base_price || 0) / 100).toFixed(0).padStart(4)}  ${q.segment || "?"}  ${verdict}  (${lis.length} lines)`);
        console.log(`    Job: ${(q.job_description || "").replace(/\s+/g, " ").slice(0, 130)}`);
        lis.slice(0, 6).forEach(li => {
            console.log(`     • £${(li.pricePence / 100).toFixed(0).padStart(4)} ${li.minutes}m [${li.category}] ${li.desc.slice(0, 90)}`);
        });
        if (lis.length > 6) console.log(`     • ... +${lis.length - 6} more lines`);
    });

    // ============================================================
    // STEP 10 — Verdict
    // ============================================================
    console.log("\n=========================================");
    console.log("  VERDICT — PRODUCTIZATION FEASIBILITY");
    console.log("=========================================\n");

    const repeatPct = repeatedLines3 / allItems.length;
    const shortJobPct = skuShape / Math.max(durTotal, 1);
    const productizable = (fullyProductizable + mostlyProductizable) / quoteScores.length;
    const productizableRev = (revFully + revMostly) / Math.max(totalRev, 1);

    console.log(`Line-item repetition rate (3-word):      ${pct(repeatedLines3, allItems.length)}`);
    console.log(`Lines fitting SKU shape (≤2h):           ${pct(skuShape, durTotal)}`);
    console.log(`Lines matchable to existing SKU catalog: ${pct(matched, allItems.length)}`);
    console.log(`Quotes ≥50% productizable:               ${pct(fullyProductizable + mostlyProductizable, quoteScores.length)}`);
    console.log(`Revenue ≥50% productizable:              ${pct(revFully + revMostly, totalRev)}`);

    console.log(`\n— Interpretation —\n`);
    if (productizable >= 0.6 && repeatPct >= 0.4) {
        console.log("  ✓ STRONG CASE FOR PRODUCTIZATION.");
        console.log("    The majority of work is SKU-shaped & repetitive.");
        console.log("    Recommend: Build a tight catalog of ~20-40 SKUs covering the top repeating");
        console.log("    job-types, allow 1-2 custom lines per quote, and dispatch by SKU bundle.");
    } else if (productizable >= 0.3 || repeatPct >= 0.25) {
        console.log("  ◐ HYBRID MODEL is the right answer.");
        console.log("    A meaningful portion of work is SKU-able but you have a long tail of custom.");
        console.log("    Recommend: 'SKU + custom' quote builder. Use SKUs for fast-quote channel");
        console.log("    (web form / WhatsApp instant), use custom mode for assessment jobs.");
        console.log("    Daily planning improves by routing SKU jobs into dispatchable packs.");
    } else {
        console.log("  ✗ WORK IS GENUINELY CUSTOM.");
        console.log("    Repetition is too low to drive operations from a SKU catalog.");
        console.log("    Recommend: Keep custom quoting. Productize the *process* (templates,");
        console.log("    reference prices, time estimates) rather than the catalog.");
    }

    console.log("\n=========================================\n");
    process.exit(0);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
