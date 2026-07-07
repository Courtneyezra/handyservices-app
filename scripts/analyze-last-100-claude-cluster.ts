/**
 * PRODUCTIZATION RESEARCH v3 — Strict-sent + Claude semantic clustering
 *
 * Same goal as v2 but uses Claude (Anthropic SDK) instead of OpenAI embeddings
 * because the OpenAI quota is exhausted.
 *
 * Claude reads all line items at once and groups them into semantic clusters,
 * giving us both:
 *   (a) productizable % (lines in any cluster of size ≥ 2)
 *   (b) discovered SKU candidates (cluster labels + sizes)
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

function pct(n: number, total: number): string {
    if (!total) return "0%";
    return `${((n / total) * 100).toFixed(1)}%`;
}

// dotenv (used by server/db.ts) drops some vars after a parse hiccup. Fall back
// to reading .env directly so this script doesn't fail to find the Anthropic key.
function loadAnthropicKey(): string {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    try {
        const envPath = path.resolve(process.cwd(), ".env");
        const text = fs.readFileSync(envPath, "utf8");
        for (const rawLine of text.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const m = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
            if (m) {
                let val = m[1].trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                process.env.ANTHROPIC_API_KEY = val;
                return val;
            }
        }
    } catch {}
    throw new Error("ANTHROPIC_API_KEY not found in env or .env");
}

const anthropic = new Anthropic({ apiKey: loadAnthropicKey() });

async function main() {
    console.log("\n=========================================");
    console.log("  PRODUCTIZATION RESEARCH v3");
    console.log("  Strict-sent filter + Claude clustering");
    console.log("=========================================\n");

    // ============================================================
    // STEP 1 — Strict-sent pull
    // ============================================================
    const quotesRes = await db.execute(sql`
        SELECT
            id, customer_name, segment, job_description,
            base_price, pricing_line_items,
            delivery_status, viewed_at, booked_at, created_at
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
    console.log(`✓ Pulled ${quotes.length} quotes that REACHED a customer`);

    if (quotes.length === 0) {
        console.log("No verified-sent quotes found — aborting.");
        process.exit(1);
    }

    const dates = quotes.map(q => q.created_at).filter(Boolean).map(d => new Date(d));
    if (dates.length) {
        const minD = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxD = new Date(Math.max(...dates.map(d => d.getTime())));
        console.log(`  Date range: ${minD.toISOString().slice(0,10)} → ${maxD.toISOString().slice(0,10)}`);
    }

    let dDelivered = 0, dRead = 0, dSent = 0, dViewedOnly = 0, dBookedOnly = 0;
    for (const q of quotes) {
        const ds = q.delivery_status;
        if (ds === 'delivered') dDelivered++;
        else if (ds === 'read') dRead++;
        else if (ds === 'sent') dSent++;
        else if (q.viewed_at) dViewedOnly++;
        else if (q.booked_at) dBookedOnly++;
    }
    console.log(`  delivered=${dDelivered}  read=${dRead}  sent=${dSent}  viewed-no-status=${dViewedOnly}  booked-no-status=${dBookedOnly}`);

    const totalRevenue = quotes.reduce((s, q) => s + (q.base_price || 0), 0);
    const viewed = quotes.filter(q => q.viewed_at).length;
    const booked = quotes.filter(q => q.booked_at).length;
    console.log(`  Total value: £${(totalRevenue/100).toFixed(0)}  Viewed: ${viewed}  Booked: ${booked}\n`);

    // ============================================================
    // STEP 2 — Expand line items
    // ============================================================
    type LineItem = { idx: number; quoteIdx: number; desc: string; category: string; pricePence: number; minutes: number; };
    const items: LineItem[] = [];
    for (let i = 0; i < quotes.length; i++) {
        const lis = quotes[i].pricing_line_items;
        if (!Array.isArray(lis)) continue;
        for (const li of lis) {
            const desc = String(li.description || li.label || li.name || "").trim();
            if (!desc) continue;
            items.push({
                idx: items.length,
                quoteIdx: i,
                desc,
                category: String(li.category || "(none)"),
                pricePence: parseInt(li.guardedPricePence || li.llmSuggestedPricePence || li.priceInPence || "0", 10),
                minutes: parseInt(li.timeEstimateMinutes || li.estimatedMinutes || "0", 10),
            });
        }
    }
    console.log(`Total line items: ${items.length}  (avg ${(items.length/quotes.length).toFixed(2)}/quote)\n`);

    // ============================================================
    // STEP 3 — Send all line items to Claude for clustering
    // ============================================================
    console.log("=== CLAUDE SEMANTIC CLUSTERING ===\n");
    console.log(`Sending ${items.length} line items to Claude for clustering...`);

    const numbered = items.map(it => `[${it.idx}] ${it.desc}`).join("\n");

    const prompt = `You are a handyman business operations analyst. Below are ${items.length} line items from real customer quotes. Your job: group them into semantic clusters where each cluster represents the SAME TYPE OF JOB operationally — regardless of phrasing, quantity, or product variant.

Rules:
- Group by "what work the handyman actually does", not exact wording.
  Example: "Hang 3 shelves and mirror" + "Hang 6 oak floating shelves" + "Install 2 floating shelves" = ONE cluster: "Shelf hanging".
  Example: "Fix leaking tap" + "Replace kitchen tap" + "Install new tap cartridge" = ONE cluster: "Tap repair/replacement".
- If an item is truly one-off (no operational sibling in the list), it becomes a single-item cluster.
- A cluster is "SKU-able" if it has ≥2 members AND the work is operationally similar enough that a single template/SKU could quote it (with quantity as a variable).
- Be aggressive in grouping — variants of the same fundamental task belong together.

Line items:
${numbered}

Return ONLY valid JSON (no markdown, no commentary) in this exact format:
{
  "clusters": [
    {"name": "short label", "itemIndices": [0, 5, 12], "skuable": true},
    ...
  ]
}

Every line item index must appear in exactly one cluster.`;

    const MODEL = "claude-sonnet-4-5-20250929";

    const t0 = Date.now();
    const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Done in ${elapsed}s. Stop reason: ${resp.stop_reason}`);
    console.log(`  Tokens: input=${resp.usage.input_tokens}, output=${resp.usage.output_tokens}`);

    const textBlocks = resp.content.filter(c => c.type === "text") as { text: string }[];
    const raw = textBlocks.map(b => b.text).join("");
    // Strip any markdown fences just in case
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: { clusters: { name: string; itemIndices: number[]; skuable: boolean }[] };
    try {
        parsed = JSON.parse(cleaned);
    } catch (e) {
        console.error("Failed to parse Claude output as JSON.");
        console.error("First 500 chars:", cleaned.slice(0, 500));
        process.exit(1);
    }

    // ============================================================
    // STEP 4 — Analyze clusters
    // ============================================================
    console.log("\n=== CLUSTER RESULTS ===\n");
    const clusters = parsed.clusters;
    console.log(`Total clusters returned: ${clusters.length}`);

    // Validate all indices accounted for
    const seen = new Set<number>();
    for (const c of clusters) for (const i of c.itemIndices) seen.add(i);
    const missing = items.filter(it => !seen.has(it.idx)).length;
    console.log(`Items assigned: ${seen.size}/${items.length}  (missing: ${missing})`);

    // Decorate clusters
    type DC = { name: string; size: number; skuable: boolean; avgPrice: number; avgMins: number; samples: string[]; indices: number[] };
    const decorated: DC[] = clusters.map(c => {
        const its = c.itemIndices.map(i => items[i]).filter(Boolean);
        const totalP = its.reduce((s, it) => s + it.pricePence, 0);
        const totalM = its.reduce((s, it) => s + it.minutes, 0);
        return {
            name: c.name,
            size: its.length,
            skuable: c.skuable,
            avgPrice: its.length ? totalP / its.length / 100 : 0,
            avgMins: its.length ? totalM / its.length : 0,
            samples: its.slice(0, 4).map(it => it.desc.slice(0, 80)),
            indices: c.itemIndices,
        };
    });
    decorated.sort((a, b) => b.size - a.size);

    const skuableClusters = decorated.filter(c => c.skuable && c.size >= 2);
    const skuableLines = skuableClusters.reduce((s, c) => s + c.size, 0);
    const singletonClusters = decorated.filter(c => c.size === 1);
    const smallClusters = decorated.filter(c => c.size >= 2 && (!c.skuable));

    console.log(`\nClusters of size ≥ 2:                  ${decorated.filter(c => c.size >= 2).length}`);
    console.log(`Clusters Claude marked SKU-able (≥2):  ${skuableClusters.length}`);
    console.log(`Singleton clusters (truly one-off):    ${singletonClusters.length}`);
    console.log(`Non-SKU repeat clusters (mixed work):  ${smallClusters.length}`);

    console.log("\n--- PRODUCTIZABILITY % ---");
    console.log(`Lines in SKU-able clusters:    ${skuableLines}/${items.length}  =  ${pct(skuableLines, items.length)}`);
    console.log(`Singletons (custom):           ${singletonClusters.length}/${items.length}  =  ${pct(singletonClusters.length, items.length)}`);
    console.log(`Other repeat (non-SKU):        ${items.length - skuableLines - singletonClusters.length}/${items.length}  =  ${pct(items.length - skuableLines - singletonClusters.length, items.length)}`);

    // Revenue weighting
    const revBySize = (filter: (c: DC) => boolean) =>
        decorated.filter(filter).reduce((s, c) => s + c.indices.reduce((ss, i) => ss + (items[i]?.pricePence || 0), 0), 0);
    const revSkuable = revBySize(c => c.skuable && c.size >= 2);
    const revSingleton = revBySize(c => c.size === 1);
    const revOther = revBySize(c => c.size >= 2 && !c.skuable);
    const revTotal = revSkuable + revSingleton + revOther;
    console.log(`\n--- REVENUE WEIGHTED ---`);
    console.log(`SKU-able cluster revenue:   £${(revSkuable/100).toFixed(0)}  (${pct(revSkuable, revTotal)})`);
    console.log(`Singleton revenue:          £${(revSingleton/100).toFixed(0)}  (${pct(revSingleton, revTotal)})`);
    console.log(`Other repeat revenue:       £${(revOther/100).toFixed(0)}  (${pct(revOther, revTotal)})`);

    console.log("\n=== TOP 30 DISCOVERED SKU CANDIDATES ===\n");
    console.log("  size  £avg   min   sku?  name");
    decorated.slice(0, 30).forEach(c => {
        const flag = c.skuable ? "✓" : " ";
        console.log(`  ${String(c.size).padStart(3)}   £${String(Math.round(c.avgPrice)).padStart(4)}  ${String(Math.round(c.avgMins)).padStart(4)}m   ${flag}    ${c.name}`);
        c.samples.slice(0, 2).forEach(s => console.log(`         · ${s}`));
    });

    console.log("\n=== SAMPLE SINGLETONS (truly custom work) ===\n");
    singletonClusters.slice(0, 15).forEach((c, i) => {
        const it = items[c.indices[0]];
        if (!it) return;
        console.log(`  [${i+1}] £${(it.pricePence/100).toFixed(0)} ${it.minutes}m [${it.category}]  ${it.desc.slice(0, 100)}`);
    });

    // ============================================================
    // STEP 5 — Verdict
    // ============================================================
    console.log("\n=========================================");
    console.log("  VERDICT (v3 — strict-sent + Claude)");
    console.log("=========================================\n");

    const skuP = skuableLines / items.length;
    console.log(`Verified-sent quotes analyzed: ${quotes.length}`);
    console.log(`Line items analyzed:           ${items.length}`);
    console.log(`SKU-able line items:           ${pct(skuableLines, items.length)}`);
    console.log(`Revenue from SKU-able work:    ${pct(revSkuable, revTotal)}`);
    console.log(`Discovered SKU candidates:     ${skuableClusters.length}`);
    console.log(`Truly custom singletons:       ${pct(singletonClusters.length, items.length)}`);

    console.log("\n— Interpretation —\n");
    if (skuP >= 0.65) {
        console.log("  ✓ STRONG productization signal even semantically.");
        console.log("    Most work is repeating job-types. Build SKUs from these clusters.");
    } else if (skuP >= 0.4) {
        console.log("  ◐ HYBRID is the right answer.");
        console.log(`    ~${Math.round(skuP*100)}% of work clusters into SKU-shaped patterns.`);
        console.log("    Build ~15-30 parametric SKUs from the top clusters; keep a free-form");
        console.log("    line option for the long tail.");
    } else {
        console.log("  ✗ Work is genuinely custom even when judged semantically.");
        console.log("    Productize the PROCESS (templates, time estimators, dispatch routing),");
        console.log("    not a catalog.");
    }
    console.log("\n=========================================\n");

    process.exit(0);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
