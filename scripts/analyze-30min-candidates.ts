/**
 * What tasks repeat at sub-30, sub-60 and sub-120 minutes?
 * These are the candidates for 30-min / 1hr / fixed-SKU menus.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

function normalise(text: string): string {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\b(a|an|the|and|or|of|in|on|to|for|with|my|your|please|need|just|new|old|already|customer|supplied|approx|approximately|customer-supplied)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function main() {
    const rows = await db.execute(sql`
        SELECT jsonb_array_elements(pricing_line_items) AS li
        FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL AND jsonb_typeof(pricing_line_items) = 'array'
    `);
    const lis = (rows.rows as any[]).map(r => ({
        desc: String((r.li||{}).description||"").trim(),
        mins: parseInt((r.li||{}).timeEstimateMinutes||"0",10),
        pence: parseInt((r.li||{}).guardedPricePence||"0",10),
        cat: String((r.li||{}).category||"")
    })).filter(li => li.desc && li.mins > 0);

    function bucket(label: string, predicate: (li:typeof lis[0]) => boolean) {
        console.log(`\n=== ${label} ===`);
        const subset = lis.filter(predicate);
        const groups: Record<string, { count: number; pence: number; mins: number; samples: string[]; cats: Set<string> }> = {};
        for (const li of subset) {
            const k = normalise(li.desc).split(" ").slice(0, 3).join(" ");
            if (!k) continue;
            groups[k] = groups[k] || { count: 0, pence: 0, mins: 0, samples: [], cats: new Set() };
            groups[k].count++;
            groups[k].pence += li.pence;
            groups[k].mins += li.mins;
            groups[k].cats.add(li.cat);
            if (groups[k].samples.length < 1) groups[k].samples.push(li.desc.slice(0, 90));
        }
        const sorted = Object.entries(groups).sort((a,b)=>b[1].count-a[1].count);
        console.log(`  N items in bucket: ${subset.length}, unique 3-word prefixes: ${sorted.length}`);
        console.log(`  Top 25 repeating tasks:`);
        sorted.slice(0, 25).forEach(([k, v]) => {
            const avgM = (v.mins/v.count).toFixed(0);
            const avgP = (v.pence/v.count/100).toFixed(0);
            console.log(`    ${String(v.count).padStart(3)}× £${avgP.padStart(3)}/${avgM.padStart(3)}m  ${k.padEnd(28)} [${[...v.cats].slice(0,2).join(",")}]`);
            console.log(`         ${v.samples[0]}`);
        });
    }

    bucket("≤30 MIN candidates", li => li.mins > 0 && li.mins <= 30);
    bucket("31-60 MIN candidates", li => li.mins > 30 && li.mins <= 60);
    bucket("61-120 MIN candidates", li => li.mins > 60 && li.mins <= 120);
    bucket(">120 MIN (custom / hourly territory)", li => li.mins > 120);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
