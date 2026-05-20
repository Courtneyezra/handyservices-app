import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
    const rows = await db.execute(sql`
        SELECT job_description, base_price, segment, created_by_name, created_at
        FROM personalized_quotes
        WHERE pricing_line_items IS NULL AND base_price > 0
        ORDER BY created_at DESC
        LIMIT 40
    `);
    console.log("=== Recent quotes without line items ===");
    for (const r of rows.rows as any[]) {
        const d = (r.job_description||"").replace(/\s+/g," ").slice(0, 130);
        console.log(`£${(r.base_price/100).toFixed(0).padStart(4)} ${(r.segment||"?").padEnd(15)} ${d}`);
    }

    // Where are the no-line-item quotes priced?
    const dist = await db.execute(sql`
        SELECT
            CASE
                WHEN base_price < 5000 THEN '< £50'
                WHEN base_price < 10000 THEN '£50–100'
                WHEN base_price < 15000 THEN '£100–150'
                WHEN base_price < 25000 THEN '£150–250'
                WHEN base_price < 50000 THEN '£250–500'
                ELSE '£500+'
            END AS bucket,
            count(*) AS n
        FROM personalized_quotes
        WHERE pricing_line_items IS NULL AND base_price > 0
        GROUP BY bucket
        ORDER BY MIN(base_price)
    `);
    console.log("\nNo-line-item quote price buckets:");
    for (const r of dist.rows as any[]) {
        console.log(`  ${String(r.bucket).padEnd(10)} ${r.n}`);
    }
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
