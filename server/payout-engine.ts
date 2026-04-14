import Stripe from 'stripe';
import { db } from './db';
import { contractorPayouts, handymanProfiles, disputes } from '../shared/schema';
import { eq, and, lte, inArray } from 'drizzle-orm';

// Lazy Stripe instance (same pattern as stripe-routes.ts)
const getStripe = () => {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
    if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
        return null;
    }
    return new Stripe(stripeSecretKey);
};

const MAX_RETRIES = 3;

export interface PayoutResult {
    payoutId: number;
    status: string;
    error?: string;
}

export interface PayoutSummary {
    processed: number;
    failed: number;
    held: number;
    results: PayoutResult[];
}

/**
 * Main payout cron function.
 * Finds all pending payouts scheduled for now or earlier, and processes them via Stripe Transfer.
 */
export async function processPayouts(): Promise<PayoutSummary> {
    const stripe = getStripe();
    if (!stripe) {
        console.error('[Payouts] Stripe not configured, skipping payout run');
        return { processed: 0, failed: 0, held: 0, results: [] };
    }

    const now = new Date();
    const results: PayoutResult[] = [];
    let processed = 0;
    let failed = 0;
    let held = 0;

    // a. Find all pending payouts scheduled for now or earlier
    const pendingPayouts = await db.select()
        .from(contractorPayouts)
        .where(
            and(
                eq(contractorPayouts.status, 'pending'),
                lte(contractorPayouts.scheduledPayoutAt, now)
            )
        );

    if (pendingPayouts.length === 0) {
        return { processed: 0, failed: 0, held: 0, results: [] };
    }

    for (const payout of pendingPayouts) {
        try {
            // b. Fetch contractor's Stripe account info
            const profileResult = await db.select({
                stripeAccountId: handymanProfiles.stripeAccountId,
                stripeAccountStatus: handymanProfiles.stripeAccountStatus,
            })
                .from(handymanProfiles)
                .where(eq(handymanProfiles.id, payout.contractorId))
                .limit(1);

            const profile = profileResult[0];

            // If Stripe account not active: hold the payout
            if (!profile?.stripeAccountId || profile.stripeAccountStatus !== 'active') {
                await db.update(contractorPayouts)
                    .set({
                        status: 'held',
                        heldReason: 'stripe_not_active',
                        updatedAt: now,
                    })
                    .where(eq(contractorPayouts.id, payout.id));
                held++;
                results.push({ payoutId: payout.id, status: 'held', error: 'stripe_not_active' });
                continue;
            }

            // Check for open disputes on this job
            if (payout.jobId) {
                const openDisputes = await db.select({ id: disputes.id })
                    .from(disputes)
                    .where(
                        and(
                            eq(disputes.jobId, payout.jobId),
                            inArray(disputes.status, ['open', 'investigating', 'awaiting_contractor', 'awaiting_customer', 'escalated'])
                        )
                    )
                    .limit(1);

                if (openDisputes.length > 0) {
                    await db.update(contractorPayouts)
                        .set({
                            status: 'held',
                            heldReason: 'dispute_open',
                            updatedAt: now,
                        })
                        .where(eq(contractorPayouts.id, payout.id));
                    held++;
                    results.push({ payoutId: payout.id, status: 'held', error: 'dispute_open' });
                    continue;
                }
            }

            // Create Stripe Transfer
            const transfer = await stripe.transfers.create({
                amount: payout.netPayoutPence,
                currency: 'gbp',
                destination: profile.stripeAccountId,
                transfer_group: `job_${payout.jobId}`,
                metadata: {
                    payoutId: String(payout.id),
                    quoteId: payout.quoteId || '',
                },
            });

            // On success: mark paid
            await db.update(contractorPayouts)
                .set({
                    status: 'paid',
                    paidAt: now,
                    stripeTransferId: transfer.id,
                    stripeTransferStatus: 'paid',
                    stripeAccountId: profile.stripeAccountId,
                    updatedAt: now,
                })
                .where(eq(contractorPayouts.id, payout.id));

            processed++;
            results.push({ payoutId: payout.id, status: 'paid' });

        } catch (err: any) {
            // On failure: mark failed
            const errorMessage = err?.message || 'Unknown error';
            await db.update(contractorPayouts)
                .set({
                    status: 'failed',
                    failureReason: errorMessage,
                    updatedAt: now,
                })
                .where(eq(contractorPayouts.id, payout.id));

            failed++;
            results.push({ payoutId: payout.id, status: 'failed', error: errorMessage });
            console.error(`[Payouts] Failed payout ${payout.id}:`, errorMessage);
        }
    }

    return { processed, failed, held, results };
}

/**
 * Retry failed payouts (max 3 retries).
 * Re-queues failed payouts by setting status back to 'pending' with scheduledPayoutAt = now.
 * Tracks retry count via failureReason prefix.
 */
export async function retryFailedPayouts(): Promise<{
    retried: number;
    skipped: number;
}> {
    const now = new Date();
    let retried = 0;
    let skipped = 0;

    const failedPayouts = await db.select()
        .from(contractorPayouts)
        .where(eq(contractorPayouts.status, 'failed'));

    for (const payout of failedPayouts) {
        // Count retries from failureReason
        const reason = payout.failureReason || '';
        const retryMatch = reason.match(/^\[retry (\d+)\/\d+\]/);
        const currentRetries = retryMatch ? parseInt(retryMatch[1], 10) : 0;

        if (currentRetries >= MAX_RETRIES) {
            skipped++;
            continue;
        }

        // Re-queue: set back to pending with updated retry count
        const nextRetry = currentRetries + 1;
        await db.update(contractorPayouts)
            .set({
                status: 'pending',
                scheduledPayoutAt: now,
                failureReason: `[retry ${nextRetry}/${MAX_RETRIES}] ${reason.replace(/^\[retry \d+\/\d+\] ?/, '')}`,
                updatedAt: now,
            })
            .where(eq(contractorPayouts.id, payout.id));

        retried++;
    }

    return { retried, skipped };
}
