/**
 * Contextual Pricing API Routes
 *
 * Endpoints:
 *   POST /api/pricing/compare                — Run both EVE and contextual engines, return comparison
 *   GET  /api/pricing/categories             — List all job categories (for UI dropdown)
 *   POST /api/pricing/parse-job              — Parse free-text job description into structured lines
 *   GET  /api/pricing/scenarios              — Pre-built test scenarios (for comparison UI)
 *   POST /api/pricing/create-contextual-quote — Create a persisted quote using the multi-line engine
 */

import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { generateContextualPrice } from './engine';
import { generateMultiLinePrice } from './multi-line-engine';
import { generateEVEPricingQuote, EVE_SEGMENT_RATES } from '../eve-pricing-engine';
import { getAllCategories } from './reference-rates';
import { JobCategoryValues } from '@shared/contextual-pricing-types';
import { parseJobDescription } from './job-parser';
import { db } from '../db';
import { personalizedQuotes, leads } from '@shared/schema';
import { normalizePhoneNumber } from '../phone-utils';
import { selectContentForQuote } from '../content-library/selector';
import type {
  PricingContext,
  PricingComparisonResult,
  TestScenario,
  MultiLineRequest,
  MultiLineTestScenario,
  JobCategory,
  ContextualSignals,
} from '@shared/contextual-pricing-types';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/pricing/compare
// ---------------------------------------------------------------------------

router.post('/api/pricing/compare', async (req, res) => {
  try {
    const context = req.body as PricingContext;

    // Basic validation
    if (!context.jobDescription || typeof context.jobDescription !== 'string') {
      return res.status(400).json({ error: 'jobDescription is required' });
    }
    if (!context.jobCategory || typeof context.jobCategory !== 'string') {
      return res.status(400).json({ error: 'jobCategory is required' });
    }
    if (
      !context.timeEstimateMinutes ||
      typeof context.timeEstimateMinutes !== 'number' ||
      context.timeEstimateMinutes <= 0
    ) {
      return res
        .status(400)
        .json({ error: 'timeEstimateMinutes must be a positive number' });
    }

    // Run EVE engine (cast to satisfy the extended interface — we only use segment + time)
    const eveResult = generateEVEPricingQuote({
      segment: context.segment,
      timeEstimateMinutes: context.timeEstimateMinutes,
    } as any);

    // Run contextual engine
    const contextualResult = await generateContextualPrice(context);

    // Calculate delta
    const deltaPence = contextualResult.finalPricePence - eveResult.price;
    const deltaPercent =
      eveResult.price > 0
        ? Math.round((deltaPence / eveResult.price) * 10000) / 100
        : 0;

    const eveHourlyRate =
      EVE_SEGMENT_RATES[context.segment] ??
      EVE_SEGMENT_RATES.UNKNOWN;

    const comparison: PricingComparisonResult = {
      eve: {
        pricePence: eveResult.price,
        segment: eveResult.segment,
        valueMultiplier: eveResult.valueMultiplier,
        hourlyRatePence: eveHourlyRate,
      },
      contextual: contextualResult,
      delta: {
        pence: deltaPence,
        percent: deltaPercent,
        direction:
          deltaPence > 0 ? 'higher' : deltaPence < 0 ? 'lower' : 'same',
      },
      inputContext: context,
      timestamp: new Date().toISOString(),
    };

    return res.json(comparison);
  } catch (error) {
    console.error('[pricing/compare] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate pricing comparison',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pricing/categories
// ---------------------------------------------------------------------------

router.get('/api/pricing/categories', (_req, res) => {
  return res.json(getAllCategories());
});

// ---------------------------------------------------------------------------
// POST /api/pricing/parse-job
// ---------------------------------------------------------------------------

router.post('/api/pricing/parse-job', async (req, res) => {
  try {
    const { description } = req.body as { description: string };

    if (!description || typeof description !== 'string') {
      return res
        .status(400)
        .json({ error: 'description is required and must be a string' });
    }
    if (description.trim().length === 0) {
      return res
        .status(400)
        .json({ error: 'description must not be empty' });
    }
    if (description.length > 2000) {
      return res
        .status(400)
        .json({ error: 'description must be at most 2000 characters' });
    }

    const result = await parseJobDescription(description.trim());
    return res.json(result);
  } catch (error) {
    console.error('[pricing/parse-job] Error:', error);
    return res.status(500).json({
      error: 'Failed to parse job description',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pricing/scenarios
// ---------------------------------------------------------------------------

const TEST_SCENARIOS: TestScenario[] = [
  {
    name: 'Flat pack - BUSY_PRO',
    description:
      'IKEA wardrobe assembly for a busy professional, standard timing',
    context: {
      jobDescription: 'IKEA PAX wardrobe assembly',
      jobCategory: 'flat_pack',
      timeEstimateMinutes: 120,
      jobCountInBatch: 1,
      segment: 'BUSY_PRO',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: null,
      urgency: 'standard',
      accessDifficulty: 'standard',
      materialsSupply: 'customer_supplied',
      timeOfService: 'standard',
      travelDistanceMiles: 5,
      currentCapacityPercent: 50,
    },
  },
  {
    name: 'Leaking tap - LANDLORD (emergency)',
    description: "Emergency tap repair for a landlord who can't be there",
    context: {
      jobDescription:
        'Kitchen tap leaking badly, tenant reports water pooling',
      jobCategory: 'plumbing_minor',
      timeEstimateMinutes: 45,
      jobCountInBatch: 1,
      segment: 'LANDLORD',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: null,
      urgency: 'emergency',
      accessDifficulty: 'standard',
      materialsSupply: 'we_supply',
      timeOfService: 'standard',
      travelDistanceMiles: 8,
      currentCapacityPercent: 70,
    },
  },
  {
    name: 'Shelf + door handle - DIY_DEFERRER (batch)',
    description: 'Two small jobs batched together, flexible timing',
    context: {
      jobDescription:
        'Mount 3 floating shelves in living room and fix loose door handle on bedroom door',
      jobCategory: 'general_fixing',
      timeEstimateMinutes: 90,
      jobCountInBatch: 2,
      segment: 'DIY_DEFERRER',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: null,
      urgency: 'standard',
      accessDifficulty: 'standard',
      materialsSupply: 'labor_only',
      timeOfService: 'standard',
      travelDistanceMiles: 4,
      currentCapacityPercent: 40,
    },
  },
  {
    name: 'Socket install - SMALL_BIZ (after hours)',
    description: 'Install 2 new sockets in a cafe, must be done after closing',
    context: {
      jobDescription:
        'Install 2 double sockets behind the counter area in a cafe',
      jobCategory: 'electrical_minor',
      timeEstimateMinutes: 90,
      jobCountInBatch: 1,
      segment: 'SMALL_BIZ',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: null,
      urgency: 'priority',
      accessDifficulty: 'standard',
      materialsSupply: 'we_supply',
      timeOfService: 'after_hours',
      travelDistanceMiles: 6,
      currentCapacityPercent: 75,
    },
  },
  {
    name: 'Tap repair - Returning LANDLORD',
    description: 'Returning landlord, 3rd job, tap washer replacement',
    context: {
      jobDescription: 'Tap washer replacement in bathroom, dripping',
      jobCategory: 'plumbing_minor',
      timeEstimateMinutes: 30,
      jobCountInBatch: 1,
      segment: 'LANDLORD',
      isReturningCustomer: true,
      previousJobCount: 2,
      previousAvgPricePence: 7500,
      urgency: 'standard',
      accessDifficulty: 'standard',
      materialsSupply: 'we_supply',
      timeOfService: 'standard',
      travelDistanceMiles: 5,
      currentCapacityPercent: 60,
    },
  },
  {
    name: 'Gutter clearing - BUDGET',
    description: 'Price-sensitive customer wanting gutters cleared',
    context: {
      jobDescription: 'Clear gutters on a 2-bed semi, front and back',
      jobCategory: 'guttering',
      timeEstimateMinutes: 60,
      jobCountInBatch: 1,
      segment: 'BUDGET',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: null,
      urgency: 'standard',
      accessDifficulty: 'high_ceiling',
      materialsSupply: 'labor_only',
      timeOfService: 'standard',
      travelDistanceMiles: 7,
      currentCapacityPercent: 30,
    },
  },
  {
    name: 'Tiling - PROP_MGR (multi-property)',
    description:
      'Property manager needs bathroom tiling across 2 rental units',
    context: {
      jobDescription:
        'Re-tile shower area in 2 rental flats, approx 3sqm each',
      jobCategory: 'tiling',
      timeEstimateMinutes: 360,
      jobCountInBatch: 2,
      segment: 'PROP_MGR',
      isReturningCustomer: true,
      previousJobCount: 5,
      previousAvgPricePence: 12000,
      urgency: 'standard',
      accessDifficulty: 'standard',
      materialsSupply: 'we_supply',
      timeOfService: 'standard',
      travelDistanceMiles: 10,
      currentCapacityPercent: 55,
    },
  },
];

router.get('/api/pricing/scenarios', (_req, res) => {
  return res.json(TEST_SCENARIOS);
});

// ---------------------------------------------------------------------------
// POST /api/pricing/multi-quote
// ---------------------------------------------------------------------------

router.post('/api/pricing/multi-quote', async (req, res) => {
  try {
    const request = req.body as MultiLineRequest;

    // Validate lines array
    if (!Array.isArray(request.lines) || request.lines.length === 0) {
      return res
        .status(400)
        .json({ error: 'lines must be a non-empty array' });
    }
    if (request.lines.length > 10) {
      return res
        .status(400)
        .json({ error: 'lines must contain at most 10 items' });
    }

    // Validate each line
    const validCategories = new Set<string>(JobCategoryValues);
    for (const line of request.lines) {
      if (!line.description || typeof line.description !== 'string') {
        return res.status(400).json({
          error: `Line "${line.id || '?'}": description is required`,
        });
      }
      if (!line.category || !validCategories.has(line.category)) {
        return res.status(400).json({
          error: `Line "${line.id || '?'}": category must be a valid job category`,
        });
      }
      if (
        !line.timeEstimateMinutes ||
        typeof line.timeEstimateMinutes !== 'number' ||
        line.timeEstimateMinutes <= 0
      ) {
        return res.status(400).json({
          error: `Line "${line.id || '?'}": timeEstimateMinutes must be a positive number`,
        });
      }
    }

    // Validate signals object exists
    if (!request.signals || typeof request.signals !== 'object') {
      return res.status(400).json({ error: 'signals object is required' });
    }

    const result = await generateMultiLinePrice(request);
    return res.json(result);
  } catch (error) {
    console.error('[pricing/multi-quote] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate multi-line pricing',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pricing/multi-scenarios
// ---------------------------------------------------------------------------

const MULTI_LINE_SCENARIOS: MultiLineTestScenario[] = [
  {
    name: 'Tap repair + shelf hanging',
    description:
      'Landlord with rental property, not on site, wants photos, standard urgency. 2 lines.',
    request: {
      lines: [
        {
          id: 'tap-1',
          description: 'Kitchen tap dripping, needs washer replacement',
          category: 'plumbing_minor',
          timeEstimateMinutes: 45,
        },
        {
          id: 'shelf-1',
          description: 'Hang 2 floating shelves in living room',
          category: 'general_fixing',
          timeEstimateMinutes: 30,
        },
      ],
      signals: {
        urgency: 'standard',
        materialsSupply: 'we_supply',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
  },
  {
    name: 'Full kitchen list — DIY Deferrer',
    description:
      'Homeowner on site, standard urgency, low frustration. 3 lines: door handles, shelf unit, kitchen touch-up.',
    request: {
      lines: [
        {
          id: 'handles-1',
          description: 'Replace 4 loose kitchen door handles',
          category: 'general_fixing',
          timeEstimateMinutes: 30,
        },
        {
          id: 'shelf-unit-1',
          description: 'Build and mount a shelf unit in kitchen alcove',
          category: 'carpentry',
          timeEstimateMinutes: 60,
        },
        {
          id: 'paint-1',
          description: 'Touch-up paint on kitchen walls and ceiling edges',
          category: 'painting',
          timeEstimateMinutes: 90,
        },
      ],
      signals: {
        urgency: 'standard',
        materialsSupply: 'customer_supplied',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
  },
  {
    name: 'Emergency plumbing — Landlord',
    description:
      'Landlord with rental property, not on site, emergency urgency, high frustration. 1 line.',
    request: {
      lines: [
        {
          id: 'plumb-emergency-1',
          description:
            'Burst pipe under kitchen sink, tenant reports water leaking',
          category: 'plumbing_minor',
          timeEstimateMinutes: 45,
        },
      ],
      signals: {
        urgency: 'emergency',
        materialsSupply: 'we_supply',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
  },
  {
    name: 'After-hours shop repair',
    description:
      'Commercial property owner, after-hours, priority urgency. 2 lines: electrical + carpentry.',
    request: {
      lines: [
        {
          id: 'elec-shop-1',
          description: 'Replace faulty socket behind counter, install new double socket',
          category: 'electrical_minor',
          timeEstimateMinutes: 60,
        },
        {
          id: 'carp-shop-1',
          description: 'Repair broken shelf brackets in storage room',
          category: 'carpentry',
          timeEstimateMinutes: 45,
        },
      ],
      signals: {
        urgency: 'priority',
        materialsSupply: 'we_supply',
        timeOfService: 'after_hours',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
  },
  {
    name: 'Budget single job',
    description:
      'Tenant in own home, standard urgency, low frustration. 1 line: general fixing.',
    request: {
      lines: [
        {
          id: 'fix-budget-1',
          description: 'Fix squeaky door hinge and reattach loose towel rail',
          category: 'general_fixing',
          timeEstimateMinutes: 45,
        },
      ],
      signals: {
        urgency: 'standard',
        materialsSupply: 'labor_only',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
  },
];

router.get('/api/pricing/multi-scenarios', (_req, res) => {
  return res.json(MULTI_LINE_SCENARIOS);
});

// ---------------------------------------------------------------------------
// POST /api/pricing/create-contextual-quote
// ---------------------------------------------------------------------------

const contextualQuoteInputSchema = z.object({
  // Customer info
  customerName: z.string().min(1, 'Customer name is required'),
  phone: z.string().min(1, 'Phone number is required'),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  postcode: z.string().optional(),

  // Job details
  jobDescription: z.string().optional(),
  lines: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        category: z.enum(JobCategoryValues as unknown as [string, ...string[]]),
        estimatedMinutes: z.number().positive(),
        materialsCostPence: z.number().min(0).optional().default(0),
      }),
    )
    .min(1, 'At least one line item is required'),

  // Context signals (all optional — engine uses defaults)
  signals: z
    .object({
      urgency: z.enum(['standard', 'priority', 'emergency']).optional(),
      materialsSupply: z.enum(['customer_supplied', 'we_supply', 'labor_only']).optional(),
      timeOfService: z.enum(['standard', 'after_hours', 'weekend']).optional(),
      isReturningCustomer: z.boolean().optional(),
      previousJobCount: z.number().optional(),
      previousAvgPricePence: z.number().optional(),
    })
    .optional(),

  // Source tracking
  sourceCallId: z.string().optional(),
  sourceLeadId: z.string().optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
});

/**
 * Format a phone number for use in a wa.me link.
 * Strips spaces/dashes, replaces leading 0 with 44.
 */
function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  // Remove leading + if present for wa.me format
  cleaned = cleaned.replace(/^\+/, '');
  // If starts with 0, replace with 44 (UK)
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.substring(1);
  }
  return cleaned;
}

/**
 * Generate a unique 8-char short slug, checking for collisions.
 */
async function generateUniqueSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = Math.random().toString(36).substring(2, 10);
    const existing = await db
      .select({ id: personalizedQuotes.id })
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.shortSlug, slug))
      .limit(1);
    if (existing.length === 0) return slug;
  }
  // Fallback to nanoid if random collisions (extremely unlikely)
  return nanoid(8);
}

router.post('/api/pricing/create-contextual-quote', async (req, res) => {
  try {
    // 1. Validate input
    const input = contextualQuoteInputSchema.parse(req.body);

    // 2. Build MultiLineRequest
    const signals: ContextualSignals = {
      urgency: input.signals?.urgency || 'standard',
      materialsSupply: input.signals?.materialsSupply || 'labor_only',
      timeOfService: input.signals?.timeOfService || 'standard',
      isReturningCustomer: input.signals?.isReturningCustomer ?? false,
      previousJobCount: input.signals?.previousJobCount ?? 0,
      previousAvgPricePence: input.signals?.previousAvgPricePence ?? 0,
    };

    const multiLineRequest: MultiLineRequest = {
      lines: input.lines.map((l) => ({
        id: l.id,
        description: l.description,
        category: l.category as JobCategory,
        timeEstimateMinutes: l.estimatedMinutes,
        materialsCostPence: l.materialsCostPence || 0,
      })),
      signals,
    };

    // 3. Select content from the content library based on job categories + signals
    const jobCategories = Array.from(new Set(input.lines.map((l) => l.category)));
    let contentSelection: Awaited<ReturnType<typeof selectContentForQuote>> | null = null;
    let approvedClaimTexts: string[] | undefined;

    try {
      contentSelection = await selectContentForQuote(jobCategories, signals);
      // If we got claims from the library, use them as the approved list for the LLM
      if (contentSelection.claims.length > 0) {
        approvedClaimTexts = contentSelection.claims.map((c) => c.text);
        console.log(
          `[ContextualQuote] Content library: ${approvedClaimTexts.length} claims matched for categories [${jobCategories.join(', ')}]`,
        );
      }
    } catch (contentError) {
      // Content library is optional — if it fails, fall back to hardcoded claims
      console.warn(
        '[ContextualQuote] Content library selection failed, using hardcoded claims:',
        contentError instanceof Error ? contentError.message : contentError,
      );
    }

    // 4. Call multi-line pricing engine (with content-library claims if available)
    const result = await generateMultiLinePrice(multiLineRequest, approvedClaimTexts);

    // 4b. Override booking modes from content library if available
    if (contentSelection?.bookingModes && contentSelection.bookingModes.length > 0) {
      // Content library booking rules take precedence over the deterministic engine
      // only if a matching rule was found (i.e. not just the default)
      const isDefaultFallback =
        contentSelection.bookingModes.length === 1 &&
        contentSelection.bookingModes[0] === 'standard_date';
      if (!isDefaultFallback) {
        result.messaging.bookingModes = contentSelection.bookingModes as any;
      }
    }

    // 5. Generate short slug (with uniqueness check)
    const shortSlug = await generateUniqueSlug();
    const id = `quote_${nanoid()}`;

    // 6. Find or create lead
    let linkedLeadId: string | null = input.sourceLeadId || null;
    const normalizedPhone = normalizePhoneNumber(input.phone);

    if (!linkedLeadId && normalizedPhone) {
      const existingLeads = await db
        .select()
        .from(leads)
        .where(eq(leads.phone, normalizedPhone))
        .limit(1);

      if (existingLeads.length > 0) {
        linkedLeadId = existingLeads[0].id;
        console.log(`[ContextualQuote→Lead] Linked to existing lead ${linkedLeadId}`);
      } else {
        linkedLeadId = `lead_ctx_${Date.now()}`;
        await db.insert(leads).values({
          id: linkedLeadId,
          customerName: input.customerName,
          phone: normalizedPhone,
          email: input.email || null,
          source: 'contextual_quote',
          jobDescription: input.jobDescription || input.lines.map((l) => l.description).join('; '),
          postcode: input.postcode || null,
          addressRaw: input.address || null,
          status: 'quote_sent',
        });
        console.log(`[ContextualQuote→Lead] Created new lead ${linkedLeadId}`);
      }
    }

    // 6. Build quote URL
    const baseUrl = process.env.BASE_URL || 'https://handyservices.app';
    const quoteUrl = `${baseUrl}/quote/${shortSlug}`;

    // 7. Insert into personalizedQuotes
    const quoteInsertData = {
      id,
      shortSlug,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email || null,
      address: input.address || null,
      postcode: input.postcode || null,
      jobDescription: input.jobDescription || input.lines.map((l) => l.description).join('; '),
      quoteMode: 'simple' as const,
      leadId: linkedLeadId,

      // Canonical price
      basePrice: result.finalPricePence,

      // Segment marker for contextual quotes
      segment: 'CONTEXTUAL',

      // Contextual messaging fields
      contextualHeadline: result.messaging.contextualHeadline,
      contextualMessage: result.messaging.contextualMessage,
      valueBullets: result.messaging.valueBullets,
      whatsappValueLines: result.messaging.whatsappValueLines,
      whatsappClosing: result.messaging.whatsappClosing,
      layoutTier: result.messaging.layoutTier,
      bookingModes: result.messaging.bookingModes,
      requiresHumanReview: result.messaging.requiresHumanReview,
      reviewReason: result.messaging.reviewReason || null,

      // Full pricing data for admin/debugging
      pricingLineItems: result.lineItems,
      pricingLayerBreakdown: result,
      batchDiscountPercent: result.batchDiscount.discountPercent,

      // Raw signals for analytics/retraining
      contextSignals: input.signals || {},

      // Content library: selected content IDs for conversion tracking
      selectedContentIds: contentSelection
        ? {
            claimIds: contentSelection.claims.map((c) => c.id),
            guaranteeId: contentSelection.guarantee?.id ?? null,
            testimonialIds: contentSelection.testimonials.map((t) => t.id),
            hassleItemIds: contentSelection.hassleItems.map((h) => h.id),
            imageIds: contentSelection.images.map((i) => i.id),
          }
        : null,

      // Quote attribution
      createdBy: input.createdBy || null,
      createdByName: input.createdByName || null,

      createdAt: new Date(),
    };

    await db.insert(personalizedQuotes).values(quoteInsertData);
    console.log(`[ContextualQuote] Created quote ${shortSlug} (${id}), price: ${result.finalPricePence}p`);

    // 8. Build WhatsApp message
    const firstName = input.customerName.split(' ')[0] || input.customerName;
    const whatsappValueLinesText = (result.messaging.whatsappValueLines || [])
      .map((line) => line)
      .join('\n');

    const whatsappMessage = [
      `Hi ${firstName},`,
      '',
      result.messaging.contextualMessage,
      '',
      whatsappValueLinesText,
      '',
      'View your quote and book directly:',
      quoteUrl,
      '',
      result.messaging.whatsappClosing,
      '',
      '4.9\u2605 rated \u00B7 \u00A32M insured',
    ].join('\n');

    const waPhone = formatPhoneForWhatsApp(normalizedPhone || input.phone);
    const whatsappSendUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(whatsappMessage)}`;

    // 9. Format total for display
    const totalPounds = result.finalPricePence / 100;
    const totalFormatted =
      totalPounds % 1 === 0
        ? `\u00A3${totalPounds.toFixed(0)}`
        : `\u00A3${totalPounds.toFixed(2)}`;

    // 10. Return response
    return res.status(201).json({
      success: true,
      quoteId: id,
      shortSlug,
      quoteUrl,
      whatsappMessage,
      whatsappSendUrl,
      pricing: {
        totalPence: result.finalPricePence,
        totalFormatted,
        lineItems: result.lineItems,
        batchDiscount: result.batchDiscount,
      },
      messaging: {
        headline: result.messaging.contextualHeadline,
        message: result.messaging.contextualMessage,
        valueBullets: result.messaging.valueBullets,
        whatsappValueLines: result.messaging.whatsappValueLines,
        whatsappClosing: result.messaging.whatsappClosing,
        layoutTier: result.messaging.layoutTier,
        bookingModes: result.messaging.bookingModes,
        requiresHumanReview: result.messaging.requiresHumanReview,
        ...(result.messaging.reviewReason
          ? { reviewReason: result.messaging.reviewReason }
          : {}),
      },
      // Content library selections (for frontend rendering)
      ...(contentSelection
        ? {
            contentLibrary: {
              guarantee: contentSelection.guarantee,
              testimonials: contentSelection.testimonials,
              hassleItems: contentSelection.hassleItems,
              images: contentSelection.images,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[pricing/create-contextual-quote] Validation error:', error.errors);
      return res.status(400).json({
        error: 'Invalid input',
        details: error.errors,
      });
    }
    console.error('[pricing/create-contextual-quote] Error:', error);
    return res.status(500).json({
      error: 'Failed to create contextual quote',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
