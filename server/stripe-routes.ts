import { Router } from 'express';
import Stripe from 'stripe';
import { db } from './db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Initialize Stripe with the secret key (strip quotes if present in .env)
const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();

if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
    console.error('[Stripe] Invalid or missing STRIPE_SECRET_KEY. Payment functionality will be disabled.');
}

const stripe = stripeSecretKey && stripeSecretKey.startsWith('sk_')
    ? new Stripe(stripeSecretKey)
    : null;

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

// Webhook for handling Stripe events (optional but recommended)
stripeRouter.post('/api/stripe/webhook', async (req, res) => {
    // This would handle payment confirmations, etc.
    // For now, just acknowledge the webhook
    res.json({ received: true });
});

// Create Payment Intent for Diagnostic Visit (Full Payment)
stripeRouter.post('/api/create-visit-payment-intent', async (req, res) => {
    console.log('[Stripe] Create visit payment intent request received');

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
