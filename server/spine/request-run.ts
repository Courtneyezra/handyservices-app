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
    /**
     * D7 (6 Sep 2026): a pending agent draft the customer has not written past — the desk has
     * already spoken for this turn and is waiting on Ben. Loaded by the untriggered-quote NET only
     * (see sweepQuoteRunState): the direct requesters fire once per cause and leave it unset.
     */
    pendingDraft?: boolean;
    /**
     * D1 / D10 (7 Sep 2026): a finished pass already looked at this customer turn and nothing has
     * changed since (metadata.lastSpinePass judged by lastPassCoversThisTurn). Loaded by the NET
     * only, like pendingDraft: the direct requesters fire once per cause and leave it unset.
     */
    passedThisTurn?: boolean;
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
    // D7: the runaway cadence loop (561 Scoper runs on one thread in 7 days, 591 refused at the
    // draft queue). A pass that produces no estimate and no Route A draft leaves the thread exactly
    // as it found it, so a clock that only asks "is something on the way?" asks again every five
    // minutes. A pending agent draft the customer has not written past is the cheapest proof that
    // nothing has changed: the desk already spoke for this turn, and the answer is Ben's, not a
    // re-run's. Same rule the legacy slow sweep applies before line 154 (comms-sweep.ts:128).
    if (state.pendingDraft) return { ok: false, reason: 'a pending draft already answers this turn (waiting on Ben, nothing new from the customer)' };
    // D1 / D10: the half of that loop a pending draft does not cover (284 clerk runs on one thread
    // in 30 hours, 7 Sep 2026). A pass whose lane leaves NO draft — the P19 Ben-lane clerk with an
    // intake short of quote_ready and a flag deduped on needs_ben; a Scoper deciding none — leaves
    // the thread byte-for-byte as it found it, so every other question here has the same answer
    // five minutes later. The pass now leaves a stamp (metadata.lastSpinePass, written by runDue),
    // and the net reads it against the customer's latest inbound and the quote tags on the row: a
    // new customer turn, or a quote tag the pass did not find, re-opens the thread; a clock does not.
    if (state.passedThisTurn) return { ok: false, reason: 'the desk already looked at this turn (a pass finished after the customer\'s last message and no quote tag has landed since); waiting on the customer or Ben' };
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

/** P19: the two "something is already coming" halves of QuoteRunState, on their own. */
export type QuoteWorkInFlight = Pick<QuoteRunState, 'liveEstimate' | 'liveDraft'>;

/**
 * P19: is a quote already on its way for this thread — a live estimate, or a Route A draft that
 * has not been superseded? The re-run guard both the scheduler (shouldRequestQuoteRun) and the
 * in-pass Ben-lane clerk (server/spine/index.ts) read, so one answer governs both. Read-only.
 */
export async function quoteWorkInFlight(conversationId: string, metadata?: Record<string, any> | null): Promise<QuoteWorkInFlight> {
    const meta = metadata ?? (await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId)).limit(1))[0]?.metadata as Record<string, any> | undefined ?? {};
    const { latestEstimateForConversation } = await import('./estimate-store');
    const liveEstimate = isLiveEstimate(await latestEstimateForConversation(conversationId).catch(() => null));
    let liveDraft = false;
    const draftId = meta?.quoteDraft?.quoteId;
    if (typeof draftId === 'string' && draftId) {
        try {
            const { personalizedQuotes } = await import('@shared/schema');
            const [q] = await db.select({ supersededAt: personalizedQuotes.supersededAt, isDraft: personalizedQuotes.isDraft }).from(personalizedQuotes).where(eq(personalizedQuotes.id, draftId)).limit(1);
            liveDraft = !!q && !q.supersededAt && !!q.isDraft;
        } catch { liveDraft = false; }
    }
    return { liveEstimate, liveDraft };
}

async function defaultQuoteRunState(conversationId: string): Promise<QuoteRunState | null> {
    const [conv] = await db.select({ tags: conversations.tags, metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) return null;
    const meta = (conv.metadata ?? {}) as Record<string, any>;
    const inFlight = await quoteWorkInFlight(conversationId, meta);
    return { tags: (conv.tags as string[] | null) ?? [], nextTriageAt: typeof meta.nextTriageAt === 'string' ? meta.nextTriageAt : null, ...inFlight };
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

// ---------------------------------------------------------------- D7: has the desk already spoken for this turn?

export interface PendingDraftRef { createdAt: Date | string; basedOnInboundId?: string | null }

/**
 * Pure. Does one of these pending agent drafts answer the customer's latest inbound (or a thread
 * that has no inbound at all)? Identity first (the draft names the inbound it answered), then the
 * clock: a draft written at or after the latest inbound was written for it. A draft the customer
 * has since written past does not count — P7 supersedes it on the inbound path, and the next
 * agent run's queueDraft retires it anyway.
 */
export function pendingDraftAnswersLatestInbound(drafts: readonly PendingDraftRef[], latestInbound: { id: string; at: Date } | null | undefined): boolean {
    return drafts.some((d) => {
        if (!latestInbound) return true;
        if (d.basedOnInboundId) return d.basedOnInboundId === latestInbound.id;
        const created = new Date(d.createdAt).getTime();
        return Number.isFinite(created) && created >= latestInbound.at.getTime();
    });
}

/**
 * DB: is a pending spine / comms_agent draft standing on this thread that the customer has not
 * written past? Matched on the thread id and on the E.164 phone (the case file's `+digits`), the
 * two keys queueDraft writes. Throws are the caller's: the net's loader fails closed (no run).
 */
export async function pendingAgentDraftAwaitsBen(conversationId: string, phoneNumber: string | null | undefined, latestInbound?: { id: string; at: Date } | null): Promise<boolean> {
    const { messageDrafts } = await import('@shared/schema');
    const { and, desc, inArray, or } = await import('drizzle-orm');
    const { AGENT_DRAFT_SOURCES, latestInboundFor } = await import('../draft-freshness');
    const digits = (phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
    const byThread = eq(messageDrafts.conversationId, conversationId);
    const drafts = await db.select({ createdAt: messageDrafts.createdAt, basedOnInboundId: messageDrafts.basedOnInboundId })
        .from(messageDrafts)
        .where(and(
            eq(messageDrafts.status, 'pending'),
            inArray(messageDrafts.source, Array.from(AGENT_DRAFT_SOURCES)),
            digits ? or(byThread, eq(messageDrafts.phone, `+${digits}`)) : byThread,
        ))
        .orderBy(desc(messageDrafts.createdAt)).limit(5);
    if (!drafts.length) return false;
    return pendingDraftAnswersLatestInbound(drafts, latestInbound === undefined ? await latestInboundFor(conversationId) : latestInbound);
}

// ---------------------------------------------------------------- D1 / D10: has the desk already looked at this turn?
//
// The stamp a finished pass leaves on the thread: metadata.lastSpinePass. Same shape as the legacy
// sweep's lastAutoTriageAt (comms-sweep.ts:145) — a per-thread mark on the conversation row, no
// table, no migration — and the same reader as D7's pending-draft check: the customer's latest
// inbound. The quote tags recorded are the ones the pass FOUND (caseFile.tags), never the ones it
// wrote: in live mode the in-pass direct requesters (triage.ts, exit.ts) are refused by the run's
// own lease ("a pass is already pending"), so a tag that lands during a pass is scheduled by the
// net, and it must show as new on the net's next look.

export const LAST_SPINE_PASS_KEY = 'lastSpinePass';

export interface SpinePassStamp {
    /** ISO: when the pass STARTED (before the case file was built), so a message that arrived mid-pass is newer than it. */
    at: string;
    trigger?: string | null;
    runId?: string | null;
    /** QUOTE_TAGS present on the row when the pass found it. Absent on a stamp written before this field: treated as none seen. */
    quoteTags?: string[];
}

/** Pure: the stamp for a finished pass. */
export function spinePassStamp(run: { runId: string; trigger: string; caseFile: { tags: readonly string[] } }, startedAt: Date): SpinePassStamp {
    return { at: startedAt.toISOString(), trigger: run.trigger, runId: run.runId, quoteTags: QUOTE_TAGS.filter((t) => run.caseFile.tags.includes(t)) };
}

/** Pure: read the stamp off a conversation's metadata; anything malformed is no stamp. */
export function readSpinePassStamp(metadata: Record<string, any> | null | undefined): SpinePassStamp | null {
    const raw = metadata?.[LAST_SPINE_PASS_KEY];
    if (!raw || typeof raw !== 'object' || typeof raw.at !== 'string') return null;
    const stamp: SpinePassStamp = { at: raw.at };
    if (typeof raw.trigger === 'string') stamp.trigger = raw.trigger;
    if (typeof raw.runId === 'string') stamp.runId = raw.runId;
    if (Array.isArray(raw.quoteTags)) stamp.quoteTags = raw.quoteTags.filter((t: unknown) => typeof t === 'string');
    return stamp;
}

/**
 * Pure. Does the last finished pass cover this turn? Yes when it started at or after the
 * customer's latest inbound (or the thread has no inbound at all) AND no quote tag is on the row
 * now that the pass did not find. A new customer turn or a freshly landed quote tag re-opens the
 * thread; nothing else does — that is the point, a clock must not.
 */
export function lastPassCoversThisTurn(stamp: SpinePassStamp | null | undefined, latestInbound: { id: string; at: Date } | null | undefined, tagsNow: readonly string[]): boolean {
    if (!stamp) return false;
    const at = new Date(stamp.at).getTime();
    if (!Number.isFinite(at)) return false;
    const seen = stamp.quoteTags ?? [];
    if (QUOTE_TAGS.some((t) => tagsNow.includes(t) && !seen.includes(t))) return false;
    if (!latestInbound) return true;
    return at >= latestInbound.at.getTime();
}

/** DB: merge the stamp into the thread's metadata. runDue folds this into its lease-clearing UPDATE; the shadow path calls it. */
export async function recordSpinePass(conversationId: string, stamp: SpinePassStamp): Promise<void> {
    await db.execute(sql`
        UPDATE conversations
        SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastSpinePass', ${JSON.stringify(stamp)}::jsonb)
        WHERE id = ${conversationId}`);
}

/** The net's loader: the default state plus the D7 pending-draft check and the D1 last-pass stamp, both judged against the same latest inbound. */
async function sweepQuoteRunState(conversationId: string): Promise<QuoteRunState | null> {
    const state = await defaultQuoteRunState(conversationId);
    if (!state) return null;
    const [conv] = await db.select({ phoneNumber: conversations.phoneNumber, metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    const { latestInboundFor } = await import('../draft-freshness');
    const latestInbound = await latestInboundFor(conversationId);
    return {
        ...state,
        pendingDraft: await pendingAgentDraftAwaitsBen(conversationId, conv?.phoneNumber, latestInbound),
        passedThisTurn: lastPassCoversThisTurn(readSpinePassStamp(conv?.metadata as Record<string, any> | null), latestInbound, state.tags),
    };
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
 *
 * D7: this is the only requester of a cadence run that fires on a clock, so it is the only one
 * that reads the pending-draft state (sweepQuoteRunState). A thread whose last pass left a
 * pending draft the customer has not written past is not asked again until Ben acts on the draft
 * or the customer writes — either of which reaches the spine on its own trigger.
 */
export async function sweepUntriggeredQuotes(deps: Partial<SweepUntriggeredDeps> = {}): Promise<{ checked: number; requested: string[] }> {
    const candidates = deps.candidates ?? defaultQuoteTagCandidates;
    const ensure = deps.ensure ?? ((id: string, why: string) => ensureQuoteRun(id, why, { loadState: sweepQuoteRunState }));
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
            const passStartedAt = new Date();
            const run = await runOnce(row.id, trigger, undefined, { runId: row.run_id ?? undefined });
            runs.push(run);
            // D1 / D10: the same write that clears the lease leaves the pass's stamp, so the net can
            // tell "already looked at this turn" from "nobody has looked". Only when the lease still
            // matches: a message that re-armed the row mid-run leaves no stamp, and its own pass will.
            // A thrown run never reaches here — the lease expires and the next tick retries, as before.
            const stamp = spinePassStamp(run, passStartedAt);
            await db.execute(sql`
                UPDATE conversations
                SET metadata = ((metadata - 'nextTriageAt') - 'nextTriageTrigger' - 'nextTriageRunId') || jsonb_build_object('lastSpinePass', ${JSON.stringify(stamp)}::jsonb)
                WHERE id = ${row.id} AND metadata->>'nextTriageAt' = ${lease}`);
        } catch (error: any) {
            console.error(`[Spine] run failed for ${row.id} (lease stands, will retry):`, error?.message ?? error);
        }
    }
    return runs;
}
