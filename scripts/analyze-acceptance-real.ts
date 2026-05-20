/**
 * Acceptance analysis on REAL customer quotes only (strip test fixtures).
 *
 * A "real" quote:
 *   - has a lead_id
 *   - has a non-test phone number
 *   - created_by_name is NOT in the obvious-test list
 *   - created_at older than 24h (so live demos don't pollute)
 * Plus signals around view behaviour: view count, time-to-first-view, scope.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const REAL_WHERE = sql`
    pq.lead_id IS NOT NULL
    AND pq.phone IS NOT NULL AND pq.phone <> ''
    AND (pq.created_by_name IS NULL OR pq.created_by_name NOT IN ('Test', 'Seed', 'Demo', 'demo_setup'))
    AND pq.created_at < now() - interval '24 hours'
    AND pq.created_at > '2025-01-01'
`;
const ACCEPT_SQL = sql`(selected_at IS NOT NULL OR deposit_paid_at IS NOT NULL OR booked_at IS NOT NULL)`;

function pct(n: number, d: number) { return d ? `${(n/d*100).toFixed(1)}%` : "—"; }

async function main() {
    // ---- Sanity: how many "real" quotes?
    const totalAll = (await db.execute(sql`SELECT count(*)::int AS n FROM personalized_quotes`)).rows[0] as any;
    const totalReal = (await db.execute(sql`SELECT count(*)::int AS n FROM personalized_quotes pq WHERE ${REAL_WHERE}`)).rows[0] as any;
    console.log(`All quotes: ${totalAll.n} · Real-customer quotes: ${totalReal.n}\n`);

    // ---- 1. Funnel on real quotes
    console.log("=== Real-customer funnel ===");
    const r = (await db.execute(sql`
        SELECT
            count(*)::int AS total,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE selected_at IS NOT NULL)::int AS selected,
            count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid,
            count(*) FILTER (WHERE booked_at IS NOT NULL)::int AS booked,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
    `)).rows[0] as any;
    console.log(`Sent:           ${r.total}`);
    console.log(`Viewed:         ${r.viewed} (${pct(r.viewed, r.total)})`);
    console.log(`Selected:       ${r.selected}`);
    console.log(`Paid:           ${r.paid}`);
    console.log(`Booked:         ${r.booked}`);
    console.log(`Accepted (any): ${r.accepted} (${pct(r.accepted, r.total)} sent → ${pct(r.accepted, r.viewed)} viewed)`);

    // ---- 2. Acceptance by line-item count
    console.log("\n=== Real: acceptance by line-item count ===");
    const rows = await db.execute(sql`
        SELECT
            CASE
                WHEN pricing_line_items IS NULL OR jsonb_typeof(pricing_line_items) <> 'array' THEN '0 (no line items)'
                WHEN jsonb_array_length(pricing_line_items) = 1 THEN '1 item'
                WHEN jsonb_array_length(pricing_line_items) <= 3 THEN '2-3 items'
                WHEN jsonb_array_length(pricing_line_items) <= 6 THEN '4-6 items'
                ELSE '7+ items'
            END AS bucket,
            count(*)::int AS sent,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            avg(base_price)::int AS avg_price,
            avg(view_count)::numeric(10,1) AS avg_views
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
        GROUP BY bucket
        ORDER BY sent DESC
    `);
    console.log("bucket              | sent | viewed | accepted | sent→acc | viewed→acc | avg£");
    for (const x of rows.rows as any[]) {
        const sa = pct(x.accepted, x.sent), va = pct(x.accepted, x.viewed);
        console.log(`${String(x.bucket).padEnd(20)}| ${String(x.sent).padStart(4)} | ${String(x.viewed).padStart(6)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(8)} | ${va.padStart(10)} | £${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(4)}`);
    }

    // ---- 3. By longest line item duration
    console.log("\n=== Real: acceptance by longest line-item duration ===");
    const dur = await db.execute(sql`
        SELECT
            CASE
                WHEN pricing_line_items IS NULL OR jsonb_typeof(pricing_line_items) <> 'array' THEN '0. no line items'
                WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 60 THEN '1. ≤60min (SKU)'
                WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 120 THEN '2. ≤120min (SKU)'
                WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 240 THEN '3. ≤4hr (half-day)'
                WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 480 THEN '4. ≤8hr (day)'
                ELSE '5. >1 day (project)'
            END AS bucket,
            count(*)::int AS sent,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            avg(base_price)::int AS avg_price
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
        GROUP BY bucket
        ORDER BY bucket
    `);
    console.log("bucket              | sent | viewed | accepted | sent→acc | viewed→acc | avg£");
    for (const x of dur.rows as any[]) {
        const sa = pct(x.accepted, x.sent), va = pct(x.accepted, x.viewed);
        console.log(`${String(x.bucket).padEnd(20)}| ${String(x.sent).padStart(4)} | ${String(x.viewed).padStart(6)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(8)} | ${va.padStart(10)} | £${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(4)}`);
    }

    // ---- 4. By price bucket
    console.log("\n=== Real: acceptance by price bucket ===");
    const pr = await db.execute(sql`
        SELECT
            CASE
                WHEN base_price IS NULL OR base_price = 0 THEN '0. no price'
                WHEN base_price < 5000 THEN '1. < £50'
                WHEN base_price < 10000 THEN '2. £50-100'
                WHEN base_price < 15000 THEN '3. £100-150'
                WHEN base_price < 25000 THEN '4. £150-250'
                WHEN base_price < 50000 THEN '5. £250-500'
                WHEN base_price < 100000 THEN '6. £500-1000'
                ELSE '7. £1000+'
            END AS bucket,
            count(*)::int AS sent,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            avg(view_count)::numeric(10,1) AS avg_views
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
        GROUP BY bucket
        ORDER BY bucket
    `);
    console.log("bucket              | sent | viewed | accepted | sent→acc | viewed→acc | avg views");
    for (const x of pr.rows as any[]) {
        const sa = pct(x.accepted, x.sent), va = pct(x.accepted, x.viewed);
        console.log(`${String(x.bucket).padEnd(20)}| ${String(x.sent).padStart(4)} | ${String(x.viewed).padStart(6)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(8)} | ${va.padStart(10)} | ${String(x.avg_views ?? "-").padStart(5)}`);
    }

    // ---- 5. View-count signal: do high-view-count quotes convert worse (price shock)?
    console.log("\n=== Real: view-count signal (only quotes that were viewed) ===");
    const vc = await db.execute(sql`
        SELECT
            CASE
                WHEN view_count = 1 THEN '1. looked once'
                WHEN view_count <= 3 THEN '2. 2-3 views'
                WHEN view_count <= 7 THEN '3. 4-7 views'
                WHEN view_count <= 15 THEN '4. 8-15 views'
                ELSE '5. 16+ views (lurker)'
            END AS bucket,
            count(*)::int AS sent,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            avg(base_price)::int AS avg_price
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE} AND viewed_at IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket
    `);
    console.log("bucket                  | sent | accepted | accept% | avg£");
    for (const x of vc.rows as any[]) {
        const sa = pct(x.accepted, x.sent);
        console.log(`${String(x.bucket).padEnd(24)}| ${String(x.sent).padStart(4)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(7)} | £${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(4)}`);
    }

    // ---- 6. Origin (where the quote came from)
    console.log("\n=== Real: source / origin ===");
    const src = await db.execute(sql`
        SELECT
            COALESCE(l.source, 'unknown') AS bucket,
            count(*)::int AS sent,
            count(pq.viewed_at)::int AS viewed,
            count(*) FILTER (WHERE pq.selected_at IS NOT NULL OR pq.deposit_paid_at IS NOT NULL OR pq.booked_at IS NOT NULL)::int AS accepted,
            avg(pq.base_price)::int AS avg_price
        FROM personalized_quotes pq
        LEFT JOIN leads l ON l.id = pq.lead_id
        WHERE ${REAL_WHERE}
        GROUP BY bucket
        ORDER BY sent DESC
    `);
    console.log("source                  | sent | viewed | accepted | accept% | avg£");
    for (const x of src.rows as any[]) {
        const sa = pct(x.accepted, x.sent);
        console.log(`${String(x.bucket).padEnd(24)}| ${String(x.sent).padStart(4)} | ${String(x.viewed).padStart(6)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(7)} | £${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(4)}`);
    }

    // ---- 7. Segment
    console.log("\n=== Real: segment ===");
    const seg = await db.execute(sql`
        SELECT
            COALESCE(segment, 'NULL') AS bucket,
            count(*)::int AS sent,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            avg(base_price)::int AS avg_price
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
        GROUP BY bucket
        ORDER BY sent DESC
    `);
    console.log("segment             | sent | viewed | accepted | accept% | avg£");
    for (const x of seg.rows as any[]) {
        const sa = pct(x.accepted, x.sent);
        console.log(`${String(x.bucket).padEnd(20)}| ${String(x.sent).padStart(4)} | ${String(x.viewed).padStart(6)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(7)} | £${String(x.avg_price?(x.avg_price/100).toFixed(0):"-").padStart(4)}`);
    }

    // ---- 8. Top job descriptions that GET accepted (real)
    console.log("\n=== REAL ACCEPTED quotes — last 40 ===");
    const accepted = await db.execute(sql`
        SELECT job_description, base_price, segment, layout_tier, view_count,
               COALESCE(jsonb_array_length(pricing_line_items), 0) AS n_items
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE} AND ${ACCEPT_SQL}
        ORDER BY COALESCE(deposit_paid_at, selected_at, booked_at) DESC
        LIMIT 40
    `);
    (accepted.rows as any[]).forEach((r,i) => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 120);
        console.log(`  £${((r.base_price||0)/100).toFixed(0).padStart(4)}  ${(r.segment||"?").padEnd(15)} ${(r.layout_tier||"?").padEnd(8)} items:${r.n_items} v:${r.view_count||0}`);
        console.log(`     ${d}`);
    });

    // ---- 9. Top job descriptions that DON'T get accepted (real)
    console.log("\n=== REAL BAILED (viewed but never accepted) quotes — last 40 ===");
    const bailed = await db.execute(sql`
        SELECT job_description, base_price, segment, layout_tier, view_count,
               COALESCE(jsonb_array_length(pricing_line_items), 0) AS n_items
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
          AND viewed_at IS NOT NULL
          AND NOT ${ACCEPT_SQL}
        ORDER BY last_viewed_at DESC
        LIMIT 40
    `);
    (bailed.rows as any[]).forEach((r,i) => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 120);
        console.log(`  £${((r.base_price||0)/100).toFixed(0).padStart(4)}  ${(r.segment||"?").padEnd(15)} ${(r.layout_tier||"?").padEnd(8)} items:${r.n_items} v:${r.view_count||0}`);
        console.log(`     ${d}`);
    });

    // ---- 10. Time-to-first-view (immediacy signal)
    console.log("\n=== Real: time from quote-create to first-view ===");
    const ttv = await db.execute(sql`
        SELECT
            CASE
                WHEN viewed_at IS NULL THEN '0. never viewed'
                WHEN viewed_at - created_at < interval '1 hour' THEN '1. <1 hour'
                WHEN viewed_at - created_at < interval '6 hours' THEN '2. 1-6 hours'
                WHEN viewed_at - created_at < interval '1 day' THEN '3. 6-24 hours'
                WHEN viewed_at - created_at < interval '3 days' THEN '4. 1-3 days'
                ELSE '5. >3 days'
            END AS bucket,
            count(*)::int AS sent,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted
        FROM personalized_quotes pq
        WHERE ${REAL_WHERE}
        GROUP BY bucket
        ORDER BY bucket
    `);
    console.log("time-to-first-view       | sent | accepted | accept%");
    for (const x of ttv.rows as any[]) {
        const sa = pct(x.accepted, x.sent);
        console.log(`${String(x.bucket).padEnd(25)}| ${String(x.sent).padStart(4)} | ${String(x.accepted).padStart(8)} | ${sa.padStart(7)}`);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
