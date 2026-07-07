// Backfill personalized_quotes.source_call_id from the calls table.
//
// For every quote with source_call_id IS NULL, find the most recent answered
// call (handled_by IN ('va','ai_agent'), non-test) whose phone matches on the
// last 10 digits, with start_time in [quote.created_at - 14 days,
// quote.created_at + 1 hour]. Positive matches get source_call_id +
// source_channel = 'call'. No-match quotes are left untouched (source_channel
// stays NULL — we don't guess). Test quotes are skipped entirely.
//
// Usage:
//   npx tsx scripts/backfill-quote-call-links.ts --dry-run   # print what would link
//   npx tsx scripts/backfill-quote-call-links.ts --apply     # write the links
import { db } from "../server/db";
import { sql } from "drizzle-orm";

type Row = {
    quote_id: string;
    quote_customer: string | null;
    quote_phone: string | null;
    quote_created_at: string | Date;
    is_test: boolean;
    call_id: string | null;
    call_customer: string | null;
    call_start_time: string | Date | null;
};

function fmt(value: string | Date | null): string {
    if (!value) return "?";
    const date = value instanceof Date ? value : new Date(`${String(value).replace(" ", "T")}Z`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 16).replace("T", " ");
}

async function main() {
    const apply = process.argv.includes("--apply");
    const dryRun = process.argv.includes("--dry-run") || !apply;
    if (apply && process.argv.includes("--dry-run")) {
        console.error("Pass either --dry-run or --apply, not both.");
        process.exit(1);
    }
    console.log(`Mode: ${apply ? "APPLY (writing links)" : "DRY RUN (no writes)"}\n`);

    // One set-based pass: every unlinked quote, its test-data flag, and the
    // best-matching call (most recent in window) via LATERAL. Phone match =
    // last 10 digits of the digits-only number on both sides, which absorbs
    // the +44 / 44 / 0 prefix variants.
    const result = await db.execute(sql`
        SELECT
            q.id AS quote_id,
            q.customer_name AS quote_customer,
            q.phone AS quote_phone,
            q.created_at AS quote_created_at,
            (
                q.id LIKE 'test_q_%'
                OR regexp_replace(coalesce(q.phone, ''), '\\s', '', 'g') ~ '^(\\+?447700900|07700900|\\+?449900001)'
                OR coalesce(q.customer_name, '') ~* '\\y(test|qa|debug|preview|dummy|sample)\\y'
            ) AS is_test,
            c.id AS call_id,
            c.customer_name AS call_customer,
            c.start_time AS call_start_time
        FROM personalized_quotes q
        LEFT JOIN LATERAL (
            SELECT id, customer_name, start_time
            FROM calls
            WHERE handled_by IN ('va', 'ai_agent')
              AND regexp_replace(coalesce(phone_number, ''), '\\s', '', 'g') !~ '^(\\+?447700900|07700900|\\+?449900001)'
              AND length(regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g')) >= 10
              AND length(regexp_replace(coalesce(q.phone, ''), '\\D', '', 'g')) >= 10
              AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10)
                  = right(regexp_replace(q.phone, '\\D', '', 'g'), 10)
              AND start_time >= q.created_at - interval '14 days'
              AND start_time <= q.created_at + interval '1 hour'
            ORDER BY start_time DESC
            LIMIT 1
        ) c ON true
        WHERE q.source_call_id IS NULL
        ORDER BY q.created_at DESC
    `);

    const rows = result.rows as unknown as Row[];
    const testSkipped = rows.filter((r) => r.is_test);
    const real = rows.filter((r) => !r.is_test);
    const linked = real.filter((r) => r.call_id);
    const noMatch = real.filter((r) => !r.call_id);

    if (apply) {
        let written = 0;
        for (const row of linked) {
            await db.execute(sql`
                UPDATE personalized_quotes
                SET source_call_id = ${row.call_id}, source_channel = 'call'
                WHERE id = ${row.quote_id} AND source_call_id IS NULL
            `);
            written++;
        }
        console.log(`Wrote ${written} links.\n`);
    }

    console.log("=== Summary ===");
    console.log(`Unlinked quotes scanned: ${rows.length}`);
    console.log(`Linked to a call:        ${linked.length}${apply ? " (written)" : " (would link)"}`);
    console.log(`No matching call:        ${noMatch.length} (left untouched)`);
    console.log(`Test quotes skipped:     ${testSkipped.length}`);

    console.log(`\n=== Example linked pairs (${Math.min(15, linked.length)} of ${linked.length}) ===`);
    for (const row of linked.slice(0, 15)) {
        console.log(
            `  quote ${row.quote_id} [${row.quote_customer || "?"} @ ${fmt(row.quote_created_at)}]` +
            `  <->  call ${row.call_id} [${row.call_customer || "?"} @ ${fmt(row.call_start_time)}]`,
        );
    }

    if (dryRun) {
        console.log("\nDry run only — re-run with --apply to write.");
    }
    process.exit(0);
}

main().catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
});
