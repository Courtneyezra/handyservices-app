/**
 * AI-Generated Taglines with Behavioral Economics & Pricing Psychology
 * 
 * Creates tier-specific taglines that leverage:
 * - Essential: Risk minimization, competence, value anchoring
 * - Enhanced: Loss aversion, speed, middle-option bias
 * - Elite: Exclusivity, premium positioning, long-term value
 */

interface AnalysedJob {
  summary: string;
  urgency?: 'low' | 'medium' | 'high' | 'emergency';
}

interface EEETaglines {
  essential: string;
  enhanced: string;
  elite: string;
}

interface WarrantyMonths {
  essential: number;
  enhanced: number;
  elite: number;
}

// Tier-specific lexicons based on behavioral economics
const TIER_LEXICONS = {
  essential: {
    allowed: ['reliable', 'simple', 'sorted', 'done right', 'proper', 'solid', 'no-fuss', 'dependable', 'quality'],
    prohibited: ['priority', 'white-glove', 'aftercare', 'specialist', 'premium', 'exclusive', 'pro']
  },
  enhanced: {
    allowed: ['priority', 'faster', 'pro finish', 'protected', 'warranty', '12-mo', 'stress-free', 'pro', 'covered'],
    prohibited: ['white-glove', 'bespoke', 'specialist', 'basic', 'simple']
  },
  elite: {
    allowed: ['white-glove', 'specialist', 'precision', 'aftercare', '36-mo', 'premium', 'exclusive', 'bespoke'],
    prohibited: ['budget', 'basic', 'simple', 'cheap']
  }
} as const;

// Template patterns for each tier - focused on end deliverable/product
const TIER_TEMPLATES = {
  essential: [
    'Working {jobCore}, guaranteed',
    'Reliable {jobCore} solution',
    'Fully functioning {jobCore}',
    'Quality {jobCore} that lasts',
    'Dependable {jobCore} system'
  ],
  enhanced: [
    'Pro-grade {jobCore} + warranty',
    'Premium {jobCore} installation',
    'Professional {jobCore} system',
    'Fully covered {jobCore} solution',
    'Warrantied {jobCore} upgrade'
  ],
  elite: [
    'Specialist {jobCore} + lifetime care',
    'Premium {jobCore} with aftercare',
    'Precision-engineered {jobCore}',
    'Exclusive {jobCore} + 36-mo coverage',
    'Professional {jobCore} + ongoing support'
  ]
} as const;

/**
 * Extracts job core from summary (removes verbs, articles, reduces to noun phrase)
 */
function extractJobCore(summary: string): string {
  // Remove common prefixes
  let cleaned = summary.replace(/^(Installation of |Installation |Repair of |Repair |Fixing |Replace |Replacement of )/i, '');
  
  // Remove articles and simplify
  cleaned = cleaned.replace(/\b(the|a|an)\b/gi, '');
  
  // Extract key noun phrases (max 3 words)
  const words = cleaned.split(' ').filter(word => word.length > 0);
  
  // Take first 2-3 meaningful words, prioritize nouns
  const meaningfulWords = words.slice(0, 3).filter(word => 
    !['and', 'or', 'in', 'on', 'at', 'to', 'for', 'with'].includes(word.toLowerCase())
  );
  
  return meaningfulWords.slice(0, 2).join(' ').toLowerCase();
}

/**
 * Validates tagline against tier constraints
 */
function validateTagline(tagline: string, tier: keyof typeof TIER_LEXICONS): boolean {
  const lowerTagline = tagline.toLowerCase();
  const { allowed, prohibited } = TIER_LEXICONS[tier];
  
  // Check prohibited words
  for (const word of prohibited) {
    if (lowerTagline.includes(word.toLowerCase())) {
      return false;
    }
  }
  
  // Check length (3-6 words)
  const wordCount = tagline.split(' ').length;
  if (wordCount < 3 || wordCount > 6) {
    return false;
  }
  
  return true;
}

/**
 * Generates tier-specific tagline using templates and constraints
 */
function generateTierTagline(
  jobCore: string, 
  tier: keyof typeof TIER_TEMPLATES,
  warrantyMonths?: number
): string {
  const templates = TIER_TEMPLATES[tier];
  
  // Select template based on warranty info
  let selectedTemplate: string;
  
  if (tier === 'enhanced' && warrantyMonths) {
    selectedTemplate = templates.find(t => t.includes('12-mo')) || templates[0];
  } else if (tier === 'elite' && warrantyMonths) {
    selectedTemplate = templates.find(t => t.includes('36-mo')) || templates[0];
  } else {
    // Use first template for simplicity, could be randomized
    selectedTemplate = templates[0];
  }
  
  // Replace placeholder with job core
  const tagline = selectedTemplate.replace('{jobCore}', jobCore);
  
  // Validate against constraints
  if (!validateTagline(tagline, tier)) {
    // Fallback to basic pattern
    switch (tier) {
      case 'essential':
        return `${jobCore} done right`;
      case 'enhanced':
        return `pro ${jobCore} service`;
      case 'elite':
        return `premium ${jobCore} care`;
    }
  }
  
  return tagline;
}

/**
 * Ensures taglines are distinct across tiers (≥2 token difference)
 */
function ensureDistinctness(taglines: EEETaglines): EEETaglines {
  const essential = taglines.essential.toLowerCase().split(' ');
  const enhanced = taglines.enhanced.toLowerCase().split(' ');
  const elite = taglines.elite.toLowerCase().split(' ');
  
  // Check distinctness - if too similar, apply fallback differentiation
  const essentialEnhancedOverlap = essential.filter(word => enhanced.includes(word)).length;
  const enhancedEliteOverlap = enhanced.filter(word => elite.includes(word)).length;
  
  if (essentialEnhancedOverlap > 1 || enhancedEliteOverlap > 1) {
    // Apply stronger differentiation
    return {
      essential: taglines.essential.replace(/pro|priority|premium/gi, 'reliable'),
      enhanced: taglines.enhanced,
      elite: taglines.elite.replace(/done right|simple/gi, 'premium')
    };
  }
  
  return taglines;
}

/**
 * Main function: Generates EEE taglines with behavioral economics principles
 */
export function generateEEETaglines(
  analysedJob: AnalysedJob,
  warrantyMonths: WarrantyMonths = { essential: 3, enhanced: 12, elite: 36 }
): EEETaglines {
  // Extract job core
  const jobCore = extractJobCore(analysedJob.summary);
  
  // Generate initial taglines
  const rawTaglines: EEETaglines = {
    essential: generateTierTagline(jobCore, 'essential'),
    enhanced: generateTierTagline(jobCore, 'enhanced', warrantyMonths.enhanced),
    elite: generateTierTagline(jobCore, 'elite', warrantyMonths.elite)
  };
  
  // Ensure distinctness and hierarchy
  const distinctTaglines = ensureDistinctness(rawTaglines);
  
  // Capitalize first letter of each tagline
  return {
    essential: distinctTaglines.essential.charAt(0).toUpperCase() + distinctTaglines.essential.slice(1),
    enhanced: distinctTaglines.enhanced.charAt(0).toUpperCase() + distinctTaglines.enhanced.slice(1),
    elite: distinctTaglines.elite.charAt(0).toUpperCase() + distinctTaglines.elite.slice(1)
  };
}

// Export for testing
export { extractJobCore, validateTagline, TIER_LEXICONS, TIER_TEMPLATES };