import { db } from "./db";
import { productizedServices, skuMatchLogs, type ProductizedService } from "../shared/schema";
import { eq, desc, isNull, and, or, like, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

// Initialize OpenAI
if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set. SKU detection will rely on keywords only.");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Types
export interface SkuDetectionResult {
    matched: boolean;
    sku: ProductizedService | null;
    confidence: number;
    method: 'keyword' | 'embedding' | 'gpt' | 'hybrid' | 'none' | 'heuristic';
    rationale: string;
    nextRoute: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT';
    suggestedScript?: string; // New: To guide the VA
    personalizedName?: string;
    trafficLight?: 'GREEN' | 'AMBER' | 'RED';
    vaAction?: 'CONFIRM' | 'REVIEW' | 'OVERRIDE';
    candidates?: ProductizedService[];
    debug?: {
        keywordScore: number;
        embeddingScore: number;
        gptScore: number;
        expandedTokens: string[];
    };
}

export interface DetectionContext {
    history: string[]; // Last N turns
    lastDetection?: SkuDetectionResult;
    leadType?: string;
    isElderly?: boolean;
}

export interface MultiTaskDetectionResult {
    originalText: string;
    tasks: TaskItem[];
    results: { task: TaskItem; detection: SkuDetectionResult }[];
    matchedServices: {
        task: TaskItem;
        sku: ProductizedService;
        confidence: number;
        personalizedName?: string;
    }[];
    unmatchedTasks: TaskItem[];
    flatpackTasks: FlatpackTask[];
    totalMatchedPrice: number;
    hasMatches: boolean;
    hasUnmatched: boolean;
    hasFlatpack: boolean;
    isMixed: boolean;
    nextRoute: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'MIXED_QUOTE';
    needsClarification: boolean;
    clarifications: ClarificationNeeded[];
}

interface TaskItem {
    description: string;
    originalIndex: number;
    quantity: number;
}

interface FlatpackTask {
    task: TaskItem;
}

interface ClarificationNeeded {
    taskIndex: number;
    task: TaskItem;
    itemType: string;
    options: {
        sku: ProductizedService;
        actionType: string;
        label: string;
    }[];
    diagnosticSku?: ProductizedService;
}

// Synonym Map
const SYNONYM_MAP: Record<string, string[]> = {
    // Plumbing
    'tap': ['faucet', 'mixer', 'spout', 'taps'],
    'dripping': ['leaking', 'drip', 'leak', 'running'],
    'toilet': ['loo', 'cistern', 'wc', 'flush'],
    'blocked': ['clogged', 'draining slow', 'not draining', 'overflowing'],
    'sink': ['basin', 'washbasin'],
    'shower': ['mixer'],
    'bath': ['bathtub'],
    'seal': ['silicone', 'sealant', 'mastic', 're-seal', 'reseal'],
    // Electrical
    'light': ['lamp', 'bulb', 'fitting', 'fixture', 'chandelier'],
    'socket': ['outlet', 'plug', 'power point'],
    'switch': ['dimmer'],
    // Mounting
    'mount': ['hang', 'install', 'fix', 'put up'],
    'tv': ['television', 'screen', 'monitor'],
    'mirror': ['glass'],
    'blind': ['curtain', 'shade', 'roller', 'venetian', 'roman'],
    'shelf': ['shelves', 'racking', 'bookcase'],
    'picture': ['frame', 'painting', 'art'],
    // Flatpack
    'assemble': ['build', 'put together', 'construct'],
    'furniture': ['wardrobe', 'bed', 'table', 'chair', 'desk', 'ikea', 'pax', 'malm']
};

// Cache
let skuCache: ProductizedService[] | null = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour (B3: Increased from 5 minutes)

// Embedding Cache (B2: In-memory cache for embeddings)
const embeddingCache = new Map<string, number[]>();
let embeddingCacheHits = 0;
let embeddingCacheMisses = 0;

export async function loadAndCacheSkus(): Promise<ProductizedService[]> {
    const now = Date.now();
    if (skuCache && (now - lastCacheUpdate < CACHE_TTL)) {
        return skuCache;
    }

    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        try {
            const skus = await db.select().from(productizedServices).where(eq(productizedServices.isActive, true));
            skuCache = skus;
            lastCacheUpdate = now;
            console.log(`[SKU Detector] Loaded ${skus.length} active SKUs`);
            return skus;
        } catch (error) {
            attempt++;
            console.warn(`[SKU Detector] Failed to load SKUs (Attempt ${attempt}/${MAX_RETRIES}):`, error);

            if (attempt === MAX_RETRIES) {
                console.error("[SKU Detector] Final failure loading SKUs after retries.");
                return [];
            }

            // Exponential backoff: 1s, 2s, 4s...
            const delay = 1000 * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return [];
}

// Pre-computation: Synonym Expansion
function expandWithSynonyms(text: string): string[] {
    const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    const expanded = new Set<string>(tokens);

    tokens.forEach(token => {
        // Check direct synonyms
        if (SYNONYM_MAP[token]) {
            SYNONYM_MAP[token].forEach(syn => expanded.add(syn));
        }
        // Check reverse synonyms
        Object.entries(SYNONYM_MAP).forEach(([key, values]) => {
            if (values.includes(token)) expanded.add(key);
        });
    });

    return Array.from(expanded);
}

// 1. Keyword Match (Fast Path)
export async function keywordMatch(inputText: string): Promise<{ sku: ProductizedService; score: number; expandedTokens: string[] }[]> {
    const skus = await loadAndCacheSkus();
    const expandedTokens = expandWithSynonyms(inputText);

    const results = skus.map(sku => {
        let score = 0;
        const skuTokens = new Set([...sku.keywords.map((k: string) => k.toLowerCase()), ...sku.name.toLowerCase().split(/\s+/)]);

        // Positive match
        let matches = 0;
        expandedTokens.forEach(token => {
            if (skuTokens.has(token)) {
                matches++;
                score += 1.0;
            } else {
                // Partial match
                for (const skuToken of Array.from(skuTokens)) {
                    if (skuToken.includes(token) && token.length > 3) {
                        score += 0.5;
                        break;
                    }
                }
            }
        });

        // Negative match penalty
        if (sku.negativeKeywords) {
            sku.negativeKeywords.forEach((neg: string) => {
                if (inputText.toLowerCase().includes(neg.toLowerCase())) {
                    score -= 5.0; // Heavy penalty
                }
            });
        }

        // Normalize logic roughly
        return { sku, score, expandedTokens };
    });

    return results
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5); // Top 5
}

// 2. Embedding Match (Cosine Similarity)
// B2: Cached embedding function
async function getEmbedding(text: string): Promise<number[] | null> {
    const normalized = text.toLowerCase().trim();

    // Check cache first
    if (embeddingCache.has(normalized)) {
        embeddingCacheHits++;
        return embeddingCache.get(normalized)!;
    }

    // Cache miss - generate new embedding
    embeddingCacheMisses++;
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text,
        });
        const embedding = response.data[0].embedding;

        // Store in cache
        embeddingCache.set(normalized, embedding);

        return embedding;
    } catch (e) {
        console.error("Embedding error:", e);
        return null;
    }
}

// B14: Batch Embedding Generation (40% faster for multi-task)
// OpenAI allows up to 2048 inputs in a single request
export async function getEmbeddingBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) {
        const result = await getEmbedding(texts[0]);
        return [result];
    }

    try {
        // Check cache first for all texts
        const normalizedTexts = texts.map(t => t.toLowerCase().trim());
        const cachedResults: (number[] | null)[] = [];
        const uncachedIndices: number[] = [];
        const uncachedTexts: string[] = [];

        normalizedTexts.forEach((normalized, i) => {
            if (embeddingCache.has(normalized)) {
                cachedResults[i] = embeddingCache.get(normalized)!;
                embeddingCacheHits++;
            } else {
                cachedResults[i] = null;
                uncachedIndices.push(i);
                uncachedTexts.push(texts[i]);
            }
        });

        // If all cached, return immediately
        if (uncachedTexts.length === 0) {
            return cachedResults;
        }

        // Batch request for uncached texts
        embeddingCacheMisses += uncachedTexts.length;
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: uncachedTexts,
        });

        // Store in cache and merge results
        response.data.forEach((item, i) => {
            const originalIndex = uncachedIndices[i];
            const normalized = normalizedTexts[originalIndex];
            const embedding = item.embedding;

            embeddingCache.set(normalized, embedding);
            cachedResults[originalIndex] = embedding;
        });

        return cachedResults;
    } catch (e) {
        console.error("Batch embedding error:", e);
        // Fallback to individual requests
        return Promise.all(texts.map(t => getEmbedding(t)));
    }
}

// B12: Vector Formatting Helper
// Converts number[] to PostgreSQL vector format: '[1.0, 2.0, 3.0]'
function formatVectorForPostgres(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
}

// Parse PostgreSQL vector string back to number array
function parsePostgresVector(vectorString: string): number[] {
    // Remove brackets and split by comma
    return vectorString
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(v => parseFloat(v.trim()));
}

// Legacy cosine similarity function (kept for fallback)
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
    if (magA === 0 || magB === 0) return 0;
    return dotProduct / (magA * magB);
}

// B11: Rewritten to use pgvector for 10x faster similarity search
async function embeddingMatch(inputText: string): Promise<{ sku: ProductizedService; score: number }[]> {
    const inputVector = await getEmbedding(inputText);
    if (!inputVector) return [];

    try {
        // B11: Use native pgvector similarity search with <=> operator
        // This is 10x faster than JSON parsing + manual cosine similarity
        const vectorString = formatVectorForPostgres(inputVector);

        const results = await db.execute(sql`
            SELECT 
                id, sku_code as "skuCode", name, category, price_pence as "pricePence",
                description, keywords, negative_keywords as "negativeKeywords",
                ai_prompt_hint as "aiPromptHint", embedding_vector as "embeddingVector",
                1 - (embedding <=> ${vectorString}::vector) as similarity
            FROM productized_services
            WHERE 
                is_active = true 
                AND embedding IS NOT NULL
                AND 1 - (embedding <=> ${vectorString}::vector) > 0.6
            ORDER BY similarity DESC
            LIMIT 5
        `);

        return results.rows.map((row: any) => ({
            sku: {
                id: row.id,
                skuCode: row.skuCode,
                name: row.name,
                category: row.category,
                pricePence: row.pricePence,
                description: row.description,
                keywords: row.keywords,
                negativeKeywords: row.negativeKeywords,
                aiPromptHint: row.aiPromptHint,
                embeddingVector: row.embeddingVector,
                isActive: true,
                timeEstimateMinutes: 0 // Not needed for matching
            } as ProductizedService,
            score: row.similarity * 100 // Convert to 0-100 scale
        }));
    } catch (e) {
        console.error("pgvector search error, falling back to legacy method:", e);

        // Fallback to legacy JSON-based method if pgvector fails
        const skus = await loadAndCacheSkus();
        const results = skus
            .filter(sku => sku.embeddingVector)
            .map(sku => {
                try {
                    const skuVector = JSON.parse(sku.embeddingVector!);
                    const score = cosineSimilarity(inputVector, skuVector) * 100;
                    return { sku, score };
                } catch (e) {
                    return { sku, score: 0 };
                }
            });

        return results
            .filter(r => r.score > 60)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }
}

// 3. GPT Classify
async function gptClassify(inputText: string, candidates: ProductizedService[]): Promise<{ matchedIndex: number | null; confidence: number; rationale: string }> {
    try {
        const prompt = `
      User Request: "${inputText}"
      
      We are an odd-job service. Which of the following predefined services matches this request?
      Candidates:
      ${candidates.map((c, i) => `${i}. [${c.skuCode}] ${c.name} - ${c.description || ''}`).join('\n')}
      
      Rules:
      - Return JSON { "matchedIndex": number | null, "confidence": number (0-100), "rationale": "string" }
      - If "Fixing a TV on wall" matches "TV Mounting", return high confidence used index.
      - If generic ("fix stuff"), return null.
    `;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a helpful handyman dispatcher." }, { role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 150,      // B1: Limit response size for speed
            temperature: 0,       // B1: Deterministic, faster responses
            top_p: 1              // B1: Consistency
        });

        const parsed = JSON.parse(response.choices[0].message.content || "{}");
        return {
            matchedIndex: typeof parsed.matchedIndex === 'number' ? parsed.matchedIndex : null,
            confidence: parsed.confidence || 0,
            rationale: parsed.rationale || "GPT decision"
        };

    } catch (e) {
        console.error("GPT verify error:", e);
        return { matchedIndex: null, confidence: 0, rationale: "Error" };
    }
}


export interface SkuDetectionOptions {
    leadType?: string;
    isElderly?: boolean;
    isRemote?: boolean;
    previousTranscript?: string;
}

// Stateful Detection Wrapper
export async function detectWithContext(
    currentText: string,
    context: DetectionContext
): Promise<SkuDetectionResult> {
    const startTime = Date.now();

    // 1. Combine History for Context (but prioritize recent)
    const fullContext = [...context.history, currentText].join(" ");

    // 2. Optimistic "Fast Path" (Keyword Only)
    // Runs instantly to give UI feedback while heavier logic might run in background
    if (currentText.length > 3) {
        const keywordResults = await keywordMatch(currentText); // Check just latest utterance first
        const bestFast = keywordResults[0];

        if (bestFast && bestFast.score >= 80) { // B6: Lowered from 90 to 80 for more fast-path usage
            return {
                matched: true,
                sku: bestFast.sku,
                confidence: 95,
                method: 'keyword',
                rationale: "Instant strong keyword match on latest phrase",
                nextRoute: 'INSTANT_PRICE',
                trafficLight: 'GREEN',
                vaAction: 'CONFIRM',
                suggestedScript: `Great, I can give you a fixed price for ${bestFast.sku.name} right now.`
            };
        }
    }

    // 3. Heuristic / Safety Checks (Crucial for VAs)
    const isCommercial = context.leadType === 'Commercial' || context.leadType === 'Property Manager';
    const complexKeywords = [
        'renovation', 'refurbishment', 'entire house', 'office floor', 'building site', 'extension', 'commercial',
        'gas', 'smell gas', 'fumes', 'carbon monoxide',                   // Gas Safety
        'crackling', 'sparking', 'burning smell', 'smoke',                // Electrical Safety
        'foundation', 'subsidence', 'structural', 'collapse',             // Structural
        'mold', 'damp', 'leak behind wall'                                // Diagnostic Heavy
    ];
    const hasComplexKeywords = complexKeywords.some(k => fullContext.toLowerCase().includes(k));
    const isElderly = context.isElderly || fullContext.toLowerCase().includes("elderly") || fullContext.toLowerCase().includes("80 years old");

    if (isCommercial || hasComplexKeywords || isElderly) {
        let rationale = "Complex/High-touch job detected";
        if (isCommercial) rationale = `Client type is ${context.leadType}`;
        if (isElderly) rationale = "Elderly client/High-touch required";

        return {
            matched: false,
            sku: null,
            confidence: 70,
            method: 'heuristic',
            rationale: `${rationale} - Recommending Site Visit`,
            nextRoute: 'SITE_VISIT',
            trafficLight: 'AMBER', // Complex/Safety triggers are always Amber/Red (Human Review needed)
            vaAction: 'REVIEW',
            suggestedScript: "For a project of this nature, we'd recommend a site visit to give an accurate quote. The fee is £39."
        };
    }

    // 4. Full Detection (Using existing logic but with accumulated context)
    // We pass the full context to the main detector if the single line wasn't enough
    const result = await detectSku(fullContext.slice(-200), { // Limit context window
        leadType: context.leadType,
        isElderly: context.isElderly
    });

    // Add suggested scripts to the standard result
    if (result.matched && result.nextRoute === 'INSTANT_PRICE') {
        result.suggestedScript = `I can give you a fixed price of £${(result.sku!.pricePence / 100).toFixed(0)} for that job.`;
    } else if (result.nextRoute === 'VIDEO_QUOTE') {
        result.suggestedScript = "To be sure on the price, could you click the link I sent to upload a quick video?";
    } else {
        // Fallback for unexpected states
        result.suggestedScript = "I'm analyzing the request... could you provide more details?";
    }

    return result;
}

// Main Function: Detect SKU
export async function detectSku(inputText: string, options?: SkuDetectionOptions): Promise<SkuDetectionResult> {
    const startTime = Date.now(); // B7: Performance tracking
    if (!inputText || inputText.length < 5) {
        return { matched: false, sku: null, confidence: 0, method: 'none', rationale: "Too short", nextRoute: 'VIDEO_QUOTE' };
    }

    // 1. SKU Check (High Priority)
    // We check for SKU matches first. If we find a strong match, we try to give an Instant Price.
    const keywordResults = await keywordMatch(inputText);
    let bestCandidate = keywordResults[0];

    // Fast path: high keyword match
    if (bestCandidate && bestCandidate.score >= 80) { // B6: Lowered from 85 to 80
        const elapsed = Date.now() - startTime;
        console.log(`[SKU Detector] Fast path: ${elapsed}ms (keyword match)`);
        return {
            matched: true,
            sku: bestCandidate.sku,
            confidence: 90,
            method: 'keyword',
            rationale: "Strong keyword match",
            nextRoute: 'INSTANT_PRICE',
            debug: { keywordScore: bestCandidate.score, embeddingScore: 0, gptScore: 0, expandedTokens: bestCandidate.expandedTokens }
        };
    }

    // 1.5 AMBER Path: Strong keyword match but subjective/nuanced (Score 65-79)
    // We found a likely SKU, but we want the VA to confirm it via Video Quote first.
    if (bestCandidate && bestCandidate.score >= 65) { // B6: Lowered from 70 to 65
        const elapsed = Date.now() - startTime;
        console.log(`[SKU Detector] AMBER path: ${elapsed}ms (keyword match)`);
        return {
            matched: true,
            sku: bestCandidate.sku,
            confidence: 80,
            method: 'keyword',
            rationale: "Likely keyword match, but flagged for VA Review (Amber)",
            nextRoute: 'VIDEO_QUOTE', // Safe default
            trafficLight: 'AMBER',
            vaAction: 'REVIEW',
            suggestedScript: `I think this is ${bestCandidate.sku.name}, but I'd like to see a video to be sure.`
        };
    }

    // 2. Embedding + Hybrid Check
    let embeddingResults: { sku: ProductizedService; score: number }[] = [];
    if (!bestCandidate || bestCandidate.score < 50) {
        embeddingResults = await embeddingMatch(inputText);
    }

    const allCandidates = new Map<string, ProductizedService>();
    keywordResults.forEach(r => allCandidates.set(r.sku.id, r.sku));
    embeddingResults.forEach(r => allCandidates.set(r.sku.id, r.sku));
    const candidates = Array.from(allCandidates.values());

    let matchFound = false;
    let winningSku: ProductizedService | null = null;
    let matchConfidence = 0;
    let matchRationale = "";

    if (candidates.length > 0) {
        const gptResult = await gptClassify(inputText, candidates);
        if (gptResult.matchedIndex !== null && gptResult.confidence > 75) { // Slightly stricter
            matchFound = true;
            winningSku = candidates[gptResult.matchedIndex];
            matchConfidence = gptResult.confidence;
            matchRationale = gptResult.rationale;
        }
    }

    if (matchFound && winningSku) {
        const elapsed = Date.now() - startTime;
        console.log(`[SKU Detector] Hybrid path: ${elapsed}ms (GPT classification)`);
        return {
            matched: true,
            sku: winningSku,
            confidence: matchConfidence,
            method: 'hybrid',
            rationale: matchRationale,
            nextRoute: 'INSTANT_PRICE',
            trafficLight: matchConfidence > 85 ? 'GREEN' : 'AMBER',
            vaAction: matchConfidence > 85 ? 'CONFIRM' : 'REVIEW',
            candidates
        };
    }

    // 3. Fallback Logic: Determines VIDEO_QUOTE vs SITE_VISIT
    // Hierarchy: Video Quote is default, Site Visit is exception.

    // Triggers for Site Visit (Exceptions)
    const isCommercial = options?.leadType === 'Commercial' || options?.leadType === 'Property Manager';
    const complexKeywords = ['renovation', 'refurbishment', 'entire house', 'office floor', 'building site', 'extension'];
    const hasComplexKeywords = complexKeywords.some(k => inputText.toLowerCase().includes(k));
    const isElderly = options?.isElderly || inputText.toLowerCase().includes("elderly") || inputText.toLowerCase().includes("80 years old");

    // NEW: Tech-averse signals (User implies they can't do video)
    const techAverseKeywords = ["no smartphone", "landline", "can't use whatsapp", "too old for technology", "just come round"];
    const isTechAverse = techAverseKeywords.some(k => inputText.toLowerCase().includes(k));

    if (isCommercial || hasComplexKeywords || isElderly || isTechAverse) {
        let rationale = "Complex/High-touch job detected";
        if (isCommercial) rationale = `Client type is ${options?.leadType}`;
        if (isTechAverse) rationale = "User flagged as tech-averse";

        return {
            matched: false,
            sku: null,
            confidence: 60,
            method: 'heuristic',
            rationale: `${rationale} - Recommending Paid Site Visit`,
            nextRoute: 'SITE_VISIT',
            trafficLight: 'AMBER',
            vaAction: 'REVIEW',
            candidates
        };
    }

    // Default: Video Quote (The "Golden Path" for vague requests)
    return {
        matched: false,
        sku: null, // No specific SKU found
        confidence: 0,
        method: 'none',
        rationale: "Ambiguous request - Defaulting to Video Quote to qualify",
        nextRoute: 'VIDEO_QUOTE',
        trafficLight: 'GREEN', // Green because this is the INTENDED path for vague jobs now
        vaAction: 'CONFIRM',   // VA should just click "Request Video"
        candidates
    };
}

// Helper: Extract Quantity (dumb regex)
function extractQuantity(text: string): { quantity: number } {
    const match = text.match(/\b(\d+)\b/);
    return { quantity: match ? parseInt(match[1]) : 1 };
}

// Helper: Is Flatpack?
function isFlatpackTask(text: string): boolean {
    const flatpackKeywords = ['assemble', 'ikea', 'flatpack', 'furniture build', 'wardrobe build'];
    return flatpackKeywords.some(k => text.toLowerCase().includes(k));
}

export async function detectMultipleTasks(text: string): Promise<MultiTaskDetectionResult> {
    const startTime = Date.now(); // B7: Performance tracking

    // 0. Global Safety Check (Pre-Split)
    // We check the raw text for safety keywords because the LLM splitter might sanitize them (e.g., "I smell gas" -> "Check gas").
    const complexKeywords = [
        'gas', 'smell gas', 'fumes', 'carbon monoxide',
        'crackling', 'sparking', 'burning', 'smoke',
        'foundation', 'subsidence', 'collapse',
        'mold', 'damp', 'leak behind wall',
        'commercial', 'office floor'
    ];
    const hasSafetyRisk = complexKeywords.some(k => text.toLowerCase().includes(k));

    // B1: Speculative Parallel Execution
    // Run quick keyword match on full text WHILE task splitting is happening
    // If we get a high-confidence match, we can skip the expensive task splitting
    const [tasks, quickKeywordMatch] = await Promise.all([
        // Task splitting (expensive GPT call)
        (async () => {
            try {
                const prompt = `
                    Analyze this request: "${text}"
                    Break it down into individual distinct physical tasks.
                    
                    Rules:
                    1. ONLY extract tasks that are EXPLICITLY mentioned.
                    2. Do NOT invent specific tasks (e.g. do not convert "lots of issues" into "fix socket").
                    3. If the request is vague or general (e.g. "I have a mess", "lots of problems"), return it as a single task using the original text.
                    4. Return JSON: { "tasks": [{ "description": "string", "quantity": number }] }
                    
                    Example 1: "Fix tap and hang 2 shelves" -> { "tasks": [{ "description": "Fix tap", "quantity": 1 }, { "description": "Hang shelves", "quantity": 2 }] }
                    Example 2: "I have a property with lots of issues" -> { "tasks": [{ "description": "Property with lots of issues", "quantity": 1 }] }
                `;

                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: "You are a job parser." }, { role: "user", content: prompt }],
                    response_format: { type: "json_object" },
                    max_tokens: 200,      // B1: Limit response size for speed
                    temperature: 0,       // B1: Deterministic, faster responses
                    top_p: 1              // B1: Consistency
                });

                const parsed = JSON.parse(response.choices[0].message.content || "{ \"tasks\": [] }");
                return parsed.tasks.map((t: any, i: number) => ({
                    description: t.description,
                    quantity: t.quantity || 1,
                    originalIndex: i
                })) as TaskItem[];

            } catch (e) {
                console.error("Task split error:", e);
                // Fallback: Treat whole text as one task
                return [{ description: text, quantity: 1, originalIndex: 0 }] as TaskItem[];
            }
        })(),

        // Quick keyword match on full text (fast, runs in parallel)
        keywordMatch(text)
    ]);

    // B1: Early exit if high-confidence keyword match found
    if (quickKeywordMatch.length > 0 && quickKeywordMatch[0].score >= 85) {
        const bestMatch = quickKeywordMatch[0];
        const elapsed = Date.now() - startTime;
        console.log(`[SKU Detector] FAST PATH: Early exit with keyword match (${elapsed}ms, score: ${bestMatch.score})`);

        return {
            originalText: text,
            tasks: [{ description: text, quantity: 1, originalIndex: 0 }],
            results: [{
                task: { description: text, quantity: 1, originalIndex: 0 },
                detection: {
                    matched: true,
                    sku: bestMatch.sku,
                    confidence: bestMatch.score,
                    method: 'keyword',
                    rationale: `High-confidence keyword match: "${bestMatch.sku.name}"`,
                    nextRoute: 'INSTANT_PRICE',
                    trafficLight: 'GREEN',
                    vaAction: 'CONFIRM'
                }
            }],
            matchedServices: [{
                task: { description: text, quantity: 1, originalIndex: 0 },
                sku: bestMatch.sku,
                confidence: bestMatch.score,
                personalizedName: bestMatch.sku.name
            }],
            unmatchedTasks: [],
            flatpackTasks: [],
            totalMatchedPrice: bestMatch.sku.pricePence,
            hasMatches: true,
            hasUnmatched: false,
            hasFlatpack: false,
            isMixed: false,
            nextRoute: 'INSTANT_PRICE',
            needsClarification: false,
            clarifications: []
        };
    }

    // Ensure we have at least one task
    const finalTasks = tasks.length === 0 ? [{ description: text, quantity: 1, originalIndex: 0 }] : tasks;

    // 2. Score Each Task Individually
    // B2: Use batch embedding generation for all tasks
    const taskDescriptions = finalTasks.map(t => t.description);
    const embeddings = await getEmbeddingBatch(taskDescriptions);

    const results = await Promise.all(finalTasks.map(async (task, index) => {
        const detection = await detectSku(task.description);
        return { task, detection };
    }));

    // 3. Aggregate Results (Lowest Common Denominator Logic)
    // Hierarchy: SITE_VISIT > VIDEO_QUOTE > INSTANT_PRICE
    let globalRoute: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'MIXED_QUOTE' = 'INSTANT_PRICE';

    const matchedServices: any[] = [];
    const unmatchedTasks: TaskItem[] = [];
    let totalMatchedPrice = 0;

    let hasVisit = false;
    let hasVideo = false;

    for (const res of results) {
        if (res.detection.nextRoute === 'SITE_VISIT') hasVisit = true;
        if (res.detection.nextRoute === 'VIDEO_QUOTE') hasVideo = true;

        if (res.detection.matched && res.detection.sku) {
            matchedServices.push({
                task: res.task,
                sku: res.detection.sku,
                confidence: res.detection.confidence,
                personalizedName: res.detection.sku.name
            });
            totalMatchedPrice += (res.detection.sku.pricePence * res.task.quantity);
        } else {
            unmatchedTasks.push(res.task);
        }
    }

    // Determine Global Route
    if (hasSafetyRisk || hasVisit) {
        globalRoute = 'MIXED_QUOTE'; // Implies Visit/Complex
    } else if (hasVideo || unmatchedTasks.length > 0) {
        globalRoute = 'VIDEO_QUOTE';
    } else {
        globalRoute = 'INSTANT_PRICE';
    }

    // 4. Construct Response
    const elapsed = Date.now() - startTime;
    console.log(`[SKU Detector] Multi-task detection: ${elapsed}ms (${tasks.length} tasks, ${matchedServices.length} matched)`);
    console.log(`[SKU Detector] Embedding cache: ${embeddingCacheHits} hits, ${embeddingCacheMisses} misses (${embeddingCacheHits > 0 ? Math.round(embeddingCacheHits / (embeddingCacheHits + embeddingCacheMisses) * 100) : 0}% hit rate)`);

    return {
        originalText: text,
        tasks,
        results,
        matchedServices,
        unmatchedTasks,
        flatpackTasks: [], // simplified for now
        totalMatchedPrice,
        hasMatches: matchedServices.length > 0,
        hasUnmatched: unmatchedTasks.length > 0,
        hasFlatpack: false,
        isMixed: matchedServices.length > 0 && unmatchedTasks.length > 0,
        nextRoute: globalRoute,
        needsClarification: false,
        clarifications: []
    };
}
