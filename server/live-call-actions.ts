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
import { leads, personalizedQuotes, calls } from "@shared/schema";
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
            { tasks: matchedJobs.map(j => ({ description: j.sku?.name || j.description })) },
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
        const quoteUrl = `${baseUrl}/q/${shortSlug}`;

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
                    .where(eq(calls.callSid, callSid));
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

        // Determine what needs video
        const unmatchedJobs = jobs?.filter(j => !j.matched) || [];
        const videoSubject = unmatchedJobs.length > 0
            ? unmatchedJobs.map(j => j.description).join(', ')
            : 'the job';

        // Send WhatsApp video request
        const firstName = customerInfo.name.split(' ')[0] || 'there';

        // Try template first, fall back to freeform
        const VIDEO_REQUEST_TEMPLATE_SID = process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID || 'HX3ecffe34fcde66b5a64a964a306026f2';

        try {
            await sendWhatsAppMessage(normalizedPhone, '', {
                contentSid: VIDEO_REQUEST_TEMPLATE_SID,
                contentVariables: {
                    "1": firstName,
                    "2": videoSubject
                }
            });
            console.log(`[LiveCallAction] Video request template sent to ${normalizedPhone}`);
        } catch (templateError) {
            console.log('[LiveCallAction] Template failed, sending freeform message');
            // Fall back to freeform message
            const message = `Hi ${firstName}! 📹

To give you an accurate quote for ${videoSubject}, could you send me a quick video?

Just reply to this message with a short clip showing the area - even 10-15 seconds helps!

This way I can give you a proper price without needing to visit first. 👍`;

            await sendWhatsAppMessage(normalizedPhone, message);
        }

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
                    .where(eq(calls.callSid, callSid));
            } catch (callUpdateError) {
                console.error('[LiveCallAction] Failed to update call record:', callUpdateError);
            }
        }

        res.json({
            success: true,
            leadId,
            videoUploadUrl,
            message: `Video request sent to ${firstName}`,
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
// BOOK VISIT
// ================================================================
const bookVisitSchema = z.object({
    customerInfo: customerInfoSchema,
    jobs: z.array(jobSchema).optional(),
    callSid: z.string().optional(),
});

liveCallActionsRouter.post('/api/live-call/book-visit', async (req, res) => {
    try {
        console.log('[LiveCallAction] BOOK VISIT request:', JSON.stringify(req.body, null, 2));

        const input = bookVisitSchema.parse(req.body);
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

        // Update lead route and visit flag
        await db.update(leads)
            .set({
                route: 'site_visit',
                routeAssignedAt: new Date(),
                siteVisitScheduledAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(leads.id, leadId));

        // Send WhatsApp confirmation
        const firstName = customerInfo.name.split(' ')[0] || 'there';
        const address = customerInfo.address || 'your property';

        const message = `Hi ${firstName}! 🔧

Thanks for booking a diagnostic visit!

Here's what happens next:
✅ One of our experienced handymen will visit ${address}
✅ They'll assess the work and give you an exact quote on the spot
✅ £30 diagnostic fee (deducted from your final bill if you go ahead)

We'll be in touch shortly to confirm the best time for you.

Any questions in the meantime, just reply here! 👍`;

        try {
            await sendWhatsAppMessage(normalizedPhone, message);
            console.log(`[LiveCallAction] Visit confirmation sent to ${normalizedPhone}`);
        } catch (whatsappError) {
            console.error('[LiveCallAction] WhatsApp send failed:', whatsappError);
        }

        // Update call record if we have callSid
        if (callSid) {
            try {
                await db.update(calls)
                    .set({
                        outcome: 'VISIT_BOOKED',
                        leadId,
                        metadataJson: {
                            visitBookedAt: new Date().toISOString(),
                            diagnosticFee: 3000, // £30 in pence
                        },
                    })
                    .where(eq(calls.callSid, callSid));
            } catch (callUpdateError) {
                console.error('[LiveCallAction] Failed to update call record:', callUpdateError);
            }
        }

        res.json({
            success: true,
            leadId,
            diagnosticFee: '£30',
            message: `Visit booking confirmation sent to ${firstName}`,
        });

    } catch (error: any) {
        console.error('[LiveCallAction] BOOK VISIT error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ success: false, error: error.message || 'Failed to book visit' });
    }
});

export default liveCallActionsRouter;
