/**
 * CONTEXTUAL segment deep-dive.
 *
 * Question: within CONTEXTUAL quotes only, what predicts acceptance?
 * Separates real-customer CONTEXTUAL from seeded/test CONTEXTUAL.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ACCEPT_SQL = sql`(pq.selected_at IS NOT NULL OR pq.deposit_paid_at IS NOT NULL OR pq.booked_at IS NOT NULL)`;
const CONTEXTUAL_SQL = sql`pq.segment = 'CONTEXTUAL'`;
const REAL_SQL = sql`
    pq.lead_id IS NOT NULL
    AND pq.phone IS NOT NULL AND pq.phone <> ''
    AND (pq.created_by_name IS NULL OR pq.created_by_name NOT IN ('Test', 'Seed', 'Demo'))
    AND pq.created_at < now() - interval '24 hours'
    AND pq.created_at > '2025-01-01'
`;

function pct(n: number, d: number) { return d ? `${(n/d*100).toFixed(1)}%` : "—"; }

async function row(label: string, where: any) {
    const r = (await db.execute(sql`
        SELECT
            count(*)::int AS sent,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            count(*) FILTER (WHERE pq.deposit_paid_at IS NOT NULL)::int AS paid,
            avg(base_price)::int AS avg_price,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY base_price)::int AS median_price,
            avg(view_count)::numeric(10,1) AS avg_views
        FROM personalized_quotes pq
        WHERE ${where}
    `)).rows[0] as any;
    console.log(`${label.padEnd(35)} sent=${String(r.sent).padStart(4)}  viewed=${String(r.viewed).padStart(4)}  acc=${String(r.accepted).padStart(3)}  paid=${String(r.paid).padStart(3)}  acc%=${pct(r.accepted, r.sent).padStart(6)}  avg£${String(r.avg_price ? (r.avg_price/100).toFixed(0):"-").padStart(5)}  med£${String(r.median_price?(r.median_price/100).toFixed(0):"-").padStart(4)}`);
}

async function bucket(label: string, sqlExpr: any, where: any) {
    console.log(`\n--- ${label} ---`);
    const rows = await db.execute(sql`
        SELECT
            ${sqlExpr} AS bucket,
            count(*)::int AS sent,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            avg(base_price)::int AS avg_price,
            avg(view_count)::numeric(10,1) AS avg_views
        FROM personalized_quotes pq
        WHERE ${where}
        GROUP BY bucket
        ORDER BY bucket
    `);
    console.log("bucket                      | sent | viewed | accepted | accept% | avg£   | avg views");
    for (const x of rows.rows as any[]) {
        const sa = pct(x.accepted, x.sent);
        console.log(`${String(x.bucket||"(null)").padEnd(28)}| ${String(x.sent).padStart(4)} | ${String(x.viewed).padStart(6)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(7)} | £${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(5)} | ${String(x.avg_views??"-").padStart(5)}`);
    }
}

async function main() {
    console.log("=== CONTEXTUAL segment funnel ===\n");
    await row("ALL CONTEXTUAL (incl test/seed):", CONTEXTUAL_SQL);
    await row("Real-customer CONTEXTUAL only :", sql`${CONTEXTUAL_SQL} AND ${REAL_SQL}`);
    await row("Test/seed CONTEXTUAL only     :", sql`${CONTEXTUAL_SQL} AND NOT (${REAL_SQL})`);

    const REAL_CTX = sql`${CONTEXTUAL_SQL} AND ${REAL_SQL}`;

    console.log("\n\n=== Real-customer CONTEXTUAL: source / origin ===");
    const src = await db.execute(sql`
        SELECT COALESCE(l.source, 'unknown') AS bucket,
               count(*)::int AS sent,
               count(pq.viewed_at)::int AS viewed,
               count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
               avg(pq.base_price)::int AS avg_price
        FROM personalized_quotes pq
        LEFT JOIN leads l ON l.id = pq.lead_id
        WHERE ${REAL_CTX}
        GROUP BY bucket
        ORDER BY sent DESC
    `);
    for (const x of src.rows as any[]) {
        const sa = pct(x.accepted, x.sent);
        console.log(`${String(x.bucket).padEnd(20)}| sent=${String(x.sent).padStart(4)}  viewed=${String(x.viewed).padStart(4)}  acc=${String(x.accepted).padStart(3)}  acc%=${sa.padStart(7)}  avg£${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(4)}`);
    }

    await bucket("Layout tier", sql`COALESCE(layout_tier, 'none')`, REAL_CTX);
    await bucket("Quotability", sql`COALESCE(quotability, 'unknown')`, REAL_CTX);
    await bucket("Quote mode", sql`COALESCE(quote_mode, 'unknown')`, REAL_CTX);
    await bucket("requires_human_review", sql`COALESCE(requires_human_review::text, 'null')`, REAL_CTX);

    await bucket("Line-item count",
        sql`CASE
            WHEN pricing_line_items IS NULL OR jsonb_typeof(pricing_line_items) <> 'array' THEN '0. no line items'
            WHEN jsonb_array_length(pricing_line_items) = 1 THEN '1. 1 item'
            WHEN jsonb_array_length(pricing_line_items) <= 3 THEN '2. 2-3 items'
            WHEN jsonb_array_length(pricing_line_items) <= 6 THEN '3. 4-6 items'
            WHEN jsonb_array_length(pricing_line_items) <= 10 THEN '4. 7-10 items'
            ELSE '5. 11+ items'
        END`,
        REAL_CTX);

    await bucket("Longest line-item duration",
        sql`CASE
            WHEN pricing_line_items IS NULL OR jsonb_typeof(pricing_line_items) <> 'array' THEN '0. none'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 60 THEN '1. ≤60min'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 120 THEN '2. ≤2hr'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 240 THEN '3. ≤4hr'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 480 THEN '4. ≤8hr'
            ELSE '5. >8hr (multi-day)'
        END`,
        REAL_CTX);

    await bucket("Price band",
        sql`CASE
            WHEN base_price IS NULL OR base_price = 0 THEN '0. none'
            WHEN base_price < 5000 THEN '1. <£50'
            WHEN base_price < 10000 THEN '2. £50-100'
            WHEN base_price < 15000 THEN '3. £100-150'
            WHEN base_price < 25000 THEN '4. £150-250'
            WHEN base_price < 50000 THEN '5. £250-500'
            WHEN base_price < 100000 THEN '6. £500-1k'
            ELSE '7. £1k+'
        END`,
        REAL_CTX);

    await bucket("View count",
        sql`CASE
            WHEN viewed_at IS NULL THEN '0. never'
            WHEN view_count = 1 THEN '1. 1 view'
            WHEN view_count <= 3 THEN '2. 2-3'
            WHEN view_count <= 7 THEN '3. 4-7'
            WHEN view_count <= 15 THEN '4. 8-15'
            ELSE '5. 16+'
        END`,
        REAL_CTX);

    // Category breakdown — per accepted vs bailed
    console.log("\n\n=== Real CONTEXTUAL: line-item categories (only quotes WITH line items) ===");
    const cats = await db.execute(sql`
        WITH expanded AS (
            SELECT pq.id AS qid,
                   ${ACCEPT_SQL} AS accepted,
                   jsonb_array_elements(pq.pricing_line_items) AS li
            FROM personalized_quotes pq
            WHERE ${REAL_CTX}
              AND pq.pricing_line_items IS NOT NULL
              AND jsonb_typeof(pq.pricing_line_items) = 'array'
        )
        SELECT
            COALESCE(li->>'category', '(null)') AS category,
            count(*)::int AS line_items,
            count(DISTINCT qid)::int AS quotes,
            count(DISTINCT qid) FILTER (WHERE accepted)::int AS accepted_quotes,
            avg((li->>'timeEstimateMinutes')::int)::int AS avg_min,
            avg((li->>'guardedPricePence')::int)::int AS avg_pence
        FROM expanded
        GROUP BY category
        ORDER BY line_items DESC
    `);
    console.log("category               | lines | quotes | accepted | qt acc% | avg min | avg £");
    for (const r of cats.rows as any[]) {
        const ap = pct(r.accepted_quotes, r.quotes);
        console.log(`${String(r.category).padEnd(22)} | ${String(r.line_items).padStart(5)} | ${String(r.quotes).padStart(6)} | ${String(r.accepted_quotes).padStart(8)} | ${ap.padStart(7)} | ${String(r.avg_min||"-").padStart(7)} | £${((r.avg_pence||0)/100).toFixed(0).padStart(4)}`);
    }

    // Top adjustmentFactors driving the price up (signal of "messy" / complex)
    console.log("\n\n=== Real CONTEXTUAL: adjustmentFactors frequency ===");
    const adj = await db.execute(sql`
        WITH factors AS (
            SELECT pq.id AS qid,
                   ${ACCEPT_SQL} AS accepted,
                   jsonb_array_elements_text(li->'adjustmentFactors') AS factor
            FROM personalized_quotes pq
            CROSS JOIN LATERAL jsonb_array_elements(pq.pricing_line_items) AS li
            WHERE ${REAL_CTX}
              AND pq.pricing_line_items IS NOT NULL
              AND jsonb_typeof(pq.pricing_line_items) = 'array'
              AND jsonb_array_length(li->'adjustmentFactors') > 0
        )
        SELECT factor,
               count(*)::int AS occurrences,
               count(DISTINCT qid)::int AS quotes,
               count(DISTINCT qid) FILTER (WHERE accepted)::int AS accepted_quotes
        FROM factors
        GROUP BY factor
        ORDER BY occurrences DESC
        LIMIT 30
    `);
    console.log("factor                                | occurrences | quotes | accepted | qt acc%");
    for (const r of adj.rows as any[]) {
        const ap = pct(r.accepted_quotes, r.quotes);
        console.log(`${String(r.factor).slice(0,38).padEnd(40)}| ${String(r.occurrences).padStart(11)} | ${String(r.quotes).padStart(6)} | ${String(r.accepted_quotes).padStart(8)} | ${ap.padStart(7)}`);
    }

    // Top accepted CONTEXTUAL — last 40
    console.log("\n\n=== REAL CONTEXTUAL ACCEPTED — last 40 ===");
    const acc = await db.execute(sql`
        SELECT job_description, base_price, layout_tier, view_count, quotability,
               COALESCE(jsonb_array_length(pricing_line_items), 0) AS n_items,
               requires_human_review
        FROM personalized_quotes pq
        WHERE ${REAL_CTX} AND ${ACCEPT_SQL}
        ORDER BY COALESCE(deposit_paid_at, selected_at, booked_at) DESC
        LIMIT 40
    `);
    (acc.rows as any[]).forEach(r => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 130);
        console.log(`  £${((r.base_price||0)/100).toFixed(0).padStart(4)}  ${(r.layout_tier||"?").padEnd(8)} ${(r.quotability||"?").padEnd(7)} items:${String(r.n_items).padStart(2)} v:${String(r.view_count||0).padStart(2)} hum:${r.requires_human_review?"Y":"-"}`);
        console.log(`     ${d}`);
    });

    // Bailed CONTEXTUAL  — last 40
    console.log("\n\n=== REAL CONTEXTUAL BAILED (viewed but not accepted) — last 40 ===");
    const bail = await db.execute(sql`
        SELECT job_description, base_price, layout_tier, view_count, quotability,
               COALESCE(jsonb_array_length(pricing_line_items), 0) AS n_items,
               requires_human_review
        FROM personalized_quotes pq
        WHERE ${REAL_CTX}
          AND pq.viewed_at IS NOT NULL
          AND NOT ${ACCEPT_SQL}
        ORDER BY pq.last_viewed_at DESC
        LIMIT 40
    `);
    (bail.rows as any[]).forEach(r => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 130);
        console.log(`  £${((r.base_price||0)/100).toFixed(0).padStart(4)}  ${(r.layout_tier||"?").padEnd(8)} ${(r.quotability||"?").padEnd(7)} items:${String(r.n_items).padStart(2)} v:${String(r.view_count||0).padStart(2)} hum:${r.requires_human_review?"Y":"-"}`);
        console.log(`     ${d}`);
    });

    // Bailed CONTEXTUAL  — only sub-£200, single item (the SKU sweet spot)
    console.log("\n\n=== REAL CONTEXTUAL BAILED — sub-£200, 1-2 items (SKU page candidates) ===");
    const skuBail = await db.execute(sql`
        SELECT job_description, base_price, layout_tier, view_count,
               COALESCE(jsonb_array_length(pricing_line_items), 0) AS n_items
        FROM personalized_quotes pq
        WHERE ${REAL_CTX}
          AND pq.viewed_at IS NOT NULL
          AND NOT ${ACCEPT_SQL}
          AND pq.base_price IS NOT NULL AND pq.base_price < 20000
          AND COALESCE(jsonb_array_length(pricing_line_items), 0) <= 2
        ORDER BY pq.created_at DESC
    `);
    (skuBail.rows as any[]).forEach(r => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 140);
        console.log(`  £${((r.base_price||0)/100).toFixed(0).padStart(4)}  v:${String(r.view_count||0).padStart(2)} items:${r.n_items}  ${d}`);
    });

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
