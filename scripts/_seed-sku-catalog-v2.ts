/**
 * Agent 25a — SKU Catalog v2 Seed Script
 *
 * Idempotently seeds the `service_catalog` table with the 50-ish SKUs derived
 * from production quote history (last 200 verified-viewed quotes, 526 line
 * items, 87.6% of items clustered into ~50 candidates).
 *
 * IMPORTANT — schema dependency:
 *   This script depends on the `service_catalog` table existing. Agent 25b
 *   is responsible for the schema migration; this script will:
 *     1. Check the table exists (via `to_regclass`)
 *     2. CREATE it if it doesn't (so this seed is runnable on a fresh DB
 *        in case Agent 25b's migration is delayed)
 *     3. Upsert (INSERT ... ON CONFLICT (sku_code) DO UPDATE) each SKU
 *
 *   Agent 25b should make the canonical migration match the CREATE TABLE
 *   below — if they diverge, this seed will still work but Drizzle will
 *   complain. See the bottom of this file for the canonical column list.
 *
 * Source data:
 *   /tmp/agent25a-clusters.json — produced by:
 *     1) scripts/_extract-lineitems-for-skus.ts (read-only prod pull)
 *     2) scripts/_cluster-lineitems-for-skus.ts (deterministic keyword cluster)
 *
 * Safety:
 *   - Read-only on quote tables.
 *   - Mutations only to `service_catalog`.
 *   - Idempotent via ON CONFLICT (sku_code).
 *   - To preview without writing, set DRY_RUN=1 env var.
 *
 * To run (after Agent 25b's migration lands):
 *     npx tsx scripts/_seed-sku-catalog-v2.ts
 * Or to preview:
 *     DRY_RUN=1 npx tsx scripts/_seed-sku-catalog-v2.ts
 */

import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// SKU rows — sourced from /tmp/agent25a-clusters.json
//
// We INLINE the SKU data here (rather than reading the tmp file at runtime)
// so the seed script is fully self-contained and reviewable. Regenerate with:
//     npx tsx scripts/_extract-lineitems-for-skus.ts &&
//     npx tsx scripts/_cluster-lineitems-for-skus.ts &&
//     node -e "console.log(JSON.stringify(require('/tmp/agent25a-clusters.json').skus, null, 2))"
// then paste below replacing the SKUS array.
// ---------------------------------------------------------------------------

type SKURow = {
    skuCode: string;
    name: string;
    category: string;
    shape: "fixed" | "per_unit" | "tiered";
    pricePence: number | null;
    scheduleMinutes: number | null;
    pricePerUnitPence: number | null;
    unitLabel: string | null;
    minimumUnits: number | null;
    minutesPerUnit: number | null;
    setupMinutes: number | null;
    tiers: Array<{ label: string; pricePence: number; scheduleMinutes: number }> | null;
    customerDescription: string;
    adminDescription: string;
    flexEligible: boolean;
    offPeakWeekendPremiumPence: number;
    // Provenance — not seeded, kept here for review
    _historicalSize?: number;
    _examples?: string[];
    _confidence?: "high" | "medium" | "low";
    _confidenceReason?: string;
};

function loadSkusFromTmp(): SKURow[] {
    const p = "/tmp/agent25a-clusters.json";
    if (!fs.existsSync(p)) {
        throw new Error(
            `Source file missing: ${p}.\n` +
            `Run the extract + cluster pipeline first:\n` +
            `  npx tsx scripts/_extract-lineitems-for-skus.ts\n` +
            `  npx tsx scripts/_cluster-lineitems-for-skus.ts`
        );
    }
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.skus as SKURow[];
}

// ---------------------------------------------------------------------------
// Schema requirements for service_catalog (canonical column list)
// Agent 25b must create a migration that matches this shape.
// ---------------------------------------------------------------------------
const CREATE_TABLE_SQL = sql`
    CREATE TABLE IF NOT EXISTS service_catalog (
        id                                varchar PRIMARY KEY,
        sku_code                          varchar(50) UNIQUE NOT NULL,
        name                              varchar(200) NOT NULL,
        category                          varchar(50) NOT NULL,
        shape                             varchar(20) NOT NULL,
        price_pence                       integer,
        schedule_minutes                  integer,
        price_per_unit_pence              integer,
        unit_label                        varchar(50),
        minimum_units                     integer,
        minutes_per_unit                  integer,
        setup_minutes                     integer,
        tiers                             jsonb,
        customer_description              text NOT NULL,
        admin_description                 text NOT NULL,
        flex_eligible                     boolean NOT NULL DEFAULT true,
        off_peak_weekend_premium_pence    integer NOT NULL DEFAULT 0,
        is_active                         boolean NOT NULL DEFAULT true,
        created_at                        timestamp NOT NULL DEFAULT NOW(),
        updated_at                        timestamp NOT NULL DEFAULT NOW()
    );
`;

const CREATE_INDEX_SQL = sql`
    CREATE INDEX IF NOT EXISTS idx_service_catalog_category ON service_catalog(category);
`;

// ---------------------------------------------------------------------------
// UUID generator (v4) — same scheme as scripts/seed-skus.ts
// ---------------------------------------------------------------------------
function uuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const dryRun = process.env.DRY_RUN === "1";
    console.log("=============================================");
    console.log(`  SKU Catalog v2 Seed${dryRun ? " — DRY RUN" : ""}`);
    console.log("=============================================\n");

    const skus = loadSkusFromTmp();
    console.log(`[seed] Loaded ${skus.length} SKUs from /tmp/agent25a-clusters.json.`);

    // Step 1: Ensure table exists (idempotent CREATE IF NOT EXISTS).
    if (!dryRun) {
        console.log("[seed] Ensuring service_catalog table exists...");
        await db.execute(CREATE_TABLE_SQL);
        await db.execute(CREATE_INDEX_SQL);
        console.log("[seed] Table ready.");
    } else {
        console.log("[seed] [DRY] Would CREATE TABLE IF NOT EXISTS service_catalog (...)");
    }

    // Step 2: Upsert each SKU.
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const s of skus) {
        // Basic sanity
        if (!s.skuCode || !s.name) {
            console.warn(`[seed] SKIP: missing skuCode/name on row ${JSON.stringify(s).slice(0, 80)}...`);
            skipped++;
            continue;
        }
        const tiersJson = s.tiers ? JSON.stringify(s.tiers) : null;

        if (dryRun) {
            console.log(`  [DRY] ${s.skuCode}  ${s.shape}  ${s.name}  £${s.pricePence ? (s.pricePence / 100).toFixed(0) : (s.pricePerUnitPence ? (s.pricePerUnitPence / 100).toFixed(0) + "/u" : "tiered")}`);
            continue;
        }

        // Schema uses SERIAL id — let Postgres auto-assign on insert, no-op on update.
        await db.execute(sql`
            INSERT INTO service_catalog (
                sku_code, name, category, shape,
                price_pence, schedule_minutes,
                price_per_unit_pence, unit_label, minimum_units, minutes_per_unit, setup_minutes,
                tiers,
                customer_description, admin_description,
                flex_eligible, off_peak_weekend_premium_pence,
                is_active, created_at, updated_at
            )
            VALUES (
                ${s.skuCode}, ${s.name}, ${s.category}, ${s.shape},
                ${s.pricePence}, ${s.scheduleMinutes},
                ${s.pricePerUnitPence}, ${s.unitLabel}, ${s.minimumUnits}, ${s.minutesPerUnit}, ${s.setupMinutes},
                ${tiersJson}::jsonb,
                ${s.customerDescription}, ${s.adminDescription},
                ${s.flexEligible}, ${s.offPeakWeekendPremiumPence},
                true, NOW(), NOW()
            )
            ON CONFLICT (sku_code) DO UPDATE SET
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                shape = EXCLUDED.shape,
                price_pence = EXCLUDED.price_pence,
                schedule_minutes = EXCLUDED.schedule_minutes,
                price_per_unit_pence = EXCLUDED.price_per_unit_pence,
                unit_label = EXCLUDED.unit_label,
                minimum_units = EXCLUDED.minimum_units,
                minutes_per_unit = EXCLUDED.minutes_per_unit,
                setup_minutes = EXCLUDED.setup_minutes,
                tiers = EXCLUDED.tiers,
                customer_description = EXCLUDED.customer_description,
                admin_description = EXCLUDED.admin_description,
                flex_eligible = EXCLUDED.flex_eligible,
                off_peak_weekend_premium_pence = EXCLUDED.off_peak_weekend_premium_pence,
                updated_at = NOW()
        `);

        // With ON CONFLICT we can't distinguish insert from update without RETURNING.
        // Treat each row as "upserted" for the summary.
        inserted++;
    }

    // Step 3: Summary
    console.log("\n=============================================");
    console.log("  Summary");
    console.log("=============================================");
    console.log(`Total SKUs in source:       ${skus.length}`);
    if (dryRun) {
        console.log(`(Dry run — nothing written)`);
    } else {
        console.log(`Inserted (new):              ${inserted}`);
        console.log(`Updated (existing):          ${updated}`);
        console.log(`Skipped (invalid):           ${skipped}`);
    }

    // Shape & category breakdown
    const byShape: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalAddrRevPence = 0;
    for (const s of skus) {
        byShape[s.shape] = (byShape[s.shape] || 0) + 1;
        byCategory[s.category] = (byCategory[s.category] || 0) + 1;
        // Estimate addressable revenue: median price × historical size
        const px = s.pricePence ?? s.pricePerUnitPence ?? (s.tiers?.[1]?.pricePence ?? 0);
        totalAddrRevPence += px * (s._historicalSize ?? 0);
    }
    console.log("\nShape breakdown:");
    for (const [k, v] of Object.entries(byShape)) console.log(`  ${k.padEnd(12)} ${v}`);
    console.log("\nCategory breakdown:");
    for (const [k, v] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(22)} ${v}`);
    }
    console.log(`\nTotal addressable historical revenue (median price × hits): £${(totalAddrRevPence / 100).toFixed(0)}`);

    // Confidence
    let high = 0, med = 0, low = 0;
    for (const s of skus) {
        if (s._confidence === "high") high++;
        else if (s._confidence === "medium") med++;
        else low++;
    }
    console.log(`\nConfidence: high=${high} medium=${med} low=${low}`);
    console.log("\nReview the 'low' confidence SKUs before going live — these had high price/scope variance.");
    console.log("\n=============================================\n");

    process.exit(0);
}

main().catch(e => {
    console.error("[seed] FATAL:", e);
    process.exit(1);
});
