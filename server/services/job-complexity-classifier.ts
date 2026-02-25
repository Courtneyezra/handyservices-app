/**
 * Job Complexity Classifier Service
 *
 * Provides tiered classification of job complexity for traffic light routing:
 * - Tier 1: Instant keyword matching (<50ms) - GREEN/AMBER/RED
 * - Tier 2: LLM-based classification (<400ms) - Complexity score, specialist needs, video vs visit
 *
 * Traffic Light System:
 * - GREEN: SKU matched, instant quote available
 * - AMBER: Needs video confirmation (can likely quote after seeing)
 * - RED: Specialist/complex work, needs site visit or referral
 *
 * Keywords are loaded from database settings and cached for performance.
 *
 * Owner: Job Classification System
 */

import OpenAI from 'openai';
import { getTrafficLightKeywords } from '../settings';

// Initialize OpenAI client lazily
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

// ============================================
// TYPES & INTERFACES
// ============================================

export type TrafficLight = 'green' | 'amber' | 'red';

export interface JobComplexityResult {
  trafficLight: TrafficLight;
  confidence: number; // 0-100
  signals: string[];
  tier: 1 | 2;
  /** For Tier 2: recommended route */
  recommendedRoute?: 'instant' | 'video' | 'visit' | 'refer';
  /** For Tier 2: complexity score 1-10 */
  complexityScore?: number;
  /** For Tier 2: does this need a specialist? */
  needsSpecialist?: boolean;
  /** For Tier 2: why this classification */
  reasoning?: string;
}

export interface JobComplexityOutput {
  result: JobComplexityResult;
  processingTimeMs: number;
}

export interface DetectedJobInput {
  id: string;
  description: string;
  matched: boolean;
  skuId?: string;
  skuName?: string;
  pricePence?: number;
}

// ============================================
// TIER 1: Keyword Patterns (Instant, <50ms)
// ============================================

/**
 * Default RED keywords: Specialist/complex work that likely needs referral or site visit
 * These are used as fallback if database settings aren't loaded yet.
 * Actual keywords are loaded from database settings for runtime configurability.
 */
const DEFAULT_RED_KEYWORDS = [
  // Gas work (must be Gas Safe registered)
  'gas', 'boiler', 'gas boiler', 'gas cooker', 'gas pipe', 'gas hob',
  'combi boiler', 'central heating',
  // Electrical (beyond minor works)
  'rewire', 'consumer unit', 'fuse box', 'electrical panel', 'new circuit',
  'sockets stopped', 'sockets not working', 'half the sockets', 'electrics',
  'flickering', 'tripping', 'add sockets', 'more sockets', 'lights flickering',
  // Structural
  'structural', 'load bearing', 'foundation', 'subsidence', 'underpinning',
  'chimney removal', 'wall removal', 'rsj', 'steel beam',
  'big crack', 'large crack', 'crack getting wider', 'bowing', 'bulging',
  'floors sloping', 'floor sloping', 'walls leaning', 'wonky', 'sloping',
  // Hazardous materials
  'asbestos', 'lead paint',
  // Major building works
  'extension', 'loft conversion', 'basement conversion', 'new build',
  // Roofing (specialist trade)
  'roof', 'tiles off', 'roof leak', 'chimney stack', 'guttering repair',
  'slates', 'roof repair',
  // Damp/specialist diagnosis (serious indicators)
  'rising damp', 'penetrating damp', 'severe damp', 'damp survey',
  'mould survey', 'mold survey', 'walls wet', 'wet to the touch',
  'damp coming up', 'musty smell', 'damp throughout',
];

/**
 * Default AMBER keywords: Jobs that need video/visual confirmation
 */
const DEFAULT_AMBER_KEYWORDS = [
  // Leak-related (could be minor or major)
  'leak', 'leaking', 'water damage', 'flooding',
  // Damp (minor, needs visual assessment)
  'damp patch', 'damp spot', 'condensation', 'mould', 'mold',
  // Damage assessment needed
  'damage', 'broken', 'cracked', 'split',
  // Custom/bespoke work
  'custom', 'bespoke', 'made to measure', 'unusual',
  // Multiple jobs
  'few things', 'several jobs', 'list of jobs', 'multiple',
  // Vague descriptions
  'not sure', 'don\'t know', 'hard to describe', 'difficult to explain',
];

/**
 * Borderline keywords that need Tier 2 LLM confirmation
 * These could go either way depending on context
 */
const BORDERLINE_KEYWORDS = [
  'damp', 'leak', 'crack', 'rot', 'damage',
  'old', 'original', 'historic', 'period property',
];

// Cached keywords loaded from settings
let cachedRedKeywords: string[] = DEFAULT_RED_KEYWORDS;
let cachedAmberKeywords: string[] = DEFAULT_AMBER_KEYWORDS;
let keywordsCacheTime = 0;
const KEYWORDS_CACHE_TTL = 60000; // 1 minute cache

// Track initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Load keywords from settings (async, with caching)
 * Call this periodically or when settings change
 */
export async function refreshKeywordsFromSettings(): Promise<void> {
  try {
    const keywords = await getTrafficLightKeywords();
    cachedRedKeywords = keywords.redKeywords;
    cachedAmberKeywords = keywords.amberKeywords;
    keywordsCacheTime = Date.now();
    isInitialized = true;
    console.log(`[JobComplexity] Loaded keywords from settings: ${cachedRedKeywords.length} RED, ${cachedAmberKeywords.length} AMBER keywords`);
  } catch (error) {
    console.error('[JobComplexity] Failed to load keywords from settings, using defaults:', error);
    // Still mark as initialized - we'll use defaults
    isInitialized = true;
  }
}

/**
 * Initialize the classifier by loading keywords from settings.
 * Call this on server startup. Safe to call multiple times.
 */
export async function initializeClassifier(): Promise<void> {
  if (isInitialized) {
    return;
  }

  // Prevent multiple concurrent initializations
  if (initializationPromise) {
    return initializationPromise;
  }

  console.log('[JobComplexity] Initializing classifier - loading keywords from database...');
  initializationPromise = refreshKeywordsFromSettings();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

/**
 * Ensure the classifier is initialized before use.
 * This is called internally before classifications.
 */
async function ensureInitialized(): Promise<void> {
  if (!isInitialized) {
    await initializeClassifier();
  }
}

/**
 * Get current RED keywords (from cache or defaults)
 * Triggers background refresh if cache is stale.
 */
export function getRedKeywords(): string[] {
  // Trigger async refresh if cache is stale (non-blocking)
  if (Date.now() - keywordsCacheTime > KEYWORDS_CACHE_TTL) {
    console.log('[JobComplexity] Cache stale, triggering background refresh...');
    refreshKeywordsFromSettings().catch(() => {});
  }
  return cachedRedKeywords;
}

/**
 * Get current AMBER keywords (from cache or defaults)
 */
export function getAmberKeywords(): string[] {
  // Also refresh AMBER keywords when cache is stale
  if (Date.now() - keywordsCacheTime > KEYWORDS_CACHE_TTL) {
    refreshKeywordsFromSettings().catch(() => {});
  }
  return cachedAmberKeywords;
}

// For backwards compatibility, export the cached arrays
export { cachedRedKeywords as RED_KEYWORDS, cachedAmberKeywords as AMBER_KEYWORDS };

/**
 * Fast keyword matching for traffic light classification
 * GREEN: SKU matched (handled externally)
 * RED: Contains red keywords
 * AMBER: Contains amber keywords or unmatched
 *
 * NOTE: This is a synchronous function for real-time performance.
 * Call initializeClassifier() at startup to ensure keywords are loaded.
 */
export function tier1KeywordMatch(
  description: string,
  isSkuMatched: boolean
): JobComplexityResult {
  const startTime = performance.now();

  // Warn if not initialized (keywords may be defaults)
  if (!isInitialized) {
    console.warn('[JobComplexity:Tier1] WARNING: Classifier not initialized, using default keywords. Call initializeClassifier() at startup.');
  }

  // GREEN: Already matched to SKU
  if (isSkuMatched) {
    const elapsed = performance.now() - startTime;
    console.log(`[JobComplexity:Tier1] GREEN (SKU match) in ${elapsed.toFixed(1)}ms`);
    return {
      trafficLight: 'green',
      confidence: 95,
      signals: ['SKU matched'],
      tier: 1,
      recommendedRoute: 'instant',
      complexityScore: 2,
      needsSpecialist: false,
    };
  }

  const lowerDesc = description.toLowerCase();
  const matchedSignals: string[] = [];

  // Get current keywords (from settings cache)
  const redKeywords = getRedKeywords();
  const amberKeywords = getAmberKeywords();

  // Check for RED keywords first (highest priority)
  for (const keyword of redKeywords) {
    if (lowerDesc.includes(keyword.toLowerCase())) {
      matchedSignals.push(`RED: "${keyword}"`);
    }
  }

  if (matchedSignals.length > 0) {
    const elapsed = performance.now() - startTime;
    console.log(`[JobComplexity:Tier1] RED (${matchedSignals.join(', ')}) in ${elapsed.toFixed(1)}ms`);
    return {
      trafficLight: 'red',
      confidence: Math.min(70 + matchedSignals.length * 10, 95),
      signals: matchedSignals,
      tier: 1,
      recommendedRoute: 'refer',
      complexityScore: 9,
      needsSpecialist: true,
    };
  }

  // Check for AMBER keywords
  for (const keyword of amberKeywords) {
    if (lowerDesc.includes(keyword.toLowerCase())) {
      matchedSignals.push(`AMBER: "${keyword}"`);
    }
  }

  // Default to AMBER for unmatched jobs
  const elapsed = performance.now() - startTime;
  console.log(`[JobComplexity:Tier1] AMBER (${matchedSignals.length > 0 ? matchedSignals.join(', ') : 'no SKU match'}) in ${elapsed.toFixed(1)}ms`);

  return {
    trafficLight: 'amber',
    confidence: matchedSignals.length > 0 ? 60 : 40,
    signals: matchedSignals.length > 0 ? matchedSignals : ['No SKU match'],
    tier: 1,
    recommendedRoute: 'video',
    complexityScore: 5,
    needsSpecialist: false,
  };
}

/**
 * Check if a job should trigger Tier 2 LLM classification
 * Returns true if:
 * - Job is unmatched (needs proper classification)
 * - Contains borderline keywords that could go either way
 * - Tier 1 confidence is below threshold
 */
export function shouldTriggerTier2(
  description: string,
  tier1Result: JobComplexityResult
): boolean {
  // Always classify unmatched jobs with LLM for accuracy
  if (tier1Result.trafficLight !== 'green') {
    return true;
  }

  // Check for borderline keywords even in matched jobs
  const lowerDesc = description.toLowerCase();
  const hasBorderline = BORDERLINE_KEYWORDS.some(kw =>
    lowerDesc.includes(kw.toLowerCase())
  );

  if (hasBorderline) {
    return true;
  }

  // Low confidence results
  if (tier1Result.confidence < 70) {
    return true;
  }

  return false;
}

// ============================================
// TIER 2: LLM Classification (Fast, <400ms)
// ============================================

const COMPLEXITY_PROMPT = `You are classifying a handyman job for routing. Analyze the job description and determine:

1. TRAFFIC LIGHT:
   - GREEN: Simple job, can quote instantly with standard pricing
   - AMBER: Needs video/photos to assess properly, likely quotable after seeing
   - RED: Complex/specialist work, needs site visit or specialist referral

2. RECOMMENDED ROUTE:
   - instant: Can give price now (green jobs)
   - video: Send video for assessment (amber jobs)
   - visit: Book diagnostic visit (complex amber/red jobs)
   - refer: Refer to specialist (red jobs requiring licensed trades)

3. COMPLEXITY SCORE (1-10):
   - 1-3: Simple, routine handyman tasks
   - 4-6: Moderate, may need assessment
   - 7-8: Complex, multi-step or technical
   - 9-10: Specialist trade required

4. SPECIALIST NEEDED:
   - true: Requires licensed contractor (gas, electrical, structural)
   - false: Within general handyman scope

RED FLAGS (always RED):
- Gas work (boilers, pipes, cookers)
- Full rewiring or new circuits
- Structural changes (load bearing walls, foundations)
- Asbestos or hazardous materials
- Major building works (extensions, conversions)

AMBER FLAGS (needs visual confirmation):
- Leak/water damage (could be minor tap or major pipe burst)
- Damp (could be condensation or structural issue)
- Unspecified damage or "not sure what's wrong"
- Multiple vague jobs

Return JSON:
{
  "trafficLight": "green" | "amber" | "red",
  "recommendedRoute": "instant" | "video" | "visit" | "refer",
  "complexityScore": 1-10,
  "needsSpecialist": boolean,
  "confidence": 0-100,
  "signals": ["signal1", "signal2"],
  "reasoning": "brief explanation"
}

JOB DESCRIPTION:
`;

interface Tier2LLMResponse {
  trafficLight: TrafficLight;
  recommendedRoute: 'instant' | 'video' | 'visit' | 'refer';
  complexityScore: number;
  needsSpecialist: boolean;
  confidence: number;
  signals: string[];
  reasoning: string;
}

// ============================================
// SAFETY: Timeout wrapper for LLM calls
// ============================================

/** Timeout for Tier 2 LLM calls (5 seconds) - prevents hanging on slow OpenAI responses */
const TIER2_LLM_TIMEOUT_MS = 5000;

/**
 * Wraps a promise with a timeout to prevent indefinite hanging
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param timeoutMessage - Error message if timeout occurs
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * LLM-based job complexity classification
 * Provides detailed analysis beyond keyword matching
 *
 * SAFETY: Includes a 5 second timeout to prevent hanging on slow OpenAI responses.
 * Returns null if timeout is exceeded, allowing fallback to Tier 1 classification.
 */
export async function tier2LLMClassify(
  description: string,
  context?: {
    hasSkuMatch?: boolean;
    skuName?: string;
    otherJobs?: string[];
  }
): Promise<JobComplexityResult | null> {
  const startTime = performance.now();

  try {
    const openai = getOpenAI();

    // Build context string
    let contextStr = description;
    if (context?.hasSkuMatch && context?.skuName) {
      contextStr += `\n\n[Note: This job matched to SKU "${context.skuName}" but needs complexity verification]`;
    }
    if (context?.otherJobs && context.otherJobs.length > 0) {
      contextStr += `\n\n[Other jobs in this call: ${context.otherJobs.join(', ')}]`;
    }

    // SAFETY: Wrap OpenAI call with timeout to prevent indefinite hanging
    const response = await withTimeout(
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: COMPLEXITY_PROMPT },
          { role: 'user', content: contextStr },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.1,
      }),
      TIER2_LLM_TIMEOUT_MS,
      `Tier 2 LLM call timed out after ${TIER2_LLM_TIMEOUT_MS}ms`
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn('[JobComplexity:Tier2] No content in LLM response');
      return null;
    }

    const parsed = JSON.parse(content) as Tier2LLMResponse;

    // Validate traffic light value
    if (!['green', 'amber', 'red'].includes(parsed.trafficLight)) {
      console.warn(`[JobComplexity:Tier2] Invalid trafficLight: ${parsed.trafficLight}`);
      return null;
    }

    const elapsed = performance.now() - startTime;
    console.log(
      `[JobComplexity:Tier2] ${parsed.trafficLight.toUpperCase()} (${parsed.recommendedRoute}, complexity ${parsed.complexityScore}) in ${elapsed.toFixed(1)}ms`
    );

    return {
      trafficLight: parsed.trafficLight,
      confidence: parsed.confidence,
      signals: parsed.signals || [],
      tier: 2,
      recommendedRoute: parsed.recommendedRoute,
      complexityScore: parsed.complexityScore,
      needsSpecialist: parsed.needsSpecialist,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    const elapsed = performance.now() - startTime;
    // Check if it was a timeout error
    if (error instanceof Error && error.message.includes('timed out')) {
      console.warn(`[JobComplexity:Tier2] TIMEOUT after ${elapsed.toFixed(1)}ms - skipping Tier 2 classification`);
    } else {
      console.error(`[JobComplexity:Tier2] Error after ${elapsed.toFixed(1)}ms:`, error);
    }
    return null;
  }
}

// ============================================
// COMBINED CLASSIFIER
// ============================================

export interface ClassifyJobOptions {
  /** Use Tier 2 LLM for unmatched/borderline jobs (default: true) */
  useTier2?: boolean;
  /** Context about other jobs in the call */
  otherJobDescriptions?: string[];
}

/**
 * Main job complexity classification function
 *
 * Strategy:
 * 1. Ensure keywords are loaded from database settings
 * 2. Always run Tier 1 first (instant, <50ms)
 * 3. If job is GREEN (SKU matched), return immediately
 * 4. For AMBER/RED, optionally run Tier 2 for better accuracy
 */
export async function classifyJobComplexity(
  description: string,
  isSkuMatched: boolean,
  options: ClassifyJobOptions = {}
): Promise<JobComplexityOutput> {
  const startTime = performance.now();
  const { useTier2 = true, otherJobDescriptions } = options;

  // Ensure keywords are loaded from database before classification
  await ensureInitialized();

  // Tier 1: Fast keyword matching
  const tier1Result = tier1KeywordMatch(description, isSkuMatched);

  // GREEN jobs: return immediately (no need for Tier 2)
  if (tier1Result.trafficLight === 'green') {
    return {
      result: tier1Result,
      processingTimeMs: performance.now() - startTime,
    };
  }

  // Check if Tier 2 is needed
  if (useTier2 && shouldTriggerTier2(description, tier1Result)) {
    const tier2Result = await tier2LLMClassify(description, {
      hasSkuMatch: isSkuMatched,
      otherJobs: otherJobDescriptions,
    });

    if (tier2Result) {
      return {
        result: tier2Result,
        processingTimeMs: performance.now() - startTime,
      };
    }
  }

  // Fallback to Tier 1 result
  return {
    result: tier1Result,
    processingTimeMs: performance.now() - startTime,
  };
}

/**
 * Synchronous classification using only Tier 1 (for real-time streaming)
 * Use this for instant feedback during live calls
 */
export function classifyJobComplexitySync(
  description: string,
  isSkuMatched: boolean
): JobComplexityOutput {
  const startTime = performance.now();
  const result = tier1KeywordMatch(description, isSkuMatched);

  return {
    result,
    processingTimeMs: performance.now() - startTime,
  };
}

// ============================================
// BATCH CLASSIFIER (for multiple jobs)
// ============================================

/**
 * Classify multiple jobs in a call with full context
 * Runs Tier 1 for all jobs, then Tier 2 for those needing it
 */
export async function classifyMultipleJobs(
  jobs: DetectedJobInput[],
  options: ClassifyJobOptions = {}
): Promise<Map<string, JobComplexityResult>> {
  const results = new Map<string, JobComplexityResult>();
  const jobDescriptions = jobs.map(j => j.description);

  // Ensure keywords are loaded from database before classification
  await ensureInitialized();

  // First pass: Tier 1 for all jobs
  for (const job of jobs) {
    const { result } = classifyJobComplexitySync(job.description, job.matched);
    results.set(job.id, result);
  }

  // Second pass: Tier 2 for jobs that need it
  if (options.useTier2 !== false) {
    const tier2Promises: Promise<void>[] = [];

    for (const job of jobs) {
      const tier1Result = results.get(job.id)!;

      if (shouldTriggerTier2(job.description, tier1Result)) {
        const otherJobs = jobDescriptions.filter(d => d !== job.description);

        tier2Promises.push(
          tier2LLMClassify(job.description, {
            hasSkuMatch: job.matched,
            skuName: job.skuName,
            otherJobs,
          }).then(tier2Result => {
            if (tier2Result) {
              results.set(job.id, tier2Result);
            }
          })
        );
      }
    }

    // Run Tier 2 classifications in parallel
    await Promise.all(tier2Promises);
  }

  return results;
}

// ============================================
// ROUTE RECOMMENDATION
// ============================================

export interface RouteRecommendation {
  route: 'instant' | 'video' | 'visit' | 'refer';
  color: string;
  reason: string;
  confidence: number;
}

/**
 * Get overall route recommendation based on all jobs
 * Takes the "worst" (most complex) job as the determining factor
 */
export function getOverallRouteRecommendation(
  results: Map<string, JobComplexityResult>
): RouteRecommendation {
  if (results.size === 0) {
    return {
      route: 'video',
      color: '#EAB308',
      reason: 'No jobs detected yet',
      confidence: 0,
    };
  }

  const allResults = Array.from(results.values());

  // Check for any RED jobs first (always escalate)
  const redJobs = allResults.filter(r => r.trafficLight === 'red');
  if (redJobs.length > 0) {
    const needsReferral = redJobs.some(r => r.needsSpecialist);
    return {
      route: needsReferral ? 'refer' : 'visit',
      color: '#EF4444',
      reason: `${redJobs.length} job${redJobs.length > 1 ? 's' : ''} ${needsReferral ? 'need specialist referral' : 'need site visit'}`,
      confidence: Math.max(...redJobs.map(r => r.confidence)),
    };
  }

  // Check for AMBER jobs (needs video)
  const amberJobs = allResults.filter(r => r.trafficLight === 'amber');
  if (amberJobs.length > 0) {
    // If multiple unmatched jobs, might be better to visit
    if (amberJobs.length >= 3) {
      return {
        route: 'visit',
        color: '#3B82F6',
        reason: `${amberJobs.length} jobs need assessment - visit recommended`,
        confidence: Math.max(...amberJobs.map(r => r.confidence)),
      };
    }
    return {
      route: 'video',
      color: '#EAB308',
      reason: `${amberJobs.length} job${amberJobs.length > 1 ? 's' : ''} need visual confirmation`,
      confidence: Math.max(...amberJobs.map(r => r.confidence)),
    };
  }

  // All GREEN - instant quote
  return {
    route: 'instant',
    color: '#22C55E',
    reason: 'All jobs have SKU matches - instant quote available',
    confidence: Math.max(...allResults.map(r => r.confidence)),
  };
}

export default {
  initializeClassifier,
  refreshKeywordsFromSettings,
  tier1KeywordMatch,
  tier2LLMClassify,
  classifyJobComplexity,
  classifyJobComplexitySync,
  classifyMultipleJobs,
  shouldTriggerTier2,
  getOverallRouteRecommendation,
  getRedKeywords,
  getAmberKeywords,
};
