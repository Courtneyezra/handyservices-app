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
import { eq, gte, and, sql, desc } from 'drizzle-orm';
import { getAnthropic } from '../anthropic';
import { generateContextualPrice } from './engine';
import { generateMultiLinePrice } from './multi-line-engine';
import { generateEVEPricingQuote, EVE_SEGMENT_RATES } from '../eve-pricing-engine';
import { getAllCategories } from './reference-rates';
import { JobCategoryValues } from '@shared/contextual-pricing-types';
import { parseJobDescription } from './job-parser';
import { db } from '../db';
import { personalizedQuotes, leads, quotePlatformImages, quotePlatformHeadlines, handymanProfiles, handymanSkills, users } from '@shared/schema';
import { normalizePhoneNumber } from '../phone-utils';
import { selectContentForQuote } from '../content-library/selector';
import { trackQuoteCreated } from '../posthog';
import { calculateMultiLineCost, checkMargin, calculateCostFromWTBP } from '../margin-engine';
import type {
  PricingContext,
  PricingComparisonResult,
  TestScenario,
  MultiLineRequest,
  MultiLineTestScenario,
  JobCategory,
  ContextualSignals,
  MarginPreview,
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
// POST /api/pricing/polish-description
// ---------------------------------------------------------------------------

router.post('/api/pricing/polish-description', async (req, res) => {
  try {
    const { description } = req.body as { description: string };

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'description is required' });
    }
    const trimmed = description.trim();
    if (trimmed.length === 0) {
      return res.status(400).json({ error: 'description must not be empty' });
    }
    // Too short to polish — return as-is
    if (trimmed.length < 5) {
      return res.json({ polished: trimmed });
    }

    const claude = getAnthropic();
    const message = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `You are a job description polisher for a UK handyman service.
Clean up Ben the estimator's rough notes into a clear, professional one-line scope of work.

Rules:
- Keep it SHORT (max 8–10 words). Customers see this on their quote.
- Start with a verb: Fix, Mount, Install, Replace, Repair, Assemble, Paint, Hang, etc.
- Remove filler words, prices, timings, and customer details.
- Keep specific details that affect scope (e.g. "55 inch", "brick wall", "3 shelves").
- UK English spelling (e.g. "metre" not "meter", "colour" not "color").
- Return ONLY the polished text. No quotes, no explanation.
- If it's already clean, return it unchanged.`,
      messages: [
        {
          role: 'user',
          content: trimmed,
        },
      ],
    });

    const textBlock = message.content.find((b: any) => b.type === 'text');
    const polished = textBlock?.text?.trim() || trimmed;
    return res.json({ polished });
  } catch (error: any) {
    console.error('[pricing/polish-description] Error:', error?.message || error);
    // On error, return original — don't block the user
    return res.json({ polished: req.body?.description?.trim() || '' });
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

    // Calculate margin preview using revenue share model (non-blocking)
    // Uses POST-discount prices so contractor + platform = engine total
    let marginPreview: MarginPreview | undefined;
    try {
      // Apply batch discount proportionally to each line's labour price
      const discountFactor = result.batchDiscount.applied
        ? 1 - (result.batchDiscount.discountPercent / 100)
        : 1;

      const wtbpLines = result.lineItems.map((l) => ({
        categorySlug: l.category,
        pricePence: Math.round(l.guardedPricePence * discountFactor) + (l.materialsWithMarginPence || 0),
        timeEstimateMinutes: l.timeEstimateMinutes || 60,
      }));

      if (wtbpLines.length > 0) {
        const wtbpResult = await calculateCostFromWTBP(wtbpLines);
        const perLineMargin = wtbpResult.perLineMargin;

        const totalCustomer = perLineMargin.reduce((s, l) => s + l.customerPricePence, 0);
        const totalCost = perLineMargin.reduce((s, l) => s + l.contractorCostPence, 0);
        const totalMargin = totalCustomer - totalCost;
        const totalMarginPct = totalCustomer > 0
          ? Math.round((totalMargin / totalCustomer) * 100)
          : 0;

        const uncovered = wtbpResult.uncoveredCategories;

        const flags: string[] = [...wtbpResult.flags];
        if (totalMarginPct < 0) {
          flags.push(`Negative margin: contractor cost exceeds quote price`);
        } else if (totalMarginPct < 20) {
          flags.push(`Critical: overall margin only ${totalMarginPct}%`);
        } else if (totalMarginPct < 30) {
          flags.push(`Thin margin: overall ${totalMarginPct}%`);
        }
        for (const pl of perLineMargin) {
          if (pl.marginPercent < 20) {
            flags.push(`${pl.categorySlug}: margin ${pl.marginPercent}%`);
          }
        }
        if (uncovered.length > 0) {
          flags.push(`No WTBP rate set for: ${uncovered.join(', ')}`);
        }

        marginPreview = {
          totalCostPence: totalCost,
          totalMarginPence: totalMargin,
          totalMarginPercent: totalMarginPct,
          perLineMargin,
          uncoveredCategories: uncovered,
          flags,
        };
      }
    } catch (err) {
      // Non-blocking — margin preview is optional
      console.warn('[pricing/multi-quote] Margin preview failed:', err instanceof Error ? err.message : err);
    }

    return res.json({ ...result, marginPreview });
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
// GET /api/pricing/contractors — Lightweight list for quote builder dropdown
// ---------------------------------------------------------------------------

router.get('/api/pricing/contractors', async (_req, res) => {
  try {
    const contractors = await db.select({
      id: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      profileImageUrl: handymanProfiles.profileImageUrl,
      availabilityStatus: handymanProfiles.availabilityStatus,
      city: handymanProfiles.city,
      postcode: handymanProfiles.postcode,
    })
    .from(handymanProfiles)
    .innerJoin(users, eq(handymanProfiles.userId, users.id))
    .orderBy(desc(handymanProfiles.lastAssignedAt));

    // Get skills grouped by contractor
    const allSkills = await db.select({
      handymanId: handymanSkills.handymanId,
      categorySlug: handymanSkills.categorySlug,
      proficiency: handymanSkills.proficiency,
    })
    .from(handymanSkills);

    const skillsMap = new Map<string, Array<{ categorySlug: string | null; proficiency: string | null }>>();
    for (const s of allSkills) {
      if (!skillsMap.has(s.handymanId)) skillsMap.set(s.handymanId, []);
      skillsMap.get(s.handymanId)!.push({ categorySlug: s.categorySlug, proficiency: s.proficiency });
    }

    const result = contractors.map(c => ({
      id: c.id,
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed',
      profileImageUrl: c.profileImageUrl,
      availabilityStatus: c.availabilityStatus,
      city: c.city,
      postcode: c.postcode,
      skills: skillsMap.get(c.id) || [],
      categorySlugs: (skillsMap.get(c.id) || []).map(s => s.categorySlug).filter(Boolean),
    }));

    return res.json(result);
  } catch (err) {
    console.error('[pricing/contractors] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch contractors' });
  }
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
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
  vaContext: z.string().max(2000).optional(),

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

  // Contractor assignment (optional — shows their profile on the quote page)
  contractorId: z.string().optional(),

  // Admin-picked available dates (hard whitelist for customer date picker). Required at generation time.
  availableDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'availableDates must be YYYY-MM-DD'))
    .min(1, 'Select at least one available date'),
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
      vaContext: input.vaContext,
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

        // Force-inject context-critical claims that the scoring may have missed
        const vaLower = (input.vaContext || '').toLowerCase();
        const FORCED_CLAIMS: Array<{ keywords: string[]; claim: string; signalMatch?: boolean }> = [
          { keywords: ['invoice', 'tax', 'receipt', 'pays promptly', 'accounting', 'same-day invoice'], claim: 'Tax-ready invoice emailed same day' },
          { keywords: ['photo', 'photos', 'report', 'send me', "won't be there", "can't be there", "cannot be there"], claim: 'Photo report on completion' },
          { keywords: ['tenant', 'letting', 'rental', 'landlord'], claim: 'Tenant coordination available' },
          // Signal-based force-injections (no vaContext keyword needed)
          {
            keywords: ['evening', 'weekend', 'after hours', 'after-hours', 'saturday', 'sunday', 'tonight', 'tonight'],
            claim: 'Evening/weekend slots available',
            signalMatch: signals.timeOfService === 'after_hours' || signals.timeOfService === 'weekend',
          },
          {
            keywords: ['emergency', 'urgent', 'asap', 'right away', 'immediately', 'today', 'now'],
            claim: 'Emergency same-day available',
            signalMatch: signals.urgency === 'emergency',
          },
        ];
        for (const { keywords, claim, signalMatch } of FORCED_CLAIMS) {
          if (!approvedClaimTexts.includes(claim) && (signalMatch || keywords.some(kw => vaLower.includes(kw)))) {
            approvedClaimTexts.push(claim);
          }
        }

        console.log(
          `[ContextualQuote] Content library: ${approvedClaimTexts.length} claims for categories [${jobCategories.join(', ')}]`,
        );
      }
    } catch (contentError) {
      // Content library is optional — if it fails, fall back to hardcoded claims
      console.warn(
        '[ContextualQuote] Content library selection failed, using hardcoded claims:',
        contentError instanceof Error ? contentError.message : contentError,
      );
    }

    // 3b. Fetch historical win rate for similar quotes (last 90 days) — non-blocking
    let historicalWinRate: number | undefined;
    try {
      const winRateResult = await db
        .select({
          total: sql<number>`COUNT(*)`,
          booked: sql<number>`COUNT(CASE WHEN booked_at IS NOT NULL THEN 1 END)`,
        })
        .from(personalizedQuotes)
        .where(
          and(
            gte(personalizedQuotes.createdAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
          )
        )
        .limit(1);

      if (winRateResult[0] && Number(winRateResult[0].total) >= 5) {
        historicalWinRate = Math.round(
          (Number(winRateResult[0].booked) / Number(winRateResult[0].total)) * 100,
        );
        console.log(`[ContextualQuote] Historical win rate: ${historicalWinRate}% (${winRateResult[0].booked}/${winRateResult[0].total})`);
      }
    } catch {
      // Non-blocking — if this fails, continue without win rate data
      historicalWinRate = undefined;
    }

    // Attach win rate to the request so the LLM can calibrate confidence
    multiLineRequest.historicalWinRate = historicalWinRate;

    // 4. Call multi-line pricing engine (with content-library claims if available)
    const result = await generateMultiLinePrice(multiLineRequest, approvedClaimTexts);

    // 4a. Dead zone detection — £100-£200 band has 0% conversion in analytics
    // Apply enhanced value framing as a post-processing step (after LLM has set the price)
    const isDeadZone = result.finalPricePence >= 10000 && result.finalPricePence <= 20000;
    if (isDeadZone) {
      // Ensure "Fixed price — no surprises" and "90-day workmanship guarantee" are in valueBullets
      const deadZoneValueClaims = ['Fixed price — no surprises', '90-day workmanship guarantee'];
      for (const claim of deadZoneValueClaims) {
        if (!result.messaging.valueBullets.includes(claim)) {
          result.messaging.valueBullets.push(claim);
        }
      }

      // Per-day cost reframing: anchors the price against the daily cost of procrastination
      const pricePerDay = Math.round(result.finalPricePence / 100 / 30);
      result.messaging.deadZoneFraming = `That's around £${pricePerDay} a day for 30 days of not having to think about this.`;

      console.log(`[ContextualQuote] Dead zone detected (${result.finalPricePence}p) — enhanced framing applied. Per-day: £${pricePerDay}`);
    }

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

    // 6b. Margin Engine — calculate contractor cost & check margin
    let marginData: {
      costPence: number | null;
      marginPence: number | null;
      marginPercent: number | null;
      marginFlags: string[] | null;
      matchedContractorId: string | null;
      matchedContractorRate: number | null;
    } = {
      costPence: null,
      marginPence: null,
      marginPercent: null,
      marginFlags: null,
      matchedContractorId: null,
      matchedContractorRate: null,
    };

    let marginPreviewData: MarginPreview | undefined;

    try {
      const costLines = result.lineItems.map((l) => ({
        category: l.category as JobCategory,
        timeEstimateMinutes: l.timeEstimateMinutes,
      }));

      if (costLines.length > 0) {
        const costResult = await calculateMultiLineCost(costLines);
        const primaryCategory = costLines.reduce(
          (a, b) => (a.timeEstimateMinutes > b.timeEstimateMinutes ? a : b),
          costLines[0]
        ).category;

        const marginResult = checkMargin(result.finalPricePence, costResult.totalCostPence, primaryCategory);

        marginData = {
          costPence: costResult.totalCostPence,
          marginPence: marginResult.marginPence,
          marginPercent: marginResult.marginPercent,
          marginFlags: marginResult.flags.length > 0 ? marginResult.flags : null,
          matchedContractorId: costResult.contractorId,
          matchedContractorRate: costResult.contractorRate,
        };

        // Build revenue-share margin preview for the admin UI
        // Apply batch discount proportionally so totals match engine total
        const discountFactor = result.batchDiscount.applied
          ? 1 - (result.batchDiscount.discountPercent / 100)
          : 1;

        const wtbpLines = result.lineItems.map((l) => ({
          categorySlug: l.category,
          pricePence: Math.round(l.guardedPricePence * discountFactor) + (l.materialsWithMarginPence || 0),
          timeEstimateMinutes: l.timeEstimateMinutes || 60,
        }));
        const wtbpResult = await calculateCostFromWTBP(wtbpLines);

        const totalCustomer = wtbpResult.perLineMargin.reduce((s, l) => s + l.customerPricePence, 0);
        const totalCost = wtbpResult.perLineMargin.reduce((s, l) => s + l.contractorCostPence, 0);
        const totalMargin = totalCustomer - totalCost;
        const totalMarginPct = totalCustomer > 0
          ? Math.round((totalMargin / totalCustomer) * 100)
          : 0;

        const flags: string[] = [...(marginResult.flags || []), ...wtbpResult.flags];

        marginPreviewData = {
          totalCostPence: totalCost,
          totalMarginPence: totalMargin,
          totalMarginPercent: totalMarginPct,
          perLineMargin: wtbpResult.perLineMargin,
          uncoveredCategories: wtbpResult.uncoveredCategories,
          flags,
        };

        if (marginResult.flags.length > 0) {
          console.log(`[ContextualQuote] Margin flags for ${shortSlug}: ${marginResult.flags.join(', ')}`);
        } else {
          console.log(`[ContextualQuote] Margin healthy: ${marginResult.marginPercent}% (cost: £${(costResult.totalCostPence / 100).toFixed(2)}, price: £${(result.finalPricePence / 100).toFixed(2)})`);
        }
      }
    } catch (marginError) {
      console.warn('[ContextualQuote] Margin calculation failed (non-blocking):', marginError instanceof Error ? marginError.message : marginError);
    }

    // 7. Insert into personalizedQuotes
    const quoteInsertData = {
      id,
      shortSlug,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email || null,
      address: input.address || null,
      postcode: input.postcode || null,
      coordinates: input.coordinates || null,
      jobDescription: input.jobDescription || input.lines.map((l) => l.description).join('; '),
      quoteMode: 'simple' as const,
      leadId: linkedLeadId,

      // Canonical price
      basePrice: result.finalPricePence,

      // Segment marker for contextual quotes
      segment: 'CONTEXTUAL',

      // Contractor assignment — shows their profile on the customer quote page
      contractorId: input.contractorId || null,

      // Contextual messaging fields
      contextualHeadline: result.messaging.contextualHeadline,
      contextualMessage: result.messaging.contextualMessage,
      jobTopLine: result.jobTopLine || result.messaging.jobTopLine || undefined,
      proposalSummary: result.messaging.proposalSummary,
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
      contextSignals: { ...(input.signals || {}), vaContext: input.vaContext || null },

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

      // Admin-picked available dates (hard whitelist for customer date picker)
      availableDates: input.availableDates,

      // Margin Engine data
      costPence: marginData.costPence,
      marginPence: marginData.marginPence,
      marginPercent: marginData.marginPercent,
      marginFlags: marginData.marginFlags,
      // matchedContractorId/Rate intentionally NOT saved — contractors are assigned post-payment via dispatch pool
      matchedContractorId: null,
      matchedContractorRate: null,

      createdAt: new Date(),
    };

    await db.insert(personalizedQuotes).values(quoteInsertData);
    console.log(`[ContextualQuote] Created quote ${shortSlug} (${id}), price: ${result.finalPricePence}p`);

    // 7b. Track in PostHog (server-side, non-blocking)
    try {
      trackQuoteCreated({
        distinctId: normalizedPhone || input.phone,
        quoteId: id,
        shortSlug,
        customerName: input.customerName,
        phone: input.phone,
        postcode: input.postcode,
        segment: 'CONTEXTUAL',
        finalPricePence: result.finalPricePence,
        subtotalPence: result.subtotalPence,
        lineItems: result.lineItems.map(l => ({
          lineId: l.lineId,
          category: l.category,
          description: l.description,
          timeEstimateMinutes: l.timeEstimateMinutes,
          referencePricePence: l.referencePricePence,
          llmSuggestedPricePence: l.llmSuggestedPricePence,
          guardedPricePence: l.guardedPricePence,
          materialsCostPence: l.materialsCostPence,
          materialsWithMarginPence: l.materialsWithMarginPence,
          adjustmentFactors: l.adjustmentFactors,
        })),
        batchDiscount: result.batchDiscount,
        layerBreakdown: result.layerBreakdown,
        confidence: result.confidence,
        signals: input.signals || {},
        layoutTier: result.messaging.layoutTier,
        bookingModes: result.messaging.bookingModes,
        requiresHumanReview: result.messaging.requiresHumanReview,
        contentLibraryUsed: !!contentSelection,
        selectedContentIds: contentSelection
          ? {
              claimIds: contentSelection.claims.map(c => c.id),
              guaranteeId: contentSelection.guarantee?.id ?? null,
              testimonialIds: contentSelection.testimonials.map(t => t.id),
              hassleItemIds: contentSelection.hassleItems.map(h => h.id),
              imageIds: contentSelection.images.map(i => i.id),
            }
          : undefined,
        createdBy: input.createdBy || undefined,
        linkedLeadId: linkedLeadId || undefined,
      });
    } catch (trackingErr) {
      console.warn('[ContextualQuote] PostHog tracking failed (non-blocking):', trackingErr);
    }

    // 8. Build WhatsApp message
    const firstName = input.customerName.split(' ')[0] || input.customerName;
    const layoutTier = result.messaging.layoutTier || 'standard';

    // 9. Format total for display (moved before message assembly so it can be used in directPriceMessage)
    const totalPounds = result.finalPricePence / 100;
    const totalFormatted =
      totalPounds % 1 === 0
        ? `\u00A3${totalPounds.toFixed(0)}`
        : `\u00A3${totalPounds.toFixed(2)}`;

    // Link label varies by job complexity — feels human, not corporate
    const linkLabel =
      layoutTier === 'quick'
        ? "Here's the link:"
        : layoutTier === 'complex'
          ? "Got everything in the quote with a full breakdown:"
          : "Here's the quote:";

    // Add batch nudge for single-job quotes — surfaces the "while we're there" opportunity
    const batchNudge = input.lines.length === 1
      ? '\n\nAnything else to sort while we\'re there? Happy to add it to the same visit.'
      : '';

    const whatsappMessage = [
      `Hey ${firstName},`,
      '',
      result.messaging.contextualMessage,
      '',
      linkLabel,
      quoteUrl,
      '',
      result.messaging.whatsappClosing,
    ].join('\n') + batchNudge;

    const waPhone = formatPhoneForWhatsApp(normalizedPhone || input.phone);
    const whatsappSendUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(whatsappMessage)}`;

    // Direct price messages removed — always send link-based quotes
    const directPriceMessage: string | null = null;

    // Detect managed tier signals from vaContext (landlord/remote/tenant scenarios)
    const vaCtxLower = (input.vaContext || '').toLowerCase();
    const MANAGED_SIGNALS = ['remote', 'away', 'tenant', 'photo', 'key collect', 'key pickup', 'landlord', "not there", "won't be", "can't be", "wont be", "cant be", 'send me', 'rental', 'airbnb', 'letting', 'buy to let', 'btl', 'estate agent'];
    const managedTierAvailable = MANAGED_SIGNALS.some(kw => vaCtxLower.includes(kw));

    // Add-on bundle: Photo Report + Tenant Coordination (£55, saving £20 vs. separate)
    const addOnPricing = {
      bundlePricePence: 5500,
      bundleSavingPence: 2000,
      bundleLabel: 'Photo Report + Tenant Coordination',
      bundleItems: ['Full photo report on completion', 'Tenant coordination (we liaise so you don\'t have to)'],
      individualPricePence: 7500,
    };

    // 10. Return response
    return res.status(201).json({
      success: true,
      quoteId: id,
      shortSlug,
      quoteUrl,
      whatsappMessage,
      whatsappSendUrl,
      directPriceMessage,
      directPriceSendUrl: directPriceMessage
        ? `https://wa.me/${waPhone}?text=${encodeURIComponent(directPriceMessage)}`
        : null,
      managedTierAvailable,
      addOnPricing,
      pricing: {
        totalPence: result.finalPricePence,
        totalFormatted,
        lineItems: result.lineItems,
        batchDiscount: result.batchDiscount,
      },
      jobTopLine: result.jobTopLine || '',
      messaging: {
        headline: result.messaging.contextualHeadline,
        message: result.messaging.contextualMessage,
        proposalSummary: result.messaging.proposalSummary,
        valueBullets: result.messaging.valueBullets,
        whatsappValueLines: result.messaging.whatsappValueLines,
        whatsappClosing: result.messaging.whatsappClosing,
        layoutTier: result.messaging.layoutTier,
        bookingModes: result.messaging.bookingModes,
        requiresHumanReview: result.messaging.requiresHumanReview,
        ...(result.messaging.reviewReason
          ? { reviewReason: result.messaging.reviewReason }
          : {}),
        ...(result.messaging.deadZoneFraming
          ? { deadZoneFraming: result.messaging.deadZoneFraming }
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
            selectedContent: {
              guarantee: contentSelection.guarantee
                ? {
                    id: contentSelection.guarantee.id,
                    title: contentSelection.guarantee.title,
                    description: contentSelection.guarantee.description,
                    items: contentSelection.guarantee.items,
                    badges: contentSelection.guarantee.badges,
                  }
                : null,
              testimonials: contentSelection.testimonials.map((t) => ({
                id: t.id,
                author: t.author,
                location: t.location,
                text: t.text,
                rating: t.rating,
                jobCategories: t.jobCategories,
              })),
              hassleItems: contentSelection.hassleItems.map((h) => ({
                id: h.id,
                withoutUs: h.withoutUs,
                withUs: h.withUs,
              })),
              claims: contentSelection.claims.map((c) => ({
                id: c.id,
                text: c.text,
                category: c.category,
              })),
              images: contentSelection.images.map((i) => ({
                id: i.id,
                url: i.url,
                alt: i.alt,
                placement: i.placement,
              })),
            },
          }
        : { selectedContent: null }),
      ...(marginPreviewData ? { marginPreview: marginPreviewData } : {}),
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

// ---------------------------------------------------------------------------
// POST /api/quote-platform/images/track-view
// Increment view_count on a quote platform image. No auth — called from public quote page.
// ---------------------------------------------------------------------------
router.post('/api/quote-platform/images/track-view', async (req, res) => {
  try {
    const { imageId } = req.body;
    if (!imageId || typeof imageId !== 'number') {
      return res.status(400).json({ error: 'imageId (number) required' });
    }
    await db
      .update(quotePlatformImages)
      .set({ viewCount: sql`${quotePlatformImages.viewCount} + 1` })
      .where(eq(quotePlatformImages.id, imageId));
    return res.json({ ok: true });
  } catch (error) {
    console.error('[quote-platform/images/track-view]', error);
    return res.status(500).json({ error: 'Failed to track image view' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/quote-platform/images/track-booking
// Increment booking_count on a quote platform image. No auth — called from public quote page.
// ---------------------------------------------------------------------------
router.post('/api/quote-platform/images/track-booking', async (req, res) => {
  try {
    const { imageId } = req.body;
    if (!imageId || typeof imageId !== 'number') {
      return res.status(400).json({ error: 'imageId (number) required' });
    }
    await db
      .update(quotePlatformImages)
      .set({ bookingCount: sql`${quotePlatformImages.bookingCount} + 1` })
      .where(eq(quotePlatformImages.id, imageId));
    return res.json({ ok: true });
  } catch (error) {
    console.error('[quote-platform/images/track-booking]', error);
    return res.status(500).json({ error: 'Failed to track image booking' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/quote-platform/headlines/track-view
// Increment view_count on a quote platform headline variant.
// ---------------------------------------------------------------------------
router.post('/api/quote-platform/headlines/track-view', async (req, res) => {
  try {
    const { headlineId } = req.body;
    if (!headlineId || typeof headlineId !== 'number') {
      return res.status(400).json({ error: 'headlineId (number) required' });
    }
    await db
      .update(quotePlatformHeadlines)
      .set({ viewCount: sql`${quotePlatformHeadlines.viewCount} + 1` })
      .where(eq(quotePlatformHeadlines.id, headlineId));
    return res.json({ ok: true });
  } catch (error) {
    console.error('[quote-platform/headlines/track-view]', error);
    return res.status(500).json({ error: 'Failed to track headline view' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/quote-platform/headlines/track-booking
// Increment booking_count on a quote platform headline variant.
// ---------------------------------------------------------------------------
router.post('/api/quote-platform/headlines/track-booking', async (req, res) => {
  try {
    const { headlineId } = req.body;
    if (!headlineId || typeof headlineId !== 'number') {
      return res.status(400).json({ error: 'headlineId (number) required' });
    }
    await db
      .update(quotePlatformHeadlines)
      .set({ bookingCount: sql`${quotePlatformHeadlines.bookingCount} + 1` })
      .where(eq(quotePlatformHeadlines.id, headlineId));
    return res.json({ ok: true });
  } catch (error) {
    console.error('[quote-platform/headlines/track-booking]', error);
    return res.status(500).json({ error: 'Failed to track headline booking' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/pricing/quotes/:id — Edit and save a contextual quote in-place
// ---------------------------------------------------------------------------

router.patch('/api/pricing/quotes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerName,
      phone,
      email,
      address,
      postcode,
      basePrice,           // in pence
      pricingLineItems,    // LineItemResult[]
      batchDiscountPercent,
      availableDates,      // string[] | null — VA-specified booking dates
    } = req.body;

    // Fetch existing quote first so we can patch JSONB fields in JS
    const [existing] = await db.select().from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, id));

    if (!existing) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const updates: Record<string, unknown> = {};
    if (customerName !== undefined) updates.customerName = String(customerName).trim();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (email !== undefined) updates.email = email ? String(email).trim() : null;
    if (address !== undefined) updates.address = address ? String(address).trim() : null;
    if (postcode !== undefined) updates.postcode = postcode ? String(postcode).trim() : null;
    if (basePrice !== undefined) updates.basePrice = Number(basePrice);
    if (pricingLineItems !== undefined) updates.pricingLineItems = pricingLineItems;
    if (batchDiscountPercent !== undefined) updates.batchDiscountPercent = Number(batchDiscountPercent);
    if (availableDates !== undefined) updates.availableDates = availableDates; // null clears it

    // When line items change, recalculate finalPricePence and materials so
    // the customer-facing page (which reads finalPricePence first) shows
    // the updated total instead of the stale original.
    if (pricingLineItems !== undefined) {
      const items = Array.isArray(pricingLineItems) ? pricingLineItems : [];
      const labourTotal = items.reduce((s: number, li: any) => s + (Number(li.guardedPricePence) || 0), 0);
      const materialsTotal = items.reduce((s: number, li: any) => s + (Number(li.materialsWithMarginPence) || 0), 0);
      const finalPrice = labourTotal + materialsTotal;

      updates.basePrice = finalPrice;
      updates.materialsCostWithMarkupPence = materialsTotal;

      // Patch pricingLayerBreakdown in JS (not raw SQL) so Drizzle serializes correctly
      const existingBreakdown = (existing.pricingLayerBreakdown as Record<string, any>) || {};
      updates.pricingLayerBreakdown = {
        ...existingBreakdown,
        finalPricePence: finalPrice,
        subtotalPence: labourTotal,
      };

      console.log(`[quote-patch] Recalculated: labour=${labourTotal} materials=${materialsTotal} final=${finalPrice}`);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const [updated] = await db
      .update(personalizedQuotes)
      .set(updates)
      .where(eq(personalizedQuotes.id, id))
      .returning();

    console.log(`[quote-patch] Updated quote ${id} — fields: ${Object.keys(updates).join(', ')}`);
    return res.json({ ok: true, quote: updated });
  } catch (error) {
    console.error('[quote-patch] Error:', error);
    return res.status(500).json({ error: 'Failed to update quote' });
  }
});

export default router;
