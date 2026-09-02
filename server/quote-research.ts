/**
 * Quote Research — WP2: Lightweight research logic for quote-ready intakes.
 *
 * Runs when a quote becomes ready (readiness='quote_ready'). Researches each
 * job line to populate materials, time estimates, and procedures WITHOUT heavy
 * LLM calls — using catalog lookups, historical data, heuristics, and templates.
 *
 * Ben remains human-in-loop for pricing — this just pre-fills the builder.
 */
import { db } from './db';
import {
  conversations,
  serviceCatalog,
  materialsCatalog,
  diyAdvice,
  contractorBookingRequests,
  quoteResearch,
} from '@shared/schema';
import { eq, ilike, desc, sql, and, or } from 'drizzle-orm';
import type { QuoteResearchResult, JobResearch, MaterialEstimate, TimeEstimate } from '@shared/quote-research-types';
import type { QuoteIntake, IntakeLine } from './agents/quote-prep';
import { CATEGORY_RATE_RANGES, getCategoryLabel } from '@shared/categories';
import type { JobCategory } from '@shared/categories';

// ---------------------------------------------------------------------------
// Job Category Detection — lightweight keyword-based inference
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<JobCategory, string[]> = {
  plumbing_minor: ['tap', 'leak', 'toilet', 'cistern', 'sink', 'drain', 'pipe', 'ballcock', 'stopcock', 'washer', 'trap', 'overflow', 'radiator', 'bleed'],
  electrical_minor: ['socket', 'switch', 'light', 'fitting', 'dimmer', 'spotlight', 'lamp', 'pendant', 'wiring', 'fuse', 'extractor', 'fan'],
  tv_mounting: ['tv', 'television', 'bracket', 'soundbar', 'wall mount', 'screen'],
  flat_pack: ['flat pack', 'flatpack', 'ikea', 'assembly', 'wardrobe', 'bookcase', 'cabinet', 'furniture build'],
  carpentry: ['wood', 'timber', 'shelf', 'skirting', 'architrave', 'dado', 'panel', 'stud wall', 'partition'],
  painting: ['paint', 'emulsion', 'gloss', 'prime', 'wallpaper', 'strip', 'ceiling', 'wall colour', 'redecorate'],
  tiling: ['tile', 'grout', 'splashback', 'backsplash', 'adhesive', 'mosaic'],
  plastering: ['plaster', 'skim', 'artex', 'render', 'bonding', 'finishing'],
  door_fitting: ['door', 'hinge', 'handle', 'lock', 'latch', 'closer', 'frame', 'threshold'],
  lock_change: ['lock', 'key', 'cylinder', 'deadbolt', 'yale', 'mortice'],
  silicone_sealant: ['silicone', 'sealant', 'reseal', 'mastic', 'caulk', 'bath seal', 'shower seal'],
  curtain_blinds: ['curtain', 'blind', 'pole', 'track', 'rail', 'pelmet', 'roman blind', 'roller blind'],
  shelving: ['shelf', 'shelves', 'shelving', 'bracket', 'floating shelf', 'alcove'],
  general_fixing: ['fix', 'repair', 'broken', 'loose', 'stuck', 'adjust'],
  guttering: ['gutter', 'downpipe', 'fascia', 'soffit', 'overflow'],
  pressure_washing: ['pressure wash', 'jet wash', 'patio clean', 'driveway clean', 'decking clean'],
  fencing: ['fence', 'fencing', 'gate', 'post', 'panel', 'trellis'],
  garden_maintenance: ['garden', 'hedge', 'lawn', 'bush', 'shrub', 'tree', 'pruning'],
  bathroom_fitting: ['bathroom', 'vanity', 'basin', 'shower', 'bath', 'towel rail'],
  kitchen_fitting: ['kitchen', 'worktop', 'splashback', 'cabinet', 'plinth', 'kickboard'],
  flooring: ['floor', 'flooring', 'laminate', 'vinyl', 'lino', 'carpet', 'underlay'],
  furniture_repair: ['furniture', 'chair', 'table', 'drawer', 'cupboard', 'hinge'],
  waste_removal: ['waste', 'rubbish', 'skip', 'clearance', 'disposal', 'dump'],
  other: [],
};

/**
 * Infer job category from title and description using keyword matching.
 * Returns 'other' if no clear match.
 */
function inferCategory(title: string, detail: string): JobCategory {
  const text = `${title} ${detail}`.toLowerCase();
  let bestMatch: JobCategory = 'other';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'other') continue;
    const score = keywords.filter((kw) => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = category as JobCategory;
    }
  }

  return bestMatch;
}

// ---------------------------------------------------------------------------
// Time Estimate Heuristics
// ---------------------------------------------------------------------------

/** Default time estimates per category in minutes (conservative). */
const DEFAULT_TIME_MINUTES: Record<JobCategory, number> = {
  plumbing_minor: 45,
  electrical_minor: 40,
  tv_mounting: 30,
  flat_pack: 60,
  carpentry: 60,
  painting: 90,
  tiling: 120,
  plastering: 120,
  door_fitting: 45,
  lock_change: 30,
  silicone_sealant: 30,
  curtain_blinds: 30,
  shelving: 30,
  general_fixing: 30,
  guttering: 60,
  pressure_washing: 60,
  fencing: 120,
  garden_maintenance: 60,
  bathroom_fitting: 180,
  kitchen_fitting: 180,
  flooring: 120,
  furniture_repair: 30,
  waste_removal: 30,
  other: 45,
};

/**
 * Look up historical time estimates from similar completed jobs.
 */
async function getHistoricalTimes(category: JobCategory, keywords: string[]): Promise<{
  minutes: number;
  samples: { description: string; minutes: number }[];
  confidence: 'high' | 'medium' | 'low';
} | null> {
  try {
    const keywordPatterns = keywords.slice(0, 3).map((k) => `%${k.toLowerCase()}%`);

    // Query completed jobs with recorded time
    const likeConditions = keywordPatterns.map((pattern) =>
      sql`LOWER(${contractorBookingRequests.description}) LIKE ${pattern}`
    );

    const jobs = await db
      .select({
        description: contractorBookingRequests.description,
        timeSeconds: contractorBookingRequests.timeOnJobSeconds,
      })
      .from(contractorBookingRequests)
      .where(
        and(
          sql`${contractorBookingRequests.timeOnJobSeconds} IS NOT NULL`,
          sql`${contractorBookingRequests.timeOnJobSeconds} > 0`,
          likeConditions.length > 0 ? or(...likeConditions) : sql`1=1`
        )
      )
      .orderBy(desc(contractorBookingRequests.completedAt))
      .limit(10);

    if (jobs.length === 0) return null;

    const samples = jobs.map((j) => ({
      description: (j.description ?? '').slice(0, 60),
      minutes: Math.round((j.timeSeconds ?? 0) / 60),
    })).filter((s) => s.minutes > 0);

    if (samples.length === 0) return null;

    const avgMinutes = Math.round(
      samples.reduce((sum, s) => sum + s.minutes, 0) / samples.length
    );

    const confidence: 'high' | 'medium' | 'low' =
      samples.length >= 5 ? 'high' : samples.length >= 2 ? 'medium' : 'low';

    return { minutes: avgMinutes, samples: samples.slice(0, 3), confidence };
  } catch (err) {
    console.warn('[QuoteResearch] Historical time query failed:', err);
    return null;
  }
}

/**
 * Build a time estimate for a job line.
 */
async function estimateTime(
  title: string,
  _detail: string,
  category: JobCategory
): Promise<TimeEstimate> {
  const keywords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  // Try historical data first
  const historical = await getHistoricalTimes(category, keywords);
  if (historical) {
    return {
      minutes: historical.minutes,
      confidence: historical.confidence,
      reasoning: `Based on ${historical.samples.length} similar ${getCategoryLabel(category)} jobs`,
      similarJobs: historical.samples,
    };
  }

  // Try SKU catalog for fixed-time products
  try {
    const skuMatch = await db
      .select({
        scheduleMinutes: serviceCatalog.scheduleMinutes,
        name: serviceCatalog.name,
      })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.isActive, true),
          eq(serviceCatalog.category, category),
          ilike(serviceCatalog.name, `%${keywords[0] ?? ''}%`)
        )
      )
      .limit(1);

    if (skuMatch.length > 0 && skuMatch[0].scheduleMinutes) {
      return {
        minutes: skuMatch[0].scheduleMinutes,
        confidence: 'high',
        reasoning: `From SKU "${skuMatch[0].name}" schedule time`,
      };
    }
  } catch (err) {
    console.warn('[QuoteResearch] SKU time lookup failed:', err);
  }

  // Fall back to category default
  const defaultMinutes = DEFAULT_TIME_MINUTES[category];
  return {
    minutes: defaultMinutes,
    confidence: 'low',
    reasoning: `Default estimate for ${getCategoryLabel(category)}`,
  };
}

// ---------------------------------------------------------------------------
// Materials Lookup
// ---------------------------------------------------------------------------

/** Common materials by category — template-based fallback. */
const COMMON_MATERIALS: Partial<Record<JobCategory, { name: string; qty: number; unit: string; estimatedPence: number }[]>> = {
  plumbing_minor: [
    { name: 'Compression fittings pack', qty: 1, unit: 'pack', estimatedPence: 800 },
    { name: 'PTFE tape', qty: 1, unit: 'roll', estimatedPence: 150 },
  ],
  silicone_sealant: [
    { name: 'Silicone sealant (white)', qty: 1, unit: 'tube', estimatedPence: 600 },
  ],
  tv_mounting: [
    { name: 'Wall plugs & screws', qty: 1, unit: 'pack', estimatedPence: 300 },
  ],
  electrical_minor: [
    { name: 'Terminal block', qty: 1, unit: 'each', estimatedPence: 200 },
  ],
  shelving: [
    { name: 'Heavy-duty brackets', qty: 2, unit: 'each', estimatedPence: 400 },
    { name: 'Wall plugs & screws', qty: 1, unit: 'pack', estimatedPence: 300 },
  ],
  door_fitting: [
    { name: 'Hinge pack 3"', qty: 1, unit: 'pack', estimatedPence: 800 },
  ],
};

/**
 * Search for materials matching the job description.
 */
async function findMaterials(
  title: string,
  _detail: string,
  category: JobCategory
): Promise<MaterialEstimate[]> {
  const materials: MaterialEstimate[] = [];
  const keywords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  // Try materials catalog first
  try {
    for (const keyword of keywords.slice(0, 2)) {
      const catalogResults = await db
        .select()
        .from(materialsCatalog)
        .where(ilike(materialsCatalog.name, `%${keyword}%`))
        .orderBy(desc(materialsCatalog.usageCount))
        .limit(2);

      for (const row of catalogResults) {
        // Avoid duplicates
        if (materials.some((m) => m.name === row.name)) continue;

        materials.push({
          name: row.name,
          quantity: 1,
          unit: 'each',
          unitPrice: row.pricePenceExVat ?? 0,
          source: 'catalog',
          confidence: row.pricePenceExVat ? 'high' : 'low',
        });
      }
    }
  } catch (err) {
    console.warn('[QuoteResearch] Catalog lookup failed:', err);
  }

  // If no catalog results, use category templates
  if (materials.length === 0) {
    const templates = COMMON_MATERIALS[category];
    if (templates) {
      for (const t of templates) {
        materials.push({
          name: t.name,
          quantity: t.qty,
          unit: t.unit,
          unitPrice: t.estimatedPence,
          source: 'estimated',
          confidence: 'low',
        });
      }
    }
  }

  return materials;
}

// ---------------------------------------------------------------------------
// Procedure Generation
// ---------------------------------------------------------------------------

/** Template procedures by category. */
const PROCEDURE_TEMPLATES: Partial<Record<JobCategory, string[]>> = {
  plumbing_minor: [
    'Isolate water supply at nearest stopcock',
    'Drain down the affected pipework',
    'Disassemble the faulty fitting/component',
    'Fit replacement parts with fresh seals',
    'Restore water supply and test for leaks',
  ],
  silicone_sealant: [
    'Remove old silicone with scraper and solvent',
    'Clean and dry the joint surfaces',
    'Mask edges with tape for clean lines',
    'Apply new silicone in continuous bead',
    'Tool the joint and remove tape immediately',
    'Allow 24h cure before water contact',
  ],
  electrical_minor: [
    'Isolate circuit at consumer unit',
    'Test circuit dead with voltage tester',
    'Remove old fitting carefully',
    'Connect new fitting matching wire colours',
    'Restore power and test function',
  ],
  tv_mounting: [
    'Locate wall studs/use appropriate fixings',
    'Mark bracket position using spirit level',
    'Drill holes and insert wall plugs',
    'Secure bracket to wall',
    'Attach TV to bracket arms',
    'Route cables neatly and test',
  ],
  shelving: [
    'Mark shelf position using spirit level',
    'Locate studs or plan for hollow wall fixings',
    'Drill holes and fit brackets',
    'Secure shelf to brackets',
    'Check level and adjust if needed',
  ],
  door_fitting: [
    'Remove existing door if applicable',
    'Mark hinge positions on frame and door',
    'Chisel hinge recesses if needed',
    'Fit hinges and hang door',
    'Adjust for smooth operation',
    'Fit handle/latch and check operation',
  ],
  painting: [
    'Prepare surfaces: fill holes, sand, clean',
    'Mask edges and protect flooring',
    'Apply primer coat if bare substrate',
    'Apply first coat, allow to dry',
    'Light sand and apply second coat',
    'Remove masking and touch up edges',
  ],
  general_fixing: [
    'Inspect the item to identify fault',
    'Source appropriate fixings/parts',
    'Repair or reinforce as needed',
    'Test function and stability',
    'Clean up work area',
  ],
};

/**
 * Generate procedure steps for a job.
 */
async function getProcedure(
  title: string,
  _detail: string,
  category: JobCategory
): Promise<string[]> {
  const keywords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  // Try DIY advice database first
  try {
    const keywordPatterns = keywords.slice(0, 2).map((k) => `%${k.toLowerCase()}%`);
    const likeConditions = keywordPatterns.map((pattern) =>
      sql`EXISTS (SELECT 1 FROM unnest(${diyAdvice.keywords}) AS kw WHERE LOWER(kw) LIKE ${pattern})`
    );

    const advice = await db
      .select({ steps: diyAdvice.steps })
      .from(diyAdvice)
      .where(
        and(
          eq(diyAdvice.isActive, true),
          likeConditions.length > 0 ? or(...likeConditions) : sql`1=1`
        )
      )
      .orderBy(desc(diyAdvice.priority))
      .limit(1);

    if (advice.length > 0 && advice[0].steps) {
      const steps = advice[0].steps as string[];
      if (steps.length > 0) {
        return steps.slice(0, 6);
      }
    }
  } catch (err) {
    console.warn('[QuoteResearch] DIY advice lookup failed:', err);
  }

  // Fall back to category template
  return PROCEDURE_TEMPLATES[category] ?? PROCEDURE_TEMPLATES.general_fixing ?? [];
}

// ---------------------------------------------------------------------------
// Main Research Function
// ---------------------------------------------------------------------------

/**
 * Run lightweight research on a quote-ready intake.
 *
 * @param conversationId - The conversation ID to load intake from
 * @returns Structured research result for the quote builder
 */
export async function runQuoteResearch(conversationId: string): Promise<QuoteResearchResult> {
  // Load conversation and intake
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  if (!conv) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // P8: ONE intake source (server/intake.ts) — the spine clerk's artifact, the legacy blob only
  // as a fallback for pre-spine threads. This research is the estimator's EXPLICIT fallback now
  // (no history, no catalogue match); nothing queues it automatically any more.
  const { getIntake, toQuoteIntake } = await import('./intake');
  const record = await getIntake(conversationId);
  const intake: QuoteIntake | undefined = record ? toQuoteIntake(record, conv.phoneNumber) : undefined;

  if (!intake || !intake.lines || intake.lines.length === 0) {
    throw new Error(
      `Conversation ${conversationId} has no quote intake. Run the clerk first.`
    );
  }

  // Research all job lines IN PARALLEL for speed
  const jobs: JobResearch[] = await Promise.all(
    intake.lines.map(async (line) => {
      const category = inferCategory(line.title, line.detail);
      const [timeEstimate, materials, procedure] = await Promise.all([
        estimateTime(line.title, line.detail, category),
        findMaterials(line.title, line.detail, category),
        getProcedure(line.title, line.detail, category),
      ]);

      // Calculate line confidence based on data quality
      let lineConfidence = 50; // Base
      if (timeEstimate.confidence === 'high') lineConfidence += 20;
      else if (timeEstimate.confidence === 'medium') lineConfidence += 10;
      if (materials.some((m) => m.source === 'catalog')) lineConfidence += 15;
      if (procedure.length >= 4) lineConfidence += 15;
      lineConfidence = Math.min(100, lineConfidence);

      // Build reasoning
      const reasons: string[] = [];
      reasons.push(`Category: ${getCategoryLabel(category)}`);
      reasons.push(`Time: ${timeEstimate.reasoning}`);
      if (materials.length > 0) {
        const catalogCount = materials.filter((m) => m.source === 'catalog').length;
        reasons.push(`Materials: ${materials.length} items (${catalogCount} from catalog)`);
      }
      if (procedure.length > 0) {
        reasons.push(`Procedure: ${procedure.length} steps`);
      }

      return {
        title: line.title,
        description: line.detail,
        materials,
        timeEstimate,
        procedure,
        confidence: lineConfidence,
        reasoning: reasons.join('. '),
      };
    })
  );

  const totalConfidence = jobs.reduce((sum, j) => sum + j.confidence, 0);
  const overallConfidence = Math.round(totalConfidence / jobs.length);

  return { jobs, overallConfidence };
}

// ---------------------------------------------------------------------------
// Database-backed Research Worker
// ---------------------------------------------------------------------------

import type { QuoteResearch as QuoteResearchDbRow } from '@shared/schema';

/**
 * Queue a conversation for research by inserting a pending row.
 */
export async function queueResearch(conversationId: string): Promise<number> {
  const [row] = await db
    .insert(quoteResearch)
    .values({ conversationId, status: 'pending' })
    .returning({ id: quoteResearch.id });
  return row.id;
}

/**
 * Get research status by ID.
 */
export async function getResearchStatus(id: number): Promise<QuoteResearchDbRow | null> {
  const [row] = await db
    .select()
    .from(quoteResearch)
    .where(eq(quoteResearch.id, id));
  return row ?? null;
}

/**
 * Get research by conversation ID.
 */
export async function getResearchByConversation(conversationId: string): Promise<QuoteResearchDbRow | null> {
  const [row] = await db
    .select()
    .from(quoteResearch)
    .where(eq(quoteResearch.conversationId, conversationId))
    .orderBy(desc(quoteResearch.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Process a single research job by ID.
 */
export async function processResearchJob(id: number): Promise<QuoteResearchDbRow> {
  const [job] = await db
    .select()
    .from(quoteResearch)
    .where(eq(quoteResearch.id, id));

  if (!job) {
    throw new Error(`Research job ${id} not found`);
  }

  // Mark as running
  await db
    .update(quoteResearch)
    .set({ status: 'running' })
    .where(eq(quoteResearch.id, id));

  try {
    const result = await runQuoteResearch(job.conversationId);

    // Update with results
    const [updated] = await db
      .update(quoteResearch)
      .set({
        status: 'completed',
        jobs: result.jobs,
        research: result,
        confidence: result.overallConfidence / 100, // Store as 0-1
        completedAt: new Date(),
      })
      .where(eq(quoteResearch.id, id))
      .returning();

    // P8: research no longer flips a readiness or writes metadata.quotePrepIntake (never written
    // again). Readiness is derived by server/intake.ts from the clerk's artifact and pane A's
    // estimate state; this row is only the estimator's labelled fallback.
    console.log(`[QuoteResearch] Job ${id} complete for ${job.conversationId} (fallback research; no readiness change)`);

    return updated;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[QuoteResearch] Job ${id} failed:`, errorMessage);

    const [updated] = await db
      .update(quoteResearch)
      .set({
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      })
      .where(eq(quoteResearch.id, id))
      .returning();

    return updated;
  }
}

/**
 * Process all pending research jobs.
 * Call this from a cron job or background worker.
 */
export async function processPendingResearch(): Promise<number> {
  const pending = await db
    .select()
    .from(quoteResearch)
    .where(eq(quoteResearch.status, 'pending'))
    .orderBy(quoteResearch.createdAt)
    .limit(10); // Process in batches

  let processed = 0;
  for (const job of pending) {
    try {
      await processResearchJob(job.id);
      processed++;
    } catch (err) {
      console.error(`[QuoteResearch] Failed to process job ${job.id}:`, err);
    }
  }

  return processed;
}

/**
 * Run research immediately for a conversation (synchronous API path).
 * Queues the job and processes it inline.
 */
export async function runResearchImmediate(conversationId: string): Promise<{
  id: number;
  result: QuoteResearchResult;
}> {
  const id = await queueResearch(conversationId);
  const job = await processResearchJob(id);

  if (job.status === 'failed') {
    throw new Error(job.error ?? 'Research failed');
  }

  const result = job.research as QuoteResearchResult;
  return { id, result };
}
