// scripts/seed-stress-test-quotes.mjs
//
// Stress-test seed: 12 quotes covering the v2 routing matrix.
// Each row tests a specific scenario (lane, catchment, skill, cert, crew, duration).
//
// Idempotent: deletes any rows where short_slug LIKE 't-q%' before insert.
// Phone prefix +44790000007X (X=1..12) keeps cleanup easy.
//
// Usage: node scripts/seed-stress-test-quotes.mjs

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
function tomorrow() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
}
function preferredDates(windowDays) {
    const start = tomorrow();
    const out = [];
    for (let i = 0; i < windowDays; i++) {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + i);
        out.push(isoDate(d));
    }
    return out;
}

// ---------------------------------------------------------------------------
// 12-quote stress matrix
// ---------------------------------------------------------------------------
const STRESS_QUOTES = [
    {
        slug: "t-q1",
        customerName: "Stress 01 (NG7 plumb flex)",
        phone: "+447900000071",
        postcode: "NG7 2RD",
        address: "1 Test Street, Nottingham, NG7 2RD",
        flexTier: "flexible", flexWindowDays: 7,
        skills: ["plumbing"], categories: ["plumbing"],
        durationMinutes: 60, basePrice: 9000, crew: 1, heavyLifting: false,
        jobDescription: "Replace kitchen tap. Mark+Sarah overlap; Mark home postcode.",
    },
    {
        slug: "t-q2",
        customerName: "Stress 02 (NG7 joinery relax)",
        phone: "+447900000072",
        postcode: "NG7 5BX",
        address: "2 Test Street, Nottingham, NG7 5BX",
        flexTier: "relaxed", flexWindowDays: 14,
        skills: ["joinery"], categories: ["carpentry"],
        durationMinutes: 90, basePrice: 13500, crew: 1, heavyLifting: false,
        jobDescription: "Re-hang internal door. Only Mark has joinery in NG7.",
    },
    {
        slug: "t-q3",
        customerName: "Stress 03 (NG2 tiling flex)",
        phone: "+447900000073",
        postcode: "NG2 1AH",
        address: "3 Test Street, West Bridgford, NG2 1AH",
        flexTier: "flexible", flexWindowDays: 7,
        skills: ["tiling"], categories: ["tiling"],
        durationMinutes: 120, basePrice: 18000, crew: 1, heavyLifting: false,
        jobDescription: "Tile bathroom splashback. Sarah home postcode + Mark covers NG2.",
    },
    {
        slug: "t-q4",
        customerName: "Stress 04 (NG7 paint relax)",
        phone: "+447900000074",
        postcode: "NG7 9PA",
        address: "4 Test Street, Nottingham, NG7 9PA",
        flexTier: "relaxed", flexWindowDays: 14,
        skills: ["painting"], categories: ["painting"],
        durationMinutes: 240, basePrice: 24000, crew: 1, heavyLifting: false,
        jobDescription: "Hallway repaint. Only Mark does painting.",
    },
    {
        slug: "t-q5",
        customerName: "Stress 05 (NG2 gas relax)",
        phone: "+447900000075",
        postcode: "NG2 6LP",
        address: "5 Test Street, West Bridgford, NG2 6LP",
        flexTier: "relaxed", flexWindowDays: 14,
        skills: ["gas"], categories: ["plumbing"],
        certRequired: ["gas_safe"],
        durationMinutes: 90, basePrice: 12000, crew: 1, heavyLifting: false,
        jobDescription: "Annual gas service. Specialist lane → Dave.",
    },
    {
        slug: "t-q6",
        customerName: "Stress 06 (NG7 elec none)",
        phone: "+447900000076",
        postcode: "NG7 3AB",
        address: "6 Test Street, Nottingham, NG7 3AB",
        flexTier: "flexible", flexWindowDays: 7,
        skills: ["electrical"], categories: ["electrical"],
        certRequired: ["part_p"],
        durationMinutes: 60, basePrice: 9500, crew: 1, heavyLifting: false,
        jobDescription: "Replace electrical socket. NO COVERAGE — expect no_eligible / reschedule_required.",
    },
    {
        slug: "t-q7",
        customerName: "Stress 07 (NG7 shed crew2 fast)",
        phone: "+447900000077",
        postcode: "NG7 4CD",
        address: "7 Test Street, Nottingham, NG7 4CD",
        flexTier: "fast", flexWindowDays: 1,
        skills: ["joinery"], categories: ["carpentry"],
        durationMinutes: 480, basePrice: 60000, crew: 2, heavyLifting: true,
        jobDescription: "Install 6x4 shed + level. TEAM lane (crew=2). All units single — expect fallback.",
    },
    {
        slug: "t-q8",
        customerName: "Stress 08 (NG2 multiday crew2)",
        phone: "+447900000078",
        postcode: "NG2 7EF",
        address: "8 Test Street, West Bridgford, NG2 7EF",
        flexTier: "relaxed", flexWindowDays: 14,
        skills: ["plumbing", "tiling"], categories: ["plumbing", "tiling"],
        durationMinutes: 1440, basePrice: 240000, crew: 2, heavyLifting: false,
        jobDescription: "Full bathroom refit. Multi-day TEAM. Crew=2.",
    },
    {
        slug: "t-q9",
        customerName: "Stress 09 (NG14 no catch)",
        phone: "+447900000079",
        postcode: "NG14 5BQ",
        address: "9 Test Lane, Calverton, NG14 5BQ",
        flexTier: "flexible", flexWindowDays: 7,
        skills: ["joinery"], categories: ["carpentry"],
        durationMinutes: 60, basePrice: 9000, crew: 1, heavyLifting: false,
        jobDescription: "Garden gate repair. NG14 not in any unit catchment — expect reschedule_required.",
    },
    {
        slug: "t-q10",
        customerName: "Stress 10 (NG8 plumb flex)",
        phone: "+447900000080",
        postcode: "NG8 2GH",
        address: "10 Test Street, Nottingham, NG8 2GH",
        flexTier: "flexible", flexWindowDays: 7,
        skills: ["plumbing"], categories: ["plumbing"],
        durationMinutes: 30, basePrice: 6000, crew: 1, heavyLifting: false,
        jobDescription: "Replace kitchen tap. NG8 — Mark catchment, Sarah doesn't cover NG8.",
    },
    {
        slug: "t-q11",
        customerName: "Stress 11 (NG3 joinery)",
        phone: "+447900000081",
        postcode: "NG3 1JK",
        address: "11 Test Street, Nottingham, NG3 1JK",
        flexTier: "flexible", flexWindowDays: 7,
        skills: ["joinery"], categories: ["carpentry"],
        durationMinutes: 75, basePrice: 11000, crew: 1, heavyLifting: false,
        jobDescription: "Curtain track install. NG3 only Dave covers but no joinery. Expect reschedule_required or cross-lane to fail.",
    },
    {
        slug: "t-q12",
        customerName: "Stress 12 (NG7 plumb fast)",
        phone: "+447900000082",
        postcode: "NG7 8MN",
        address: "12 Test Street, Nottingham, NG7 8MN",
        flexTier: "fast", flexWindowDays: 1,
        skills: ["plumbing"], categories: ["plumbing"],
        durationMinutes: 30, basePrice: 7500, crew: 1, heavyLifting: false,
        jobDescription: "Urgent leaking pipe. Fast tier (1d window). Mark+Sarah eligible.",
    },
];

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const DELETE_SQL = `DELETE FROM personalized_quotes WHERE short_slug LIKE 't-q%'`;

// We push booking_state straight to 'booked_pending_routing' so the routing
// orchestrator picks them up. duration_estimate_minutes is set so job
// characterisation has a real value (other test quotes leave it null which
// is fine but for the stress matrix we want exact durations).
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
        duration_estimate_minutes, created_at
    ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'CONTEXTUAL', 'unknown', $8,
        $9, $10, $11::jsonb, $12,
        'booked_pending_routing', $13::jsonb, 'simple', 'residential',
        true, 0, 0, 0,
        3, 0, 0,
        0, false, $14,
        $15, false, false,
        0, false, $16::jsonb,
        $17, NOW()
    )
    RETURNING id, short_slug, flex_tier, flex_window_days, duration_estimate_minutes, crew_size_required
`;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
    console.log("→ Cleaning existing stress rows (short_slug LIKE 't-q%')...");
    const del = await client.query(DELETE_SQL);
    console.log(`  deleted ${del.rowCount} row(s)`);

    console.log("→ Inserting 12 stress quotes...");
    const inserted = [];
    for (const q of STRESS_QUOTES) {
        const id = `pq_stress_${q.slug.replace(/-/g, "_")}_${Date.now().toString(36)}`;
        const dates = preferredDates(q.flexWindowDays);
        const params = [
            id,                                         // $1  id
            q.slug,                                     // $2  short_slug
            q.customerName,                             // $3
            q.phone,                                    // $4
            q.postcode,                                 // $5
            q.address,                                  // $6
            q.jobDescription,                           // $7
            q.basePrice,                                // $8
            q.flexTier,                                 // $9
            q.flexWindowDays,                           // $10
            JSON.stringify(q.skills),                   // $11
            q.categories,                               // $12
            JSON.stringify(dates),                      // $13
            q.heavyLifting,                             // $14
            q.crew,                                     // $15
            JSON.stringify(q.certRequired ?? []),       // $16
            q.durationMinutes,                          // $17
        ];
        try {
            const { rows } = await client.query(INSERT_SQL, params);
            const r = rows[0];
            inserted.push(r);
            console.log(
                `  Seeded ${r.short_slug.padEnd(6)} — ${String(r.duration_estimate_minutes).padStart(4)}min — skills=${JSON.stringify(q.skills)} — tier=${r.flex_tier} — crew=${r.crew_size_required}`
            );
        } catch (err) {
            console.error(`  FAIL ${q.slug}: ${err.message}`);
            throw err;
        }
    }

    console.log("");
    console.log(`Inserted ${inserted.length} quotes`);
    console.log("Slugs (for downstream waves):");
    for (const r of inserted) console.log(`  - ${r.short_slug}`);
}

try {
    await main();
} finally {
    client.release();
    await pool.end();
}
