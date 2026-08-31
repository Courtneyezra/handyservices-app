/**
 * Quote Research API routes (WP2: Quote Builder v2).
 *
 * GET  /api/quote-research/:conversationId - Returns the research row for a conversation.
 * POST /api/quote-research/:conversationId - Run research immediately (synchronous).
 * POST /api/quote-research/queue/:conversationId - Queue for background processing.
 * GET  /api/quote-research/status/:id - Check research status by job ID.
 * POST /api/quote-research/process-pending - Process all pending research jobs.
 */
import { Router } from 'express';
import {
    getResearchByConversation,
    getResearchStatus,
    runResearchImmediate,
    queueResearch,
    processResearchJob,
    processPendingResearch,
} from './quote-research';

export const quoteResearchRouter = Router();

/**
 * GET /api/quote-research/:conversationId
 *
 * Returns the most recent quote research row for a conversation.
 * Returns null if no research exists yet.
 */
quoteResearchRouter.get('/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        if (!conversationId) {
            return res.status(400).json({ error: 'conversationId is required' });
        }

        const research = await getResearchByConversation(conversationId);
        res.json({ research });
    } catch (error: any) {
        console.error('[QuoteResearch] Failed to fetch research:', error?.message);
        res.status(500).json({ error: 'Failed to fetch quote research' });
    }
});

/**
 * POST /api/quote-research/:conversationId
 *
 * Run research immediately and return results (synchronous).
 */
quoteResearchRouter.post('/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        if (!conversationId) {
            return res.status(400).json({ error: 'conversationId is required' });
        }

        const { id, result } = await runResearchImmediate(conversationId);
        res.json({ success: true, id, result });
    } catch (error: any) {
        console.error('[QuoteResearch] Research failed:', error?.message);
        res.status(500).json({ success: false, error: error?.message ?? 'Research failed' });
    }
});

/**
 * POST /api/quote-research/queue/:conversationId
 *
 * Queue research for background processing (async).
 * Returns job ID immediately; poll /status/:id for results.
 */
quoteResearchRouter.post('/queue/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        if (!conversationId) {
            return res.status(400).json({ error: 'conversationId is required' });
        }

        const id = await queueResearch(conversationId);
        res.json({ success: true, id, status: 'pending' });

        // Start processing in background (fire-and-forget)
        processResearchJob(id).catch((err) => {
            console.error(`[QuoteResearch] Background job ${id} failed:`, err);
        });
    } catch (error: any) {
        console.error('[QuoteResearch] Failed to queue research:', error?.message);
        res.status(500).json({ success: false, error: error?.message ?? 'Failed to queue' });
    }
});

/**
 * GET /api/quote-research/status/:id
 *
 * Get research job status and results by job ID.
 */
quoteResearchRouter.get('/status/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        const job = await getResearchStatus(id);
        if (!job) {
            return res.status(404).json({ error: 'Research job not found' });
        }

        res.json({
            success: true,
            id: job.id,
            conversationId: job.conversationId,
            status: job.status,
            jobs: job.jobs,
            research: job.research,
            confidence: job.confidence,
            error: job.error,
            createdAt: job.createdAt?.toISOString(),
            completedAt: job.completedAt?.toISOString(),
        });
    } catch (error: any) {
        console.error('[QuoteResearch] Failed to get status:', error?.message);
        res.status(500).json({ error: 'Failed to get research status' });
    }
});

/**
 * POST /api/quote-research/process-pending
 *
 * Process all pending research jobs. Call from cron/worker.
 */
quoteResearchRouter.post('/process-pending', async (_req, res) => {
    try {
        const processed = await processPendingResearch();
        res.json({ success: true, processed });
    } catch (error: any) {
        console.error('[QuoteResearch] Failed to process pending:', error?.message);
        res.status(500).json({ error: 'Failed to process pending research' });
    }
});
