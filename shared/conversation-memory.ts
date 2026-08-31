/**
 * Conversation Memory Types for Agent Framework V2
 *
 * Shared memory object for specialist workers architecture.
 * Workers read/write to this memory, Ben reviews/edits, system learns from edits.
 */

// ==========================================
// MAIN MEMORY OBJECT
// ==========================================

export interface ConversationMemory {
  id: string;
  conversationId: string;
  version: number;  // Optimistic locking

  // === RAW INPUTS ===
  messages: MemoryMessage[];
  media: MemoryMedia[];
  calls: MemoryCall[];

  // === EXTRACTED (Vision Worker) ===
  mediaExtractions: MediaExtraction[];

  // === SCOPE (Scoping Worker) ===
  scope: ConversationScope | null;

  // === RESEARCH (Research Worker) ===
  research: ConversationResearch | null;

  // === PRICING (Pricing Worker) ===
  pricing: ConversationPricing | null;

  // === DRAFT (Message Worker) ===
  draft: QuoteDraft | null;

  // === STATE ===
  readiness: MemoryReadiness;
  blockers: Blocker[];

  // === AUDIT ===
  workerRuns: WorkerRun[];
  benEdits: BenEdit[];

  createdAt: string;
  updatedAt: string;
}

// ==========================================
// READINESS STATE MACHINE
// ==========================================

export type MemoryReadiness =
  | 'new'
  | 'extracting_media'
  | 'gathering'
  | 'scoped'
  | 'researching'
  | 'researched'
  | 'pricing'
  | 'priced'
  | 'drafting'
  | 'ready_for_ben'
  | 'sent'
  | 'needs_human';

// ==========================================
// RAW INPUT TYPES
// ==========================================

export interface MemoryMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  phone: string;
  channel: 'whatsapp' | 'sms' | 'call' | 'webform' | 'email' | 'note';
  createdAt: string;
  mediaIds?: string[];
}

export interface MemoryMedia {
  id: string;
  url: string;
  type: 'image/jpeg' | 'image/png' | 'video/mp4' | 'audio/ogg' | 'application/pdf' | string;
  messageId: string;
  createdAt: string;
}

export interface MemoryCall {
  id: string;
  direction: 'inbound' | 'outbound';
  durationSeconds: number;
  transcript: string | null;
  summary: string | null;
  createdAt: string;
}

// ==========================================
// VISION EXTRACTION TYPES
// ==========================================

export interface MediaExtraction {
  mediaId: string;
  model: 'gemini-flash' | 'gpt-4o' | string;
  extractedAt: string;
  items: ExtractedItem[];
  defects: ExtractedDefect[];
  textFound: string[];  // OCR results
  confidence: number;   // 0-1
  raw: string;          // Original model output for debugging
  /** Summary of what the media shows (visual + audio for videos) */
  whatIsShown?: string;
  /** Notes on what was requested but not visible in media */
  whatIsMissing?: string;
}

export interface ExtractedItem {
  type: string;           // e.g., 'tap', 'pipe', 'fence_panel'
  material?: string;      // e.g., 'chrome', 'copper', 'wood'
  condition?: string;     // e.g., 'corroded', 'leaking', 'broken'
  location?: string;      // e.g., 'kitchen sink', 'garden boundary'
  confidence: 'high' | 'medium' | 'low';
}

export interface ExtractedDefect {
  type: 'leak' | 'crack' | 'corrosion' | 'rot' | 'missing' | 'broken' | 'worn' | 'other';
  severity: 'minor' | 'moderate' | 'major';
  description: string;
  itemRef?: string;       // Links to ExtractedItem
}

// ==========================================
// SCOPE TYPES
// ==========================================

export interface ConversationScope {
  customerName: string | null;
  phone: string;
  postcode: string | null;
  customerType: 'homeowner' | 'landlord' | 'letting_agent' | 'business';
  tone: 'urgent' | 'anxious' | 'relaxed' | 'price_sensitive' | 'detailed' | 'terse';
  lines: ScopeLine[];
  assumptions: ScopeAssumption[];
  gaps: ScopeGap[];
  lastScopedAt: string;
}

export interface ScopeLine {
  id: string;
  title: string;              // Customer-facing, max 60 chars
  detail: string;             // Internal evidence
  customerWords: string;      // What customer actually said (for human-like replies)
  assumptions: ScopeAssumption[];
  evidence: {
    messageIds: string[];
    mediaIds: string[];
    callIds: string[];
  };
}

export interface ScopeAssumption {
  text: string;
  confidence: 'observed' | 'inferred' | 'assumed';
  source: 'photo' | 'customer_said' | 'typical_for_job';
}

export interface ScopeGap {
  id: string;
  question: string;
  audience: 'customer' | 'ben';
  lineId: string | null;
  impact: 'none' | 'small' | 'large' | 'forks_job';
  asked: boolean;
  askedAt: string | null;
  answered: boolean;
  answeredAt: string | null;
  answer: string | null;
}

// ==========================================
// RESEARCH TYPES
// ==========================================

export interface ConversationResearch {
  lines: ResearchedLine[];
  historicalMatches: HistoricalMatch[];
  lastResearchedAt: string;
}

export interface ResearchedLine {
  lineId: string;
  materials: ResearchedMaterial[];
  timeEstimate: TimeEstimate;
  procedure: string[];
}

export interface ResearchedMaterial {
  name: string;
  quantity: number;
  unitPricePence: number;
  supplier: 'catalog' | 'screwfix' | 'web' | 'estimated';
  confidence: 'high' | 'medium' | 'low';
  needsReview: boolean;
}

export interface TimeEstimate {
  minutes: number;
  confidence: 'high' | 'medium' | 'low';
  basis: 'historical' | 'estimated' | 'standard';
  reasoning: string;
}

export interface HistoricalMatch {
  jobId: string;
  similarity: number;  // 0-1
  pricePence: number;
  notes: string;
}

// ==========================================
// PRICING TYPES
// ==========================================

export interface ConversationPricing {
  lines: PricedLine[];
  labourPence: number;
  materialsPence: number;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  margin: number;
  lastPricedAt: string;
}

export interface PricedLine {
  lineId: string;
  labourPence: number;
  materialsPence: number;
  totalPence: number;
}

// ==========================================
// DRAFT TYPES
// ==========================================

export interface QuoteDraft {
  message: string;
  quoteLink: string;
  tone: 'warm' | 'professional' | 'urgent';
  lastDraftedAt: string;
}

// ==========================================
// AUDIT TYPES
// ==========================================

export interface WorkerRun {
  id: string;
  worker: 'vision' | 'scoping' | 'reply' | 'research' | 'pricing' | 'message';
  model: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  changes: string[];     // Fields modified
  error: string | null;
  tokenUsage: { input: number; output: number } | null;
  // Detailed trace (optional, for debugging/case studies)
  trace?: {
    prompt?: string;      // Full prompt sent to LLM
    response?: string;    // Raw LLM response
    reasoning?: string;   // Why this action was taken (reply worker)
  };
}

export interface BenEdit {
  id: string;
  field: string;         // JSON path, e.g., "scope.lines[0].title"
  before: unknown;
  after: unknown;
  editedAt: string;
  quoteId: string | null;
}

// ==========================================
// BLOCKER TYPES
// ==========================================

export interface Blocker {
  type: 'decline_trade' | 'needs_visit' | 'needs_ben_decision' | 'customer_unresponsive';
  reason: string;
  createdAt: string;
}

// ==========================================
// HELPER TYPES
// ==========================================

/** Partial memory for updates - excludes id, conversationId, createdAt */
export type MemoryUpdate = Partial<Omit<ConversationMemory, 'id' | 'conversationId' | 'createdAt'>>;

/** Fields that are JSONB arrays in the database */
export const MEMORY_ARRAY_FIELDS = [
  'messages',
  'media',
  'calls',
  'mediaExtractions',
  'blockers',
  'workerRuns',
  'benEdits',
] as const;

/** Fields that are nullable JSONB objects in the database */
export const MEMORY_OBJECT_FIELDS = [
  'scope',
  'research',
  'pricing',
  'draft',
] as const;
