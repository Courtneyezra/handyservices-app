/**
 * Backfill `coordinates` (jsonb {lat,lng}) on personalized_quotes from `postcode`.
 *
 * Additive & idempotent: only touches rows where postcode is non-empty AND
 * coordinates IS NULL. Safe to re-run — already-geocoded rows are skipped.
 *
 * Run:  npx tsx scripts/geocode-backfill.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { geocodePostcode } from "../server/lib/geocode";

// Polite pacing between postcodes.io calls (no API key, shared free service).
const DELAY_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function countWithCoords(): Promise<number> {
    const res: any = await db.execute(
        sql`SELECT COUNT(*)::int AS n FROM personalized_quotes WHERE coordinates IS NOT NULL`,
    );
    return Number(res.rows?.[0]?.n ?? 0);
}

async function main() {
    const before = await countWithCoords();
    console.log(`[backfill] quotes with coordinates BEFORE: ${before}`);

    const target: any = await db.execute(sql`
        SELECT id, postcode
        FROM personalized_quotes
        WHERE coordinates IS NULL
          AND postcode IS NOT NULL
          AND TRIM(postcode) <> ''
        ORDER BY created_at DESC
    `);
    const rows: Array<{ id: string; postcode: string }> = target.rows ?? [];
    console.log(`[backfill] candidates needing geocoding: ${rows.length}`);

    let geocoded = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const { id, postcode } = rows[i];
        const coords = await geocodePostcode(postcode);

        if (!coords) {
            failed++;
            console.log(`  [${i + 1}/${rows.length}] ${id} (${postcode}) — no result, skipped`);
        } else {
            await db.execute(sql`
                UPDATE personalized_quotes
                SET coordinates = ${JSON.stringify(coords)}::jsonb
                WHERE id = ${id}
            `);
            geocoded++;
            console.log(
                `  [${i + 1}/${rows.length}] ${id} (${postcode}) → ${coords.lat}, ${coords.lng}`,
            );
        }

        if (i < rows.length - 1) await sleep(DELAY_MS);
    }

    const after = await countWithCoords();
    console.log("");
    console.log(`[backfill] geocoded ${geocoded} of ${rows.length} (failed: ${failed})`);
    console.log(`[backfill] quotes with coordinates AFTER: ${after} (was ${before})`);

    process.exit(0);
}

main().catch((err) => {
    console.error("[backfill] fatal error:", err);
    process.exit(1);
});
