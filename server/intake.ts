/**
 * ONE intake source (P8 / C, 3 Sep 2026).
 *
 * `getIntake(conversationId)` is the only way a reader learns what the quote clerk found on a
 * thread. The intake is the newest spine clerk artifact (`agent_runs` rows of agent
 * `quote_clerk`, `Proposal.artifact.kind === 'quote_intake'`) — the same row the in-chat card
 * reads — with one human override applied on top. The legacy blob on
 * `conversations.metadata.quotePrepIntake` is read ONLY as a fallback for threads that predate
 * the spine clerk; nothing writes it any more (`maybeAutoQuotePrep` retired, P8).
 *
 * Precedence, as a pure function (`resolveIntake`, tested without a database):
 *
 *   1. spine artifact       — wins over anything in metadata, however fresh the blob looks
 *   2. human override       — `metadata.quote_intake_override`, applied ONLY when it was made
 *                             against the intake now showing (its `runId`); a fresh clerk run
 *                             supersedes an old override, the record survives for the history
 *   3. legacy metadata blob — only when there is no spine artifact at all
 *
 * plus one derived state: `quote_ready` with an estimate in flight reads as `quote_pending`.
 *
 * The estimate status comes from pane A's `quote_estimates` table (BRIEF-P8-chain §1). This
 * worktree does not carry that migration, so the read is defensive: a missing relation is
 * "no estimate", never an error. Nothing here prices; nothing here sends.
 */
import type { IntakeReadiness } from '@shared/intake-readiness';
import { isIntakeReadiness, normaliseReadiness } from '@shared/intake-readiness';
import type { ProposalArtifact } from './spine/types';
import { pickLatestIntakeRun } from './spine/quote-intake';
import type { QuoteIntake } from './agents/quote-prep';

// ---------------------------------------------------------------- shapes

export interface IntakeLineView {
    title: string;
    /** Internal evidence behind the line (the clerk's `detail`). */
    detail: string | null;
    category: string | null;
    qty: number | null;
    assumptions: string[];
}

export interface IntakeGapView {
    question: string;
    audience: 'customer' | 'ben';
    lineIndex: number | null;
    impact?: string;
}

export interface IntakeView {
    customerName: string | null;
    phone: string | null;
    postcode: string | null;
    customerType: string | null;
    lines: IntakeLineView[];
    assumptions: string[];
    gaps: IntakeGapView[];
    /** The EFFECTIVE readiness (override applied). The clerk's own verdict is on the record. */
    readiness: IntakeReadiness;
    declineReason: string | null;
    excluded: Array<{ work: string; reason: string }>;
    urgency: 'low' | 'med' | 'high';
}

/** `conversations.metadata.quote_intake_override` — a person's lane decision, attributable. */
export interface IntakeOverride {
    readiness: IntakeReadiness;
    /** The intake it was made against: the spine run id, or 'legacy' for a pre-spine blob. */
    runId: string | null;
    from: string | null;
    by: string;
    at: string;
    reason: string | null;
}

/** Pane A's `quote_estimates` row for this thread, read defensively. */
export interface EstimateStatus {
    id: string;
    status: string;
    /** Derived from `status` so the client never has to know pane A's vocabulary. */
    phase: 'running' | 'done' | 'failed';
    createdAt: string | null;
    draftQuoteId: string | null;
    /** The priced draft's slug when one exists — `/admin/price/<slug>` (pane B). */
    draftSlug: string | null;
}

export interface IntakeRecord {
    source: 'spine' | 'legacy';
    /** Spine run id (agent_runs.id) for a spine intake; null for a legacy blob. */
    runId: string | null;
    at: string;
    /** What the clerk said. */
    clerkReadiness: IntakeReadiness;
    /** What the thread reads as, after the override and the estimate state. */
    readiness: IntakeReadiness;
    override: IntakeOverride | null;
    overrideApplied: boolean;
    intake: IntakeView;
    estimate: EstimateStatus | null;
    summary: string | null;
}

export interface SpineIntakeSource {
    runId: string;
    at: string;
    summary: string | null;
    data: unknown;
}

export interface LegacyIntakeSource {
    at: string | null;
    data: unknown;
}

// ---------------------------------------------------------------- pure

function str(x: unknown): string | null {
    return typeof x === 'string' && x.trim() ? x.trim() : null;
}

function lineViews(raw: unknown): IntakeLineView[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((l: any): IntakeLineView => ({
            title: String(l?.title ?? '').trim(),
            detail: str(l?.detail) ?? str(l?.notes),
            category: str(l?.category),
            qty: typeof l?.qty === 'number' && Number.isFinite(l.qty) ? l.qty : null,
            assumptions: Array.isArray(l?.assumptions) ? l.assumptions.map(String) : [],
        }))
        .filter((l) => l.title);
}

function gapViews(raw: unknown): IntakeGapView[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((g: any): IntakeGapView => ({
            question: String(g?.question ?? g?.text ?? '').trim(),
            audience: g?.audience === 'ben' ? 'ben' : 'customer',
            lineIndex: typeof g?.lineIndex === 'number' ? g.lineIndex : null,
            ...(typeof g?.impact === 'string' ? { impact: g.impact } : {}),
        }))
        .filter((g) => g.question);
}

/** The card-shaped view of any stored intake (clerk artifact data or the legacy blob). */
export function intakeViewFrom(data: unknown): IntakeView | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, any>;
    const lines = lineViews(d.lines);
    const readiness = normaliseReadiness(d.readiness);
    if (!lines.length && !isIntakeReadiness(d.readiness)) return null;
    const urgency = d.urgency === 'high' || d.urgency === 'low' ? d.urgency : 'med';
    return {
        customerName: str(d.customerName),
        phone: str(d.phone),
        postcode: str(d.postcode)?.toUpperCase() ?? null,
        customerType: str(d.customerType),
        lines,
        assumptions: Array.isArray(d.assumptions) ? d.assumptions.map(String) : [],
        gaps: gapViews(d.gaps),
        readiness,
        declineReason: str(d.declineReason),
        excluded: Array.isArray(d.excluded)
            ? d.excluded.map((e: any) => ({ work: String(e?.work ?? ''), reason: String(e?.reason ?? '') })).filter((e: { work: string }) => e.work)
            : [],
        urgency,
    };
}

export function overrideFrom(raw: unknown): IntakeOverride | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, any>;
    if (!isIntakeReadiness(o.readiness) && !isIntakeReadiness(o.to)) return null;
    return {
        readiness: isIntakeReadiness(o.readiness) ? o.readiness : o.to,
        runId: str(o.runId),
        from: str(o.from),
        by: str(o.by) ?? 'admin',
        at: str(o.at) ?? new Date(0).toISOString(),
        reason: str(o.reason),
    };
}

/** An override counts only against the intake it was made on. */
export function overrideApplies(override: IntakeOverride | null, base: { source: 'spine' | 'legacy'; runId: string | null }): boolean {
    if (!override) return false;
    if (base.source === 'spine') return !!base.runId && override.runId === base.runId;
    return override.runId == null || override.runId === 'legacy';
}

const RUNNING_STATUSES = new Set(['pending', 'queued', 'running', 'estimating', 'pricing']);
const FAILED_STATUSES = new Set(['failed', 'error', 'timed_out']);

export function estimatePhase(status: string | null | undefined): EstimateStatus['phase'] {
    const s = String(status ?? '').toLowerCase();
    if (RUNNING_STATUSES.has(s)) return 'running';
    if (FAILED_STATUSES.has(s)) return 'failed';
    return 'done';
}

export function resolveIntake(input: {
    spine: SpineIntakeSource | null;
    legacy: LegacyIntakeSource | null;
    override: IntakeOverride | null;
    estimate?: EstimateStatus | null;
}): IntakeRecord | null {
    const estimate = input.estimate ?? null;
    let base: { source: 'spine' | 'legacy'; runId: string | null; at: string; summary: string | null; view: IntakeView } | null = null;

    if (input.spine) {
        const view = intakeViewFrom(input.spine.data);
        if (view) base = { source: 'spine', runId: input.spine.runId, at: input.spine.at, summary: input.spine.summary, view };
    }
    if (!base && input.legacy) {
        const view = intakeViewFrom(input.legacy.data);
        if (view) base = { source: 'legacy', runId: null, at: input.legacy.at ?? new Date(0).toISOString(), summary: null, view };
    }
    if (!base) return null;

    const clerkReadiness = base.view.readiness;
    const applied = overrideApplies(input.override, base);
    let readiness: IntakeReadiness = applied && input.override ? input.override.readiness : clerkReadiness;
    // The estimate in flight is the ONLY thing that makes a thread read as quote_pending.
    if (readiness === 'quote_ready' && estimate?.phase === 'running') readiness = 'quote_pending';
    if (readiness === 'quote_pending' && (!estimate || estimate.phase !== 'running')) readiness = 'quote_ready';

    return {
        source: base.source,
        runId: base.runId,
        at: base.at,
        clerkReadiness,
        readiness,
        override: input.override,
        overrideApplied: applied,
        intake: { ...base.view, readiness },
        estimate,
        summary: base.summary,
    };
}

/** The `QuoteIntake` shape the estimator and the research fallback were written against. */
export function toQuoteIntake(record: IntakeRecord, phoneFallback?: string | null): QuoteIntake {
    const v = record.intake;
    const customerType = (['homeowner', 'landlord', 'letting_agent', 'business'] as const).find((t) => t === v.customerType) ?? 'homeowner';
    return {
        customerName: v.customerName,
        phone: v.phone ?? phoneFallback ?? '',
        postcode: v.postcode,
        customerType,
        lines: v.lines.map((l) => ({ title: l.title, detail: l.detail ?? '', assumptions: l.assumptions })),
        assumptions: v.assumptions,
        readiness: v.readiness,
        declineReason: (v.declineReason as QuoteIntake['declineReason']) ?? null,
        excluded: v.excluded as QuoteIntake['excluded'],
        gaps: v.gaps.map((g) => ({ question: g.question, audience: g.audience, lineIndex: g.lineIndex, impact: (g.impact as any) ?? 'small' })),
        urgency: v.urgency,
    };
}

/** The clerk artifact's data, from either proposal shape the runner records. */
export function spineSourceFromRuns<T extends { id: string; finishedAt: Date | string | null; startedAt: Date | string; proposal: unknown }>(runs: T[]): SpineIntakeSource | null {
    const picked = pickLatestIntakeRun(runs);
    if (!picked) return null;
    const artifact: ProposalArtifact = picked.artifact;
    return {
        runId: picked.run.id,
        at: new Date(picked.run.finishedAt ?? picked.run.startedAt).toISOString(),
        summary: artifact.summary ?? null,
        data: artifact.data,
    };
}

export function legacySourceFromMetadata(meta: Record<string, any> | null | undefined): LegacyIntakeSource | null {
    const blob = meta?.quotePrepIntake;
    if (!blob || typeof blob !== 'object') return null;
    return { at: str(meta?.quotePrepAuto?.lastRunAt), data: blob };
}

// ---------------------------------------------------------------- db

export async function loadSpineIntakeSource(conversationId: string): Promise<SpineIntakeSource | null> {
    const { db } = await import('./db');
    const { agentRuns } = await import('@shared/schema');
    const { and, eq, desc } = await import('drizzle-orm');
    const runs = await db.select({ id: agentRuns.id, finishedAt: agentRuns.finishedAt, startedAt: agentRuns.startedAt, proposal: agentRuns.proposal })
        .from(agentRuns).where(and(eq(agentRuns.conversationId, conversationId), eq(agentRuns.agent, 'quote_clerk')))
        .orderBy(desc(agentRuns.startedAt)).limit(20);
    return spineSourceFromRuns(runs);
}

function missingRelation(error: any): boolean {
    const code = error?.code ?? error?.cause?.code;
    const msg = String(error?.message ?? '');
    return code === '42P01' || code === '42703' || /does not exist/i.test(msg);
}

/**
 * Pane A's `quote_estimates` row for this thread (newest, not superseded), plus the draft's slug.
 * Defensive by design: the table lands with BRIEF-P8-chain; until then this is null.
 */
export async function loadEstimateStatus(conversationId: string): Promise<EstimateStatus | null> {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    try {
        const res: any = await db.execute(sql`
            SELECT id, status, created_at, draft_quote_id
            FROM quote_estimates
            WHERE conversation_id = ${conversationId} AND superseded_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1`);
        const row = ((res.rows ?? res) as any[])[0];
        if (!row) return null;
        let draftSlug: string | null = null;
        if (row.draft_quote_id) {
            const q: any = await db.execute(sql`SELECT short_slug FROM personalized_quotes WHERE id = ${String(row.draft_quote_id)} LIMIT 1`);
            draftSlug = ((q.rows ?? q) as any[])[0]?.short_slug ?? null;
        }
        return {
            id: String(row.id),
            status: String(row.status ?? ''),
            phase: estimatePhase(row.status),
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
            draftQuoteId: row.draft_quote_id ? String(row.draft_quote_id) : null,
            draftSlug,
        };
    } catch (error: any) {
        // Missing relation (pane A's migration not applied) or a test double without `execute`:
        // both simply mean "no estimate".
        if (missingRelation(error) || error instanceof TypeError) return null;
        console.warn(`[Intake] estimate status read failed for ${conversationId} (treated as none):`, error?.message ?? error);
        return null;
    }
}

/**
 * THE reader. Spine artifact → override → legacy fallback, plus the estimate state.
 * `opts.metadata`: a caller that already holds the conversation row passes its metadata and saves
 * the round-trip (the sweeps scan up to 100 threads a pass).
 */
export async function getIntake(conversationId: string, opts: { metadata?: Record<string, any> | null } = {}): Promise<IntakeRecord | null> {
    let meta: Record<string, any>;
    if (opts.metadata !== undefined) {
        meta = opts.metadata ?? {};
    } else {
        const { db } = await import('./db');
        const { conversations } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const [conv] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
        if (!conv) return null;
        meta = (conv.metadata ?? {}) as Record<string, any>;
    }
    const [spine, estimate] = await Promise.all([
        loadSpineIntakeSource(conversationId).catch((error: any) => {
            console.warn(`[Intake] spine intake read failed for ${conversationId} (falling to legacy):`, error?.message ?? error);
            return null;
        }),
        loadEstimateStatus(conversationId),
    ]);
    return resolveIntake({
        spine,
        legacy: legacySourceFromMetadata(meta),
        override: overrideFrom(meta.quote_intake_override),
        estimate,
    });
}

export interface IntakeReadinessSummary {
    readiness: IntakeReadiness;
    source: 'spine' | 'legacy';
    runId: string | null;
    /** The priced draft's slug when pane A's chain has produced one. */
    draftSlug: string | null;
}

/**
 * Batched readiness for the board: one projected query over agent_runs (readiness scalar only —
 * never the multi-KB artifact, the 21 Aug board lesson), one over quote_estimates, and the
 * override / legacy scalars the caller already projected off the conversation rows.
 */
export async function loadIntakeReadinessMap(rows: Array<{ id: string; override?: unknown; legacyReadiness?: string | null }>): Promise<Map<string, IntakeReadinessSummary>> {
    const out = new Map<string, IntakeReadinessSummary>();
    if (!rows.length) return out;
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    const ids = rows.map((r) => r.id);

    const spineByConv = new Map<string, { runId: string; readiness: IntakeReadiness }>();
    try {
        const res: any = await db.execute(sql`
            SELECT DISTINCT ON (conversation_id) conversation_id, id,
                   coalesce(proposal->'artifact'->'data'->>'readiness', proposal->'proposal'->'artifact'->'data'->>'readiness') AS readiness
            FROM agent_runs
            WHERE agent = 'quote_clerk'
              AND conversation_id = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')}]::varchar[]`)})
              AND coalesce(proposal->'artifact'->>'kind', proposal->'proposal'->'artifact'->>'kind') = 'quote_intake'
            ORDER BY conversation_id, started_at DESC`);
        for (const r of (res.rows ?? res) as any[]) {
            if (!r.conversation_id || !r.readiness) continue;
            spineByConv.set(String(r.conversation_id), { runId: String(r.id), readiness: normaliseReadiness(r.readiness) });
        }
    } catch (error: any) {
        console.warn('[Intake] board readiness query failed (spine intakes hidden this tick):', error?.message ?? error);
    }

    const estimateByConv = new Map<string, EstimateStatus>();
    try {
        const res: any = await db.execute(sql`
            SELECT DISTINCT ON (e.conversation_id) e.conversation_id, e.id, e.status, e.created_at, e.draft_quote_id, q.short_slug
            FROM quote_estimates e
            LEFT JOIN personalized_quotes q ON q.id = e.draft_quote_id
            WHERE e.superseded_at IS NULL
              AND e.conversation_id = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')}]::varchar[]`)})
            ORDER BY e.conversation_id, e.created_at DESC`);
        for (const r of (res.rows ?? res) as any[]) {
            estimateByConv.set(String(r.conversation_id), {
                id: String(r.id), status: String(r.status ?? ''), phase: estimatePhase(r.status),
                createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
                draftQuoteId: r.draft_quote_id ? String(r.draft_quote_id) : null, draftSlug: r.short_slug ?? null,
            });
        }
    } catch (error: any) {
        if (!missingRelation(error)) console.warn('[Intake] board estimate query failed (treated as none):', error?.message ?? error);
    }

    for (const r of rows) {
        const spine = spineByConv.get(r.id) ?? null;
        const record = resolveIntake({
            spine: spine ? { runId: spine.runId, at: '', summary: null, data: { readiness: spine.readiness, lines: [] } } : null,
            legacy: r.legacyReadiness ? { at: null, data: { readiness: r.legacyReadiness, lines: [] } } : null,
            override: overrideFrom(r.override),
            estimate: estimateByConv.get(r.id) ?? null,
        });
        if (!record) continue;
        out.set(r.id, { readiness: record.readiness, source: record.source, runId: record.runId, draftSlug: record.estimate?.draftSlug ?? null });
    }
    return out;
}

// ---------------------------------------------------------------- writes (metadata only; never a send)

export type SetOverrideResult =
    | { ok: true; unchanged?: boolean; readiness: IntakeReadiness; previous: IntakeReadiness; record: IntakeRecord }
    | { ok: false; status: number; error: string; message: string };

/**
 * A person overrules the clerk's lane. Writes `metadata.quote_intake_override` (attributable:
 * who, from what, to what, when, why, against which intake) and NOTHING else — the legacy blob is
 * left as it was. Refuses when the clerk has never run: there is no verdict to override.
 */
export async function setIntakeOverride(conversationId: string, input: { readiness: IntakeReadiness; by: string; reason?: string | null }): Promise<SetOverrideResult> {
    const current = await getIntake(conversationId);
    if (!current) {
        return { ok: false, status: 409, error: 'NO_INTAKE', message: 'The quote clerk has not run on this thread yet, so there is no lane to override. Run the clerk first.' };
    }
    if (current.readiness === input.readiness) return { ok: true, unchanged: true, readiness: input.readiness, previous: current.readiness, record: current };
    const override: IntakeOverride = {
        readiness: input.readiness,
        runId: current.source === 'spine' ? current.runId : 'legacy',
        from: current.readiness,
        by: input.by,
        at: new Date().toISOString(),
        reason: input.reason?.trim().slice(0, 300) || null,
    };
    const { db } = await import('./db');
    const { conversations } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('quote_intake_override', ${JSON.stringify(override)}::jsonb)`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
    try {
        const { logSystemEvent } = await import('./system-events');
        await logSystemEvent({
            kind: 'other', conversationId, source: 'intake-override',
            summary: `intake lane override: ${current.readiness} → ${input.readiness} by ${input.by}${override.reason ? ` (${override.reason})` : ''}`,
            detail: { ...override, intakeSource: current.source },
        });
    } catch { /* bookkeeping */ }
    try {
        const { emitCommsEvent } = await import('./comms-events');
        emitCommsEvent({ type: 'board_delta', conversationId, reason: 'other', at: new Date().toISOString() });
    } catch { /* bookkeeping */ }
    const record = resolveIntake({
        spine: current.source === 'spine' ? await loadSpineIntakeSource(conversationId) : null,
        legacy: current.source === 'legacy' ? { at: current.at, data: toQuoteIntake(current) } : null,
        override,
        estimate: current.estimate,
    }) ?? current;
    return { ok: true, readiness: record.readiness, previous: current.readiness, record };
}

/**
 * The manual "re-run the clerk" button. Tags the thread `needs_quote` (the clerk's trigger) and
 * asks the spine for a run. Never runs anything itself: the worker executes it when the spine is
 * enabled; with the spine off the request lands in the row and nothing picks it up (fail closed).
 */
export async function requestClerkRerun(conversationId: string): Promise<{ queued: boolean; reason?: string; mode: string }> {
    const { db } = await import('./db');
    const { conversations } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');
    await db.update(conversations).set({
        tags: sql`(SELECT array_agg(DISTINCT t) FROM unnest(coalesce(${conversations.tags}, '{}'::text[]) || ARRAY['needs_quote']::text[]) AS t)`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
    const { requestRun } = await import('./spine/request-run');
    const { spineMode } = await import('./spine/switch');
    const r = await requestRun(conversationId, 'manual', { delayMs: 0 });
    const mode = await spineMode().catch(() => 'unknown');
    return { ...r, mode, ...(r.queued && mode === 'off' ? { reason: 'queued, but the spine is off so no worker will run it' } : {}) };
}
