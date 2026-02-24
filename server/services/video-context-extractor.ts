/**
 * Video Context Extractor Service
 *
 * Uses GPT to analyze call transcripts and determine:
 * 1. Whether the customer agreed to send a video
 * 2. What specific thing they should video (the problem area)
 * 3. Job type for context in the message
 *
 * Designed to work without construction knowledge - purely semantic analysis.
 */

import { getOpenAI } from "../openai";

export interface VideoAnalysis {
    shouldRequestVideo: boolean;
    confidence: number; // 0-100
    videoContext: string; // e.g., "the leaking tap and the area under the sink"
    jobType: string; // e.g., "tap repair", "door fitting"
    customerFirstName: string;
    reasoning?: string; // Why the decision was made
}

/**
 * Analyze a call transcript to determine if a video request is appropriate
 *
 * @param transcript The full call transcript
 * @param callSummary Optional AI-generated call summary for context
 * @returns VideoAnalysis with decision and context
 */
export async function analyzeCallForVideoRequest(
    transcript: string,
    callSummary?: string
): Promise<VideoAnalysis> {
    try {
        const openai = getOpenAI();

        const systemPrompt = `You are analyzing a handyman service call transcript to determine if the customer agreed to send a video of their problem.

YOUR TASK:
1. Detect if the operator asked the customer to send a video or photo
2. Detect if the customer agreed to send one
3. Extract what specific thing they should video (the problem area)
4. Extract the customer's first name
5. Identify the job type being discussed

LOOK FOR PATTERNS LIKE:
- Operator: "Can you send us a quick video of the [problem]?"
- Customer: "Yes", "Sure", "OK", "I'll send it", "I can do that"
- Operator: "We'll need to see a video of..."
- Customer volunteering: "I can send you a video"

CONFIDENCE SCORING:
- 90-100: Explicit agreement to send video (e.g., "Yes, I'll send a video now")
- 70-89: Implied agreement (e.g., "OK", "Sure" after video request)
- 50-69: Vague response (e.g., "I'll see what I can do")
- 0-49: No clear agreement, uncertainty, or customer said no

VIDEO CONTEXT:
- Extract the specific thing to film in natural language
- Examples: "the leaking tap and area underneath", "the door that's sticking", "the crack in the wall"
- Be specific but natural - this will be used in a WhatsApp message

CUSTOMER NAME:
- Extract just the first name if mentioned
- If not given, use "there" as a fallback

JOB TYPE:
- Identify the main job being discussed
- Examples: "tap repair", "door adjustment", "plastering", "TV mounting"

Return JSON only with these exact fields:
{
  "shouldRequestVideo": boolean,
  "confidence": number (0-100),
  "videoContext": string,
  "jobType": string,
  "customerFirstName": string,
  "reasoning": string (brief explanation)
}`;

        const userPrompt = callSummary
            ? `CALL SUMMARY:\n${callSummary}\n\nFULL TRANSCRIPT:\n${transcript}`
            : `CALL TRANSCRIPT:\n${transcript}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0.2, // Low temperature for consistent extraction
            response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.error("[VideoExtractor] No response from GPT");
            return defaultVideoAnalysis();
        }

        const parsed = JSON.parse(content) as VideoAnalysis;

        // Validate required fields
        if (typeof parsed.shouldRequestVideo !== "boolean") {
            parsed.shouldRequestVideo = false;
        }
        if (typeof parsed.confidence !== "number") {
            parsed.confidence = 0;
        }
        if (!parsed.videoContext) {
            parsed.videoContext = "the area that needs work";
        }
        if (!parsed.jobType) {
            parsed.jobType = "repair";
        }
        if (!parsed.customerFirstName) {
            parsed.customerFirstName = "there";
        }

        console.log(
            `[VideoExtractor] Analysis: shouldRequest=${parsed.shouldRequestVideo}, confidence=${parsed.confidence}, context="${parsed.videoContext}"`
        );

        return parsed;
    } catch (error) {
        console.error("[VideoExtractor] Error analyzing transcript:", error);
        return defaultVideoAnalysis();
    }
}

/**
 * Default analysis when extraction fails
 */
function defaultVideoAnalysis(): VideoAnalysis {
    return {
        shouldRequestVideo: false,
        confidence: 0,
        videoContext: "the area that needs work",
        jobType: "repair",
        customerFirstName: "there",
        reasoning: "Analysis failed or incomplete",
    };
}

/**
 * Generate a natural WhatsApp message for video request
 *
 * @param analysis The video analysis result
 * @returns A natural, casual WhatsApp message
 */
export function generateVideoRequestMessage(analysis: VideoAnalysis): string {
    const templates = [
        `Hi ${analysis.customerFirstName}! As we discussed, could you send us a quick video of ${analysis.videoContext}? That way we can take a look straight away and get you sorted`,
        `Hey ${analysis.customerFirstName}, just following up from our chat - when you get a sec, send over that video of ${analysis.videoContext} and we'll have a look for you!`,
        `Hi ${analysis.customerFirstName}! Pop us over a video of ${analysis.videoContext} when you can and we'll get back to you with a quote`,
    ];

    // Select template based on job type for variety
    const index = analysis.jobType.length % templates.length;
    return templates[index];
}

/**
 * Check if we should auto-send based on confidence threshold
 *
 * @param analysis The video analysis
 * @param threshold Minimum confidence to auto-send (default: 80)
 * @returns Whether to auto-send the video request
 */
export function shouldAutoSendVideoRequest(
    analysis: VideoAnalysis,
    threshold: number = 80
): boolean {
    return analysis.shouldRequestVideo && analysis.confidence >= threshold;
}

// ==========================================
// ROUTE DETECTION
// ==========================================

/**
 * Lead Route Types for the Tube Map
 */
export type LeadRouteType = 'video' | 'instant_quote' | 'site_visit' | null;

export interface RouteDetectionResult {
    route: LeadRouteType;
    confidence: number; // 0-100
    reasoning: string;
}

/**
 * Analyze a call transcript to detect which route the lead should take
 *
 * Routes:
 * - video: Customer agreed to send a video/photos for quote
 * - instant_quote: Price was given on the call, or instant quote possible
 * - site_visit: Job requires in-person assessment
 *
 * @param transcript The full call transcript
 * @returns RouteDetectionResult with route and confidence
 */
export async function detectRoute(transcript: string): Promise<RouteDetectionResult> {
    try {
        const openai = getOpenAI();

        const systemPrompt = `You are analyzing a handyman service call transcript to determine which quote route the lead should take.

YOUR TASK:
Determine which of these three routes applies based on the conversation:

1. "video" - Customer agreed to send a video or photos for quoting
   - Look for: "send a video", "send photos", "send pictures", "WhatsApp me the video"
   - Customer agrees: "Yes", "OK", "I'll send it over", "I can do that"
   - Operator says: "Once we see the video, we can quote you"

2. "instant_quote" - Price was given on the call or job is simple enough to quote instantly
   - Look for: specific price mentioned ("It would be about X pounds", "That's \u00a350")
   - Operator says: "I can quote you now", "That would be", "The price is"
   - Simple jobs with clear scope

3. "site_visit" - Job requires in-person assessment before quoting
   - Look for: "need to come and see it", "site visit", "need to assess"
   - Operator says: "We'll need to pop round", "Can't quote without seeing it"
   - Complex jobs, structural work, multiple unknowns

If no clear route is indicated, return null.

CONFIDENCE SCORING:
- 90-100: Explicit agreement or clear indication
- 70-89: Implied or likely based on context
- 50-69: Possible but unclear
- 0-49: Very uncertain

Return JSON only:
{
  "route": "video" | "instant_quote" | "site_visit" | null,
  "confidence": number (0-100),
  "reasoning": string (brief explanation)
}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `CALL TRANSCRIPT:\n${transcript}` },
            ],
            temperature: 0.2,
            response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.error("[RouteDetector] No response from GPT");
            return { route: null, confidence: 0, reasoning: "Analysis failed" };
        }

        const parsed = JSON.parse(content) as RouteDetectionResult;

        // Validate route value
        const validRoutes: LeadRouteType[] = ['video', 'instant_quote', 'site_visit', null];
        if (!validRoutes.includes(parsed.route)) {
            parsed.route = null;
        }

        if (typeof parsed.confidence !== "number") {
            parsed.confidence = 0;
        }

        console.log(
            `[RouteDetector] Detected route: ${parsed.route}, confidence: ${parsed.confidence}`
        );

        return parsed;
    } catch (error) {
        console.error("[RouteDetector] Error detecting route:", error);
        return { route: null, confidence: 0, reasoning: "Error during analysis" };
    }
}

/**
 * Detect route from transcript and update lead if confidence is high enough
 */
export async function detectAndAssignRoute(
    transcript: string,
    leadId: string,
    confidenceThreshold: number = 70
): Promise<{ assigned: boolean; route: LeadRouteType; confidence: number }> {
    const result = await detectRoute(transcript);

    if (result.route && result.confidence >= confidenceThreshold) {
        try {
            // Import db and leads here to avoid circular dependencies
            const { db } = await import("../db");
            const { leads } = await import("@shared/schema");
            const { eq } = await import("drizzle-orm");

            await db.update(leads)
                .set({
                    route: result.route,
                    routeAssignedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(leads.id, leadId));

            console.log(`[RouteDetector] Assigned route '${result.route}' to lead ${leadId}`);

            return {
                assigned: true,
                route: result.route,
                confidence: result.confidence,
            };
        } catch (error) {
            console.error(`[RouteDetector] Failed to assign route to lead ${leadId}:`, error);
        }
    }

    return {
        assigned: false,
        route: result.route,
        confidence: result.confidence,
    };
}
