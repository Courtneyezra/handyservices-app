/**
 * Pipeline actions — extracted, directly-callable functions for the core
 * order-to-cash pipeline. These are the future agent "tool belt": each one is
 * a plain async function with no Express coupling, so routes, scripts, and
 * (later) agents all drive the exact same logic.
 *
 * Actions:
 *   - assignJobToContractor  — extracted verbatim from job-assignment.ts POST /api/jobs/:id/assign
 *   - completeJob            — thin wrapper over job-lifecycle's finalizeJobCompletion
 *   - generateInvoiceForJob  — wraps invoice-generator's generateBalanceInvoice
 *   - bookQuoteAsJob         — creates the canonical contractor_booking_requests row for a quote booking
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import {
    contractorBookingRequests,
    contractorAvailabilityDates,
    handymanAvailability,
    handymanProfiles,
    personalizedQuotes,
    users,
} from '@shared/schema';
import { sendJobAssignmentEmail } from '../email-service';
import { pushToUser } from '../web-push';
import { finalizeJobCompletion } from '../job-lifecycle';
import { generateBalanceInvoice } from '../invoice-generator';

// ==========================================
// assignJobToContractor
// ==========================================

export interface AssignJobInput {
    jobId: string;
    contractorId: string;
    scheduledDate: string | Date;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
}

export type AssignJobResult =
    | { ok: true; job: any; message: string }
    | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Assign a dispatch-pool job (contractor_booking_requests row) to a contractor,
 * validating availability and conflicts. Extracted from the
 * POST /api/jobs/:id/assign route body — behaviour is identical; the route now
 * delegates here. Error cases return { ok: false, status, body } so the HTTP
 * handler can mirror the original status codes and payloads exactly.
 */
export async function assignJobToContractor(input: AssignJobInput): Promise<AssignJobResult> {
    const { jobId, contractorId, scheduledDate, scheduledStartTime, scheduledEndTime } = input;

    if (!contractorId || !scheduledDate) {
        return { ok: false, status: 400, body: { error: 'contractorId and scheduledDate are required' } };
    }

    // Fetch the job
    const jobResults = await db.select()
        .from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, jobId))
        .limit(1);

    if (jobResults.length === 0) {
        return { ok: false, status: 404, body: { error: 'Job not found' } };
    }

    const job = jobResults[0];

    // Check if job is already assigned
    if (job.assignmentStatus === 'accepted' || job.assignmentStatus === 'in_progress') {
        return { ok: false, status: 400, body: { error: 'Job is already assigned and accepted' } };
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
        return {
            ok: false,
            status: 400,
            body: {
                error: 'Contractor is not available on the selected date',
                availabilityCheck: {
                    date: scheduledDate,
                    isAvailable: false
                }
            }
        };
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
        return {
            ok: false,
            status: 400,
            body: {
                error: 'Contractor has conflicting jobs on this date',
                conflicts: conflicts.map(c => ({
                    id: c.id,
                    customerName: c.customerName,
                    scheduledTime: `${c.scheduledStartTime} - ${c.scheduledEndTime}`
                }))
            }
        };
    }

    // Assign the job. scheduled_dates MUST track scheduled_date — readers
    // trust that jsonb array (timezone-immune) over the timestamp; a bare
    // timestamp write strands the array on the old day and hides the job.
    const { expandSpanDates } = await import('../../shared/schedule-composition');
    const newDateStr = (typeof scheduledDate === 'string' ? scheduledDate : new Date(scheduledDate).toISOString()).slice(0, 10);
    const [updatedJob] = await db.update(contractorBookingRequests)
        .set({
            assignedContractorId: contractorId,
            scheduledDate: targetDate,
            scheduledDates: expandSpanDates(newDateStr, job.durationDays, null),
            scheduledStartTime: scheduledStartTime || availableStartTime,
            scheduledEndTime: scheduledEndTime || availableEndTime,
            assignedAt: new Date(),
            assignmentStatus: 'assigned',
            updatedAt: new Date()
        })
        .where(eq(contractorBookingRequests.id, jobId))
        .returning();

    // Send notification to contractor (async/non-blocking)
    console.log(`[Job Assignment] Job ${jobId} assigned to contractor ${contractorId} for ${scheduledDate}`);

    // Fetch contractor details for email notification
    (async () => {
        try {
            const contractorData = await db.select({
                userId: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
            })
            .from(handymanProfiles)
            .innerJoin(users, eq(handymanProfiles.userId, users.id))
            .where(eq(handymanProfiles.id, contractorId))
            .limit(1);

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

            // Web push to the contractor's device — fire-and-forget, never rejects
            if (contractorData.length > 0 && contractorData[0].userId) {
                void pushToUser(contractorData[0].userId, {
                    title: '🔨 New job assigned',
                    body: `${updatedJob.customerName || 'Customer'} — ${newDateStr}${address ? ` · ${address}` : ''}`,
                    url: `/contractor/dashboard/jobs/${updatedJob.id}`,
                });
            }

            if (contractorData.length > 0 && contractorData[0].email) {
                const contractor = contractorData[0];
                const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

                await sendJobAssignmentEmail({
                    contractorName,
                    contractorEmail: contractor.email,
                    customerName: updatedJob.customerName || 'Customer',
                    address,
                    jobDescription: updatedJob.description || '',
                    scheduledDate: typeof scheduledDate === 'string' ? scheduledDate : newDateStr,
                    scheduledStartTime: updatedJob.scheduledStartTime || undefined,
                    scheduledEndTime: updatedJob.scheduledEndTime || undefined,
                    jobId,
                });
            } else {
                console.log(`[Job Assignment] No email found for contractor ${contractorId}`);
            }
        } catch (emailError) {
            console.error('[Job Assignment] Failed to send assignment email:', emailError);
        }
    })();

    return {
        ok: true,
        job: updatedJob,
        message: 'Job assigned successfully. Contractor will be notified.'
    };
}

// ==========================================
// completeJob
// ==========================================

export interface CompleteJobOptions {
    completionType?: 'full' | 'partial';
    evidenceUrls?: string[];
    completionNotes?: string;
    lineItemStatuses?: Record<string, string> | null;
    customerDeclinedSignature?: boolean;
    customerDeclinedSignatureReason?: string;
    signatureDataUrl?: string;
}

export type CompleteJobResult =
    | { ok: true; job: any; payout: any; summary: any }
    | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Complete a job by id — thin wrapper over job-lifecycle's
 * finalizeJobCompletion (the single completion spine: CBR completion write,
 * quote/lead roll-up, payout insert, balance invoice + customer notify).
 * Fetches + guards the row, then delegates. `contractorId` may be '' for a
 * never-dispatched job — finalizeJobCompletion skips the payout in that case.
 */
export async function completeJob(
    jobId: string,
    contractorId: string | null | undefined,
    opts: CompleteJobOptions = {},
): Promise<CompleteJobResult> {
    const results = await db.select()
        .from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, jobId))
        .limit(1);

    const job = results[0];
    if (!job) {
        return { ok: false, status: 404, body: { error: 'Job not found' } };
    }
    if (job.dayOfStatus === 'completed' || job.status === 'completed') {
        return { ok: false, status: 400, body: { error: 'Job is already completed' } };
    }

    const attributedContractorId = contractorId || job.assignedContractorId || '';

    const result = await finalizeJobCompletion(job, attributedContractorId, {
        completionType: opts.completionType || 'full',
        evidenceUrls: opts.evidenceUrls,
        completionNotes: opts.completionNotes,
        lineItemStatuses: opts.lineItemStatuses,
        customerDeclinedSignature: opts.customerDeclinedSignature,
        customerDeclinedSignatureReason: opts.customerDeclinedSignatureReason,
        signatureDataUrl: opts.signatureDataUrl,
    });

    return { ok: true, ...result };
}

// ==========================================
// generateInvoiceForJob
// ==========================================

/**
 * Generate (or fetch) the balance invoice for a completed job. Wraps the
 * existing invoice-generator entry point — no new invoice logic here.
 * Returns null when the job has nothing to invoice (see generateBalanceInvoice).
 */
export async function generateInvoiceForJob(jobId: string): Promise<Awaited<ReturnType<typeof generateBalanceInvoice>>> {
    return generateBalanceInvoice(jobId);
}

// ==========================================
// bookQuoteAsJob
// ==========================================

export interface BookQuoteAsJobInput {
    quote: {
        id: string;
        customerName: string;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        postcode?: string | null;
        jobDescription?: string | null;
        contractorId?: string | null;
        propertyId?: string | null;
        clientId?: string | null;
    };
    /** Customer-selected date (YYYY-MM-DD string or Date). Optional — pool jobs may be dateless. */
    scheduledDate?: string | Date | null;
    /** e.g. 'am' | 'pm' | 'morning' — stored on requestedSlot as free text. */
    requestedSlot?: string | null;
    /** Pay-cash-on-the-day booking — flagged with a [CASH] description marker
     *  (same marker convention the cash invoice uses in its notes). */
    isCash?: boolean;
    /** Link the already-created invoice row, if any. */
    invoiceId?: string | null;
    propertyId?: string | null;
    clientId?: string | null;
}

export type BookQuoteAsJobResult =
    | { ok: true; bookingId: string; booking: any }
    | { ok: false; error: string };

/**
 * Create the canonical dispatch-pool job (contractor_booking_requests row) for
 * a quote booking. Mirrors how paid card bookings materialise CBRs
 * (booking-engine confirmBooking): quote-linked, status 'pending',
 * assignmentStatus 'unassigned' so it surfaces in the admin dispatch board for
 * assignment via assignJobToContractor.
 *
 * contractorId is NOT NULL on the table, so like live-call-actions we use the
 * quote's contractor when set, else the first public contractor as a
 * placeholder (assignmentStatus 'unassigned' is what the dispatch pool keys
 * on, not contractorId).
 */
export async function bookQuoteAsJob(input: BookQuoteAsJobInput): Promise<BookQuoteAsJobResult> {
    const { quote } = input;

    // Resolve a contractorId to satisfy the NOT NULL FK. Placeholder only —
    // real assignment happens later through assignJobToContractor.
    let contractorId = quote.contractorId || null;
    if (!contractorId) {
        const placeholder = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.publicProfileEnabled, true),
            columns: { id: true },
        });
        contractorId = placeholder?.id || null;
    }
    if (!contractorId) {
        return { ok: false, error: 'No contractor profile available to anchor the booking (contractor_id is NOT NULL)' };
    }

    const bookingId = uuidv4();

    // Normalise the scheduled date once; keep the timestamp + jsonb dates in
    // lockstep. scheduled_dates MUST track scheduled_date — readers trust the
    // jsonb array (timezone-immune) over the timestamp (see job-assignment).
    let scheduledDate: Date | null = null;
    let scheduledDates: string[] | null = null;
    if (input.scheduledDate) {
        const dateStr = (typeof input.scheduledDate === 'string'
            ? input.scheduledDate
            : new Date(input.scheduledDate).toISOString()).slice(0, 10);
        scheduledDate = new Date(dateStr);
        const { expandSpanDates } = await import('../../shared/schedule-composition');
        scheduledDates = expandSpanDates(dateStr, 1, null);
    }

    const description = `${input.isCash ? '[CASH] ' : ''}${quote.jobDescription || ''}`.trim();

    const [booking] = await db.insert(contractorBookingRequests).values({
        id: bookingId,
        contractorId,
        customerName: quote.customerName,
        customerEmail: quote.email || undefined,
        customerPhone: quote.phone || undefined,
        quoteId: quote.id,
        propertyId: input.propertyId ?? quote.propertyId ?? undefined,
        clientId: input.clientId ?? quote.clientId ?? undefined,
        requestedDate: scheduledDate,
        requestedSlot: input.requestedSlot || null,
        description,
        status: 'pending',              // enters the dispatch pool
        assignmentStatus: 'unassigned', // dispatch board keys on this
        scheduledDate,
        scheduledDates,
        invoiceId: input.invoiceId || undefined,
    }).returning();

    console.log(`[Pipeline] bookQuoteAsJob — CBR ${bookingId} created for quote ${quote.id}${input.isCash ? ' (cash-on-the-day)' : ''}`);

    return { ok: true, bookingId, booking };
}
