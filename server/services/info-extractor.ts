/**
 * Info Extractor Service for Call Script Tube Map
 *
 * Extracts structured information from call transcripts:
 * - Job description
 * - Postcode / location
 * - Customer name
 * - Decision maker status
 * - Remote/local status
 * - Tenant presence
 *
 * Owner: Agent 3 (Segment Classifier)
 */

// ============================================
// TYPES & INTERFACES
// ============================================

export interface ExtractedInfo {
  /** The job or service being requested */
  job: string | null;
  /** UK postcode if mentioned */
  postcode: string | null;
  /** Customer name if mentioned */
  name: string | null;
  /** Phone number if mentioned */
  contact: string | null;
  /** Whether the caller can make decisions (true = yes, false = no, null = unknown) */
  isDecisionMaker: boolean | null;
  /** Whether the caller is remote from the property */
  isRemote: boolean | null;
  /** Whether the property has a tenant */
  hasTenant: boolean | null;
}

// ============================================
// REGEX PATTERNS
// ============================================

/**
 * UK Postcode regex pattern
 * Matches formats: SW11 2AB, SW112AB, SW11, E1 6AN, EC1A 1BB
 */
const POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/gi;

/**
 * Partial postcode (outward code only)
 * Matches: SW11, E1, EC1A
 */
const PARTIAL_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/gi;

/**
 * UK phone number patterns
 */
const PHONE_REGEX = /\b(0\d{10,11}|\+44\s?\d{10,11}|07\d{9})\b/gi;

// ============================================
// JOB KEYWORDS
// ============================================

/**
 * Common job/service keywords for detection
 */
const JOB_KEYWORDS = [
  // Plumbing
  'boiler',
  'tap',
  'leak',
  'plumbing',
  'toilet',
  'sink',
  'bath',
  'shower',
  'radiator',
  'heating',
  'pipe',
  'drain',
  'stopcock',
  'cistern',
  'flush',
  'overflow',

  // Electrical
  'electrical',
  'light',
  'socket',
  'switch',
  'fuse',
  'wiring',
  'bulb',
  'extractor',
  'fan',

  // Carpentry
  'door',
  'shelf',
  'shelves',
  'cupboard',
  'cabinet',
  'wardrobe',
  'drawer',
  'handle',
  'hinge',
  'lock',

  // Walls & Ceilings
  'painting',
  'paint',
  'plaster',
  'plastering',
  'tile',
  'tiles',
  'tiling',
  'grouting',
  'ceiling',
  'wall',

  // Outdoor
  'fence',
  'gate',
  'gutter',
  'roof',
  'window',
  'blind',
  'curtain',
  'shed',
  'decking',
  'patio',

  // Mounting & Installation
  'mount',
  'mounting',
  'tv mount',
  'mirror',
  'picture',
  'bracket',
  'rail',
  'hook',

  // General
  'repair',
  'fix',
  'replace',
  'install',
  'fit',
  'broken',
  'stuck',
  'jammed',
  'leaking',
  'dripping',
];

/**
 * Location/area keywords (common London areas)
 */
const AREA_KEYWORDS = [
  'brixton',
  'clapham',
  'battersea',
  'wandsworth',
  'fulham',
  'chelsea',
  'kensington',
  'hammersmith',
  'shepherds bush',
  'notting hill',
  'paddington',
  'camden',
  'islington',
  'hackney',
  'shoreditch',
  'stratford',
  'greenwich',
  'lewisham',
  'peckham',
  'dulwich',
  'streatham',
  'tooting',
  'wimbledon',
  'putney',
  'richmond',
  'croydon',
  'bromley',
];

// ============================================
// EXTRACTION FUNCTIONS
// ============================================

/**
 * Extract postcode from transcript text
 * @param text - Text to search
 * @returns Full postcode, partial postcode, or null
 */
export function extractPostcode(text: string): string | null {
  // Try full postcode first
  const fullMatch = text.match(POSTCODE_REGEX);
  if (fullMatch) {
    // Normalize: uppercase and add space before inward code if missing
    const cleaned = fullMatch[0].toUpperCase().replace(/\s+/g, '');
    if (cleaned.length > 4) {
      return cleaned.slice(0, -3) + ' ' + cleaned.slice(-3);
    }
    return cleaned;
  }

  // Try partial postcode (outward code)
  const partialMatch = text.match(PARTIAL_POSTCODE_REGEX);
  if (partialMatch) {
    // Filter out common false positives (e.g., "I'm", "TV")
    const filtered = partialMatch.filter(
      (p) => !['TV', 'OK', 'UK', 'AM', 'PM', 'ID', 'IT', 'IN', 'ON', 'OR'].includes(p.toUpperCase())
    );
    if (filtered.length > 0) {
      return filtered[0].toUpperCase();
    }
  }

  // Check for area names
  const lowerText = text.toLowerCase();
  for (const area of AREA_KEYWORDS) {
    if (lowerText.includes(area)) {
      // Return area name as location hint (not a postcode, but useful)
      return area.charAt(0).toUpperCase() + area.slice(1);
    }
  }

  return null;
}

/**
 * Extract job description from transcript text
 * @param text - Text to search
 * @returns Job description or null
 */
export function extractJob(text: string): string | null {
  const lowerText = text.toLowerCase();

  // Find sentences containing job keywords
  const sentences = text.split(/[.!?]+/);

  for (const keyword of JOB_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      // Find the sentence containing this keyword
      const relevantSentence = sentences.find((s) => s.toLowerCase().includes(keyword));

      if (relevantSentence) {
        // Clean up and truncate
        const cleaned = relevantSentence.trim().replace(/^(hi|hello|hey|yeah|so|um|uh|well)\s*,?\s*/i, '');
        return cleaned.slice(0, 150); // Cap at 150 chars
      }
    }
  }

  return null;
}

/**
 * Extract phone number from transcript text
 * @param text - Text to search
 * @returns Phone number or null
 */
export function extractPhone(text: string): string | null {
  const match = text.match(PHONE_REGEX);
  return match ? match[0] : null;
}

/**
 * Detect if caller is the decision maker
 * @param text - Text to analyze
 * @returns true = decision maker, false = not, null = unclear
 */
export function detectDecisionMaker(text: string): boolean | null {
  const lowerText = text.toLowerCase();

  // Phrases indicating they ARE the decision maker
  const positiveIndicators = [
    "i'm the owner",
    'i own',
    "it's my",
    'yes, it\'s mine',
    "it's mine",
    'my property',
    'my house',
    'my flat',
    'i can approve',
    'i make the decision',
    'i live there',
    "i'm the landlord",
  ];

  // Phrases indicating they are NOT the decision maker
  const negativeIndicators = [
    'need to check with',
    "i'll have to ask",
    "i'm just getting quotes",
    "he'll decide",
    "she'll decide",
    "they'll decide",
    "i'm calling on behalf",
    'for my boss',
    'for my landlord',
    "i'm the tenant",
    "i rent",
    'checking for',
    'my manager',
  ];

  // Check negative first (stronger signal)
  for (const phrase of negativeIndicators) {
    if (lowerText.includes(phrase)) {
      return false;
    }
  }

  // Check positive
  for (const phrase of positiveIndicators) {
    if (lowerText.includes(phrase)) {
      return true;
    }
  }

  return null;
}

/**
 * Detect if caller is remote from the property
 * @param text - Text to analyze
 * @returns true = remote, false = local/present, null = unclear
 */
export function detectRemote(text: string): boolean | null {
  const lowerText = text.toLowerCase();

  // Phrases indicating remote
  const remoteIndicators = [
    "not local",
    "can't be there",
    "won't be there",
    "i'm in",
    "i live in",
    "i'm up in",
    "i'm down in",
    "away",
    "abroad",
    "overseas",
    "miles away",
    "hours away",
    "different city",
    "manchester",
    "birmingham",
    "leeds",
    "bristol",
    "scotland",
  ];

  // Phrases indicating local/present
  const localIndicators = [
    "i'll be there",
    "i can be there",
    "i live there",
    "i'm local",
    "just round the corner",
    "nearby",
    "down the road",
    "can let you in",
    "i'll wait in",
    "i work from home",
  ];

  // Check remote indicators
  for (const phrase of remoteIndicators) {
    if (lowerText.includes(phrase)) {
      return true;
    }
  }

  // Check local indicators
  for (const phrase of localIndicators) {
    if (lowerText.includes(phrase)) {
      return false;
    }
  }

  return null;
}

/**
 * Detect if property has a tenant
 * @param text - Text to analyze
 * @returns true = has tenant, false = empty/no tenant, null = unclear
 */
export function detectTenant(text: string): boolean | null {
  const lowerText = text.toLowerCase();

  // Phrases indicating tenant presence
  const tenantIndicators = [
    'my tenant',
    'the tenant',
    'tenant called',
    'tenant reported',
    'tenant said',
    'tenant needs',
    'renter',
    'letting to',
    'let to someone',
    'someone living there',
    'currently let',
    'tenants',
  ];

  // Phrases indicating no tenant / empty
  const emptyIndicators = [
    'empty',
    'vacant',
    'between tenants',
    'just moved out',
    'nobody living there',
    'unoccupied',
    'ready for new tenant',
    'before tenant moves in',
  ];

  // Check for tenant
  for (const phrase of tenantIndicators) {
    if (lowerText.includes(phrase)) {
      return true;
    }
  }

  // Check for empty
  for (const phrase of emptyIndicators) {
    if (lowerText.includes(phrase)) {
      return false;
    }
  }

  return null;
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extract all structured info from transcript text
 * @param transcript - Full transcript text
 * @returns Extracted information
 */
export function extractInfo(transcript: string): ExtractedInfo {
  return {
    job: extractJob(transcript),
    postcode: extractPostcode(transcript),
    name: null, // Name extraction is complex, may need LLM
    contact: extractPhone(transcript),
    isDecisionMaker: detectDecisionMaker(transcript),
    isRemote: detectRemote(transcript),
    hasTenant: detectTenant(transcript),
  };
}

/**
 * Incrementally extract info, merging with existing data
 * Used for streaming transcripts - don't overwrite existing non-null values
 *
 * @param newChunk - New transcript chunk
 * @param existingInfo - Previously extracted info
 * @returns Merged info
 */
export function extractInfoIncremental(
  newChunk: string,
  existingInfo: ExtractedInfo
): ExtractedInfo {
  const newInfo = extractInfo(newChunk);

  return {
    job: existingInfo.job || newInfo.job,
    postcode: existingInfo.postcode || newInfo.postcode,
    name: existingInfo.name || newInfo.name,
    contact: existingInfo.contact || newInfo.contact,
    isDecisionMaker: existingInfo.isDecisionMaker ?? newInfo.isDecisionMaker,
    isRemote: existingInfo.isRemote ?? newInfo.isRemote,
    hasTenant: existingInfo.hasTenant ?? newInfo.hasTenant,
  };
}

/**
 * Extract info from transcript entries (with speaker labels)
 * @param transcript - Array of transcript entries
 * @returns Extracted info
 */
export function extractInfoFromEntries(
  transcript: Array<{ speaker: 'agent' | 'caller'; text: string }>
): ExtractedInfo {
  // Combine all text for extraction
  const fullText = transcript.map((e) => e.text).join(' ');

  // Also extract caller-only text for some signals
  const callerText = transcript
    .filter((e) => e.speaker === 'caller')
    .map((e) => e.text)
    .join(' ');

  // Use full text for job and postcode
  const job = extractJob(fullText);
  const postcode = extractPostcode(fullText);
  const contact = extractPhone(fullText);

  // Use caller text for decision maker and other caller-specific signals
  const isDecisionMaker = detectDecisionMaker(callerText);
  const isRemote = detectRemote(callerText);
  const hasTenant = detectTenant(callerText);

  return {
    job,
    postcode,
    name: null,
    contact,
    isDecisionMaker,
    isRemote,
    hasTenant,
  };
}

// ============================================
// STREAMING INFO EXTRACTOR
// ============================================

/**
 * Streaming info extractor that processes transcript chunks in real-time
 */
export class StreamingInfoExtractor {
  private accumulatedInfo: ExtractedInfo;
  private onUpdate: (info: ExtractedInfo) => void;

  constructor(onUpdate: (info: ExtractedInfo) => void) {
    this.onUpdate = onUpdate;
    this.accumulatedInfo = {
      job: null,
      postcode: null,
      name: null,
      contact: null,
      isDecisionMaker: null,
      isRemote: null,
      hasTenant: null,
    };
  }

  /**
   * Add new transcript chunk and extract info
   */
  addChunk(text: string): void {
    const previousInfo = { ...this.accumulatedInfo };
    this.accumulatedInfo = extractInfoIncremental(text, this.accumulatedInfo);

    // Emit update if anything changed
    const hasChanged = Object.keys(this.accumulatedInfo).some(
      (key) =>
        this.accumulatedInfo[key as keyof ExtractedInfo] !==
        previousInfo[key as keyof ExtractedInfo]
    );

    if (hasChanged) {
      this.onUpdate(this.accumulatedInfo);
    }
  }

  /**
   * Get current extracted info
   */
  getCurrentInfo(): ExtractedInfo {
    return { ...this.accumulatedInfo };
  }

  /**
   * Reset for new call
   */
  reset(): void {
    this.accumulatedInfo = {
      job: null,
      postcode: null,
      name: null,
      contact: null,
      isDecisionMaker: null,
      isRemote: null,
      hasTenant: null,
    };
  }
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate UK postcode format
 */
export function isValidUKPostcode(postcode: string): boolean {
  const fullPattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
  const partialPattern = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
  return fullPattern.test(postcode) || partialPattern.test(postcode);
}

/**
 * Normalize postcode format
 */
export function normalizePostcode(postcode: string): string {
  // Remove extra spaces
  const cleaned = postcode.toUpperCase().replace(/\s+/g, '');

  // Add space before inward code if full postcode
  if (cleaned.length > 4) {
    return cleaned.slice(0, -3) + ' ' + cleaned.slice(-3);
  }

  return cleaned;
}

export default {
  extractInfo,
  extractInfoIncremental,
  extractInfoFromEntries,
  extractPostcode,
  extractJob,
  extractPhone,
  detectDecisionMaker,
  detectRemote,
  detectTenant,
  isValidUKPostcode,
  normalizePostcode,
  StreamingInfoExtractor,
};
