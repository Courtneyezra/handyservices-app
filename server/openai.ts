
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

// Initialize OpenAI
if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set. AI features will be limited.");
}
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface CallMetadata {
    customerName: string | null;
    address: string | null;
    postcode: string | null; // B2: UK postcode extraction
    urgency: "Critical" | "High" | "Standard" | "Low";
    leadType: "Homeowner" | "Landlord" | "Property Manager" | "Tenant" | "Unknown";
    roleMapping?: Record<number, "VA" | "Customer">; // Map Speaker ID -> Role
}

interface Segment {
    speaker: number;
    text: string;
}

export async function extractCallMetadata(transcription: string, segments: Segment[] = []): Promise<CallMetadata> {
    try {
        // Prepare segments for prompt (limit to first 10-15 turns to save tokens, usually enough to establish roles)
        const dialogueSnippet = segments.slice(0, 15).map(s => `Speaker ${s.speaker}: "${s.text}"`).join("\n");
        const context = dialogueSnippet || transcription; // Fallback to full text if no segments

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert dispatcher analyzing audio transcripts.
Extract the following fields into JSON:
- customerName: The caller's name (or null).
- address: The FULL service location address in this exact format: "Street Number + Street Name, Flat/Unit (if mentioned), Town/City, Postcode"
  Examples:
  * "42 Maple Street, London, SW1A 1AA"
  * "15B High Street, Flat 3, Manchester, M1 1AA"
  * "The Old Mill, Church Lane, Bristol, BS1 1AA"
  
  IMPORTANT for address:
  - Include ALL parts mentioned (street number, street name, flat/unit, building name, town, postcode)
  - If customer says "my address" or "same address", try to extract from earlier context
  - If only partial address given, extract what's available
  - Normalize variations: "apartment 2" → "Flat 2", "number 42" → "42"
  - Keep UK formatting (e.g., "42A" not "42 A")
  
  ERROR CORRECTION RULES:
  - Fix phonetic errors: "M 1" -> "M1", "Tree Road" -> "Tree Road"
  - Handle spelling: "S for Sugar" -> "S", "B for Bravo" -> "B"
  - Fix common STT mistakes: "Double U" -> "W", "Bee" -> "B", "Pea" -> "P"
  - Fix disjointed postcodes: "S W 1 A 1 A A" -> "SW1A 1AA"
  - Fix number words: "Forty two" -> "42"
  
- postcode: UK postcode in standard format (e.g., "SW1A 1AA", "W1A 0AX"). Extract even if spoken as "S W one A one A A" or "SW seventeen 8QT". Return null if not mentioned.
- urgency: Assess urgency (Critical, High, Standard, Low).
- leadType: Identify caller role (Homeowner, Landlord, Property Manager, Tenant).
- roleMapping: Analyze the dialogue to identify which Speaker ID is the "Professional/VA" (answering the phone, asking questions) and which is the "Customer" (calling with a problem).
  Format: { "0": "VA", "1": "Customer" } or vice versa.
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

        // Convert string keys back to numbers for the mapping
        const rawMapping = parsed.roleMapping || {};
        const roleMapping: Record<number, "VA" | "Customer"> = {};
        for (const key in rawMapping) {
            roleMapping[parseInt(key)] = rawMapping[key];
        }

        // Normalize postcode format (uppercase, proper spacing)
        let postcode = parsed.postcode || null;
        if (postcode) {
            postcode = normalizePostcode(postcode);
        }

        return {
            customerName: parsed.customerName || null,
            address: parsed.address || null,
            postcode: postcode,
            urgency: parsed.urgency || "Standard",
            leadType: parsed.leadType || "Unknown",
            roleMapping
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

Analyze the transcript and extract ONLY the main job/task the customer needs help with.

Rules:
- Return 2-4 words maximum
- Be specific and customer-friendly
- Examples: "TV mounting", "fence repair", "Ring doorbell installation", "window resealing"
- Do NOT return technical metadata or routing decisions
- Focus on what the customer actually needs done

If multiple tasks are mentioned, focus on the primary/first one.`
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
