/**
 * Quote Estimator Routes — async estimator runs with polling status.
 *
 * OPTIMIZATION: If completed background research exists (from quote_pending → quote_ready),
 * we convert it to QuoteBuild format instantly instead of running the estimator again.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { conversations, quoteResearch } from '@shared/schema';
import { runEstimator } from './agents/quote-estimator';
import type { QuoteBuild, EstimatedLine, EstimatedMaterial, TimeEstimate } from '@shared/quote-build';
import type { IntakeLine } from './agents/quote-prep';
import type { QuoteResearchResult, JobResearch, MaterialEstimate } from '@shared/quote-research-types';

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
        estimatorVersion: 'research-cache-v1',
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

    // Load intake for customer details
    const [conv] = await db.select({ metadata: conversations.metadata })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
    const intake = (conv?.metadata as any)?.quotePrepIntake ?? null;

    const research = row.research as QuoteResearchResult;
    return researchToQuoteBuild(research, conversationId, intake);
}

const router = Router();

interface EstimateJob {
    status: 'running' | 'complete' | 'failed';
    build?: QuoteBuild;
    error?: string;
    summary?: string;
    turns?: number;
    startedAt: number;
}

// In-memory store for running/completed estimates
const estimateJobs = new Map<string, EstimateJob>();

// 3-minute timeout
const ESTIMATE_TIMEOUT_MS = 3 * 60 * 1000;

// Cleanup old jobs periodically (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [id, job] of estimateJobs.entries()) {
        if (now - job.startedAt > maxAge) {
            estimateJobs.delete(id);
        }
    }
}, 5 * 60 * 1000);

/**
 * POST /api/pricing/estimate-build
 *
 * Start an async estimator run. Returns immediately with an estimateId for polling.
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

        // OPTIMIZATION: Check for completed background research first.
        // If research ran during quote_pending → quote_ready, use it instantly.
        if (conversationId && !lines) {
            const cachedBuild = await getCachedResearch(conversationId);
            if (cachedBuild) {
                console.log(`[Estimator] Using cached research for ${conversationId}`);
                const estimateId = crypto.randomUUID();
                estimateJobs.set(estimateId, {
                    status: 'complete',
                    build: cachedBuild,
                    summary: 'Pre-computed from background research.',
                    turns: 0,
                    startedAt: Date.now(),
                });
                return res.status(202).json({
                    estimateId,
                    status: 'complete', // Immediately complete
                    cached: true,
                });
            }
        }

        const estimateId = crypto.randomUUID();

        // Initialize job as running
        estimateJobs.set(estimateId, {
            status: 'running',
            startedAt: Date.now(),
        });

        // Start estimator in background (don't await)
        const estimatePromise = runEstimator({ conversationId, lines });

        // Set up timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Estimate timed out after 3 minutes')), ESTIMATE_TIMEOUT_MS);
        });

        // Race estimate vs timeout
        Promise.race([estimatePromise, timeoutPromise])
            .then((result) => {
                estimateJobs.set(estimateId, {
                    status: 'complete',
                    build: result.build ?? undefined,
                    summary: result.summary,
                    turns: result.turns,
                    startedAt: estimateJobs.get(estimateId)?.startedAt ?? Date.now(),
                });
            })
            .catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Estimator] Job ${estimateId} failed:`, message);
                estimateJobs.set(estimateId, {
                    status: 'failed',
                    error: message,
                    startedAt: estimateJobs.get(estimateId)?.startedAt ?? Date.now(),
                });
            });

        // Return immediately with job ID
        return res.status(202).json({
            estimateId,
            status: 'running',
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Estimator] Failed to start job:', message);
        return res.status(500).json({ error: message });
    }
});

/**
 * GET /api/pricing/estimate-build/:estimateId
 *
 * Poll status of an estimate job.
 *
 * Returns:
 *   - status: 'running' | 'complete' | 'failed'
 *   - build?: QuoteBuild (when complete)
 *   - summary?: string (agent's final text)
 *   - turns?: number (how many agent turns)
 *   - error?: string (when failed)
 */
router.get('/estimate-build/:estimateId', (req, res) => {
    const { estimateId } = req.params;

    const job = estimateJobs.get(estimateId);

    if (!job) {
        return res.status(404).json({
            error: 'Estimate job not found. It may have expired (10 minute TTL).',
        });
    }

    return res.json({
        status: job.status,
        build: job.build,
        summary: job.summary,
        turns: job.turns,
        error: job.error,
    });
});

/**
 * GET /api/conversations/:id
 *
 * Fetch a conversation by ID (for loading quotePrepIntake into the builder).
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

        return res.json(conv);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Conversations] Failed to fetch:', message);
        return res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

export default router;
