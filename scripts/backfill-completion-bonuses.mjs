#!/usr/bin/env node
/**
 * Backfill completion bonuses for day-packs whose stops have all been
 * marked complete but never got a pay_adjustments row written.
 *
 * Why this exists:
 *   Wave 4A/5A landed dispatch_completions + booking-state bridging, but
 *   never wired fileCompletionBonus into the stop-completion handler. So
 *   packs that completed before Wave 7 sit at booking-side
 *   `completed_pending_review` with NO completion_bonus row in
 *   pay_adjustments. This script back-fills those.
 *
 * Logic mirrors `maybeFileCompletionBonus` in
 *   server/routes/day-pack-public-routes.ts
 * (server-side canonical) and `evaluateAndFile` in
 *   server/pay-protection/completion-bonus.ts.
 *
 * Idempotency:
 *   - Skips packs that already have a completion_bonus row tied to any of
 *     their dispatches.
 *   - Re-running is safe.
 *
 * Side effects per filed pack:
 *   1. INSERT pay_adjustments (status=auto_approved, type=completion_bonus)
 *   2. UPDATE day_packs SET status='completed' WHERE status='accepted'
 *
 * Notification side effect (pay_adjustment_filed) is NOT emitted from this
 * script — back-fill is a quiet ops fix, not a live state transition.
 *
 * Usage: node scripts/backfill-completion-bonuses.mjs
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const env = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
for (const l of env.split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COMPLETION_BONUS_RATIO = 0.15; // ADR-007

async function main() {
    // 1. Find all packs whose every stop has a dispatch_completions row,
    //    grouped with the per-pack dispatch ids and existing bonus rows.
    const { rows: candidates } = await pool.query(`
        SELECT
            dp.id              AS pack_id,
            dp.unit_id         AS unit_id,
            dp.commitment_id   AS commitment_id,
            dp.status          AS pack_status,
            dp.job_ids         AS job_ids,
            dc.target_pence    AS target_pence
        FROM day_packs dp
        JOIN day_commitments dc ON dc.id = dp.commitment_id
        WHERE dp.status IN ('accepted', 'completed')
    `);

    let filed = 0;
    let skippedAlreadyFiled = 0;
    let skippedIncomplete = 0;
    let skippedPickup = 0;

    for (const pack of candidates) {
        const jobIds = pack.job_ids ?? [];
        if (!Array.isArray(jobIds) || jobIds.length === 0) continue;

        // Resolve dispatches.
        const { rows: dispatches } = await pool.query(
            `SELECT id, quote_id FROM job_dispatches WHERE quote_id = ANY($1::text[])`,
            [jobIds],
        );
        if (dispatches.length === 0) {
            skippedIncomplete++;
            continue;
        }
        const dispatchIds = dispatches.map((d) => d.id);

        // All stops complete?
        const { rows: completions } = await pool.query(
            `SELECT DISTINCT dispatch_id FROM dispatch_completions WHERE dispatch_id = ANY($1::text[])`,
            [dispatchIds],
        );
        if (completions.length < jobIds.length) {
            skippedIncomplete++;
            continue;
        }

        // Materials pickup gate.
        const { rows: pickups } = await pool.query(
            `SELECT status FROM materials_pickups WHERE day_pack_id = $1 LIMIT 1`,
            [pack.pack_id],
        );
        const pickupRequired = pickups.length > 0;
        const pickupOk = !pickupRequired
            || pickups[0].status === 'collected'
            || pickups[0].status === 'skipped';
        if (!pickupOk) {
            skippedPickup++;
            continue;
        }

        // Idempotency: already filed?
        const { rows: existing } = await pool.query(
            `SELECT id FROM pay_adjustments
             WHERE dispatch_id = ANY($1::text[]) AND type = 'completion_bonus'
             LIMIT 1`,
            [dispatchIds],
        );
        if (existing.length > 0) {
            skippedAlreadyFiled++;
            continue;
        }

        // Compute amount + anchor.
        const bonusAmountPence = Math.round(Number(pack.target_pence) * COMPLETION_BONUS_RATIO);
        if (bonusAmountPence <= 0) continue;

        const orderedDispatchByQuoteId = new Map(dispatches.map((d) => [d.quote_id, d.id]));
        const anchorDispatchId = orderedDispatchByQuoteId.get(jobIds[0]) ?? dispatches[0].id;

        const id = `pa_${randomUUID()}`;
        const reason = `completion_bonus | all_stops_done (${jobIds.length}/${jobIds.length}, pickup ${pickupOk ? (pickupRequired ? 'done' : 'n/a') : 'pending'}) [backfill]`;

        await pool.query(
            `INSERT INTO pay_adjustments
                (id, dispatch_id, unit_id, type, amount_pence, reason,
                 evidence_photos, status, resolved_at, resolved_by, created_at)
             VALUES
                ($1, $2, $3, 'completion_bonus', $4, $5, '[]'::jsonb,
                 'auto_approved', NOW(), 'system', NOW())`,
            [id, anchorDispatchId, pack.unit_id, bonusAmountPence, reason],
        );

        // Pack status transition (Wave 5A gap).
        if (pack.pack_status === 'accepted') {
            await pool.query(
                `UPDATE day_packs SET status='completed', updated_at=NOW()
                 WHERE id=$1 AND status='accepted'`,
                [pack.pack_id],
            );
        }

        console.log(`  filed pa=${id} pack=${pack.pack_id} dispatch=${anchorDispatchId} amount=${bonusAmountPence}p`);
        filed++;
    }

    console.log('');
    console.log(`filed ${filed} bonuses`);
    console.log(`skipped: already_filed=${skippedAlreadyFiled} incomplete=${skippedIncomplete} pickup_pending=${skippedPickup}`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error(err);
        pool.end();
        process.exit(1);
    });
