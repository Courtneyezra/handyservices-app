import { Router } from 'express';
import { db } from './db';
import { contractorBookingRequests, handymanAvailability, contractorAvailabilityDates, handymanProfiles, users, personalizedQuotes } from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sendJobAssignmentEmail } from './email-service';
import { requireContractor } from './auth';

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

        // Send notification to contractor (async/non-blocking)
        console.log(`[Job Assignment] Job ${id} assigned to contractor ${contractorId} for ${scheduledDate}`);

        // Fetch contractor details for email notification
        (async () => {
            try {
                const contractorData = await db.select({
                    firstName: users.firstName,
                    lastName: users.lastName,
                    email: users.email,
                })
                .from(handymanProfiles)
                .innerJoin(users, eq(handymanProfiles.userId, users.id))
                .where(eq(handymanProfiles.id, contractorId))
                .limit(1);

                if (contractorData.length > 0 && contractorData[0].email) {
                    const contractor = contractorData[0];
                    const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

                    // Fetch address from linked quote if available
                    let address = '';
                    if (updatedJob.quoteId) {
                        const quoteData = await db.select({ address: personalizedQuotes.address })
                            .from(personalizedQuotes)
                            .where(eq(personalizedQuotes.id, updatedJob.quoteId))
                            .limit(1);
                        if (quoteData.length > 0 && quoteData[0].address) {
                            address = quoteData[0].address;
                        }
                    }

                    await sendJobAssignmentEmail({
                        contractorName,
                        contractorEmail: contractor.email,
                        customerName: updatedJob.customerName || 'Customer',
                        address,
                        jobDescription: updatedJob.description || '',
                        scheduledDate: scheduledDate,
                        scheduledStartTime: updatedJob.scheduledStartTime || undefined,
                        scheduledEndTime: updatedJob.scheduledEndTime || undefined,
                        jobId: id,
                    });
                } else {
                    console.log(`[Job Assignment] No email found for contractor ${contractorId}`);
                }
            } catch (emailError) {
                console.error('[Job Assignment] Failed to send assignment email:', emailError);
            }
        })();

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

// Contractor accepts job (authenticated)
jobAssignmentRouter.post('/api/jobs/:id/accept', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId; // From auth middleware

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

// Contractor rejects job (authenticated)
jobAssignmentRouter.post('/api/jobs/:id/reject', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const contractorId = (req as any).contractorId; // From auth middleware

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

// Get jobs assigned to contractor (authenticated)
jobAssignmentRouter.get('/api/jobs/assigned', requireContractor, async (req, res) => {
    try {
        const contractorId = (req as any).contractorId; // From auth middleware

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

// Complete job with signature and time tracking (authenticated)
jobAssignmentRouter.post('/api/jobs/:id/complete', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId; // From auth middleware
        const { signatureDataUrl, timeOnJobSeconds, completionNotes, evidenceUrls } = req.body;

        // Fetch the job first to verify ownership
        const jobResults = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (jobResults.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const job = jobResults[0];

        // Verify contractor ownership
        if (job.assignedContractorId !== contractorId) {
            return res.status(403).json({ error: 'This job is not assigned to you' });
        }

        // Verify job is in a completable state
        if (job.status === 'completed' || job.assignmentStatus === 'completed') {
            return res.status(400).json({ error: 'Job is already completed' });
        }

        // Build update object
        const updateData: any = {
            status: 'completed',
            assignmentStatus: 'completed',
            completedAt: new Date(),
            updatedAt: new Date()
        };

        // Add signature if provided
        if (signatureDataUrl) {
            updateData.signatureDataUrl = signatureDataUrl;
        }

        // Add time tracking if provided
        if (timeOnJobSeconds !== undefined && timeOnJobSeconds !== null) {
            updateData.timeOnJobSeconds = timeOnJobSeconds;
        }

        // Add completion notes if provided
        if (completionNotes) {
            updateData.completionNotes = completionNotes;
        }

        // Add evidence URLs if provided
        if (evidenceUrls && Array.isArray(evidenceUrls)) {
            updateData.evidenceUrls = evidenceUrls;
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set(updateData)
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Assignment] Job ${id} completed. Time: ${timeOnJobSeconds}s, Signature: ${signatureDataUrl ? 'Yes' : 'No'}`);

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        console.error('[Job Assignment] Error completing job:', error);
        res.status(500).json({ error: error.message || "Failed to complete job" });
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

// B5: Get recommended contractors for a job
// Uses skill-matching, location, and availability to rank contractors
jobAssignmentRouter.get('/api/jobs/:id/recommend-contractors', async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query; // Optional: specific date to check availability

        // Fetch the job
        const jobResults = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (jobResults.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const job = jobResults[0];

        // Get job location from linked quote if available
        let jobLocation: { lat: number; lng: number } | undefined;
        let jobCategories: string[] = [];

        if (job.quoteId) {
            const quoteData = await db.select({
                coordinates: personalizedQuotes.coordinates,
                categories: personalizedQuotes.categories
            })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, job.quoteId))
            .limit(1);

            if (quoteData.length > 0) {
                if (quoteData[0].coordinates) {
                    const coords = quoteData[0].coordinates as { lat: number; lng: number };
                    if (coords.lat && coords.lng) {
                        jobLocation = coords;
                    }
                }
                if (quoteData[0].categories) {
                    jobCategories = quoteData[0].categories as string[];
                }
            }
        }

        // Parse scheduled date
        const scheduledDate = date
            ? new Date(date as string)
            : job.scheduledDate || job.requestedDate || undefined;

        // Get recommendations
        const { recommendContractorsForJob } = await import('./availability-engine');

        const recommendations = await recommendContractorsForJob({
            jobLocation,
            jobCategories,
            scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
            includeUnavailable: false
        });

        res.json({
            jobId: id,
            scheduledDate: scheduledDate?.toISOString().split('T')[0],
            recommendations: recommendations.slice(0, 10), // Top 10
            totalMatches: recommendations.length
        });

    } catch (error: any) {
        console.error('[Job Assignment] Error getting recommendations:', error);
        res.status(500).json({ error: error.message || 'Failed to get recommendations' });
    }
});

// B5: Get available contractors for a specific date (admin dispatch helper)
jobAssignmentRouter.get('/api/admin/contractors/available', async (req, res) => {
    try {
        const { date, lat, lng, categories } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'date query parameter is required' });
        }

        const { recommendContractorsForJob } = await import('./availability-engine');

        const jobLocation = (lat && lng)
            ? { lat: parseFloat(lat as string), lng: parseFloat(lng as string) }
            : undefined;

        const jobCategories = categories
            ? (categories as string).split(',').map(c => c.trim())
            : [];

        const recommendations = await recommendContractorsForJob({
            jobLocation,
            jobCategories,
            scheduledDate: new Date(date as string),
            includeUnavailable: false
        });

        res.json({
            date: date,
            availableContractors: recommendations,
            count: recommendations.length
        });

    } catch (error: any) {
        console.error('[Job Assignment] Error fetching available contractors:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch available contractors' });
    }
});

// B5: Check specific contractor's availability for a date
jobAssignmentRouter.get('/api/contractors/:contractorId/availability/:date', async (req, res) => {
    try {
        const { contractorId, date } = req.params;

        const { checkContractorAvailability } = await import('./availability-engine');

        const result = await checkContractorAvailability(contractorId, new Date(date));

        res.json({
            contractorId,
            date,
            ...result
        });

    } catch (error: any) {
        console.error('[Job Assignment] Error checking availability:', error);
        res.status(500).json({ error: error.message || 'Failed to check availability' });
    }
});

export default jobAssignmentRouter;
