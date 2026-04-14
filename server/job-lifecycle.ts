import { Router } from 'express';
import { db } from './db';
import {
    contractorBookingRequests,
    variationOrders,
    jobIncidents,
    contractorPayouts,
    jobSheets,
    wtbpRateCard,
} from '../shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import { requireContractor } from './auth';
import { notifyCustomer } from './customer-notifications';
import { generateBalanceInvoice } from './invoice-generator';

export const jobLifecycleRouter = Router();

// ==========================================
// DAY-BEFORE CONFIRMATION
// ==========================================

// GET /api/jobs/:id/confirm-attendance — one-click confirmation from email link
// No auth required — the link itself serves as proof (same pattern as variation approval)
jobLifecycleRouter.get('/api/jobs/:id/confirm-attendance', async (req, res) => {
    try {
        const { id } = req.params;

        const results = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).send(confirmResponseHtml('Job Not Found', 'This job could not be found.', false));
        }

        const job = results[0];

        if (job.dayOfStatus !== 'scheduled') {
            return res.status(200).send(confirmResponseHtml(
                'Already Updated',
                `This job's status is already "${job.dayOfStatus}". No further action needed.`,
                true
            ));
        }

        // Mark as confirmed by updating dayOfStatus and recording the timestamp
        await db.update(contractorBookingRequests)
            .set({
                dayOfStatus: 'scheduled', // stays scheduled but we record the check-in
                updatedAt: new Date(),
                // Use mustCheckInBy = null as the "confirmed" signal:
                // It was set when we sent the email, clearing it means confirmed
                mustCheckInBy: null,
            })
            .where(eq(contractorBookingRequests.id, id));

        console.log(`[Day-Before] Job ${id} confirmed by contractor via email link`);

        const scheduledDate = job.scheduledDate
            ? new Date(job.scheduledDate).toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            })
            : 'tomorrow';

        res.send(confirmResponseHtml(
            'Attendance Confirmed!',
            `You're confirmed for <strong>${job.customerName}</strong> on <strong>${scheduledDate}</strong>. See you there!`,
            true
        ));
    } catch (error: any) {
        console.error('[Day-Before] Error confirming attendance:', error);
        res.status(500).send(confirmResponseHtml('Error', 'Something went wrong. Please contact dispatch.', false));
    }
});

// POST /api/jobs/:id/confirm-attendance — API endpoint for contractor app
jobLifecycleRouter.post('/api/jobs/:id/confirm-attendance', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        // Clear the mustCheckInBy deadline to mark as confirmed
        await db.update(contractorBookingRequests)
            .set({
                mustCheckInBy: null,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id));

        console.log(`[Day-Before] Job ${id} confirmed by contractor ${contractorId} via API`);

        res.json({ success: true, message: 'Attendance confirmed' });
    } catch (error: any) {
        console.error('[Day-Before] Error confirming attendance via API:', error);
        res.status(500).json({ error: error.message || 'Failed to confirm attendance' });
    }
});

function confirmResponseHtml(title: string, message: string, success: boolean): string {
    const icon = success ? '\u2705' : '\u274c';
    const bg = success ? '#16a34a' : '#dc2626';
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Handy Services</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; text-align: center; color: #1a1a2e; }
        .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; }
        .icon { font-size: 3rem; margin: 1rem 0; }
        h1 { font-size: 1.5rem; color: ${bg}; }
        p { color: #64748b; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
    </div>
</body>
</html>`;
}

// ==========================================
// Helper: fetch job and validate contractor ownership
// ==========================================
async function fetchJobForContractor(jobId: string, contractorId: string) {
    const results = await db.select()
        .from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, jobId))
        .limit(1);

    if (results.length === 0) {
        return { error: 'Job not found', status: 404, job: null };
    }

    const job = results[0];

    if (job.assignedContractorId !== contractorId) {
        return { error: 'This job is not assigned to you', status: 403, job: null };
    }

    return { error: null, status: 200, job };
}

// ==========================================
// STATUS TRANSITIONS
// ==========================================

// POST /api/jobs/:id/en-route — contractor marks themselves en route
jobLifecycleRouter.post('/api/jobs/:id/en-route', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus !== 'scheduled') {
            return res.status(400).json({
                error: `Cannot transition to en_route from status '${job.dayOfStatus}'. Must be 'scheduled'.`
            });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                dayOfStatus: 'en_route',
                enRouteAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Lifecycle] Job ${id} status -> en_route`);

        // Notify customer (async, non-blocking)
        notifyCustomer({ jobId: id, event: 'contractor_en_route' }).catch(console.error);

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error setting en-route:', error);
        res.status(500).json({ error: error.message || 'Failed to update job status' });
    }
});

// POST /api/jobs/:id/arrived — contractor arrives on site
jobLifecycleRouter.post('/api/jobs/:id/arrived', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus !== 'en_route') {
            return res.status(400).json({
                error: `Cannot transition to arrived from status '${job.dayOfStatus}'. Must be 'en_route'.`
            });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                dayOfStatus: 'arrived',
                arrivedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Lifecycle] Job ${id} status -> arrived`);

        // Notify customer (async, non-blocking)
        notifyCustomer({ jobId: id, event: 'contractor_arrived' }).catch(console.error);

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error setting arrived:', error);
        res.status(500).json({ error: error.message || 'Failed to update job status' });
    }
});

// POST /api/jobs/:id/start-timer — contractor starts work timer
jobLifecycleRouter.post('/api/jobs/:id/start-timer', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus !== 'arrived') {
            return res.status(400).json({
                error: `Cannot start timer from status '${job.dayOfStatus}'. Must be 'arrived'.`
            });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                dayOfStatus: 'in_progress',
                timerStartedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Lifecycle] Job ${id} status -> in_progress, timer started`);

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error starting timer:', error);
        res.status(500).json({ error: error.message || 'Failed to start timer' });
    }
});

// POST /api/jobs/:id/pause-timer — pause work timer (does NOT change dayOfStatus)
jobLifecycleRouter.post('/api/jobs/:id/pause-timer', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus !== 'in_progress') {
            return res.status(400).json({ error: 'Timer can only be paused when job is in_progress' });
        }

        if (!job.timerStartedAt) {
            return res.status(400).json({ error: 'Timer has not been started' });
        }

        if (job.timerPausedAt) {
            return res.status(400).json({ error: 'Timer is already paused' });
        }

        // Calculate elapsed seconds since timer was last started/resumed
        const elapsedMs = Date.now() - new Date(job.timerStartedAt).getTime();
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        const totalAccumulated = (job.timerAccumulatedSeconds || 0) + elapsedSeconds;

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                timerPausedAt: new Date(),
                timerAccumulatedSeconds: totalAccumulated,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Lifecycle] Job ${id} timer paused. Accumulated: ${totalAccumulated}s`);

        res.json({ success: true, job: updatedJob, accumulatedSeconds: totalAccumulated });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error pausing timer:', error);
        res.status(500).json({ error: error.message || 'Failed to pause timer' });
    }
});

// POST /api/jobs/:id/resume-timer — resume work timer after pause
jobLifecycleRouter.post('/api/jobs/:id/resume-timer', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus !== 'in_progress') {
            return res.status(400).json({ error: 'Timer can only be resumed when job is in_progress' });
        }

        if (!job.timerPausedAt) {
            return res.status(400).json({ error: 'Timer is not paused' });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                timerStartedAt: new Date(),
                timerPausedAt: null,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Lifecycle] Job ${id} timer resumed`);

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error resuming timer:', error);
        res.status(500).json({ error: error.message || 'Failed to resume timer' });
    }
});

// POST /api/jobs/:id/running-late — contractor notifies they're running late
jobLifecycleRouter.post('/api/jobs/:id/running-late', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;
        const { estimatedArrival, reason } = req.body;

        if (!estimatedArrival) {
            return res.status(400).json({ error: 'estimatedArrival is required' });
        }

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        // Does not change status — notification will be sent separately
        console.log(`[Job Lifecycle] Job ${id} contractor running late. ETA: ${estimatedArrival}. Reason: ${reason || 'not provided'}`);

        res.json({
            success: true,
            message: 'Running late notification recorded. Customer will be notified.',
            estimatedArrival,
            reason: reason || null,
        });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error reporting running late:', error);
        res.status(500).json({ error: error.message || 'Failed to report running late' });
    }
});

// POST /api/jobs/:id/report-access-issue — contractor reports access problem
jobLifecycleRouter.post('/api/jobs/:id/report-access-issue', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;
        const { type, description, evidenceUrls } = req.body;

        if (!type || !description) {
            return res.status(400).json({ error: 'type and description are required' });
        }

        if (type !== 'access_failed' && type !== 'customer_unreachable') {
            return res.status(400).json({ error: "type must be 'access_failed' or 'customer_unreachable'" });
        }

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        // Update job status
        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                dayOfStatus: type,
                customerAccessNotes: description,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        // Also log as an incident
        const [incident] = await db.insert(jobIncidents)
            .values({
                jobId: id,
                reportedByContractorId: contractorId,
                type: 'access_issue',
                description,
                evidenceUrls: evidenceUrls || [],
            })
            .returning();

        console.log(`[Job Lifecycle] Job ${id} access issue reported: ${type}`);

        res.json({ success: true, job: updatedJob, incident });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error reporting access issue:', error);
        res.status(500).json({ error: error.message || 'Failed to report access issue' });
    }
});

// POST /api/jobs/:id/cancel-day-of — cancel job on the day
jobLifecycleRouter.post('/api/jobs/:id/cancel-day-of', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'reason is required' });
        }

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus === 'completed' || job.dayOfStatus === 'cancelled_day_of') {
            return res.status(400).json({ error: `Cannot cancel job with status '${job.dayOfStatus}'` });
        }

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                dayOfStatus: 'cancelled_day_of',
                completionNotes: reason,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        console.log(`[Job Lifecycle] Job ${id} cancelled day-of. Reason: ${reason}`);

        res.json({ success: true, job: updatedJob });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error cancelling job:', error);
        res.status(500).json({ error: error.message || 'Failed to cancel job' });
    }
});

// ==========================================
// VARIATION ORDERS
// ==========================================

// POST /api/jobs/:id/variations — contractor creates a variation order
jobLifecycleRouter.post('/api/jobs/:id/variations', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;
        const {
            description,
            additionalPricePence,
            additionalTimeMins,
            materialsRequired,
            materialsCostPence,
            evidenceUrls,
        } = req.body;

        if (!description || additionalPricePence === undefined) {
            return res.status(400).json({ error: 'description and additionalPricePence are required' });
        }

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        const approvalToken = crypto.randomUUID();

        const [variation] = await db.insert(variationOrders)
            .values({
                jobId: id,
                requestedByContractorId: contractorId,
                description,
                additionalPricePence,
                additionalTimeMins: additionalTimeMins || null,
                materialsRequired: materialsRequired || null,
                materialsCostPence: materialsCostPence || 0,
                approvalToken,
                evidenceUrls: evidenceUrls || [],
            })
            .returning();

        console.log(`[Job Lifecycle] Variation order created for job ${id}. Token: ${approvalToken}`);

        // Notify customer about variation request (async, non-blocking)
        notifyCustomer({
            jobId: id,
            event: 'variation_request',
            data: {
                description,
                amountPence: additionalPricePence,
                approvalLink: `/api/public/variation/${approvalToken}/approve`,
            },
        }).catch(console.error);

        res.json({
            success: true,
            variation,
            approvalLink: `/api/public/variation/${approvalToken}/approve`,
        });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error creating variation order:', error);
        res.status(500).json({ error: error.message || 'Failed to create variation order' });
    }
});

// GET /api/jobs/:id/variations — list variation orders for a job
jobLifecycleRouter.get('/api/jobs/:id/variations', async (req, res) => {
    try {
        const { id } = req.params;

        const variations = await db.select()
            .from(variationOrders)
            .where(eq(variationOrders.jobId, id));

        res.json(variations);
    } catch (error: any) {
        console.error('[Job Lifecycle] Error fetching variations:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch variations' });
    }
});

// GET /api/public/variation/:token/approve — public approval page
jobLifecycleRouter.get('/api/public/variation/:token/approve', async (req, res) => {
    try {
        const { token } = req.params;

        const results = await db.select()
            .from(variationOrders)
            .where(eq(variationOrders.approvalToken, token))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Variation order not found' });
        }

        const variation = results[0];

        if (variation.status !== 'pending_approval') {
            return res.status(400).json({
                error: 'This variation has already been responded to',
                status: variation.status,
                respondedAt: variation.customerApprovalAt,
            });
        }

        // Return JSON for frontend consumption (or render simple HTML)
        const acceptHeader = req.headers.accept || '';
        if (acceptHeader.includes('text/html')) {
            const priceFormatted = `\u00a3${(variation.additionalPricePence / 100).toFixed(2)}`;
            const materialsFormatted = variation.materialsCostPence
                ? `\u00a3${(variation.materialsCostPence / 100).toFixed(2)}`
                : null;
            res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Approve Variation Order - Handy Services</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; color: #1a1a2e; }
        .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
        h1 { font-size: 1.25rem; margin-top: 0; }
        .price { font-size: 1.5rem; font-weight: 700; color: #1a1a2e; }
        .detail { color: #64748b; margin: 0.5rem 0; }
        .btn { display: block; width: 100%; padding: 0.75rem; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
        .btn-approve { background: #16a34a; color: white; }
        .btn-reject { background: #ef4444; color: white; }
        .btn:active { opacity: 0.8; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Additional Work Request</h1>
        <p>${variation.description}</p>
        <p class="price">${priceFormatted}</p>
        ${materialsFormatted ? `<p class="detail">Materials: ${materialsFormatted}</p>` : ''}
        ${variation.additionalTimeMins ? `<p class="detail">Estimated additional time: ${variation.additionalTimeMins} mins</p>` : ''}
    </div>
    <form method="POST" action="/api/public/variation/${token}/respond">
        <input type="hidden" name="action" value="approve" />
        <button type="submit" class="btn btn-approve">Approve</button>
    </form>
    <form method="POST" action="/api/public/variation/${token}/respond">
        <input type="hidden" name="action" value="reject" />
        <button type="submit" class="btn btn-reject">Reject</button>
    </form>
</body>
</html>`);
        } else {
            res.json({
                variation: {
                    id: variation.id,
                    description: variation.description,
                    additionalPricePence: variation.additionalPricePence,
                    additionalTimeMins: variation.additionalTimeMins,
                    materialsRequired: variation.materialsRequired,
                    materialsCostPence: variation.materialsCostPence,
                    evidenceUrls: variation.evidenceUrls,
                    status: variation.status,
                },
            });
        }
    } catch (error: any) {
        console.error('[Job Lifecycle] Error fetching variation for approval:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch variation' });
    }
});

// POST /api/public/variation/:token/respond — customer approves or rejects
jobLifecycleRouter.post('/api/public/variation/:token/respond', async (req, res) => {
    try {
        const { token } = req.params;
        const action = req.body.action;

        if (!action || (action !== 'approve' && action !== 'reject')) {
            return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
        }

        const results = await db.select()
            .from(variationOrders)
            .where(eq(variationOrders.approvalToken, token))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Variation order not found' });
        }

        const variation = results[0];

        if (variation.status !== 'pending_approval') {
            return res.status(400).json({
                error: 'This variation has already been responded to',
                status: variation.status,
            });
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        const [updatedVariation] = await db.update(variationOrders)
            .set({
                status: newStatus,
                customerApprovalAt: new Date(),
                customerApprovalMethod: 'link',
                updatedAt: new Date(),
            })
            .where(eq(variationOrders.id, variation.id))
            .returning();

        console.log(`[Job Lifecycle] Variation ${variation.id} ${newStatus} by customer via link`);

        // Check accept header for HTML response
        const acceptHeader = req.headers.accept || '';
        const contentType = req.headers['content-type'] || '';
        if (acceptHeader.includes('text/html') || contentType.includes('x-www-form-urlencoded')) {
            const message = action === 'approve'
                ? 'Additional work approved. Your contractor will proceed.'
                : 'Additional work declined. Your contractor has been notified.';
            res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Variation ${action === 'approve' ? 'Approved' : 'Rejected'} - Handy Services</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; text-align: center; color: #1a1a2e; }
        .icon { font-size: 3rem; margin: 1rem 0; }
        h1 { font-size: 1.25rem; }
    </style>
</head>
<body>
    <div class="icon">${action === 'approve' ? '\u2705' : '\u274c'}</div>
    <h1>${message}</h1>
</body>
</html>`);
        } else {
            res.json({ success: true, variation: updatedVariation });
        }
    } catch (error: any) {
        console.error('[Job Lifecycle] Error responding to variation:', error);
        res.status(500).json({ error: error.message || 'Failed to respond to variation' });
    }
});

// ==========================================
// INCIDENTS
// ==========================================

// POST /api/jobs/:id/incidents — log an incident
jobLifecycleRouter.post('/api/jobs/:id/incidents', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;
        const { type, description, evidenceUrls } = req.body;

        if (!type || !description) {
            return res.status(400).json({ error: 'type and description are required' });
        }

        const validTypes = ['damage', 'safety_issue', 'weather_delay', 'access_issue', 'other'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
        }

        // Verify contractor is assigned to this job
        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        const [incident] = await db.insert(jobIncidents)
            .values({
                jobId: id,
                reportedByContractorId: contractorId,
                type,
                description,
                evidenceUrls: evidenceUrls || [],
            })
            .returning();

        console.log(`[Job Lifecycle] Incident logged for job ${id}: ${type}`);

        res.json({ success: true, incident });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error logging incident:', error);
        res.status(500).json({ error: error.message || 'Failed to log incident' });
    }
});

// GET /api/jobs/:id/incidents — list incidents for a job
jobLifecycleRouter.get('/api/jobs/:id/incidents', async (req, res) => {
    try {
        const { id } = req.params;

        const incidents = await db.select()
            .from(jobIncidents)
            .where(eq(jobIncidents.jobId, id));

        res.json(incidents);
    } catch (error: any) {
        console.error('[Job Lifecycle] Error fetching incidents:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch incidents' });
    }
});

// ==========================================
// JOB COMPLETION (Enhanced)
// ==========================================

// POST /api/jobs/:id/complete — enhanced job completion with payout calculation
jobLifecycleRouter.post('/api/jobs/:id/complete', requireContractor, async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = (req as any).contractorId;
        const {
            evidenceUrls,
            completionNotes,
            completionType,
            lineItemStatuses,
            customerDeclinedSignature,
            customerDeclinedSignatureReason,
            signatureDataUrl,
        } = req.body;

        if (!completionType || (completionType !== 'full' && completionType !== 'partial')) {
            return res.status(400).json({ error: "completionType must be 'full' or 'partial'" });
        }

        const { error, status, job } = await fetchJobForContractor(id, contractorId);
        if (error || !job) return res.status(status).json({ error });

        if (job.dayOfStatus === 'completed') {
            return res.status(400).json({ error: 'Job is already completed' });
        }

        // Guard: job must have progressed to at least in_progress before completion
        const completableStatuses = ['in_progress', 'access_failed', 'customer_unreachable'];
        if (!completableStatuses.includes(job.dayOfStatus || '')) {
            return res.status(400).json({
                error: `Cannot complete job from status '${job.dayOfStatus}'. Job must be in_progress (or have an access issue reported).`
            });
        }

        // Calculate final timer accumulated seconds
        let finalAccumulated = job.timerAccumulatedSeconds || 0;
        if (job.timerStartedAt && !job.timerPausedAt) {
            // Timer is still running — add elapsed since last start
            const elapsedMs = Date.now() - new Date(job.timerStartedAt).getTime();
            finalAccumulated += Math.floor(elapsedMs / 1000);
        }

        // Payout scheduled 24 hours from now
        const payoutScheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // Update the job
        const updateData: any = {
            dayOfStatus: 'completed',
            status: 'completed',
            assignmentStatus: 'completed',
            completedAt: new Date(),
            completionType,
            timerAccumulatedSeconds: finalAccumulated,
            timerPausedAt: job.timerPausedAt || (job.timerStartedAt ? new Date() : null),
            payoutScheduledAt,
            updatedAt: new Date(),
        };

        if (evidenceUrls && Array.isArray(evidenceUrls)) {
            updateData.evidenceUrls = evidenceUrls;
        }
        if (completionNotes) {
            updateData.completionNotes = completionNotes;
        }
        if (signatureDataUrl) {
            updateData.signatureDataUrl = signatureDataUrl;
        }
        if (customerDeclinedSignature !== undefined) {
            updateData.customerDeclinedSignature = customerDeclinedSignature;
        }
        if (customerDeclinedSignatureReason) {
            updateData.customerDeclinedSignatureReason = customerDeclinedSignatureReason;
        }
        updateData.timeOnJobSeconds = finalAccumulated;

        const [updatedJob] = await db.update(contractorBookingRequests)
            .set(updateData)
            .where(eq(contractorBookingRequests.id, id))
            .returning();

        // Update job sheet line item statuses if provided
        if (lineItemStatuses && typeof lineItemStatuses === 'object') {
            const jobSheetResults = await db.select()
                .from(jobSheets)
                .where(eq(jobSheets.jobId, id))
                .limit(1);

            if (jobSheetResults.length > 0) {
                const sheet = jobSheetResults[0];
                const lineItems = (sheet.lineItems as any[]) || [];

                // Update each line item status by index
                for (const [indexStr, newStatus] of Object.entries(lineItemStatuses)) {
                    const idx = parseInt(indexStr, 10);
                    if (idx >= 0 && idx < lineItems.length) {
                        lineItems[idx].status = newStatus;
                    }
                }

                await db.update(jobSheets)
                    .set({ lineItems, updatedAt: new Date() })
                    .where(eq(jobSheets.id, sheet.id));
            }
        }

        // Calculate payout amount
        let basePayoutPence = 0;
        let variationAmountPence = 0;

        // Sum contractor rates from job sheet line items (completed items only)
        const jobSheetResults = await db.select()
            .from(jobSheets)
            .where(eq(jobSheets.jobId, id))
            .limit(1);

        if (jobSheetResults.length > 0) {
            const lineItems = (jobSheetResults[0].lineItems as any[]) || [];
            for (const item of lineItems) {
                // Include items that are completed (or all if full completion and no explicit statuses)
                const itemStatus = item.status || 'completed';
                if (itemStatus === 'completed' && item.contractorRatePence) {
                    basePayoutPence += item.contractorRatePence;
                }
            }
        }

        // If no job sheet line items found, try to look up rate from wtbp_rate_card
        if (basePayoutPence === 0) {
            // Fallback: query rate card for a general rate
            const rates = await db.select()
                .from(wtbpRateCard)
                .where(and(
                    eq(wtbpRateCard.categorySlug, 'general'),
                    isNull(wtbpRateCard.effectiveTo),
                ))
                .limit(1);

            if (rates.length > 0) {
                // Use hourly rate * time worked
                const hourlyRatePence = rates[0].ratePence;
                const hoursWorked = finalAccumulated / 3600;
                basePayoutPence = Math.round(hourlyRatePence * hoursWorked);
            }
        }

        // Sum approved variation orders
        const approvedVariations = await db.select()
            .from(variationOrders)
            .where(and(
                eq(variationOrders.jobId, id),
                eq(variationOrders.status, 'approved'),
            ));

        for (const v of approvedVariations) {
            variationAmountPence += v.additionalPricePence;
        }

        const grossAmountPence = basePayoutPence + variationAmountPence;
        // Platform fee: 20% of gross
        const platformFeePence = Math.round(grossAmountPence * 0.20);
        const netPayoutPence = grossAmountPence - platformFeePence;

        // Create contractor payout record
        let payoutRecord = null;
        if (grossAmountPence > 0) {
            const [payout] = await db.insert(contractorPayouts)
                .values({
                    jobId: id,
                    contractorId: contractorId,
                    quoteId: job.quoteId || null,
                    grossAmountPence,
                    platformFeePence,
                    netPayoutPence,
                    variationAmountPence,
                    status: 'pending',
                    scheduledPayoutAt: payoutScheduledAt,
                })
                .returning();

            payoutRecord = payout;
        }

        console.log(`[Job Lifecycle] Job ${id} completed (${completionType}). Timer: ${finalAccumulated}s. Payout: ${netPayoutPence}p scheduled for ${payoutScheduledAt.toISOString()}`);

        // Generate balance invoice (async, non-blocking — fire and forget with error logging)
        generateBalanceInvoice(id).catch((err) => {
            console.error(`[Job Lifecycle] Failed to generate balance invoice for job ${id}:`, err);
        });

        // Notify customer (async, non-blocking)
        notifyCustomer({ jobId: id, event: 'job_completed' }).catch(console.error);

        res.json({
            success: true,
            job: updatedJob,
            payout: payoutRecord,
            summary: {
                totalTimeSeconds: finalAccumulated,
                basePayoutPence,
                variationAmountPence,
                grossAmountPence,
                platformFeePence,
                netPayoutPence,
                payoutScheduledAt: payoutScheduledAt.toISOString(),
            },
        });
    } catch (error: any) {
        console.error('[Job Lifecycle] Error completing job:', error);
        res.status(500).json({ error: error.message || 'Failed to complete job' });
    }
});

export default jobLifecycleRouter;
