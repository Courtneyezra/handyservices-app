import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from './db';
import {
    disputes,
    creditNotes,
    personalizedQuotes,
    contractorBookingRequests,
    contractorPayouts,
    handymanProfiles,
    invoices,
} from '../shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { requireAdmin } from './auth';
import { requireContractorAuth } from './contractor-auth';

export const disputeRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const getStripe = () => {
    const key = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
    if (!key || !key.startsWith('sk_')) return null;
    return new Stripe(key);
};

/** Map dispute type to default priority */
function priorityForType(type: string): string {
    switch (type) {
        case 'damage':
        case 'no_show':
            return 'high';
        case 'quality':
        case 'incomplete':
        case 'overcharge':
            return 'medium';
        default:
            return 'low';
    }
}

/**
 * After a dispute is created, hold any pending payouts for the same job.
 */
async function holdPendingPayoutsForJob(jobId: number | null) {
    if (!jobId) return;
    try {
        await db
            .update(contractorPayouts)
            .set({
                status: 'held',
                heldReason: 'dispute_open',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(contractorPayouts.jobId, jobId),
                    eq(contractorPayouts.status, 'pending'),
                ),
            );
        console.log(`[Disputes] Held pending payouts for jobId=${jobId}`);
    } catch (err) {
        console.error('[Disputes] Failed to hold payouts:', err);
    }
}

// ─── Customer-facing routes ─────────────────────────────────────────────────

/**
 * POST /api/public/disputes — customer creates a dispute
 */
disputeRouter.post('/api/public/disputes', async (req: Request, res: Response) => {
    try {
        const { quoteId, type, description, evidenceUrls, disputedLineItems } = req.body;

        if (!quoteId || !type || !description) {
            return res.status(400).json({ error: 'quoteId, type, and description are required' });
        }

        // Look up the quote
        const quote = await db.query.personalizedQuotes.findFirst({
            where: eq(personalizedQuotes.id, quoteId),
        });
        if (!quote) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        // Look up the job from the quote
        const job = await db.query.contractorBookingRequests.findFirst({
            where: eq(contractorBookingRequests.quoteId, quoteId),
        });

        // Look up the invoice
        const invoice = await db.query.invoices.findFirst({
            where: eq(invoices.quoteId, quoteId),
        });

        const priority = priorityForType(type);
        const jobId = job?.id || null;
        const contractorId = job?.assignedContractorId
            || quote.contractorId
            || null;

        const [dispute] = await db.insert(disputes).values({
            jobId,
            invoiceId: invoice?.id || null,
            quoteId,
            contractorId,
            customerName: quote.customerName,
            customerPhone: quote.phone,
            customerEmail: quote.email || null,
            type,
            status: 'open',
            priority,
            customerDescription: description,
            customerEvidenceUrls: evidenceUrls || [],
            disputedLineItems: disputedLineItems || null,
        }).returning();

        // Hold any pending payouts for this job
        await holdPendingPayoutsForJob(jobId);

        console.log(`[Disputes] Created dispute #${dispute.id} for quote ${quoteId}, type=${type}, priority=${priority}`);
        res.status(201).json(dispute);
    } catch (err: any) {
        console.error('[Disputes] Create error:', err);
        res.status(500).json({ error: 'Failed to create dispute' });
    }
});

/**
 * GET /api/public/disputes/:id — customer views their dispute (validated by quoteId)
 */
disputeRouter.get('/api/public/disputes/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { quoteId } = req.query;

        if (!quoteId) {
            return res.status(400).json({ error: 'quoteId query parameter required for verification' });
        }

        const dispute = await db.query.disputes.findFirst({
            where: and(
                eq(disputes.id, parseInt(id, 10)),
                eq(disputes.quoteId, quoteId as string),
            ),
        });

        if (!dispute) {
            return res.status(404).json({ error: 'Dispute not found' });
        }

        // Return customer-safe view (exclude contractor response details for open disputes)
        res.json({
            id: dispute.id,
            type: dispute.type,
            status: dispute.status,
            priority: dispute.priority,
            customerDescription: dispute.customerDescription,
            customerEvidenceUrls: dispute.customerEvidenceUrls,
            resolution: dispute.resolution,
            resolutionNotes: dispute.resolutionNotes,
            refundAmountPence: dispute.refundAmountPence,
            createdAt: dispute.createdAt,
            resolvedAt: dispute.resolvedAt,
        });
    } catch (err: any) {
        console.error('[Disputes] Customer view error:', err);
        res.status(500).json({ error: 'Failed to fetch dispute' });
    }
});

// ─── Contractor-facing routes ───────────────────────────────────────────────

/**
 * GET /api/contractor/disputes — list disputes against the authenticated contractor
 */
disputeRouter.get('/api/contractor/disputes', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
        });
        if (!profile) return res.status(404).json({ error: 'Contractor profile not found' });

        const result = await db
            .select()
            .from(disputes)
            .where(eq(disputes.contractorId, profile.id))
            .orderBy(desc(disputes.createdAt));

        res.json(result);
    } catch (err: any) {
        console.error('[Disputes] Contractor list error:', err);
        res.status(500).json({ error: 'Failed to fetch disputes' });
    }
});

/**
 * POST /api/contractor/disputes/:id/respond — contractor submits response + evidence
 */
disputeRouter.post('/api/contractor/disputes/:id/respond', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { response, evidenceUrls } = req.body;
        const contractor = (req as any).contractor;

        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
        });
        if (!profile) return res.status(404).json({ error: 'Contractor profile not found' });

        const dispute = await db.query.disputes.findFirst({
            where: and(
                eq(disputes.id, parseInt(id, 10)),
                eq(disputes.contractorId, profile.id),
            ),
        });
        if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

        const [updated] = await db
            .update(disputes)
            .set({
                contractorResponse: response,
                contractorEvidenceUrls: evidenceUrls || [],
                status: 'investigating',
                updatedAt: new Date(),
            })
            .where(eq(disputes.id, parseInt(id, 10)))
            .returning();

        console.log(`[Disputes] Contractor responded to dispute #${id}`);
        res.json(updated);
    } catch (err: any) {
        console.error('[Disputes] Contractor respond error:', err);
        res.status(500).json({ error: 'Failed to submit response' });
    }
});

// ─── Admin routes ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/disputes — list all disputes with filters
 */
disputeRouter.get('/api/admin/disputes', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { status, priority, type } = req.query;

        const conditions: any[] = [];
        if (status) conditions.push(eq(disputes.status, status as any));
        if (priority) conditions.push(eq(disputes.priority, priority as string));
        if (type) conditions.push(eq(disputes.type, type as any));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Join with booking requests and handyman profiles for display names
        const result = await db
            .select({
                id: disputes.id,
                jobId: disputes.jobId,
                quoteId: disputes.quoteId,
                contractorId: disputes.contractorId,
                customerName: disputes.customerName,
                customerPhone: disputes.customerPhone,
                customerEmail: disputes.customerEmail,
                type: disputes.type,
                status: disputes.status,
                priority: disputes.priority,
                customerDescription: disputes.customerDescription,
                resolution: disputes.resolution,
                resolutionNotes: disputes.resolutionNotes,
                refundAmountPence: disputes.refundAmountPence,
                contractorPenaltyApplied: disputes.contractorPenaltyApplied,
                escalatedAt: disputes.escalatedAt,
                escalatedTo: disputes.escalatedTo,
                createdAt: disputes.createdAt,
                updatedAt: disputes.updatedAt,
                resolvedAt: disputes.resolvedAt,
                // Joined fields
                jobDate: contractorBookingRequests.scheduledDate,
                contractorName: handymanProfiles.businessName,
            })
            .from(disputes)
            .leftJoin(
                contractorBookingRequests,
                eq(disputes.jobId, contractorBookingRequests.id),
            )
            .leftJoin(
                handymanProfiles,
                eq(disputes.contractorId, handymanProfiles.id),
            )
            .where(whereClause)
            .orderBy(desc(disputes.createdAt));

        res.json(result);
    } catch (err: any) {
        console.error('[Disputes] Admin list error:', err);
        res.status(500).json({ error: 'Failed to fetch disputes' });
    }
});

/**
 * GET /api/admin/disputes/:id — full dispute detail
 */
disputeRouter.get('/api/admin/disputes/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const [result] = await db
            .select({
                // All dispute fields
                id: disputes.id,
                jobId: disputes.jobId,
                invoiceId: disputes.invoiceId,
                quoteId: disputes.quoteId,
                contractorId: disputes.contractorId,
                customerName: disputes.customerName,
                customerPhone: disputes.customerPhone,
                customerEmail: disputes.customerEmail,
                type: disputes.type,
                status: disputes.status,
                priority: disputes.priority,
                customerDescription: disputes.customerDescription,
                customerEvidenceUrls: disputes.customerEvidenceUrls,
                contractorResponse: disputes.contractorResponse,
                contractorEvidenceUrls: disputes.contractorEvidenceUrls,
                disputedLineItems: disputes.disputedLineItems,
                resolution: disputes.resolution,
                resolutionNotes: disputes.resolutionNotes,
                resolvedBy: disputes.resolvedBy,
                resolvedAt: disputes.resolvedAt,
                refundAmountPence: disputes.refundAmountPence,
                refundStripeRefundId: disputes.refundStripeRefundId,
                returnVisitJobId: disputes.returnVisitJobId,
                insuranceClaimRef: disputes.insuranceClaimRef,
                contractorPenaltyApplied: disputes.contractorPenaltyApplied,
                payoutReversalId: disputes.payoutReversalId,
                escalatedAt: disputes.escalatedAt,
                escalatedTo: disputes.escalatedTo,
                createdAt: disputes.createdAt,
                updatedAt: disputes.updatedAt,
                // Joined fields
                jobDate: contractorBookingRequests.scheduledDate,
                jobDescription: contractorBookingRequests.description,
                contractorName: handymanProfiles.businessName,
                invoiceNumber: invoices.invoiceNumber,
                invoiceTotalAmount: invoices.totalAmount,
                invoiceStripePaymentIntentId: invoices.stripePaymentIntentId,
            })
            .from(disputes)
            .leftJoin(
                contractorBookingRequests,
                eq(disputes.jobId, contractorBookingRequests.id),
            )
            .leftJoin(
                handymanProfiles,
                eq(disputes.contractorId, handymanProfiles.id),
            )
            .leftJoin(
                invoices,
                eq(disputes.invoiceId, invoices.id),
            )
            .where(eq(disputes.id, parseInt(id, 10)));

        if (!result) {
            return res.status(404).json({ error: 'Dispute not found' });
        }

        res.json(result);
    } catch (err: any) {
        console.error('[Disputes] Admin detail error:', err);
        res.status(500).json({ error: 'Failed to fetch dispute' });
    }
});

/**
 * POST /api/admin/disputes/:id/resolve — resolve a dispute
 */
disputeRouter.post('/api/admin/disputes/:id/resolve', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { resolution, resolutionNotes, refundAmountPence, contractorPenaltyApplied } = req.body;
        const adminUser = (req as any).adminUser;

        if (!resolution) {
            return res.status(400).json({ error: 'resolution is required' });
        }

        const dispute = await db.query.disputes.findFirst({
            where: eq(disputes.id, parseInt(id, 10)),
        });
        if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

        const updateData: any = {
            resolution,
            resolutionNotes: resolutionNotes || null,
            resolvedBy: adminUser?.email || adminUser?.name || 'admin',
            resolvedAt: new Date(),
            status: 'resolved',
            contractorPenaltyApplied: contractorPenaltyApplied || false,
            updatedAt: new Date(),
        };

        // Handle resolution-specific logic
        switch (resolution) {
            case 'refund_full':
            case 'refund_partial': {
                const stripe = getStripe();
                if (!stripe) {
                    return res.status(500).json({ error: 'Stripe not configured' });
                }

                // Find the payment intent from invoice or quote
                let paymentIntentId: string | null = null;
                let invoiceRecord: any = null;

                // Look up invoice by invoiceId or quoteId
                if (dispute.invoiceId) {
                    invoiceRecord = await db.query.invoices.findFirst({
                        where: eq(invoices.id, dispute.invoiceId),
                    });
                    paymentIntentId = invoiceRecord?.stripePaymentIntentId || null;
                } else if (dispute.quoteId) {
                    invoiceRecord = await db.query.invoices.findFirst({
                        where: eq(invoices.quoteId, dispute.quoteId),
                    });
                    paymentIntentId = invoiceRecord?.stripePaymentIntentId || null;
                }

                // Fallback: check quote for payment intent
                if (!paymentIntentId && dispute.quoteId) {
                    const quote = await db.query.personalizedQuotes.findFirst({
                        where: eq(personalizedQuotes.id, dispute.quoteId),
                    });
                    paymentIntentId = (quote as any)?.stripePaymentIntentId || null;
                }

                if (!paymentIntentId) {
                    return res.status(400).json({ error: 'No Stripe payment found for this dispute. Manual refund required.' });
                }

                // Determine refund amount
                const amountToRefund = resolution === 'refund_full'
                    ? undefined // Stripe refunds full amount if not specified
                    : refundAmountPence;

                if (resolution === 'refund_partial' && !refundAmountPence) {
                    return res.status(400).json({ error: 'refundAmountPence required for partial refund' });
                }

                // Create Stripe refund
                const refundParams: Stripe.RefundCreateParams = {
                    payment_intent: paymentIntentId,
                };
                if (amountToRefund) {
                    refundParams.amount = amountToRefund;
                }

                const refund = await stripe.refunds.create(refundParams);
                console.log(`[Disputes] Stripe refund created: ${refund.id}, amount=${refund.amount}`);

                updateData.refundAmountPence = refund.amount;
                updateData.refundStripeRefundId = refund.id;

                // Create credit note linked to the invoice
                if (invoiceRecord) {
                    await db.insert(creditNotes).values({
                        invoiceId: invoiceRecord.id,
                        reason: `Dispute #${dispute.id} - ${resolution === 'refund_full' ? 'Full refund' : 'Partial refund'}`,
                        amountPence: refund.amount,
                        lineItems: dispute.disputedLineItems || null,
                        issuedBy: updateData.resolvedBy,
                        refundStripePaymentIntentId: paymentIntentId,
                    });
                    console.log(`[Disputes] Credit note created for invoice ${invoiceRecord.invoiceNumber}`);
                }

                // If payout already made, reverse it
                if (dispute.jobId) {
                    const payout = await db.query.contractorPayouts.findFirst({
                        where: and(
                            eq(contractorPayouts.jobId, dispute.jobId),
                            eq(contractorPayouts.status, 'paid'),
                        ),
                    });

                    if (payout && payout.stripeTransferId) {
                        try {
                            const reversal = await stripe.transfers.createReversal(
                                payout.stripeTransferId,
                                { amount: resolution === 'refund_full' ? undefined : refundAmountPence },
                            );
                            await db
                                .update(contractorPayouts)
                                .set({
                                    status: 'reversed',
                                    reversedAt: new Date(),
                                    reversalReason: `Dispute #${dispute.id} resolved: ${resolution}`,
                                    stripeReversalId: reversal.id,
                                    updatedAt: new Date(),
                                })
                                .where(eq(contractorPayouts.id, payout.id));
                            updateData.payoutReversalId = payout.id;
                            console.log(`[Disputes] Payout ${payout.id} reversed: ${reversal.id}`);
                        } catch (reversalErr: any) {
                            console.error('[Disputes] Payout reversal failed:', reversalErr.message);
                            // Non-blocking — refund still went through
                        }
                    }
                }
                break;
            }

            case 'return_visit': {
                // Create a new booking request linked to the original job
                if (dispute.quoteId) {
                    const quote = await db.query.personalizedQuotes.findFirst({
                        where: eq(personalizedQuotes.id, dispute.quoteId),
                    });
                    if (quote) {
                        const jobIdStr = `return-${dispute.id}-${Date.now()}`;
                        const [newJob] = await db.insert(contractorBookingRequests).values({
                            id: jobIdStr,
                            contractorId: dispute.contractorId?.toString() || quote.contractorId || '',
                            customerName: quote.customerName,
                            customerEmail: quote.email || undefined,
                            customerPhone: quote.phone,
                            description: `RETURN VISIT - Dispute #${dispute.id}: ${dispute.customerDescription}`,
                            quoteId: dispute.quoteId,
                            status: 'pending',
                            assignmentStatus: 'unassigned',
                        }).returning();
                        updateData.returnVisitJobId = newJob.id;
                        console.log(`[Disputes] Return visit job created: ${newJob.id}`);
                    }
                }
                break;
            }

            case 'insurance_claim': {
                updateData.insuranceClaimRef = `IC-${dispute.id}-${Date.now()}`;
                console.log(`[Disputes] Insurance claim flagged: ${updateData.insuranceClaimRef}`);
                break;
            }

            case 'no_action': {
                // Just close it
                console.log(`[Disputes] Dispute #${id} resolved with no action`);
                break;
            }
        }

        // Release held payouts for resolutions that don't penalize the contractor financially
        const releasePayoutResolutions = ['no_action', 'return_visit', 'insurance_claim'];
        if (releasePayoutResolutions.includes(resolution) && dispute.jobId) {
            await db
                .update(contractorPayouts)
                .set({
                    status: 'pending',
                    heldReason: null,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(contractorPayouts.jobId, dispute.jobId),
                        eq(contractorPayouts.status, 'held'),
                    ),
                );
        }

        const [updated] = await db
            .update(disputes)
            .set(updateData)
            .where(eq(disputes.id, parseInt(id, 10)))
            .returning();

        res.json(updated);
    } catch (err: any) {
        console.error('[Disputes] Resolve error:', err);
        res.status(500).json({ error: 'Failed to resolve dispute' });
    }
});

/**
 * POST /api/admin/disputes/:id/escalate — escalate a dispute
 */
disputeRouter.post('/api/admin/disputes/:id/escalate', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { escalatedTo } = req.body;

        const [updated] = await db
            .update(disputes)
            .set({
                status: 'escalated',
                escalatedAt: new Date(),
                escalatedTo: escalatedTo || 'management',
                updatedAt: new Date(),
            })
            .where(eq(disputes.id, parseInt(id, 10)))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Dispute not found' });

        console.log(`[Disputes] Dispute #${id} escalated to ${escalatedTo || 'management'}`);
        res.json(updated);
    } catch (err: any) {
        console.error('[Disputes] Escalate error:', err);
        res.status(500).json({ error: 'Failed to escalate dispute' });
    }
});
