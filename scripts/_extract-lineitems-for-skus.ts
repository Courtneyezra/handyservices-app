/**
 * Agent 25a STEP 1 — Pull last 200 viewed/accepted/paid quotes, flatten line items.
 *
 * Read-only. Writes a JSON snapshot to /tmp so the clustering step can iterate
 * without re-querying prod.
 */

import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";

function pct(n: number, total: number): string {
    if (!total) return "0%";
    return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
    console.log("[extract] Pulling last 200 quotes that reached a customer...");

    const quotesRes = await db.execute(sql`
        SELECT
            pq.id,
            pq.customer_name,
            pq.segment,
            pq.job_description,
            pq.base_price,
            pq.pricing_line_items,
            pq.delivery_status,
            pq.viewed_at,
            pq.selected_at,
            pq.booked_at,
            pq.deposit_paid_at,
            pq.created_at
        FROM personalized_quotes pq
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
                viewed_at IS NOT NULL
             OR selected_at IS NOT NULL
             OR deposit_paid_at IS NOT NULL
             OR booked_at IS NOT NULL
          )
        ORDER BY created_at DESC NULLS LAST
        LIMIT 200
    `);
    const quotes = quotesRes.rows as any[];
    console.log(`[extract] ${quotes.length} verified-viewed quotes found.`);

    // Cross-reference with contractor_booking_requests for actual durations
    // Use timer_accumulated_seconds + (now - timer_started_at) if completed
    const bookingsRes = await db.execute(sql`
        SELECT
            cbr.quote_id,
            cbr.id AS booking_id,
            cbr.completed_at,
            cbr.timer_accumulated_seconds,
            cbr.time_on_job_seconds,
            cbr.duration_days,
            cbr.scheduled_start_time,
            cbr.scheduled_end_time
        FROM contractor_booking_requests cbr
        WHERE cbr.quote_id IS NOT NULL
          AND (cbr.completed_at IS NOT NULL OR cbr.time_on_job_seconds IS NOT NULL OR cbr.timer_accumulated_seconds > 0)
    `);
    const bookingsByQuote = new Map<string, any>();
    for (const b of bookingsRes.rows as any[]) {
        if (!b.quote_id) continue;
        bookingsByQuote.set(b.quote_id, b);
    }
    console.log(`[extract] Found ${bookingsByQuote.size} quotes with completed/timed bookings.`);

    type LineItem = {
        quoteId: string;
        quoteIdx: number;
        liIdx: number;
        desc: string;
        category: string;
        pricePence: number;
        minutes: number;
        materialsCostPence: number;
        actualMinutes: number | null;
        segment: string | null;
        jobDescription: string;
        createdAt: string | null;
    };
    const items: LineItem[] = [];

    for (let i = 0; i < quotes.length; i++) {
        const q = quotes[i];
        const lis = q.pricing_line_items;
        if (!Array.isArray(lis)) continue;
        const booking = bookingsByQuote.get(q.id);
        const totalLines = lis.length;
        // Distribute booking actual duration across lines proportionally to their estimated minutes
        const sumEstimated = lis.reduce((s: number, li: any) => s + (parseInt(li.timeEstimateMinutes || li.estimatedMinutes || "0", 10) || 0), 0);
        let actualTotalMin: number | null = null;
        if (booking) {
            const sec = booking.time_on_job_seconds ?? booking.timer_accumulated_seconds ?? 0;
            if (sec > 0) actualTotalMin = Math.round(sec / 60);
        }
        for (let j = 0; j < lis.length; j++) {
            const li = lis[j];
            const desc = String(li.description || li.label || li.name || "").trim();
            if (!desc) continue;
            const estMin = parseInt(li.timeEstimateMinutes || li.estimatedMinutes || "0", 10) || 0;
            let actualMin: number | null = null;
            if (actualTotalMin != null && sumEstimated > 0) {
                actualMin = Math.round((estMin / sumEstimated) * actualTotalMin);
            }
            items.push({
                quoteId: q.id,
                quoteIdx: i,
                liIdx: j,
                desc,
                category: String(li.category || "(none)"),
                pricePence: parseInt(li.guardedPricePence || li.llmSuggestedPricePence || li.priceInPence || "0", 10) || 0,
                minutes: estMin,
                materialsCostPence: parseInt(li.materialsCostPence || li.materialsWithMarginPence || "0", 10) || 0,
                actualMinutes: actualMin,
                segment: q.segment ?? null,
                jobDescription: q.job_description ?? "",
                createdAt: q.created_at ? new Date(q.created_at).toISOString() : null,
            });
        }
    }

    console.log(`[extract] Flattened to ${items.length} line items (avg ${(items.length/quotes.length).toFixed(2)}/quote).`);
    const withActual = items.filter(it => it.actualMinutes != null).length;
    console.log(`[extract] ${withActual} line items have actual recorded duration (${pct(withActual, items.length)}).`);

    const totalRev = items.reduce((s, it) => s + it.pricePence, 0);
    console.log(`[extract] Total line revenue (pence): £${(totalRev/100).toFixed(0)}.`);

    const outPath = "/tmp/agent25a-lineitems.json";
    fs.writeFileSync(outPath, JSON.stringify({
        extractedAt: new Date().toISOString(),
        quoteCount: quotes.length,
        items,
    }, null, 0));
    console.log(`[extract] Wrote ${items.length} items to ${outPath}.`);

    process.exit(0);
}

main().catch(e => {
    console.error("[extract] FATAL:", e);
    process.exit(1);
});
