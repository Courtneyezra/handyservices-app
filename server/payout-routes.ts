import { Router, Request, Response } from 'express';
import { db } from './db';
import { contractorPayouts, contractorBookingRequests, handymanProfiles } from '../shared/schema';
import { eq, and, desc, gte, lt, sql } from 'drizzle-orm';
import { requireContractorAuth } from './contractor-auth';
import { requireAdmin } from './auth';
import { processPayouts, retryFailedPayouts } from './payout-engine';

export const payoutRouter = Router();

// ==========================================
// CONTRACTOR ROUTES
// ==========================================

/**
 * GET /api/contractor/payouts — list payouts for the authenticated contractor
 */
payoutRouter.get('/api/contractor/payouts', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
        });
        if (!profile) return res.status(404).json({ error: 'Contractor profile not found' });

        // Fetch payouts with job description via join
        const payouts = await db.select({
            id: contractorPayouts.id,
            jobId: contractorPayouts.jobId,
            quoteId: contractorPayouts.quoteId,
            grossAmountPence: contractorPayouts.grossAmountPence,
            platformFeePence: contractorPayouts.platformFeePence,
            netPayoutPence: contractorPayouts.netPayoutPence,
            variationAmountPence: contractorPayouts.variationAmountPence,
            status: contractorPayouts.status,
            failureReason: contractorPayouts.failureReason,
            heldReason: contractorPayouts.heldReason,
            scheduledPayoutAt: contractorPayouts.scheduledPayoutAt,
            paidAt: contractorPayouts.paidAt,
            createdAt: contractorPayouts.createdAt,
            // Job details
            jobDescription: contractorBookingRequests.description,
            jobDate: contractorBookingRequests.scheduledDate,
            customerName: contractorBookingRequests.customerName,
        })
            .from(contractorPayouts)
            .leftJoin(
                contractorBookingRequests,
                eq(contractorPayouts.jobId, contractorBookingRequests.id)
            )
            .where(eq(contractorPayouts.contractorId, profile.id))
            .orderBy(desc(contractorPayouts.createdAt));

        res.json(payouts);
    } catch (err: any) {
        console.error('[Payouts] List error:', err);
        res.status(500).json({ error: 'Failed to fetch payouts' });
    }
});

/**
 * GET /api/contractor/payouts/:id — payout detail
 */
payoutRouter.get('/api/contractor/payouts/:id', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
        });
        if (!profile) return res.status(404).json({ error: 'Contractor profile not found' });

        const payoutId = parseInt(req.params.id, 10);
        if (isNaN(payoutId)) return res.status(400).json({ error: 'Invalid payout ID' });

        const result = await db.select({
            id: contractorPayouts.id,
            jobId: contractorPayouts.jobId,
            quoteId: contractorPayouts.quoteId,
            invoiceId: contractorPayouts.invoiceId,
            grossAmountPence: contractorPayouts.grossAmountPence,
            platformFeePence: contractorPayouts.platformFeePence,
            netPayoutPence: contractorPayouts.netPayoutPence,
            variationAmountPence: contractorPayouts.variationAmountPence,
            stripeTransferId: contractorPayouts.stripeTransferId,
            stripeTransferStatus: contractorPayouts.stripeTransferStatus,
            status: contractorPayouts.status,
            failureReason: contractorPayouts.failureReason,
            heldReason: contractorPayouts.heldReason,
            scheduledPayoutAt: contractorPayouts.scheduledPayoutAt,
            paidAt: contractorPayouts.paidAt,
            reversedAt: contractorPayouts.reversedAt,
            reversalReason: contractorPayouts.reversalReason,
            createdAt: contractorPayouts.createdAt,
            // Job details
            jobDescription: contractorBookingRequests.description,
            jobDate: contractorBookingRequests.scheduledDate,
            customerName: contractorBookingRequests.customerName,
        })
            .from(contractorPayouts)
            .leftJoin(
                contractorBookingRequests,
                eq(contractorPayouts.jobId, contractorBookingRequests.id)
            )
            .where(
                and(
                    eq(contractorPayouts.id, payoutId),
                    eq(contractorPayouts.contractorId, profile.id)
                )
            )
            .limit(1);

        if (result.length === 0) return res.status(404).json({ error: 'Payout not found' });

        res.json(result[0]);
    } catch (err: any) {
        console.error('[Payouts] Detail error:', err);
        res.status(500).json({ error: 'Failed to fetch payout' });
    }
});

/**
 * GET /api/contractor/earnings-summary — this month, last month, pending, next scheduled
 */
payoutRouter.get('/api/contractor/earnings-summary', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
        });
        if (!profile) return res.status(404).json({ error: 'Contractor profile not found' });

        const contractorIdStr = profile.id;
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        // This month — paid payouts
        const thisMonthResult = await db.select({
            total: sql<number>`COALESCE(SUM(${contractorPayouts.netPayoutPence}), 0)`,
            count: sql<number>`COUNT(*)`,
        })
            .from(contractorPayouts)
            .where(
                and(
                    eq(contractorPayouts.contractorId, contractorIdStr),
                    eq(contractorPayouts.status, 'paid'),
                    gte(contractorPayouts.paidAt, thisMonthStart)
                )
            );

        // Last month — paid payouts
        const lastMonthResult = await db.select({
            total: sql<number>`COALESCE(SUM(${contractorPayouts.netPayoutPence}), 0)`,
            count: sql<number>`COUNT(*)`,
        })
            .from(contractorPayouts)
            .where(
                and(
                    eq(contractorPayouts.contractorId, contractorIdStr),
                    eq(contractorPayouts.status, 'paid'),
                    gte(contractorPayouts.paidAt, lastMonthStart),
                    lt(contractorPayouts.paidAt, thisMonthStart)
                )
            );

        // Pending payouts
        const pendingResult = await db.select({
            total: sql<number>`COALESCE(SUM(${contractorPayouts.netPayoutPence}), 0)`,
            count: sql<number>`COUNT(*)`,
            nextScheduled: sql<string>`MIN(${contractorPayouts.scheduledPayoutAt})`,
        })
            .from(contractorPayouts)
            .where(
                and(
                    eq(contractorPayouts.contractorId, contractorIdStr),
                    eq(contractorPayouts.status, 'pending')
                )
            );

        res.json({
            thisMonth: {
                totalPence: Number(thisMonthResult[0]?.total || 0),
                jobCount: Number(thisMonthResult[0]?.count || 0),
            },
            lastMonth: {
                totalPence: Number(lastMonthResult[0]?.total || 0),
                jobCount: Number(lastMonthResult[0]?.count || 0),
            },
            pending: {
                totalPence: Number(pendingResult[0]?.total || 0),
                count: Number(pendingResult[0]?.count || 0),
                nextScheduledAt: pendingResult[0]?.nextScheduled || null,
            },
        });
    } catch (err: any) {
        console.error('[Payouts] Earnings summary error:', err);
        res.status(500).json({ error: 'Failed to fetch earnings summary' });
    }
});

/**
 * GET /api/contractor/tax-summary — annual summary by UK tax year (Apr 6 - Apr 5)
 */
payoutRouter.get('/api/contractor/tax-summary', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
        });
        if (!profile) return res.status(404).json({ error: 'Contractor profile not found' });

        const contractorIdStr = profile.id;

        // Get all paid payouts grouped by UK tax year (Apr 6 - Apr 5)
        const taxYearSummary = await db.select({
            taxYear: sql<string>`
                CASE
                    WHEN EXTRACT(MONTH FROM ${contractorPayouts.paidAt}) >= 4 AND EXTRACT(DAY FROM ${contractorPayouts.paidAt}) >= 6
                        OR EXTRACT(MONTH FROM ${contractorPayouts.paidAt}) > 4
                    THEN EXTRACT(YEAR FROM ${contractorPayouts.paidAt})::text || '/' || (EXTRACT(YEAR FROM ${contractorPayouts.paidAt}) + 1)::text
                    ELSE (EXTRACT(YEAR FROM ${contractorPayouts.paidAt}) - 1)::text || '/' || EXTRACT(YEAR FROM ${contractorPayouts.paidAt})::text
                END
            `,
            totalGrossPence: sql<number>`COALESCE(SUM(${contractorPayouts.grossAmountPence}), 0)`,
            totalPlatformFeePence: sql<number>`COALESCE(SUM(${contractorPayouts.platformFeePence}), 0)`,
            totalNetPayoutPence: sql<number>`COALESCE(SUM(${contractorPayouts.netPayoutPence}), 0)`,
            totalJobs: sql<number>`COUNT(*)`,
        })
            .from(contractorPayouts)
            .where(
                and(
                    eq(contractorPayouts.contractorId, contractorIdStr),
                    eq(contractorPayouts.status, 'paid')
                )
            )
            .groupBy(sql`
                CASE
                    WHEN EXTRACT(MONTH FROM ${contractorPayouts.paidAt}) >= 4 AND EXTRACT(DAY FROM ${contractorPayouts.paidAt}) >= 6
                        OR EXTRACT(MONTH FROM ${contractorPayouts.paidAt}) > 4
                    THEN EXTRACT(YEAR FROM ${contractorPayouts.paidAt})::text || '/' || (EXTRACT(YEAR FROM ${contractorPayouts.paidAt}) + 1)::text
                    ELSE (EXTRACT(YEAR FROM ${contractorPayouts.paidAt}) - 1)::text || '/' || EXTRACT(YEAR FROM ${contractorPayouts.paidAt})::text
                END
            `)
            .orderBy(sql`1 DESC`);

        res.json({
            years: taxYearSummary.map(row => ({
                taxYear: row.taxYear,
                totalGrossPence: Number(row.totalGrossPence),
                totalPlatformFeePence: Number(row.totalPlatformFeePence),
                totalNetPayoutPence: Number(row.totalNetPayoutPence),
                totalJobs: Number(row.totalJobs),
            })),
        });
    } catch (err: any) {
        console.error('[Payouts] Tax summary error:', err);
        res.status(500).json({ error: 'Failed to fetch tax summary' });
    }
});

// ==========================================
// ADMIN ROUTES
// ==========================================

/**
 * POST /api/admin/payouts/:id/hold — admin holds a payout (reason required)
 */
payoutRouter.post('/api/admin/payouts/:id/hold', requireAdmin, async (req: Request, res: Response) => {
    try {
        const payoutId = parseInt(req.params.id, 10);
        if (isNaN(payoutId)) return res.status(400).json({ error: 'Invalid payout ID' });

        const { reason } = req.body;
        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Reason is required to hold a payout' });
        }

        const existing = await db.select().from(contractorPayouts).where(eq(contractorPayouts.id, payoutId)).limit(1);
        if (existing.length === 0) return res.status(404).json({ error: 'Payout not found' });

        if (existing[0].status === 'paid') {
            return res.status(400).json({ error: 'Cannot hold a payout that has already been paid' });
        }

        await db.update(contractorPayouts)
            .set({
                status: 'held',
                heldReason: reason.trim(),
                updatedAt: new Date(),
            })
            .where(eq(contractorPayouts.id, payoutId));

        res.json({ success: true, payoutId, status: 'held' });
    } catch (err: any) {
        console.error('[Payouts] Admin hold error:', err);
        res.status(500).json({ error: 'Failed to hold payout' });
    }
});

/**
 * POST /api/admin/payouts/:id/release — admin releases a held payout
 * Sets scheduledPayoutAt to now + 1hr so cron picks it up
 */
payoutRouter.post('/api/admin/payouts/:id/release', requireAdmin, async (req: Request, res: Response) => {
    try {
        const payoutId = parseInt(req.params.id, 10);
        if (isNaN(payoutId)) return res.status(400).json({ error: 'Invalid payout ID' });

        const existing = await db.select().from(contractorPayouts).where(eq(contractorPayouts.id, payoutId)).limit(1);
        if (existing.length === 0) return res.status(404).json({ error: 'Payout not found' });

        if (existing[0].status !== 'held') {
            return res.status(400).json({ error: 'Only held payouts can be released' });
        }

        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

        await db.update(contractorPayouts)
            .set({
                status: 'pending',
                heldReason: null,
                scheduledPayoutAt: oneHourFromNow,
                updatedAt: new Date(),
            })
            .where(eq(contractorPayouts.id, payoutId));

        res.json({ success: true, payoutId, status: 'pending', scheduledPayoutAt: oneHourFromNow });
    } catch (err: any) {
        console.error('[Payouts] Admin release error:', err);
        res.status(500).json({ error: 'Failed to release payout' });
    }
});

/**
 * POST /api/admin/payouts/process — manual trigger for processPayouts()
 */
payoutRouter.post('/api/admin/payouts/process', requireAdmin, async (_req: Request, res: Response) => {
    try {
        console.log('[Payouts] Manual process triggered by admin');
        const result = await processPayouts();
        console.log(`[Payouts] Manual run complete: ${result.processed} processed, ${result.failed} failed, ${result.held} held`);
        res.json(result);
    } catch (err: any) {
        console.error('[Payouts] Manual process error:', err);
        res.status(500).json({ error: 'Failed to process payouts' });
    }
});

/**
 * POST /api/admin/payouts/retry — manual trigger for retryFailedPayouts()
 */
payoutRouter.post('/api/admin/payouts/retry', requireAdmin, async (_req: Request, res: Response) => {
    try {
        console.log('[Payouts] Manual retry triggered by admin');
        const result = await retryFailedPayouts();
        console.log(`[Payouts] Retry complete: ${result.retried} retried, ${result.skipped} skipped (max retries)`);
        res.json(result);
    } catch (err: any) {
        console.error('[Payouts] Manual retry error:', err);
        res.status(500).json({ error: 'Failed to retry payouts' });
    }
});
