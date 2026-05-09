// scripts/seed-volume-commits.mjs
//
// Set up Mark with 5 working days of Builder commitments for the volume test.
// Idempotent: skips dates where commitment is offered/accepted (existing pack).
//
// Usage: node scripts/seed-volume-commits.mjs

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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

const MARK_ID = '402a5350-86b3-4c05-90aa-d9307bcd9bcf';

const COMMITS = [
    { date: '2026-05-12', start: '07:00', end: '15:00', areas: ['NG7', 'NG8'], target: 24000 },
    { date: '2026-05-13', start: '07:00', end: '15:00', areas: ['NG2', 'NG7'], target: 24000 },
    { date: '2026-05-14', start: '07:00', end: '15:00', areas: ['NG7'],         target: 24000 },
    { date: '2026-05-15', start: '07:00', end: '15:00', areas: ['NG7'],         target: 20000 },
    { date: '2026-05-16', start: '07:00', end: '15:00', areas: ['NG7', 'NG3'], target: 20000 },
];

async function main() {
    console.log("=== Mark's commitment seeding ===\n");

    for (const cm of COMMITS) {
        const { rows: existing } = await client.query(
            `SELECT id, status, area_filter, target_pence FROM day_commitments WHERE unit_id = $1 AND date = $2`,
            [MARK_ID, cm.date],
        );

        if (existing.length > 0) {
            const ex = existing[0];
            if (ex.status === 'offered' || ex.status === 'accepted') {
                console.log(`  ${cm.date}: SKIP (status=${ex.status}, areas=${JSON.stringify(ex.area_filter)}, target=£${(ex.target_pence/100).toFixed(0)})`);
                continue;
            }
            // Update if open/assembling/released
            await client.query(
                `UPDATE day_commitments SET start_time = $1, end_time = $2, area_filter = $3::jsonb, target_pence = $4, status = 'open', released_at = NULL, released_reason = NULL, updated_at = NOW() WHERE id = $5`,
                [cm.start, cm.end, JSON.stringify(cm.areas), cm.target, ex.id],
            );
            console.log(`  ${cm.date}: UPDATE (was ${ex.status}) → open, areas=${JSON.stringify(cm.areas)}, target=£${(cm.target/100).toFixed(0)}`);
        } else {
            const newId = `dcm_${crypto.randomUUID()}`;
            await client.query(
                `INSERT INTO day_commitments (id, unit_id, date, start_time, end_time, area_filter, target_pence, status)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'open')`,
                [newId, MARK_ID, cm.date, cm.start, cm.end, JSON.stringify(cm.areas), cm.target],
            );
            console.log(`  ${cm.date}: INSERT new commitment, areas=${JSON.stringify(cm.areas)}, target=£${(cm.target/100).toFixed(0)}`);
        }

        // Ensure unit_availability slot=full,status=available exists
        const { rows: ua } = await client.query(
            `SELECT id, status FROM unit_availability WHERE unit_id = $1 AND date = $2 AND slot = 'full'`,
            [MARK_ID, cm.date],
        );
        if (ua.length === 0) {
            const uaId = `ua_${crypto.randomUUID()}`;
            await client.query(
                `INSERT INTO unit_availability (id, unit_id, date, slot, status, crew_available_count) VALUES ($1, $2, $3, 'full', 'available', 1)`,
                [uaId, MARK_ID, cm.date],
            );
            console.log(`    + unit_availability INSERT`);
        } else {
            console.log(`    = unit_availability exists (status=${ua[0].status})`);
        }
    }

    console.log("\n=== Final commitment state ===");
    const { rows: final } = await client.query(
        `SELECT date, area_filter, target_pence, status FROM day_commitments WHERE unit_id = $1 AND date >= '2026-05-12' AND date <= '2026-05-16' ORDER BY date`,
        [MARK_ID],
    );
    for (const r of final) {
        const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date;
        console.log(`  ${dateStr} areas=${JSON.stringify(r.area_filter)} target=£${(r.target_pence/100).toFixed(0)} status=${r.status}`);
    }
}

try {
    await main();
} finally {
    client.release();
    await pool.end();
}
