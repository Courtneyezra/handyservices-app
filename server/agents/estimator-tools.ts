/**
 * Estimator Tools — the 5 tools the quote estimator agent uses to research
 * materials, time, procedures, and submit the final build.
 */
import { db } from '../db';
import { personalizedQuotes, contractorBookingRequests, diyAdvice } from '@shared/schema';
import { searchCatalog, searchScrewfix } from '../materials-service';
import { getAnthropic } from '../anthropic';
import { eq, sql, desc, or, and } from 'drizzle-orm';
import type { AgentTool } from './runner';
import type {
    QuoteBuild,
    EstimatedLine,
    EstimatedMaterial,
    TimeEstimate,
} from '@shared/quote-build';

const ESTIMATOR_VERSION = '1.0.0';

/** Material search result with provenance flag. */
interface MaterialSearchResultWithFlag {
    name: string;
    qty?: number;
    unitPricePence?: number;
    unitPriceIncVatPence?: number;
    imageUrl?: string;
    supplier: 'catalog' | 'screwfix' | 'web' | 'model';
    supplierItemNumber?: string;
    supplierUrl?: string;
    catalogId?: string;
    fromCatalog: boolean;
    needsReview: boolean;
    sourceNote?: string;
}

/**
 * search_materials — catalog-first, then Screwfix, dedupe by supplierItemNumber.
 */
async function searchMaterials(input: { query: string; limit?: number }): Promise<MaterialSearchResultWithFlag[]> {
    const limit = input.limit ?? 8;

    // Search both sources in parallel
    const [catalogResults, screwfixResults] = await Promise.all([
        searchCatalog(input.query, limit),
        searchScrewfix(input.query),
    ]);

    // Build dedupe set from catalog items (they take priority)
    const seen = new Set<string>();
    const results: MaterialSearchResultWithFlag[] = [];

    // Catalog first (verified, instant, free)
    for (const item of catalogResults) {
        if (item.supplierItemNumber) seen.add(item.supplierItemNumber);
        results.push({
            name: item.name,
            unitPricePence: item.pricePenceExVat,
            unitPriceIncVatPence: item.pricePenceIncVat,
            imageUrl: item.imageUrl,
            supplier: 'catalog',
            supplierItemNumber: item.supplierItemNumber,
            supplierUrl: item.supplierUrl,
            catalogId: item.catalogId,
            fromCatalog: true,
            needsReview: false,
            sourceNote: 'From our catalog (verified price)',
        });
    }

    // Then Screwfix (live, verified)
    for (const item of screwfixResults) {
        if (item.supplierItemNumber && seen.has(item.supplierItemNumber)) continue;
        if (item.supplierItemNumber) seen.add(item.supplierItemNumber);
        results.push({
            name: item.name,
            unitPricePence: item.pricePenceExVat,
            unitPriceIncVatPence: item.pricePenceIncVat,
            imageUrl: item.imageUrl,
            supplier: 'screwfix',
            supplierItemNumber: item.supplierItemNumber,
            supplierUrl: item.supplierUrl,
            fromCatalog: false,
            needsReview: false,
            sourceNote: 'Live Screwfix price',
        });
    }

    return results.slice(0, limit);
}

/**
 * search_web — uses Anthropic client with native web_search server tool.
 */
async function searchWeb(input: { query: string }): Promise<{ summary: string; sources: { title: string; url: string }[] }> {
    const client = getAnthropic();

    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: 2000,
            tools: [
                {
                    type: 'web_search_20260318' as any,
                    name: 'web_search',
                    max_uses: 3,
                } as any,
            ],
            messages: [
                {
                    role: 'user',
                    content: `Search for: ${input.query}\n\nReturn a brief summary of what you found, focusing on prices, specifications, or availability. Include source URLs.`,
                },
            ],
        });

        // Extract text and any sources from the response
        let summary = '';
        const sources: { title: string; url: string }[] = [];

        for (const block of response.content) {
            if (block.type === 'text') {
                summary += block.text;
            }
            // Web search results may include citations
            if ((block as any).type === 'web_search_tool_result') {
                const results = (block as any).content || [];
                for (const result of results) {
                    if (result.url && result.title) {
                        sources.push({ title: result.title, url: result.url });
                    }
                }
            }
        }

        return { summary: summary || 'No results found', sources };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Estimator] Web search failed:', msg);
        return { summary: `Web search failed: ${msg}`, sources: [] };
    }
}

/**
 * get_time_history — queries historical quotes and actuals for similar jobs.
 */
async function getTimeHistory(input: { category: string; keywords: string[] }): Promise<{
    estimates: { minutes: number; source: 'quote' | 'actual' }[];
    avgMinutes: number;
    confidence: 'high' | 'medium' | 'low';
}> {
    const estimates: { minutes: number; source: 'quote' | 'actual' }[] = [];

    try {
        // Build keyword search pattern
        const keywordPatterns = input.keywords.map((k) => `%${k.toLowerCase()}%`);

        // Query quotes with similar job descriptions
        // Use ILIKE fallback (pg_trgm similarity would be better but may not exist)
        const likeConditions = keywordPatterns.map((pattern) =>
            sql`LOWER(${personalizedQuotes.jobDescription}) LIKE ${pattern}`
        );

        const quotes = await db
            .select({
                id: personalizedQuotes.id,
                jobDescription: personalizedQuotes.jobDescription,
                pricingLineItems: personalizedQuotes.pricingLineItems,
            })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.pricingLineItems} IS NOT NULL`,
                    likeConditions.length > 0 ? or(...likeConditions) : sql`1=1`
                )
            )
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(20);

        // Extract time estimates from pricing line items
        for (const quote of quotes) {
            const lineItems = quote.pricingLineItems as any;
            if (!lineItems || !Array.isArray(lineItems)) continue;

            for (const item of lineItems) {
                // Line items may have timeMinutes or estimatedMinutes
                const mins = item?.timeMinutes ?? item?.estimatedMinutes ?? item?.minutes;
                if (typeof mins === 'number' && mins > 0) {
                    estimates.push({ minutes: mins, source: 'quote' });
                }
            }
        }

        // Query actual job times from completed bookings
        const completedJobs = await db
            .select({
                timeOnJobSeconds: contractorBookingRequests.timeOnJobSeconds,
                description: contractorBookingRequests.description,
            })
            .from(contractorBookingRequests)
            .where(
                and(
                    sql`${contractorBookingRequests.timeOnJobSeconds} IS NOT NULL`,
                    sql`${contractorBookingRequests.timeOnJobSeconds} > 0`,
                    likeConditions.length > 0
                        ? or(
                              ...keywordPatterns.map(
                                  (pattern) =>
                                      sql`LOWER(${contractorBookingRequests.description}) LIKE ${pattern}`
                              )
                          )
                        : sql`1=1`
                )
            )
            .orderBy(desc(contractorBookingRequests.completedAt))
            .limit(20);

        for (const job of completedJobs) {
            if (job.timeOnJobSeconds && job.timeOnJobSeconds > 0) {
                estimates.push({
                    minutes: Math.round(job.timeOnJobSeconds / 60),
                    source: 'actual',
                });
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Estimator] Time history query failed:', msg);
    }

    // Calculate average and confidence
    const avgMinutes =
        estimates.length > 0
            ? Math.round(estimates.reduce((sum, e) => sum + e.minutes, 0) / estimates.length)
            : 0;

    // Confidence based on sample size and source mix
    const actualCount = estimates.filter((e) => e.source === 'actual').length;
    let confidence: 'high' | 'medium' | 'low' = 'low';

    if (estimates.length >= 5 && actualCount >= 2) {
        confidence = 'high';
    } else if (estimates.length >= 3 || actualCount >= 1) {
        confidence = 'medium';
    }

    return { estimates, avgMinutes, confidence };
}

/**
 * get_procedures — retrieves from diy_advice table.
 */
async function getProcedures(input: { category: string; keywords: string[] }): Promise<{
    steps: string[];
    toolsNeeded: string[];
    warning?: string;
} | null> {
    try {
        // Check if table exists by trying a query
        const keywordPatterns = input.keywords.map((k) => `%${k.toLowerCase()}%`);

        const likeConditions = keywordPatterns.map((pattern) =>
            sql`EXISTS (SELECT 1 FROM unnest(${diyAdvice.keywords}) AS kw WHERE LOWER(kw) LIKE ${pattern})`
        );

        const results = await db
            .select({
                steps: diyAdvice.steps,
                toolsNeeded: diyAdvice.toolsNeeded,
                warning: diyAdvice.warning,
            })
            .from(diyAdvice)
            .where(
                and(
                    eq(diyAdvice.isActive, true),
                    likeConditions.length > 0 ? or(...likeConditions) : sql`1=1`
                )
            )
            .orderBy(desc(diyAdvice.priority))
            .limit(1);

        if (results.length === 0) return null;

        const advice = results[0];
        return {
            steps: (advice.steps as string[]) || [],
            toolsNeeded: (advice.toolsNeeded as string[]) || [],
            warning: advice.warning ?? undefined,
        };
    } catch (err) {
        // Table may not exist — degrade gracefully
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Estimator] Procedures query failed (table may not exist):', msg);
        return null;
    }
}

/**
 * Validates and normalizes a QuoteBuild submission.
 * Throws human-readable errors for model retry.
 */
export function normalizeQuoteBuild(input: any, conversationId?: string): QuoteBuild {
    // Validate lines array
    if (!Array.isArray(input?.lines)) {
        throw new Error('lines must be an array of EstimatedLine objects.');
    }
    if (input.lines.length === 0) {
        throw new Error('lines must contain at least one estimated line.');
    }

    const lines: EstimatedLine[] = input.lines.map((line: any, i: number) => {
        if (typeof line?.lineIndex !== 'number') {
            throw new Error(`Line ${i + 1}: lineIndex must be a number.`);
        }
        if (!line?.description || typeof line.description !== 'string') {
            throw new Error(`Line ${i + 1}: description is required.`);
        }
        if (!line?.category || typeof line.category !== 'string') {
            throw new Error(`Line ${i + 1}: category is required.`);
        }

        // Validate time estimate
        if (!line?.time || typeof line.time !== 'object') {
            throw new Error(`Line ${i + 1}: time estimate is required.`);
        }
        if (typeof line.time.minutes !== 'number' || line.time.minutes <= 0) {
            throw new Error(`Line ${i + 1}: time.minutes must be a positive number.`);
        }
        if (!['high', 'medium', 'low'].includes(line.time.confidence)) {
            throw new Error(`Line ${i + 1}: time.confidence must be 'high', 'medium', or 'low'.`);
        }
        if (!['sku', 'historical', 'model'].includes(line.time.basis)) {
            throw new Error(`Line ${i + 1}: time.basis must be 'sku', 'historical', or 'model'.`);
        }

        const time: TimeEstimate = {
            minutes: line.time.minutes,
            confidence: line.time.confidence,
            basis: line.time.basis,
            rangeMinutes: Array.isArray(line.time.rangeMinutes) ? line.time.rangeMinutes : undefined,
            note: line.time.note ?? undefined,
        };

        // Validate materials
        const materials: EstimatedMaterial[] = (Array.isArray(line.materials) ? line.materials : []).map(
            (m: any, j: number) => {
                if (!m?.name || typeof m.name !== 'string') {
                    throw new Error(`Line ${i + 1}, material ${j + 1}: name is required.`);
                }
                if (typeof m?.qty !== 'number' || m.qty <= 0) {
                    throw new Error(`Line ${i + 1}, material ${j + 1}: qty must be a positive number.`);
                }
                if (typeof m?.unitPricePence !== 'number') {
                    throw new Error(`Line ${i + 1}, material ${j + 1}: unitPricePence is required.`);
                }
                if (!['catalog', 'screwfix', 'web', 'model'].includes(m?.supplier)) {
                    throw new Error(
                        `Line ${i + 1}, material ${j + 1}: supplier must be 'catalog', 'screwfix', 'web', or 'model'.`
                    );
                }

                return {
                    name: m.name,
                    qty: m.qty,
                    unitPricePence: m.unitPricePence,
                    unitPriceIncVatPence: m.unitPriceIncVatPence ?? undefined,
                    imageUrl: m.imageUrl ?? undefined,
                    supplier: m.supplier,
                    supplierItemNumber: m.supplierItemNumber ?? undefined,
                    supplierUrl: m.supplierUrl ?? undefined,
                    catalogId: m.catalogId ?? undefined,
                    needsReview: m.needsReview ?? false,
                    sourceNote: m.sourceNote ?? undefined,
                } satisfies EstimatedMaterial;
            }
        );

        // Validate procedure
        const procedure: string[] = (Array.isArray(line.procedure) ? line.procedure : [])
            .slice(0, 6)
            .map((s: any) => String(s).trim())
            .filter(Boolean);

        // Validate assumptions
        const assumptions: string[] = (Array.isArray(line.assumptions) ? line.assumptions : [])
            .slice(0, 8)
            .map((s: any) => String(s).trim())
            .filter(Boolean);

        return {
            lineIndex: line.lineIndex,
            description: line.description,
            category: line.category,
            time,
            materials,
            procedure,
            assumptions,
            unresolved: line.unresolved ?? undefined,
        } satisfies EstimatedLine;
    });

    // Optional customer info
    const customer = input.customer
        ? {
              name: String(input.customer.name ?? '').trim(),
              phone: String(input.customer.phone ?? '').trim(),
              postcode: String(input.customer.postcode ?? '').trim(),
          }
        : undefined;

    // Quote-level notes
    const quoteNotes: string[] = (Array.isArray(input.quoteNotes) ? input.quoteNotes : [])
        .slice(0, 8)
        .map((s: any) => String(s).trim())
        .filter(Boolean);

    const unresolvedItems: string[] = (Array.isArray(input.unresolvedItems) ? input.unresolvedItems : [])
        .slice(0, 12)
        .map((s: any) => String(s).trim())
        .filter(Boolean);

    return {
        conversationId: conversationId ?? input.conversationId ?? undefined,
        customer,
        lines,
        quoteNotes: quoteNotes.length > 0 ? quoteNotes : undefined,
        unresolvedItems: unresolvedItems.length > 0 ? unresolvedItems : undefined,
        estimatorVersion: ESTIMATOR_VERSION,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Build the 5 estimator tools.
 */
export function buildEstimatorTools(opts: { conversationId?: string }): {
    tools: AgentTool[];
    getBuild: () => QuoteBuild | null;
} {
    let acceptedBuild: QuoteBuild | null = null;

    const tools: AgentTool[] = [
        {
            name: 'search_materials',
            description:
                'Search for materials by name. Returns catalog results first (instant, verified prices), then Screwfix (live, verified). Deduplicated by supplier item number. Call once per distinct material needed.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    query: {
                        type: 'string',
                        description: 'Product search query, e.g. "15mm copper pipe" or "P trap 32mm".',
                    },
                    limit: {
                        type: 'number',
                        description: 'Max results to return (default 8).',
                    },
                },
                required: ['query'],
            },
            run: searchMaterials,
        },
        {
            name: 'search_web',
            description:
                'Search the web for material prices or specifications when catalog/Screwfix has no results. Use sparingly — web prices need human review (needsReview=true). Max 3 searches per run.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    query: {
                        type: 'string',
                        description: 'Web search query, e.g. "Grohe Euroeco tap price UK".',
                    },
                },
                required: ['query'],
            },
            run: searchWeb,
        },
        {
            name: 'get_time_history',
            description:
                'Query historical data for similar jobs: past quote estimates and actual recorded job times. Returns estimates with source (quote vs actual), average minutes, and confidence level.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    category: {
                        type: 'string',
                        description: 'Job category, e.g. "plumbing_minor", "mounting", "painting".',
                    },
                    keywords: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Keywords to match against job descriptions, e.g. ["tap", "mixer", "basin"].',
                    },
                },
                required: ['category', 'keywords'],
            },
            run: getTimeHistory,
        },
        {
            name: 'get_procedures',
            description:
                'Retrieve known procedure steps and tools needed for a job type from our DIY advice database. Returns null if no matching advice found.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    category: {
                        type: 'string',
                        description: 'Job category.',
                    },
                    keywords: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Keywords to match, e.g. ["tap", "washer", "leak"].',
                    },
                },
                required: ['category', 'keywords'],
            },
            run: getProcedures,
        },
        {
            name: 'submit_build',
            description:
                'Submit the completed QuoteBuild. Call exactly once when all lines are researched. The build is validated; errors are human-readable for retry.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    customer: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            phone: { type: 'string' },
                            postcode: { type: 'string' },
                        },
                        description: 'Customer details if available.',
                    },
                    lines: {
                        type: 'array',
                        description: 'Array of EstimatedLine objects, one per intake line.',
                        items: {
                            type: 'object',
                            properties: {
                                lineIndex: { type: 'number', description: '0-based index matching intake lines.' },
                                description: { type: 'string', description: 'Line description (from intake).' },
                                category: { type: 'string', description: 'Job category.' },
                                time: {
                                    type: 'object',
                                    properties: {
                                        minutes: { type: 'number', description: 'Estimated minutes.' },
                                        confidence: {
                                            type: 'string',
                                            enum: ['high', 'medium', 'low'],
                                        },
                                        basis: {
                                            type: 'string',
                                            enum: ['sku', 'historical', 'model'],
                                        },
                                        rangeMinutes: {
                                            type: 'array',
                                            items: { type: 'number' },
                                            description: '[min, max] range if uncertain.',
                                        },
                                        note: { type: 'string', description: 'Human-readable provenance note.' },
                                    },
                                    required: ['minutes', 'confidence', 'basis'],
                                },
                                materials: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            name: { type: 'string' },
                                            qty: { type: 'number' },
                                            unitPricePence: { type: 'number' },
                                            unitPriceIncVatPence: { type: 'number' },
                                            imageUrl: { type: 'string' },
                                            supplier: {
                                                type: 'string',
                                                enum: ['catalog', 'screwfix', 'web', 'model'],
                                            },
                                            supplierItemNumber: { type: 'string' },
                                            supplierUrl: { type: 'string' },
                                            catalogId: { type: 'string' },
                                            needsReview: { type: 'boolean' },
                                            sourceNote: { type: 'string' },
                                        },
                                        required: ['name', 'qty', 'unitPricePence', 'supplier'],
                                    },
                                },
                                procedure: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: '3-6 step procedure. Format: "Verb phrase — detail".',
                                },
                                assumptions: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Price caveats for this line.',
                                },
                                unresolved: {
                                    type: 'string',
                                    description: 'Note for items that could not be found/priced.',
                                },
                            },
                            required: ['lineIndex', 'description', 'category', 'time', 'materials', 'procedure', 'assumptions'],
                        },
                    },
                    quoteNotes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Quote-level notes/caveats.',
                    },
                    unresolvedItems: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Items the agent could not resolve.',
                    },
                },
                required: ['lines'],
            },
            run: async (input: any) => {
                acceptedBuild = normalizeQuoteBuild(input, opts.conversationId);
                return { accepted: true };
            },
        },
    ];

    return {
        tools,
        getBuild: () => acceptedBuild,
    };
}
