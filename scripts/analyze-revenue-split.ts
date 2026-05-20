/**
 * Compute revenue split: what % of line-item revenue is SKU-friendly
 * (≤2hrs, repeatable category) vs custom (multi-hour, bespoke)?
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
    const rows = await db.execute(sql`
        SELECT jsonb_array_elements(pricing_line_items) AS li
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL
          AND jsonb_typeof(pricing_line_items) = 'array'
    `);

    const lineItems = (rows.rows as any[]).map(r => {
        const li = r.li || {};
        return {
            cat: String(li.category || "(null)"),
            mins: parseInt(li.timeEstimateMinutes || "0", 10),
            pence: parseInt(li.guardedPricePence || li.llmSuggestedPricePence || "0", 10),
            desc: String(li.description || "")
        };
    }).filter(x => x.mins > 0 && x.pence > 0);

    const total = lineItems.length;
    const totalRev = lineItems.reduce((s, x) => s + x.pence, 0);
    console.log(`Total priced line items: ${total}`);
    console.log(`Total line-item revenue: £${(totalRev/100).toFixed(0)}\n`);

    // Bucket each line item
    const buckets = {
        "≤30min  (instant SKU)":   { count: 0, pence: 0 },
        "31–60   (1hr SKU)":       { count: 0, pence: 0 },
        "61–120  (2hr SKU)":       { count: 0, pence: 0 },
        "121–240 (half-day SKU)":  { count: 0, pence: 0 },
        "241–480 (day rate)":      { count: 0, pence: 0 },
        ">480    (multi-day)":     { count: 0, pence: 0 },
    };
    for (const li of lineItems) {
        let b: keyof typeof buckets;
        if (li.mins <= 30) b = "≤30min  (instant SKU)";
        else if (li.mins <= 60) b = "31–60   (1hr SKU)";
        else if (li.mins <= 120) b = "61–120  (2hr SKU)";
        else if (li.mins <= 240) b = "121–240 (half-day SKU)";
        else if (li.mins <= 480) b = "241–480 (day rate)";
        else b = ">480    (multi-day)";
        buckets[b].count++;
        buckets[b].pence += li.pence;
    }

    console.log("Duration bucket          | count |  count% |   revenue |  rev% | avg ticket");
    console.log("-".repeat(85));
    for (const [name, b] of Object.entries(buckets)) {
        const cp = (b.count/total*100).toFixed(1);
        const rp = (b.pence/totalRev*100).toFixed(1);
        const avg = b.count ? (b.pence/b.count/100).toFixed(0) : "-";
        console.log(`${name.padEnd(24)} | ${String(b.count).padStart(5)} | ${cp.padStart(6)}% | £${(b.pence/100).toFixed(0).padStart(8)} | ${rp.padStart(5)}% | £${avg.padStart(4)}`);
    }

    console.log("\n=== Per-category revenue (top 20) ===\n");
    const byCat: Record<string, { count: number; pence: number; mins: number }> = {};
    for (const li of lineItems) {
        byCat[li.cat] = byCat[li.cat] || { count: 0, pence: 0, mins: 0 };
        byCat[li.cat].count++;
        byCat[li.cat].pence += li.pence;
        byCat[li.cat].mins += li.mins;
    }
    const sorted = Object.entries(byCat).sort((a, b) => b[1].pence - a[1].pence);
    console.log("Category               | count |   revenue | rev% | avg ticket | avg dur");
    console.log("-".repeat(78));
    for (const [cat, v] of sorted.slice(0, 25)) {
        const rp = (v.pence/totalRev*100).toFixed(1);
        const avg = (v.pence/v.count/100).toFixed(0);
        const avgM = (v.mins/v.count).toFixed(0);
        console.log(`${cat.padEnd(22)} | ${String(v.count).padStart(5)} | £${(v.pence/100).toFixed(0).padStart(8)} | ${rp.padStart(4)}% | £${avg.padStart(4)}     | ${avgM.padStart(3)}min`);
    }

    console.log("\n=== Whole-quote SKU coverage ===\n");
    // Per quote: is every line item ≤2hrs AND has a non-null category? → SKU-able quote
    const quoteRows = await db.execute(sql`
        SELECT id, base_price, pricing_line_items
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL
          AND jsonb_typeof(pricing_line_items) = 'array'
          AND base_price IS NOT NULL AND base_price > 0
    `);
    let fullySku = 0, partSku = 0, customOnly = 0;
    let revFullSku = 0, revPart = 0, revCustom = 0;
    for (const q of quoteRows.rows as any[]) {
        const items = (q.pricing_line_items || []) as any[];
        if (!items.length) continue;
        const minutes = items.map((li:any) => parseInt(li.timeEstimateMinutes || "0", 10)).filter(m=>m>0);
        if (!minutes.length) continue;
        const allShort = minutes.every(m => m <= 120);
        const anyShort = minutes.some(m => m <= 120);
        const price = parseInt(q.base_price, 10);
        if (allShort) { fullySku++; revFullSku += price; }
        else if (anyShort) { partSku++; revPart += price; }
        else { customOnly++; revCustom += price; }
    }
    const totalQuotes = fullySku + partSku + customOnly;
    const grand = revFullSku + revPart + revCustom;
    console.log(`Quotes analysed: ${totalQuotes}`);
    console.log(`  Fully SKU-able (all items ≤2hr): ${fullySku} quotes (${(fullySku/totalQuotes*100).toFixed(0)}%), £${(revFullSku/100).toFixed(0)} (${(revFullSku/grand*100).toFixed(0)}% of revenue)`);
    console.log(`  Mixed (some SKU, some custom):   ${partSku} quotes (${(partSku/totalQuotes*100).toFixed(0)}%), £${(revPart/100).toFixed(0)} (${(revPart/grand*100).toFixed(0)}% of revenue)`);
    console.log(`  Custom-only (all >2hr):          ${customOnly} quotes (${(customOnly/totalQuotes*100).toFixed(0)}%), £${(revCustom/100).toFixed(0)} (${(revCustom/grand*100).toFixed(0)}% of revenue)`);

    console.log("\n=== Quotes with no line items but with a base_price ===\n");
    const noLines = await db.execute(sql`
        SELECT count(*) AS n, avg(base_price)::int AS avg, sum(base_price)::bigint AS total
        FROM personalized_quotes
        WHERE pricing_line_items IS NULL AND base_price IS NOT NULL AND base_price > 0
    `);
    const r = (noLines.rows[0] as any);
    console.log(`Quotes without line items: ${r.n} (avg £${((r.avg||0)/100).toFixed(0)}, total £${((r.total||0)/100).toFixed(0)})`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
