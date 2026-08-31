/**
 * Quote Research Types — WP2: Lightweight research output for quote-ready intakes.
 *
 * This is the structured output of the research function that runs when a quote
 * becomes ready. It populates materials, time estimates, and procedures WITHOUT
 * heavy LLM calls — using catalog lookups, historical data, and heuristics instead.
 */

export interface QuoteResearchResult {
  /** Researched job lines, one per intake line. */
  jobs: JobResearch[];
  /** Overall confidence score (0-100) for the entire research. */
  overallConfidence: number;
}

export interface JobResearch {
  /** Customer-facing job title (from intake). */
  title: string;
  /** Internal detail/evidence (from intake). */
  description: string;
  /** Materials shopping list for this job. */
  materials: MaterialEstimate[];
  /** Time estimate with provenance. */
  timeEstimate: TimeEstimate;
  /** Step-by-step procedure (max 6 steps). */
  procedure: string[];
  /** Confidence score (0-100) for this job. */
  confidence: number;
  /** Human-readable explanation of why these choices were made. */
  reasoning: string;
}

export interface MaterialEstimate {
  /** Product name shown to contractor. */
  name: string;
  /** Quantity needed. */
  quantity: number;
  /** Unit of measurement (e.g. 'each', 'metres', 'pack'). */
  unit: string;
  /** Ex-VAT unit price in pence. */
  unitPrice: number;
  /** Where the price came from. */
  source: 'catalog' | 'screwfix' | 'estimated';
  /** How confident we are in this price. */
  confidence: 'high' | 'medium' | 'low';
  /** Alternative materials if primary not available. */
  alternatives?: MaterialEstimate[];
}

export interface TimeEstimate {
  /** Estimated minutes for this job. */
  minutes: number;
  /** How confident we are in this estimate. */
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable explanation of the estimate basis. */
  reasoning: string;
  /** Similar jobs from history that informed this estimate. */
  similarJobs?: { description: string; minutes: number }[];
}
