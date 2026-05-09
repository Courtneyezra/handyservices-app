// scripts/seed-volume-test-quotes.mjs
//
// Volume-test seed: 50 realistic quotes across NG7/NG2/NG8/NG3/NG14
// to drive the v2 day-pack solver against a real week of demand.
//
// Distribution:
//   - 50 quotes, mix of Pick day (40%) / Flex (40%) / Relax (20%)
//   - Postcodes: NG7 (40%), NG2 (25%), NG8 (15%), NG3 (10%), NG14 (10%)
//   - Skills: plumbing 30%, joinery 20%, tiling 20%, painting 20%, mixed 10%
//   - Builder lane only (no certs, no crew=2, durations 30-300 min)
//   - All booked_pending_routing
//   - Phone +449900000XXX, slug v-q01..v-q50
//
// Idempotent: deletes any rows where short_slug LIKE 'v-q%' first.
//
// Usage: node scripts/seed-volume-test-quotes.mjs

import { Pool, neonConfig } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

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
    console.error("Missing DATABASE_URL");
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

// ---------------------------------------------------------------------------
// PRNG for reproducible randomness
// ---------------------------------------------------------------------------
let rng_seed = 42;
function rng() {
    rng_seed = (rng_seed * 16807) % 2147483647;
    return rng_seed / 2147483647;
}
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function pickWeighted(items) {
    // items: [{...fields, weight}] — returns the whole item
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = rng() * total;
    for (const it of items) {
        if ((r -= it.weight) < 0) return it;
    }
    return items[items.length - 1];
}
function range(min, max) { return min + Math.floor(rng() * (max - min + 1)); }
function isoDate(d) { return d.toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Demand definition
// ---------------------------------------------------------------------------
const POSTCODE_AREAS = [
    { value: "NG7", weight: 40, addresses: ["Forest Rd", "Ilkeston Rd", "Derby Rd", "Lenton Blvd", "Wollaton Rd", "Castle Blvd"] },
    { value: "NG2", weight: 25, addresses: ["Trent Bridge", "Musters Rd", "Loughborough Rd", "Melton Rd", "Boundary Rd"] },
    { value: "NG8", weight: 15, addresses: ["Aspley Lane", "Bilborough Rd", "Beechdale Rd", "Wollaton Vale"] },
    { value: "NG3", weight: 10, addresses: ["Mansfield Rd", "Carlton Rd", "Sneinton Hermitage", "St Ann's Way"] },
    { value: "NG14", weight: 10, addresses: ["Calverton Rd", "Main St", "Park Rd", "Burton Rd"] },
];

const SKILLS = [
    {
        value: ["plumbing"], weight: 30, category: "plumbing",
        descs: [
            { d: "Replace kitchen tap", min: 30, max: 60, ph: 35 },
            { d: "Fix leaking radiator valve", min: 45, max: 90, ph: 40 },
            { d: "Install new bathroom sink", min: 90, max: 180, ph: 38 },
            { d: "Unblock kitchen drain", min: 30, max: 60, ph: 35 },
            { d: "Replace shower head and hose", min: 30, max: 60, ph: 35 },
            { d: "Fit new washing machine", min: 60, max: 120, ph: 35 },
        ],
    },
    {
        value: ["joinery"], weight: 20, category: "carpentry",
        descs: [
            { d: "Re-hang internal door", min: 60, max: 120, ph: 38 },
            { d: "Build flat-pack wardrobe", min: 90, max: 180, ph: 35 },
            { d: "Install curtain track", min: 45, max: 90, ph: 35 },
            { d: "Fit new skirting board", min: 120, max: 240, ph: 38 },
            { d: "Repair garden gate", min: 60, max: 120, ph: 35 },
            { d: "Install kitchen shelf unit", min: 90, max: 180, ph: 38 },
        ],
    },
    {
        value: ["tiling"], weight: 20, category: "tiling",
        descs: [
            { d: "Tile bathroom splashback", min: 90, max: 180, ph: 40 },
            { d: "Re-grout shower wall", min: 60, max: 120, ph: 38 },
            { d: "Replace cracked floor tiles", min: 90, max: 180, ph: 40 },
            { d: "Tile kitchen backsplash", min: 120, max: 240, ph: 40 },
            { d: "Repair loose tiles", min: 45, max: 90, ph: 38 },
        ],
    },
    {
        value: ["painting"], weight: 20, category: "painting",
        descs: [
            { d: "Paint single bedroom", min: 180, max: 300, ph: 32 },
            { d: "Touch up hallway scuffs", min: 60, max: 120, ph: 32 },
            { d: "Paint front door", min: 60, max: 120, ph: 35 },
            { d: "Refresh bathroom ceiling", min: 90, max: 180, ph: 32 },
            { d: "Paint exterior trim", min: 180, max: 300, ph: 35 },
        ],
    },
    {
        value: ["plumbing", "tiling"], weight: 5, category: "plumbing",
        descs: [
            { d: "Replace bath panel + re-grout", min: 120, max: 240, ph: 40 },
            { d: "Reseal shower tray + tile repair", min: 90, max: 180, ph: 40 },
        ],
    },
    {
        value: ["joinery", "painting"], weight: 5, category: "carpentry",
        descs: [
            { d: "Hang and paint internal door", min: 120, max: 240, ph: 35 },
            { d: "Skirting board install + paint", min: 180, max: 300, ph: 35 },
        ],
    },
];

const TIERS = [
    { tier: "fast", windowDays: 1, weight: 40 },
    { tier: "flexible", windowDays: 7, weight: 40 },
    { tier: "relaxed", windowDays: 14, weight: 20 },
];

const FIRST_NAMES = ["James", "Sophie", "Oliver", "Emma", "Liam", "Ava", "Henry", "Mia", "Noah", "Charlotte", "Daniel", "Grace", "Ben", "Lily", "Alex", "Zoe", "Tom", "Ruby", "Sam", "Lucy"];
const LAST_NAMES = ["Smith", "Johnson", "Brown", "Taylor", "Davies", "Wilson", "Evans", "Thomas", "Roberts", "Walker"];

// ---------------------------------------------------------------------------
// Build the 50-quote distribution
// ---------------------------------------------------------------------------
const TODAY = new Date('2026-05-10T00:00:00Z');
const NEXT_MONDAY = new Date('2026-05-12T00:00:00Z'); // Tuesday actually but per task spec
const QUOTES = [];

for (let i = 1; i <= 50; i++) {
    const slug = `v-q${String(i).padStart(2, '0')}`;
    const phone = `+44990000${String(1000 + i).slice(-4)}`;

    const pcArea = pickWeighted(POSTCODE_AREAS);
    const street = pick(pcArea.addresses);
    const houseNum = range(1, 200);
    // Build full postcode with realistic suffix
    const pcSuffix = String.fromCharCode(48 + range(1, 9)) + String.fromCharCode(65 + range(0, 25)) + String.fromCharCode(65 + range(0, 25));
    const pcLetter = String.fromCharCode(48 + range(1, 9));
    const fullPostcode = `${pcArea.value} ${pcLetter}${pcSuffix.slice(1)}`;

    const skillSpec = pickWeighted(SKILLS);
    const desc = pick(skillSpec.descs);
    const dur = range(desc.min, desc.max);
    // Round to 15min
    const durRounded = Math.max(30, Math.round(dur / 15) * 15);
    const basePrice = Math.round((durRounded / 60) * desc.ph * 100); // pence

    const tierSpec = pickWeighted(TIERS);

    // Available dates: per tier
    let availableDates;
    if (tierSpec.tier === "fast") {
        // single date Mon-Fri next week
        const dayOffset = range(0, 4); // 12-16 (Tue-Sat actually)
        const d = new Date(NEXT_MONDAY);
        d.setUTCDate(d.getUTCDate() + dayOffset);
        availableDates = [isoDate(d)];
    } else if (tierSpec.tier === "flexible") {
        const dayOffset = range(0, 4);
        const start = new Date(NEXT_MONDAY);
        start.setUTCDate(start.getUTCDate() + dayOffset);
        availableDates = [];
        for (let j = 0; j < 7; j++) {
            const d = new Date(start);
            d.setUTCDate(d.getUTCDate() + j);
            availableDates.push(isoDate(d));
        }
    } else {
        // relaxed: 14-day window starting today
        availableDates = [];
        for (let j = 0; j < 14; j++) {
            const d = new Date(TODAY);
            d.setUTCDate(d.getUTCDate() + j);
            availableDates.push(isoDate(d));
        }
    }

    // created_at: random between -7 and 0 days
    const createdOffsetDays = -1 * range(0, 7);
    const createdHour = range(8, 19);
    const createdMin = range(0, 59);
    const createdAt = new Date(TODAY);
    createdAt.setUTCDate(createdAt.getUTCDate() + createdOffsetDays);
    createdAt.setUTCHours(createdHour, createdMin, 0, 0);

    const customerName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;

    QUOTES.push({
        slug,
        customerName,
        phone,
        postcode: fullPostcode,
        address: `${houseNum} ${street}, Nottingham, ${fullPostcode}`,
        flexTier: tierSpec.tier,
        flexWindowDays: tierSpec.windowDays,
        skills: skillSpec.value,
        categories: [skillSpec.category],
        durationMinutes: durRounded,
        basePrice,
        crew: 1,
        heavyLifting: false,
        jobDescription: `${desc.d}. ${customerName} at ${fullPostcode}.`,
        availableDates,
        createdAt: createdAt.toISOString(),
    });
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const DELETE_SQL = `DELETE FROM personalized_quotes WHERE short_slug LIKE 'v-q%'`;

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
        $17, $18::timestamptz
    )
    RETURNING id, short_slug, flex_tier, postcode
`;

async function main() {
    console.log("→ Cleaning existing v-q* rows...");
    const del = await client.query(DELETE_SQL);
    console.log(`  deleted ${del.rowCount} row(s)`);

    console.log(`→ Inserting ${QUOTES.length} volume quotes...`);
    const inserted = [];

    // Stat tallies
    const tierTally = { fast: 0, flexible: 0, relaxed: 0 };
    const pcTally = {};
    const skillTally = {};

    for (const q of QUOTES) {
        const id = `pq_vol_${q.slug.replace(/-/g, "_")}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`;
        const params = [
            id,
            q.slug,
            q.customerName,
            q.phone,
            q.postcode,
            q.address,
            q.jobDescription,
            q.basePrice,
            q.flexTier,
            q.flexWindowDays,
            JSON.stringify(q.skills),
            q.categories,
            JSON.stringify(q.availableDates),
            q.heavyLifting,
            q.crew,
            JSON.stringify([]),
            q.durationMinutes,
            q.createdAt,
        ];
        try {
            const { rows } = await client.query(INSERT_SQL, params);
            const r = rows[0];
            inserted.push(r);
            tierTally[q.flexTier]++;
            const head = q.postcode.split(/\s+/)[0];
            pcTally[head] = (pcTally[head] ?? 0) + 1;
            const sk = q.skills.join('+');
            skillTally[sk] = (skillTally[sk] ?? 0) + 1;
        } catch (err) {
            console.error(`  FAIL ${q.slug}: ${err.message}`);
            throw err;
        }
    }

    console.log(`\nInserted ${inserted.length} quotes`);
    console.log("\nTier distribution:");
    for (const [k, v] of Object.entries(tierTally)) {
        console.log(`  ${k.padEnd(10)} ${v} (${(v/QUOTES.length*100).toFixed(0)}%)`);
    }
    console.log("\nPostcode area distribution:");
    for (const [k, v] of Object.entries(pcTally).sort()) {
        console.log(`  ${k.padEnd(6)} ${v} (${(v/QUOTES.length*100).toFixed(0)}%)`);
    }
    console.log("\nSkill distribution:");
    for (const [k, v] of Object.entries(skillTally).sort()) {
        console.log(`  ${k.padEnd(20)} ${v} (${(v/QUOTES.length*100).toFixed(0)}%)`);
    }
}

try {
    await main();
} finally {
    client.release();
    await pool.end();
}
