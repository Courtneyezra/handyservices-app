// scripts/seed-test-quotes.mjs
//
// Wave 2C — Seed 5 test quotes covering the FlexTier matrix
// (fast / flexible / relaxed) with varied skills and Notts postcodes.
//
// Idempotent: deletes any existing rows where short_slug LIKE 'test-%'
// before inserting. Re-runnable.
//
// Usage: node scripts/seed-test-quotes.mjs

import { Pool, neonConfig } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

// Load .env then .env.local (latter wins).
for (const fname of [".env", ".env.local"]) {
    const url = new URL(`../${fname}`, import.meta.url);
    if (!existsSync(url)) continue;
    const content = readFileSync(url, "utf-8");
    for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
}

if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env / .env.local");
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

// Helpers ---------------------------------------------------------------
function isoDate(d) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function tomorrow() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
}

function preferredDates(windowDays) {
    // Build an array of `windowDays` consecutive ISO dates starting tomorrow.
    const start = tomorrow();
    const out = [];
    for (let i = 0; i < windowDays; i++) {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + i);
        out.push(isoDate(d));
    }
    return out;
}

// Test quote definitions -----------------------------------------------
const TEST_QUOTES = [
    {
        slug: "test-ali",          // short_slug is varchar(8)
        customerName: "Test — Alice (Pick day)",
        phone: "+447900000051",
        postcode: "NG7 2RD",
        address: "12 Lenton Boulevard, Nottingham, NG7 2RD",
        flexTier: "fast",
        flexWindowDays: 1,
        skills: ["plumbing"],
        categories: ["plumbing"],
        jobDescription: "Tap repair — kitchen mixer dripping, needs replacement cartridge or full unit.",
        basePrice: 9000, // £90
    },
    {
        slug: "test-bob",
        customerName: "Test — Bob (Flex)",
        phone: "+447900000052",
        postcode: "NG7 5BX",
        address: "45 Wollaton Road, Nottingham, NG7 5BX",
        flexTier: "flexible",
        flexWindowDays: 7,
        skills: ["joinery"],
        categories: ["carpentry"],
        jobDescription: "Hang two internal doors — supplied by customer, hinges and latches included.",
        basePrice: 18000, // £180
    },
    {
        slug: "test-car",
        customerName: "Test — Carol (Flex)",
        phone: "+447900000053",
        postcode: "NG2 1AH",
        address: "8 Trent Boulevard, West Bridgford, NG2 1AH",
        flexTier: "flexible",
        flexWindowDays: 7,
        skills: ["tiling"],
        categories: ["tiling"],
        jobDescription: "Bathroom splashback re-tile — small area behind sink, ~1 sqm.",
        basePrice: 22500, // £225
    },
    {
        slug: "test-dan",
        customerName: "Test — Dan (Relax)",
        phone: "+447900000054",
        postcode: "NG7 9PA",
        address: "27 Beechdale Road, Nottingham, NG7 9PA",
        flexTier: "relaxed",
        flexWindowDays: 14,
        skills: ["painting"],
        categories: ["painting"],
        jobDescription: "Hallway repaint — walls and ceiling, customer supplies paint.",
        basePrice: 24000, // £240
    },
    {
        slug: "test-eve",
        customerName: "Test — Eve (Relax)",
        phone: "+447900000055",
        postcode: "NG2 6LP",
        address: "14 Loughborough Road, West Bridgford, NG2 6LP",
        flexTier: "relaxed",
        flexWindowDays: 14,
        skills: ["gas"],
        categories: ["plumbing"], // gas falls under plumbing trade group
        certRequired: ["gas_safe"], // gas service must route to Specialist lane (Dave) — Wave 3B regression fix
        jobDescription: "Annual boiler service — Worcester Bosch combi, gas-safe registered engineer required.",
        basePrice: 12000, // £120
    },
];

// SQL --------------------------------------------------------------------
const DELETE_SQL = `DELETE FROM personalized_quotes WHERE short_slug LIKE 'test-%'`;

const INSERT_SQL = `
    INSERT INTO personalized_quotes (
        id, short_slug, customer_name, phone, postcode, address,
        job_description, segment, customer_kind, base_price,
        flex_tier, flex_window_days, skills_required, categories,
        booking_state, available_dates, quote_mode, client_type,
        proposal_mode_enabled, view_count, regeneration_count, extension_count,
        total_installments, completed_installments, materials_cost_with_markup_pence,
        scheduling_fee_in_pence, requires_human_review, heavy_lifting,
        crew_size_required, ooh_slot_eligible, multi_job_block_requested,
        bundle_discount_pct, is_weekend_booking, cert_required,
        created_at
    ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'CONTEXTUAL', 'unknown', $8,
        $9, $10, $11::jsonb, $12,
        'draft', $13::jsonb, 'simple', 'residential',
        true, 0, 0, 0,
        3, 0, 0,
        0, false, false,
        1, false, false,
        0, false, $14::jsonb,
        NOW()
    )
    RETURNING id, short_slug, flex_tier, flex_window_days
`;

// Run --------------------------------------------------------------------
async function main() {
    console.log("→ Cleaning existing test rows (short_slug LIKE 'test-%')...");
    const del = await client.query(DELETE_SQL);
    console.log(`  deleted ${del.rowCount} row(s)`);

    console.log("→ Inserting 5 test quotes...");
    const inserted = [];
    for (const q of TEST_QUOTES) {
        const id = `pq_test_${q.slug.replace(/-/g, "_")}_${Date.now().toString(36)}`;
        const dates = preferredDates(q.flexWindowDays);
        const params = [
            id,                                      // $1  id
            q.slug,                                  // $2  short_slug (≤8 chars)
            q.customerName,                          // $3  customer_name
            q.phone,                                 // $4  phone
            q.postcode,                              // $5  postcode
            q.address,                               // $6  address
            q.jobDescription,                        // $7  job_description
            q.basePrice,                             // $8  base_price
            q.flexTier,                              // $9  flex_tier
            q.flexWindowDays,                        // $10 flex_window_days
            JSON.stringify(q.skills),                // $11 skills_required jsonb
            q.categories,                            // $12 categories text[]
            JSON.stringify(dates),                   // $13 available_dates jsonb
            JSON.stringify(q.certRequired ?? []),    // $14 cert_required jsonb
        ];
        try {
            const { rows } = await client.query(INSERT_SQL, params);
            const r = rows[0];
            inserted.push(r);
            console.log(
                `  Seeded ${r.short_slug.padEnd(10)} (id=${r.id.slice(0, 30)}…, flex_tier=${r.flex_tier}, window=${r.flex_window_days}d)`
            );
        } catch (err) {
            console.error(`  FAIL ${q.slug}: ${err.message}`);
            throw err;
        }
    }

    console.log("");
    console.log(`✓ Inserted ${inserted.length} test quotes`);
    console.log("Slugs (for downstream waves):");
    for (const r of inserted) console.log(`  - ${r.short_slug}`);
}

try {
    await main();
} finally {
    client.release();
    await pool.end();
}
