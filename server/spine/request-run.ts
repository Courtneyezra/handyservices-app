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

// ---------------------------------------------------------------- P10: needs_quote schedules a pass
//
// Sarah (4c0e227b, 4 Sep): the thread carried `needs_quote` with no pass pending, so the clerk never
// ran until someone requested a run by hand. The tag was a label. Now every writer of the tag calls
// ensureQuoteRun, and the worker's slow sweep calls sweepUntriggeredQuotes as the net.

export const QUOTE_TAGS: readonly string[] = ['needs_quote', 'rescope'];
/** A pending run whose due time is further past than this is dead (a lease that expired unrun). */
export const STALE_PENDING_MINUTES = 10;
export const UNTRIGGERED_SWEEP_LIMIT = 5;

export interface QuoteRunState {
    tags: string[];
    /** metadata.nextTriageAt (ISO) — a pending or in-flight pass. */
    nextTriageAt: string | null;
    /** A non-superseded quote_estimates row that is running or produced a draft (see isLiveEstimate). */
    liveEstimate: boolean;
    /** metadata.quoteDraft points at a Route A draft that is not superseded. */
    liveDraft: boolean;
}

/** Pure: does this thread need a spine pass for its quote tag? */
/**
 * Is this estimate still "on the way" for the thread? Running, or finished with a draft, yes. A
 * failed estimate that never produced a draft is not: nothing is coming from it, and treating it
 * as live blocked the thread for good (Sarah, 4c0e227b, 4 Sep 2026 — the row was failed by hand
 * after a deploy killed the estimator, and every re-arm then answered "a live estimate already
 * exists"). Superseded rows never reach here.
 */
export function isLiveEstimate(est: { status: string; draftQuoteId?: string | null } | null | undefined): boolean {
    if (!est) return false;
    if (est.status === 'failed' && !est.draftQuoteId) return false;
    return true;
}

export function shouldRequestQuoteRun(state: QuoteRunState, now: Date = new Date()): { ok: true } | { ok: false; reason: string } {
    if (!state.tags.some((t) => QUOTE_TAGS.includes(t))) return { ok: false, reason: 'no needs_quote / rescope tag' };
    if (state.liveEstimate) return { ok: false, reason: 'a live estimate already exists' };
    if (state.liveDraft) return { ok: false, reason: 'a Route A draft already exists' };
    if (state.nextTriageAt) {
        const due = new Date(state.nextTriageAt).getTime();
        if (Number.isFinite(due) && now.getTime() - due < STALE_PENDING_MINUTES * 60_000) return { ok: false, reason: `a pass is already pending (due ${state.nextTriageAt})` };
    }
    return { ok: true };
}

export interface EnsureQuoteRunDeps {
    loadState: (conversationId: string) => Promise<QuoteRunState | null>;
    request: (conversationId: string) => Promise<{ queued: boolean; reason?: string }>;
    now?: () => Date;
}

async function defaultQuoteRunState(conversationId: string): Promise<QuoteRunState | null> {
    const [conv] = await db.select({ tags: conversations.tags, metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) return null;
    const meta = (conv.metadata ?? {}) as Record<string, any>;
    const { latestEstimateForConversation } = await import('./estimate-store');
    const liveEstimate = isLiveEstimate(await latestEstimateForConversation(conversationId).catch(() => null));
    let liveDraft = false;
    const draftId = meta.quoteDraft?.quoteId;
    if (typeof draftId === 'string' && draftId) {
        try {
            const { personalizedQuotes } = await import('@shared/schema');
            const [q] = await db.select({ supersededAt: personalizedQuotes.supersededAt, isDraft: personalizedQuotes.isDraft }).from(personalizedQuotes).where(eq(personalizedQuotes.id, draftId)).limit(1);
            liveDraft = !!q && !q.supersededAt && !!q.isDraft;
        } catch { liveDraft = false; }
    }
    return { tags: (conv.tags as string[] | null) ?? [], nextTriageAt: typeof meta.nextTriageAt === 'string' ? meta.nextTriageAt : null, liveEstimate, liveDraft };
}

/**
 * If the thread is tagged needs_quote / rescope and nothing is on the way (no live estimate or
 * Route A draft, no pending pass), ask for a cadence pass now. Idempotent; one log line. Never
 * throws: a tag write must not fail because the follow-up could not be scheduled.
 */
export async function ensureQuoteRun(conversationId: string, reason: string, deps: Partial<EnsureQuoteRunDeps> = {}): Promise<{ requested: boolean; reason: string }> {
    const loadState = deps.loadState ?? defaultQuoteRunState;
    const request = deps.request ?? ((id: string) => requestRun(id, 'cadence', { delayMs: 0 }));
    try {
        const state = await loadState(conversationId);
        if (!state) return { requested: false, reason: 'conversation not found' };
        const verdict = shouldRequestQuoteRun(state, (deps.now ?? (() => new Date()))());
        if (!verdict.ok) {
            console.log(`[Spine] ensureQuoteRun ${conversationId} (${reason}): no run — ${verdict.reason}`);
            return { requested: false, reason: verdict.reason };
        }
        const r = await request(conversationId);
        console.log(`[Spine] ensureQuoteRun ${conversationId} (${reason}): ${r.queued ? 'cadence pass requested' : `not queued (${r.reason})`}`);
        return { requested: r.queued, reason: r.queued ? 'requested' : (r.reason ?? 'not queued') };
    } catch (error: any) {
        console.warn(`[Spine] ensureQuoteRun ${conversationId} failed (tag stands):`, error?.message ?? error);
        return { requested: false, reason: `error: ${error?.message ?? error}` };
    }
}

export interface SweepUntriggeredDeps {
    /** Customer threads carrying a quote tag, oldest first; the sweep decides per thread. */
    candidates: () => Promise<string[]>;
    ensure: (conversationId: string, reason: string) => Promise<{ requested: boolean; reason: string }>;
    limit?: number;
}

async function defaultQuoteTagCandidates(): Promise<string[]> {
    const res: any = await db.execute(sql`
        SELECT id FROM conversations
        WHERE archived_at IS NULL
          AND (role_profile IS NULL OR role_profile = 'customer')
          AND tags && ARRAY['needs_quote','rescope']::text[]
        ORDER BY updated_at ASC NULLS FIRST
        LIMIT 50`);
    return ((res.rows ?? res) as Array<{ id: string }>).map((r) => String(r.id));
}

/**
 * The net (worker slow sweep, every 5 min): up to N customer threads tagged needs_quote / rescope
 * with nothing on the way get a pass requested. Runs in shadow too — Route A is internal.
 */
export async function sweepUntriggeredQuotes(deps: Partial<SweepUntriggeredDeps> = {}): Promise<{ checked: number; requested: string[] }> {
    const candidates = deps.candidates ?? defaultQuoteTagCandidates;
    const ensure = deps.ensure ?? ((id: string, why: string) => ensureQuoteRun(id, why));
    const limit = deps.limit ?? UNTRIGGERED_SWEEP_LIMIT;
    const requested: string[] = [];
    let checked = 0;
    try {
        for (const id of await candidates()) {
            if (requested.length >= limit) break;
            checked += 1;
            const r = await ensure(id, 'untriggered sweep');
            if (r.requested) requested.push(id);
        }
        if (requested.length) console.log(`[Spine] untriggered-quote sweep: ${requested.length} pass(es) requested of ${checked} checked`);
    } catch (error: any) {
        console.warn('[Spine] untriggered-quote sweep failed:', error?.message ?? error);
    }
    return { checked, requested };
}

interface DueRow { id: string; phone_number: string; due_at: string; trigger: string | null; run_id: string | null }

/**
 * Execute due runs. Worker-only, flag-only. Each row: shared claim → lease the due time (CAS on
 * its exact value, so a message arriving mid-claim re-arms cleanly) → runOnce → clear the lease
 * on success (a crashed run's lease simply expires and the next tick retries).
 */
export async function runDue(limit?: number): Promise<SpineRun[]> {
    if (!isCommsWorker()) return [];
    // P11: SIGTERM received — claim nothing new; in-flight passes finish inside the grace budget.
    if ((await import('./lifecycle')).isShuttingDown()) return [];
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
