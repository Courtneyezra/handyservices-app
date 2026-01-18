
import { Router } from "express";
import { db } from "./db";
import { personalizedQuotes, leads, insertPersonalizedQuoteSchema, handymanProfiles } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { openai, polishAssessmentReason, generatePersonalizedNote, determineQuoteStrategy } from "./openai";
import { generateValuePricingQuote, createAnalyticsLog, generateTierDeliverables } from "./value-pricing-engine";
import { geocodeAddress } from "./lib/geocoding";
import { findBestContractors, checkNetworkAvailability } from "./availability-engine";

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

        // Generate quote using value pricing engine
        const pricingResult = generateValuePricingQuote({
            urgencyReason: input.urgencyReason,
            ownershipContext: input.ownershipContext,
            desiredTimeframe: input.desiredTimeframe,
            baseJobPrice: input.baseJobPrice,

            clientType: input.clientType,
            jobComplexity: input.jobComplexity,
            forcedQuoteStyle: (input.quoteMode === 'hhh' || input.quoteMode === 'pick_and_mix' || input.quoteMode === 'consultation') ? input.quoteMode : undefined,
        });

        // Pick & Mix Logic: Sort extras high to low (Anchoring)
        if (input.quoteMode === 'pick_and_mix' && input.optionalExtras) {
            input.optionalExtras.sort((a: any, b: any) => (b.priceInPence || 0) - (a.priceInPence || 0));
        }

        // Generate tier deliverables
        const tierDeliverables = generateTierDeliverables(input.analyzedJobData, input.jobDescription);

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
                price: pricingResult.essential.price,
                perks: pricingResult.essential.perks,
                warrantyMonths: pricingResult.essential.warrantyMonths,
                isRecommended: pricingResult.essential.isRecommended,
            } : undefined,
            hassleFree: input.quoteMode === 'hhh' ? {
                price: pricingResult.hassleFree.price,
                perks: pricingResult.hassleFree.perks,
                warrantyMonths: pricingResult.hassleFree.warrantyMonths,
                isRecommended: pricingResult.hassleFree.isRecommended,
            } : undefined,
            highStandard: input.quoteMode === 'hhh' ? {
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

        const rateCardString = Object.entries(rateCard).map(([k, v]) => `${k} at £${v}/hr`).join(', ');
        const ratesContext = rateCardString
            ? `Use these specific contractor rates where applicable: ${rateCardString}. For unlisted tasks use default £${hourlyRate}/hr.`
            : `Estimate at flat £${hourlyRate}/hr.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Analyze this handyman job description. Return JSON with:
                    - totalEstimatedHours (number)
                    - basePricePounds (number) - calculated by summing (task hours * task rate) + £40 callout
                    - summary (string, professional summary)
                    - tasks (array of objects with description, estimatedHours, category, appliedRate)
                    - optionalExtras (array of objects with label, pricePence, description, isRecommended boolean).
                    
                    ${ratesContext}
                    Identify the category for each task to apply the correct rate.

                    BEHAVIORAL ECONOMICS FRAMEWORKS FOR 'summary':
                    1. Authority: Write as a Handy Services Verified Handyman.
                    2. Salience: Focus on the specific pain point and the CLEAR RESULT for the customer.
                    3. Plain Language: Clearly state the deliverables (what will be done) in simple, non-technical terms. Avoid jargon. (e.g. "We will supply and fit..." instead of "Procure and install...")
                    4. Format: 1-2 concise sentences, strictly professional.
                    `
                },
                {
                    role: "user",
                    content: `Job Description: ${jobDescription}\n\nOptional Extras Input: ${optionalExtrasRaw || "None"}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");
        res.json(result);

    } catch (error: any) {
        console.error("Job analysis error:", error?.message || error);

        // Always fallback to mock for now if AI fails (Unconditional fallback for debugging)
        console.warn("Analysis failed, returning mock data. Error:", error?.message);
        return res.json({
            totalEstimatedHours: 2,
            basePricePounds: (req.body.hourlyRate || 50) * 2 + 40,
            summary: "Standard repair service (Mock Analysis - AI Unavailable)",
            tasks: [{ description: req.body.jobDescription || "General repair", estimatedHours: 2, category: "general", appliedRate: req.body.hourlyRate || 50 }],
            optionalExtras: []
        });

        res.status(500).json({ error: "Analysis failed", details: error?.message || "Unknown error" });
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

        res.json({
            ...quote,
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
quotesRouter.post("/quotes/:id/share", async (req, res) => {
    const { id } = req.params;
    const { method, target } = req.body;

    console.log(`[Quote Share] Sending quote ${id} via ${method} to ${target}`);

    // Simulate delay
    await new Promise(r => setTimeout(r, 1000));

    res.json({ success: true, message: `Quote sent to ${target}` });
});

