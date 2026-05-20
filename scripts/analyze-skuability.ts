/**
 * Analyze whether the line-item history supports a SKU-based handyman service.
 * Reads from productized_services + personalized_quotes.pricingLineItems
 * and calls.detectedSkusJson / manualSkusJson.
 *
 * Outputs:
 *   1) SKU catalog (price, category, active)
 *   2) Quote count + how many have structured line items vs custom
 *   3) Frequency of line-item descriptions (normalised) — surface repeating phrases
 *   4) Average job duration & price across quotes
 *   5) Top job_description verbs (sample) so we can spot patterns
 */
import { db } from "../server/db";
import { productizedServices, personalizedQuotes, calls } from "../shared/schema";
import { sql, desc, and, isNotNull } from "drizzle-orm";

function normalise(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\b(a|an|the|and|or|of|in|on|to|for|with|my|your|please|need|some|just|new|old)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function main() {
    console.log("\n=== 1. EXISTING SKU CATALOG ===\n");
    const skus = await db.select().from(productizedServices);
    console.log(`Total SKUs defined: ${skus.length}\n`);

    // Group SKUs by category
    const byCat: Record<string, typeof skus> = {};
    for (const s of skus) {
        const cat = s.category || "uncategorised";
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push(s);
    }
    for (const [cat, items] of Object.entries(byCat).sort()) {
        console.log(`  ${cat} (${items.length})`);
        items.slice(0, 8).forEach(i => {
            console.log(`    £${(i.pricePence/100).toFixed(2)} / ${i.timeEstimateMinutes}min · ${i.skuCode} — ${i.name}`);
        });
        if (items.length > 8) console.log(`    … +${items.length - 8} more`);
    }

    console.log("\n=== 2. QUOTE VOLUME ===\n");
    const totalQuotes = await db.select({ c: sql<number>`count(*)::int` }).from(personalizedQuotes);
    console.log(`Total quotes ever generated: ${totalQuotes[0].c}`);

    const withLineItems = await db.select({ c: sql<number>`count(*)::int` })
        .from(personalizedQuotes)
        .where(isNotNull(personalizedQuotes.pricingLineItems));
    console.log(`Quotes with pricing_line_items populated: ${withLineItems[0].c}`);

    const withTasks = await db.select({ c: sql<number>`count(*)::int` })
        .from(personalizedQuotes)
        .where(isNotNull(personalizedQuotes.tasks));
    console.log(`Quotes with tasks[] populated: ${withTasks[0].c}`);

    const withCategories = await db.select({ c: sql<number>`count(*)::int` })
        .from(personalizedQuotes)
        .where(isNotNull(personalizedQuotes.categories));
    console.log(`Quotes with categories[] populated: ${withCategories[0].c}`);

    console.log("\n=== 3. CATEGORY FREQUENCY ON QUOTES ===\n");
    const catRows = await db.execute(sql`
        SELECT unnest(categories) AS cat, count(*) AS n
        FROM personalized_quotes
        WHERE categories IS NOT NULL
        GROUP BY cat
        ORDER BY n DESC
    `);
    for (const r of catRows.rows as any[]) {
        console.log(`  ${String(r.cat).padEnd(30)} ${r.n}`);
    }

    console.log("\n=== 4. PRICE & DURATION DISTRIBUTION ===\n");
    const priceStats = await db.execute(sql`
        SELECT
            count(*) AS n,
            avg(base_price)::int AS avg_price_pence,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY base_price)::int AS median_price_pence,
            min(base_price) AS min_price_pence,
            max(base_price) AS max_price_pence
        FROM personalized_quotes
        WHERE base_price IS NOT NULL AND base_price > 0
    `);
    console.log(priceStats.rows[0]);

    // Price buckets
    const bucketRows = await db.execute(sql`
        SELECT
            CASE
                WHEN base_price < 5000 THEN '< £50'
                WHEN base_price < 10000 THEN '£50-100'
                WHEN base_price < 15000 THEN '£100-150'
                WHEN base_price < 25000 THEN '£150-250'
                WHEN base_price < 50000 THEN '£250-500'
                WHEN base_price < 100000 THEN '£500-1000'
                ELSE '£1000+'
            END AS bucket,
            count(*) AS n
        FROM personalized_quotes
        WHERE base_price IS NOT NULL AND base_price > 0
        GROUP BY bucket
        ORDER BY MIN(base_price)
    `);
    console.log("\nPrice buckets:");
    for (const r of bucketRows.rows as any[]) {
        console.log(`  ${String(r.bucket).padEnd(12)} ${r.n}`);
    }

    console.log("\n=== 5. TASK FREQUENCY (top 80) ===\n");
    // Each quote has tasks[] — flatten and normalise
    const taskRows = await db.execute(sql`
        SELECT unnest(tasks) AS task
        FROM personalized_quotes
        WHERE tasks IS NOT NULL
    `);
    const taskFreq: Record<string, { count: number; samples: Set<string> }> = {};
    for (const r of taskRows.rows as any[]) {
        const raw = String(r.task || "").trim();
        if (!raw) continue;
        const key = normalise(raw).split(" ").slice(0, 4).join(" "); // first 4 normalised words
        if (!key) continue;
        if (!taskFreq[key]) taskFreq[key] = { count: 0, samples: new Set() };
        taskFreq[key].count++;
        if (taskFreq[key].samples.size < 2) taskFreq[key].samples.add(raw.slice(0, 80));
    }
    const sortedTasks = Object.entries(taskFreq).sort((a, b) => b[1].count - a[1].count);
    console.log(`Unique task-prefix keys: ${sortedTasks.length}`);
    sortedTasks.slice(0, 80).forEach(([k, v]) => {
        const sample = [...v.samples][0];
        console.log(`  ${String(v.count).padStart(4)}  ${k.padEnd(34)}  e.g. "${sample}"`);
    });

    console.log("\n=== 6. PRICING_LINE_ITEMS DESCRIPTION FREQUENCY (top 80) ===\n");
    // pricing_line_items is jsonb — could be an array. Probe shape first.
    const sampleRow = await db.execute(sql`
        SELECT pricing_line_items FROM personalized_quotes
        WHERE pricing_line_items IS NOT NULL
        LIMIT 1
    `);
    if (sampleRow.rows.length > 0) {
        console.log("Sample pricing_line_items shape:");
        console.log(JSON.stringify(sampleRow.rows[0], null, 2).slice(0, 800));
    }

    // Aggregate description-like fields if it's an array
    const lineDescRows = await db.execute(sql`
        WITH expanded AS (
            SELECT jsonb_array_elements(pricing_line_items) AS li
            FROM personalized_quotes
            WHERE pricing_line_items IS NOT NULL
              AND jsonb_typeof(pricing_line_items) = 'array'
        )
        SELECT
            COALESCE(li->>'description', li->>'label', li->>'name', li->>'title') AS desc,
            count(*) AS n,
            avg((li->>'priceInPence')::int)::int AS avg_pence,
            avg((li->>'estimatedMinutes')::int)::int AS avg_mins
        FROM expanded
        WHERE COALESCE(li->>'description', li->>'label', li->>'name', li->>'title') IS NOT NULL
        GROUP BY desc
        ORDER BY n DESC
        LIMIT 80
    `);
    console.log(`\nDistinct line-item descriptions: ${lineDescRows.rows.length}+`);
    for (const r of lineDescRows.rows as any[]) {
        const desc = String(r.desc).slice(0, 60);
        console.log(`  ${String(r.n).padStart(4)}  £${((r.avg_pence||0)/100).toFixed(0).padStart(4)}  ${(r.avg_mins||"-")}min  ${desc}`);
    }

    console.log("\n=== 7. JOB DESCRIPTION SAMPLES (recent 25) ===\n");
    const jobs = await db.select({
        desc: personalizedQuotes.jobDescription,
        seg: personalizedQuotes.segment,
        price: personalizedQuotes.basePrice,
        categories: personalizedQuotes.categories,
    })
    .from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.jobDescription))
    .orderBy(desc(personalizedQuotes.id))
    .limit(25);
    jobs.forEach((j, i) => {
        const d = (j.desc || "").replace(/\s+/g, " ").slice(0, 140);
        const cats = (j.categories || []).join(",");
        console.log(`  [${i+1}] £${((j.price||0)/100).toFixed(0).padStart(4)} ${j.seg || "?"} ${cats}`);
        console.log(`        ${d}`);
    });

    console.log("\n=== 8. CALL-LEVEL SKU DETECTIONS ===\n");
    const callsWithSkus = await db.execute(sql`
        SELECT count(*) AS n FROM calls WHERE detected_skus_json IS NOT NULL
    `);
    console.log(`Calls with detected_skus_json: ${(callsWithSkus.rows[0] as any).n}`);

    const callsWithManual = await db.execute(sql`
        SELECT count(*) AS n FROM calls WHERE manual_skus_json IS NOT NULL
    `);
    console.log(`Calls with manual_skus_json: ${(callsWithManual.rows[0] as any).n}`);

    // Most popular detected SKUs from call_skus junction
    const popSkus = await db.execute(sql`
        SELECT cs.sku_id, ps.sku_code, ps.name, count(*) AS n,
               avg(cs.price_pence)::int AS avg_pence
        FROM call_skus cs
        LEFT JOIN productized_services ps ON ps.id = cs.sku_id
        GROUP BY cs.sku_id, ps.sku_code, ps.name
        ORDER BY n DESC
        LIMIT 40
    `);
    console.log("\nTop SKUs ever attached to a call:");
    for (const r of popSkus.rows as any[]) {
        console.log(`  ${String(r.n).padStart(4)}  £${((r.avg_pence||0)/100).toFixed(0).padStart(4)}  ${r.sku_code || r.sku_id}  ${(r.name||"").slice(0,60)}`);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
