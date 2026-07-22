import { Router } from "express";
import { db } from "./db";
import { notifyQuoteViewed } from "./pushover";
import { personalizedQuotes, leads, insertPersonalizedQuoteSchema, handymanProfiles, productizedServices, serviceCatalog, segmentEnum, invoices, invoiceTokens, contractorJobs, contentClaims, contentGuarantees, contentTestimonials, contentHassleItems, contentImages, jobDispatches, dispatchBonds, users } from "@shared/schema";
import { eq, desc, inArray, or } from "drizzle-orm";
import crypto from 'crypto';
import { z } from "zod";
import { nanoid } from "nanoid";
import { openai, polishAssessmentReason, generatePersonalizedNote, determineQuoteStrategy, classifyLead, determineOptimalRoute } from "./openai";
import { generateEVEPricingQuote, generateTierDeliverables, getSegmentTierConfig, type EVEPricingResult } from "./eve-pricing-engine";
import { geocodeAddress } from "./lib/geocoding";
import { findBestContractors, checkNetworkAvailability } from "./availability-engine";
import { detectMultipleTasks } from "./skuDetector";
import { findDuplicateLead } from "./lead-deduplication";
import { normalizePhoneNumber } from "./phone-utils";
import { updateLeadStage } from "./lead-stage-engine";
import { captureServerEvent } from "./posthog";
import { optionalAuth } from "./auth";
import { getShortQuoteUrl, getBookVisitUrl } from "./url-utils";
import { normalizeQuoteImageUrls } from "./quote-image-utils";
import { computeLaneBasePence, parsePricingLane } from "./lane-pricing";
import { resolveOrCreateProperty } from "./properties";
import { resolveOrCreateClient } from "./clients";

// Base quote validity window (small jobs / fallback). Larger quotes get a
// longer window — see quoteValidityMs.
export const QUOTE_VALIDITY_MS = 48 * 60 * 60 * 1000;

// Price bands for the validity window, in pence.
export const QUOTE_VALIDITY_BAND_MID_PENCE = 25_000;   // £250
export const QUOTE_VALIDITY_BAND_HIGH_PENCE = 100_000; // £1,000

/**
 * Price-banded validity window (ms), keyed on the quote's price in PENCE.
 *
 * Small "book-now" jobs keep a tight 48h lock to preserve urgency. Larger,
 * considered purchases get a longer window: big quotes have a slower,
 * multi-person decision process (docs/PRICE-BARRIER-ANALYSIS-2026-07-02.md —
 * £1k+ close at ~14% vs ~46% under £250), so a flat 48h lock pushes exactly
 * those high-value customers into the expired reissue flow mid-decision.
 *
 *   < £250      → 48h
 *   £250–£1,000 → 72h
 *   > £1,000    → 7 days
 */
export function quoteValidityMs(pricePence?: number | null): number {
    const p = typeof pricePence === 'number' && Number.isFinite(pricePence) ? pricePence : 0;
    if (p >= QUOTE_VALIDITY_BAND_HIGH_PENCE) return 7 * 24 * 60 * 60 * 1000;
    if (p >= QUOTE_VALIDITY_BAND_MID_PENCE) return 72 * 60 * 60 * 1000;
    return QUOTE_VALIDITY_MS;
}

// Define input schema for value pricing
const valuePricingInputSchema = z.object({
    jobDescription: z.string().min(10, 'Job description must be at least 10 characters'),
    baseJobPrice: z.number().nonnegative('Base price must be non-negative'), // In pence
    urgencyReason: z.enum(['low', 'med', 'high']),
    ownershipContext: z.enum(['tenant', 'homeowner', 'landlord', 'airbnb', 'selling']),
    desiredTimeframe: z.enum(['flex', 'week', 'asap']),
    additionalNotes: z.string().optional(),
    customerName: z.string().min(1, 'Customer name is required'),
    phone: z.string().min(1, 'Phone number is required'),
    email: z.string().email().optional().or(z.literal('')),
    postcode: z.string().min(1, 'Postcode is required'),
    address: z.string().optional(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
    quoteMode: z.enum(['simple', 'hhh', 'pick_and_mix', 'consultation']).default('simple'), // Legacy field — always 'simple' for new quotes
    analyzedJobData: z.any().optional(), // Pass through AI analysis data

    materialsCostWithMarkupPence: z.number().nonnegative().optional(), // Materials with markup
    optionalExtras: z.array(z.any()).optional(), // Optional extras for simple mode
    jobComplexity: z.enum(['trivial', 'low', 'medium', 'high']).default('low'),

    contractorId: z.string().optional(),
    visitTierMode: z.enum(['standard', 'tiers']).default('standard'),
    clientType: z.enum(['residential', 'commercial']).default('residential'),
    assessmentReason: z.string().optional(),
    tierStandardPrice: z.number().int().optional(),
    tierPriorityPrice: z.number().int().optional(),
    tierEmergencyPrice: z.number().int().optional(),

    // Human-in-loop route selection
    selectedRoute: z.enum(['instant', 'tiers', 'assessment']).optional(),
    routeOverridden: z.boolean().optional(), // Track if human overrode AI recommendation
    proposalModeEnabled: z.boolean().default(true).optional(), // Now standard for all quotes

    // Manual Overrides
    manualClassification: z.any().optional(),
    manualSegment: segmentEnum.optional(),

    // EVE pricing: time estimate from SKU or manual entry
    timeEstimateMinutes: z.number().nonnegative().optional(),
});

export const quotesRouter = Router();

// Polish Assessment Reason with AI
// --- NEW: AI Quote Strategy Director ---
quotesRouter.post('/api/quote-strategy', async (req, res) => {
    try {
        const { jobDescription } = req.body;
        if (!jobDescription) return res.status(400).json({ error: "Job description required" });

        const strategy = await determineQuoteStrategy(jobDescription);
        res.json(strategy);
    } catch (error) {
        console.error("Strategy determination error:", error);
        res.status(500).json({ error: "Strategy determination failed" });
    }
});

// Polish Assessment Reason with AI (Legacy/Simple)
quotesRouter.post('/api/polish-assessment-reason', async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: "Reason is required" });

        const polished = await polishAssessmentReason(reason);
        res.json({ polished });
    } catch (error: any) {
        console.error("Polish reason error:", error);
        res.status(500).json({ error: "Polishing failed", polished: req.body.reason }); // Fallback to raw
    }
});

// Generate Personalized Expert Note (New)
quotesRouter.post('/api/generate-personalized-note', async (req, res) => {
    try {
        const { reason, customerName, postcode, address } = req.body;
        if (!reason || !customerName || !postcode) return res.status(400).json({ error: "Missing required fields" });

        const { note, summary } = await generatePersonalizedNote(reason, customerName, postcode, address);
        res.json({ note, summary });
    } catch (error: any) {
        console.error("Generate note error:", error);
        res.status(500).json({ error: "Generation failed", note: req.body.reason, summary: "assess the job" });
    }
});

// Generate contextual WhatsApp message from conversation context
quotesRouter.post('/api/generate-quote-message', async (req, res) => {
    try {
        const { conversationContext, customerName, jobDescription, segment, priceRange, quoteUrl } = req.body;

        if (!conversationContext || !quoteUrl) {
            return res.status(400).json({ error: "Conversation context and quote URL are required" });
        }

        const firstName = customerName?.split(' ')[0] || 'there';

        // Segment-specific tone and style guidelines
        const segmentStyles: Record<string, string> = {
            'BUSY_PRO': `TONE: Efficient, no-nonsense, respectful of their time.
STYLE: Brief, confident, action-oriented. Get straight to the point.
EXAMPLE VIBE: "Got that sorted for you - here's the quote, just pick a slot that works."`,

            'BUDGET': `TONE: Friendly, value-focused, reassuring about price.
STYLE: Warm but emphasize transparency and no hidden costs.
EXAMPLE VIBE: "Here's your quote - everything's included, no surprises."`,

            'OLDER_WOMAN': `TONE: Warm, patient, trustworthy, reassuring.
STYLE: Slightly more formal, emphasize reliability and that you'll take care of everything.
EXAMPLE VIBE: "I've put together your quote - take your time to look through it, and I'm here if you have any questions at all."`,

            'DIY_DEFERRER': `TONE: Understanding, encouraging, low-pressure.
STYLE: Acknowledge they've been meaning to sort this, make it easy.
EXAMPLE VIBE: "Finally getting this sorted! Here's the quote - nice and simple."`,

            'PROP_MGR': `TONE: Professional, efficient, business-like.
STYLE: Crisp, minimal fluff, just the facts.
EXAMPLE VIBE: "Quote attached for the job at [address]. Let me know if you need anything adjusted."`,

            'SMALL_BIZ': `TONE: Professional but personable, understand business needs.
STYLE: Emphasize minimal disruption, flexible scheduling.
EXAMPLE VIBE: "Here's your quote - we can work around your opening hours, just let me know what suits."`
        };

        const styleGuide = segmentStyles[segment] || segmentStyles['BUSY_PRO'];

        // Get hassle-framed value points for this segment
        const segValueLines = getWhatsAppValueLines(segment || 'UNKNOWN', 3);
        const valueContext = segValueLines.length > 0
            ? `\nVALUE POINTS FOR THIS SEGMENT (naturally weave ONE into your message before the quote link):\n${segValueLines.map(l => `- ${l}`).join('\n')}`
            : '';

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are crafting a WhatsApp message to send a quote to a customer. You're continuing an existing conversation.

SEGMENT: ${segment || 'BUSY_PRO'}
${styleGuide}
${valueContext}

STRUCTURE YOUR MESSAGE:
1. Brief, natural opening that flows from the conversation (reference what they discussed)
2. Naturally mention ONE value point that matters to this customer (from the list above)
3. Present the quote link
4. ALWAYS end with: "If you have any questions, just give me a shout" (or similar warm invitation to ask questions)

RULES:
- Keep it SHORT (under 80 words)
- Sound human, not like a template
- Reference specific details from their conversation
- Include the quote URL on its own line
- ONE emoji maximum (optional)
- NO price amounts (quote page shows that)
- NO formal greetings ("Dear", "Hi there")
- NO sign-offs or names at the end`
                },
                {
                    role: "user",
                    content: `CONVERSATION:
${conversationContext}

---
Customer: ${firstName}
Job: ${jobDescription || 'As discussed'}
Quote URL: ${quoteUrl}

Write the WhatsApp reply:`
                }
            ],
            temperature: 0.7,
            max_tokens: 200,
        });

        const message = response.choices[0]?.message?.content?.trim() || '';

        if (!message) {
            throw new Error('No message generated');
        }

        res.json({ message });
    } catch (error: any) {
        console.error("[generate-quote-message] Error:", error);
        res.status(500).json({ error: "Failed to generate message" });
    }
});

// Create Quote Endpoint
quotesRouter.post('/api/personalized-quotes/value', optionalAuth, async (req, res) => {
    try {
        console.log('[DEBUG-QUOTE] Received quote creation request. Body:', JSON.stringify(req.body, null, 2));
        const input = valuePricingInputSchema.parse(req.body);

        console.log('[DEBUG] Quote Gen Input Prices:', {
            std: input.tierStandardPrice,
            prio: input.tierPriorityPrice,
            emerg: input.tierEmergencyPrice
        });

        // Geocode coordinates if not provided (Phase 3 requirement)
        let coordinates = input.coordinates || null;
        if (!coordinates && input.postcode) {
            const geocoded = await geocodeAddress(input.postcode);
            if (geocoded) coordinates = { lat: geocoded.lat, lng: geocoded.lng };
        }

        // ROUTING BRAIN: Use manually selected route or classify for recommendation
        let leadClassification = null;
        let recommendedRoute = null;
        let finalRoute = input.selectedRoute || null; // Use selected route if provided

        // If no route was manually selected, classify and use AI recommendation
        if (!finalRoute) {
            try {
                // Classify the lead using AI
                leadClassification = await classifyLead(input.jobDescription);

                // Determine optimal route using business rules
                const routingDecision = determineOptimalRoute(leadClassification);
                recommendedRoute = routingDecision.route;
                finalRoute = recommendedRoute; // Use AI recommendation as fallback

                console.log('[Routing Brain] No manual route selected, using AI recommendation');
                console.log('[Routing Brain] Classification:', leadClassification);
                console.log('[Routing Brain] Recommended Route:', recommendedRoute, '-', routingDecision.reasoning);
            } catch (error) {
                console.error('[Routing Brain] Classification failed, defaulting to tiers:', error);
                // Fallback: default to 'tiers' route if classification fails
                finalRoute = 'tiers';
            }
        } else {
            console.log('[Routing Brain] Using manually selected route:', finalRoute);

            // Optionally still classify for audit trail (but don't use it)
            try {
                leadClassification = await classifyLead(input.jobDescription);
                const routingDecision = determineOptimalRoute(leadClassification);
                recommendedRoute = routingDecision.route;

                console.log('[Routing Brain] AI would have recommended:', recommendedRoute);
                console.log('[Routing Brain] Human selected:', finalRoute);
                console.log('[Routing Brain] Override:', recommendedRoute !== finalRoute);
            } catch (error) {
                console.log('[Routing Brain] Could not generate AI recommendation for comparison');
            }
        }

        // Apply Manual Overrides (F4/B4)
        if (input.manualClassification) {
            console.log('[Routing Brain] Applying manual classification overrides');
            leadClassification = {
                ...(leadClassification || {}),
                ...input.manualClassification
            };
        }

        if (input.manualSegment) {
            console.log('[Routing Brain] Applying manual segment override:', input.manualSegment);
            if (!leadClassification) {
                leadClassification = {
                    jobType: 'standard',
                    jobClarity: 'clear',
                    clientType: 'residential',
                    urgency: 'medium'
                };
            }
            leadClassification.segment = input.manualSegment;

            // All segments use simple/instant mode — single price per quote
            if (!input.selectedRoute) {
                finalRoute = 'instant';
                console.log('[Routing Brain] Segment-based routing: auto-selecting instant route for segment', input.manualSegment);
            }
        }

        // EVE single-price model: all quotes use 'simple' (one price)
        if (finalRoute === 'assessment') {
            input.quoteMode = 'consultation';
        } else {
            input.quoteMode = 'simple';
        }

        // MATCHING ENGINE (Phase 4)
        // Find best contractors based on location
        let matchingContractors: any[] = [];
        let availableDates: string[] = [];
        if (coordinates) {
            matchingContractors = await findBestContractors(coordinates);
            console.log(`[Matching] Found ${matchingContractors.length} contractors in range.`);

            // Check availability for next 14 days
            const next14Days = Array.from({ length: 14 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i + 1); // Start from tomorrow
                return d;
            });

            // Return simply dates where *someone* is available
            // For V1 Beta, if we have contractors, we assume available
            if (matchingContractors.length > 0) {
                availableDates = next14Days.map(d => d.toISOString().split('T')[0]);
            }
        }

        // Use nanoid for short slug if not generated by DB function
        const shortSlug = nanoid(8);
        const id = `quote_${nanoid()}`;

        // --- LEAD LINKING: Find or create lead to link quote ---
        let linkedLeadId: string | null = null;
        const normalizedPhone = normalizePhoneNumber(input.phone);

        if (normalizedPhone) {
            // Check for existing lead by phone (and other signals)
            const duplicateCheck = await findDuplicateLead(normalizedPhone, {
                customerName: input.customerName,
                postcode: input.postcode,
            });

            if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
                // Link to existing lead
                linkedLeadId = duplicateCheck.existingLead.id;
                console.log(`[Quote→Lead] Linked to existing lead ${linkedLeadId} (${duplicateCheck.matchReason})`);
            } else {
                // Create new lead from quote data
                linkedLeadId = `lead_quote_${Date.now()}`;
                await db.insert(leads).values({
                    id: linkedLeadId,
                    customerName: input.customerName,
                    phone: normalizedPhone,
                    email: input.email || null,
                    source: 'quote_creation',
                    jobDescription: input.jobDescription,
                    postcode: input.postcode,
                    addressRaw: input.address || null,
                    status: 'quote_sent',
                });
                console.log(`[Quote→Lead] Created new lead ${linkedLeadId} from quote`);
            }
        } else {
            console.warn(`[Quote→Lead] Could not normalize phone: ${input.phone}, quote will be unlinked`);
        }

        // B3.1: Map AI classification to schema enums
        // Map AI jobType ('commodity'/'subjective'/'fault'/'project') to schema enum
        let mappedJobType: 'SINGLE' | 'COMPLEX' | 'MULTIPLE' = 'SINGLE';
        if (leadClassification?.jobType) {
            if (leadClassification.jobType === 'project') {
                mappedJobType = 'COMPLEX';
            } else if (leadClassification.jobType === 'commodity' && leadClassification.jobClarity === 'known') {
                mappedJobType = 'SINGLE';
            } else if (leadClassification.jobType === 'fault' || leadClassification.jobClarity === 'complex') {
                mappedJobType = 'COMPLEX';
            }
            // Default to SINGLE for 'subjective' jobs
        }

        // Map to quotability based on route recommendation
        let mappedQuotability: 'INSTANT' | 'VIDEO' | 'VISIT' = 'INSTANT';
        if (finalRoute === 'instant') {
            mappedQuotability = 'INSTANT';
        } else if (finalRoute === 'assessment') {
            mappedQuotability = 'VISIT';
        } else if (leadClassification?.jobClarity === 'vague' || leadClassification?.jobType === 'fault') {
            mappedQuotability = 'VIDEO';
        }

        // Generate quote using EVE contextual pricing engine
        const pricingResult = generateEVEPricingQuote({
            urgencyReason: input.urgencyReason,
            ownershipContext: input.ownershipContext,
            desiredTimeframe: input.desiredTimeframe,
            baseJobPrice: input.baseJobPrice,

            clientType: input.clientType,
            jobComplexity: input.jobComplexity,
            // forcedQuoteStyle removed — single price model
            segment: input.manualSegment || leadClassification?.segment || 'UNKNOWN',
            jobType: mappedJobType,
            quotability: mappedQuotability,
            timeEstimateMinutes: input.timeEstimateMinutes,
        });

        // Sort extras high to low (Anchoring)
        if (input.optionalExtras) {
            input.optionalExtras.sort((a: any, b: any) => (b.priceInPence || 0) - (a.priceInPence || 0));
        }

        // Generate deliverables for the quote
        const aiTierDeliverables = generateTierDeliverables(input.analyzedJobData, input.jobDescription);
        const segmentConfig = getSegmentTierConfig(input.manualSegment || leadClassification?.segment || 'UNKNOWN');

        // Merge segment-specific deliverables with AI-generated ones (use hassleFree as the single set)
        const deliverables = Array.from(new Set([
            ...segmentConfig.hassleFree.deliverables,
            ...aiTierDeliverables.hassleFree,
        ]));

        // Resolve the spine entities up front so the quote is linked to its
        // property (WHERE) and client (WHO) from creation — not just at booking.
        const resolvedPropertyId = await resolveOrCreateProperty(db, {
            address: input.address,
            coordinates,
            postcode: input.postcode,
            phone: input.phone,
            email: input.email,
        });
        const resolvedClientId = await resolveOrCreateClient(db, {
            phone: input.phone,
            email: input.email,
            displayName: input.customerName,
            billingAddress: input.address,
        });

        // Prepare quote data
        const quoteInsertData = {
            id,
            shortSlug,
            leadId: linkedLeadId, // Link to lead (fixes orphaned quotes)
            propertyId: resolvedPropertyId ?? undefined, // Spine property (WHERE)
            clientId: resolvedClientId ?? undefined,     // Spine client (WHO)
            contractorId: input.contractorId || null, // Capture contractor ID
            customerName: input.customerName,
            phone: input.phone,
            email: input.email || null,
            address: input.address || null, // Capture full address
            postcode: input.postcode,
            coordinates, // Store geocoded coordinates
            jobDescription: input.jobDescription,
            quoteMode: input.quoteMode,
            visitTierMode: input.visitTierMode, // Store the visit tier preference
            assessmentReason: input.assessmentReason,
            // Diagnostic visit tier prices (deprecated — kept for backward compat)
            tierStandardPrice: input.tierStandardPrice,
            tierPriorityPrice: input.tierPriorityPrice,
            tierEmergencyPrice: input.tierEmergencyPrice,

            // Routing Brain Data
            recommendedRoute: finalRoute,
            leadClassification,

            // EVE single price — stored in basePrice only
            basePrice: pricingResult.price,
            // Backfill deprecated tier columns with same value for backward compat
            essentialPrice: pricingResult.price,
            enhancedPrice: pricingResult.price,
            elitePrice: pricingResult.price,

            // Context & Inputs
            urgencyReason: input.urgencyReason,
            ownershipContext: input.ownershipContext,
            desiredTimeframe: input.desiredTimeframe,
            baseJobPricePence: input.baseJobPrice,
            valueMultiplier100: Math.round(pricingResult.valueMultiplier * 100),
            recommendedTier: 'hassleFree', // Legacy field — single price model
            additionalNotes: input.additionalNotes || null,

            // Metadata
            jobs: input.analyzedJobData ? [input.analyzedJobData] : null,
            tierDeliverables: {
                essential: deliverables,
                hassleFree: deliverables,
                highStandard: deliverables,
            },
            materialsCostWithMarkupPence: input.materialsCostWithMarkupPence || 0,
            optionalExtras: input.optionalExtras || null,

            // B3.4: Phase 1 Segmentation Fields
            segment: input.manualSegment || leadClassification?.segment || 'UNKNOWN',
            jobType: mappedJobType,
            quotability: mappedQuotability,

            // Proposal Mode - Now standard for all quotes (always enabled)
            proposalModeEnabled: input.proposalModeEnabled ?? true,

            // Quote attribution (VA commission tracking)
            createdBy: (req as any).user?.id || null,
            createdByName: (req as any).user
                ? `${(req as any).user.firstName || ''} ${(req as any).user.lastName || ''}`.trim() || null
                : null,

            createdAt: new Date(),
            // Price-banded validity window — anchors the customer page's price-lock timer
            expiresAt: new Date(Date.now() + quoteValidityMs(pricingResult.price)),
        };

        // Insert into DB
        await db.insert(personalizedQuotes).values(quoteInsertData);

        // Update lead stage to 'quote_sent' if we have a linked lead
        if (linkedLeadId) {
            try {
                await updateLeadStage(linkedLeadId, 'quote_sent', {
                    reason: 'Quote created',
                });
                console.log(`[Quote→Stage] Updated lead ${linkedLeadId} stage to quote_sent`);

                // Broadcast quote sent event for Pipeline dashboard
                const { broadcastPipelineActivity } = await import('./pipeline-events');
                broadcastPipelineActivity({
                    type: 'quote_sent',
                    leadId: linkedLeadId,
                    customerName: input.customerName,
                    summary: `Quote created (${shortSlug})`,
                    icon: '📝',
                    data: {
                        quoteId: id,
                        shortSlug,
                        quoteMode: input.quoteMode,
                    },
                });
            } catch (stageError) {
                console.error(`[Quote→Stage] Failed to update lead stage:`, stageError);
                // Don't fail quote creation if stage update fails
            }
        }

        // Response — single price model
        const responsePayload = {
            ...quoteInsertData,
            valueMultiplier: pricingResult.valueMultiplier,
            basePrice: pricingResult.price,

            // Availability Data
            availability: {
                hasContractors: matchingContractors.length > 0,
                availableDates: availableDates,
                matchCount: matchingContractors.length
            }
        };

        res.status(201).json(responsePayload);

    } catch (error: any) {
        console.error('Error creating quote:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        res.status(500).json({ message: `Failed to create quote: ${error.message || 'Unknown error'}` });
    }
});

// Analyze Job Endpoint
quotesRouter.post('/api/analyze-job', async (req, res) => {
    try {
        const { jobDescription, optionalExtrasRaw, hourlyRate = 50, rateCard = {} } = req.body;
        if (!jobDescription) return res.status(400).json({ error: "Job description is required" });

        // 1. Fetch System Master Categories from DB
        let systemCategories: string[] = [];
        try {
            const allServices = await db.select().from(productizedServices);
            systemCategories = Array.from(new Set(allServices.map(s => s.category).filter(Boolean).map(c =>
                // Normalize capitalisation (e.g. "plumbing" -> "Plumbing")
                c!.charAt(0).toUpperCase() + c!.slice(1).toLowerCase()
            )));
        } catch (dbError) {
            console.warn("Failed to fetch system categories for AI prompt, proceeding without them:", dbError);
            // Proceed with empty systemCategories
        }

        const systemCatString = systemCategories.join(', ');

        const rateCardString = Object.entries(rateCard).map(([k, v]) => `${k} at £${v}/hr`).join(', ');
        const ratesContext = rateCardString
            ? `Use these specific contractor rates where applicable: ${rateCardString}. For unlisted tasks use default £${hourlyRate}/hr.`
            : `Estimate at flat £${hourlyRate}/hr.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `Analyze this handyman job description. Return JSON with:
                    - totalEstimatedHours (number)
                    - basePricePounds (number) - calculated by summing (task hours * task rate)
                    - summary (string, professional summary)
                    - tasks (array of objects with description, estimatedHours, category, appliedRate)
                    - tasks (array of objects with description, estimatedHours, category, appliedRate).
                    
                    ${ratesContext}
                    SYSTEM CATEGORIES: [${systemCatString}]

                    Identify the category for each task.
                    IMPORTANT:
                    - Priority 1: If the task fits a category in the provided rate card, use that CATEGORY and appliedRate.
                    - Priority 2: If the task does NOT fit a rate card category, map it to one of the SYSTEM CATEGORIES provided above. Set appliedRate to 0.
                    - If it fits neither, use "General" and set appliedRate to 0.
                    
                    - basePricePounds should be the sum of (estimatedHours * appliedRate) (using 0 for missing rates). Do NOT add any callout fee.
                    1. Clarity: Write a concise, objective summary of the work.
                    2. Tone: Professional and neutral.
                    3. No Intro: Start directly with the summary.
                    
                    Use the provided rates strictly.`
                },
                {
                    role: "user",
                    content: jobDescription
                }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");

        // Recalculate totals programmatically to ensure math is correct (AI often fails arithmetic)
        if (result.tasks && Array.isArray(result.tasks)) {
            let calculatedTotalHours = 0;
            let calculatedPrice = 0;

            result.tasks.forEach((t: any) => {
                const hours = Number(t.estimatedHours) || 0;
                const rate = Number(t.appliedRate) || 0;
                calculatedTotalHours += hours;
                calculatedPrice += (hours * rate);
            });

            result.totalEstimatedHours = calculatedTotalHours;
            result.basePricePounds = calculatedPrice; // Standard sum, no callout
        }


        // Run hybrid SKU detection
        let suggestedSkus: {
            taskDescription: string;
            skuName: string;
            pricePence: number;
            confidence: number;
            id: string;
        }[] = [];
        try {
            const skuResult = await detectMultipleTasks(jobDescription);
            if (skuResult.hasMatches) {
                suggestedSkus = skuResult.matchedServices.map((m: any) => ({
                    taskDescription: m.task.description,
                    skuName: m.sku.name,
                    pricePence: m.sku.pricePence,
                    confidence: m.confidence,
                    id: m.sku.id
                }));
            }
        } catch (e) {
            console.error("SKU Detection failed:", e);
        }

        res.json({ ...result, suggestedSkus });

    } catch (error: any) {
        console.error("AI Analysis Failed:", error);

        // Fallback Mock Response (if AI/DB fails)
        res.json({
            summary: "Unable to analyze with AI. Using estimation based on description length.",
            totalEstimatedHours: 4, // use totalEstimatedHours to match success schema
            basePricePounds: 200, // 4 * 50 (No callout)
            tasks: [
                { description: "General Labor & Assessment", estimatedHours: 4, category: "General", appliedRate: 50 },
            ],
            optionalExtras: []
        });
    }
});

// Parse Optional Extra
quotesRouter.post('/api/parse-optional-extra', async (req, res) => {
    try {
        const { extraDescription } = req.body;
        if (!extraDescription) return res.status(400).json({ error: "Description required" });

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "Extract optional extra details: label, description, priceInPence (estimate), estimatedHours, materialsCost."
                },
                {
                    role: "user",
                    content: `Extract details for: ${extraDescription}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");
        // Ensure defaults
        const cleanResult = {
            label: result.label || "Extra",
            description: result.description || extraDescription,
            priceInPence: result.priceInPence || 5000,
            estimatedHours: result.estimatedHours || 1,
            materialsCost: result.materialsCost || 0,
            serviceType: 'general',
            complexity: 'moderate'
        };

        res.json(cleanResult);
    } catch (error) {
        console.error("Parse extra error:", error);
        res.status(500).json({ error: "Parsing failed" });
    }
});

// Recalculate Optional Extra Price
quotesRouter.post('/api/recalculate-optional-extra', async (req, res) => {
    try {
        const { serviceType, complexity, estimatedHours, materialsCost } = req.body;

        // Simple calculation logic without AI for speed
        const baseRate = 5000; // £50/hr
        const complexityMultipliers: Record<string, number> = {
            'trivial': 0.8, 'low': 0.9, 'moderate': 1.0, 'medium': 1.0,
            'high': 1.25, 'complex': 1.5, 'very_complex': 2.0
        };

        const multiplier = complexityMultipliers[complexity as string] || 1.0;
        const laborCostInPence = Math.round(estimatedHours * baseRate * multiplier);
        const materialsCostInPence = Math.round((materialsCost || 0) * 100); // input is pounds, store Pence
        const calloutFeeInPence = 0; // Optional Extras usually done while on site

        const priceInPence = laborCostInPence + materialsCostInPence;

        res.json({
            serviceType,
            complexity,
            estimatedHours,
            materialsCost,
            priceInPence,
            materialsCostInPence,
            laborCostInPence,
            calloutFeeInPence
        });

    } catch (error) {
        console.error("Recalculate extra error:", error);
        res.status(500).json({ error: "Recalculation failed" });
    }
});

// Payment-status poll — the post-payment redirect to /q/:slug?paid=1 races the
// Stripe webhook that writes depositPaidAt, so the quote page polls this until
// the webhook lands. Deliberately separate from the GET below: this endpoint
// must NOT touch view statistics (every hit of the main GET increments viewCount).
quotesRouter.get('/api/personalized-quotes/:slug/payment-status', async (req, res) => {
    try {
        const { slug } = req.params;
        const fields = { id: personalizedQuotes.id, depositPaidAt: personalizedQuotes.depositPaidAt };
        let result = await db.select(fields).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
        if (result.length === 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
            result = await db.select(fields).from(personalizedQuotes).where(eq(personalizedQuotes.id, slug)).limit(1);
        }
        if (!result[0]) return res.status(404).json({ error: "Quote not found" });
        return res.json({ depositPaid: !!result[0].depositPaidAt, depositPaidAt: result[0].depositPaidAt });
    } catch (error) {
        console.error("Payment status error:", error);
        return res.status(500).json({ error: "Failed to fetch payment status" });
    }
});

// Get Quote by Slug
quotesRouter.get('/api/personalized-quotes/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        let result = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);

        // Fallback: If not found and looks like UUID, try ID
        if (result.length === 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
            result = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, slug)).limit(1);
        }

        const quote = result[0];

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        // Internal admin preview (?preview=1) shows the quote WITHOUT logging a
        // view — no count bump, no viewedAt, no first-view side-effects. Lets Ben
        // check/QA quotes freely without polluting conversion stats.
        const isPreview = req.query.preview === '1';

        // Track view statistics
        const now = new Date();
        const isFirstView = !quote.viewedAt && !isPreview;
        if (!isPreview) {
            await db.update(personalizedQuotes)
                .set({
                    viewedAt: quote.viewedAt || now, // Keep original first view time
                    lastViewedAt: now,
                    viewCount: (quote.viewCount || 0) + 1
                })
                .where(eq(personalizedQuotes.id, quote.id));

            // Return updated stats
            quote.viewCount = (quote.viewCount || 0) + 1;
        }

        // Phone push alert (Pushover) — customer opened their quote (first view only)
        if (isFirstView) {
            notifyQuoteViewed({
                customerName: quote.customerName,
                phoneNumber: quote.phone,
                jobSummary: quote.jobDescription,
                valuePence: (quote as any).basePrice || null,
            }).catch((e) => console.warn('[Quotes] notifyQuoteViewed failed:', e));
        }

        // PostHog: Server-side quote view (reliable — immune to ad-blockers)
        const viewDistinctId = quote.phone || quote.id;
        if (!isPreview) captureServerEvent(viewDistinctId, 'cq_server_quote_viewed', {
            quote_id: quote.id,
            short_slug: quote.shortSlug,
            segment: (quote as any).segment || 'UNKNOWN',
            is_first_view: isFirstView,
            view_count: quote.viewCount,
            total_price_pence: (quote as any).basePrice || 0,
            layout_tier: (quote as any).layoutTier || null,
            has_contextual_pricing: !!(quote as any).pricingLineItems,
            hours_since_creation: quote.createdAt
                ? Math.round((Date.now() - new Date(quote.createdAt).getTime()) / 3600000)
                : 0,
            // $set attaches these as person properties on the PostHog profile
            $set: {
                name: quote.customerName,
                phone: quote.phone,
                email: quote.email || undefined,
                segment: (quote as any).segment || 'UNKNOWN',
                postcode: (quote as any).postcode || undefined,
                last_quote_viewed_at: now.toISOString(),
            },
        });

        // Update lead stage to 'quote_viewed' if this is the first view and we have a linked lead
        if (isFirstView && quote.leadId) {
            try {
                await updateLeadStage(quote.leadId, 'quote_viewed', {
                    reason: 'Customer viewed quote',
                });
                console.log(`[Quote→Stage] Updated lead ${quote.leadId} stage to quote_viewed`);

                // Broadcast quote viewed event for Pipeline dashboard
                const { broadcastPipelineActivity } = await import('./pipeline-events');
                broadcastPipelineActivity({
                    type: 'quote_viewed',
                    leadId: quote.leadId,
                    customerName: quote.customerName,
                    summary: `Quote viewed by customer`,
                    icon: '👁️',
                    data: {
                        quoteId: quote.id,
                        shortSlug: quote.shortSlug,
                    },
                });
            } catch (stageError) {
                console.error(`[Quote→Stage] Failed to update lead stage on view:`, stageError);
                // Don't fail quote fetch if stage update fails
            }
        }

        // Contractor details no longer sent to customer — contractors are assigned post-payment via dispatch pool
        const contractorDetails = null;

        // MATCHING ENGINE: Calculate real-time availability
        let matchingContractors: any[] = [];
        let availableDates: string[] = [];

        // Coordinates are stored as jsonb
        const coordinates = quote.coordinates as { lat: number, lng: number } | null;

        if (coordinates) {
            matchingContractors = await findBestContractors(coordinates);

            // Check availability for next 14 days
            const next14Days = Array.from({ length: 14 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i + 1); // Start from tomorrow
                return d;
            });

            if (matchingContractors.length > 0) {
                availableDates = next14Days.map(d => d.toISOString().split('T')[0]);
            }
        }

        // Enrich with content library objects from selectedContentIds
        let selectedContent: {
            guarantee: { id: number; title: string; description: string | null; items: unknown; badges: unknown } | null;
            testimonials: { id: number; author: string; location: string | null; text: string; rating: number; jobCategories: string[] | null }[];
            hassleItems: { id: number; withoutUs: string; withUs: string }[];
            claims: { id: number; text: string; category: string | null }[];
            images: { id: number; url: string; alt: string | null; placement: string | null }[];
        } | null = null;

        const contentIds = (quote as any).selectedContentIds as {
            claimIds?: number[];
            guaranteeId?: number | null;
            testimonialIds?: number[];
            hassleItemIds?: number[];
            imageIds?: number[];
        } | null | undefined;

        if (contentIds) {
            try {
                const [
                    guaranteeRows,
                    testimonialRows,
                    hassleItemRows,
                    claimRows,
                    imageRows,
                ] = await Promise.all([
                    contentIds.guaranteeId != null
                        ? db.select({
                            id: contentGuarantees.id,
                            title: contentGuarantees.title,
                            description: contentGuarantees.description,
                            items: contentGuarantees.items,
                            badges: contentGuarantees.badges,
                          }).from(contentGuarantees).where(eq(contentGuarantees.id, contentIds.guaranteeId)).limit(1)
                        : Promise.resolve([]),
                    contentIds.testimonialIds && contentIds.testimonialIds.length > 0
                        ? db.select({
                            id: contentTestimonials.id,
                            author: contentTestimonials.author,
                            location: contentTestimonials.location,
                            text: contentTestimonials.text,
                            rating: contentTestimonials.rating,
                            jobCategories: contentTestimonials.jobCategories,
                          }).from(contentTestimonials).where(inArray(contentTestimonials.id, contentIds.testimonialIds))
                        : Promise.resolve([]),
                    contentIds.hassleItemIds && contentIds.hassleItemIds.length > 0
                        ? db.select({
                            id: contentHassleItems.id,
                            withoutUs: contentHassleItems.withoutUs,
                            withUs: contentHassleItems.withUs,
                          }).from(contentHassleItems).where(inArray(contentHassleItems.id, contentIds.hassleItemIds))
                        : Promise.resolve([]),
                    contentIds.claimIds && contentIds.claimIds.length > 0
                        ? db.select({
                            id: contentClaims.id,
                            text: contentClaims.text,
                            category: contentClaims.category,
                          }).from(contentClaims).where(inArray(contentClaims.id, contentIds.claimIds))
                        : Promise.resolve([]),
                    contentIds.imageIds && contentIds.imageIds.length > 0
                        ? db.select({
                            id: contentImages.id,
                            url: contentImages.url,
                            alt: contentImages.alt,
                            placement: contentImages.placement,
                          }).from(contentImages).where(inArray(contentImages.id, contentIds.imageIds))
                        : Promise.resolve([]),
                ]);

                // Normalize legacy local .jpg/.png image URLs to their .webp twin
                // at read time (covers all existing quotes, no migration needed).
                // S3 content-library URLs and unknown names are left untouched.
                selectedContent = normalizeQuoteImageUrls({
                    guarantee: guaranteeRows[0] ?? null,
                    testimonials: testimonialRows,
                    hassleItems: hassleItemRows,
                    claims: claimRows,
                    images: imageRows,
                });
            } catch (contentFetchError) {
                console.warn('[Quote GET] Failed to fetch selectedContent (non-blocking):', contentFetchError instanceof Error ? contentFetchError.message : contentFetchError);
                // selectedContent stays null — frontend falls back to hardcoded defaults
            }
        }

        // Enrich with segment-specific tier names
        // Use the direct segment field from database (B3.4), fallback to leadClassification for legacy quotes
        const quoteSegment = quote.segment || ((quote as any).leadClassification as any)?.segment || 'UNKNOWN';
        const segmentConfig = getSegmentTierConfig(quoteSegment);

        // Resolve post-commitment upsell SKUs from the primary line item's upsell list
        let upsellSkus: Array<{ skuCode: string; name: string; pricePence: number; customerDescription: string; shape: string }> = [];
        try {
            const lineItems = (quote.pricingLineItems as any[]) || [];
            const primarySkuCodes = lineItems
                .filter((l: any) => l.source === 'sku' && l.skuCode)
                .map((l: any) => l.skuCode as string)
                .slice(0, 3);

            if (primarySkuCodes.length > 0) {
                const primaryRows = await db
                    .select({ skuCode: serviceCatalog.skuCode, upsellSkuCodes: serviceCatalog.upsellSkuCodes })
                    .from(serviceCatalog)
                    .where(inArray(serviceCatalog.skuCode, primarySkuCodes));

                const upsellCodes = primaryRows
                    .flatMap((r: any) => (r.upsellSkuCodes as string[] | null) ?? [])
                    .filter((c: string) => !primarySkuCodes.includes(c));
                const unique = [...new Set(upsellCodes)].slice(0, 3);

                if (unique.length > 0) {
                    const upsellRows = await db
                        .select({
                            skuCode: serviceCatalog.skuCode,
                            name: serviceCatalog.name,
                            shape: serviceCatalog.shape,
                            pricePence: serviceCatalog.pricePence,
                            pricePerUnitPence: serviceCatalog.pricePerUnitPence,
                            tiers: serviceCatalog.tiers,
                            customerDescription: serviceCatalog.customerDescription,
                        })
                        .from(serviceCatalog)
                        .where(inArray(serviceCatalog.skuCode, unique));

                    upsellSkus = upsellRows.map((r: any) => {
                        let displayPence = 0;
                        if (r.shape === 'fixed') displayPence = r.pricePence ?? 0;
                        else if (r.shape === 'per_unit') displayPence = r.pricePerUnitPence ?? 0;
                        else if (r.shape === 'tiered' && r.tiers?.length) displayPence = r.tiers[0].pricePence ?? 0;
                        return {
                            skuCode: r.skuCode,
                            name: r.name,
                            shape: r.shape,
                            pricePence: displayPence,
                            customerDescription: r.customerDescription,
                        };
                    }).sort((a, b) => a.pricePence - b.pricePence);
                }
            }
        } catch (upsellErr) {
            // Non-blocking — upsell enrichment failure must never break the quote page
            console.warn('[Quote] Upsell lookup failed:', upsellErr);
        }

        // Effective expiry — legacy rows predate expiresAt being set at creation,
        // so fall back to createdAt + 48h. The client price-lock timer always
        // receives a real anchor, never null.
        const effectiveExpiresAt = quote.expiresAt
            ?? (quote.createdAt
                ? new Date(new Date(quote.createdAt).getTime() + QUOTE_VALIDITY_MS)
                : new Date(Date.now() + QUOTE_VALIDITY_MS));

        // Contractor platform: attach the SOFT lead's REAL profile so the quote
        // skin (name/photo/bio/rating/badges) reflects the actual assigned
        // handyman from the Contractor Hub, not hardcoded placeholders. Null →
        // the client falls back to its defaults.
        let leadContractor: any = null;
        const leadId = (quote as any).leadContractorId as string | null;
        if (leadId) {
            try {
                const [lc] = await db.select({
                    id: handymanProfiles.id,
                    firstName: users.firstName,
                    businessName: handymanProfiles.businessName,
                    profileImageUrl: handymanProfiles.profileImageUrl,
                    heroImageUrl: handymanProfiles.heroImageUrl,
                    bio: handymanProfiles.bio,
                    reviews: handymanProfiles.reviews,
                    trustBadges: handymanProfiles.trustBadges,
                })
                    .from(handymanProfiles)
                    .leftJoin(users, eq(handymanProfiles.userId, users.id))
                    .where(eq(handymanProfiles.id, leadId))
                    .limit(1);
                if (lc) {
                    const reviews = Array.isArray(lc.reviews) ? (lc.reviews as any[]) : [];
                    const rating = reviews.length
                        ? Math.round((reviews.reduce((s, r) => s + (Number(r?.rating) || 0), 0) / reviews.length) * 10) / 10
                        : null;
                    leadContractor = {
                        id: lc.id,
                        name: lc.firstName || lc.businessName || null,
                        imageUrl: lc.profileImageUrl || lc.heroImageUrl || null,
                        bio: lc.bio || null,
                        rating,
                        jobsCount: reviews.length || null,
                        badges: Array.isArray(lc.trustBadges) ? (lc.trustBadges as string[]) : null,
                    };
                }
            } catch (e) {
                console.warn('[Quote] lead contractor lookup failed:', e instanceof Error ? e.message : e);
            }
        }

        res.json({
            ...quote,
            leadContractor,
            expiresAt: effectiveExpiresAt,
            segment: quoteSegment, // Use the direct field from database (B3.4)
            // Enriched Tier Objects for Frontend Display
            tierConfig: segmentConfig, // Pass the full config for ease
            essential: {
                name: segmentConfig.essential.name,
                description: segmentConfig.essential.description,
                price: quote.essentialPrice, // Existing price
            },
            hassleFree: {
                name: segmentConfig.hassleFree.name,
                description: segmentConfig.hassleFree.description,
                price: quote.enhancedPrice,
            },
            highStandard: {
                name: segmentConfig.highStandard.name,
                description: segmentConfig.highStandard.description,
                price: quote.elitePrice,
            },
            contractor: contractorDetails,
            availability: {
                hasContractors: matchingContractors.length > 0,
                availableDates: availableDates,
                matchCount: matchingContractors.length
            },
            selectedContent,
            upsellSkus,
        });

    } catch (error) {
        console.error("Get quote error:", error);
        res.status(500).json({ error: "Failed to fetch quote" });
    }
});

// List all personalized quotes (for admin Generated Quotes tab)
quotesRouter.get('/api/personalized-quotes', async (req, res) => {
    try {
        const allQuotes = await db.select().from(personalizedQuotes)
            .orderBy(desc(personalizedQuotes.createdAt));

        // Augment each quote with its dispatch + bond status (if any) so the admin
        // Recent Quotes card can show "Dispatched · Richard N · bond £20 held".
        // Strategy: one batched lookup of dispatches keyed by quote_id, then a
        // second batched lookup of bonds + contractor names for the locked ones.
        const quoteIds = allQuotes.map((q) => q.id);
        const dispatchRows = quoteIds.length
            ? await db.select().from(jobDispatches).where(inArray(jobDispatches.quoteId, quoteIds))
            : [];

        // For locked dispatches, fetch the contractor name + their held bond
        const lockedContractorIds = dispatchRows
            .map((d) => d.lockedToContractorId)
            .filter((id): id is string => !!id);
        const lockedDispatchIds = dispatchRows
            .filter((d) => d.status === 'locked' || d.status === 'completed')
            .map((d) => d.id);

        const [contractorRows, bondRows] = await Promise.all([
            lockedContractorIds.length
                ? db.select({
                    id: handymanProfiles.id,
                    businessName: handymanProfiles.businessName,
                    firstName: users.firstName,
                    lastName: users.lastName,
                  }).from(handymanProfiles)
                    .leftJoin(users, eq(handymanProfiles.userId, users.id))
                    .where(inArray(handymanProfiles.id, lockedContractorIds))
                : Promise.resolve([] as Array<{ id: string; businessName: string | null; firstName: string | null; lastName: string | null }>),
            lockedDispatchIds.length
                ? db.select().from(dispatchBonds).where(inArray(dispatchBonds.dispatchId, lockedDispatchIds))
                : Promise.resolve([] as any[]),
        ]);

        const contractorById = new Map(contractorRows.map((c) => [c.id, c]));
        const bondByDispatch = new Map(bondRows.map((b: any) => [b.dispatchId, b]));
        const dispatchByQuote = new Map(dispatchRows.map((d) => [d.quoteId, d]));

        const augmented = allQuotes.map((q) => {
            const d = dispatchByQuote.get(q.id);
            if (!d) return { ...q, dispatch: null };
            const c = d.lockedToContractorId ? contractorById.get(d.lockedToContractorId) : null;
            const bond = bondByDispatch.get(d.id);
            return {
                ...q,
                dispatch: {
                    id: d.id,
                    status: d.status,
                    publicToken: d.publicToken,
                    lockedAt: d.lockedAt,
                    contractorName: c
                        ? (c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || null)
                        : null,
                    bondStatus: bond?.status || null, // 'pending' | 'held' | 'refunded' | 'forfeited' | 'failed'
                    bondAmountPence: bond?.amountPence ?? d.bondAmountPence ?? null,
                    bondPaidAt: bond?.paidAt || null,
                },
            };
        });

        res.json(augmented);
    } catch (error) {
        console.error("List quotes error:", error);
        res.status(500).json({ error: "Failed to fetch quotes" });
    }
});

// Track package selection (when customer clicks a tier)
quotesRouter.put('/api/personalized-quotes/:id/track-selection', async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedPackage } = req.body;

        // Fetch the quote to get leadId
        const [quote] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        await db.update(personalizedQuotes)
            .set({ selectedPackage, selectedAt: new Date() })
            .where(eq(personalizedQuotes.id, id));

        // Update lead stage to 'awaiting_payment' if we have a linked lead
        if (quote?.leadId) {
            try {
                await updateLeadStage(quote.leadId, 'awaiting_payment', {
                    reason: `Package selected: ${selectedPackage}`,
                });
                console.log(`[Quote→Stage] Updated lead ${quote.leadId} stage to awaiting_payment`);
            } catch (stageError) {
                console.error(`[Quote→Stage] Failed to update lead stage on selection:`, stageError);
                // Don't fail selection tracking if stage update fails
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Track selection error:", error);
        res.status(500).json({ error: "Failed to track selection" });
    }
});

// Track booking (when customer completes payment)
quotesRouter.put('/api/personalized-quotes/:id/track-booking', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            leadId,
            selectedPackage,
            selectedExtras,
            paymentType,
            // Scheduling fields
            selectedDate,
            selectedDates, // 3-date buffer: array of ISO date strings
            dateTimePreferences, // Per-date time prefs: [{date, timeSlot}]
            schedulingTier,
            timeSlotType,
            exactTimeRequested,
            isWeekendBooking,
            schedulingFeeInPence,
            // Phase 25 flex — the chosen flex window ("we pick a day within N days").
            // Belt-and-suspenders with the Stripe webhook, which is the authoritative writer.
            flexBookingWithinDays,
            // Pricing lane ('flex' | 'date_time') — the SERVER re-derives the £ from
            // quote.basePrice so the persisted selectedTierPricePence matches the charge.
            pricingLane,
            // Phase 30 — door address captured in the customer quote booking section
            address,
            coordinates,
            // Landlord liaise-with-tenant — tenant contact for ops to arrange access
            liaiseWithTenant,
            tenantName,
            tenantMobile,
        } = req.body;

        console.log(`[track-booking] Quote ${id} — date: ${selectedDate}, timeSlot: ${timeSlotType}, tier: ${schedulingTier}, weekend: ${isWeekendBooking}, fee: ${schedulingFeeInPence}p`);

        // Calculate selected tier price
        const [quote] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        // Single price model — use basePrice (fall back to legacy tier columns),
        // re-deriving the lane-adjusted price server-side so this mirror of the price
        // matches what /create-payment-intent actually charged. No lane → flat base.
        const trackLane = parsePricingLane(pricingLane);
        const trackLanePricing = computeLaneBasePence(
            quote.basePrice || quote.essentialPrice || 0,
            quote.contextSignals,
            trackLane,
        );
        const selectedTierPricePence = trackLanePricing.laneBasePence;

        // Calculate deposit ONLY when paymentType === 'deposit'.
        // For 'full' (and 'installments'), the Stripe webhook is the sole writer of
        // depositAmountPence — it stores the actual amount_received from Stripe.
        // If we wrote the 30% calc here unconditionally, the browser firing this
        // endpoint AFTER the webhook would overwrite the real charge amount with
        // the 30% estimate, making the DB/CRM understate revenue for pay-in-full
        // customers (see Stripe reconciliation, May 2026).
        const depositAmountUpdate: { depositAmountPence?: number } = {};
        if (paymentType === 'deposit') {
            const materialsCost = quote.materialsCostWithMarkupPence || 0;
            const laborCost = Math.max(0, selectedTierPricePence - materialsCost);
            depositAmountUpdate.depositAmountPence = materialsCost + Math.round(laborCost * 0.30);
        }

        // Phase 32 — defense-in-depth: never let this fire-and-forget PUT DOWNGRADE
        // the Stripe webhook's authoritative 'deposit' to 'full'. The legacy client
        // sent a stale 'full' (its paymentMode state never learned the inline deposit
        // choice); landing after the webhook it mislabelled ~84% of deposit bookings
        // as paid-in-full, which then told those customers "nothing more to pay" on
        // the confirmation page while they still owed ~70%. The webhook writes
        // paymentType from PI metadata (the card's real choice), so if the row is
        // already 'deposit' we keep it regardless of what this PUT claims.
        const effectivePaymentType =
            (paymentType === 'full' && quote.paymentType === 'deposit')
                ? 'deposit'
                : paymentType;
        if (effectivePaymentType !== paymentType) {
            console.warn(`[track-booking] Quote ${id} — blocked paymentType downgrade '${quote.paymentType}'→'${paymentType}'; keeping '${effectivePaymentType}' (webhook authoritative)`);
        }
        // Customer-facing cash (OAP "pay cash on the day"). No Stripe webhook will
        // ever fire for these, so this route is the sole confirmer of the booking.
        const isCashBooking = effectivePaymentType === 'cash';

        // NOTE: depositPaidAt is NOT set here - it will be set by the Stripe webhook
        // when the payment is confirmed. This prevents race conditions and false positives.
        await db.update(personalizedQuotes)
            .set({
                leadId,
                selectedPackage: selectedPackage || 'standard', // Legacy field
                selectedExtras: selectedExtras || [],
                selectedAt: new Date(), // Track when package was selected
                paymentType: effectivePaymentType,
                selectedTierPricePence,
                ...depositAmountUpdate,
                // Cash-on-the-day: no webhook will set bookedAt, so confirm here.
                // Nothing is paid online (depositPaidAt stays null); the full balance
                // is due in cash and is captured on the invoice created below.
                ...(isCashBooking ? { bookedAt: new Date(), depositAmountPence: 0 } : {}),
                // Scheduling fields
                selectedDate: selectedDate ? new Date(selectedDate) : undefined,
                // Store all preferred dates for the 3-date buffer model
                availableDates: selectedDates && Array.isArray(selectedDates) && selectedDates.length > 0
                  ? selectedDates.map((d: string | Date) => typeof d === 'string' ? d : new Date(d).toISOString().split('T')[0])
                  : (selectedDate ? [new Date(selectedDate).toISOString().split('T')[0]] : undefined),
                // Per-date time preferences for 3-date buffer model
                dateTimePreferences: dateTimePreferences && Array.isArray(dateTimePreferences) && dateTimePreferences.length > 0
                  ? dateTimePreferences.map((p: { date: string; timeSlot: string }) => ({
                      date: typeof p.date === 'string' ? p.date.split('T')[0] : p.date,
                      timeSlot: p.timeSlot,
                    }))
                  : undefined,
                schedulingTier: schedulingTier || undefined,
                timeSlotType: timeSlotType || undefined,
                exactTimeRequested: exactTimeRequested || undefined,
                isWeekendBooking: isWeekendBooking ?? false,
                schedulingFeeInPence: schedulingFeeInPence || 0,
                // Phase 25 flex — conditional spread: only write when a positive window
                // was sent, so a non-flex (exact-date) or stale PUT can never null out a
                // value the Stripe webhook already persisted from PI metadata.
                ...(typeof flexBookingWithinDays === 'number' && flexBookingWithinDays > 0
                  ? { flexBookingWithinDays }
                  : {}),
                // Phase 30 — persist the customer-confirmed door address. Conditional
                // spread so a booking flow that doesn't send one never clobbers the
                // admin's original quote.address / coordinates with undefined.
                ...(typeof address === 'string' && address.trim()
                  ? { address: address.trim() }
                  : {}),
                ...(coordinates && typeof coordinates.lat === 'number' && typeof coordinates.lng === 'number'
                  ? { coordinates: { lat: coordinates.lat, lng: coordinates.lng } }
                  : {}),
                // Landlord liaise-with-tenant — merge the tenant contact into the
                // existing contextSignals (preserving vaContext etc.) so ops can
                // reach the tenant. Conditional spread: only written when the
                // customer actually chose to liaise, so other bookings are untouched.
                ...(liaiseWithTenant
                  ? {
                      contextSignals: {
                        ...((quote.contextSignals as Record<string, unknown>) || {}),
                        liaiseWithTenant: true,
                        tenantName: typeof tenantName === 'string' && tenantName.trim() ? tenantName.trim() : undefined,
                        tenantMobile: typeof tenantMobile === 'string' && tenantMobile.trim() ? tenantMobile.trim() : undefined,
                      },
                    }
                  : {}),
                // depositPaidAt is set by Stripe webhook after payment confirmation
                // bookedAt is set by Stripe webhook after payment confirmation
            })
            .where(eq(personalizedQuotes.id, id));

        // Cash-on-the-day confirm chain. Mirrors the admin quick-book so a customer
        // cash booking is confirmed + dispatchable without ever touching Stripe:
        // raise a full-balance invoice and create the job (status pending) so it
        // enters the same dispatch pool as a paid flex booking. Guarded on the
        // PRE-update bookedAt so a repeated fire-and-forget PUT can't double-invoice.
        if (isCashBooking && !quote.bookedAt) {
            try {
                const cashTotal = selectedTierPricePence;
                const propertyId = (quote as any).propertyId
                    ?? await resolveOrCreateProperty(db, {
                        address: quote.address,
                        coordinates: (quote as any).coordinates,
                        postcode: (quote as any).postcode,
                        phone: quote.phone,
                        email: quote.email,
                    });
                const clientId = (quote as any).clientId
                    ?? await resolveOrCreateClient(db, {
                        phone: quote.phone,
                        email: quote.email,
                        displayName: quote.customerName,
                        billingAddress: quote.address,
                    });
                if (!(quote as any).propertyId || !(quote as any).clientId) {
                    await db.update(personalizedQuotes)
                        .set({
                            ...((quote as any).propertyId ? {} : { propertyId: propertyId ?? undefined }),
                            ...((quote as any).clientId ? {} : { clientId: clientId ?? undefined }),
                        })
                        .where(eq(personalizedQuotes.id, id));
                }

                const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
                const invoiceId = `inv_${nanoid()}`;
                await db.insert(invoices).values({
                    id: invoiceId,
                    invoiceNumber,
                    quoteId: id,
                    propertyId: propertyId ?? undefined,
                    clientId: clientId ?? undefined,
                    customerName: quote.customerName,
                    customerEmail: quote.email || null,
                    customerPhone: quote.phone,
                    customerAddress: (typeof address === 'string' && address.trim()) ? address.trim() : (quote.address || null),
                    lineItems: [{ description: quote.jobDescription, quantity: 1, unitPrice: cashTotal, total: cashTotal }] as any,
                    totalAmount: cashTotal,
                    depositPaid: 0,           // nothing paid online
                    balanceDue: cashTotal,    // full amount due in cash on the day
                    status: 'sent',
                    paidAt: null,
                    notes: '[CASH] Customer chose pay-cash-on-the-day (OAP)',
                });

                const jobId = `job_${nanoid()}`;
                await db.insert(contractorJobs).values({
                    id: jobId,
                    quoteId: id,
                    customerName: quote.customerName,
                    customerPhone: quote.phone,
                    address: quote.address || quote.postcode || '',
                    postcode: quote.postcode || '',
                    jobDescription: quote.jobDescription,
                    status: 'pending',             // enters the dispatch pool
                    totalPricePence: cashTotal,
                });

                try {
                    const { sendBookingConfirmationWhatsApp } = await import('./email-service');
                    await sendBookingConfirmationWhatsApp({
                        customerName: quote.customerName,
                        customerPhone: quote.phone,
                        jobDescription: quote.jobDescription,
                        depositPaid: 0,
                        totalJobPrice: cashTotal,
                        balanceDue: cashTotal,
                        invoiceNumber,
                        jobId,
                        scheduledDate: selectedDate ? String(selectedDate) : (quote.selectedDate ? String(quote.selectedDate) : null),
                    });
                } catch (notifyError) {
                    console.error('[track-booking][cash] WhatsApp confirm failed:', notifyError);
                }
                console.log(`[track-booking][cash] Quote ${id} booked cash-on-the-day — invoice ${invoiceNumber}, job ${jobId}, £${cashTotal / 100} due in cash`);
            } catch (cashErr) {
                console.error('[track-booking][cash] Failed to confirm cash booking:', cashErr);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Track booking error:", error);
        res.status(500).json({ error: "Failed to track booking" });
    }
});

// Track Diagnostic Visit Booking (Full Payment)
quotesRouter.put('/api/personalized-quotes/:id/track-visit-booking', async (req, res) => {
    try {
        const { id } = req.params;
        const { leadId, tierId, amountPence, paymentIntentId, slot } = req.body;

        // NOTE: depositPaidAt and bookedAt are NOT set here - they will be set by the Stripe webhook
        // when the payment is confirmed. This prevents race conditions and false positives.
        await db.update(personalizedQuotes)
            .set({
                leadId,
                selectedPackage: tierId, // standard, priority, emergency
                selectedAt: new Date(), // Track when package was selected
                paymentType: 'full',
                selectedTierPricePence: amountPence,
                depositAmountPence: amountPence, // Full payment amount (will be confirmed by webhook)
                stripePaymentIntentId: paymentIntentId,
                // depositPaidAt is set by Stripe webhook after payment confirmation
                // bookedAt is set by Stripe webhook after payment confirmation
            })
            .where(eq(personalizedQuotes.id, id));

        res.json({ success: true });
    } catch (error) {
        console.error("Track visit booking error:", error);
        res.status(500).json({ error: "Failed to track visit booking" });
    }
});

// Decline Quote Endpoint
quotesRouter.post('/api/personalized-quotes/:id/decline', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, feedback } = req.body; // feedback is optional structured data

        await db.update(personalizedQuotes)
            .set({
                rejectionReason: reason,
                feedbackJson: feedback || null
            })
            .where(eq(personalizedQuotes.id, id));

        res.json({ success: true });
    } catch (error) {
        console.error("Decline quote error:", error);
        res.status(500).json({ error: "Failed to decline quote" });
    }
});

// Get invoice data for a booked quote
quotesRouter.get('/api/personalized-quotes/:id/invoice-data', async (req, res) => {
    try {
        const { id } = req.params;
        const [quote] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        const totalJobPricePence = quote.selectedTierPricePence || 0;
        const depositAmountPence = quote.depositAmountPence || 0;
        const remainingBalancePence = totalJobPricePence - depositAmountPence;

        res.json({
            ...quote,
            totalJobPricePence,
            remainingBalancePence,
        });
    } catch (error) {
        console.error("Invoice data error:", error);
        res.status(500).json({ error: "Failed to fetch invoice data" });
    }
});

// ===========================================
// ADMIN: QUICK BOOK (Manual booking for WhatsApp confirmations)
// ===========================================

quotesRouter.post('/api/admin/personalized-quotes/:id/quick-book', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            paymentMethod, // 'cash' | 'bank_transfer' | 'card_phone' | 'already_paid'
            selectedPackage, // 'essential' | 'enhanced' | 'elite' or null for simple mode
            depositAmountPence, // Optional - if not provided, calculates automatically
            notes, // Admin notes
        } = req.body;

        // Get the quote
        const [quote] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        // Single price model — use basePrice
        const selectedTierPricePence = quote.basePrice || quote.essentialPrice || 0;
        const effectivePackage = selectedPackage || quote.selectedPackage || 'standard';

        // Calculate deposit if not provided
        const materialsCost = quote.materialsCostWithMarkupPence || 0;
        const laborCost = Math.max(0, selectedTierPricePence - materialsCost);
        const calculatedDeposit = materialsCost + Math.round(laborCost * 0.30);
        const finalDeposit = depositAmountPence ?? calculatedDeposit;

        // Resolve the service property (WHERE work happens) so the quote, its job
        // and its invoice all resolve to one property row — see server/properties.ts.
        const propertyId = (quote as any).propertyId
            ?? await resolveOrCreateProperty(db, {
                address: quote.address,
                coordinates: (quote as any).coordinates,
                postcode: (quote as any).postcode,
                phone: quote.phone,
                email: quote.email,
            });
        // Resolve the client (WHO pays) — same shared identity as the spine.
        const clientId = (quote as any).clientId
            ?? await resolveOrCreateClient(db, {
                phone: quote.phone,
                email: quote.email,
                displayName: quote.customerName,
                billingAddress: quote.address,
            });

        // Update quote as booked
        await db.update(personalizedQuotes)
            .set({
                selectedPackage: effectivePackage,
                selectedTierPricePence,
                depositAmountPence: finalDeposit,
                depositPaidAt: new Date(),
                bookedAt: new Date(),
                paymentType: 'full', // Manual bookings are treated as full payment pending
                ...((quote as any).propertyId ? {} : { propertyId: propertyId ?? undefined }),
                ...((quote as any).clientId ? {} : { clientId: clientId ?? undefined }),
            })
            .where(eq(personalizedQuotes.id, id));

        // Generate invoice number
        const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
        const balanceDue = selectedTierPricePence - finalDeposit;

        // Create invoice record
        const invoiceId = `inv_${nanoid()}`;
        await db.insert(invoices).values({
            id: invoiceId,
            invoiceNumber,
            quoteId: id,
            propertyId: propertyId ?? undefined,
            clientId: clientId ?? undefined,
            customerName: quote.customerName,
            customerEmail: quote.email || null,
            customerPhone: quote.phone,
            customerAddress: quote.address || null,
            lineItems: [{ description: quote.jobDescription, quantity: 1, unitPrice: selectedTierPricePence, total: selectedTierPricePence }] as any,
            totalAmount: selectedTierPricePence,
            depositPaid: finalDeposit,
            balanceDue: balanceDue,
            status: paymentMethod === 'already_paid' ? 'paid' : 'sent',
            paidAt: paymentMethod === 'already_paid' ? new Date() : null,
            notes: notes ? `[${paymentMethod.toUpperCase()}] ${notes}` : `[${paymentMethod.toUpperCase()}] Manual booking via admin`,
        });

        // Create job record
        const jobId = `job_${nanoid()}`;
        await db.insert(contractorJobs).values({
            id: jobId,
            quoteId: id,
            customerName: quote.customerName,
            customerPhone: quote.phone,
            address: quote.address || quote.postcode || '',
            postcode: quote.postcode || '',
            jobDescription: quote.jobDescription,
            status: 'pending',
            totalPricePence: selectedTierPricePence,
            // Not assigned to contractor yet - admin will dispatch
        });

        // Send WhatsApp confirmation
        try {
            const { sendBookingConfirmationWhatsApp } = await import('./email-service');
            await sendBookingConfirmationWhatsApp({
                customerName: quote.customerName,
                customerPhone: quote.phone,
                jobDescription: quote.jobDescription,
                depositPaid: finalDeposit,
                totalJobPrice: selectedTierPricePence,
                balanceDue,
                invoiceNumber,
                jobId,
                scheduledDate: quote.selectedDate ? String(quote.selectedDate) : null,
            });
        } catch (notifyError) {
            console.error('[QuickBook] Failed to send WhatsApp confirmation:', notifyError);
            // Don't fail the booking if notification fails
        }

        console.log(`[Admin QuickBook] Quote ${id} booked manually via ${paymentMethod}`);

        res.json({
            success: true,
            jobId,
            invoiceId,
            invoiceNumber,
            depositAmountPence: finalDeposit,
            totalAmountPence: selectedTierPricePence,
            balanceDuePence: balanceDue,
        });
    } catch (error) {
        console.error("Quick book error:", error);
        res.status(500).json({ error: "Failed to quick book quote" });
    }
});

// ===========================================
// ADMIN: EDIT QUOTE
// ===========================================

// Task item schema for analyzed job data
const taskItemSchema = z.object({
    id: z.string(),
    description: z.string(),
    quantity: z.number().int().nonnegative().default(1),
    hours: z.number().nonnegative().default(1),
    materialCost: z.number().nonnegative().default(0),
    complexity: z.enum(['low', 'medium', 'high']).default('medium'),
});

// Analyzed job data schema
const analyzedJobDataSchema = z.object({
    tasks: z.array(taskItemSchema),
    summary: z.string().optional(),
    totalEstimatedHours: z.number().nonnegative(),
    basePricePounds: z.number().nonnegative(),
});

// Schema for editable quote fields
const editQuoteSchema = z.object({
    // Customer details
    customerName: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional().nullable(),
    address: z.string().optional(),
    postcode: z.string().optional(),

    // Job details
    jobDescription: z.string().min(10).optional(),
    additionalNotes: z.string().optional().nullable(),
    segment: z.enum(['BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'DIY_DEFERRER', 'BUDGET', 'UNKNOWN']).optional(),

    // Pricing (HHH mode)
    essentialPrice: z.number().int().nonnegative().optional(),
    enhancedPrice: z.number().int().nonnegative().optional(),
    elitePrice: z.number().int().nonnegative().optional(),

    // Pricing (Simple mode)
    basePrice: z.number().int().nonnegative().optional().nullable(),

    // Materials & Extras
    materialsCostWithMarkupPence: z.number().int().nonnegative().optional(),
    optionalExtras: z.array(z.object({
        label: z.string(),
        priceInPence: z.number().int(),
        description: z.string().optional(),
        materialsCostInPence: z.number().int().optional(),
    })).optional(),

    // Scheduling
    selectedDate: z.string().optional().nullable(), // ISO date string
    schedulingTier: z.enum(['express', 'priority', 'standard', 'flexible']).optional().nullable(),

    // Assessment/Visit quotes
    assessmentReason: z.string().optional().nullable(),
    tierStandardPrice: z.number().int().optional().nullable(),
    tierPriorityPrice: z.number().int().optional().nullable(),
    tierEmergencyPrice: z.number().int().optional().nullable(),

    // NEW: Analyzed job data with tasks breakdown
    analyzedJobData: analyzedJobDataSchema.optional(),
    recalculatePricing: z.boolean().optional(), // Trigger tier price recalculation

    // Edit metadata
    editReason: z.string().optional(), // Why the edit was made
});

type EditQuoteInput = z.infer<typeof editQuoteSchema>;

// Admin: Edit an existing quote
quotesRouter.patch('/api/admin/personalized-quotes/:id/edit', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = editQuoteSchema.parse(req.body);

        // 1. Fetch the existing quote
        const [quote] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        // 2. Check for blocking conditions
        const warnings: string[] = [];
        const blockers: string[] = [];

        // Check if quote has active installment plan
        if (quote.installmentStatus === 'active') {
            blockers.push("Cannot edit quote with active installment plan. Cancel the plan first.");
        }

        // Check if prices are changing on a paid quote
        const priceFieldsChanging = updates.essentialPrice !== undefined ||
            updates.enhancedPrice !== undefined ||
            updates.elitePrice !== undefined ||
            updates.basePrice !== undefined;

        if (quote.depositPaidAt && priceFieldsChanging) {
            warnings.push("Quote has deposit paid. Price changes may require additional payment or refund.");
        }

        // If there are blockers, return error
        if (blockers.length > 0) {
            return res.status(400).json({
                error: "Cannot edit quote",
                blockers,
            });
        }

        // 3. Build the update object (only include provided fields)
        const updateData: Record<string, any> = {};

        // Customer details
        if (updates.customerName !== undefined) updateData.customerName = updates.customerName;
        if (updates.phone !== undefined) updateData.phone = updates.phone;
        if (updates.email !== undefined) updateData.email = updates.email;
        if (updates.address !== undefined) updateData.address = updates.address;
        if (updates.postcode !== undefined) updateData.postcode = updates.postcode;

        // Job details
        if (updates.jobDescription !== undefined) updateData.jobDescription = updates.jobDescription;
        if (updates.additionalNotes !== undefined) updateData.additionalNotes = updates.additionalNotes;
        if (updates.segment !== undefined) updateData.segment = updates.segment;

        // Pricing — single price model (basePrice is canonical)
        if (updates.basePrice !== undefined) {
            updateData.basePrice = updates.basePrice;
            // Keep deprecated columns in sync for backward compat
            updateData.essentialPrice = updates.basePrice;
            updateData.enhancedPrice = updates.basePrice;
            updateData.elitePrice = updates.basePrice;
        }
        // Legacy: if someone passes old tier prices, map to basePrice
        if (updates.essentialPrice !== undefined && updates.basePrice === undefined) {
            updateData.basePrice = updates.essentialPrice;
            updateData.essentialPrice = updates.essentialPrice;
            updateData.enhancedPrice = updates.essentialPrice;
            updateData.elitePrice = updates.essentialPrice;
        }

        // Materials & Extras
        if (updates.materialsCostWithMarkupPence !== undefined) updateData.materialsCostWithMarkupPence = updates.materialsCostWithMarkupPence;
        if (updates.optionalExtras !== undefined) updateData.optionalExtras = updates.optionalExtras;

        // Scheduling
        if (updates.selectedDate !== undefined) {
            updateData.selectedDate = updates.selectedDate ? new Date(updates.selectedDate) : null;
        }
        if (updates.schedulingTier !== undefined) updateData.schedulingTier = updates.schedulingTier;

        // Assessment/Visit
        if (updates.assessmentReason !== undefined) updateData.assessmentReason = updates.assessmentReason;
        if (updates.tierStandardPrice !== undefined) updateData.tierStandardPrice = updates.tierStandardPrice;
        if (updates.tierPriorityPrice !== undefined) updateData.tierPriorityPrice = updates.tierPriorityPrice;
        if (updates.tierEmergencyPrice !== undefined) updateData.tierEmergencyPrice = updates.tierEmergencyPrice;

        // Analyzed Job Data (tasks breakdown)
        if (updates.analyzedJobData !== undefined) {
            // Update the jobs JSONB field with new task breakdown
            updateData.jobs = [updates.analyzedJobData];

            // Also update base job price
            if (updates.analyzedJobData.basePricePounds) {
                updateData.baseJobPricePence = Math.round(updates.analyzedJobData.basePricePounds * 100);
            }

            console.log(`[Quote Edit] Updated jobs with ${updates.analyzedJobData.tasks?.length || 0} tasks`);
        }

        // 4. Recalculate deposit if pricing changed and not yet paid
        if (priceFieldsChanging && !quote.depositPaidAt) {
            const selectedPrice = updateData.basePrice ?? quote.basePrice ?? 0;

            if (selectedPrice > 0) {
                const materialsCost = updates.materialsCostWithMarkupPence ?? quote.materialsCostWithMarkupPence ?? 0;
                const laborCost = Math.max(0, selectedPrice - materialsCost);
                updateData.depositAmountPence = materialsCost + Math.round(laborCost * 0.30);
                updateData.selectedTierPricePence = selectedPrice;
            }
        }

        // 5. Reset selection if prices changed significantly (>10% difference)
        if (priceFieldsChanging && quote.selectedPackage && !quote.depositPaidAt) {
            const oldPrice = quote.selectedTierPricePence || 0;
            const newPrice = updateData.selectedTierPricePence || oldPrice;
            const priceDiff = Math.abs(newPrice - oldPrice) / Math.max(oldPrice, 1);

            if (priceDiff > 0.10) {
                // Reset selection so customer re-confirms at new price
                updateData.selectedPackage = null;
                updateData.selectedAt = null;
                warnings.push("Price changed >10%. Customer selection has been reset.");
            }
        }

        // 6. Track edit history
        const editHistory = (quote.feedbackJson as any)?.editHistory || [];
        editHistory.push({
            editedAt: new Date().toISOString(),
            editReason: updates.editReason || "Admin edit",
            changedFields: Object.keys(updateData),
        });
        updateData.feedbackJson = {
            ...(quote.feedbackJson as object || {}),
            editHistory,
            lastEditedAt: new Date().toISOString(),
        };

        // 7. Update the quote
        const [updated] = await db.update(personalizedQuotes)
            .set(updateData)
            .where(eq(personalizedQuotes.id, id))
            .returning();

        // 8. Update related job if exists and relevant fields changed
        if (quote.bookedAt) {
            const jobUpdates: Record<string, any> = {};

            if (updates.customerName) jobUpdates.customerName = updates.customerName;
            if (updates.phone) jobUpdates.customerPhone = updates.phone;
            if (updates.address) jobUpdates.address = updates.address;
            if (updates.postcode) jobUpdates.postcode = updates.postcode;
            if (updates.jobDescription) jobUpdates.jobDescription = updates.jobDescription;
            if (updates.selectedDate) jobUpdates.scheduledDate = new Date(updates.selectedDate);

            if (Object.keys(jobUpdates).length > 0) {
                await db.update(contractorJobs)
                    .set(jobUpdates)
                    .where(eq(contractorJobs.quoteId, id));
                warnings.push("Related job record updated.");
            }
        }

        // 9. Update related invoice if exists and pricing changed
        if (quote.depositPaidAt && priceFieldsChanging) {
            const newTotal = updateData.selectedTierPricePence || quote.selectedTierPricePence || 0;
            const depositPaid = quote.depositAmountPence || 0;
            const newBalance = Math.max(0, newTotal - depositPaid);

            await db.update(invoices)
                .set({
                    totalAmount: newTotal,
                    balanceDue: newBalance,
                    notes: `Updated via admin edit. Previous total: £${((quote.selectedTierPricePence || 0) / 100).toFixed(2)}`,
                })
                .where(eq(invoices.quoteId, id));

            if (newBalance > (quote.selectedTierPricePence || 0) - depositPaid) {
                warnings.push(`Invoice updated. Additional £${((newBalance - ((quote.selectedTierPricePence || 0) - depositPaid)) / 100).toFixed(2)} now due.`);
            } else if (newBalance < (quote.selectedTierPricePence || 0) - depositPaid) {
                warnings.push(`Invoice updated. Customer overpaid by £${((((quote.selectedTierPricePence || 0) - depositPaid) - newBalance) / 100).toFixed(2)}.`);
            }
        }

        console.log(`[Quote Edit] Quote ${id} updated. Fields: ${Object.keys(updateData).join(', ')}`);

        res.json({
            success: true,
            quote: updated,
            warnings: warnings.length > 0 ? warnings : undefined,
        });

    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                error: "Validation failed",
                details: error.errors,
            });
        }
        console.error("Edit quote error:", error);
        res.status(500).json({ error: "Failed to edit quote" });
    }
});

// Admin: Get quote edit history
quotesRouter.get('/api/admin/personalized-quotes/:id/edit-history', async (req, res) => {
    try {
        const { id } = req.params;

        const [quote] = await db.select({
            id: personalizedQuotes.id,
            feedbackJson: personalizedQuotes.feedbackJson,
            createdAt: personalizedQuotes.createdAt,
        }).from(personalizedQuotes).where(eq(personalizedQuotes.id, id));

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        const editHistory = (quote.feedbackJson as any)?.editHistory || [];

        res.json({
            quoteId: quote.id,
            createdAt: quote.createdAt,
            editHistory,
        });

    } catch (error) {
        console.error("Get edit history error:", error);
        res.status(500).json({ error: "Failed to get edit history" });
    }
});

// Admin: Manually expire a quote (DEPRECATED - quotes no longer expire)
// Kept for backwards compatibility but effectively a no-op now
quotesRouter.post('/api/admin/personalized-quotes/:id/expire', async (req, res) => {
    try {
        const { id } = req.params;
        // Quotes no longer expire, so this is now a no-op
        // Could be repurposed for "archive" functionality in the future
        res.json({ success: true, message: "Quotes no longer expire" });
    } catch (error) {
        console.error("Expire quote error:", error);
        res.status(500).json({ error: "Failed to expire quote" });
    }
});

// Admin: Renew an expired quote — resets the price-lock so the link is live
// again. Price is UNCHANGED (customer sees the exact same quote they saw
// before). Bumps regenerationCount for auditing. Window is price-banded.
quotesRouter.post('/api/admin/personalized-quotes/:id/renew', async (req, res) => {
    try {
        const { id } = req.params;

        const [original] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!original) {
            return res.status(404).json({ error: "Quote not found" });
        }

        const newExpiresAt = new Date(Date.now() + quoteValidityMs(original.basePrice));

        await db.update(personalizedQuotes)
            .set({
                expiresAt: newExpiresAt,
                regenerationCount: (original.regenerationCount || 0) + 1,
            })
            .where(eq(personalizedQuotes.id, id));

        res.json({ success: true, renewed: true, expiresAt: newExpiresAt });
    } catch (error) {
        console.error("Renew quote error:", error);
        res.status(500).json({ error: "Failed to renew quote" });
    }
});

// Delete a quote
quotesRouter.delete('/api/personalized-quotes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[DELETE] Attempting to delete quote: ${id}`);

        const result = await db.delete(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .returning();

        console.log(`[DELETE] Result:`, result);

        if (!result.length) {
            console.log(`[DELETE] Quote not found: ${id}`);
            return res.status(404).json({ error: "Quote not found" });
        }

        console.log(`[DELETE] Successfully deleted quote: ${id}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete quote error:", error);
        res.status(500).json({ error: "Failed to delete quote" });
    }
});

// V1: Share Quote (Mock)
quotesRouter.post("/api/quotes/:id/share", async (req, res) => {
    const { id } = req.params;
    const { method, target } = req.body;

    console.log(`[Quote Share] Sending quote ${id} via ${method} to ${target}`);

    // Simulate delay
    await new Promise(r => setTimeout(r, 1000));

    res.json({ success: true, message: `Quote sent to ${target}` });
});

// Update selected date before payment
quotesRouter.patch('/api/personalized-quotes/:id/update-date', async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedDate } = req.body;

        if (!selectedDate) {
            return res.status(400).json({ error: "selectedDate is required" });
        }

        await db.update(personalizedQuotes)
            .set({ selectedDate: new Date(selectedDate) })
            .where(eq(personalizedQuotes.id, id));

        console.log(`[Quote] Updated selectedDate for quote ${id}: ${selectedDate}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Update date error:", error);
        res.status(500).json({ error: "Failed to update date" });
    }
});

// ==========================================
// PAYMENT ANALYTICS ENDPOINTS
// ==========================================

import { and, gte, isNotNull, sql, count, sum } from "drizzle-orm";

// GET /api/admin/payments/summary
// Aggregate payment stats (today, week, month)
quotesRouter.get('/api/admin/payments/summary', async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Get all paid quotes
        const paidQuotes = await db.select({
            depositAmountPence: personalizedQuotes.depositAmountPence,
            depositPaidAt: personalizedQuotes.depositPaidAt,
        })
            .from(personalizedQuotes)
            .where(isNotNull(personalizedQuotes.depositPaidAt));

        // Calculate totals
        let todayTotal = 0;
        let weekTotal = 0;
        let monthTotal = 0;
        let todayCount = 0;
        let weekCount = 0;
        let monthCount = 0;

        for (const quote of paidQuotes) {
            const paidDate = new Date(quote.depositPaidAt!);
            const amount = quote.depositAmountPence || 0;

            if (paidDate >= todayStart) {
                todayTotal += amount;
                todayCount++;
            }
            if (paidDate >= weekStart) {
                weekTotal += amount;
                weekCount++;
            }
            if (paidDate >= monthStart) {
                monthTotal += amount;
                monthCount++;
            }
        }

        res.json({
            today: { total: todayTotal, count: todayCount },
            week: { total: weekTotal, count: weekCount },
            month: { total: monthTotal, count: monthCount },
            allTime: { total: paidQuotes.reduce((sum, q) => sum + (q.depositAmountPence || 0), 0), count: paidQuotes.length }
        });
    } catch (error) {
        console.error('Failed to fetch payment summary:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/payments/recent
// Recent payments list
quotesRouter.get('/api/admin/payments/recent', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;

        const recentPayments = await db.select({
            id: personalizedQuotes.id,
            shortSlug: personalizedQuotes.shortSlug,
            customerName: personalizedQuotes.customerName,
            phone: personalizedQuotes.phone,
            depositAmountPence: personalizedQuotes.depositAmountPence,
            depositPaidAt: personalizedQuotes.depositPaidAt,
            paymentType: personalizedQuotes.paymentType,
            stripePaymentIntentId: personalizedQuotes.stripePaymentIntentId,
            selectedPackage: personalizedQuotes.selectedPackage,
            segment: personalizedQuotes.segment,
        })
            .from(personalizedQuotes)
            .where(isNotNull(personalizedQuotes.depositPaidAt))
            .orderBy(desc(personalizedQuotes.depositPaidAt))
            .limit(limit);

        res.json(recentPayments);
    } catch (error) {
        console.error('Failed to fetch recent payments:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==========================================
// BOOKING CONFIRMATION DATA ENDPOINT
// ==========================================

// GET /api/personalized-quotes/:id/confirmation
// Returns all data needed for the post-payment confirmation page
quotesRouter.get('/api/personalized-quotes/:id/confirmation', async (req, res) => {
    try {
        const { id } = req.params;

        // Look up by id OR shortSlug. The old `id.includes('-')` UUID heuristic
        // mis-detected ~70% of quote ids — nanoids like `quote_…` usually have no
        // hyphen — so it queried by shortSlug and 404'd. The post-payment redirect
        // passes quote.id, so that broke the confirmation page for most paid bookings.
        const [quote] = await db.select().from(personalizedQuotes)
            .where(or(eq(personalizedQuotes.id, id), eq(personalizedQuotes.shortSlug, id)));

        if (!quote) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        // Check if quote is actually booked/paid
        if (!quote.depositPaidAt) {
            return res.status(400).json({ error: 'Quote not yet booked - payment required' });
        }

        // Get associated invoice (use resolved quote.id so this also works when the
        // page was reached via shortSlug, not just the raw id param).
        const [invoice] = await db.select().from(invoices)
            .where(eq(invoices.quoteId, quote.id))
            .limit(1);

        // Get or create invoice token for portal access
        let portalToken: string | null = null;
        if (invoice) {
            const existingTokens = await db.select()
                .from(invoiceTokens)
                .where(eq(invoiceTokens.invoiceId, invoice.id))
                .limit(1);

            if (existingTokens.length > 0) {
                portalToken = existingTokens[0].token;
            } else {
                // Create new token
                const newToken = crypto.randomBytes(32).toString('hex');
                await db.insert(invoiceTokens).values({
                    id: crypto.randomUUID(),
                    invoiceId: invoice.id,
                    token: newToken,
                    viewCount: 0,
                });
                portalToken = newToken;
            }
        }

        // Get job if created (resolved quote.id, for the shortSlug path)
        const [job] = await db.select().from(contractorJobs)
            .where(eq(contractorJobs.quoteId, quote.id))
            .limit(1);

        // Get contractor info if assigned
        let contractor = null;
        if (quote.contractorId) {
            const [profile] = await db.select({
                businessName: handymanProfiles.businessName,
                profileImageUrl: handymanProfiles.profileImageUrl,
            }).from(handymanProfiles)
                .where(eq(handymanProfiles.id, quote.contractorId))
                .limit(1);

            if (profile) {
                contractor = {
                    name: profile.businessName || 'Your Technician',
                    imageUrl: profile.profileImageUrl,
                };
            }
        }

        res.json({
            quote: {
                id: quote.id,
                shortSlug: quote.shortSlug,
                customerName: quote.customerName,
                phone: quote.phone,
                email: quote.email,
                jobDescription: quote.jobDescription,
                postcode: quote.postcode,
                address: quote.address,
                segment: quote.segment || 'UNKNOWN',
                selectedPackage: quote.selectedPackage,
                selectedExtras: quote.selectedExtras || [],
                selectedDate: quote.selectedDate,
                timeSlotType: quote.timeSlotType,
                exactTimeRequested: quote.exactTimeRequested,
                schedulingTier: quote.schedulingTier,
                isWeekendBooking: quote.isWeekendBooking,
                schedulingFeeInPence: quote.schedulingFeeInPence,
                depositAmountPence: quote.depositAmountPence,
                depositPaidAt: quote.depositPaidAt,
                // Phase 31 — confirmation page branches on these: paymentType drives
                // deposit-vs-paid-in-full copy; flexBookingWithinDays > 0 means the
                // customer chose Flexible (we slot them in) vs an exact assigned date.
                paymentType: quote.paymentType,
                flexBookingWithinDays: quote.flexBookingWithinDays,
                // Contextual quote fields
                contextualHeadline: quote.contextualHeadline,
                contextualMessage: quote.contextualMessage,
                jobTopLine: quote.jobTopLine,
                proposalSummary: quote.proposalSummary,
                valueBullets: quote.valueBullets,
                layoutTier: quote.layoutTier,
                pricingLineItems: quote.pricingLineItems,
                batchDiscountPercent: quote.batchDiscountPercent,
            },
            invoice: invoice ? {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                totalAmount: invoice.totalAmount,
                depositPaid: invoice.depositPaid,
                balanceDue: invoice.balanceDue,
                status: invoice.status,
            } : null,
            portalToken,
            job: job ? {
                id: job.id,
                status: job.status,
                scheduledDate: job.scheduledDate,
            } : null,
            contractor,
        });
    } catch (error) {
        console.error('Failed to fetch confirmation data:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==========================================
// LIVE CALL ACTION ENDPOINTS
// ==========================================

import { twilioClient } from './twilio-client';
import { sendWhatsAppMessage } from './meta-whatsapp';
import { getWhatsAppValueLines } from '@shared/hassle-comparisons';
import { calls } from '@shared/schema';

const instantQuoteSchema = z.object({
    customerName: z.string().min(1, 'Customer name is required'),
    phone: z.string().min(1, 'Phone number is required'),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().optional(),
    skus: z.array(z.object({
        id: z.string().optional(),
        name: z.string(),
        pricePence: z.number(),
        confidence: z.number().optional(),
        // 'v2_self_serve' added for bookings originating from the /v2 SKU
        // landing page — the customer chose the SKU themselves (not detected
        // from a live call) and confirmed via the in-page booking flow.
        source: z.enum(['detected', 'manual', 'v2_self_serve']),
    })),
    totalPricePence: z.number(),
    selectedDate: z.string().optional(),
    // Optional: only required when the customer needs a link sent to them
    // (live-call agent flow). For /v2 self-serve bookings the customer is
    // already on the page and the confirmation is rendered in-flow, so
    // no SMS/WhatsApp is needed — caller omits this field.
    sendVia: z.enum(['sms', 'whatsapp']).optional(),
    callId: z.string().optional(),
    segment: z.string().optional(),
    // Where the booking originated. Drives lead.source so analytics can
    // separate /v2 self-serve bookings from live-call instant quotes.
    //   'instant_quote' (default) — live-call agent created the quote
    //   'v2_sku'                  — customer self-served via /v2
    bookingSource: z.enum(['instant_quote', 'v2_sku']).optional(),
});

// POST /api/quotes/instant
// Creates a simple quote from live call and sends booking link
quotesRouter.post('/api/quotes/instant', optionalAuth, async (req, res) => {
    try {
        const input = instantQuoteSchema.parse(req.body);
        const normalizedPhone = normalizePhoneNumber(input.phone);

        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        // Generate short slug and ID
        const shortSlug = nanoid(8);
        const id = `quote_${nanoid()}`;

        // Build job description from SKUs
        const jobDescription = input.skus.map(s => s.name).join(', ');

        // Create or link lead
        let linkedLeadId: string | null = null;
        const duplicateCheck = await findDuplicateLead(normalizedPhone, {
            customerName: input.customerName,
        });

        if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
            linkedLeadId = duplicateCheck.existingLead.id;
            console.log(`[InstantQuote] Linked to existing lead ${linkedLeadId}`);
        } else {
            // Use the bookingSource (if provided) to differentiate /v2
            // self-serve leads from live-call instant quotes in downstream
            // analytics. lead.id prefix also encodes the source so it's
            // searchable directly from the DB.
            const leadSource = input.bookingSource === 'v2_sku'
                ? 'v2_sku'
                : 'instant_quote';
            const idPrefix = input.bookingSource === 'v2_sku' ? 'lead_v2' : 'lead_instant';
            linkedLeadId = `${idPrefix}_${Date.now()}`;
            await db.insert(leads).values({
                id: linkedLeadId,
                customerName: input.customerName,
                phone: normalizedPhone,
                email: input.email || null,
                source: leadSource,
                jobDescription,
                // /v2 customers self-confirmed via the in-page flow, so the
                // lead is already at 'quote_accepted'. Live-call quotes
                // need the customer to click the link first, so they
                // stay at 'quote_sent'.
                status: input.bookingSource === 'v2_sku' ? 'quote_accepted' : 'quote_sent',
            });
            console.log(`[InstantQuote] Created new lead ${linkedLeadId} (source=${leadSource})`);
        }

        // Create simple quote
        const quoteData = {
            id,
            shortSlug,
            leadId: linkedLeadId,
            customerName: input.customerName,
            phone: normalizedPhone,
            email: input.email || null,
            address: input.address || null,
            jobDescription,
            quoteMode: 'simple' as const,
            basePrice: input.totalPricePence,
            optionalExtras: input.skus.map(s => ({
                label: s.name,
                description: s.name,
                priceInPence: s.pricePence,
                source: s.source,
            })),
            selectedDate: input.selectedDate ? new Date(input.selectedDate) : null,
            segment: input.segment || 'UNKNOWN',
            // /v2 self-serve customers have already committed by the time
            // we hit this endpoint — the cart was selected, address +
            // contact entered, and the in-page "Confirm booking" button
            // tapped. Stamp `bookedAt` immediately so ops dashboards
            // surface these as ready-to-dispatch, not pending quotes.
            bookedAt: input.bookingSource === 'v2_sku' ? new Date() : null,
            selectedAt: input.bookingSource === 'v2_sku' ? new Date() : null,
            createdBy: (req as any).user?.id || null,
            createdByName: (req as any).user
                ? `${(req as any).user.firstName || ''} ${(req as any).user.lastName || ''}`.trim() || null
                : null,
            createdAt: new Date(),
            // Price-banded validity window — anchors the customer page's price-lock timer
            expiresAt: new Date(Date.now() + quoteValidityMs(input.totalPricePence)),
        };

        await db.insert(personalizedQuotes).values(quoteData);
        console.log(`[InstantQuote] Created quote ${shortSlug} (bookingSource=${input.bookingSource || 'instant_quote'})`);

        // Generate quote URL from request — still useful as an internal
        // reference link even when no message is sent (admin can deep-link
        // into the quote from the lead row).
        const quoteUrl = getShortQuoteUrl(req, shortSlug);

        // Only send a booking link if `sendVia` was provided. /v2 self-
        // serve bookings omit it because the customer is on the page and
        // sees the confirmation in-flow — sending them a quote link back
        // would be redundant and confusing.
        if (input.sendVia) {
            const seg = input.segment || 'UNKNOWN';
            const valueLines = getWhatsAppValueLines(seg, 2);
            const valuePart = valueLines.length > 0 ? '\n' + valueLines.join('\n') + '\n' : '';
            const message = `Hi ${input.customerName.split(' ')[0] || 'there'}! Here's your quote for £${(input.totalPricePence / 100).toFixed(2)}.${valuePart}\nClick to view and book: ${quoteUrl}`;

            if (input.sendVia === 'sms') {
                await twilioClient.messages.create({
                    to: normalizedPhone,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    body: message,
                });
                console.log(`[InstantQuote] SMS sent to ${normalizedPhone}`);
            } else {
                await sendWhatsAppMessage(normalizedPhone, message);
                console.log(`[InstantQuote] WhatsApp sent to ${normalizedPhone}`);
            }
        } else {
            console.log(`[InstantQuote] sendVia omitted — no message sent (likely v2 self-serve booking)`);
        }

        // Update call record if provided
        if (input.callId) {
            await db.update(calls)
                .set({
                    outcome: 'INSTANT_PRICE',
                    actionTakenAt: new Date(),
                    bookingLinkSent: true,
                    leadId: linkedLeadId,
                })
                .where(eq(calls.id, input.callId));
            console.log(`[InstantQuote] Updated call ${input.callId} with INSTANT_PRICE outcome`);
        }

        res.json({
            success: true,
            quoteId: id,
            shortSlug,
            quoteUrl,
            leadId: linkedLeadId,
        });

    } catch (error: any) {
        console.error('[InstantQuote] Error:', error);
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ error: error.message || 'Failed to create instant quote' });
    }
});

// Site Visit Request Schema
const siteVisitRequestSchema = z.object({
    customerName: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().optional(),
    reason: z.enum(['complex', 'commercial', 'safety', 'customer_prefers', 'multiple_tasks', 'other']),
    reasonOther: z.string().optional(),
    sendVia: z.enum(['sms', 'whatsapp']),
    callId: z.string().optional(),
});

// POST /api/site-visits/request
// Creates a site visit request and sends booking link
quotesRouter.post('/api/site-visits/request', async (req, res) => {
    try {
        const input = siteVisitRequestSchema.parse(req.body);
        const normalizedPhone = normalizePhoneNumber(input.phone);

        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        // Map reason to human-readable text
        const reasonLabels: Record<string, string> = {
            'complex': 'Complex job - needs assessment',
            'commercial': 'Commercial property',
            'safety': 'Safety/structural concern',
            'customer_prefers': 'Customer prefers in-person',
            'multiple_tasks': 'Multiple tasks - needs walkthrough',
            'other': input.reasonOther || 'Other',
        };
        const reasonText = reasonLabels[input.reason] || input.reason;

        // Create or link lead
        let linkedLeadId: string | null = null;
        const duplicateCheck = await findDuplicateLead(normalizedPhone, {
            customerName: input.customerName,
        });

        if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
            linkedLeadId = duplicateCheck.existingLead.id;
            // Update lead status
            await db.update(leads)
                .set({
                    status: 'site_visit_pending',
                    siteVisitScheduledAt: new Date(),
                })
                .where(eq(leads.id, linkedLeadId));
        } else {
            linkedLeadId = `lead_visit_${Date.now()}`;
            await db.insert(leads).values({
                id: linkedLeadId,
                customerName: input.customerName,
                phone: normalizedPhone,
                source: 'site_visit_request',
                jobDescription: `Site visit requested: ${reasonText}`,
                status: 'site_visit_pending',
                siteVisitScheduledAt: new Date(),
            });
        }

        console.log(`[SiteVisit] Created/linked lead ${linkedLeadId}`);

        // Generate booking link from request
        const bookingUrl = getBookVisitUrl(req, linkedLeadId);

        // Send message
        const firstName = input.customerName.split(' ')[0] || 'there';
        const message = `Hi ${firstName}! We'd like to schedule a site visit to assess your job properly. Book a convenient time: ${bookingUrl}`;

        if (input.sendVia === 'sms') {
            await twilioClient.messages.create({
                to: normalizedPhone,
                from: process.env.TWILIO_PHONE_NUMBER,
                body: message,
            });
            console.log(`[SiteVisit] SMS sent to ${normalizedPhone}`);
        } else {
            await sendWhatsAppMessage(normalizedPhone, message);
            console.log(`[SiteVisit] WhatsApp sent to ${normalizedPhone}`);
        }

        // Update call record if provided
        if (input.callId) {
            await db.update(calls)
                .set({
                    outcome: 'SITE_VISIT',
                    siteVisitReason: input.reason === 'other' ? input.reasonOther : input.reason,
                    actionTakenAt: new Date(),
                    bookingLinkSent: true,
                    leadId: linkedLeadId,
                })
                .where(eq(calls.id, input.callId));
            console.log(`[SiteVisit] Updated call ${input.callId} with SITE_VISIT outcome`);
        }

        res.json({
            success: true,
            leadId: linkedLeadId,
            bookingUrl,
        });

    } catch (error: any) {
        console.error('[SiteVisit] Error:', error);
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        res.status(500).json({ error: error.message || 'Failed to schedule site visit' });
    }
});

quotesRouter.post('/api/personalized-quotes/:id/accept-revision', async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const existingFeedback = (existing.feedbackJson as Record<string, unknown> | null) || {};
        const acceptedAt = new Date().toISOString();
        const updatedFeedback = {
            ...existingFeedback,
            revisionAcceptedAt: acceptedAt,
            revisionAcceptedFromPricePence: existing.selectedTierPricePence,
            revisionAcceptedToPricePence: existing.basePrice,
        };

        const [updated] = await db.update(personalizedQuotes)
            .set({
                feedbackJson: updatedFeedback,
                selectedTierPricePence: existing.basePrice,
            })
            .where(eq(personalizedQuotes.id, id))
            .returning();

        console.log(`[Quotes] Revision accepted on ${id} at ${acceptedAt}`);

        res.json({ success: true, quote: updated });
    } catch (error: any) {
        console.error('[Quotes] Error accepting revision:', error);
        res.status(500).json({ error: error.message || 'Failed to accept revision' });
    }
});

// PATCH /api/personalized-quotes/:id/update-email
// Update just the email field on a quote (for payment flow)
quotesRouter.patch('/api/personalized-quotes/:id/update-email', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Basic email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if quote exists
        const existingQuote = await db.select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);

        if (existingQuote.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        // Update the email
        const [updatedQuote] = await db.update(personalizedQuotes)
            .set({ email })
            .where(eq(personalizedQuotes.id, id))
            .returning();

        console.log(`[Quotes] Updated email for quote ${id}: ${email}`);

        res.json({
            success: true,
            quote: updatedQuote,
        });

    } catch (error: any) {
        console.error('[Quotes] Error updating email:', error);
        res.status(500).json({ error: error.message || 'Failed to update email' });
    }
});

