import { Router } from "express";
import { db } from "./db";
import { personalizedQuotes, leads, insertPersonalizedQuoteSchema, handymanProfiles, productizedServices, segmentEnum } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { openai, polishAssessmentReason, generatePersonalizedNote, determineQuoteStrategy, classifyLead, determineOptimalRoute } from "./openai";
import { generateValuePricingQuote, createAnalyticsLog, generateTierDeliverables, getSegmentTierConfig } from "./value-pricing-engine";
import { geocodeAddress } from "./lib/geocoding";
import { findBestContractors, checkNetworkAvailability } from "./availability-engine";
import { detectMultipleTasks } from "./skuDetector";

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
    quoteMode: z.enum(['simple', 'hhh', 'pick_and_mix', 'consultation']).default('hhh'),
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

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are crafting a WhatsApp message to send a quote to a customer. You're continuing an existing conversation.

SEGMENT: ${segment || 'BUSY_PRO'}
${styleGuide}

STRUCTURE YOUR MESSAGE:
1. Brief, natural opening that flows from the conversation (reference what they discussed)
2. Present the quote link
3. ALWAYS end with: "If you have any questions, just give me a shout" (or similar warm invitation to ask questions)

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
quotesRouter.post('/api/personalized-quotes/value', async (req, res) => {
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

            // [RAMANUJAM] Segment determines pricing mode automatically
            // All segments use HHH/tiers mode - frontend controls which tiers to show
            if (!input.selectedRoute) {
                finalRoute = 'tiers';
                console.log('[Routing Brain] Segment-based routing: auto-selecting tiers route for segment', input.manualSegment);
            }
        }

        // FORCE QUOTE MODE synchronization with Route
        // If route is 'instant', we MUST store as 'simple' mode so basePrice is populated
        if (finalRoute === 'instant') {
            console.log('[Routing Brain] forcing quoteMode=simple to match route=instant');
            input.quoteMode = 'simple';
        } else if (finalRoute === 'assessment') {
            console.log('[Routing Brain] forcing quoteMode=consultation to match route=assessment');
            input.quoteMode = 'consultation';
        } else if (finalRoute === 'tiers') {
            console.log('[Routing Brain] forcing quoteMode=hhh to match route=tiers');
            input.quoteMode = 'hhh';
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

        // Generate quote using value pricing engine
        const pricingResult = generateValuePricingQuote({
            urgencyReason: input.urgencyReason,
            ownershipContext: input.ownershipContext,
            desiredTimeframe: input.desiredTimeframe,
            baseJobPrice: input.baseJobPrice,

            clientType: input.clientType,
            jobComplexity: input.jobComplexity,
            forcedQuoteStyle: (input.quoteMode === 'hhh' || input.quoteMode === 'pick_and_mix' || input.quoteMode === 'consultation') ? input.quoteMode : undefined,
            segment: input.manualSegment || leadClassification?.segment || 'UNKNOWN',
            jobType: mappedJobType,
            quotability: mappedQuotability
        });

        // Pick & Mix Logic: Sort extras high to low (Anchoring)
        if (input.quoteMode === 'pick_and_mix' && input.optionalExtras) {
            input.optionalExtras.sort((a: any, b: any) => (b.priceInPence || 0) - (a.priceInPence || 0));
        }

        // B2.3-B2.4: Generate tier deliverables with segment-specific configurations
        const aiTierDeliverables = generateTierDeliverables(input.analyzedJobData, input.jobDescription);
        const segmentConfig = getSegmentTierConfig(input.manualSegment || leadClassification?.segment || 'UNKNOWN');

        // Merge segment-specific deliverables with AI-generated ones
        const tierDeliverables = {
            essential: Array.from(new Set([...segmentConfig.essential.deliverables, ...aiTierDeliverables.essential])),
            hassleFree: Array.from(new Set([...segmentConfig.hassleFree.deliverables, ...aiTierDeliverables.hassleFree])),
            highStandard: Array.from(new Set([...segmentConfig.highStandard.deliverables, ...aiTierDeliverables.highStandard])),
        };

        // Prepare quote data
        const quoteInsertData = {
            id,
            shortSlug,
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
            tierStandardPrice: input.tierStandardPrice,
            tierPriorityPrice: input.tierPriorityPrice,
            tierEmergencyPrice: input.tierEmergencyPrice,

            // Routing Brain Data (NEW)
            recommendedRoute: finalRoute, // Use final route (manual selection or AI recommendation)
            leadClassification, // Full classification object with signals

            // HHH Mode Prices
            essentialPrice: input.quoteMode === 'hhh' ? pricingResult.essential.price : null,
            enhancedPrice: input.quoteMode === 'hhh' ? pricingResult.hassleFree.price : null,
            elitePrice: input.quoteMode === 'hhh' ? pricingResult.highStandard.price : null,

            // Simple Mode Prices
            basePrice: (input.quoteMode === 'simple' || input.quoteMode === 'pick_and_mix' || input.quoteMode === 'consultation') ? pricingResult.essential.price : null,

            // Context & Inputs
            urgencyReason: input.urgencyReason,
            ownershipContext: input.ownershipContext,
            desiredTimeframe: input.desiredTimeframe,
            baseJobPricePence: input.baseJobPrice,
            valueMultiplier100: Math.round(pricingResult.valueMultiplier * 100),
            recommendedTier: pricingResult.recommendedTier,
            additionalNotes: input.additionalNotes || null,

            // Metadata
            jobs: input.analyzedJobData ? [input.analyzedJobData] : null,
            tierDeliverables: {
                essential: tierDeliverables.essential,
                hassleFree: tierDeliverables.hassleFree,
                highStandard: tierDeliverables.highStandard,
            },
            materialsCostWithMarkupPence: input.materialsCostWithMarkupPence || 0,
            optionalExtras: input.optionalExtras || null,

            // B3.4: Phase 1 Segmentation Fields
            segment: input.manualSegment || leadClassification?.segment || 'UNKNOWN',
            jobType: mappedJobType,
            quotability: mappedQuotability,

            // Proposal Mode - Now standard for all quotes (always enabled)
            proposalModeEnabled: input.proposalModeEnabled ?? true,


            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from creation
        };

        // Insert into DB
        await db.insert(personalizedQuotes).values(quoteInsertData);

        // Response
        const responsePayload = {
            ...quoteInsertData,
            valueMultiplier: pricingResult.valueMultiplier,
            recommendedTier: pricingResult.recommendedTier,
            essential: input.quoteMode === 'hhh' ? {
                name: pricingResult.essential.name,
                description: pricingResult.essential.coreDescription,
                price: pricingResult.essential.price,
                perks: pricingResult.essential.perks,
                warrantyMonths: pricingResult.essential.warrantyMonths,
                isRecommended: pricingResult.essential.isRecommended,
            } : undefined,
            hassleFree: input.quoteMode === 'hhh' ? {
                name: pricingResult.hassleFree.name,
                description: pricingResult.hassleFree.coreDescription,
                price: pricingResult.hassleFree.price,
                perks: pricingResult.hassleFree.perks,
                warrantyMonths: pricingResult.hassleFree.warrantyMonths,
                isRecommended: pricingResult.hassleFree.isRecommended,
            } : undefined,
            highStandard: input.quoteMode === 'hhh' ? {
                name: pricingResult.highStandard.name,
                description: pricingResult.highStandard.coreDescription,
                price: pricingResult.highStandard.price,
                perks: pricingResult.highStandard.perks,
                warrantyMonths: pricingResult.highStandard.warrantyMonths,
                isRecommended: pricingResult.highStandard.isRecommended,
            } : undefined,
            basePrice: (input.quoteMode === 'simple' || input.quoteMode === 'pick_and_mix' || input.quoteMode === 'consultation') ? pricingResult.essential.price : undefined,

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

        // Track view statistics
        const now = new Date();
        await db.update(personalizedQuotes)
            .set({
                viewedAt: quote.viewedAt || now, // Keep original first view time
                lastViewedAt: now,
                viewCount: (quote.viewCount || 0) + 1
            })
            .where(eq(personalizedQuotes.id, quote.id));

        // Return updated stats
        quote.viewCount = (quote.viewCount || 0) + 1;

        // Fetch Contractor Details if configured
        let contractorDetails = undefined;
        if (quote.contractorId) {
            const profile = await db.query.handymanProfiles.findFirst({
                where: eq(handymanProfiles.userId, quote.contractorId),
                with: { user: true }
            });

            if (profile) {
                contractorDetails = {
                    name: `${profile.user.firstName} ${profile.user.lastName}`,
                    companyName: `${profile.user.firstName} ${profile.user.lastName}`, // Fallback since no companyName in profile
                    profilePhotoUrl: profile.profileImageUrl, // Correctly use profile image
                    coverPhotoUrl: profile.heroImageUrl, // Add cover photo
                    slug: profile.slug
                };
            }
        }

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

        // Enrich with segment-specific tier names
        // Use the direct segment field from database (B3.4), fallback to leadClassification for legacy quotes
        const quoteSegment = quote.segment || ((quote as any).leadClassification as any)?.segment || 'UNKNOWN';
        const segmentConfig = getSegmentTierConfig(quoteSegment);

        res.json({
            ...quote,
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
            }
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
        res.json(allQuotes);
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

        await db.update(personalizedQuotes)
            .set({ selectedPackage, selectedAt: new Date() })
            .where(eq(personalizedQuotes.id, id));

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
        const { leadId, selectedPackage, selectedExtras, paymentType } = req.body;

        // Calculate selected tier price
        const [quote] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }

        let selectedTierPricePence = 0;
        if (selectedPackage === 'essential') {
            selectedTierPricePence = quote.essentialPrice || quote.basePrice || 0;
        } else if (selectedPackage === 'enhanced') {
            selectedTierPricePence = quote.enhancedPrice || 0;
        } else if (selectedPackage === 'elite') {
            selectedTierPricePence = quote.elitePrice || 0;
        } else if (quote.basePrice) {
            selectedTierPricePence = quote.basePrice;
        }

        // Calculate deposit: 100% materials + 30% labor
        const materialsCost = quote.materialsCostWithMarkupPence || 0;
        const laborCost = Math.max(0, selectedTierPricePence - materialsCost);
        const depositAmountPence = materialsCost + Math.round(laborCost * 0.30);

        await db.update(personalizedQuotes)
            .set({
                leadId,
                selectedPackage,
                selectedExtras: selectedExtras || [],
                bookedAt: new Date(),
                paymentType,
                selectedTierPricePence,
                depositAmountPence,
                depositPaidAt: new Date(),
            })
            .where(eq(personalizedQuotes.id, id));

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

        await db.update(personalizedQuotes)
            .set({
                leadId,
                selectedPackage: tierId, // standard, priority, emergency
                bookedAt: new Date(),
                paymentType: 'full',
                selectedTierPricePence: amountPence,
                depositAmountPence: amountPence, // Full payment
                depositPaidAt: new Date(),
                stripePaymentIntentId: paymentIntentId,
                // We can't easily store slot in existing columns, but lead will have it.
                // Or updates 'jobDescription' to include it? No, keep original description.
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

// Admin: Manually expire a quote
quotesRouter.post('/api/admin/personalized-quotes/:id/expire', async (req, res) => {
    try {
        const { id } = req.params;

        await db.update(personalizedQuotes)
            .set({ expiresAt: new Date() }) // Set expiry to now = expired
            .where(eq(personalizedQuotes.id, id));

        res.json({ success: true, expired: true });
    } catch (error) {
        console.error("Expire quote error:", error);
        res.status(500).json({ error: "Failed to expire quote" });
    }
});

// Admin: Regenerate an expired quote with price increase and fresh timer
quotesRouter.post('/api/admin/personalized-quotes/:id/regenerate', async (req, res) => {
    try {
        const { id } = req.params;
        const { percentageIncrease = 5 } = req.body;

        // Get original quote
        const [original] = await db.select().from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id));

        if (!original) {
            return res.status(404).json({ error: "Quote not found" });
        }

        const multiplier = 1 + (percentageIncrease / 100);

        // Update the quote with new prices and fresh 15-minute timer
        await db.update(personalizedQuotes)
            .set({
                essentialPrice: original.essentialPrice ? Math.round(original.essentialPrice * multiplier) : null,
                enhancedPrice: original.enhancedPrice ? Math.round(original.enhancedPrice * multiplier) : null,
                elitePrice: original.elitePrice ? Math.round(original.elitePrice * multiplier) : null,
                basePrice: original.basePrice ? Math.round(original.basePrice * multiplier) : null,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000), // Fresh 15 min timer
                regenerationCount: (original.regenerationCount || 0) + 1,
            })
            .where(eq(personalizedQuotes.id, id));

        res.json({ success: true, regenerated: true });
    } catch (error) {
        console.error("Regenerate quote error:", error);
        res.status(500).json({ error: "Failed to regenerate quote" });
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

