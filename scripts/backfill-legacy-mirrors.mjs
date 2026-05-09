#!/usr/bin/env node
/**
 * Backfill legacy contractor_booking_requests mirrors for v2 job_dispatches
 * rows that were created BEFORE Module 11 dual-write wiring went live.
 *
 * Why this exists:
 *   `server/migration/legacy-bridge.ts` was built but unwired through Wave 7.
 *   v2 dispatches (offer-accept, day-pack accept, contractor accept) accumulated
 *   with no legacy mirror. This script walks every locked-to-contractor dispatch
 *   that lacks a mirror and inserts/updates the legacy row.
 *
 * Mirrors the runtime helpers in legacy-bridge.ts but uses raw SQL so it
 * runs without booting the full server (and avoids the ESM/TS toolchain).
 *
 * Idempotency:
 *   - INSERT … ON CONFLICT DO NOTHING.
 *   - For dispatches in completed/cancelled state, also runs an UPDATE to
 *     align status/timestamps if the row already existed at an earlier state.
 *   - Re-running is safe — every operation is no-op once the mirror matches.
 *
 * Skips:
 *   - Dispatches with NULL locked_to_contractor_id (pre-accept broadcasts —
 *     legacy has no concept of an unaccepted offer).
 *
 * Usage: node scripts/backfill-legacy-mirrors.mjs
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'fs';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// Load .env / .env.local in the project root.
function loadEnv(file) {
    const url = new URL(file, import.meta.url);
    if (!existsSync(url)) return;
    const text = readFileSync(url, 'utf-8');
    for (const l of text.split('\n')) {
        const m = l.match(/^([A-Z_]+)=(.*)$/);
        if (m && !process.env[m[1]]) {
            process.env[m[1]] = m[2].replace(/^"|"$/g, '');
        }
    }
}

loadEnv('../.env');
loadEnv('../.env.local');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Mirrors mapDispatchStatus in legacy-bridge.ts.
function mapDispatchStatus(dispatchStatus) {
    switch (dispatchStatus) {
        case 'accepted':
            return { status: 'accepted', assignmentStatus: 'accepted' };
        case 'in_progress':
            return { status: 'accepted', assignmentStatus: 'in_progress' };
        case 'completed':
            return { status: 'completed', assignmentStatus: 'completed' };
        case 'cancelled':
            return { status: 'declined', assignmentStatus: 'rejected' };
        case 'pending':
        case 'locked':
        default:
            return { status: 'pending', assignmentStatus: 'assigned' };
    }
}

function safeName(d) {
    return d.customer_full_name ?? d.customer_first_name ?? 'Customer';
}

async function main() {
    // First, reconcile v2 dispatches that have a dispatch_completions row but
    // never had jobDispatches.status flipped to 'completed' (pre-wave-8 day-pack
    // stops). Aligns canonical state before mirroring downstream.
    const reconciled = await pool.query(`
        UPDATE job_dispatches jd
        SET status = 'completed',
            completed_at = COALESCE(jd.completed_at, dc.completed_at, NOW()),
            updated_at = NOW()
        FROM dispatch_completions dc
        WHERE dc.dispatch_id = jd.id
          AND jd.status <> 'completed'
        RETURNING jd.id
    `);
    if (reconciled.rowCount > 0) {
        console.log(`reconciled ${reconciled.rowCount} v2 dispatches: status -> completed (had dispatch_completions row)`);
    }

    // Pull every dispatch with a contractor locked.
    const { rows: dispatches } = await pool.query(`
        SELECT
            id, quote_id, locked_to_contractor_id, customer_first_name,
            customer_full_name, customer_phone, subtitle, status,
            scheduled_date, locked_at, completed_at, created_at
        FROM job_dispatches
        WHERE locked_to_contractor_id IS NOT NULL
        ORDER BY created_at ASC
    `);

    let filed = 0;
    let updated = 0;
    let skippedExisting = 0;

    for (const d of dispatches) {
        const { status: legacyStatus, assignmentStatus } = mapDispatchStatus(d.status);
        const name = safeName(d);
        const description = d.subtitle ?? '[v2 dispatch]';

        // Idempotent insert.
        const ins = await pool.query(
            `INSERT INTO contractor_booking_requests (
                id, quote_id, contractor_id, assigned_contractor_id,
                customer_name, customer_email, customer_phone, description,
                scheduled_date, requested_date,
                assignment_status, status,
                assigned_at, accepted_at, created_at
            ) VALUES (
                $1, $2, $3, $3,
                $4, NULL, $5, $6,
                $7, $7,
                $8, $9,
                $10, $11, $12
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING id`,
            [
                d.id,
                d.quote_id,
                d.locked_to_contractor_id,
                name,
                d.customer_phone,
                description,
                d.scheduled_date,
                assignmentStatus,
                legacyStatus,
                d.locked_at ?? new Date(),
                (d.status === 'accepted' || d.status === 'in_progress') ? (d.locked_at ?? new Date()) : null,
                d.created_at ?? new Date(),
            ],
        );

        if (ins.rowCount > 0) {
            filed++;
        } else {
            skippedExisting++;
        }

        // For completed/cancelled dispatches, ensure the row reflects the
        // terminal status even if the row was filed at an earlier state.
        if (d.status === 'completed' || d.status === 'cancelled') {
            const upd = await pool.query(
                `UPDATE contractor_booking_requests
                 SET status = $2,
                     assignment_status = $3,
                     completed_at = COALESCE($4, completed_at),
                     updated_at = NOW()
                 WHERE id = $1
                   AND (status IS DISTINCT FROM $2 OR assignment_status IS DISTINCT FROM $3)`,
                [d.id, legacyStatus, assignmentStatus, d.completed_at],
            );
            if (upd.rowCount > 0) updated++;
        }
    }

    console.log(`filed ${filed} mirrors (skipped ${skippedExisting} already present, updated ${updated} terminal-state rows) across ${dispatches.length} v2 dispatches`);
    await pool.end();
}

main().catch((err) => {
    console.error('backfill failed:', err);
    process.exit(1);
});
