// scripts/seed-test-units.mjs
//
// Wave 2B — Booking & Dispatch v2 cutover-to-preview
//
// Seeds 3 test contractors (one per segment) with availability for the next
// 14 days against the dev DB. Idempotent — uses fixed phones
// (+447900000001/2/3) and ON CONFLICT / WHERE clauses so re-runs do not
// duplicate.
//
//   Mark   — Builder      (NG7 2RD; full-day availability; one Friday day-commitment)
//   Sarah  — Gap-Filler   (NG2 1AH; AM-only availability)
//   Dave   — Specialist   (NG1 5AB; gas; full-day availability)
//
// Schema source of truth: shared/schema.ts (handymanProfiles, unitAvailability,
// dayCommitments) and docs/architecture/modules/{03,04}.
//
// Connects to DB via @neondatabase/serverless Pool (mirrors
// scripts/apply-phase0-schema.mjs). Self-contained — does not import the
// drizzle ORM client.

import { Pool, neonConfig } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import ws from "ws";
import { randomUUID } from "crypto";

neonConfig.webSocketConstructor = ws;

// ---------------------------------------------------------------------------
// dotenv-ish loader — read .env then .env.local (latter wins) without
// pulling in the dotenv package.
// ---------------------------------------------------------------------------
function loadEnvFile(path) {
    if (!existsSync(path)) return;
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
    }
}
loadEnvFile(new URL("../.env", import.meta.url).pathname);
loadEnvFile(new URL("../.env.local", import.meta.url).pathname);

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function addDaysIso(baseIso, n) {
    const d = new Date(baseIso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function nextFriday(baseIso) {
    // Day-of-week: 0=Sun..5=Fri..6=Sat (UTC). Find the next date (>= today)
    // whose UTC day === 5.
    const d = new Date(baseIso + "T00:00:00Z");
    for (let i = 0; i < 14; i++) {
        if (d.getUTCDay() === 5) return d.toISOString().slice(0, 10);
        d.setUTCDate(d.getUTCDate() + 1);
    }
    // Fallback (should never hit)
    return addDaysIso(baseIso, 7);
}

// ---------------------------------------------------------------------------
// Per-unit spec
// ---------------------------------------------------------------------------
const UNITS = [
    {
        key: "mark",
        phone: "+447900000001",
        firstName: "Mark",
        lastName: "Test",
        displayName: "Mark (Test Builder)",
        email: "mark.testbuilder@example.test",
        businessName: "Mark Test Builds",
        homePostcode: "NG7 2RD",
        catchment: ["NG7", "NG2", "NG8"],
        skills: ["plumbing", "joinery", "tiling", "painting"],
        certs: [],
        segment: "builder",
        dayRateTargetPence: 200_00,
        minJobValuePence: null,
        availabilityMode: "full",        // 14 days of `full` slots
        dayCommitment: {                 // upcoming Friday, NG7 catchment, £200
            startTime: "07:00",
            endTime: "15:00",
            areaFilter: ["NG7"],
            targetPence: 200_00,
        },
    },
    {
        key: "sarah",
        phone: "+447900000002",
        firstName: "Sarah",
        lastName: "Test",
        displayName: "Sarah (Test Gap-Filler)",
        email: "sarah.testgapfiller@example.test",
        businessName: "Sarah Test Trades",
        homePostcode: "NG2 1AH",
        catchment: ["NG2", "NG7"],
        skills: ["plumbing", "tiling"],
        certs: [],
        segment: "gap_filler",
        dayRateTargetPence: null,
        minJobValuePence: null,
        availabilityMode: "am",          // 14 days of `am` slots only
        dayCommitment: null,
    },
    {
        key: "dave",
        phone: "+447900000003",
        firstName: "Dave",
        lastName: "Test",
        displayName: "Dave (Test Specialist)",
        email: "dave.testspecialist@example.test",
        businessName: "Dave Test Gas",
        homePostcode: "NG1 5AB",
        catchment: ["NG1", "NG2", "NG7", "NG3"],
        skills: ["gas"],
        certs: ["gas_safe"],
        segment: "specialist",
        dayRateTargetPence: null,
        minJobValuePence: null,
        availabilityMode: "full",
        dayCommitment: null,
    },
];

// ---------------------------------------------------------------------------
// Seed flow
// ---------------------------------------------------------------------------
async function seedOneUnit(unit) {
    // 1) Resolve / clean: find any existing user by phone or email.
    //    handyman_profiles.user_id is NOT NULL FK -> users.id, so we must
    //    have a user row first. We delete any prior unit-availability /
    //    day-commitment / handyman_profile rows for this user before
    //    re-inserting. The user row itself is upserted so PK is stable
    //    across runs.

    // Reuse existing test user by stable id derived from phone if first run
    // didn't create one yet. We *don't* depend on a stable id — instead we
    // look up by phone/email.
    const existingUser = (await client.query(
        `SELECT id FROM users WHERE phone = $1 OR email = $2 LIMIT 1`,
        [unit.phone, unit.email]
    )).rows[0];

    let userId;
    if (existingUser) {
        userId = existingUser.id;
        // Make sure flag fields are right (idempotent update)
        await client.query(
            `UPDATE users SET first_name=$1, last_name=$2, role='contractor',
                              email_verified=true, is_active=true,
                              phone=$3, email=$4, updated_at=now()
             WHERE id=$5`,
            [unit.firstName, unit.lastName, unit.phone, unit.email, userId]
        );
    } else {
        userId = randomUUID();
        await client.query(
            `INSERT INTO users (id, email, first_name, last_name, phone, role,
                                email_verified, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'contractor', true, true, now(), now())`,
            [userId, unit.email, unit.firstName, unit.lastName, unit.phone]
        );
    }

    // 2) Clean prior dependent rows for any existing profile(s) for this user.
    const oldProfiles = (await client.query(
        `SELECT id FROM handyman_profiles WHERE user_id = $1`,
        [userId]
    )).rows.map((r) => r.id);
    for (const oldId of oldProfiles) {
        await client.query(`DELETE FROM unit_availability WHERE unit_id = $1`, [oldId]);
        await client.query(`DELETE FROM day_commitments WHERE unit_id = $1`, [oldId]);
    }
    // We *don't* delete the profile row itself — preserve the id for FK
    // safety and update in place. If multiple legacy profiles exist, keep
    // the first and delete the rest.
    let profileId;
    if (oldProfiles.length > 0) {
        profileId = oldProfiles[0];
        for (const extra of oldProfiles.slice(1)) {
            await client.query(`DELETE FROM handyman_profiles WHERE id = $1`, [extra]);
        }
    } else {
        profileId = randomUUID();
    }

    // 3) Upsert the handyman_profile.
    await client.query(
        `INSERT INTO handyman_profiles (
            id, user_id, business_name, bio,
            postcode, home_postcode,
            radius_miles, hourly_rate,
            verification_status, public_profile_enabled,
            contractor_segment, unit_type, crew_max,
            area_catchment, skills, certs,
            min_job_value_pence, day_rate_target_pence,
            reliability_score,
            created_at, updated_at
         )
         VALUES (
            $1, $2, $3, $4,
            $5, $5,
            10, 4000,
            'verified', false,
            $6::contractor_segment, 'single', 1,
            $7::jsonb, $8::jsonb, $9::jsonb,
            $10, $11,
            '1.00',
            now(), now()
         )
         ON CONFLICT (id) DO UPDATE SET
            business_name = EXCLUDED.business_name,
            bio = EXCLUDED.bio,
            postcode = EXCLUDED.postcode,
            home_postcode = EXCLUDED.home_postcode,
            contractor_segment = EXCLUDED.contractor_segment,
            unit_type = EXCLUDED.unit_type,
            crew_max = EXCLUDED.crew_max,
            area_catchment = EXCLUDED.area_catchment,
            skills = EXCLUDED.skills,
            certs = EXCLUDED.certs,
            min_job_value_pence = EXCLUDED.min_job_value_pence,
            day_rate_target_pence = EXCLUDED.day_rate_target_pence,
            updated_at = now()
        `,
        [
            profileId,
            userId,
            unit.businessName,
            `Test ${unit.segment} contractor seeded by scripts/seed-test-units.mjs`,
            unit.homePostcode,
            unit.segment,
            JSON.stringify(unit.catchment),
            JSON.stringify(unit.skills),
            JSON.stringify(unit.certs),
            unit.minJobValuePence,
            unit.dayRateTargetPence,
        ]
    );

    // 4) Insert availability rows for next 14 days.
    const start = todayIso();
    let availabilityRows = 0;
    for (let i = 0; i < 14; i++) {
        const date = addDaysIso(start, i);
        const slots =
            unit.availabilityMode === "full"
                ? ["full"]
                : unit.availabilityMode === "am"
                    ? ["am"]
                    : unit.availabilityMode === "pm"
                        ? ["pm"]
                        : ["am", "pm"];

        for (const slot of slots) {
            await client.query(
                `INSERT INTO unit_availability
                    (id, unit_id, date, slot, status, crew_available_count,
                     last_synced_at, created_at, updated_at)
                 VALUES
                    ($1, $2, $3::date, $4::slot, 'available'::availability_status,
                     1, now(), now(), now())
                 ON CONFLICT (unit_id, date, slot) DO UPDATE SET
                     status = EXCLUDED.status,
                     crew_available_count = EXCLUDED.crew_available_count,
                     last_synced_at = now(),
                     updated_at = now()`,
                [`ua_${randomUUID()}`, profileId, date, slot]
            );
            availabilityRows++;
        }
    }

    // 5) Optional day-commitment.
    let dayCommitments = 0;
    if (unit.dayCommitment) {
        const friday = nextFriday(start);
        const id = `dcm_${randomUUID()}`;
        await client.query(
            `INSERT INTO day_commitments
                (id, unit_id, date, start_time, end_time,
                 area_filter, target_pence, status,
                 created_at, updated_at)
             VALUES
                ($1, $2, $3::date, $4::time, $5::time,
                 $6::jsonb, $7, 'open'::day_commitment_status,
                 now(), now())
             ON CONFLICT (unit_id, date) DO UPDATE SET
                 start_time = EXCLUDED.start_time,
                 end_time = EXCLUDED.end_time,
                 area_filter = EXCLUDED.area_filter,
                 target_pence = EXCLUDED.target_pence,
                 status = 'open'::day_commitment_status,
                 updated_at = now()`,
            [
                id,
                profileId,
                friday,
                unit.dayCommitment.startTime,
                unit.dayCommitment.endTime,
                JSON.stringify(unit.dayCommitment.areaFilter),
                unit.dayCommitment.targetPence,
            ]
        );
        dayCommitments = 1;
    }

    console.log(
        `Seeded ${unit.displayName} (id=${profileId}, segment=${unit.segment}, ` +
        `availability=${availabilityRows}, day_commitments=${dayCommitments})`
    );

    return { profileId, availabilityRows, dayCommitments };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let totalContractors = 0;
let totalAvailability = 0;
let totalCommitments = 0;

try {
    for (const unit of UNITS) {
        const r = await seedOneUnit(unit);
        totalContractors += 1;
        totalAvailability += r.availabilityRows;
        totalCommitments += r.dayCommitments;
    }

    console.log("\n=== Seed summary ===");
    console.log(`Contractors:        ${totalContractors}`);
    console.log(`Availability rows:  ${totalAvailability}`);
    console.log(`Day commitments:    ${totalCommitments}`);
} finally {
    client.release();
    await pool.end();
}
