/**
 * Quote acceptance analysis.
 *
 * Defines "accepted" = selected_at OR deposit_paid_at OR booked_at set.
 * Compares accepted vs not-accepted quotes across:
 *   - line-item structure (none / single / multi)
 *   - SKU-friendliness (all items ≤2hr vs has long items)
 *   - price bucket
 *   - category mix
 *   - segment / quotability / quote_mode
 *   - source (the originating lead.source)
 *   - view behaviour (viewed at all? view count?)
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ACCEPT_SQL = sql`(selected_at IS NOT NULL OR deposit_paid_at IS NOT NULL OR booked_at IS NOT NULL)`;

function pct(num: number, denom: number) {
    return denom ? `${(num/denom*100).toFixed(1)}%` : "—";
}

async function bucketView(label: string, sqlExpr: any, customWhere?: any) {
    console.log(`\n=== ${label} ===\n`);
    const rows = await db.execute(sql`
        SELECT
            ${sqlExpr} AS bucket,
            count(*)::int AS total,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted,
            count(viewed_at)::int AS viewed,
            count(deposit_paid_at)::int AS paid,
            avg(base_price)::int AS avg_price,
            avg(view_count)::numeric(10,2) AS avg_views
        FROM personalized_quotes
        ${customWhere ? sql`WHERE ${customWhere}` : sql``}
        GROUP BY bucket
        ORDER BY total DESC
    `);
    console.log("bucket                      | total | viewed | sel/paid/booked | accept% | avg£ | avg views");
    console.log("-".repeat(105));
    for (const r of rows.rows as any[]) {
        const b = String(r.bucket || "(null)").slice(0, 26);
        const ap = pct(r.accepted, r.total);
        const vp = pct(r.viewed, r.total);
        console.log(`${b.padEnd(28)}| ${String(r.total).padStart(5)} | ${String(r.viewed).padStart(3)} ${vp.padStart(6)} | ${String(r.accepted).padStart(3)} / ${String(r.paid).padStart(3)}        | ${ap.padStart(7)} | £${String(r.avg_price ? (r.avg_price/100).toFixed(0) : "-").padStart(4)} | ${String(r.avg_views ?? '-').padStart(5)}`);
    }
}

async function main() {
    console.log("=== Overall quote funnel ===\n");
    const overall = await db.execute(sql`
        SELECT
            count(*)::int AS total,
            count(viewed_at)::int AS viewed,
            count(*) FILTER (WHERE selected_at IS NOT NULL)::int AS selected,
            count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS deposit_paid,
            count(*) FILTER (WHERE booked_at IS NOT NULL)::int AS booked,
            count(completed_at)::int AS completed,
            count(*) FILTER (WHERE ${ACCEPT_SQL})::int AS accepted_any,
            avg(base_price)::int AS avg_price
        FROM personalized_quotes
    `);
    const o = overall.rows[0] as any;
    console.log(`Total quotes:                ${o.total}`);
    console.log(`Viewed at least once:        ${o.viewed} (${pct(o.viewed, o.total)})`);
    console.log(`Selected a package:          ${o.selected}`);
    console.log(`Deposit paid:                ${o.deposit_paid}`);
    console.log(`Booking confirmed:           ${o.booked}`);
    console.log(`Job completed:               ${o.completed}`);
    console.log(`ANY acceptance signal:       ${o.accepted_any} (${pct(o.accepted_any, o.total)} of all quotes, ${pct(o.accepted_any, o.viewed)} of viewed)`);

    // 1. Line-item structure
    console.log("\n\n>>> SECTION 1: Quote shape (line items)");
    await bucketView(
        "Has line items?",
        sql`CASE
            WHEN pricing_line_items IS NULL THEN 'no line items'
            WHEN jsonb_typeof(pricing_line_items) <> 'array' THEN 'invalid lineItems'
            ELSE 'has line items (' || jsonb_array_length(pricing_line_items) || ' items)'
        END`
    );

    await bucketView(
        "Line-item count bucket",
        sql`CASE
            WHEN pricing_line_items IS NULL THEN '0 items (no line items)'
            WHEN jsonb_typeof(pricing_line_items) <> 'array' THEN 'invalid'
            WHEN jsonb_array_length(pricing_line_items) = 0 THEN '0 empty'
            WHEN jsonb_array_length(pricing_line_items) = 1 THEN '1 item'
            WHEN jsonb_array_length(pricing_line_items) <= 3 THEN '2-3 items'
            WHEN jsonb_array_length(pricing_line_items) <= 6 THEN '4-6 items'
            ELSE '7+ items'
        END`
    );

    // 2. SKU-friendliness: are all line items ≤2hrs?
    console.log("\n\n>>> SECTION 2: SKU-friendliness (max line-item duration)");
    await bucketView(
        "Longest line item duration",
        sql`CASE
            WHEN pricing_line_items IS NULL OR jsonb_typeof(pricing_line_items) <> 'array'
                 THEN 'no line items'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 60
                 THEN 'a) all ≤60min (SKU)'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 120
                 THEN 'b) all ≤120min (SKU)'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 240
                 THEN 'c) ≤half-day'
            WHEN (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) <= 480
                 THEN 'd) ≤full-day'
            ELSE 'e) multi-day'
        END`
    );

    // 3. Price buckets
    console.log("\n\n>>> SECTION 3: Price buckets");
    await bucketView(
        "Price bucket",
        sql`CASE
            WHEN base_price IS NULL OR base_price = 0 THEN 'no price'
            WHEN base_price < 5000 THEN 'a) < £50'
            WHEN base_price < 10000 THEN 'b) £50-100'
            WHEN base_price < 15000 THEN 'c) £100-150'
            WHEN base_price < 25000 THEN 'd) £150-250'
            WHEN base_price < 50000 THEN 'e) £250-500'
            WHEN base_price < 100000 THEN 'f) £500-1000'
            ELSE 'g) £1000+'
        END`
    );

    // 4. Segment
    console.log("\n\n>>> SECTION 4: Segment");
    await bucketView("Segment", sql`COALESCE(segment, 'UNKNOWN')`);

    // 5. Quotability
    console.log("\n\n>>> SECTION 5: Quotability tag");
    await bucketView("Quotability", sql`COALESCE(quotability, 'UNKNOWN')`);

    // 6. Layout tier (assigned by contextual engine)
    console.log("\n\n>>> SECTION 6: Layout tier (contextual engine)");
    await bucketView("Layout tier", sql`COALESCE(layout_tier, 'none')`);

    // 7. Quote mode
    console.log("\n\n>>> SECTION 7: Quote mode (legacy field)");
    await bucketView("Quote mode", sql`COALESCE(quote_mode, 'unknown')`);

    // 8. Origin via lead source
    console.log("\n\n>>> SECTION 8: Origin (joining via lead_id → leads.source)");
    const sourceRows = await db.execute(sql`
        SELECT
            COALESCE(l.source, 'no_lead') AS bucket,
            count(*)::int AS total,
            count(*) FILTER (WHERE pq.selected_at IS NOT NULL OR pq.deposit_paid_at IS NOT NULL OR pq.booked_at IS NOT NULL)::int AS accepted,
            count(pq.viewed_at)::int AS viewed,
            count(pq.deposit_paid_at)::int AS paid,
            avg(pq.base_price)::int AS avg_price
        FROM personalized_quotes pq
        LEFT JOIN leads l ON l.id = pq.lead_id
        GROUP BY bucket
        ORDER BY total DESC
    `);
    console.log("source                  | total | viewed | accepted | paid | accept% | avg£");
    console.log("-".repeat(85));
    for (const r of sourceRows.rows as any[]) {
        const ap = pct(r.accepted, r.total);
        console.log(`${String(r.bucket).padEnd(24)}| ${String(r.total).padStart(5)} | ${String(r.viewed).padStart(6)} | ${String(r.accepted).padStart(8)} | ${String(r.paid).padStart(4)} | ${ap.padStart(7)} | £${String(r.avg_price ? (r.avg_price/100).toFixed(0) : "-").padStart(4)}`);
    }

    // 9. Categories that get accepted
    console.log("\n\n>>> SECTION 9: Categories that get accepted (line-item-level)");
    const catRows = await db.execute(sql`
        WITH expanded AS (
            SELECT pq.id AS qid,
                   (pq.selected_at IS NOT NULL OR pq.deposit_paid_at IS NOT NULL OR pq.booked_at IS NOT NULL) AS accepted,
                   jsonb_array_elements(pq.pricing_line_items) AS li
            FROM personalized_quotes pq
            WHERE pq.pricing_line_items IS NOT NULL
              AND jsonb_typeof(pq.pricing_line_items) = 'array'
        )
        SELECT
            COALESCE(li->>'category', '(null)') AS category,
            count(*)::int AS line_items,
            count(*) FILTER (WHERE accepted)::int AS in_accepted_quotes,
            count(DISTINCT qid)::int AS quotes,
            count(DISTINCT qid) FILTER (WHERE accepted)::int AS accepted_quotes,
            avg((li->>'timeEstimateMinutes')::int)::int AS avg_mins,
            avg((li->>'guardedPricePence')::int)::int AS avg_pence
        FROM expanded
        GROUP BY category
        ORDER BY line_items DESC
    `);
    console.log("category               | line items | in accepted | quotes | accepted | qt accept% | avg min | avg £");
    console.log("-".repeat(105));
    for (const r of catRows.rows as any[]) {
        const cp = pct(r.accepted_quotes, r.quotes);
        console.log(`${String(r.category).padEnd(22)} | ${String(r.line_items).padStart(10)} | ${String(r.in_accepted_quotes).padStart(11)} | ${String(r.quotes).padStart(6)} | ${String(r.accepted_quotes).padStart(8)} | ${cp.padStart(10)} | ${String(r.avg_mins||"-").padStart(7)} | £${String((r.avg_pence||0)/100).slice(0,4).padStart(4)}`);
    }

    // 10. Job description length as proxy for complexity
    console.log("\n\n>>> SECTION 10: Job-description length (proxy for complexity)");
    await bucketView("Description length",
        sql`CASE
            WHEN job_description IS NULL OR length(job_description) = 0 THEN 'a) empty'
            WHEN length(job_description) < 50 THEN 'b) <50 chars (terse)'
            WHEN length(job_description) < 150 THEN 'c) 50-150 chars'
            WHEN length(job_description) < 400 THEN 'd) 150-400 chars'
            WHEN length(job_description) < 1000 THEN 'e) 400-1000 chars'
            ELSE 'f) 1000+ chars (essay)'
        END`
    );

    // 11. Requires human review flag
    console.log("\n\n>>> SECTION 11: Requires human review");
    await bucketView("requires_human_review", sql`COALESCE(requires_human_review::text, 'null')`);

    // 12. Drill into the actually-paid quotes: what do they look like?
    console.log("\n\n>>> SECTION 12: 30 most-recent PAID quotes (deposit_paid_at not null)");
    const paid = await db.execute(sql`
        SELECT id, base_price, job_description, segment, layout_tier, quotability,
               (SELECT count(*) FROM jsonb_array_elements(pricing_line_items)) AS n_items,
               (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) AS max_min
        FROM personalized_quotes
        WHERE deposit_paid_at IS NOT NULL
        ORDER BY deposit_paid_at DESC
        LIMIT 30
    `);
    (paid.rows as any[]).forEach((r, i) => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 110);
        console.log(`  [${i+1}] £${((r.base_price||0)/100).toFixed(0).padStart(4)}  ${(r.segment||"?").padEnd(15)} ${(r.layout_tier||"?").padEnd(8)} ${(r.quotability||"?").padEnd(8)}  items:${r.n_items||0}  maxmin:${r.max_min||"-"}`);
        console.log(`        ${d}`);
    });

    // 13. The viewed-but-not-accepted (the people who looked but bailed)
    console.log("\n\n>>> SECTION 13: 30 random VIEWED-but-NOT-ACCEPTED quotes");
    const bailed = await db.execute(sql`
        SELECT id, base_price, job_description, segment, view_count, layout_tier,
               (SELECT count(*) FROM jsonb_array_elements(pricing_line_items)) AS n_items,
               (SELECT max((li->>'timeEstimateMinutes')::int) FROM jsonb_array_elements(pricing_line_items) AS li) AS max_min
        FROM personalized_quotes
        WHERE viewed_at IS NOT NULL
          AND selected_at IS NULL AND deposit_paid_at IS NULL AND booked_at IS NULL
          AND base_price IS NOT NULL
        ORDER BY random()
        LIMIT 30
    `);
    (bailed.rows as any[]).forEach((r, i) => {
        const d = String(r.job_description||"").replace(/\s+/g," ").slice(0, 110);
        console.log(`  [${i+1}] £${((r.base_price||0)/100).toFixed(0).padStart(4)}  ${(r.segment||"?").padEnd(15)} views:${String(r.view_count||0).padStart(2)} items:${r.n_items||0} maxmin:${r.max_min||"-"}`);
        console.log(`        ${d}`);
    });

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
