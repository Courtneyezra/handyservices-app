/**
 * Triage Worker
 *
 * Categorizes tenant issues and estimates pricing.
 * Works behind the scenes to prepare dispatch decisions.
 */

import { BaseWorker, commonTools } from './base-worker';
import { Tool, AIProvider } from '../provider';
import { categorizeIssue, assessUrgency } from '../../rules-engine';
import { PriceEstimate } from '@shared/schema';
import { db } from '../../db';
import { productizedServices } from '@shared/schema';
import { ilike, or, sql } from 'drizzle-orm';

const TRIAGE_SYSTEM_PROMPT = `You are a property maintenance triage specialist.
Your job is to categorize tenant issues, estimate pricing, and prepare for dispatch decisions.

## Your Goals

1. **Categorize** - Determine the type of work needed
2. **Estimate** - Calculate a price range based on similar jobs
3. **Assess Risk** - Identify any safety or complexity concerns
4. **Recommend** - Suggest whether to auto-dispatch or request approval

## Categories
- plumbing, plumbing_emergency
- electrical, electrical_emergency
- heating
- carpentry
- locksmith, security
- water_leak
- appliance
- cosmetic, upgrade
- pest_control, cleaning, garden
- general, other

## Urgency Levels
- low: Can wait days/weeks (cosmetic)
- medium: Should fix within 1-2 weeks
- high: Affecting daily life, within days
- emergency: Safety issue, ASAP

## Pricing Guidelines
- Simple fix (tap washer, door handle): £50-100
- Medium job (tap replacement, lock repair): £100-200
- Complex job (boiler repair, pipe work): £200-400
- Major work (bathroom leak, heating system): £400+

Always use the SKU database for accurate pricing when available.
`;

export class TriageWorker extends BaseWorker {
    name: 'TRIAGE_WORKER' = 'TRIAGE_WORKER';
    systemPrompt = TRIAGE_SYSTEM_PROMPT;

    constructor(provider: AIProvider) {
        super(provider);
        this.chatOptions = {
            temperature: 0.3, // Low temperature for consistent categorization
            maxTokens: 512
        };
    }

    tools: Tool[] = [
        ...commonTools,
        {
            name: 'categorize_and_price',
            description: 'Categorize an issue and estimate its price',
            parameters: {
                type: 'object',
                properties: {
                    description: {
                        type: 'string',
                        description: 'Description of the issue'
                    },
                    category: {
                        type: 'string',
                        description: 'Issue category'
                    },
                    urgency: {
                        type: 'string',
                        enum: ['low', 'medium', 'high', 'emergency'],
                        description: 'Urgency level'
                    }
                },
                required: ['description']
            },
            handler: async (args) => {
                const { description, category: suggestedCategory, urgency: suggestedUrgency } = args as {
                    description: string;
                    category?: string;
                    urgency?: string;
                };

                const category = suggestedCategory || categorizeIssue(description);
                const urgency = suggestedUrgency || assessUrgency(description, category as any);
                const estimate = await estimatePrice(description, category);

                return {
                    category,
                    urgency,
                    estimate,
                    recommendedAction: getRecommendedAction(category, urgency, estimate)
                };
            }
        },
        {
            name: 'search_similar_skus',
            description: 'Search for similar jobs in the SKU database to get accurate pricing',
            parameters: {
                type: 'object',
                properties: {
                    keywords: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Keywords to search for'
                    }
                },
                required: ['keywords']
            },
            handler: async (args) => {
                const { keywords } = args as { keywords: string[] };
                return await searchSKUs(keywords);
            }
        },
        {
            name: 'calculate_complexity',
            description: 'Assess job complexity based on details',
            parameters: {
                type: 'object',
                properties: {
                    factors: {
                        type: 'object',
                        properties: {
                            multipleTradeSkills: { type: 'boolean' },
                            specialEquipment: { type: 'boolean' },
                            accessDifficulty: { type: 'boolean' },
                            partsRequired: { type: 'boolean' },
                            estimatedHours: { type: 'number' }
                        }
                    }
                },
                required: ['factors']
            },
            handler: async (args) => {
                const { factors } = args as {
                    factors: {
                        multipleTradeSkills?: boolean;
                        specialEquipment?: boolean;
                        accessDifficulty?: boolean;
                        partsRequired?: boolean;
                        estimatedHours?: number;
                    };
                };

                let complexity = 'simple';
                let riskScore = 0;

                if (factors.multipleTradeSkills) riskScore += 2;
                if (factors.specialEquipment) riskScore += 1;
                if (factors.accessDifficulty) riskScore += 1;
                if (factors.partsRequired) riskScore += 1;
                if ((factors.estimatedHours || 0) > 4) riskScore += 2;

                if (riskScore >= 4) complexity = 'complex';
                else if (riskScore >= 2) complexity = 'medium';

                return { complexity, riskScore, factors };
            }
        },
        {
            name: 'ready_for_dispatch',
            description: 'Triage complete, ready for dispatch decision',
            parameters: {
                type: 'object',
                properties: {
                    category: { type: 'string' },
                    urgency: { type: 'string' },
                    estimate: {
                        type: 'object',
                        properties: {
                            lowPricePence: { type: 'number' },
                            highPricePence: { type: 'number' },
                            midPricePence: { type: 'number' },
                            confidence: { type: 'number' }
                        }
                    },
                    recommendation: {
                        type: 'string',
                        enum: ['auto_dispatch', 'request_approval', 'escalate_admin']
                    },
                    notes: { type: 'string' }
                },
                required: ['category', 'urgency', 'estimate', 'recommendation']
            },
            handler: async (args) => {
                console.log('[TriageWorker] Triage complete:', args);
                return {
                    handoff: 'DISPATCH_WORKER',
                    triageResult: args
                };
            }
        }
    ];
}

/**
 * Search SKUs by keywords
 */
async function searchSKUs(keywords: string[]): Promise<{
    matches: Array<{ name: string; pricePence: number; category: string }>;
    found: boolean;
}> {
    try {
        const conditions = keywords.map(kw =>
            or(
                ilike(productizedServices.name, `%${kw}%`),
                ilike(productizedServices.description, `%${kw}%`),
                sql`${kw} = ANY(${productizedServices.keywords})`
            )
        );

        const results = await db.select({
            name: productizedServices.name,
            pricePence: productizedServices.pricePence,
            category: productizedServices.category
        })
        .from(productizedServices)
        .where(or(...conditions))
        .limit(5);

        return {
            matches: results.map(r => ({
                name: r.name,
                pricePence: r.pricePence,
                category: r.category || 'general'
            })),
            found: results.length > 0
        };
    } catch (error) {
        console.error('[TriageWorker] SKU search error:', error);
        return { matches: [], found: false };
    }
}

/**
 * Estimate price based on description and category
 */
async function estimatePrice(description: string, category: string): Promise<PriceEstimate> {
    // Try to find matching SKUs first
    const words = description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const skuResults = await searchSKUs(words.slice(0, 5));

    if (skuResults.found && skuResults.matches.length > 0) {
        const prices = skuResults.matches.map(m => m.pricePence);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

        return {
            lowPricePence: Math.round(minPrice * 0.9),
            highPricePence: Math.round(maxPrice * 1.1),
            midPricePence: Math.round(avgPrice),
            confidence: 80,
            matchedSkus: skuResults.matches.map(m => m.name)
        };
    }

    // Fallback to category-based pricing
    const categoryPricing: Record<string, { low: number; mid: number; high: number }> = {
        plumbing: { low: 7500, mid: 12000, high: 20000 },
        plumbing_emergency: { low: 12000, mid: 18000, high: 30000 },
        electrical: { low: 8000, mid: 15000, high: 25000 },
        electrical_emergency: { low: 15000, mid: 22000, high: 35000 },
        heating: { low: 10000, mid: 20000, high: 35000 },
        carpentry: { low: 6000, mid: 10000, high: 18000 },
        locksmith: { low: 8000, mid: 12000, high: 20000 },
        security: { low: 10000, mid: 15000, high: 25000 },
        water_leak: { low: 10000, mid: 18000, high: 30000 },
        appliance: { low: 8000, mid: 15000, high: 25000 },
        cosmetic: { low: 5000, mid: 8000, high: 15000 },
        upgrade: { low: 15000, mid: 30000, high: 50000 },
        pest_control: { low: 10000, mid: 15000, high: 25000 },
        cleaning: { low: 5000, mid: 10000, high: 15000 },
        garden: { low: 8000, mid: 15000, high: 25000 },
        general: { low: 6000, mid: 10000, high: 18000 },
        other: { low: 8000, mid: 15000, high: 25000 }
    };

    const pricing = categoryPricing[category] || categoryPricing.general;

    return {
        lowPricePence: pricing.low,
        highPricePence: pricing.high,
        midPricePence: pricing.mid,
        confidence: 50 // Lower confidence for category-based estimates
    };
}

/**
 * Get recommended action based on category, urgency, and estimate
 */
function getRecommendedAction(
    category: string,
    urgency: string,
    estimate: PriceEstimate
): 'auto_dispatch' | 'request_approval' | 'escalate_admin' {
    // Emergency always auto-dispatch
    if (urgency === 'emergency') {
        return 'auto_dispatch';
    }

    // Emergency categories auto-dispatch
    const emergencyCategories = ['plumbing_emergency', 'electrical_emergency', 'water_leak', 'security'];
    if (emergencyCategories.includes(category)) {
        return 'auto_dispatch';
    }

    // Low confidence or high price = request approval
    if (estimate.confidence < 60 || estimate.midPricePence > 30000) {
        return 'request_approval';
    }

    // Under £150 with good confidence = auto-dispatch
    if (estimate.midPricePence <= 15000 && estimate.confidence >= 70) {
        return 'auto_dispatch';
    }

    // Default = request approval
    return 'request_approval';
}
