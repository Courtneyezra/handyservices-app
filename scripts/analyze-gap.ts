/**
 * Final gap analysis:
 *  - Line items per quote (single-item bookings = clearly SKU-able)
 *  - Match demand against existing SKU keywords to find:
 *      * GAPS: tasks recurring 2+ times that match no SKU
 *      * DEAD INVENTORY: SKUs that have never matched a real task
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

function tokenize(s: string): string[] {
    return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 3);
}

async function main() {
    // ---- (1) line items per quote
    console.log("=== Line items per quote ===\n");
    const perQ = await db.execute(sql`
        SELECT jsonb_array_length(pricing_line_items) AS n
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL
          AND jsonb_typeof(pricing_line_items) = 'array'
    `);
    const counts: Record<number, number> = {};
    for (const r of perQ.rows as any[]) {
        const n = parseInt(r.n, 10);
        counts[n] = (counts[n] || 0) + 1;
    }
    const total = (perQ.rows as any[]).length;
    for (const [k, v] of Object.entries(counts).sort((a,b)=>+a[0]-+b[0])) {
        const pct = (v/total*100).toFixed(0);
        const bar = "█".repeat(Math.round(v / total * 30));
        console.log(`  ${k.padStart(2)} items: ${String(v).padStart(4)} (${pct.padStart(3)}%) ${bar}`);
    }
    console.log(`  TOTAL:    ${total}`);

    // ---- (2) match each line-item description against SKU keywords
    console.log("\n=== Match line items to existing SKUs ===\n");
    const skus = await db.execute(sql`SELECT id, sku_code, name, keywords, time_estimate_minutes, price_pence, category FROM productized_services WHERE is_active`);
    const skuList = (skus.rows as any[]).map(s => ({
        id: s.id,
        code: s.sku_code,
        name: s.name,
        cat: s.category,
        mins: s.time_estimate_minutes,
        pence: s.price_pence,
        kws: ((s.keywords as string[]) || []).map(k => k.toLowerCase())
    }));

    const liRows = await db.execute(sql`
        SELECT jsonb_array_elements(pricing_line_items) AS li
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL AND jsonb_typeof(pricing_line_items) = 'array'
    `);
    const lineItems = (liRows.rows as any[]).map(r => ({
        desc: String((r.li||{}).description || ""),
        mins: parseInt((r.li||{}).timeEstimateMinutes || "0", 10),
        pence: parseInt((r.li||{}).guardedPricePence || "0", 10),
        cat: String((r.li||{}).category || "")
    })).filter(li => li.desc);

    const skuHits = new Map<string, number>(); // sku-code → matches
    const unmatched: typeof lineItems = [];

    function bestMatch(desc: string): typeof skuList[0] | null {
        const tokens = new Set(tokenize(desc));
        let best = null, bestScore = 0;
        for (const sku of skuList) {
            const score = sku.kws.filter(k => tokens.has(k) || desc.toLowerCase().includes(k)).length;
            if (score > bestScore) { bestScore = score; best = sku; }
        }
        return bestScore >= 1 ? best : null;
    }

    for (const li of lineItems) {
        const m = bestMatch(li.desc);
        if (m) skuHits.set(m.code, (skuHits.get(m.code) || 0) + 1);
        else unmatched.push(li);
    }
    console.log(`Line items matched to an existing SKU: ${lineItems.length - unmatched.length}/${lineItems.length} (${((lineItems.length-unmatched.length)/lineItems.length*100).toFixed(0)}%)`);
    console.log(`Unmatched (gap candidates): ${unmatched.length}\n`);

    console.log("Top 30 SKUs by match count:");
    [...skuHits.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30).forEach(([code, n]) => {
        const sku = skuList.find(s => s.code === code);
        console.log(`  ${String(n).padStart(3)}  ${code.padEnd(28)}  ${(sku?.name||"").slice(0,55)}`);
    });

    console.log("\nDead-inventory SKUs (zero matches) — top 30 by category:");
    const dead = skuList.filter(s => !skuHits.has(s.code));
    console.log(`Total dead SKUs: ${dead.length}/${skuList.length}`);
    dead.slice(0, 30).forEach(s => {
        console.log(`  ${(s.cat||"-").padEnd(15)} ${s.code.padEnd(28)} ${(s.name||"").slice(0,55)}`);
    });

    // ---- (3) find clusters in the unmatched line items (gap detection)
    console.log("\n=== Unmatched line-item clusters (potential new SKUs) ===\n");
    const clusters: Record<string, { count: number; mins: number; pence: number; samples: string[]; cats: Set<string> }> = {};
    for (const li of unmatched) {
        const tokens = tokenize(li.desc);
        // Use first 2 content-bearing tokens as cluster key
        const key = tokens.slice(0, 2).join(" ");
        if (!key) continue;
        if (!clusters[key]) clusters[key] = { count: 0, mins: 0, pence: 0, samples: [], cats: new Set() };
        clusters[key].count++;
        clusters[key].mins += li.mins;
        clusters[key].pence += li.pence;
        clusters[key].cats.add(li.cat);
        if (clusters[key].samples.length < 2) clusters[key].samples.push(li.desc.slice(0, 90));
    }
    const sorted = Object.entries(clusters).filter(([_,v]) => v.count >= 2).sort((a,b)=>b[1].count - a[1].count);
    console.log(`Recurring (2+) unmatched clusters: ${sorted.length}`);
    sorted.slice(0, 40).forEach(([k, v]) => {
        const avgM = (v.mins/v.count).toFixed(0);
        const avgP = (v.pence/v.count/100).toFixed(0);
        console.log(`  ${String(v.count).padStart(3)} ${k.padEnd(28)} ~${avgM}min  £${avgP}  cats=[${[...v.cats].slice(0,2).join(",")}]`);
        console.log(`      e.g. ${v.samples[0]}`);
    });

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
