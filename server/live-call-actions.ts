/**
 * Live Call Actions
 *
 * API endpoints for CallHUD action buttons:
 * - SEND QUOTE: Create quote, send WhatsApp with link
 * - GET VIDEO: Send video request WhatsApp message
 * - BOOK VISIT: Schedule diagnostic visit
 */

import { Router } from "express";
import { db } from "./db";
import { leads, personalizedQuotes, calls, contractorBookingRequests, contractorAvailabilityDates, handymanProfiles } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { sendWhatsAppMessage } from "./meta-whatsapp";
import { normalizePhoneNumber } from "./phone-utils";
import { updateLeadStage } from "./lead-stage-engine";
import { findDuplicateLead } from "./lead-deduplication";
import { generateValuePricingQuote, getSegmentTierConfig, generateTierDeliverables } from "./value-pricing-engine";

export const liveCallActionsRouter = Router();

// Common validation schema for customer info
const customerInfoSchema = z.object({
    name: z.string().min(1, "Customer name is required"),
    phone: z.string().min(1, "Phone number is required"),
    address: z.string().optional(),
    postcode: z.string().optional(),
});

// Jobs schema
const jobSchema = z.object({
    id: z.string(),
    description: z.string(),
    matched: z.boolean(),
    pricePence: z.number().optional(),
    sku: z.object({
        id: z.string(),
        name: z.string(),
        pricePence: z.number(),
        category: z.string().optional(),
    }).optional(),
});

// ================================================================
// SEND QUOTE
// ================================================================
const sendQuoteSchema = z.object({
    customerInfo: customerInfoSchema,
    jobs: z.array(jobSchema),
    segment: z.string().optional(),
    callSid: z.string().optional(),
});

liveCallActionsRouter.post('/api/live-call/send-quote', async (req, res) => {
    try {
        console.log('[LiveCallAction] SEND QUOTE request:', JSON.stringify(req.body, null, 2));

        const input = sendQuoteSchema.parse(req.body);
        const { customerInfo, jobs, segment, callSid } = input;

        // Normalize phone number
        const normalizedPhone = normalizePhoneNumber(customerInfo.phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                error: "Invalid phone number"
            });
        }

        // Check for matched jobs
        const matchedJobs = jobs.filter(j => j.matched && j.sku);
        if (matchedJobs.length === 0) {
            return res.status(400).json({
                success: false,
                error: "No matched jobs to quote. Use GET VIDEO for unmatched jobs."
            });
        }

        // Calculate total base price from matched SKUs
        const basePricePence = matchedJobs.reduce((sum, j) => sum + (j.sku?.pricePence || 0), 0);

        // Find or create lead
        let leadId: string | null = null;
        const duplicateCheck = await findDuplicateLead(normalizedPhone, {
            customerName: customerInfo.name,
            postcode: customerInfo.postcode,
        });

        if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
            leadId = duplicateCheck.existingLead.id;
            console.log(`[LiveCallAction] Linked to existing lead ${leadId}`);
        } else {
            // Create new lead
            leadId = `lead_livecall_${Date.now()}`;
            const jobDescriptions = jobs.map(j => j.description).join(', ');
            await db.insert(leads).values({
                id: leadId,
                customerName: customerInfo.name,
                phone: normalizedPhone,
                source: 'live_call',
                jobDescription: jobDescriptions,
                postcode: customerInfo.postcode || null,
                addressRaw: customerInfo.address || null,
                status: 'quote_sent',
                route: 'instant_quote',
            });
            console.log(`[LiveCallAction] Created new lead ${leadId}`);
        }

        // Generate quote
        const shortSlug = nanoid(8);
        const quoteId = `quote_${nanoid()}`;

        // Build job description from detected jobs
        const jobDescription = jobs.map(j =>
            j.matched && j.sku ? j.sku.name : j.description
        ).join(' + ');

        // Map segment to schema segment type
        const segmentType = segment || 'BUSY_PRO';
        const segmentConfig = getSegmentTierConfig(segmentType);

        // Generate pricing
        const pricingResult = generateValuePricingQuote({
            urgencyReason: 'med',
            ownershipContext: 'homeowner',
            desiredTimeframe: 'week',
            baseJobPrice: basePricePence,
            clientType: 'residential',
            jobComplexity: matchedJobs.length > 2 ? 'medium' : 'low',
            segment: segmentType,
            jobType: 'SINGLE',
            quotability: 'INSTANT',
        });

        // Generate tier deliverables
        const tierDeliverables = generateTierDeliverables(
            { tasks: matchedJobs.map(j => ({ deliverable: j.sku?.name || j.description })) },
            jobDescription
        );

        // Build jobs array for quote storage
        const quoteJobs = matchedJobs.map(j => ({
            description: j.sku?.name || j.description,
            pricePence: j.sku?.pricePence || 0,
            category: j.sku?.category,
            skuId: j.sku?.id,
        }));

        // Insert quote
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug,
            leadId,
            customerName: customerInfo.name,
            phone: normalizedPhone,
            address: customerInfo.address || null,
            postcode: customerInfo.postcode || null,
            jobDescription,
            quoteMode: 'hhh',
            segment: segmentType,

            // HHH Mode Prices
            essentialPrice: pricingResult.essential.price,
            enhancedPrice: pricingResult.hassleFree.price,
            elitePrice: pricingResult.highStandard.price,

            // Context
            urgencyReason: 'med',
            ownershipContext: 'homeowner',
            desiredTimeframe: 'week',
            baseJobPricePence: basePricePence,
            valueMultiplier100: Math.round(pricingResult.valueMultiplier * 100),
            recommendedTier: pricingResult.recommendedTier,

            // Jobs data
            jobs: quoteJobs,
            tierDeliverables: {
                essential: tierDeliverables.essential,
                hassleFree: tierDeliverables.hassleFree,
                highStandard: tierDeliverables.highStandard,
            },

            proposalModeEnabled: true,
            createdAt: new Date(),
        });

        // Update lead stage
        if (leadId) {
            await updateLeadStage(leadId, 'quote_sent', {
                reason: 'Quote sent from live call',
            });

            // Update lead route
            await db.update(leads)
                .set({ route: 'instant_quote', routeAssignedAt: new Date() })
                .where(eq(leads.id, leadId));
        }

        // Generate quote URL
        const baseUrl = process.env.BASE_URL || 'https://v6-switchboard.replit.app';
        const quoteUrl = `${baseUrl}/quote/${shortSlug}`;

        // Send WhatsApp message with quote link
        const firstName = customerInfo.name.split(' ')[0] || 'there';
        const totalFormatted = `£${Math.round(basePricePence / 100)}`;

        const message = `Hi ${firstName}! 👋

As discussed, here's your personalised quote for ${jobDescription}:

${quoteUrl}

From ${totalFormatted} - just pick the option that works for you and choose a time slot.

Any questions, just give me a shout! 👍`;

        try {
            await sendWhatsAppMessage(normalizedPhone, message);
            console.log(`[LiveCallAction] Quote WhatsApp sent to ${normalizedPhone}`);
        } catch (whatsappError) {
            console.error('[LiveCallAction] WhatsApp send failed:', whatsappError);
            // Don't fail the whole request if WhatsApp fails
        }

        // Update call record if we have callSid
        if (callSid) {
            try {
                await db.update(calls)
                    .set({
                        outcome: 'QUOTE_SENT',
                        leadId,
                        metadataJson: {
                            quoteId,
                            shortSlug,
                            quoteSentAt: new Date().toISOString(),
                        },
                    })
                    .where(eq(calls.callId, callSid));
            } catch (callUpdateError) {
                console.error('[LiveCallAction] Failed to update call record:', callUpdateError);
            }
        }

        res.json({
            success: true,
            quoteId,
            shortSlug,
            quoteUrl,
            leadId,
            message: `Quote sent to ${firstName} via WhatsApp`,
        });

    } catch (error: any) {
        console.error('[LiveCallAction] SEND QUOTE error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ success: false, error: error.message || 'Failed to send quote' });
    }
});

// ================================================================
// GET VIDEO
// ================================================================
const getVideoSchema = z.object({
    customerInfo: customerInfoSchema,
    jobs: z.array(jobSchema).optional(),
    callSid: z.string().optional(),
});

liveCallActionsRouter.post('/api/live-call/get-video', async (req, res) => {
    try {
        console.log('[LiveCallAction] GET VIDEO request:', JSON.stringify(req.body, null, 2));

        const input = getVideoSchema.parse(req.body);
        const { customerInfo, jobs, callSid } = input;

        // Normalize phone number
        const normalizedPhone = normalizePhoneNumber(customerInfo.phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                error: "Invalid phone number"
            });
        }

        // Find or create lead
        let leadId: string | null = null;
        const duplicateCheck = await findDuplicateLead(normalizedPhone, {
            customerName: customerInfo.name,
            postcode: customerInfo.postcode,
        });

        if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
            leadId = duplicateCheck.existingLead.id;
            console.log(`[LiveCallAction] Linked to existing lead ${leadId}`);
        } else {
            // Create new lead
            leadId = `lead_livecall_${Date.now()}`;
            const jobDescriptions = jobs?.map(j => j.description).join(', ') || 'Job requiring video';
            await db.insert(leads).values({
                id: leadId,
                customerName: customerInfo.name,
                phone: normalizedPhone,
                source: 'live_call',
                jobDescription: jobDescriptions,
                postcode: customerInfo.postcode || null,
                addressRaw: customerInfo.address || null,
                status: 'awaiting_video',
                awaitingVideo: true,
                route: 'video',
            });
            console.log(`[LiveCallAction] Created new lead ${leadId}`);
        }

        // Update lead to awaiting_video
        await updateLeadStage(leadId, 'awaiting_video', {
            reason: 'Video requested from live call',
        });

        // Update lead's awaitingVideo flag and route
        await db.update(leads)
            .set({
                awaitingVideo: true,
                route: 'video',
                routeAssignedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(leads.id, leadId));

        // Generate video upload link
        const baseUrl = process.env.BASE_URL || 'https://v6-switchboard.replit.app';
        const videoToken = nanoid(12);
        const videoUploadUrl = `${baseUrl}/upload-video/${videoToken}`;

        // Build job context from ALL detected jobs
        const allJobDescriptions = jobs?.map(j => j.sku?.name || j.description) || [];
        const videoSubject = allJobDescriptions.length > 0
            ? allJobDescriptions.join(', ')
            : 'the work you mentioned';

        // Build WhatsApp message for frontend to open
        const firstName = customerInfo.name.split(' ')[0] || 'there';
        const whatsappMessage = `Hi ${firstName}!

Thanks for calling about ${videoSubject}.

To give you an accurate quote, could you send a quick video of the area? Just reply to this message with a short clip - even 10-15 seconds helps!

This way I can give you a proper price without needing to visit first.

Mike
HandyServices`;

        console.log(`[LiveCallAction] Video request prepared for ${normalizedPhone}`);

        // Update call record if we have callSid
        if (callSid) {
            try {
                await db.update(calls)
                    .set({
                        outcome: 'VIDEO_REQUESTED',
                        leadId,
                        videoRequestSentAt: new Date(),
                        metadataJson: {
                            videoRequestedAt: new Date().toISOString(),
                            videoSubject,
                        },
                    })
                    .where(eq(calls.callId, callSid));
            } catch (callUpdateError) {
                console.error('[LiveCallAction] Failed to update call record:', callUpdateError);
            }
        }

        res.json({
            success: true,
            leadId,
            videoUploadUrl,
            phone: normalizedPhone,
            whatsappMessage,
        });

    } catch (error: any) {
        console.error('[LiveCallAction] GET VIDEO error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ success: false, error: error.message || 'Failed to request video' });
    }
});

// ================================================================
// BOOK VISIT (with Calendar Booking & Deposit Payment)
// ================================================================
const bookVisitSchema = z.object({
    customerInfo: customerInfoSchema,
    slotId: z.string().optional(), // Selected availability slot ID
    slotDate: z.string().optional(), // ISO date string for the slot
    slotTime: z.string().optional(), // Time slot: "am" | "pm" | "09:00-12:00" etc
    jobs: z.array(jobSchema).optional(),
    callSid: z.string().optional(),
    depositAmountPence: z.number().optional().default(2500), // Default £25 deposit
});

liveCallActionsRouter.post('/api/live-call/book-visit', async (req, res) => {
    try {
        console.log('[LiveCallAction] BOOK VISIT request:', JSON.stringify(req.body, null, 2));

        const input = bookVisitSchema.parse(req.body);
        const { customerInfo, slotId, slotDate, slotTime, jobs, callSid, depositAmountPence } = input;

        // Normalize phone number
        const normalizedPhone = normalizePhoneNumber(customerInfo.phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                error: "Invalid phone number"
            });
        }

        // Find or create lead
        let leadId: string | null = null;
        const duplicateCheck = await findDuplicateLead(normalizedPhone, {
            customerName: customerInfo.name,
            postcode: customerInfo.postcode,
        });

        if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
            leadId = duplicateCheck.existingLead.id;
            console.log(`[LiveCallAction] Linked to existing lead ${leadId}`);
        } else {
            // Create new lead
            leadId = `lead_livecall_${Date.now()}`;
            const jobDescriptions = jobs?.map(j => j.description).join(', ') || 'Job requiring site visit';
            await db.insert(leads).values({
                id: leadId,
                customerName: customerInfo.name,
                phone: normalizedPhone,
                source: 'live_call',
                jobDescription: jobDescriptions,
                postcode: customerInfo.postcode || null,
                addressRaw: customerInfo.address || null,
                status: 'visit_scheduled',
                route: 'site_visit',
            });
            console.log(`[LiveCallAction] Created new lead ${leadId}`);
        }

        // Update lead stage to visit_scheduled
        await updateLeadStage(leadId, 'visit_scheduled', {
            reason: 'Site visit booked from live call',
        });

        // Parse scheduled date if provided
        let scheduledDate: Date | null = null;
        if (slotDate) {
            scheduledDate = new Date(slotDate);
        }

        // Update lead route and visit flag
        await db.update(leads)
            .set({
                route: 'site_visit',
                routeAssignedAt: new Date(),
                siteVisitScheduledAt: scheduledDate || new Date(),
                updatedAt: new Date(),
            })
            .where(eq(leads.id, leadId));

        // Create a booking record for the visit
        const bookingId = `booking_visit_${nanoid(12)}`;
        const jobDescriptions = jobs?.map(j => j.description).join(', ') || 'Diagnostic site visit';

        // Get first available contractor as placeholder (will be properly assigned during dispatch)
        const defaultContractor = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.publicProfileEnabled, true),
        });

        if (!defaultContractor) {
            console.warn('[LiveCallAction] No contractors found - booking without contractor assignment');
        }

        // Determine time slot
        let scheduledStartTime: string | null = null;
        let scheduledEndTime: string | null = null;
        if (slotTime) {
            if (slotTime === 'am') {
                scheduledStartTime = '09:00';
                scheduledEndTime = '12:00';
            } else if (slotTime === 'pm') {
                scheduledStartTime = '13:00';
                scheduledEndTime = '17:00';
            } else if (slotTime.includes('-')) {
                const [start, end] = slotTime.split('-');
                scheduledStartTime = start.trim();
                scheduledEndTime = end.trim();
            }
        }

        // Only create booking record if we have a contractor
        if (defaultContractor) {
            await db.insert(contractorBookingRequests).values({
                id: bookingId,
                contractorId: defaultContractor.id, // Placeholder - will be reassigned during dispatch
                customerName: customerInfo.name,
                customerEmail: null,
                customerPhone: normalizedPhone,
                requestedDate: scheduledDate,
                requestedSlot: slotTime || null,
                description: `Diagnostic Visit: ${jobDescriptions}`,
                status: 'pending',
                scheduledDate: scheduledDate,
                scheduledStartTime,
                scheduledEndTime,
                assignmentStatus: 'unassigned',
            });

            console.log(`[LiveCallAction] Created booking ${bookingId} for visit (contractor placeholder: ${defaultContractor.id})`);
        } else {
            // Log that we couldn't create a booking - lead is still created
            console.log(`[LiveCallAction] Booking ${bookingId} skipped - no contractors available`);
        }

        // Generate Stripe Checkout Session for deposit payment
        let paymentUrl: string | null = null;
        let stripeError: string | null = null;

        try {
            const Stripe = (await import('stripe')).default;
            const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();

            if (stripeSecretKey && stripeSecretKey.startsWith('sk_')) {
                const stripe = new Stripe(stripeSecretKey);
                const baseUrl = process.env.BASE_URL || 'https://v6-switchboard.replit.app';

                // Build description for Stripe
                const visitDescription = scheduledDate
                    ? `Diagnostic Visit - ${scheduledDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${slotTime ? ` (${slotTime.toUpperCase()})` : ''}`
                    : 'Diagnostic Visit Deposit';

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'gbp',
                                product_data: {
                                    name: 'Diagnostic Visit Deposit',
                                    description: visitDescription,
                                },
                                unit_amount: depositAmountPence,
                            },
                            quantity: 1,
                        },
                    ],
                    mode: 'payment',
                    success_url: `${baseUrl}/booking-confirmed/${bookingId}?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${baseUrl}/visit-cancelled/${bookingId}`,
                    customer_email: undefined, // We don't have email from call
                    metadata: {
                        bookingId,
                        leadId: leadId || '',
                        customerName: customerInfo.name,
                        customerPhone: normalizedPhone,
                        visitType: 'diagnostic',
                        scheduledDate: scheduledDate?.toISOString() || '',
                        slotTime: slotTime || '',
                    },
                });

                paymentUrl = session.url;
                console.log(`[LiveCallAction] Created Stripe checkout session: ${session.id}`);
            } else {
                stripeError = 'Stripe not configured';
                console.warn('[LiveCallAction] Stripe not configured - skipping payment link');
            }
        } catch (stripeErr: any) {
            stripeError = stripeErr.message;
            console.error('[LiveCallAction] Stripe checkout creation failed:', stripeErr);
        }

        // Build WhatsApp message with booking details and payment link
        const firstName = customerInfo.name.split(' ')[0] || 'there';
        const address = customerInfo.address || 'your property';
        const depositFormatted = `£${(depositAmountPence / 100).toFixed(2)}`;

        // Format date/time for message
        let dateTimeStr = '';
        if (scheduledDate) {
            dateTimeStr = scheduledDate.toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            });
            if (slotTime) {
                if (slotTime === 'am') {
                    dateTimeStr += ' (Morning: 9am-12pm)';
                } else if (slotTime === 'pm') {
                    dateTimeStr += ' (Afternoon: 1pm-5pm)';
                } else {
                    dateTimeStr += ` (${slotTime})`;
                }
            }
        }

        let whatsappMessage = `Hi ${firstName}!

Thanks for booking a diagnostic visit${dateTimeStr ? ` for ${dateTimeStr}` : ''}!`;

        if (paymentUrl) {
            whatsappMessage += `

To confirm your booking, please pay the ${depositFormatted} deposit:
${paymentUrl}

This deposit is fully deducted from your final bill when you go ahead with the work.`;
        } else {
            whatsappMessage += `

The diagnostic fee is ${depositFormatted} (deducted from your final bill if you proceed).`;
        }

        whatsappMessage += `

What happens next:
- Our experienced handyman visits ${address}
- We assess the work and give you an exact quote on the spot
- No obligation - the diagnostic fee covers the visit

Any questions, just reply here!

Mike, HandyServices`;

        // Update call record if we have callSid
        if (callSid) {
            try {
                await db.update(calls)
                    .set({
                        outcome: 'VISIT_BOOKED',
                        leadId,
                        metadataJson: {
                            visitBookedAt: new Date().toISOString(),
                            bookingId,
                            diagnosticFee: depositAmountPence,
                            scheduledDate: scheduledDate?.toISOString(),
                            slotTime,
                            paymentUrl,
                        },
                    })
                    .where(eq(calls.callId, callSid));
            } catch (callUpdateError) {
                console.error('[LiveCallAction] Failed to update call record:', callUpdateError);
            }
        }

        // If slotId was provided, mark the availability slot as booked
        if (slotId) {
            try {
                await db.update(contractorAvailabilityDates)
                    .set({
                        isAvailable: false,
                        notes: `Booked for visit: ${bookingId}`,
                    })
                    .where(eq(contractorAvailabilityDates.id, slotId));
                console.log(`[LiveCallAction] Marked slot ${slotId} as booked`);
            } catch (slotError) {
                console.warn('[LiveCallAction] Failed to update availability slot:', slotError);
                // Non-critical error, continue
            }
        }

        console.log(`[LiveCallAction] Visit booked: ${bookingId}, Payment URL: ${paymentUrl || 'N/A'}`);

        res.json({
            success: true,
            bookingId,
            leadId,
            paymentUrl,
            phone: normalizedPhone,
            whatsappMessage,
            depositAmount: depositFormatted,
            scheduledDate: scheduledDate?.toISOString() || null,
            slotTime: slotTime || null,
            stripeError: stripeError || undefined,
        });

    } catch (error: any) {
        console.error('[LiveCallAction] BOOK VISIT error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ success: false, error: error.message || 'Failed to book visit' });
    }
});

// ================================================================
// CREATE QUOTE (for popup - doesn't auto-send WhatsApp)
// ================================================================
const createQuoteSchema = z.object({
    customerName: z.string().min(1, "Customer name is required"),
    phone: z.string().min(1, "Phone number is required"),
    address: z.string().optional(),
    segment: z.string().optional(),
    lineItems: z.array(z.object({
        skuId: z.string().optional(),
        description: z.string(),
        pricePence: z.number(),
        quantity: z.number().min(1),
    })),
    addOns: z.array(z.object({
        id: z.string(),
        name: z.string(),
        pricePence: z.number(),
    })).optional(),
    discountPercent: z.number().min(0).max(50).optional(),
    discountReason: z.string().optional(),
    subtotalPence: z.number(),
    discountPence: z.number().optional(),
    totalPence: z.number(),
    callSid: z.string().optional(),
    expiresInDays: z.number().default(7),
});

liveCallActionsRouter.post('/api/live-call/create-quote', async (req, res) => {
    try {
        console.log('[LiveCallAction] CREATE QUOTE request:', JSON.stringify(req.body, null, 2));

        const input = createQuoteSchema.parse(req.body);

        // Normalize phone number
        const normalizedPhone = normalizePhoneNumber(input.phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                error: "Invalid phone number"
            });
        }

        // Validate we have line items
        if (input.lineItems.length === 0) {
            return res.status(400).json({
                success: false,
                error: "At least one line item is required"
            });
        }

        // Find or create lead
        let leadId: string | null = null;
        const duplicateCheck = await findDuplicateLead(normalizedPhone, {
            customerName: input.customerName,
        });

        if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
            leadId = duplicateCheck.existingLead.id;
            console.log(`[LiveCallAction] Linked to existing lead ${leadId}`);
        } else {
            // Create new lead
            leadId = `lead_livecall_${Date.now()}`;
            const jobDescriptions = input.lineItems.map(item => item.description).join(', ');
            await db.insert(leads).values({
                id: leadId,
                customerName: input.customerName,
                phone: normalizedPhone,
                source: 'live_call',
                jobDescription: jobDescriptions,
                addressRaw: input.address || null,
                status: 'quote_sent',
                route: 'instant_quote',
            });
            console.log(`[LiveCallAction] Created new lead ${leadId}`);
        }

        // Generate IDs
        const shortSlug = nanoid(8);
        const quoteId = `quote_${nanoid()}`;

        // Build job description
        const jobDescription = input.lineItems.map(item =>
            `${item.quantity > 1 ? item.quantity + 'x ' : ''}${item.description}`
        ).join(' + ');

        // Segment type
        const segmentType = input.segment || 'BUSY_PRO';
        const segmentConfig = getSegmentTierConfig(segmentType);

        // Calculate prices for HHH tiers based on total
        const basePricePence = input.totalPence;

        // Generate pricing result
        const pricingResult = generateValuePricingQuote({
            urgencyReason: 'med',
            ownershipContext: 'homeowner',
            desiredTimeframe: 'week',
            baseJobPrice: basePricePence,
            clientType: 'residential',
            jobComplexity: input.lineItems.length > 2 ? 'medium' : 'low',
            segment: segmentType,
            jobType: 'SINGLE',
            quotability: 'INSTANT',
        });

        // Generate tier deliverables
        const tierDeliverables = generateTierDeliverables(
            { tasks: input.lineItems.map(item => ({ deliverable: item.description })) },
            jobDescription
        );

        // Build jobs array for storage
        const quoteJobs = input.lineItems.map(item => ({
            description: item.description,
            pricePence: item.pricePence * item.quantity,
            quantity: item.quantity,
            skuId: item.skuId,
        }));

        // Add add-ons to jobs if any
        if (input.addOns && input.addOns.length > 0) {
            input.addOns.forEach(addon => {
                quoteJobs.push({
                    description: `Add-on: ${addon.name}`,
                    pricePence: addon.pricePence,
                    quantity: 1,
                    skuId: undefined,
                });
            });
        }

        // Calculate expiry date
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + input.expiresInDays);

        // Insert quote
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug,
            leadId,
            customerName: input.customerName,
            phone: normalizedPhone,
            address: input.address || null,
            jobDescription,
            quoteMode: 'hhh',
            segment: segmentType,

            // Use popup prices, calculate tier prices from base
            essentialPrice: pricingResult.essential.price,
            enhancedPrice: pricingResult.hassleFree.price,
            elitePrice: pricingResult.highStandard.price,

            // Base price (before tier multipliers)
            baseJobPricePence: input.totalPence,

            // Context
            urgencyReason: 'med',
            ownershipContext: 'homeowner',
            desiredTimeframe: 'week',
            valueMultiplier100: Math.round(pricingResult.valueMultiplier * 100),
            recommendedTier: pricingResult.recommendedTier,

            // Jobs data
            jobs: quoteJobs,
            tierDeliverables: {
                essential: tierDeliverables.essential,
                hassleFree: tierDeliverables.hassleFree,
                highStandard: tierDeliverables.highStandard,
            },

            proposalModeEnabled: true,
            expiresAt,
            createdAt: new Date(),
        });

        // Update lead stage
        if (leadId) {
            await updateLeadStage(leadId, 'quote_sent', {
                reason: 'Quote created from live call popup',
            });

            // Update lead route
            await db.update(leads)
                .set({ route: 'instant_quote', routeAssignedAt: new Date() })
                .where(eq(leads.id, leadId));
        }

        // Update call record if we have callSid
        if (input.callSid) {
            try {
                await db.update(calls)
                    .set({
                        outcome: 'QUOTE_SENT',
                        leadId,
                        metadataJson: {
                            quoteId,
                            shortSlug,
                            quoteSentAt: new Date().toISOString(),
                            discountPercent: input.discountPercent || 0,
                            discountReason: input.discountReason || null,
                        },
                    })
                    .where(eq(calls.callId, input.callSid));
            } catch (callUpdateError) {
                console.error('[LiveCallAction] Failed to update call record:', callUpdateError);
            }
        }

        // Generate quote URL
        const baseUrl = process.env.BASE_URL || 'https://v6-switchboard.replit.app';
        const quoteUrl = `${baseUrl}/quote/${shortSlug}`;

        console.log(`[LiveCallAction] Quote created: ${quoteId}, URL: ${quoteUrl}`);

        res.json({
            success: true,
            quoteId,
            shortSlug,
            quoteUrl,
            leadId,
            expiresAt: expiresAt.toISOString(),
        });

    } catch (error: any) {
        console.error('[LiveCallAction] CREATE QUOTE error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ success: false, error: error.message || 'Failed to create quote' });
    }
});

export default liveCallActionsRouter;
