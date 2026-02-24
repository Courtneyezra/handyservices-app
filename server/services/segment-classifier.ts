/**
 * Segment Classifier Service for Call Script Tube Map
 *
 * Provides tiered classification of customer segments from call transcripts:
 * - Tier 1: Instant pattern matching (<50ms)
 * - Tier 2: LLM-based classification (<400ms)
 *
 * Used by the real-time call coaching system to identify customer segments
 * and provide appropriate coaching prompts to VAs.
 *
 * Owner: Agent 3 (Segment Classifier)
 */

import type { CallScriptSegment, CallScriptDestination } from '../../shared/schema';
import { CallScriptSegmentValues } from '../../shared/schema';
import { SEGMENT_CONFIGS } from '../call-script/segment-config';
import OpenAI from 'openai';

// Initialize OpenAI client lazily to avoid startup issues
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

export interface ClassificationResult {
  segment: CallScriptSegment;
  confidence: number; // 0-100
  signals: string[];
  tier: 1 | 2;
}

export interface ClassifierOutput {
  primary: ClassificationResult;
  alternatives: ClassificationResult[];
  processingTimeMs: number;
}

export interface Tier2LLMResult {
  segment: string;
  confidence: number;
  signals: string[];
  reasoning: string;
}

// ============================================
// TIER 1: Pattern Matching (Instant, <50ms)
// ============================================

/**
 * Fast pattern matching against segment detection keywords
 * This is the primary classification method for low-latency requirements
 *
 * @param text - Transcript text to analyze
 * @returns Array of matched segments sorted by confidence (descending)
 */
export function tier1PatternMatch(text: string): ClassificationResult[] {
  const startTime = performance.now();
  const normalizedText = text.toLowerCase();
  const results: ClassificationResult[] = [];

  for (const [segmentId, config] of Object.entries(SEGMENT_CONFIGS)) {
    const matchedKeywords: string[] = [];

    for (const keyword of config.detectionKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (normalizedText.includes(keywordLower)) {
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length > 0) {
      // Calculate confidence based on number of matches
      // 1 match = 25%, 2 matches = 50%, 3 matches = 75%, 4+ matches = 95% (capped)
      const confidence = Math.min(matchedKeywords.length * 25, 95);

      results.push({
        segment: segmentId as CallScriptSegment,
        confidence,
        signals: matchedKeywords,
        tier: 1,
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  const elapsed = performance.now() - startTime;
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[Tier1] Pattern match completed in ${elapsed.toFixed(1)}ms, found ${results.length} matches`);
  }

  return results;
}

/**
 * Check if text contains disqualifying signals for a segment
 * These signals should clear/invalidate a segment detection
 */
export function checkDisqualifyingSignals(text: string, segment: CallScriptSegment): string[] {
  const normalizedText = text.toLowerCase();
  const disqualifiers: Record<CallScriptSegment, string[]> = {
    LANDLORD: ['i live there', "i'm the tenant", "it's my home", "i'm renting"],
    BUSY_PRO: ['i work from home', "i'm retired", "i'm always available"],
    OAP: ["i'll do it myself", "i'm quite capable", 'just need a quick job'],
    PROP_MGR: ['just one property', 'my own place', "i'm the owner myself"],
    SMALL_BIZ: ['home office', 'residential', 'my house'],
    EMERGENCY: ['no rush', 'whenever you can', 'been like this for weeks'],
    BUDGET: ['done properly', 'quality work', "price doesn't matter"],
  };

  const segmentDisqualifiers = disqualifiers[segment] || [];
  return segmentDisqualifiers.filter((d) => normalizedText.includes(d.toLowerCase()));
}

// ============================================
// TIER 2: LLM Classification (Fast, <400ms)
// ============================================

const CLASSIFICATION_PROMPT = `You are classifying a customer call for a handyman service. Based on the transcript, identify the customer segment.

SEGMENTS:
- LANDLORD: Owns rental property, may have tenants, often remote from property
- BUSY_PRO: Working professional, time-poor, needs flexibility, has key safe
- PROP_MGR: Property manager/agency, manages multiple properties, wants account/SLA
- OAP: Elderly/trust-seeker, values safety and trust, may live alone, wants to meet first
- SMALL_BIZ: Business owner (shop, restaurant, cafe), needs after-hours, minimal disruption
- EMERGENCY: Urgent issue (flooding, no heating, locked out, sparks) - needs immediate help
- BUDGET: Price-focused, asking about hourly rates, wants cheapest option

Analyze this transcript and return JSON:
{
  "segment": "SEGMENT_NAME",
  "confidence": 0-100,
  "signals": ["signal1", "signal2"],
  "reasoning": "brief explanation"
}

TRANSCRIPT:
`;

/**
 * LLM-based classification using GPT-4o-mini for better accuracy
 * Used when Tier 1 confidence is below threshold
 *
 * @param transcript - Full transcript text to analyze
 * @returns Classification result or null if failed
 */
export async function tier2LLMClassify(transcript: string): Promise<ClassificationResult | null> {
  const startTime = performance.now();

  try {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user', content: transcript },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn('[Tier2] No content in LLM response');
      return null;
    }

    const parsed = JSON.parse(content) as Tier2LLMResult;

    const elapsed = performance.now() - startTime;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[Tier2] LLM classification completed in ${elapsed.toFixed(1)}ms: ${parsed.segment} (${parsed.confidence}%)`);
    }

    // Validate segment is valid
    if (!CallScriptSegmentValues.includes(parsed.segment as CallScriptSegment)) {
      console.warn(`[Tier2] Invalid segment returned: ${parsed.segment}`);
      return null;
    }

    return {
      segment: parsed.segment as CallScriptSegment,
      confidence: parsed.confidence,
      signals: parsed.signals || [],
      tier: 2,
    };
  } catch (error) {
    const elapsed = performance.now() - startTime;
    console.error(`[Tier2] Classification error after ${elapsed.toFixed(1)}ms:`, error);
    return null;
  }
}

// ============================================
// COMBINED CLASSIFIER
// ============================================

export interface ClassifyOptions {
  /** Whether to use Tier 2 LLM classification if Tier 1 confidence is low */
  useTier2?: boolean;
  /** Minimum confidence threshold for Tier 1 to be used alone (default: 70) */
  tier1MinConfidence?: number;
}

/**
 * Main classification function that combines Tier 1 and Tier 2
 *
 * Strategy:
 * 1. Always run Tier 1 first (instant, <50ms)
 * 2. If Tier 1 confidence >= threshold, use Tier 1 result
 * 3. Otherwise, run Tier 2 for better accuracy
 *
 * @param transcript - Transcript text to classify
 * @param options - Configuration options
 * @returns Classification output with primary result and alternatives
 */
export async function classifySegment(
  transcript: string,
  options: ClassifyOptions = {}
): Promise<ClassifierOutput> {
  const startTime = performance.now();
  const { useTier2 = true, tier1MinConfidence = 70 } = options;

  // Always run Tier 1 first (instant)
  const tier1Results = tier1PatternMatch(transcript);

  let primary: ClassificationResult;
  let alternatives: ClassificationResult[] = [];

  // If Tier 1 has high confidence match, use it
  if (tier1Results.length > 0 && tier1Results[0].confidence >= tier1MinConfidence) {
    primary = tier1Results[0];
    alternatives = tier1Results.slice(1, 4);
  }
  // Otherwise, use Tier 2 for better accuracy
  else if (useTier2) {
    const tier2Result = await tier2LLMClassify(transcript);

    if (tier2Result) {
      primary = tier2Result;
      // Merge Tier 1 results as alternatives (excluding the primary segment)
      alternatives = tier1Results
        .filter((r) => r.segment !== tier2Result.segment)
        .slice(0, 3);
    } else {
      // Fallback to Tier 1 best guess or default
      primary = tier1Results[0] || {
        segment: 'BUSY_PRO' as CallScriptSegment, // Default fallback
        confidence: 20,
        signals: [],
        tier: 1,
      };
      alternatives = tier1Results.slice(1, 4);
    }
  } else {
    // Tier 2 disabled, use Tier 1 best guess or default
    primary = tier1Results[0] || {
      segment: 'BUSY_PRO' as CallScriptSegment,
      confidence: 20,
      signals: [],
      tier: 1,
    };
    alternatives = tier1Results.slice(1, 4);
  }

  const processingTimeMs = performance.now() - startTime;

  return {
    primary,
    alternatives,
    processingTimeMs,
  };
}

/**
 * Synchronous classification using only Tier 1 (for real-time streaming)
 * Use this for instant feedback during live calls
 *
 * @param transcript - Transcript text to classify
 * @returns Classification output (Tier 1 only)
 */
export function classifySegmentSync(transcript: string): ClassifierOutput {
  const startTime = performance.now();
  const tier1Results = tier1PatternMatch(transcript);

  const primary: ClassificationResult = tier1Results[0] || {
    segment: 'BUSY_PRO' as CallScriptSegment,
    confidence: 20,
    signals: [],
    tier: 1,
  };

  const processingTimeMs = performance.now() - startTime;

  return {
    primary,
    alternatives: tier1Results.slice(1, 4),
    processingTimeMs,
  };
}

// ============================================
// STREAMING CLASSIFIER (for real-time updates)
// ============================================

/**
 * Streaming classifier that processes transcript chunks in real-time
 * Provides immediate Tier 1 feedback and debounced Tier 2 refinement
 */
export class StreamingClassifier {
  private accumulatedTranscript: string = '';
  private lastClassification: ClassifierOutput | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private onUpdate: (result: ClassifierOutput) => void;
  private useTier2: boolean;
  private tier1MinConfidence: number;

  constructor(
    onUpdate: (result: ClassifierOutput) => void,
    options: {
      debounceMs?: number;
      useTier2?: boolean;
      tier1MinConfidence?: number;
    } = {}
  ) {
    this.onUpdate = onUpdate;
    this.debounceMs = options.debounceMs ?? 500;
    this.useTier2 = options.useTier2 ?? true;
    this.tier1MinConfidence = options.tier1MinConfidence ?? 70;
  }

  /**
   * Add new transcript chunk and trigger classification
   *
   * @param text - New text chunk to add
   */
  addChunk(text: string): void {
    this.accumulatedTranscript += ' ' + text;

    // Always run Tier 1 immediately for instant feedback
    const tier1Results = tier1PatternMatch(this.accumulatedTranscript);

    if (tier1Results.length > 0) {
      const quickResult: ClassifierOutput = {
        primary: tier1Results[0],
        alternatives: tier1Results.slice(1, 4),
        processingTimeMs: 0,
      };

      // Emit immediately if confidence is high enough OR segment changed
      const shouldEmit =
        tier1Results[0].confidence >= 50 ||
        this.lastClassification?.primary.segment !== tier1Results[0].segment;

      if (shouldEmit) {
        this.lastClassification = quickResult;
        this.onUpdate(quickResult);
      }
    }

    // Debounce Tier 2 for more accurate classification
    if (this.useTier2) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        const fullResult = await classifySegment(this.accumulatedTranscript, {
          useTier2: true,
          tier1MinConfidence: this.tier1MinConfidence,
        });

        // Only emit if different from last or higher confidence
        const shouldEmitTier2 =
          !this.lastClassification ||
          fullResult.primary.segment !== this.lastClassification.primary.segment ||
          fullResult.primary.confidence > this.lastClassification.primary.confidence;

        if (shouldEmitTier2) {
          this.lastClassification = fullResult;
          this.onUpdate(fullResult);
        }
      }, this.debounceMs);
    }
  }

  /**
   * Get the current best classification
   */
  getCurrentClassification(): ClassifierOutput | null {
    return this.lastClassification;
  }

  /**
   * Get the accumulated transcript
   */
  getAccumulatedTranscript(): string {
    return this.accumulatedTranscript.trim();
  }

  /**
   * Reset the classifier for a new call
   */
  reset(): void {
    this.accumulatedTranscript = '';
    this.lastClassification = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get the default destination for a classified segment
 */
export function getDestinationForSegment(segment: CallScriptSegment): CallScriptDestination {
  const config = SEGMENT_CONFIGS[segment];
  return config?.defaultDestination || 'INSTANT_QUOTE';
}

/**
 * Convert transcript entries to a single string for classification
 */
export function transcriptToString(
  transcript: Array<{ speaker: 'agent' | 'caller'; text: string }>
): string {
  return transcript.map((entry) => `${entry.speaker}: ${entry.text}`).join('\n');
}

/**
 * Extract only caller speech from transcript (more relevant for classification)
 */
export function extractCallerSpeech(
  transcript: Array<{ speaker: 'agent' | 'caller'; text: string }>
): string {
  return transcript
    .filter((entry) => entry.speaker === 'caller')
    .map((entry) => entry.text)
    .join(' ');
}

export default {
  tier1PatternMatch,
  tier2LLMClassify,
  classifySegment,
  classifySegmentSync,
  checkDisqualifyingSignals,
  getDestinationForSegment,
  transcriptToString,
  extractCallerSpeech,
  StreamingClassifier,
};
