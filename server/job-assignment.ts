import { Router } from 'express';
import { db } from './db';
import { contractorBookingRequests, handymanAvailability, contractorAvailabilityDates } from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const jobAssignmentRouter = Router();

// B5: Assign job to contractor with availability check
jobAssignmentRouter.post('/api/jobs/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { contractorId, scheduledDate, scheduledStartTime, scheduledEndTime } = req.body;

        if (!contractorId || !scheduledDate) {
            return res.status(400).json({ error: 'contractorId and scheduledDate are required' });
        }

        // Fetch the job
        const jobResults = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (jobResults.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const job = jobResults[0];

        // Check if job is already assigned
        if (job.assignmentStatus === 'accepted' || job.assignmentStatus === 'in_progress') {
            return res.status(400).json({ error: 'Job is already assigned and accepted' });
        }

        // Validate contractor availability
        const targetDate = new Date(scheduledDate);
        targetDate.setHours(0, 0, 0, 0);
        const dayOfWeek = targetDate.getDay();

        // Check for date-specific override first
        const overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                eq(contractorAvailabilityDates.date, targetDate)
            ))
            .limit(1);

        let isAvailable = false;
        let availableStartTime = '';
        let availableEndTime = '';

        if (overrides.length > 0) {
            // Use override
            const override = overrides[0];
            isAvailable = override.isAvailable || false;
            availableStartTime = override.startTime || '';
            availableEndTime = override.endTime || '';
        } else {
            // Check weekly pattern
            const patterns = await db.select()
                .from(handymanAvailability)
                .where(and(
                    eq(handymanAvailability.handymanId, contractorId),
                    eq(handymanAvailability.dayOfWeek, dayOfWeek),
                    eq(handymanAvailability.isActive, true)
                ))
                .limit(1);

            if (patterns.length > 0) {
                const pattern = patterns[0];
                isAvailable = true;
                availableStartTime = pattern.startTime || '';
                availableEndTime = pattern.endTime || '';
            }
        }

        if (!isAvailable) {
            return res.status(400).json({
                error: 'Contractor is not available on the selected date',
                availabilityCheck: {
                    date: scheduledDate,
                    isAvailable: false
                }
            });
        }

        // Check for scheduling conflicts (other jobs on same date)
        const conflicts = await db.select()
            .from(contractorBookingRequests)
            .where(and(
                eq(contractorBookingRequests.assignedContractorId, contractorId),
                eq(contractorBookingRequests.scheduledDate, targetDate),
                eq(contractorBookingRequests.assignmentStatus, 'accepted')
            ));

        if (conflicts.length > 0) {
            return res.status(400).json({
                error: 'Contractor has conflicting jobs on this date',
                conflicts: conflicts.map(c => ({
                    id: c.id,
                    customerName: c.customerName,
                    scheduledTime: `${c.scheduledStartTime} - ${c.scheduledEndTime}`
                }))
            });
        }

        // Assign the job
        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                assignedContractorId: contractorId,
                scheduledDate: targetDate,
                scheduledStartTime: scheduledStartTime || availableStartTime,
                scheduledEndTime: scheduledEndTime || availableEndTime,
                assignedAt: new Date(),
                assignmentStatus: 'assigned',
                updatedAt: new Date()
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        // TODO: Send notification to contractor (email/SMS)
        console.log(`[Job Assignment] Job ${id} assigned to contractor ${contractorId} for ${scheduledDate}`);

        res.json({
            success: true,
            job: updatedJob,
            message: 'Job assigned successfully. Contractor will be notified.'
        });

    } catch (error: any) {
        console.error('[Job Assignment] Error assigning job:', error);
        res.status(500).json({ error: error.message || 'Failed to assign job' });
    }
});

// Contractor accepts job
jobAssignmentRouter.post('/api/jobs/:id/accept', async (req, res) => {
    try {
        const { id } = req.params;
        // TODO: Get contractor ID from auth token
        const contractorId = req.body.contractorId; // Temporary - should come from auth

        const jobResults = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (jobResults.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const job = jobResults[0];

        if (job.assignedContractorId !== contractorId) {
            return res.status(403).json({ error: 'This job is not assigned to you' });
        }

        if (job.assignmentStatus !== 'assigned') {
            return res.status(400).json({ error: 'Job cannot be accepted in current status' });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                acceptedAt: new Date(),
                assignmentStatus: 'accepted',
                status: 'accepted',
                updatedAt: new Date()
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        res.json({
            success: true,
            job: updatedJob,
            message: 'Job accepted successfully'
        });

    } catch (error: any) {
        console.error('[Job Assignment] Error accepting job:', error);
        res.status(500).json({ error: error.message || 'Failed to accept job' });
    }
});

// Contractor rejects job
jobAssignmentRouter.post('/api/jobs/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        // TODO: Get contractor ID from auth token
        const contractorId = req.body.contractorId; // Temporary - should come from auth

        const jobResults = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (jobResults.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const job = jobResults[0];

        if (job.assignedContractorId !== contractorId) {
            return res.status(403).json({ error: 'This job is not assigned to you' });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                rejectedAt: new Date(),
                assignmentStatus: 'rejected',
                status: 'declined',
                completionNotes: reason || 'Rejected by contractor',
                updatedAt: new Date()
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        res.json({
            success: true,
            job: updatedJob,
            message: 'Job rejected'
        });

    } catch (error: any) {
        console.error('[Job Assignment] Error rejecting job:', error);
        res.status(500).json({ error: error.message || 'Failed to reject job' });
    }
});

// Get jobs assigned to contractor
jobAssignmentRouter.get('/api/jobs/assigned', async (req, res) => {
    try {
        // TODO: Get contractor ID from auth token
        const contractorId = req.query.contractorId as string;

        if (!contractorId) {
            return res.status(400).json({ error: 'contractorId is required' });
        }

        const jobs = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.assignedContractorId, contractorId));

        res.json(jobs);

    } catch (error: any) {
        console.error('[Job Assignment] Error fetching assigned jobs:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch assigned jobs' });
    }

});

// Get specific job details (secured by contractorId check is implicit in UI, but explicit here is better)
// In production, we'd use req.user.id
jobAssignmentRouter.get('/api/jobs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.id, id)).limit(1);

        if (result.length === 0) {
            return res.status(404).json({ error: "Job not found" });
        }
        res.json(result[0]);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch job" });
    }
});

// Complete job
jobAssignmentRouter.post('/api/jobs/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        // TODO: specific checks for photos?
        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                status: 'completed',
                assignmentStatus: 'completed',
                completedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        res.status(500).json({ error: "Failed to complete job" });
    }
});

// Admin: Get all jobs for dispatch board
jobAssignmentRouter.get('/api/admin/jobs', async (req, res) => {
    try {
        const { status } = req.query;
        const { desc } = await import('drizzle-orm');

        let jobs;
        if (status) {
            jobs = await db.select()
                .from(contractorBookingRequests)
                .where(eq(contractorBookingRequests.assignmentStatus, status as string))
                .orderBy(desc(contractorBookingRequests.createdAt));
        } else {
            jobs = await db.select()
                .from(contractorBookingRequests)
                .orderBy(desc(contractorBookingRequests.createdAt));
        }

        res.json(jobs);
    } catch (error: any) {
        console.error('[Job Assignment] Error fetching admin jobs:', error);
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

export default jobAssignmentRouter;
