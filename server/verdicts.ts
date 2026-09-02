/**
 * Draft verdicts — Ben's decisions on machine-drafted messages, with reason codes.
 *
 * Phase 1 / C of the comms rebuild (COMMS_AGENTS_V3_DESIGN §4, §8). Written from the draft routes
 * in server/message-drafts.ts (approve / edit-then-approve / reject); read by
 * GET /api/verdicts/stats for the promotion gate and the staff page. Phase 3's sample reviews
 * reuse recordVerdict with 'sample_fine' / 'sample_not_fine'.
 *
 * recordVerdict never throws: a missing table (migration not yet applied) or a bad row must not
 * turn a successful send into a 500 for the approver. It logs and returns null instead.
 */
import { Router } from 'express';
import { db } from './db';
import { draftVerdicts, messageDrafts, type DraftVerdict, type VerdictReason } from '@shared/schema';
import { eq, gte } from 'drizzle-orm';
import { aggregateVerdicts, intentFromReason, isVerdictReason, type VerdictStats } from './verdict-stats';

export { isVerdictReason, isDraftVerdict, type VerdictStats } from './verdict-stats';

export const verdictsRouter = Router();

export interface RecordVerdictInput {
    draftId: string;
    runId?: string | null;
    verdict: DraftVerdict;
    reason: VerdictReason | null;
    originalBody: string;
    finalBody?: string | null;
    /** Always a person: `human:<id>` from server/approver.ts. */
    by: string;
}

export async function recordVerdict(input: RecordVerdictInput): Promise<{ id: string } | null> {
    try {
        const [row] = await db.insert(draftVerdicts).values({
            draftId: input.draftId,
            runId: input.runId ?? null,
            verdict: input.verdict,
            reason: input.reason,
            originalBody: input.originalBody,
            finalBody: input.finalBody ?? null,
            by: input.by,
        }).returning({ id: draftVerdicts.id });
        return row ?? null;
    } catch (error: any) {
        console.error(`[Verdicts] could not record ${input.verdict} for draft ${input.draftId}:`, error?.message ?? error);
        return null;
    }
}

/**
 * Pane A (Phase 1 ledger) adds `run_id` to message_drafts. Read it without depending on that
 * column being in this branch's schema yet.
 */
export function runIdOfDraft(draft: Record<string, unknown> | null | undefined): string | null {
    if (!draft) return null;
    const v = draft.runId ?? draft.run_id;
    return typeof v === 'string' && v ? v : null;
}

/** Verdict for an approval: 'edit' when the body left the queue different from how it arrived. */
export function approvalVerdict(draft: { body: string; originalBody?: string | null }): 'approve' | 'edit' {
    const original = draft.originalBody;
    return original != null && original.trim() !== draft.body.trim() ? 'edit' : 'approve';
}

/** Verdicts in the window joined to their drafts, folded into the stats payload. */
export async function verdictStats(days: number): Promise<VerdictStats> {
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const rows = await db.select({
        verdict: draftVerdicts.verdict,
        reason: draftVerdicts.reason,
        by: draftVerdicts.by,
        createdAt: draftVerdicts.createdAt,
        source: messageDrafts.source,
        draftReason: messageDrafts.reason,
    })
        .from(draftVerdicts)
        .leftJoin(messageDrafts, eq(messageDrafts.id, draftVerdicts.draftId))
        .where(gte(draftVerdicts.createdAt, since));
    return aggregateVerdicts(
        rows.map((r) => ({
            verdict: r.verdict, reason: r.reason, by: r.by, createdAt: r.createdAt,
            source: r.source ?? null, intent: intentFromReason(r.draftReason),
        })),
        { days, since },
    );
}

function parseDays(raw: unknown, fallback = 30): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(365, Math.floor(n));
}

// GET /api/verdicts/stats?days=30 — per-source / per-intent counts, unedited-approval rate, reasons.
verdictsRouter.get('/stats', async (req, res) => {
    try {
        res.json(await verdictStats(parseDays(req.query.days)));
    } catch (error: any) {
        console.error('[Verdicts] stats failed:', error);
        res.status(500).json({ error: 'Failed to load verdict stats' });
    }
});
