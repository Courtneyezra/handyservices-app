import { Router, Request, Response } from 'express';
import { db } from './db';
import { contractorJobs, handymanProfiles } from '../shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireContractorAuth } from './contractor-auth';

const router = Router();

// GET /api/contractor/jobs
// List contractor's jobs with optional status filter
router.get('/', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { status } = req.query;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        let jobs;
        if (status && typeof status === 'string') {
            const statuses = status.split(',');
            jobs = await db.select()
                .from(contractorJobs)
                .where(and(
                    eq(contractorJobs.contractorId, contractorId),
                    inArray(contractorJobs.status, statuses)
                ))
                .orderBy(desc(contractorJobs.scheduledDate));
        } else {
            jobs = await db.select()
                .from(contractorJobs)
                .where(eq(contractorJobs.contractorId, contractorId))
                .orderBy(desc(contractorJobs.scheduledDate));
        }

        res.json({ jobs });
    } catch (error) {
        console.error('[ContractorJobs] List error:', error);
        res.status(500).json({ error: 'Failed to list jobs' });
    }
});

// GET /api/contractor/jobs/:id
// Get job details
router.get('/:id', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { id } = req.params;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        const job = await db.select()
            .from(contractorJobs)
            .where(and(
                eq(contractorJobs.id, id),
                eq(contractorJobs.contractorId, contractorId)
            ))
            .limit(1);

        if (job.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json({ job: job[0] });
    } catch (error) {
        console.error('[ContractorJobs] Get job error:', error);
        res.status(500).json({ error: 'Failed to get job' });
    }
});

// POST /api/contractor/jobs/:id/accept
// Accept a job assignment
router.post('/:id/accept', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { id } = req.params;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Verify job exists and belongs to contractor
        const job = await db.select()
            .from(contractorJobs)
            .where(and(
                eq(contractorJobs.id, id),
                eq(contractorJobs.contractorId, contractorId)
            ))
            .limit(1);

        if (job.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        if (job[0].status !== 'pending') {
            return res.status(400).json({ error: 'Job cannot be accepted in current status' });
        }

        await db.update(contractorJobs)
            .set({
                status: 'accepted',
                acceptedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(contractorJobs.id, id));

        res.json({ success: true, status: 'accepted' });
    } catch (error) {
        console.error('[ContractorJobs] Accept error:', error);
        res.status(500).json({ error: 'Failed to accept job' });
    }
});

// POST /api/contractor/jobs/:id/decline
// Decline a job assignment
router.post('/:id/decline', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { id } = req.params;
        const { reason } = req.body;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Verify job exists and belongs to contractor
        const job = await db.select()
            .from(contractorJobs)
            .where(and(
                eq(contractorJobs.id, id),
                eq(contractorJobs.contractorId, contractorId)
            ))
            .limit(1);

        if (job.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        if (job[0].status !== 'pending') {
            return res.status(400).json({ error: 'Job cannot be declined in current status' });
        }

        await db.update(contractorJobs)
            .set({
                status: 'declined',
                notes: reason ? `Declined: ${reason}` : 'Declined by contractor',
                updatedAt: new Date(),
            })
            .where(eq(contractorJobs.id, id));

        res.json({ success: true, status: 'declined' });
    } catch (error) {
        console.error('[ContractorJobs] Decline error:', error);
        res.status(500).json({ error: 'Failed to decline job' });
    }
});

// POST /api/contractor/jobs/:id/start
// Mark a job as in progress
router.post('/:id/start', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { id } = req.params;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Verify job exists and belongs to contractor
        const job = await db.select()
            .from(contractorJobs)
            .where(and(
                eq(contractorJobs.id, id),
                eq(contractorJobs.contractorId, contractorId)
            ))
            .limit(1);

        if (job.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        if (job[0].status !== 'accepted') {
            return res.status(400).json({ error: 'Job must be accepted before starting' });
        }

        await db.update(contractorJobs)
            .set({
                status: 'in_progress',
                updatedAt: new Date(),
            })
            .where(eq(contractorJobs.id, id));

        res.json({ success: true, status: 'in_progress' });
    } catch (error) {
        console.error('[ContractorJobs] Start error:', error);
        res.status(500).json({ error: 'Failed to start job' });
    }
});

// POST /api/contractor/jobs/:id/complete
// Mark a job as completed
router.post('/:id/complete', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { id } = req.params;
        const { notes } = req.body;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Verify job exists and belongs to contractor
        const job = await db.select()
            .from(contractorJobs)
            .where(and(
                eq(contractorJobs.id, id),
                eq(contractorJobs.contractorId, contractorId)
            ))
            .limit(1);

        if (job.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        if (!['accepted', 'in_progress'].includes(job[0].status)) {
            return res.status(400).json({ error: 'Job must be accepted or in progress to complete' });
        }

        await db.update(contractorJobs)
            .set({
                status: 'completed',
                completedAt: new Date(),
                notes: notes || job[0].notes,
                updatedAt: new Date(),
            })
            .where(eq(contractorJobs.id, id));

        res.json({ success: true, status: 'completed' });
    } catch (error) {
        console.error('[ContractorJobs] Complete error:', error);
        res.status(500).json({ error: 'Failed to complete job' });
    }
});

// GET /api/contractor/jobs/stats
// Get job statistics
router.get('/stats/summary', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Get all jobs
        const allJobs = await db.select()
            .from(contractorJobs)
            .where(eq(contractorJobs.contractorId, contractorId));

        // Calculate stats
        const pending = allJobs.filter(j => j.status === 'pending').length;
        const accepted = allJobs.filter(j => j.status === 'accepted').length;
        const inProgress = allJobs.filter(j => j.status === 'in_progress').length;
        const completed = allJobs.filter(j => j.status === 'completed').length;
        const declined = allJobs.filter(j => j.status === 'declined').length;

        // Calculate earnings (completed jobs only)
        const totalEarningsPence = allJobs
            .filter(j => j.status === 'completed' && j.payoutPence)
            .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

        // This month's earnings
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEarningsPence = allJobs
            .filter(j =>
                j.status === 'completed' &&
                j.payoutPence &&
                j.completedAt &&
                new Date(j.completedAt) >= startOfMonth
            )
            .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

        res.json({
            jobs: {
                pending,
                accepted,
                inProgress,
                completed,
                declined,
                total: allJobs.length,
            },
            earnings: {
                totalPence: totalEarningsPence,
                totalPounds: (totalEarningsPence / 100).toFixed(2),
                monthPence: monthEarningsPence,
                monthPounds: (monthEarningsPence / 100).toFixed(2),
            },
        });
    } catch (error) {
        console.error('[ContractorJobs] Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

export default router;
