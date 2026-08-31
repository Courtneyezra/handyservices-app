/**
 * Quote Build Types — the structured output of the estimator agent.
 *
 * The estimator consumes an intake (or raw builder lines) and researches each
 * line: materials (catalog → Screwfix → web fallback), time (historical + model
 * estimate), and procedure (trade knowledge + diy_advice). Output pre-fills the
 * builder as a confirm/select wizard — Ben remains human-in-loop and never
 * auto-prices from this.
 */

/** One material item in the estimator's output. */
export interface EstimatedMaterial {
  /** Product name shown to contractor. */
  name: string;
  /** Quantity needed. */
  qty: number;
  /** Ex-VAT cost basis in pence (the quote's cost input). */
  unitPricePence: number;
  /** Inc-VAT price in pence (what the contractor pays). */
  unitPriceIncVatPence?: number;
  /** Product thumbnail URL. */
  imageUrl?: string;
  /** Where the price came from. */
  supplier: 'catalog' | 'screwfix' | 'web' | 'model';
  /** Supplier SKU / item number. */
  supplierItemNumber?: string;
  /** Direct product page link. */
  supplierUrl?: string;
  /** Present when from our materials_catalog. */
  catalogId?: string;
  /** True for web/model-sourced (unverified price — needs human review). */
  needsReview: boolean;
  /** Human-readable provenance, e.g. "Found on Toolstation", "Model estimate". */
  sourceNote?: string;
}

/** Time estimate with provenance. */
export interface TimeEstimate {
  /** Estimated minutes for this line. */
  minutes: number;
  /** How confident we are in this estimate. */
  confidence: 'high' | 'medium' | 'low';
  /** Where the estimate came from. */
  basis: 'sku' | 'historical' | 'model';
  /** [min, max] range if uncertain. */
  rangeMinutes?: [number, number];
  /** Human-readable note, e.g. "Based on 4 similar plumbing_minor jobs averaging 38min". */
  note?: string;
}

/** One line in the estimator's output. */
export interface EstimatedLine {
  /** 0-based index matching intake lines order. */
  lineIndex: number;
  /** Line description (copied from intake). */
  description: string;
  /** Job category. */
  category: string;
  /** Time estimate with provenance. */
  time: TimeEstimate;
  /** Materials shopping list for this line. */
  materials: EstimatedMaterial[];
  /** Step-by-step scope (max 6, format "Head — detail"). */
  procedure: string[];
  /** Price caveats for this line. */
  assumptions: string[];
  /** Unresolved item note, e.g. "Could not find XYZ part — Ben to source". */
  unresolved?: string;
}

/** Full estimator output. */
export interface QuoteBuild {
  /** Conversation ID if invoked from intake. */
  conversationId?: string;
  /** Customer details if available. */
  customer?: {
    name: string;
    phone: string;
    postcode: string;
  };
  /** Estimated lines ready for the builder. */
  lines: EstimatedLine[];
  /** Quote-level caveats. */
  quoteNotes?: string[];
  /** Things the agent couldn't resolve. */
  unresolvedItems?: string[];
  /** Version string for future compatibility. */
  estimatorVersion: string;
  /** ISO timestamp when this build was created. */
  createdAt: string;
}

/**
 * Builder line input — minimal shape the estimator accepts when invoked
 * without a conversation (builder-only mode).
 */
export interface EstimatorLineInput {
  /** Line description. */
  description: string;
  /** Job category (optional, will be inferred if missing). */
  category?: string;
}
