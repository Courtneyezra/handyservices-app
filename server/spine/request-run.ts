/**
 * Ingest → claim (design §3.1). The ONE way a spine run is asked for, and the ONE way it is
 * dequeued.
 *
 *   requestRun(conversationId, trigger)   writes the debounce (a DATABASE ROW: metadata.nextTriageAt,
 *                                         the 20 Aug lesson — timers die with deploys) and records the
 *                                         trigger. Latest writer wins, so a burst renews its own due time.
 *   runDue(limit)                         executed ONLY by the comms worker (COMMS_WORKER=1) and ONLY
 *                                         when the spine flag is on: wins the shared run claim
 *                                         (claimTriageTurn, the 27 Aug fix), leases the due row, runs
 *                                         the spine once, clears the lease on success.
 *
 * The claim and the lease live here now (moved from comms-sweep.ts, which re-exports them so the
 * legacy tick keeps compiling). Same metadata key as the legacy debounce on purpose: with the flag
 * OFF, a requestRun still lands in the row the legacy fast tick reads, so the Ops Manager's
 * delegation keeps working through the old agent until Phase 3 flips the switch.
 */
import { db } from '../db';
import { conversations } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { isCommsWorker } from '../worker-gate';
import { getSpineConfig, isSpineEnabled } from './config';
import { spineMode } from './switch';
import { isTrigger } from './vocab';
import type { SpineRun, Trigger } from './types';

/** Between-runs floor per conversation, whichever path or process runs it. */
export const TRIAGE_TURN_MINUTES = 5;
/** How long a claimed due row is pushed out while the run is in flight; a dead run simply expires. */
export const RUN_LEASE_MINUTES = 4;

/**
 * THE atomic run claim — win this or do not run. One shared CAS on the conversation row (the
 * `WHERE status = 'pending'` shape from approveAndSendDraft): concurrent claimers serialise on the
 * row lock, losers match zero rows. The hold expires by itself; standing after a successful run
 * is the point — it is the floor 40 seconds of triple-send (27 Aug 2026) did not have.
 *
 * Returns the written hold value (the release token) on a win, null when someone else holds it.
 */
export async function claimTriageTurn(conversationId: string): Promise<string | null> {
    const now = new Date();
    const heldUntil = new Date(now.getTime() + TRIAGE_TURN_MINUTES * 60_000).toISOString();
    const res: any = await db.execute(sql`
        UPDATE conversations
        SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('triageHeldUntil', ${heldUntil}::text)
        WHERE id = ${conversationId}
          AND (metadata->>'triageHeldUntil' IS NULL OR metadata->>'triageHeldUntil' <= ${now.toISOString()})
        RETURNING id`);
    return ((res.rows ?? res) as unknown[]).length ? heldUntil : null;
}

/**
 * Give a won turn back WITHOUT having run — only for a claimer that then found nothing to do.
 * CAS on our own token so a later claimer's hold is never clobbered. Never after an actual run.
 */
export async function releaseTriageTurn(conversationId: string, token: string): Promise<void> {
    await db.execute(sql`
        UPDATE conversations SET metadata = metadata - 'triageHeldUntil'
        WHERE id = ${conversationId} AND metadata->>'triageHeldUntil' = ${token}`);
}

/** Ofcom test range — never spend a run on a smoke-test number. */
export { isTestNumber } from '../phone-utils';
import { isTestNumber } from '../phone-utils';

export interface RequestRunOpts {
    /** Override the debounce. inbound/media default to the configured debounce; everything else runs at once. */
    delayMs?: number;
    /** A run id minted by the caller (so its own writes can carry it before the run happens). */
    runId?: string;
}

/**
 * Ask for a run. Never runs anything itself; never throws for a business reason (the answer is
 * the return value, which every caller logs).
 */
export async function requestRun(conversationId: string, trigger: Trigger, opts: RequestRunOpts = {}): Promise<{ queued: boolean; reason?: string }> {
    if (!conversationId) return { queued: false, reason: 'no conversation id' };
    if (!isTrigger(trigger)) return { queued: false, reason: `unknown trigger ${String(trigger)}` };
    const [conv] = await db.select({ id: conversations.id, phoneNumber: conversations.phoneNumber, archivedAt: conversations.archivedAt })
        .from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) return { queued: false, reason: 'conversation not found' };
    if (conv.archivedAt) {
        // An inbound from the customer re-opens an archived thread (4 Sep 2026); other triggers
        // (cadence, manual, flag expiry) still respect the archive.
        if (trigger === 'inbound_message' || trigger === 'media_received' || trigger === 'call_ended') {
            await db.update(conversations).set({ archivedAt: null }).where(eq(conversations.id, conversationId));
            console.log(`[Spine] un-archived ${conversationId} on ${trigger}`);
        } else {
            return { queued: false, reason: 'conversation archived' };
        }
    }
    if (isTestNumber(conv.phoneNumber)) return { queued: false, reason: 'test number' };

    const cfg = await getSpineConfig();
    const debounced = trigger === 'inbound_message' || trigger === 'media_received';
    const delayMs = opts.delayMs ?? (debounced ? Math.max(3_000, cfg.debounceMinutes * 60_000) : 0);
    const due = new Date(Date.now() + Math.max(0, delayMs)).toISOString();

    const patch = opts.runId
        ? sql`jsonb_build_object('nextTriageAt', ${due}::text, 'nextTriageTrigger', ${trigger}::text, 'nextTriageRunId', ${opts.runId}::text)`
        : sql`jsonb_build_object('nextTriageAt', ${due}::text, 'nextTriageTrigger', ${trigger}::text)`;
    const rows = await db.update(conversations)
        .set({ metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || ${patch}` })
        .where(eq(conversations.id, conversationId))
        .returning({ id: conversations.id });
    if (!rows.length) return { queued: false, reason: 'conversation vanished' };
    console.log(`[Spine] requestRun ${conversationId} trigger=${trigger} due=${due}${opts.runId ? ` runId=${opts.runId}` : ''}`);
    return { queued: true };
}

interface DueRow { id: string; phone_number: string; due_at: string; trigger: string | null; run_id: string | null }

/**
 * Execute due runs. Worker-only, flag-only. Each row: shared claim → lease the due time (CAS on
 * its exact value, so a message arriving mid-claim re-arms cleanly) → runOnce → clear the lease
 * on success (a crashed run's lease simply expires and the next tick retries).
 */
export async function runDue(limit?: number): Promise<SpineRun[]> {
    if (!isCommsWorker()) return [];
    if (!(await isSpineEnabled())) return [];
    // P8-fix: in SHADOW the legacy tick runs the shadow pass itself (server/spine/shadow.ts) on the
    // same due rows. Until this gate, this loop ALSO ran a live pass on them — two passes per
    // thread one second apart, two clerk runs, two estimators (Gemma, 2 Sep 17:19). One path:
    // shadow = runShadow from the legacy tick; live = this loop.
    if ((await spineMode()) !== 'live') return [];
    const cfg = await getSpineConfig();
    const max = Math.max(1, Math.min(limit ?? cfg.sweepLimit, 10));

    const dueRes: any = await db.execute(sql`
        SELECT id, phone_number, metadata->>'nextTriageAt' AS due_at,
               metadata->>'nextTriageTrigger' AS trigger, metadata->>'nextTriageRunId' AS run_id
        FROM conversations
        WHERE archived_at IS NULL AND metadata->>'nextTriageAt' <= ${new Date().toISOString()}
        ORDER BY metadata->>'nextTriageAt' ASC
        LIMIT ${max}`);
    const rows = (dueRes.rows ?? dueRes) as DueRow[];
    const runs: SpineRun[] = [];

    for (const row of rows) {
        const turn = await claimTriageTurn(row.id);
        if (!turn) continue;
        const lease = new Date(Date.now() + RUN_LEASE_MINUTES * 60_000).toISOString();
        const claimed: any = await db.execute(sql`
            UPDATE conversations
            SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${lease}::text)
            WHERE id = ${row.id} AND metadata->>'nextTriageAt' = ${row.due_at}
            RETURNING id`);
        if (!((claimed.rows ?? claimed) as unknown[]).length) {
            await releaseTriageTurn(row.id, turn);
            continue;
        }
        const trigger: Trigger = isTrigger(row.trigger) ? row.trigger : 'inbound_message';
        console.log(`[Spine] due run ${row.id} trigger=${trigger} (lease ${lease})`);
        try {
            // Lazy: index.ts imports the whole chain; this module must stay light for the tick.
            const { runOnce } = await import('./index');
            const run = await runOnce(row.id, trigger, undefined, { runId: row.run_id ?? undefined });
            runs.push(run);
            await db.execute(sql`
                UPDATE conversations
                SET metadata = (metadata - 'nextTriageAt') - 'nextTriageTrigger' - 'nextTriageRunId'
                WHERE id = ${row.id} AND metadata->>'nextTriageAt' = ${lease}`);
        } catch (error: any) {
            console.error(`[Spine] run failed for ${row.id} (lease stands, will retry):`, error?.message ?? error);
        }
    }
    return runs;
}
