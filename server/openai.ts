
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

// Initialize OpenAI (lazy initialization to allow testing without API key)
let _openai: OpenAI | null = null;
export function getOpenAI(): OpenAI {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY is not set. AI features require an API key.");
        }
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// Legacy export for backward compatibility
export const openai = new Proxy({} as OpenAI, {
    get(target, prop) {
        return (getOpenAI() as any)[prop];
    }
});

export interface CallMetadata {
    customerName: string | null;
    companyName?: string | null;
    address: string | null;
    postcode: string | null; // B2: UK postcode extraction
    urgency: "Critical" | "High" | "Standard" | "Low";
    leadType: "Homeowner" | "Landlord" | "Property Manager" | "Tenant" | "Unknown";
    roleMapping?: Record<number, "VA" | "Customer">; // Map Speaker ID -> Role
    nameCandidates?: Array<{
        name: string;
        confidence: number;
        reasoning: string;
    }>;
}

// NEW: Lead Classification Types for Routing Brain
export interface LeadClassification {
    clientType: 'homeowner' | 'landlord' | 'tenant' | 'commercial' | 'unknown';
    jobClarity: 'known' | 'vague' | 'complex';
    jobType: 'commodity' | 'subjective' | 'fault' | 'project';
    urgency: 'asap' | 'normal' | 'flexible';
    segment: 'BUSY_PRO' | 'PROP_MGR' | 'LANDLORD' | 'SMALL_BIZ' | 'DIY_DEFERRER' | 'BUDGET' | 'UNKNOWN';
    reasoning: string;
}

export type QuoteRoute = 'instant' | 'tiers' | 'assessment';

interface Segment {
    speaker: number;
    text: string;
}

export async function extractCallMetadata(transcription: string, segments: Segment[] = []): Promise<CallMetadata> {
    try {
        // STATE OF THE ART: Semantic Diarization & Role Analysis
        // Construct a dialogue snippet with speaker labels if available
        let context = "";

        if (segments.length > 0) {
            // Use up to 200 turns to capture names given at the end of calls
            const dialogueSnippet = segments.slice(0, 200).map(s => `Speaker ${s.speaker}: "${s.text.trim()}"`).join("\n");
            context = `DIALOGUE TRANSCRIPT:\n${dialogueSnippet}`;
        } else {
            context = `RAW TRANSCRIPT:\n${transcription}`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert call analyzer. Your goal is to extract structured data about the potential CUSTOMER.

CRITICAL: You must distinguish the "Service Provider/Agent" (answering the phone) from the "Customer" (calling for help).

INSTRUCTIONS:
1. ANALYZE ROLES:
   - Identify which speaker is the "Agent" (often says "Hello, [Company Name]", "How can I help?")
   - Identify which speaker is the "Customer" (explains a problem, asks for service).
   - Speaker 0 is NOT always the Agent. Use context.

2. EXTRACT CUSTOMER NAME CANDIDATES (TOP 3):
   - You must identify up to 3 COMPETING hypotheses for the customer's name with a confidence score (0.0 to 1.0).
   - Top candidate is the most likely.
   - Low confidence? Still provide a guess but mark it low.
   - IGNORE names of the Agent (e.g., "This is Sarah speaking").
   - IF CALLING FOR A COMPANY: If customer says "This is John from Acme Corp", format as: "John (Acme Corp)".
   - SPELLING: If name is spelled out ("J-O-H-N"), this is VERY HIGH confidence. Reconstruct it.
   - DISAMBIGUATION: If customer says "I'm calling for Mike", the customer is NOT Mike. Look for "My name is...". If not given, extract "Mike" with reasoning "Caller acting on behalf".

3. EXTRACT ADDRESS:
   - Full service location with Street, Town, Postcode.
   - Fix phonetic errors ("M 1" -> "M1").

JSON OUTPUT FIELDS:
- nameCandidates: Array of objects { "name": string, "confidence": number, "reasoning": string }
- companyName: string | null (NEW: Extract distinct company name if mentioned)
- address: string | null
- postcode: string | null
- urgency: "Critical" | "High" | "Standard" | "Low"
- leadType: "Homeowner" | "Landlord" | "Property Manager" | "Tenant" | "Unknown"

Example Candidates:
[
  { "name": "Kiki", "confidence": 0.95, "reasoning": "Spelled out K-I-K-I" },
  { "name": "Craig", "confidence": 0.3, "reasoning": "Mentioned earlier, possibly husband" }
]
`
                },
                {
                    role: "user",
                    content: context
                }
            ],
            response_format: { type: "json_object" }
        });

        const parsed = JSON.parse(response.choices[0].message.content || "{}");

        // Normalize postcode format (uppercase, proper spacing)
        let postcode = parsed.postcode || null;
        if (postcode) {
            postcode = normalizePostcode(postcode);
        }

        // Robust Company Name formatting - Apply to all candidates
        const candidates = (parsed.nameCandidates || []).map((c: any) => {
            if (parsed.companyName && !c.name.includes("(")) {
                return { ...c, name: `${c.name} (${parsed.companyName})` };
            }
            return c;
        });

        // Select the best candidate for the main field
        const bestCandidate = candidates.length > 0 ? candidates[0].name : (parsed.customerName || null);

        // Fallback for legacy behavior if AI fails to return candidates
        let finalCustomerName = bestCandidate;
        if (!finalCustomerName && parsed.customerName) {
            finalCustomerName = parsed.customerName;
            if (parsed.companyName) finalCustomerName += ` (${parsed.companyName})`;
        }

        return {
            customerName: finalCustomerName,
            nameCandidates: candidates,
            companyName: parsed.companyName || null,
            address: parsed.address || null,
            postcode: postcode,
            urgency: parsed.urgency || "Standard",
            leadType: parsed.leadType || "Unknown",
        };
    } catch (error) {
        console.error("Metadata extraction error:", error);
        return {
            customerName: null,
            address: null,
            postcode: null,
            urgency: "Standard",
            leadType: "Unknown"
        };
    }
}

/**
 * B2: Lightweight postcode-only extraction for real-time use
 * Faster than full metadata extraction
 */
export async function extractPostcodeOnly(transcription: string): Promise<string | null> {
    try {
        // First try regex pattern matching (fastest)
        const postcodeRegex = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/gi;
        const matches = transcription.match(postcodeRegex);

        if (matches && matches.length > 0) {
            // Return the last mentioned postcode (most likely to be correct)
            const lastMatch = matches[matches.length - 1];
            return normalizePostcode(lastMatch);
        }

        // Fallback to GPT if regex fails (handles spoken formats like "S W one A one A A")
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Extract ONLY the UK postcode from this text. Return it in standard format (e.g., "SW1A 1AA"). If no postcode is mentioned, return "null".`
                },
                {
                    role: "user",
                    content: transcription
                }
            ],
            max_tokens: 10,
            temperature: 0
        });

        const result = response.choices[0].message.content?.trim();
        if (result && result !== "null" && result.length > 0) {
            return normalizePostcode(result);
        }

        return null;
    } catch (error) {
        console.error("[extractPostcodeOnly] Error:", error);
        return null;
    }
}

/**
 * Normalize UK postcode to standard format
 * "sw1a1aa" -> "SW1A 1AA"
 * "SW1A1AA" -> "SW1A 1AA"
 */
function normalizePostcode(postcode: string): string {
    // Remove all spaces and convert to uppercase
    const cleaned = postcode.replace(/\s/g, '').toUpperCase();

    // UK postcodes are 5-7 characters (without space)
    // Format: AA9A 9AA, A9A 9AA, A9 9AA, A99 9AA, AA9 9AA, AA99 9AA
    if (cleaned.length < 5 || cleaned.length > 7) {
        return postcode; // Return as-is if invalid length
    }

    // Insert space before last 3 characters
    const outward = cleaned.slice(0, -3);
    const inward = cleaned.slice(-3);

    return `${outward} ${inward}`;
}

/**
 * Extract a customer-friendly job summary from a call transcript
 * This ensures we use actual job details (e.g., "TV mounting", "fence repair")
 * instead of technical metadata (e.g., "Ambiguous request - Defaulting to Video Quote")
 */
export async function extractJobSummary(transcription: string): Promise<string> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert at extracting job descriptions from service call transcripts.

Analyze the transcript and extract a short, generalized summary of the job.

Rules:
- Return a single, short sentence fragment (max 10 words)
- Start with a verb (e.g., "Fixing...", "Replacing...", "Investigating...")
- Be customer-friendly and generalized (tease the solution)
- Examples: "Fixing the leak under the kitchen sink", "Replacing the broken fence panel", "Investigating the odd noise from the boiler"
- Do NOT return technical metadata
- Focus on the main outcome desired`
                },
                {
                    role: "user",
                    content: `Transcript:\n${transcription}\n\nExtract the job description:`
                }
            ],
            temperature: 0.3,
            max_tokens: 20
        });

        const jobSummary = response.choices[0].message.content?.trim() || "";
        console.log(`[extractJobSummary] Extracted: "${jobSummary}"`);
        return jobSummary;
    } catch (error) {
        console.error("[extractJobSummary] Error:", error);
        return "the job we discussed";
    }
}

/**
 * Adaptive job phrase extraction - handles single, multiple, and vague scenarios
 * Returns contextually appropriate phrases for WhatsApp messages
 */
export async function extractAdaptiveJobPhrase(transcription: string, skuName?: string): Promise<string> {
    try {
        // If we have a clear SKU match, use it
        if (skuName) {
            console.log(`[extractAdaptiveJobPhrase] Using SKU name: "${skuName}"`);
            return `the ${skuName.toLowerCase()}`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Analyze the transcript and determine the best way to reference the job(s) in a WhatsApp message.

Return ONE of these formats based on what you find:

1. SINGLE CLEAR JOB:
   "the [specific job]" (e.g., "the TV mounting", "the fence repair")

2. TWO JOBS:
   "the [job1] and [job2]" (e.g., "the TV mounting and fence repair")

3. THREE JOBS:
   "the [job1], [job2], and [job3]" (e.g., "the fence panel, shower resealing, and window repair")

4. FOUR OR MORE JOBS:
   "the multiple repairs" or "the several jobs"

5. VAGUE OR UNCLEAR:
   "the work you need" or "the repairs you mentioned" or "the job at your property"

Rules:
- Be specific when possible
- Keep it natural and conversational
- Use "the" before the phrase
- Maximum 10 words
- Choose the format that best matches the transcript`
                },
                {
                    role: "user",
                    content: `Transcript:\n${transcription}\n\nGenerate the job phrase:`
                }
            ],
            temperature: 0.3,
            max_tokens: 30
        });

        const jobPhrase = response.choices[0].message.content?.trim() || "the work you need";
        console.log(`[extractAdaptiveJobPhrase] Generated phrase: "${jobPhrase}"`);
        return jobPhrase;
    } catch (error) {
        console.error("[extractAdaptiveJobPhrase] Error:", error);
        return "the work you need";
    }
}

export async function generateWhatsAppMessage(transcription: string, customerName: string | null, tone: 'casual' | 'professional' = 'casual', detection?: any): Promise<string> {
    const cleanName = (customerName && !customerName.includes("Incoming") && !customerName.includes("Unknown"))
        ? customerName.split(' ')[0]
        : null;

    // Log what data we're working with
    console.log("[AI Message Generation] Input data:", {
        transcriptionLength: transcription?.length || 0,
        transcriptionPreview: transcription?.substring(0, 200) || "(empty)",
        customerName,
        tone,
        detectionSku: detection?.sku?.name || "(none)",
        detectionRationale: detection?.rationale || "(none)",
        matchedServicesCount: detection?.matchedServices?.length || 0
    });

    try {
        // Use adaptive job phrase extraction for intelligent multi-job handling
        let jobPhrase = "";

        // PRIORITY 1: Use matchedServices array if available (multi-SKU)
        if (detection?.matchedServices && detection.matchedServices.length > 0) {
            if (detection.matchedServices.length === 1) {
                // Single job - use SKU name directly
                jobPhrase = `the ${detection.matchedServices[0].sku.name.toLowerCase()}`;
                console.log("[AI Message] Using single matched service:", jobPhrase);
            } else if (detection.matchedServices.length === 2) {
                // Two jobs - natural and format
                jobPhrase = `the ${detection.matchedServices[0].sku.name.toLowerCase()} and ${detection.matchedServices[1].sku.name.toLowerCase()}`;
                console.log("[AI Message] Using two matched services:", jobPhrase);
            } else if (detection.matchedServices.length === 3) {
                // Three jobs - comma format
                jobPhrase = `the ${detection.matchedServices[0].sku.name.toLowerCase()}, ${detection.matchedServices[1].sku.name.toLowerCase()}, and ${detection.matchedServices[2].sku.name.toLowerCase()}`;
                console.log("[AI Message] Using three matched services:", jobPhrase);
            } else {
                // 4+ jobs - use adaptive extraction on full transcript
                jobPhrase = await extractAdaptiveJobPhrase(transcription);
                console.log("[AI Message] Using adaptive phrase for 4+ services:", jobPhrase);
            }
        }
        // PRIORITY 2: Fallback to single SKU
        else if (detection?.sku?.name) {
            jobPhrase = await extractAdaptiveJobPhrase(transcription, detection.sku.name);
            console.log("[AI Message] Using SKU with adaptive phrase:", jobPhrase);
        }
        // PRIORITY 3: Extract from full transcript
        else if (transcription && transcription.length > 50) {
            jobPhrase = await extractAdaptiveJobPhrase(transcription);
            console.log("[AI Message] Extracted adaptive phrase from transcript:", jobPhrase);
        }
        // PRIORITY 4: Generic fallback
        else {
            jobPhrase = "the work you need";
            console.log("[AI Message] Using generic fallback phrase:", jobPhrase);
        }

        console.log("[AI Message] Final job phrase:", jobPhrase);
        console.log("[AI Message] Transcription length:", transcription?.length || 0);

        // Generate message if we have a job phrase
        if (jobPhrase) {
            const greeting = cleanName ? cleanName : 'there';

            // Very strict template to ensure consistent format
            const systemPrompt = tone === 'professional'
                ? `Generate a WhatsApp message with EXACTLY this structure:

"Hi ${greeting}. We just spoke about [job]. Please send us a video so we can take a look and get a price back to you. [emoji]"

Replace [job] with: ${jobPhrase}
Replace [emoji] with ONE relevant emoji (🔧 or 📹)

Rules:
- Use EXACTLY "We just spoke about the"
- Keep it to 2 sentences maximum
- Professional and warm tone
- DO NOT add extra pleasantries or questions`
                : `Generate a WhatsApp message with EXACTLY this structure:

"Hi ${greeting}! We just spoke about [job]. Please send us a video so we can take a look and get a price back to you! [emoji]"

Replace [job] with: ${jobPhrase}
Replace [emoji] with ONE relevant emoji (😊 or 📹)

Rules:
- Use EXACTLY "We just spoke about the"
- Keep it to 2 sentences maximum  
- Friendly and casual tone
- DO NOT add extra pleasantries or questions`;

            const userPrompt = `Generate the exact message format specified above. Use "${jobPhrase}" for the job.`;

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7
            });

            const generatedMessage = response.choices[0].message.content?.trim() || "";
            console.log(`[AI Message] Generated (WITH job context): ${generatedMessage}`);
            return generatedMessage;
        }

        // Fallback: No detection, use transcript
        const greeting = tone === 'professional'
            ? `Hi ${cleanName || 'there'},`
            : `Hi ${cleanName || 'there'}!`;

        const systemPrompt = tone === 'professional'
            ? `You are a professional coordinator. Analyze the transcript and write a professional WhatsApp follow-up.

Rules:
1. Start with: "${greeting}"
2. Mention specific job details from the transcript
3. End with: "Send us a quick video so we can take a look and get a price back to you."
4. Max 2 sentences, one emoji`
            : `You are a friendly coordinator. Analyze the transcript and write a casual WhatsApp follow-up.

Rules:
1. Start with: "${greeting}"
2. Mention specific job details from the transcript naturally
3. End with: "Send us a quick video so we can take a look and get a price back to you."
4. Max 2 sentences, one emoji`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `TRANSCRIPT:\n${transcription || "N/A"}\n\nWrite the WhatsApp message.` }
            ],
            temperature: 0.7
        });

        const generatedMessage = response.choices[0].message.content?.trim() || "";
        console.log(`[AI Message] Generated (from transcript): ${generatedMessage}`);
        return generatedMessage;
    } catch (error) {
        console.error("AI Message generation error:", error);
        return `Hi ${cleanName || 'there'}! We just spoke about the job you need help with. If you can send us a quick video, we can take a look and get a price back to you straight away ${tone === 'professional' ? '🔧' : '🛠️'}`;
    }
}

/**
 * Polishes a raw "reason for assessment" into a grammatically correct,
 * professional phrase suitable for inserting into a sentence.
 *
 * Example Input: "walls are weird might be damp"
 * Example Output: "the wall condition is unclear and may indicate potential damp"
 */
export async function polishAssessmentReason(rawReason: string): Promise<string> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a helpful Handyman Coordinator explaining to a customer why a physical visit is needed.
Your goal is to take the "rough notes" reason and turn it into a natural, seamless continuation of this sentence:
"I need a Top Rated Handyman to assess the site first."

Rules:
1. Start with a transition word like "Specifically,", "This is because", "Given that", or just start the sentence.
2. YOU MUST MENTION THE SPECIFIC JOBS/ISSUES from the input. Do not just say "assess the condition" or "check alignment". Say "assess the uPVC door alignment", "measure for the extractor fan", etc.
3. If there are multiple distinct jobs, list them briefly (e.g., "assess the door seals, check the roof leak, and measure for the new fan").
4. Explain WHY the visit is needed for these specific items (e.g., "to ensure exact measurements", "to trace the leak source").
5. Tone: Professional, reassuring, and specific.
6. Length: 1-2 sentences maximum.

Example Input: "leak under sink and tap broken"
Output: "Specifically, we need to trace exactly where the leak is coming from and check if the tap can be repaired or needs replacement."

Example Input: "odd noise from heater maybe pump"
Output: "This is to determine if the noise is coming from the pump itself or just trapped air, which affects the repair cost."

Example Input: "Replace upvc door rubber seals and check door aligntment ... Supply and fit extractor fan ... new seal to conservatory door"
Output: "Given that we need to assess the uPVC door alignment, measure for the new extractor fan, and inspect the conservatory seals to ensure we order the correct parts."`
                },
                {
                    role: "user",
                    content: rawReason
                }
            ],
            temperature: 0.1,
            max_tokens: 200 // Increased for list format
        });

        const polished = response.choices[0].message.content?.trim() || rawReason;
        // Remove trailing period if present
        return polished.replace(/\.$/, '');

    } catch (error) {
        console.error("Error polishing assessment reason:", error);
        return rawReason;
    }
}

/**
 * Generates a personalized "Expert Note" in a letter format.
 * Uses the customer's name and postcode to feel bespoke.
 */
export async function generatePersonalizedNote(rawReason: string, customerName: string, postcode: string, address?: string): Promise<{ note: string, summary: string }> {
    try {
        const cleanName = (customerName && !customerName.includes("Incoming") && !customerName.includes("Unknown"))
            ? customerName.split(' ')[0]
            : "there";

        const location = address || postcode;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a Senior Handyman.
Your goal is to 1) Write a personal note to the customer and 2) Summarize the job in 3-5 words.

Returns JSON format ONLY:
{
  "note": "The personal letter...",
  "summary": "The short job summary..."
}

Rules for "note":
1. Format: Short personal note/letter.
2. Start with "Hi [Name],"
3. Body: Explain SPECIFICALLY what you need to check at [${location}]. Mention the location naturally if it's a full address (e.g. "at your place in Derby").
4. Sign-off: "Best, Mike".
5. Tone: Friendly, professional.

Rules for "summary":
1. A very short, partial sentence describing the job action.
2. Example: "fix the door seal", "trace the leak", "hang the mirror".
3. Do NOT include "I need to..." or "to...", just the action phrase.

Example Input:
Name: Dave
Location: 10 High St, Derby
Reason: "Replace upvc door rubber seals..."

Example Output:
{
  "note": "Hi Dave,\nI've reviewed the job. Given the need to check the uPVC door alignment and measure for the new seals at your property in Derby, I really need to pop round to assess it personally first.\nBest, Mike",
  "summary": "replace the door seals"
}`
                },
                {
                    role: "user",
                    content: `Name: ${cleanName}\nLocation: ${location}\nReason: ${rawReason}`
                }
            ],
            temperature: 0.7,
            max_tokens: 200,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0].message.content;
        if (!content) return { note: rawReason, summary: "assess the job" };

        return JSON.parse(content);

    } catch (error) {
        console.error("Error generating personalized note:", error);
        return { note: rawReason, summary: "assess the job" };
    }
}

/**
 * STRATEGY DIRECTOR
 * Analyzes a job description to determine the optimal quoting strategy.
 *
 * Strategies:
 * 1. DIAGNOSTIC: Uncertainty, vague symptoms ("leak", "smell", "unsure").
 * 2. PACKAGES (HHH): Upgradeable quality ("paint", "flooring", "taps").
 * 3. SIMPLE: Fixed scope commodity ("hang mirror", "mount tv").
 * 4. PICK_AND_MIX: Multiple distinct tasks list ("and", list format).
 */
export async function determineQuoteStrategy(jobDescription: string): Promise<{
    strategy: 'diagnostic' | 'consultation' | 'hhh' | 'simple' | 'pick_and_mix';
    reasoning: string;
}> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a Senior Estimator. Analyze the job description and select the BEST quote strategy.

STRATEGIES:
1. "consultation" (Diagnostic)
   - Use when scope is UNKNOWN or RISK is high.
   - Keywords: leak, damp, smell, humming, tripping, unsure, investigate, assess, diagnose.
   - Goal: Sell the expert assessment check.

2. "hhh" (Packages: Good/Better/Best)
   - Use when QUALITY/finish is variable or upgradeable.
   - Keywords: paint, flooring, renovate, new tap, new shower, garden, build.
   - Goal: Upsell materials or finish quality.

3. "simple" (Fixed Price)
   - Use for COMMODITY tasks with fixed scope.
   - Keywords: mount TV, hang mirror, assemble flatpack, replace handle, unlock door, reseal bath.
   - Goal: Speed.

4. "pick_and_mix" (Itemized List)
   - Use for MULTIPLE DISTINCT tasks.
   - Keywords: "and", list of items, "plus", "also".
   - Goal: Flexibility.

OUTPUT JSON ONLY:
{
  "strategy": "consultation" | "hhh" | "simple" | "pick_and_mix",
  "reasoning": "Short explanation (max 6 words)"
}`
                },
                {
                    role: "user",
                    content: `Job: "${jobDescription}"`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1 // Deterministic
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");
        // Mapped diagnostic strategy to consultation correctly
        const strategy = (result.strategy === 'diagnostic') ? 'consultation' : result.strategy;

        return {
            strategy: strategy || 'simple',
            reasoning: result.reasoning || 'Standard quote type'
        };

    } catch (error) {
        console.error("Error determining quote strategy:", error);
        // Default to simple if uncertain
        return { strategy: 'simple', reasoning: "Default strategy" };
    }
}

/**
 * Refines a WhatsApp message to weave in excuses/reasons naturally.
 * Input: "Hi John... Sorry for delay Christmas rush. We just spoke about..."
 * Output: "Hi John! Sorry for the delay - it's been a mad rush before Christmas! We just spoke about..."
 */
export async function refineWhatsAppMessage(rawMessage: string): Promise<string> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a friendly, professional Handyman Coordinator. 
Your goal is to REWRITE the provided WhatsApp message to make it flow naturally.

Rules:
1. Tone: Friendly, authentic, slightly casual but professional.
2. Formatting: meaningful words should be *bold* (WhatsApp style). NOT **bold**.
3. Integration: weaving any "excuses" (like "Sorry for delay", "Christmas rush") naturally into the flow, rather than just having them appended at the start.
4. Accuracy: KEEP the link and prices EXACTLY as they are. Do not change the URL.
5. Length: Keep it concise.

Example Input: "Hi Dave. Sorry for delay. Fixed price. Link: ..."
Example Output: "Hi Dave! So sorry for the slight delay getting back to you - we've been non-stop! regarding the *Fixed Price* quote we discussed..."`
                },
                {
                    role: "user",
                    content: rawMessage
                }
            ],
            temperature: 0.7,
        });

        return response.choices[0].message.content?.trim() || rawMessage;
    } catch (error) {
        console.error("Error refining message:", error);
        return rawMessage;
    }
}

/**
 * ROUTING BRAIN: Lead Classifier
 * Extracts structured signals from messy customer input to enable intelligent routing.
 * 
 * This is the "Brain" - it understands natural language and converts it to structured data.
 * The "Matrix" (determineOptimalRoute) then applies business rules to these signals.
 */
export async function classifyLead(
    jobDescription: string,
    metadata?: CallMetadata
): Promise<LeadClassification> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert Lead Classifier for a handyman service.
Your goal is to extract 5 KEY SIGNALS from the customer's input to enable intelligent quote routing.

OUTPUT JSON ONLY:
{
  "clientType": "homeowner" | "landlord" | "tenant" | "commercial" | "unknown",
  "jobClarity": "known" | "vague" | "complex",
  "jobType": "commodity" | "subjective" | "fault" | "project",
  "urgency": "asap" | "normal" | "flexible",
  "segment": "BUSY_PRO" | "PROP_MGR" | "LANDLORD" | "SMALL_BIZ" | "DIY_DEFERRER" | "BUDGET" | "UNKNOWN",
  "reasoning": "Brief explanation (max 10 words)"
}

SIGNAL DEFINITIONS:

1. CLIENT TYPE:
   - "homeowner": Owner-occupier, mentions "my house", "we live here"
   - "landlord": Rental property owner, mentions "tenant", "rental", "investment property"
   - "tenant": Renter, mentions "landlord", "deposit", "end of tenancy"
   - "commercial": Business, mentions "Ltd", "office", "shop", company name
   - "unknown": Cannot determine

2. JOB CLARITY:
   - "known": Clear, specific task (e.g., "mount 55-inch TV", "replace kitchen tap")
   - "vague": Unclear problem (e.g., "leak somewhere", "odd smell", "not working")
   - "complex": Large project requiring planning (e.g., "bathroom refit", "kitchen install")

3. JOB TYPE:
   - "commodity": Standard, identical task (TV mount, lock change, key safe)
   - "subjective": Variable quality/finish (painting, shelving, carpentry)
   - "fault": Diagnostic needed (leak, electrical trip, noise)
   - "project": Multi-trade renovation (bathroom, kitchen, extension)

4. URGENCY:
   - "asap": <24 hours, emergency, "urgent", "ASAP"
   - "normal": This week, "soon", "when you can"
   - "flexible": No rush, "whenever", "next month"

5. STRATEGY SEGMENT (CRITICAL):
   - "BUSY_PRO": High WTP, Values SPEED. Signals: "ASAP", "work schedule", "won't be home", professional tone.
   - "PROP_MGR": Medium/High WTP, Values RELIABILITY. Signals: "I manage", "tenant", multiple units, invoicing.
   - "SMALL_BIZ": High WTP, Values DISRUPTION-FREE. Signals: Business name, "after hours", "before we open", "office/shop".
   - "DIY_DEFERRER": Low/Med WTP, Values BATCHING. Signals: "Meaning to for ages", list of small jobs, "while you're there".
   - "BUDGET": Low WTP, Values PRICE. Signals: "Cheapest", "rough estimate", price-first questions, "I'm renting".
   - "UNKNOWN": No clear signal.


EXAMPLES:

Input: "Need to mount my new 65-inch Samsung TV on the living room wall. I work 9-5 so need an evening slot."
Output: {"clientType": "homeowner", "jobClarity": "known", "jobType": "commodity", "urgency": "normal", "segment": "BUSY_PRO", "reasoning": "Homeowner with work schedule constraints"}

Input: "My tenant says there's a musty smell under the kitchen sink at 42 High St. Need an invoice for the company."
Output: {"clientType": "landlord", "jobClarity": "vague", "jobType": "fault", "urgency": "normal", "segment": "PROP_MGR", "reasoning": "Landlord managing rental with invoicing needs"}

Input: "Hi, I have a list of small jobs I've been putting off. A shelf to hang, a loose door handle, and some caulking."
Output: {"clientType": "homeowner", "jobClarity": "known", "jobType": "commodity", "urgency": "flexible", "segment": "DIY_DEFERRER", "reasoning": "Batching small list of deferred jobs"}

Input: "What's the cheapest price to just change a lock? I don't need anything fancy."
Output: {"clientType": "unknown", "jobClarity": "known", "jobType": "commodity", "urgency": "normal", "segment": "BUDGET", "reasoning": "Price-sensitive language"}
`
                },
                {
                    role: "user",
                    content: `Job Description: "${jobDescription}"${metadata?.leadType ? `\nLead Type from Call: ${metadata.leadType}` : ''}${metadata?.urgency ? `\nUrgency from Call: ${metadata.urgency}` : ''}`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1 // Deterministic
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");

        return {
            clientType: result.clientType || 'unknown',
            jobClarity: result.jobClarity || 'known',
            jobType: result.jobType || 'commodity',
            urgency: result.urgency || 'normal',
            segment: result.segment || 'UNKNOWN',
            reasoning: result.reasoning || 'Default classification'
        };


    } catch (error) {
        console.error("Error classifying lead:", error);
        // Safe fallback
        return {
            clientType: 'unknown',
            jobClarity: 'known',
            jobType: 'subjective',
            urgency: 'normal',
            segment: 'UNKNOWN',
            reasoning: 'Classification failed - using defaults'
        };
    }
}

/**
 * ROUTING MATRIX: Deterministic Route Selection
 * Applies business rules to classified signals to determine the optimal quote route.
 * 
 * This is the "Matrix" - it ensures consistent, predictable routing based on your business logic.
 */
export function determineOptimalRoute(classification: LeadClassification): {
    route: QuoteRoute;
    reasoning: string;
} {
    const { clientType, jobClarity, jobType, urgency } = classification;

    // RULE 1: Unknown faults or complex projects -> Expert Assessment
    if (jobClarity === 'vague' || jobType === 'fault') {
        return {
            route: 'assessment',
            reasoning: 'Unknown fault requires diagnostic visit'
        };
    }

    if (jobClarity === 'complex' || jobType === 'project') {
        return {
            route: 'assessment',
            reasoning: 'Complex project requires site survey'
        };
    }

    // RULE 2: Commodity tasks -> Instant Action
    if (jobType === 'commodity') {
        return {
            route: 'instant',
            reasoning: 'Standard commodity task - fixed price'
        };
    }

    // RULE 3: Subjective jobs -> Service Tiers (with appropriate skin)
    // The skin will be determined by clientType on the frontend
    return {
        route: 'tiers',
        reasoning: `Service tiers with ${clientType} skin`
    };
}
