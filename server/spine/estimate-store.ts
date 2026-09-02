/**
 * quote_estimates (P8 Route A): the estimator's judgement per intake run, persisted.
 *
 * The shapes here are the contract the three P8 panes share (BRIEF-P8-chain.md §1). An
 * EstimateLine carries time as a RANGE, materials with cost, flags and a confidence — never a
 * price. `job` carries the ONE setup and ONE cleanup allowance per job (no per-line buffers).
 *
 * Pure helpers (`emptyEstimate`, `selectSupersededEstimates`) are tested; the db helpers are
 * SELECT / INSERT / one UPDATE each and never throw into the chain (a bookkeeping failure is
 * logged and the caller decides).
 */

export type EstimateConfidence = 'low' | 'medium' | 'high';
export type TimeSource = 'history' | 'model' | 'fallback';
export type EstimateStatus = 'running' | 'complete' | 'failed';

export interface EstimateMaterial {
    name: string;
    qty: number;
    unitCostPence: number;
    source: 'catalog' | 'screwfix' | 'web' | 'model';
    needsReview?: boolean;
    supplierUrl?: string | null;
    supplierItemNumber?: string | null;
    catalogId?: string | null;
}

export interface EstimateLine {
    lineId: string;
    title: string;
    category: string;
    minutesLow: number;
    minutesHigh: number;
    minutesPoint: number;
    materials: EstimateMaterial[];
    /** access / difficulty flags: 'ladder', 'no_parking', 'occupied', 'unknown_substrate', … */
    flags: string[];
    confidence: EstimateConfidence;
    reasoning: string;
    timeSource: TimeSource;
    /** What the estimator could not resolve for this line (Ben to source). */
    unresolved?: string | null;
    procedure?: string[];
    assumptions?: string[];
}

export interface EstimateJob {
    setupMinutes: number;
    cleanupMinutes: number;
    accessNotes: string[];
}

export interface QuoteEstimate {
    id: string;
    conversationId: string | null;
    runId: string | null;
    draftQuoteId: string | null;
    intakeRunId: string | null;
    status: EstimateStatus;
    lines: EstimateLine[];
    job: EstimateJob;
    confidence: EstimateConfidence | null;
    model: string | null;
    costPence: number | null;
    error?: string | null;
    createdAt: string;
    finishedAt: string | null;
    supersededAt: string | null;
}

/** The estimate's overall confidence: the weakest line (a quote is as sure as its least sure line). */
export function overallConfidence(lines: EstimateLine[]): EstimateConfidence | null {
    if (!lines.length) return null;
    const rank: Record<EstimateConfidence, number> = { low: 0, medium: 1, high: 2 };
    return lines.reduce<EstimateConfidence>((acc, l) => (rank[l.confidence] < rank[acc] ? l.confidence : acc), 'high');
}

export function newEstimateId(): string {
    return `est_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Pure: which live estimates a new intake on this thread supersedes (everything except the new one). */
export function selectSupersededEstimates<T extends { id: string; conversationId: string | null; supersededAt: string | Date | null }>(rows: T[], conversationId: string, keepId?: string | null): T[] {
    return rows.filter((r) => r.conversationId === conversationId && !r.supersededAt && r.id !== keepId);
}

// ---------------------------------------------------------------- db

function rowToEstimate(r: any): QuoteEstimate {
    return {
        id: String(r.id), conversationId: r.conversationId ?? null, runId: r.runId ?? null, draftQuoteId: r.draftQuoteId ?? null,
        intakeRunId: r.intakeRunId ?? null, status: (r.status ?? 'running') as EstimateStatus,
        lines: Array.isArray(r.lines) ? (r.lines as EstimateLine[]) : [],
        job: (r.job ?? { setupMinutes: 0, cleanupMinutes: 0, accessNotes: [] }) as EstimateJob,
        confidence: (r.confidence ?? null) as EstimateConfidence | null, model: r.model ?? null,
        costPence: r.costPence == null ? null : Number(r.costPence), error: r.error ?? null,
        createdAt: new Date(r.createdAt).toISOString(), finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
        supersededAt: r.supersededAt ? new Date(r.supersededAt).toISOString() : null,
    };
}

export async function insertEstimate(input: {
    id?: string; conversationId: string | null; runId?: string | null; intakeRunId?: string | null; status?: EstimateStatus;
    lines?: EstimateLine[]; job?: EstimateJob; model?: string | null;
}): Promise<string> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const id = input.id ?? newEstimateId();
    await db.insert(quoteEstimates).values({
        id, conversationId: input.conversationId, runId: input.runId ?? null, intakeRunId: input.intakeRunId ?? null,
        status: input.status ?? 'running', lines: (input.lines ?? []) as any, job: (input.job ?? null) as any,
        confidence: input.lines?.length ? overallConfidence(input.lines) : null, model: input.model ?? null, createdAt: new Date(),
    });
    return id;
}

// ---------------------------------------------------------------- P8-fix: single flight

/** An estimator started within this long ago on the same thread is still in flight. */
export const IN_FLIGHT_MINUTES = 10;

export interface ClaimRefusal { claimed: false; reason: string; existingId: string | null }
export type ClaimResult = { claimed: true; id: string } | ClaimRefusal;

/**
 * Pure: may a new estimator start? Refused when a live (non-superseded) estimate already exists
 * for this intake run — complete, failed or running — or when another run on the same thread is
 * still in flight. A failed row is a refusal too: Route A prices the fallback draft from it and
 * a re-run is an explicit manual request that supersedes it first.
 */
export function canClaim(input: {
    intakeRunId: string;
    liveForIntake: { id: string; status: string } | null;
    runningForConversation: Array<{ id: string; intakeRunId: string | null; createdAt: string | Date }>;
    now?: Date;
}): { ok: true } | ClaimRefusal {
    if (input.liveForIntake) return { claimed: false, reason: `estimate ${input.liveForIntake.id} (${input.liveForIntake.status}) already exists for intake run ${input.intakeRunId}`, existingId: input.liveForIntake.id };
    const now = (input.now ?? new Date()).getTime();
    const inFlight = input.runningForConversation.find((r) => now - new Date(r.createdAt).getTime() < IN_FLIGHT_MINUTES * 60_000);
    if (inFlight) return { claimed: false, reason: `estimator ${inFlight.id} still in flight on this thread (intake ${inFlight.intakeRunId ?? '?'})`, existingId: inFlight.id };
    return { ok: true };
}

/**
 * Claim the estimator run for an intake: read, decide, insert `running`. The partial unique index
 * (migration 20260904_quote_estimates_single_flight) turns a lost race into a refusal as well.
 */
export async function claimEstimate(input: { conversationId: string | null; runId?: string | null; intakeRunId: string; model?: string | null; now?: Date }): Promise<ClaimResult> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { and, eq, isNull, desc } = await import('drizzle-orm');
    const [live] = await db.select({ id: quoteEstimates.id, status: quoteEstimates.status }).from(quoteEstimates)
        .where(and(eq(quoteEstimates.intakeRunId, input.intakeRunId), isNull(quoteEstimates.supersededAt))).orderBy(desc(quoteEstimates.createdAt)).limit(1);
    const running = input.conversationId
        ? await db.select({ id: quoteEstimates.id, intakeRunId: quoteEstimates.intakeRunId, createdAt: quoteEstimates.createdAt }).from(quoteEstimates)
            .where(and(eq(quoteEstimates.conversationId, input.conversationId), eq(quoteEstimates.status, 'running'), isNull(quoteEstimates.supersededAt)))
        : [];
    const verdict = canClaim({ intakeRunId: input.intakeRunId, liveForIntake: live ?? null, runningForConversation: running, now: input.now });
    if (!('ok' in verdict)) return verdict;
    try {
        const id = await insertEstimate({ conversationId: input.conversationId, runId: input.runId ?? null, intakeRunId: input.intakeRunId, status: 'running', model: input.model ?? null });
        return { claimed: true, id };
    } catch (error: any) {
        if (error?.code === '23505' || /unique|duplicate key/i.test(String(error?.message))) {
            return { claimed: false, reason: `lost the race: a live estimate for intake run ${input.intakeRunId} was inserted concurrently`, existingId: null };
        }
        throw error;
    }
}

/** P11: running estimates created before `olderThan` — the ones a restart killed. Superseded rows included (tidied, never priced). */
export async function listRunningEstimatesOlderThan(olderThan: Date): Promise<Array<{ id: string; conversationId: string | null; intakeRunId: string | null; supersededAt: string | null }>> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { and, eq, lt } = await import('drizzle-orm');
    const rows = await db.select({ id: quoteEstimates.id, conversationId: quoteEstimates.conversationId, intakeRunId: quoteEstimates.intakeRunId, supersededAt: quoteEstimates.supersededAt })
        .from(quoteEstimates).where(and(eq(quoteEstimates.status, 'running'), lt(quoteEstimates.createdAt, olderThan))).limit(100);
    return rows.map((r) => ({ id: r.id, conversationId: r.conversationId ?? null, intakeRunId: r.intakeRunId ?? null, supersededAt: r.supersededAt ? new Date(r.supersededAt).toISOString() : null }));
}

export async function finishEstimate(id: string, patch: { status: EstimateStatus; lines?: EstimateLine[]; job?: EstimateJob; model?: string | null; costPence?: number | null; error?: string | null; draftQuoteId?: string | null; runId?: string | null }): Promise<void> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(quoteEstimates).set({
        status: patch.status, finishedAt: new Date(),
        ...(patch.lines ? { lines: patch.lines as any, confidence: overallConfidence(patch.lines) } : {}),
        ...(patch.job ? { job: patch.job as any } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.costPence !== undefined ? { costPence: patch.costPence } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.draftQuoteId !== undefined ? { draftQuoteId: patch.draftQuoteId } : {}),
        ...(patch.runId !== undefined ? { runId: patch.runId } : {}),
    }).where(eq(quoteEstimates.id, id));
}

export async function getEstimate(id: string): Promise<QuoteEstimate | null> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(quoteEstimates).where(eq(quoteEstimates.id, id)).limit(1);
    return row ? rowToEstimate(row) : null;
}

/** The live (not superseded) estimate for an intake run, if the chain already ran on it. */
export async function findLiveEstimateForIntake(intakeRunId: string): Promise<QuoteEstimate | null> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { and, eq, isNull, desc } = await import('drizzle-orm');
    const [row] = await db.select().from(quoteEstimates)
        .where(and(eq(quoteEstimates.intakeRunId, intakeRunId), isNull(quoteEstimates.supersededAt)))
        .orderBy(desc(quoteEstimates.createdAt)).limit(1);
    return row ? rowToEstimate(row) : null;
}

/** The newest live estimate on a thread. */
export async function latestEstimateForConversation(conversationId: string): Promise<QuoteEstimate | null> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { and, eq, isNull, desc } = await import('drizzle-orm');
    const [row] = await db.select().from(quoteEstimates)
        .where(and(eq(quoteEstimates.conversationId, conversationId), isNull(quoteEstimates.supersededAt)))
        .orderBy(desc(quoteEstimates.createdAt)).limit(1);
    return row ? rowToEstimate(row) : null;
}

/** A newer intake arrived: every other live estimate on the thread is superseded. Returns the ids. */
export async function supersedeEstimatesForConversation(conversationId: string, keepId?: string | null): Promise<string[]> {
    const { db } = await import('../db');
    const { quoteEstimates } = await import('@shared/schema');
    const { and, eq, isNull, inArray } = await import('drizzle-orm');
    const rows = await db.select({ id: quoteEstimates.id, conversationId: quoteEstimates.conversationId, supersededAt: quoteEstimates.supersededAt })
        .from(quoteEstimates).where(and(eq(quoteEstimates.conversationId, conversationId), isNull(quoteEstimates.supersededAt)));
    const targets = selectSupersededEstimates(rows, conversationId, keepId).map((r) => r.id);
    if (targets.length) await db.update(quoteEstimates).set({ supersededAt: new Date() }).where(inArray(quoteEstimates.id, targets));
    return targets;
}
