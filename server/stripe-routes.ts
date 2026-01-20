import { Router } from 'express';
import Stripe from 'stripe';
import { db } from './db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Helper to get Stripe instance lazily
const getStripe = () => {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();

    if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
        return null;
    }

    return new Stripe(stripeSecretKey);
};

export const stripeRouter = Router();

// Calculate deposit: 100% materials + 30% of labour
function calculateDeposit(totalPrice: number, materialsCost: number): {
    total: number;
    totalMaterialsCost: number;
    labourDepositComponent: number;
} {
    const labourCost = totalPrice - materialsCost;
    const labourDepositComponent = Math.round(labourCost * 0.30);
    const total = materialsCost + labourDepositComponent;

    return {
        total,
        totalMaterialsCost: materialsCost,
        labourDepositComponent
    };
}

// Create Payment Intent
stripeRouter.post('/api/create-payment-intent', async (req, res) => {
    console.log('[Stripe] Create payment intent request received');

    const stripe = getStripe();

    if (!stripe) {
        console.error('[Stripe] Stripe not initialized. STRIPE_SECRET_KEY is missing or invalid.');
        // Log environment status safely
        console.error('[Stripe] Key status:', {
            exists: !!process.env.STRIPE_SECRET_KEY,
            startsWithSk: process.env.STRIPE_SECRET_KEY?.startsWith('sk_')
        });
        return res.status(500).json({
            message: 'Payment system not configured. Please contact support.',
            debug: 'Stripe secret key missing or invalid'
        });
    }

    try {
        const {
            customerName,
            customerEmail,
            quoteId,
            selectedTier,
            selectedTierPrice,
            selectedExtras = [],
            paymentType = 'full'
        } = req.body;

        if (!quoteId || !selectedTier) {
            return res.status(400).json({ message: 'Missing required fields: quoteId and selectedTier' });
        }

        // Fetch the quote from database
        const quoteResult = await db.select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, quoteId))
            .limit(1);

        if (quoteResult.length === 0) {
            return res.status(404).json({ message: 'Quote not found' });
        }

        const quote = quoteResult[0];

        // Get the tier price from the quote (server-side source of truth)
        let baseTierPrice: number;
        if (quote.quoteMode === 'simple') {
            baseTierPrice = quote.basePrice || 0;
        } else {
            const tierPriceMap: Record<string, number | null | undefined> = {
                essential: quote.essentialPrice,
                enhanced: quote.enhancedPrice,
                elite: quote.elitePrice
            };
            baseTierPrice = tierPriceMap[selectedTier] || 0;
        }

        // Calculate extras total
        const optionalExtras = (quote.optionalExtras as any[]) || [];
        let extrasTotal = 0;
        let extrasMaterials = 0;

        for (const extraLabel of selectedExtras) {
            const extra = optionalExtras.find((e: any) => e.label === extraLabel);
            if (extra) {
                extrasTotal += extra.priceInPence || 0;
                extrasMaterials += extra.materialsCostInPence || 0;
            }
        }

        // Total job price
        const totalJobPrice = baseTierPrice + extrasTotal;

        // Calculate materials cost
        const baseMaterials = (quote.materialsCostWithMarkupPence as number) || 0;
        const totalMaterialsCost = baseMaterials + extrasMaterials;

        // Calculate deposit
        const depositBreakdown = calculateDeposit(totalJobPrice, totalMaterialsCost);

        console.log('[Stripe] Deposit calculation:', {
            baseTierPrice,
            extrasTotal,
            totalJobPrice,
            totalMaterialsCost,
            deposit: depositBreakdown.total
        });

        // Minimum Stripe charge is 30p (£0.30)
        const chargeAmount = Math.max(depositBreakdown.total, 30);

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: chargeAmount,
            currency: 'gbp',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                quoteId,
                customerName,
                selectedTier,
                paymentType,
                totalJobPrice: totalJobPrice.toString(),
                depositAmount: depositBreakdown.total.toString(),
                selectedExtras: selectedExtras.join(',')
            },
            receipt_email: customerEmail || undefined,
            description: `Deposit for ${customerName} - ${selectedTier} package`
        });

        console.log('[Stripe] Payment intent created:', paymentIntent.id);

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            depositBreakdown: {
                total: depositBreakdown.total,
                totalMaterialsCost: depositBreakdown.totalMaterialsCost,
                labourDepositComponent: depositBreakdown.labourDepositComponent
            }
        });

    } catch (error: any) {
        console.error('[Stripe] Error creating payment intent:', error);
        res.status(500).json({
            message: error.message || 'Failed to create payment intent'
        });
    }
});

// B3: Webhook for handling Stripe events
stripeRouter.post('/api/stripe/webhook', async (req, res) => {
    const stripe = getStripe();

    if (!stripe) {
        console.error('[Stripe Webhook] Stripe not initialized');
        return res.status(500).json({ error: 'Stripe not configured' });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event;

    try {
        // Verify webhook signature
        event = stripe.webhooks.constructEvent(
            req.body,
            sig as string,
            webhookSecret
        );
    } catch (err: any) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('[Stripe Webhook] Received event:', event.type);

    try {
        // Handle the event
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;
                console.log('[Stripe Webhook] Payment succeeded:', paymentIntent.id);

                // Import invoices table
                const { invoices } = await import('../shared/schema');
                const { eq } = await import('drizzle-orm');

                // Find invoice by payment intent ID
                const invoiceResults = await db.select()
                    .from(invoices)
                    .where(eq(invoices.stripePaymentIntentId, paymentIntent.id))
                    .limit(1);

                if (invoiceResults.length > 0) {
                    // Update invoice status to paid
                    await db.update(invoices)
                        .set({
                            status: 'paid',
                            paidAt: new Date(),
                            paymentMethod: 'stripe',
                            updatedAt: new Date()
                        })
                        .where(eq(invoices.id, invoiceResults[0].id));

                    console.log('[Stripe Webhook] Invoice marked as paid:', invoiceResults[0].invoiceNumber);
                } else {
                    console.log('[Stripe Webhook] No invoice found for payment intent:', paymentIntent.id);
                }
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                console.log('[Stripe Webhook] Payment failed:', paymentIntent.id);

                const { invoices } = await import('../shared/schema');
                const { eq } = await import('drizzle-orm');

                // Find and update invoice
                const invoiceResults = await db.select()
                    .from(invoices)
                    .where(eq(invoices.stripePaymentIntentId, paymentIntent.id))
                    .limit(1);

                if (invoiceResults.length > 0) {
                    await db.update(invoices)
                        .set({
                            notes: `Payment failed: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
                            updatedAt: new Date()
                        })
                        .where(eq(invoices.id, invoiceResults[0].id));

                    console.log('[Stripe Webhook] Invoice updated with payment failure');
                }
                break;
            }

            default:
                console.log('[Stripe Webhook] Unhandled event type:', event.type);
        }

        res.json({ received: true });
    } catch (error: any) {
        console.error('[Stripe Webhook] Error processing event:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Create Payment Intent for Diagnostic Visit (Full Payment)
stripeRouter.post('/api/create-visit-payment-intent', async (req, res) => {
    // ... (existing code omitted for brevity in instruction, but kept in replacement content if I was replacing whole block, but here I am appending)
    // Actually, I should just append. But replace_file_content replaces a block.
    // I will replace the last block and append new routes.
    console.log('[Stripe] Create visit payment intent request received');

    const stripe = getStripe();

    if (!stripe) {
        console.error('[Stripe] Stripe not initialized');
        return res.status(500).json({ message: 'Payment system not configured' });
    }

    try {
        const {
            customerName,
            customerEmail,
            quoteId,
            tierId, // 'standard' | 'priority' | 'emergency'
            slot, // { date, slot }
        } = req.body;

        if (!quoteId || !tierId) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Fetch the quote to determine client type
        const quoteResult = await db.select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, quoteId))
            .limit(1);

        if (quoteResult.length === 0) {
            return res.status(404).json({ message: 'Quote not found' });
        }

        const quote = quoteResult[0];
        const isCommercial = quote.clientType === 'commercial';

        // validate price based on tier and client type
        let pricePence = 0;
        if (isCommercial) {
            // Commercial Rates
            switch (tierId) {
                case 'emergency': pricePence = 25000; break;
                case 'priority': pricePence = 15000; break;
                default: pricePence = 8500; break;
            }
        } else {
            // Residential Rates
            switch (tierId) {
                case 'emergency': pricePence = 17500; break;
                case 'priority': pricePence = 9900; break;
                default: pricePence = 4900; break;
            }
        }

        // Check for custom tier prices overrides
        if (tierId === 'standard' && quote.tierStandardPrice) {
            pricePence = quote.tierStandardPrice;
        } else if (tierId === 'priority' && quote.tierPriorityPrice) {
            pricePence = quote.tierPriorityPrice;
        } else if (tierId === 'emergency' && quote.tierEmergencyPrice) {
            pricePence = quote.tierEmergencyPrice;
        }

        console.log(`[Stripe] Creating visit intent for ${tierId} (${isCommercial ? 'Commercial' : 'Residential'}): ${pricePence / 100}`);

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: pricePence,
            currency: 'gbp',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                quoteId,
                customerName,
                tierId,
                type: 'diagnostic_visit',
                bookingDate: slot?.date,
                bookingSlot: slot?.slot
            },
            receipt_email: customerEmail || undefined,
            description: `Diagnostic Visit - ${tierId.charAt(0).toUpperCase() + tierId.slice(1)}`
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount: pricePence
        });

    } catch (error: any) {
        console.error('[Stripe] Error creating visit payment intent:', error);
        res.status(500).json({
            message: error.message || 'Failed to create payment intent'
        });
    }
});

// ==========================================
// CONNECT ONBOARDING FOR CONTRACTORS
// ==========================================

import { requireContractorAuth } from './contractor-auth';
import { handymanProfiles } from '../shared/schema';

// POST /api/stripe/connect/account
// Create Express Account for Contractor
stripeRouter.post('/api/stripe/connect/account', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;

        // Fetch profile
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
            with: { user: true }
        });

        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        if (profile.stripeAccountId) {
            return res.json({ accountId: profile.stripeAccountId, alreadyExists: true });
        }

        // Create Account
        const account = await stripe.accounts.create({
            type: 'express',
            country: 'GB',
            email: profile.user.email,
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
            },
            business_type: 'individual',
            individual: {
                email: profile.user.email,
                first_name: profile.user.firstName || undefined,
                last_name: profile.user.lastName || undefined,
            }
        });

        // Save Account ID
        await db.update(handymanProfiles)
            .set({
                stripeAccountId: account.id,
                stripeAccountStatus: 'pending'
            })
            .where(eq(handymanProfiles.id, profile.id));

        res.json({ accountId: account.id });

    } catch (error: any) {
        console.error('[Stripe Connect] Create Account Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/stripe/connect/account-link
// Generate Onboarding Link
stripeRouter.post('/api/stripe/connect/account-link', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile || !profile.stripeAccountId) {
            return res.status(400).json({ error: 'No Stripe Account found. Create one first.' });
        }

        const accountLink = await stripe.accountLinks.create({
            account: profile.stripeAccountId,
            refresh_url: `${req.headers.origin}/contractor/settings`, // return to settings on failure/refresh
            return_url: `${req.headers.origin}/contractor/settings?stripe_return=true`, // return on success
            type: 'account_onboarding',
        });

        res.json({ url: accountLink.url });

    } catch (error: any) {
        console.error('[Stripe Connect] Account Link Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/stripe/connect/status
// Check Account Status (Charges Enabled?)
stripeRouter.get('/api/stripe/connect/status', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile || !profile.stripeAccountId) {
            return res.json({ connected: false });
        }

        const account = await stripe.accounts.retrieve(profile.stripeAccountId);

        // Update DB status if changed
        const status = account.charges_enabled ? 'active' : 'pending';
        if (profile.stripeAccountStatus !== status) {
            await db.update(handymanProfiles)
                .set({ stripeAccountStatus: status })
                .where(eq(handymanProfiles.id, profile.id));
        }

        res.json({
            connected: true,
            accountId: account.id,
            chargesEnabled: account.charges_enabled,
            detailsSubmitted: account.details_submitted,
            payoutsEnabled: account.payouts_enabled,
            requirements: account.requirements
        });

    } catch (error: any) {
        console.error('[Stripe Connect] Status Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/stripe/connect/login-link
// Generate Dashboard Link
stripeRouter.post('/api/stripe/connect/login-link', requireContractorAuth, async (req: any, res) => {
    try {
        const stripe = getStripe();
        if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

        const contractor = req.contractor;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile || !profile.stripeAccountId) {
            return res.status(400).json({ error: 'No Stripe Account found.' });
        }

        const loginLink = await stripe.accounts.createLoginLink(profile.stripeAccountId);
        res.json({ url: loginLink.url });

    } catch (error: any) {
        console.error('[Stripe Connect] Login Link Error:', error);
        res.status(500).json({ error: error.message });
    }
});
