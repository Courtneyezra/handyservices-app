import OpenAI from 'openai';
import { 
  calculateSingleJobPVS, 
  calculateMultiJobPVS, 
  pvsToMultiplier,
  type JobInput,
  type CustomerContext,
  type ContextSignals,
  type PVSResult
} from './pvs-engine';
import type { HHHStructuredInputs } from '@shared/schema';
export type { HHHStructuredInputs };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface PersonalizedFeatures {
  enhanced: string[];
  elite: string[];
}

// Optional extras for simple quotes
export interface OptionalExtra {
  label: string;
  priceInPence: number;
  description: string;
  isRecommended?: boolean;
}

// Fixed perks for each tier - REMOVED: All hardcoded perks removed per user request
// Tiers now only show: core deliverables + parsed extras + AI wildcard (Elite only)
export const FIXED_TIER_UPSELLS = {
  essential: [],
  enhanced: [],
  elite: []
};

// Curated catalog of optional extras
export const OPTIONAL_EXTRAS_CATALOG: OptionalExtra[] = [
  {
    label: 'Same-day slot',
    priceInPence: 3000, // £30
    description: 'Get it done today (subject to availability)',
    isRecommended: false
  },
  {
    label: 'Extended 12-month guarantee',
    priceInPence: 2000, // £20
    description: '12 months workmanship warranty instead of standard 3 months',
    isRecommended: true
  },
  {
    label: 'Thorough clean-up included',
    priceInPence: 1500, // £15
    description: 'Dust sheets, vacuum & wipe-down everything',
    isRecommended: false
  },
  {
    label: 'Next-day booking',
    priceInPence: 2000, // £20
    description: 'Priority slot for tomorrow',
    isRecommended: false
  },
  {
    label: 'Photos of completed work',
    priceInPence: 500, // £5
    description: 'Professional before/after photos sent to your phone',
    isRecommended: true
  },
  {
    label: 'Materials upgrade',
    priceInPence: 2500, // £25
    description: 'Premium materials for better finish & longevity',
    isRecommended: false
  },
  {
    label: 'After-hours service',
    priceInPence: 3500, // £35
    description: 'Evening or weekend slot (6pm-9pm)',
    isRecommended: false
  }
];

export interface AdditivePricingConfig {
  baseRate: number;
  calloutFee: number;
  urgencyModifiers: {
    low: number;
    medium: number;
    high: number;
    emergency: number;
  };
  complexityModifiers: {
    simple: number;
    moderate: number;
    complex: number;
    very_complex: number;
  };
  materialMarkup: number;
  minimumCharge: number;
  maxDailyHours: number;
}

// Legacy interface for backward compatibility
export interface PricingConfig extends AdditivePricingConfig {
  hourlyRate: number;
  urgencyMultipliers: {
    low: number;
    medium: number;
    high: number;
    emergency: number;
  };
  complexityMultipliers: {
    simple: number;
    moderate: number;
    complex: number;
    very_complex: number;
  };
  maximumHours: number;
}

// Function to ensure all prices end in 9 for pricing psychology
function ensurePriceEndsInNine(price: number): number {
  const rounded = Math.round(price);
  const lastDigit = rounded % 10;
  
  if (lastDigit === 9) {
    return rounded;
  }
  
  // If last digit is 0-8, round up to next 9
  // If last digit is 0, make it 9 (e.g., 150 -> 149)
  if (lastDigit === 0) {
    return rounded - 1;
  } else {
    // For 1-8, round up to 9 (e.g., 152 -> 159, 157 -> 159)
    return rounded + (9 - lastDigit);
  }
}

export { ensurePriceEndsInNine };

export const defaultAdditivePricingConfig: AdditivePricingConfig = {
  baseRate: 78,
  calloutFee: 25,
  urgencyModifiers: {
    low: -0.1,      // 10% discount
    medium: 0.0,    // baseline
    high: 0.3,      // 30% premium
    emergency: 0.8  // 80% premium
  },
  complexityModifiers: {
    simple: -0.2,       // 20% discount
    moderate: 0.0,      // baseline
    complex: 0.4,       // 40% premium
    very_complex: 1.0   // 100% premium
  },
  materialMarkup: 0.15, // 15% markup
  minimumCharge: 50,
  maxDailyHours: 8
};

// Legacy config for backward compatibility
export const defaultPricingConfig: PricingConfig = {
  ...defaultAdditivePricingConfig,
  hourlyRate: defaultAdditivePricingConfig.baseRate,
  urgencyMultipliers: {
    low: 0.9,
    medium: 1.0,
    high: 1.3,
    emergency: 1.8
  },
  complexityMultipliers: {
    simple: 0.8,
    moderate: 1.0,
    complex: 1.4,
    very_complex: 2.0
  },
  maximumHours: defaultAdditivePricingConfig.maxDailyHours
};

// In-memory storage for pricing config - using additive model
let currentAdditivePricingConfig: AdditivePricingConfig = { ...defaultAdditivePricingConfig };
let currentPricingConfig: PricingConfig = { ...defaultPricingConfig };

export function getAdditivePricingConfig(): AdditivePricingConfig {
  return currentAdditivePricingConfig;
}

export function getPricingConfig(): PricingConfig {
  return currentPricingConfig;
}

export function updateAdditivePricingConfig(updates: Partial<AdditivePricingConfig>): AdditivePricingConfig {
  currentAdditivePricingConfig = { 
    ...currentAdditivePricingConfig, 
    ...updates,
    urgencyModifiers: {
      ...currentAdditivePricingConfig.urgencyModifiers,
      ...(updates.urgencyModifiers || {})
    },
    complexityModifiers: {
      ...currentAdditivePricingConfig.complexityModifiers,
      ...(updates.complexityModifiers || {})
    }
  };
  
  // Update legacy config for backward compatibility
  currentPricingConfig = {
    ...currentAdditivePricingConfig,
    hourlyRate: currentAdditivePricingConfig.baseRate,
    urgencyMultipliers: {
      low: 1 + currentAdditivePricingConfig.urgencyModifiers.low,
      medium: 1 + currentAdditivePricingConfig.urgencyModifiers.medium,
      high: 1 + currentAdditivePricingConfig.urgencyModifiers.high,
      emergency: 1 + currentAdditivePricingConfig.urgencyModifiers.emergency
    },
    complexityMultipliers: {
      simple: 1 + currentAdditivePricingConfig.complexityModifiers.simple,
      moderate: 1 + currentAdditivePricingConfig.complexityModifiers.moderate,
      complex: 1 + currentAdditivePricingConfig.complexityModifiers.complex,
      very_complex: 1 + currentAdditivePricingConfig.complexityModifiers.very_complex
    },
    maximumHours: currentAdditivePricingConfig.maxDailyHours
  };
  
  return currentAdditivePricingConfig;
}

// Function to sync in-memory config with database config
export function syncConfigFromDatabase(dbConfig: any): void {
  // Convert from pence to pounds (database stores in pence)
  const additivePricingConfig: AdditivePricingConfig = {
    baseRate: dbConfig.hourlyRate ? dbConfig.hourlyRate / 100 : 78,
    calloutFee: dbConfig.calloutFee ? dbConfig.calloutFee / 100 : 25,
    urgencyModifiers: {
      low: (dbConfig.urgencyMultipliers?.low - 1) || -0.1,
      medium: (dbConfig.urgencyMultipliers?.medium - 1) || 0.0,
      high: (dbConfig.urgencyMultipliers?.high - 1) || 0.3,
      emergency: (dbConfig.urgencyMultipliers?.emergency - 1) || 0.8
    },
    complexityModifiers: {
      simple: (dbConfig.complexityMultipliers?.simple - 1) || -0.2,
      moderate: (dbConfig.complexityMultipliers?.moderate - 1) || 0.0,
      complex: (dbConfig.complexityMultipliers?.complex - 1) || 0.4,
      very_complex: (dbConfig.complexityMultipliers?.very_complex - 1) || 1.0
    },
    materialMarkup: dbConfig.materialMarkup || 0.15,
    minimumCharge: dbConfig.minimumCharge ? dbConfig.minimumCharge / 100 : 50,
    maxDailyHours: dbConfig.maximumHours || 8
  };
  
  updateAdditivePricingConfig(additivePricingConfig);
  console.log(`[PRICING CONFIG] Synchronized in-memory config with database - Minimum Charge: £${additivePricingConfig.minimumCharge}`);
}

export function updatePricingConfig(updates: Partial<PricingConfig>): PricingConfig {
  currentPricingConfig = { 
    ...currentPricingConfig, 
    ...updates,
    urgencyMultipliers: {
      ...currentPricingConfig.urgencyMultipliers,
      ...(updates.urgencyMultipliers || {})
    },
    complexityMultipliers: {
      ...currentPricingConfig.complexityMultipliers,
      ...(updates.complexityMultipliers || {})
    }
  };
  return currentPricingConfig;
}

export function calculateAdditiveJobPrice(
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex',
  urgency: 'low' | 'medium' | 'high' | 'emergency',
  estimatedHours: number,
  materialsCost: number = 0
): {
  laborCost: number;
  materialsCost: number;
  calloutFee: number;
  subtotal: number;
  total: number;
  baseRate: number;
  urgencyModifier: number;
  complexityModifier: number;
  adjustedRate: number;
  breakdown: {
    baseHours: number;
    urgencyAdjustment: number;
    complexityAdjustment: number;
  };
} {
  const config = getAdditivePricingConfig();
  
  const urgencyModifier = config.urgencyModifiers[urgency] || 0.0;
  const complexityModifier = config.complexityModifiers[complexity] || 0.0;
  
  // Additive formula: adjustedRate = baseRate * (1 + urgencyModifier + complexityModifier)
  const adjustedRate = config.baseRate * (1 + urgencyModifier + complexityModifier);
  
  const laborCost = Math.max(estimatedHours * adjustedRate, config.minimumCharge);
  const materialsWithMarkup = materialsCost * (1 + config.materialMarkup);
  const subtotal = laborCost + materialsWithMarkup;
  const total = subtotal + config.calloutFee;
  
  // Apply pricing psychology - ensure price ends in 9
  const final = ensurePriceEndsInNine(total);
  
  return {
    laborCost,
    materialsCost: materialsWithMarkup,
    calloutFee: config.calloutFee,
    subtotal,
    total: final,
    baseRate: config.baseRate,
    urgencyModifier,
    complexityModifier,
    adjustedRate,
    breakdown: {
      baseHours: estimatedHours * config.baseRate,
      urgencyAdjustment: estimatedHours * config.baseRate * urgencyModifier,
      complexityAdjustment: estimatedHours * config.baseRate * complexityModifier
    }
  };
}

// EEE Package Types
export type EEEPackageTier = 'essential' | 'enhanced' | 'elite';

export interface EEEPackage {
  tier: EEEPackageTier;
  name: string;
  price: number;
  warrantyMonths: number;
  description: string;
  features: string[];
  isPopular?: boolean;
  hasAftercare?: boolean;
}

export interface EEEPricingResult {
  essential: EEEPackage;
  enhanced: EEEPackage;
  elite: EEEPackage;
}

// Job task interface for EEE packages
export interface JobTask {
  description: string;
  estimatedHours?: number;
  materials?: string[];
}

// Select optional extras for simple jobs based on job details using AI
export async function selectOptionalExtras(
  jobSummary: string,
  basePrice: number,
  completionDate: string
): Promise<OptionalExtra[]> {
  try {
    const prompt = `You are selecting optional extras for a handyman service quote.

Job: ${jobSummary}
Base Quote: £${(basePrice / 100).toFixed(2)}
Completion Timeframe: ${completionDate}

Available optional extras:
${OPTIONAL_EXTRAS_CATALOG.map((extra, idx) => `${idx + 1}. ${extra.label} (+£${(extra.priceInPence / 100).toFixed(2)}) - ${extra.description}`).join('\n')}

Select 2-4 extras that make sense for this specific job. Consider:
- If the job needs quick turnaround, include same-day or next-day slots
- If the job is visual (paint, finish), include photos or materials upgrade
- If the job is messy, include thorough clean-up
- Always consider extended guarantee as it builds trust
- Match extras to the job type and customer's likely needs

Return ONLY the numbers (1-7) of the extras to include, separated by commas. Example: 2,3,5`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You select appropriate optional extras for service quotes based on job requirements. Return only comma-separated numbers.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    // Parse the response (e.g., "2,3,5")
    const selectedIndices = response.split(',').map(num => parseInt(num.trim()) - 1);
    const selectedExtras = selectedIndices
      .filter(idx => idx >= 0 && idx < OPTIONAL_EXTRAS_CATALOG.length)
      .map(idx => OPTIONAL_EXTRAS_CATALOG[idx])
      .slice(0, 4); // Max 4 extras

    // Ensure at least 2 extras
    if (selectedExtras.length < 2) {
      return [
        OPTIONAL_EXTRAS_CATALOG[1], // Extended guarantee
        OPTIONAL_EXTRAS_CATALOG[4]  // Photos
      ];
    }

    return selectedExtras;
  } catch (error) {
    console.error('Error selecting optional extras:', error);
    // Fallback to default recommended extras
    return [
      OPTIONAL_EXTRAS_CATALOG[1], // Extended guarantee
      OPTIONAL_EXTRAS_CATALOG[2], // Clean-up
      OPTIONAL_EXTRAS_CATALOG[4]  // Photos
    ];
  }
}

/**
 * AI-powered core deliverables extraction
 * Analyzes job description and extracts what should be included in the base package
 */
export async function extractCoreDeliverablesFromJob(
  jobSummary: string
): Promise<string[]> {
  try {
    const prompt = `You are analyzing a handyman job to determine what should be included as core deliverables in the base package.

**Job Description:**
${jobSummary}

**Your Task:**
Extract 4-6 core deliverables that should be included in EVERY package tier (Essential, Enhanced, Elite). These are the fundamental things the customer gets regardless of which tier they choose.

**Guidelines:**
- Include the actual work being done
- Include basic guarantees/warranties
- Include standard materials
- Include workspace cleanup
- Keep them concise (1 sentence each)
- Focus on what makes this a professional, quality service

**Format:**
Return ONLY a JSON array of strings, nothing else:
["Deliverable 1", "Deliverable 2", "Deliverable 3", "Deliverable 4"]

Example for "Fix leaking kitchen tap":
["Professional tap repair or replacement", "Quality replacement parts included", "Tidy workspace cleanup"]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You extract core deliverables from job descriptions. Return only valid JSON arrays.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response
    const coreDeliverables = JSON.parse(response);
    
    if (!Array.isArray(coreDeliverables) || coreDeliverables.length === 0) {
      throw new Error('Invalid response format');
    }

    return coreDeliverables;
  } catch (error) {
    console.error('Error extracting core deliverables:', error);
    // Fallback to generic core deliverables (no warranty - that's shown separately)
    return [
      'Core job completed professionally',
      'Quality materials included',
      'Tidy workspace clean-up',
    ];
  }
}

/**
 * Generate AI wildcard feature for Elite tier
 * Purpose: Make Elite feel premium but slightly "too much" to push customers to Hassle-Free
 * Returns a single feature that sounds good but makes customers think twice
 */
export async function generateEliteWildcard(
  jobSummary: string,
  packagePrice: number // Elite price in pence
): Promise<string> {
  try {
    const prompt = `You are a pricing strategist for a handyman service. Generate ONE wildcard feature for the "High Standard" (Elite) tier that makes it feel slightly "too much" or "overkill" compared to the "Hassle-Free" (middle) tier.

**Job Description:**
${jobSummary}

**Elite Tier Price:** £${(packagePrice / 100).toFixed(2)}

**Your Goal:**
Generate a feature that sounds premium but makes customers think "that's nice but I don't really need it" to push them towards choosing Hassle-Free instead.

**Examples of good wildcards:**
- "Premium project manager assigned to oversee the entire job"
- "Detailed written report with before/after photos and maintenance recommendations"
- "Extended 2-week follow-up visit included"
- "Priority emergency callback service for 30 days"
- "Certificate of completion with detailed work breakdown"

**Guidelines:**
- Make it sound professional and premium
- But also feel like "extra" rather than essential
- Should be relevant to the job
- Keep it concise (one sentence)
- Don't make it too appealing - we want to push customers to Hassle-Free

Return ONLY the feature text, no JSON, no markdown, just plain text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a pricing strategist who creates "wildcard" features that sound premium but are designed to make customers choose the middle tier instead.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    return response;
  } catch (error) {
    console.error('Error generating elite wildcard:', error);
    // Fallback wildcard that feels like "too much"
    return 'Detailed project documentation with photographic evidence and completion certificate';
  }
}

/**
 * AI-powered upgrade distribution across tiers
 * Takes potential upgrades and intelligently assigns them to Enhanced/Elite tiers
 * Returns structured upgrade distribution to maximize middle-tier conversions
 */
export async function distributeUpgradesAcrossTiers(
  jobSummary: string,
  potentialUpgrades: string[] | Array<{description: string; category?: string; complexity?: string; estimatedHours?: number; materialsCost?: number}>,
  packagePrices: { handyFix: number; hassleFree: number; highStandard: number } // all in pence
): Promise<{
  enhancedUpgrades: string[];
  eliteUpgrades: string[];
}> {
  try {
    if (!potentialUpgrades || potentialUpgrades.length === 0) {
      return {
        enhancedUpgrades: [],
        eliteUpgrades: []
      };
    }

    // Check if we have structured extras or legacy string array
    const isStructured = potentialUpgrades.length > 0 && typeof potentialUpgrades[0] === 'object' && potentialUpgrades[0] !== null && 'description' in potentialUpgrades[0];
    
    // Build upgrade list with metadata if available
    const upgradeList = isStructured
      ? (potentialUpgrades as Array<any>).map((u, i) => {
          const meta = [];
          if (u.category) meta.push(`Category: ${u.category}`);
          if (u.complexity) meta.push(`Complexity: ${u.complexity}`);
          if (u.estimatedHours) meta.push(`+${u.estimatedHours}h`);
          if (u.materialsCost) meta.push(`+£${u.materialsCost} materials`);
          return `${i + 1}. ${u.description}${meta.length > 0 ? ` (${meta.join(', ')})` : ''}`;
        }).join('\n')
      : (potentialUpgrades as string[]).map((u, i) => `${i + 1}. ${u}`).join('\n');

    const prompt = `You are a pricing strategist for a handyman service. Your goal is to distribute optional upgrades across two premium tiers (Hassle-Free and High Standard) to maximize conversions and favor the middle tier.

**Job Description:**
${jobSummary}

**Package Pricing:**
- Handy Fix (Essential): £${(packagePrices.handyFix / 100).toFixed(2)} - Base package with core deliverables
- Hassle-Free (Enhanced): £${(packagePrices.hassleFree / 100).toFixed(2)} - This is the SWEET SPOT tier we want to push
- High Standard (Elite): £${(packagePrices.highStandard / 100).toFixed(2)} - Premium tier

**Available Upgrades to Distribute:**
${upgradeList}

**Your Task:**
Distribute these upgrades across the two tiers strategically:

1. **Hassle-Free (Enhanced) should get EXACTLY 2-3 moderate upgrades MAX** - Be selective!
   - Pick ONLY the 2-3 most valuable, practical upgrades that customers truly need
   - These should feel like "must-haves" that justify the price jump
   - Focus on safety, convenience, and peace of mind
   ${isStructured ? '- Prioritize safety/warranty upgrades and quick visual improvements' : ''}
   - IMPORTANT: Do NOT include warranty/guarantee upgrades (we add those separately)

2. **High Standard (Elite) should get 2-4 ADDITIONAL premium extras** (on top of Enhanced)
   - Return ONLY the extras unique to Elite (we'll add Enhanced automatically)
   - Add luxury/premium features that feel indulgent
   - Include white-glove service, premium materials, or extra guarantees
   ${isStructured ? '- Prioritize high-complexity or high-cost upgrades that justify premium pricing' : ''}
   - Save the remaining upgrades for Elite to create clear differentiation

**Key Principles:**
- Make Hassle-Free irresistible value (sweet spot)
- Elite should feel premium but not essential
- Consider the job type when selecting upgrades
- Ensure logical progression from Essential → Enhanced → Elite
${isStructured ? `
- **Use the metadata provided (Category, Complexity, Hours, Materials Cost) to make smart distribution decisions:**
  - Visual/aesthetic upgrades with low hours → Enhanced (quick wins)
  - Safety/warranty upgrades → Enhanced (peace of mind)
  - Comfort/convenience with high materials cost → Elite (premium feel)
  - High complexity or high-hour upgrades → Elite (justify premium price)
` : ''}

Return ONLY a JSON object in this exact format (no markdown, no code blocks):
{
  "enhancedUpgrades": ["upgrade description 1", "upgrade description 2", "upgrade description 3"],
  "eliteUpgrades": ["upgrade description 4", "upgrade description 5"]
}

Note: eliteUpgrades contains ONLY additional upgrades for Elite (Enhanced upgrades will be included automatically). Return ONLY the description text, NOT the metadata.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a pricing strategist who distributes service upgrades across tiers to maximize customer conversions. You always return valid JSON without markdown formatting.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    // Remove markdown code blocks if present
    const cleanedResponse = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const distribution = JSON.parse(cleanedResponse);
    
    console.log('[AI UPGRADE DISTRIBUTION]', {
      totalUpgrades: potentialUpgrades.length,
      enhancedCount: distribution.enhancedUpgrades?.length || 0,
      eliteOnlyCount: distribution.eliteUpgrades?.length || 0
    });

    return {
      enhancedUpgrades: distribution.enhancedUpgrades || [],
      eliteUpgrades: distribution.eliteUpgrades || []
    };
  } catch (error) {
    console.error('Error distributing upgrades:', error);
    // Fallback: distribute evenly
    const isStructured = potentialUpgrades.length > 0 && typeof potentialUpgrades[0] === 'object' && potentialUpgrades[0] !== null && 'description' in potentialUpgrades[0];
    const upgradeDescriptions = isStructured 
      ? (potentialUpgrades as Array<any>).map(u => u.description)
      : potentialUpgrades as string[];
    
    const midpoint = Math.ceil(upgradeDescriptions.length / 2);
    return {
      enhancedUpgrades: upgradeDescriptions.slice(0, midpoint),
      eliteUpgrades: upgradeDescriptions.slice(midpoint)
    };
  }
}

// Calculate EEE package pricing based on base price and job tasks
// Generate personalized features using AI based on value opportunities and emotional angle
export async function generatePersonalizedFeatures(
  jobSummary: string,
  valueOpportunities: string[],
  emotionalAngle: string,
  jobTasks: any[]
): Promise<PersonalizedFeatures> {
  try {
    const valueOpportunityLabels: Record<string, string> = {
      'visual': 'Visual improvement (paint, finish, alignment, appearance)',
      'speed': 'Speed & convenience (tidy-up, less hassle, efficient process)',
      'durability': 'Longevity / durability (better materials, longer-lasting fix)',
      'smart': 'Smart / functional upgrade (e.g., add dimmer, shelving, insulation)',
      'comfort': 'Home comfort / lifestyle value (feels better, easier to use, looks premium)',
      'peace': 'Peace of mind / guarantee extension (extra protection, warranty)',
      'addon': 'Add-on opportunity (something nearby could be improved too)',
    };

    const emotionalLabels: Record<string, string> = {
      'looks-brand-new': 'Looks brand new again',
      'feels-effortless': 'Feels effortless and premium',
      'future-proof': 'Future-proof and worry-free',
      'adds-value': 'Adds value to their home',
      'proud-to-show': "They'll be proud to show it off",
    };

    const selectedOpportunities = valueOpportunities
      .map(opp => valueOpportunityLabels[opp])
      .filter(Boolean)
      .join(', ');

    const selectedEmotion = emotionalLabels[emotionalAngle] || '';

    const prompt = `You are creating outcome-focused deliverable features for a handyman business package tiers.

Job: ${jobSummary}
Tasks: ${jobTasks.map(t => t.description).join(', ')}

Value Opportunities Selected: ${selectedOpportunities || 'None specified'}
Emotional Outcome: ${selectedEmotion || 'None specified'}

Create OUTCOME-FOCUSED deliverables for two package tiers. Focus on what the customer GETS, not what we DO.

1. HASSLE-FREE tier (mid-tier): Add 3-4 deliverable outcomes that match the selected value opportunities. These should describe the end result the customer experiences.

2. HIGH STANDARD tier (premium): Add 4-5 deliverable outcomes that combine the value opportunities with the emotional angle. Make these aspirational outcomes grounded in the job.

CRITICAL - Outcome Writing Rules:
- Describe the FINAL STATE or RESULT, not the process
- BAD: "Install premium materials" → GOOD: "Premium-grade fixtures that last longer"
- BAD: "Thorough cleanup" → GOOD: "Spotless workspace ready to use immediately"
- BAD: "Extended warranty" → GOOD: "12-month worry-free guarantee"
- BAD: "Quality inspection" → GOOD: "Certified quality-checked finish"
- Use adjectives that convey results: "spotless", "certified", "worry-free", "professional-grade"
- Avoid action verbs like "install", "provide", "include" - state what they GET instead
- Keep features concise (under 10 words each)
- Focus on tangible benefits the customer can see/experience
- DO NOT include same-day or next-day booking/scheduling features (these are handled separately)
- Features must be SPECIFIC to this job, not generic platitudes

Examples for a tap repair job:
- HASSLE-FREE: "Drip-free tap with smooth operation", "Matching chrome finish", "6-month performance guarantee"
- HIGH STANDARD: "Premium ceramic cartridge for lasting performance", "Perfectly aligned handles", "Brand-new tap feel", "12-month comprehensive warranty"

Return ONLY valid JSON in this format:
{
  "enhanced": ["outcome deliverable 1", "outcome deliverable 2", "outcome deliverable 3"],
  "elite": ["outcome deliverable 1", "outcome deliverable 2", "outcome deliverable 3", "outcome deliverable 4"]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You generate specific, personalized service features based on job details and customer value priorities. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    // Remove markdown code blocks if present
    const cleanedResponse = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const features = JSON.parse(cleanedResponse);
    return features as PersonalizedFeatures;
  } catch (error) {
    console.error('Error generating personalized features:', error);
    // Fallback to generic features if AI fails
    return {
      enhanced: [
        'Premium materials upgrade',
        'Extended completion guarantee',
        'Detailed quality check'
      ],
      elite: [
        'Top-tier materials selection',
        'White-glove service experience',
        'Lifetime consultation access',
        'VIP priority scheduling'
      ]
    };
  }
}

export function calculateEEEPackagePricing(
  basePrice: number, 
  jobTasks: JobTask[] = [],
  personalizedFeatures?: PersonalizedFeatures
): EEEPricingResult {
  // CRITICAL: Enforce minimum charge of £50 (5000 pence)
  const MINIMUM_CHARGE_PENCE = 5000; // £50
  const enforcedBasePrice = Math.max(basePrice, MINIMUM_CHARGE_PENCE);
  
  console.log(`[HHH PRICING] Base price: £${(basePrice / 100).toFixed(2)}, After minimum enforcement: £${(enforcedBasePrice / 100).toFixed(2)}`);
  
  // Configuration for EEE pricing (all values in pence to match basePrice)
  const enhancedMarkupPercent = 0.08; // 8% markup for enhanced
  const enhancedMinimumFee = 1500; // Minimum £15 for enhanced (1500 pence)
  
  const eliteMarkupPercent = 0.18; // 18% markup for elite
  const eliteMinimumFee = 3500; // Minimum £35 for elite (3500 pence)
  const aftercareFee = 2500; // Fixed £25 aftercare fee (2500 pence)
  
  // Calculate markups based on the enforced base price
  const enhancedMarkup = Math.max(enforcedBasePrice * enhancedMarkupPercent, enhancedMinimumFee);
  const eliteMarkup = Math.max(enforcedBasePrice * eliteMarkupPercent, eliteMinimumFee);
  
  // Calculate final prices with psychology pricing (end in 9)
  const essentialPrice = ensurePriceEndsInNine(enforcedBasePrice);
  const enhancedPrice = ensurePriceEndsInNine(enforcedBasePrice + enhancedMarkup);
  const elitePrice = ensurePriceEndsInNine(enforcedBasePrice + eliteMarkup + aftercareFee);
  
  // Essential features: actual job tasks + basic service guarantees
  const essentialFeatures = [
    ...jobTasks.slice(0, 3).map(task => task.description),
    'Turn up on time guarantee',
    'Clean up and leave tidy guarantee'
  ];
  
  // If more than 3 tasks, add a summary
  if (jobTasks.length > 3) {
    essentialFeatures.push(`+ ${jobTasks.length - 3} more tasks included`);
  }
  
  // Enhanced and Elite tiers only show AI-generated personalized features
  const enhancedFeatures = personalizedFeatures
    ? personalizedFeatures.enhanced
    : [];

  const eliteFeatures = personalizedFeatures
    ? personalizedFeatures.elite
    : [];

  return {
    essential: {
      tier: 'essential',
      name: 'Handy Fix',
      price: essentialPrice,
      warrantyMonths: 3,
      description: 'Available slots from 14 days onward • 3-month warranty',
      features: essentialFeatures
    },
    enhanced: {
      tier: 'enhanced',
      name: 'Hassle-Free',
      price: enhancedPrice,
      warrantyMonths: 12,
      description: 'Get booked within 7 days (Most Popular) • Everything in Handy Fix +',
      features: enhancedFeatures,
      isPopular: true
    },
    elite: {
      tier: 'elite',
      name: 'High Standard',
      price: elitePrice,
      warrantyMonths: 36,
      description: 'Next-day slots available (limited) • Everything in Hassle-Free +',
      features: eliteFeatures,
      hasAftercare: true
    }
  };
}

// Legacy function for backward compatibility
export function calculateJobPrice(
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex',
  urgency: 'low' | 'medium' | 'high' | 'emergency',
  estimatedHours: number,
  materialsCost: number = 0
): {
  laborCost: number;
  materialsCost: number;
  calloutFee: number;
  subtotal: number;
  total: number;
  hourlyRate: number;
} {
  const additiveResult = calculateAdditiveJobPrice(complexity, urgency, estimatedHours, materialsCost);
  
  return {
    laborCost: additiveResult.laborCost,
    materialsCost: additiveResult.materialsCost,
    calloutFee: additiveResult.calloutFee,
    subtotal: additiveResult.subtotal,
    total: additiveResult.total,
    hourlyRate: additiveResult.adjustedRate
  };
}

/**
 * VALUE-ANCHORED PRICING SYSTEM
 * Replaces cost-plus with value-based pricing using PVS (Perceived Value Score)
 */

export interface ValueAnchoredPricingInput {
  jobs: JobInput[];
  customer: CustomerContext;
  context: ContextSignals;
  config?: Partial<AdditivePricingConfig>;
}

export interface ValueAnchoredPricingResult {
  // PVS Data
  pvsScore: number;
  valueMultiplier: number;
  dominantCategory: string;
  dominantJob?: JobInput;
  
  // Cost Calculation
  baseCost: number; // Cost-based calculation (for reference)
  anchorPrice: number; // baseCost × valueMultiplier
  
  // Mode Selection
  quoteMode: 'simple' | 'hhh';
  
  // Pricing
  packages: {
    handyFix: number; // anchor × 0.85
    hassleFree: number; // anchor × 1.00
    highStandard: number; // anchor × 1.20
  };
  
  // Simple mode alternative
  simpleQuote?: number;
}

/**
 * Calculate value-anchored pricing for one or more jobs
 * Uses PVS engine to determine value multiplier, then applies to base cost
 * 
 * FIXED: Properly handles multi-job pricing by:
 * - Aggregating labor/materials without duplicating callout fee
 * - Adding callout fee once at the end
 * - Only rounding final tier prices, not intermediate values
 * - Using consistent cost basis for PVS cost-share adjustment
 */
export function calculateValueAnchoredPricing(
  input: ValueAnchoredPricingInput
): ValueAnchoredPricingResult {
  const { jobs, customer, context, config } = input;
  
  const pricingConfig = config || getAdditivePricingConfig();
  
  // Map context urgency to pricing urgency
  const urgencyMap: Record<string, 'low' | 'medium' | 'high' | 'emergency'> = {
    low: 'low',
    normal: 'medium',
    high: 'high',
    emergency: 'emergency'
  };
  
  const urgency = urgencyMap[context.urgency || 'normal'] || 'medium';
  const urgencyModifier = pricingConfig.urgencyModifiers?.[urgency] ?? 0.0;
  
  // Aggregate labor and materials across all jobs WITHOUT callout fee
  let totalLaborCost = 0;
  let totalMaterialsCost = 0;
  const jobBaseCosts: number[] = []; // Track individual job costs for PVS weighting
  
  for (const job of jobs) {
    const complexity = job.complexity || 'moderate';
    const complexityModifier = pricingConfig.complexityModifiers?.[complexity] ?? 0.0;
    const hours = job.estimatedHours || 1;
    const materials = job.materialsCost || 0;
    
    // Calculate adjusted rate for this job
    const baseRate = pricingConfig.baseRate ?? 78;
    const adjustedRate = baseRate * (1 + urgencyModifier + complexityModifier);
    
    // Labor cost for this job (no callout yet, no rounding)
    const minimumCharge = pricingConfig.minimumCharge ?? 50;
    const jobLaborCost = Math.max(hours * adjustedRate, minimumCharge);
    
    // Materials with markup for this job
    const materialMarkup = pricingConfig.materialMarkup ?? 0.15;
    const jobMaterialsCost = materials * (1 + materialMarkup);
    
    // Track individual job cost for PVS engine
    const jobBaseCost = jobLaborCost + jobMaterialsCost;
    jobBaseCosts.push(jobBaseCost);
    
    // Aggregate
    totalLaborCost += jobLaborCost;
    totalMaterialsCost += jobMaterialsCost;
  }
  
  // Add callout fee ONCE for the entire multi-job visit
  const subtotal = totalLaborCost + totalMaterialsCost;
  const calloutFee = pricingConfig.calloutFee ?? 25;
  const totalBaseCost = subtotal + calloutFee;
  
  // Calculate PVS (single or multi-job) with correct cost basis
  const pvsResult: PVSResult = jobs.length === 1
    ? calculateSingleJobPVS(jobs[0], customer, context)
    : calculateMultiJobPVS(jobs, customer, context, totalBaseCost, jobBaseCosts);
  
  // Calculate anchor price = baseCost × valueMultiplier (NO rounding yet)
  const anchorPrice = totalBaseCost * pvsResult.valueMultiplier;
  
  // Determine quote mode
  // Simple mode: PVS < 25 AND visualImpact < 20 AND baseCost < £150
  const visualImpactScore = pvsResult.factors.visualImpact;
  
  const quoteMode: 'simple' | 'hhh' = (
    pvsResult.pvsScore < 25 && 
    visualImpactScore < 20 && 
    totalBaseCost < 150 // £150 threshold (working in pounds internally)
  ) ? 'simple' : 'hhh';
  
  // Calculate tier prices with rounding ONLY at the end
  // HHH tiers: anchor × [0.85, 1.00, 1.20]
  const handyFixPrice = ensurePriceEndsInNine(anchorPrice * 0.85);
  const hassleFreePrice = ensurePriceEndsInNine(anchorPrice * 1.00);
  const highStandardPrice = ensurePriceEndsInNine(anchorPrice * 1.20);
  
  // Simple mode: use base cost directly
  const simpleQuote = quoteMode === 'simple' 
    ? ensurePriceEndsInNine(totalBaseCost) 
    : undefined;
  
  // Convert all prices from pounds to pence for storage/API
  return {
    pvsScore: pvsResult.pvsScore,
    valueMultiplier: pvsResult.valueMultiplier,
    dominantCategory: pvsResult.dominantCategory,
    dominantJob: pvsResult.dominantJob,
    baseCost: Math.round(totalBaseCost * 100), // Convert £ to pence
    anchorPrice: Math.round(anchorPrice * 100), // Convert £ to pence
    quoteMode,
    packages: {
      handyFix: Math.round(handyFixPrice * 100), // Convert £ to pence
      hassleFree: Math.round(hassleFreePrice * 100), // Convert £ to pence
      highStandard: Math.round(highStandardPrice * 100) // Convert £ to pence
    },
    simpleQuote: simpleQuote ? Math.round(simpleQuote * 100) : undefined // Convert £ to pence
  };
}

/**
 * Calculate EEE packages using value-anchored pricing
 * This is the new pricing engine that replaces cost-plus
 */
export function calculateValueAnchoredEEEPackages(
  pricingResult: ValueAnchoredPricingResult,
  jobTasks: JobTask[],
  personalizedFeatures?: PersonalizedFeatures
): EEEPricingResult {
  const { packages } = pricingResult;
  
  // Essential features: actual job tasks + basic service guarantees
  const essentialFeatures = [
    ...jobTasks.slice(0, 3).map(task => task.description),
    'Turn up on time guarantee',
    'Clean up and leave tidy guarantee'
  ];
  
  // If more than 3 tasks, add a summary
  if (jobTasks.length > 3) {
    essentialFeatures.push(`+ ${jobTasks.length - 3} more tasks included`);
  }
  
  // Enhanced and Elite tiers only show AI-generated personalized features
  const enhancedFeatures = personalizedFeatures
    ? personalizedFeatures.enhanced
    : [];

  const eliteFeatures = personalizedFeatures
    ? personalizedFeatures.elite
    : [];

  return {
    essential: {
      tier: 'essential',
      name: 'Handy Fix',
      price: packages.handyFix,
      warrantyMonths: 3,
      description: 'Available slots from 14 days onward • 3-month warranty',
      features: essentialFeatures
    },
    enhanced: {
      tier: 'enhanced',
      name: 'Hassle-Free',
      price: packages.hassleFree,
      warrantyMonths: 12,
      description: 'Get booked within 7 days (Most Popular) • Everything in Handy Fix +',
      features: enhancedFeatures,
      isPopular: true
    },
    elite: {
      tier: 'elite',
      name: 'High Standard',
      price: packages.highStandard,
      warrantyMonths: 36,
      description: 'Next-day slots available (limited) • Everything in Hassle-Free +',
      features: eliteFeatures,
      hasAftercare: true
    }
  };
}

// ==========================================
// H/HH/HHH VALUE-PRICED SYSTEM (NEW)
// ==========================================

/**
 * Structured inputs for new H/HH/HHH value-priced system
 * Type imported from @shared/schema to ensure consistency across frontend and backend
 */

/**
 * Pricing result for H/HH/HHH tiers
 */
export interface HHHTierPricing {
  handyFix: number;      // H tier (base × 1.00)
  hassleFree: number;    // HH tier (base × 1.45)
  highStandard: number;  // HHH tier (base × 2.00 × urgency factor)
  basePrice: number;     // The calculated base before multipliers
}

/**
 * Calculate base price from structured inputs
 * Price = (hourly rate × estimated hours) × complexity multipliers
 * Price is influenced by: estimated hours, categories, risk, substrates, materials_by
 */
export function calculateHHHBasePrice(inputs: HHHStructuredInputs): number {
  // Hourly rate and estimated hours drive the base price
  const HOURLY_RATE = 45; // £45/hour base rate
  const hours = inputs.totalEstimatedHours || 2; // Default to 2 hours if not specified
  
  // Start with hours-based calculation
  let base = HOURLY_RATE * hours;
  
  // Add callout fee for all jobs
  const CALLOUT_FEE = 25;
  base += CALLOUT_FEE;
  
  // Category complexity adjustments
  const categoryWeights: Record<string, number> = {
    mounting: 1.0,           // Basic
    carpentry: 1.15,         // Moderate skill
    painting: 1.1,           // Moderate time
    plaster: 1.2,            // Specialist skill
    plumbing: 1.3,           // Regulated/specialist
    electrical_minor: 1.4    // Highest skill/regulation
  };
  
  // Calculate category multiplier (average of selected categories)
  const categoryMultiplier = inputs.categories.length > 0
    ? inputs.categories.reduce((sum, cat) => sum + (categoryWeights[cat] || 1.0), 0) / inputs.categories.length
    : 1.0;
  
  base *= categoryMultiplier;
  
  // Multi-category bonus (job bundles multiple skills)
  if (inputs.categories.length > 1) {
    base *= (1 + (inputs.categories.length - 1) * 0.08); // +8% per additional category
  }
  
  // Risk adjustment (1=low, 2=medium, 3=high)
  const riskMultipliers = {
    1: 1.0,
    2: 1.1,   // +10%
    3: 1.25   // +25%
  };
  base *= riskMultipliers[inputs.risk as 1 | 2 | 3] || 1.0;
  
  // Substrate complexity
  const substrateWeights: Record<string, number> = {
    plasterboard: 1.0,  // Easiest
    brick: 1.1,         // Harder
    tile: 1.15,         // Delicate/specialist
    mixed: 1.2,         // Complexity of multiple surfaces
    unknown: 1.05       // Contingency buffer
  };
  
  // Use highest substrate weight if multiple
  const substrateMultiplier = inputs.substrates && inputs.substrates.length > 0
    ? Math.max(...inputs.substrates.map(s => substrateWeights[s] || 1.0))
    : 1.0;
  
  base *= substrateMultiplier;
  
  // Materials responsibility
  const materialsMultipliers = {
    us: 1.15,      // We source + markup
    client: 0.95,  // Client provides (small discount)
    mixed: 1.05    // Shared responsibility
  };
  base *= materialsMultipliers[inputs.materialsBy] || 1.0;
  
  // Enforce absolute minimum
  const ABSOLUTE_MIN = 59; // £59 minimum job
  return Math.max(base, ABSOLUTE_MIN);
}

/**
 * Calculate H/HH/HHH tier prices with multipliers and urgency factors
 */
export function calculateHHHTierPrices(inputs: HHHStructuredInputs): HHHTierPricing {
  const basePrice = calculateHHHBasePrice(inputs);
  
  // Tier multipliers (simple, fixed)
  const TIER_MULTIPLIERS = {
    handyFix: 1.0,      // H = base × 1.00
    hassleFree: 1.45,   // HH = base × 1.45
    highStandard: 2.0   // HHH = base × 2.00 (before urgency)
  };
  
  // Urgency factors (applied to HHH tier only)
  const URGENCY_FACTORS = {
    same_day: 1.3,     // Emergency premium
    next_day: 1.15,    // Rush premium
    flexible: 1.0      // Standard (no premium)
  };
  
  // Calculate tier prices
  const handyFix = basePrice * TIER_MULTIPLIERS.handyFix;
  const hassleFree = basePrice * TIER_MULTIPLIERS.hassleFree;
  const highStandard = basePrice * TIER_MULTIPLIERS.highStandard * URGENCY_FACTORS[inputs.urgency];
  
  // Tier minimum prices
  const TIER_MINIMUMS = {
    handyFix: 50,      // £50 minimum
    hassleFree: 70,    // £70 minimum
    highStandard: 100  // £100 minimum
  };
  
  // Apply pricing psychology (ends in 9) and enforce minimums
  return {
    handyFix: ensurePriceEndsInNine(Math.max(handyFix, TIER_MINIMUMS.handyFix)),
    hassleFree: ensurePriceEndsInNine(Math.max(hassleFree, TIER_MINIMUMS.hassleFree)),
    highStandard: ensurePriceEndsInNine(Math.max(highStandard, TIER_MINIMUMS.highStandard)),
    basePrice: Math.round(basePrice)
  };
}

/**
 * Fixed value bullets for each tier (NOT in database, hardcoded)
 * These are universal across all jobs
 */
export const HHH_FIXED_VALUE_BULLETS = {
  handyFix: [
    'Fix carried out quickly',
    'Area tidied and swept clean'
  ],
  hassleFree: [
    'Higher-strength fixing method',
    'Neater finish with attention to detail',
    '6-month workmanship guarantee'
  ],
  highStandard: [
    'Premium strength materials and methods',
    'Millimetre-precision alignment and finish',
    'Priority booking included',
    '12-month extended guarantee'
  ]
};

/**
 * Generate job-specific top line from tasks (appears on all tiers)
 * Returns a concise outcome-focused summary
 */
export function generateJobTopLine(tasks: string[]): string {
  if (tasks.length === 0) return 'Job completed professionally';
  if (tasks.length === 1) return tasks[0];
  if (tasks.length === 2) return `${tasks[0]} and ${tasks[1].toLowerCase()}`;
  
  // For 3+ tasks, use first task + count
  const remaining = tasks.length - 1;
  return `${tasks[0]} + ${remaining} more task${remaining > 1 ? 's' : ''}`;
}

/**
 * Get complete feature list for a tier including job-specific top line + fixed bullets
 */
export function getHHHTierFeatures(
  tier: 'handyFix' | 'hassleFree' | 'highStandard',
  tasks: string[]
): string[] {
  const jobTopLine = generateJobTopLine(tasks);
  const fixedBullets = HHH_FIXED_VALUE_BULLETS[tier];
  
  return [jobTopLine, ...fixedBullets];
}

/**
 * Generate WhatsApp-formatted message for H/HH/HHH quote
 * Returns plain text ready to paste into WhatsApp
 */
export function generateHHHWhatsAppMessage(
  customerName: string,
  tasks: string[],
  pricing: HHHTierPricing
): string {
  const jobTopLine = generateJobTopLine(tasks);
  
  // Convert prices from pence to pounds for display
  const formatPrice = (pence: number) => `£${(pence / 100).toFixed(0)}`;
  
  const message = `Hi ${customerName},

Thanks for getting in touch. Here are three ways we can help with your job:

${jobTopLine}

━━━━━━━━━━━━━━━━━━━

*HANDY FIX* - ${formatPrice(pricing.handyFix)}
• ${HHH_FIXED_VALUE_BULLETS.handyFix[0]}
• ${HHH_FIXED_VALUE_BULLETS.handyFix[1]}
• 3-month guarantee

*HASSLE-FREE* - ${formatPrice(pricing.hassleFree)} ⭐ Most Popular
• Everything in Handy Fix PLUS:
• ${HHH_FIXED_VALUE_BULLETS.hassleFree[0]}
• ${HHH_FIXED_VALUE_BULLETS.hassleFree[1]}
• ${HHH_FIXED_VALUE_BULLETS.hassleFree[2]}

*HIGH STANDARD* - ${formatPrice(pricing.highStandard)}
• Everything in Hassle-Free PLUS:
• ${HHH_FIXED_VALUE_BULLETS.highStandard[0]}
• ${HHH_FIXED_VALUE_BULLETS.highStandard[1]}
• ${HHH_FIXED_VALUE_BULLETS.highStandard[2]}
• ${HHH_FIXED_VALUE_BULLETS.highStandard[3]}

━━━━━━━━━━━━━━━━━━━

To book, simply reply with:
"Handy Fix", "Hassle-Free", or "High Standard"

Any questions? Just ask!`;

  return message;
}