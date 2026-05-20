/**
 * Drill into pricing_line_items to find:
 *  - distinct line-item categories
 *  - description-prefix frequency
 *  - distribution of duration & price per line item
 *  - examples of every category
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

function normWords(text: string, n: number): string {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\b(a|an|the|and|or|of|in|on|to|for|with|my|your|please|need|some|just|new|old|already|customer|supplied|approx|approximately)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, n)
        .join(" ");
}

async function main() {
    console.log("\n=== Line-item categories ===\n");
    const catRows = await db.execute(sql`
        WITH expanded AS (
            SELECT jsonb_array_elements(pricing_line_items) AS li
            FROM personalized_quotes
            WHERE pricing_line_items IS NOT NULL
              AND jsonb_typeof(pricing_line_items) = 'array'
        )
        SELECT
            li->>'category' AS cat,
            count(*) AS n,
            avg(NULLIF(li->>'guardedPricePence','')::int)::int AS avg_pence,
            avg(NULLIF(li->>'timeEstimateMinutes','')::int)::int AS avg_mins,
            min(NULLIF(li->>'guardedPricePence','')::int) AS min_pence,
            max(NULLIF(li->>'guardedPricePence','')::int) AS max_pence
        FROM expanded
        GROUP BY cat
        ORDER BY n DESC
    `);
    for (const r of catRows.rows as any[]) {
        console.log(`  ${String(r.n).padStart(4)}  ${String(r.cat || "(null)").padEnd(28)} avg £${((r.avg_pence||0)/100).toFixed(0)} / ${r.avg_mins||"-"}min  range £${((r.min_pence||0)/100).toFixed(0)}–£${((r.max_pence||0)/100).toFixed(0)}`);
    }

    console.log("\n=== Distinct line-item descriptions (top 120 by frequency) ===\n");
    const allLines = await db.execute(sql`
        SELECT jsonb_array_elements(pricing_line_items) AS li
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL
          AND jsonb_typeof(pricing_line_items) = 'array'
    `);

    type Bucket = { count: number; minutes: number[]; pence: number[]; samples: string[]; cats: Set<string> };
    const byPrefix4: Record<string, Bucket> = {};
    const byPrefix2: Record<string, Bucket> = {};
    for (const r of allLines.rows as any[]) {
        const li = r.li || {};
        const desc = String(li.description || li.label || li.name || "").trim();
        if (!desc) continue;
        const mins = parseInt(li.timeEstimateMinutes || "0", 10);
        const pence = parseInt(li.guardedPricePence || li.llmSuggestedPricePence || "0", 10);
        const cat = String(li.category || "(none)");
        const k4 = normWords(desc, 4);
        const k2 = normWords(desc, 2);
        if (k4) {
            byPrefix4[k4] = byPrefix4[k4] || { count: 0, minutes: [], pence: [], samples: [], cats: new Set() };
            byPrefix4[k4].count++;
            byPrefix4[k4].minutes.push(mins);
            byPrefix4[k4].pence.push(pence);
            byPrefix4[k4].cats.add(cat);
            if (byPrefix4[k4].samples.length < 3) byPrefix4[k4].samples.push(desc.slice(0, 100));
        }
        if (k2) {
            byPrefix2[k2] = byPrefix2[k2] || { count: 0, minutes: [], pence: [], samples: [], cats: new Set() };
            byPrefix2[k2].count++;
            byPrefix2[k2].minutes.push(mins);
            byPrefix2[k2].pence.push(pence);
            byPrefix2[k2].cats.add(cat);
            if (byPrefix2[k2].samples.length < 2) byPrefix2[k2].samples.push(desc.slice(0, 100));
        }
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;

    console.log(`Total line items expanded: ${allLines.rows.length}`);
    console.log(`Distinct 4-word prefixes: ${Object.keys(byPrefix4).length}`);
    console.log(`Distinct 2-word prefixes: ${Object.keys(byPrefix2).length}\n`);

    console.log("--- TOP 50 by 2-word prefix (broader buckets) ---");
    Object.entries(byPrefix2)
        .sort((a,b) => b[1].count - a[1].count)
        .slice(0, 50)
        .forEach(([k, v]) => {
            const p = avg(v.pence);
            const m = avg(v.minutes);
            console.log(`  ${String(v.count).padStart(4)}  ${k.padEnd(28)}  £${(p/100).toFixed(0).padStart(4)}/${m.toFixed(0).padStart(3)}m  cats=[${[...v.cats].slice(0,3).join(",")}]`);
            console.log(`        e.g. ${v.samples[0]}`);
        });

    console.log("\n--- TOP 80 by 4-word prefix (narrower — repeating exact phrases) ---");
    Object.entries(byPrefix4)
        .sort((a,b) => b[1].count - a[1].count)
        .slice(0, 80)
        .forEach(([k, v]) => {
            const p = avg(v.pence);
            const m = avg(v.minutes);
            console.log(`  ${String(v.count).padStart(3)} £${(p/100).toFixed(0).padStart(4)}/${m.toFixed(0).padStart(3)}m  ${k}`);
            console.log(`      ${v.samples[0]}`);
        });

    console.log("\n=== Duration-bucket distribution ===\n");
    // Bucket every line item by its estimated minutes
    const dur: Record<string, number> = { "<30":0, "30":0, "31-60":0, "61-90":0, "91-120":0, "121-180":0, "181-240":0, "241-480":0, ">480":0 };
    for (const r of allLines.rows as any[]) {
        const mins = parseInt((r.li || {}).timeEstimateMinutes || "0", 10);
        if (!mins) continue;
        if (mins < 30) dur["<30"]++;
        else if (mins === 30) dur["30"]++;
        else if (mins <= 60) dur["31-60"]++;
        else if (mins <= 90) dur["61-90"]++;
        else if (mins <= 120) dur["91-120"]++;
        else if (mins <= 180) dur["121-180"]++;
        else if (mins <= 240) dur["181-240"]++;
        else if (mins <= 480) dur["241-480"]++;
        else dur[">480"]++;
    }
    for (const [k, v] of Object.entries(dur)) console.log(`  ${k.padEnd(10)} ${v}`);

    console.log("\n=== 30-min and ≤60-min eligibility check ===\n");
    const cnt30 = (allLines.rows as any[]).filter(r => {
        const m = parseInt((r.li || {}).timeEstimateMinutes || "0", 10);
        return m > 0 && m <= 30;
    }).length;
    const cnt60 = (allLines.rows as any[]).filter(r => {
        const m = parseInt((r.li || {}).timeEstimateMinutes || "0", 10);
        return m > 0 && m <= 60;
    }).length;
    const cnt120 = (allLines.rows as any[]).filter(r => {
        const m = parseInt((r.li || {}).timeEstimateMinutes || "0", 10);
        return m > 0 && m <= 120;
    }).length;
    const total = (allLines.rows as any[]).filter(r => parseInt((r.li || {}).timeEstimateMinutes || "0", 10) > 0).length;
    console.log(`Line items ≤30min:  ${cnt30}/${total} (${(cnt30/total*100).toFixed(1)}%)`);
    console.log(`Line items ≤60min:  ${cnt60}/${total} (${(cnt60/total*100).toFixed(1)}%)`);
    console.log(`Line items ≤120min: ${cnt120}/${total} (${(cnt120/total*100).toFixed(1)}%)`);

    console.log("\n=== Job-description samples (recent 30 quotes) ===\n");
    const jobs = await db.execute(sql`
        SELECT job_description, segment, base_price, categories, completion_date
        FROM personalized_quotes
        WHERE job_description IS NOT NULL AND length(job_description) > 10
        ORDER BY id DESC
        LIMIT 30
    `);
    (jobs.rows as any[]).forEach((j, i) => {
        const d = (j.job_description || "").replace(/\s+/g, " ").slice(0, 160);
        console.log(`  [${i+1}] £${((j.base_price||0)/100).toFixed(0).padStart(4)}  ${j.segment || "?"}  ${(j.categories||[]).join(",")}`);
        console.log(`        ${d}`);
    });

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
