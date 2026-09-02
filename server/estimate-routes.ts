/**
 * Quote Estimator Routes — async estimator runs with polling status.
 *
 * P8 (4 Sep 2026): the in-memory job map is gone; a run is a `quote_estimates` row
 * (server/spine/estimate-store.ts) with status running | complete | failed, so a poll survives a
 * deploy and the row is the same one Route A reads. The poll route keeps its response shape
 * ({ status, build, summary, turns, error }) for the existing builder client until pane B lands.
 * This module NEVER prices (architecture test: server/spine/architecture.test.ts).
 *
 * OPTIMIZATION (unchanged): completed background research (quote_pending → quote_ready) is
 * converted to QuoteBuild instantly, labelled `cached: true`, instead of running the estimator.
 */
import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { conversations, quoteResearch } from '@shared/schema';
import { runEstimator } from './agents/quote-estimator';
import { insertEstimate, finishEstimate, getEstimate, type EstimateLine } from './spine/estimate-store';
import type { QuoteBuild, EstimatedLine, EstimatedMaterial } from '@shared/quote-build';
import type { IntakeLine } from './agents/quote-prep';
import type { QuoteResearchResult } from '@shared/quote-research-types';

/**
 * Convert background research result to QuoteBuild format.
 */
function researchToQuoteBuild(
    research: QuoteResearchResult,
    conversationId: string,
    intake: { customerName?: string; phone?: string; postcode?: string } | null
): QuoteBuild {
    const lines: EstimatedLine[] = research.jobs.map((job, idx) => ({
        lineIndex: idx,
        description: job.title,
        category: 'general_fixing', // Research doesn't track category; will be re-inferred if needed
        time: {
            minutes: job.timeEstimate.minutes,
            confidence: job.timeEstimate.confidence,
            basis: 'historical' as const,
            note: job.timeEstimate.reasoning,
        },
        materials: job.materials.map((m): EstimatedMaterial => ({
            name: m.name,
            qty: m.quantity,
            unitPricePence: m.unitPrice,
            supplier: m.source === 'catalog' ? 'catalog' : m.source === 'screwfix' ? 'screwfix' : 'web',
            needsReview: m.source === 'estimated' || m.confidence !== 'high',
            sourceNote: `${m.source} (${m.confidence} confidence)`,
        })),
        procedure: job.procedure,
        assumptions: [job.reasoning],
    }));

    return {
        conversationId,
        customer: intake ? {
            name: intake.customerName ?? 'Unknown',
            phone: intake.phone ?? '',
            postcode: intake.postcode ?? '',
        } : undefined,
        lines,
        estimatorVersion: 'research-fallback-v1',
        createdAt: new Date().toISOString(),
    };
}

/**
 * Check for completed background research and convert to QuoteBuild if available.
 */
async function getCachedResearch(conversationId: string): Promise<QuoteBuild | null> {
    const [row] = await db.select()
        .from(quoteResearch)
        .where(eq(quoteResearch.conversationId, conversationId))
        .orderBy(desc(quoteResearch.createdAt))
        .limit(1);

    if (!row || row.status !== 'completed' || !row.research) {
        return null;
    }

    // Load the clerk's intake for customer details — P8: ONE source (server/intake.ts).
    const { getIntake } = await import('./intake');
    const record = await getIntake(conversationId).catch(() => null);
    const intake = record ? { customerName: record.intake.customerName ?? undefined, phone: record.intake.phone ?? undefined, postcode: record.intake.postcode ?? undefined } : null;

    const research = row.research as QuoteResearchResult;
    return researchToQuoteBuild(research, conversationId, intake);
}

// ---------------------------------------------------------------- QuoteBuild ⇄ quote_estimates rows

/** A legacy QuoteBuild as EstimateLines (the row's shape). Pure. Never a price. */
export function buildToEstimateLines(build: QuoteBuild): EstimateLine[] {
    return build.lines.map((l, i) => {
        const minutes = Number(l.time?.minutes) || 0;
        const range = Array.isArray(l.time?.rangeMinutes) && l.time!.rangeMinutes!.length === 2 ? l.time!.rangeMinutes! : null;
        return {
            lineId: `card_${(typeof l.lineIndex === 'number' ? l.lineIndex : i) + 1}`, title: l.description, category: l.category,
            minutesLow: range ? Math.min(range[0], minutes) : Math.round(minutes * 0.8), minutesHigh: range ? Math.max(range[1], minutes) : Math.round(minutes * 1.3), minutesPoint: minutes,
            materials: (l.materials ?? []).map((m) => ({ name: m.name, qty: m.qty, unitCostPence: m.unitPricePence, source: m.supplier, needsReview: m.needsReview, supplierUrl: m.supplierUrl ?? null, supplierItemNumber: m.supplierItemNumber ?? null, catalogId: m.catalogId ?? null })),
            flags: [], confidence: l.time?.confidence ?? 'low', reasoning: l.time?.note ?? '',
            timeSource: minutes > 0 ? (l.time?.basis === 'historical' ? 'history' : 'model') : 'fallback',
            unresolved: l.unresolved ?? null, procedure: l.procedure ?? [], assumptions: l.assumptions ?? [],
        };
    });
}

/** The row back as a QuoteBuild for the old builder client. Pure. */
export function estimateLinesToBuild(lines: EstimateLine[], conversationId: string | null, createdAt: string): QuoteBuild {
    return {
        conversationId: conversationId ?? undefined,
        lines: lines.map((l, i) => ({
            lineIndex: i, description: l.title, category: l.category,
            time: { minutes: l.minutesPoint, confidence: l.confidence, basis: l.timeSource === 'history' ? 'historical' : 'model', rangeMinutes: [l.minutesLow, l.minutesHigh], note: l.reasoning },
            materials: l.materials.map((m) => ({ name: m.name, qty: m.qty, unitPricePence: m.unitCostPence, supplier: m.source, needsReview: !!m.needsReview, supplierUrl: m.supplierUrl ?? undefined, supplierItemNumber: m.supplierItemNumber ?? undefined, catalogId: m.catalogId ?? undefined })),
            procedure: l.procedure ?? [], assumptions: l.assumptions ?? [], unresolved: l.unresolved ?? undefined,
        })),
        estimatorVersion: 'quote_estimates-v1',
        createdAt,
    };
}

const router = Router();

// 3-minute timeout
const ESTIMATE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * POST /api/pricing/estimate-build
 *
 * Start an async estimator run. Returns immediately with an estimateId (a quote_estimates row) for polling.
 *
 * Body:
 *   - conversationId?: string — load intake from conversation metadata
 *   - lines?: IntakeLine[] — direct lines input (builder-only mode)
 */
router.post('/estimate-build', async (req, res) => {
    try {
        const { conversationId, lines } = req.body as {
            conversationId?: string;
            lines?: IntakeLine[];
        };

        if (!conversationId && !lines) {
            return res.status(400).json({
                error: 'Either conversationId or lines must be provided.',
            });
        }

        // OPTIMIZATION: completed background research first, clearly labelled as cached.
        if (conversationId && !lines) {
            const cachedBuild = await getCachedResearch(conversationId);
            if (cachedBuild) {
                console.log(`[Estimator] Using cached research for ${conversationId}`);
                const estimateId = await insertEstimate({ conversationId, status: 'complete', lines: buildToEstimateLines(cachedBuild), model: 'research-cache-v1' });
                await finishEstimate(estimateId, { status: 'complete' });
                return res.status(202).json({
                    estimateId,
                    status: 'complete', // Immediately complete
                    cached: true,
                });
            }
        }

        const estimateId = await insertEstimate({ conversationId: conversationId ?? null, status: 'running', model: 'claude-sonnet-5' });

        // Start estimator in background (don't await); the row carries the outcome.
        const estimatePromise = runEstimator({ conversationId, lines });
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Estimate timed out after 3 minutes')), ESTIMATE_TIMEOUT_MS);
        });
        Promise.race([estimatePromise, timeoutPromise])
            .then(async (result) => {
                await finishEstimate(estimateId, {
                    status: 'complete',
                    lines: result.build ? buildToEstimateLines(result.build) : [],
                    error: result.build ? null : (result.summary || 'estimator returned no build'),
                });
            })
            .catch(async (err) => {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Estimator] Job ${estimateId} failed:`, message);
                await finishEstimate(estimateId, { status: 'failed', error: message }).catch(() => undefined);
            });

        return res.status(202).json({ estimateId, status: 'running' });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Estimator] Failed to start job:', message);
        return res.status(500).json({ error: message });
    }
});

/**
 * GET /api/pricing/estimate-build/:estimateId
 *
 * Poll status of an estimate row. Shape unchanged: { status, build?, summary?, turns?, error? }.
 */
router.get('/estimate-build/:estimateId', async (req, res) => {
    const { estimateId } = req.params;
    try {
        const row = await getEstimate(estimateId);
        if (!row) return res.status(404).json({ error: 'Estimate not found.' });
        const build = row.status === 'complete' && row.lines.length ? estimateLinesToBuild(row.lines, row.conversationId, row.createdAt) : undefined;
        return res.json({
            status: row.status,
            build,
            summary: row.status === 'complete' ? (build ? `${row.lines.length} line(s) estimated.` : row.error ?? undefined) : undefined,
            turns: undefined,
            error: row.status === 'failed' ? row.error ?? 'estimate failed' : undefined,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: message });
    }
});

/**
 * GET /api/conversations/:id
 *
 * Fetch a conversation by ID plus its intake for the builder's `?conv=` prefill. P8: the intake
 * comes from server/intake.ts (spine artifact → override → legacy blob), exposed as `intake`;
 * `metadata` is still returned for older readers.
 * Note: This route is mounted under /api/pricing but the client calls /api/conversations.
 * We export a separate router fragment for the conversations endpoint.
 */
export const conversationsRouter = Router();

conversationsRouter.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [conv] = await db.select({
            id: conversations.id,
            phoneNumber: conversations.phoneNumber,
            contactName: conversations.contactName,
            metadata: conversations.metadata,
        })
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);

        if (!conv) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const { getIntake, toQuoteIntake } = await import('./intake');
        const record = await getIntake(id).catch(() => null);
        return res.json({ ...conv, intake: record ? toQuoteIntake(record, conv.phoneNumber) : null, intakeSource: record?.source ?? null });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Conversations] Failed to fetch:', message);
        return res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

export default router;
