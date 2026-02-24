/**
 * Call Analyzer Service
 *
 * AI-powered call transcript analysis for lead qualification,
 * segmentation, and recommended actions.
 */

import { openai } from "../openai";

// ============================================================================
// TYPES
// ============================================================================

export interface CallAnalysis {
    qualificationScore: number;      // 0-100
    qualificationGrade: 'HOT' | 'WARM' | 'COLD';
    shouldFollowUp: boolean;

    segment: string;  // LANDLORD, BUSY_PRO, PROP_MGR, SMALL_BIZ, DIY_DEFERRER, BUDGET, DEFAULT etc
    segmentConfidence: number;       // 0-100
    segmentSignals: string[];        // Evidence from transcript

    jobCategory: string;             // tap_repair, door_fitting, etc.
    jobDescription: string;          // Natural description
    urgency: 'emergency' | 'this_week' | 'flexible';

    customerName: string;
    postcode: string;
    isOwner: boolean;
    propertyType: 'home' | 'rental_owned' | 'rental_tenant' | 'commercial';

    redFlags: string[];
    recommendedAction: 'call_back_now' | 'send_quote' | 'nurture' | 'decline';
}

// Default analysis when parsing fails
const DEFAULT_ANALYSIS: CallAnalysis = {
    qualificationScore: 50,
    qualificationGrade: 'WARM',
    shouldFollowUp: true,
    segment: 'DEFAULT',
    segmentConfidence: 0,
    segmentSignals: [],
    jobCategory: 'general_repair',
    jobDescription: 'General enquiry',
    urgency: 'flexible',
    customerName: '',
    postcode: '',
    isOwner: true,
    propertyType: 'home',
    redFlags: [],
    recommendedAction: 'nurture'
};

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyzes a call transcript using GPT-4 to extract qualification score,
 * customer segment, job details, and recommended actions.
 *
 * @param transcript - The full call transcript text
 * @param callSummary - Optional pre-generated call summary
 * @returns CallAnalysis object with all extracted data
 */
export async function analyzeCallTranscript(
    transcript: string,
    callSummary?: string
): Promise<CallAnalysis> {
    if (!transcript || transcript.trim().length === 0) {
        console.warn("[CallAnalyzer] Empty transcript provided");
        return DEFAULT_ANALYSIS;
    }

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt()
                },
                {
                    role: "user",
                    content: buildUserPrompt(transcript, callSummary)
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1 // Low temperature for consistent analysis
        });

        const content = response.choices[0].message.content;
        if (!content) {
            console.error("[CallAnalyzer] Empty response from OpenAI");
            return DEFAULT_ANALYSIS;
        }

        const parsed = JSON.parse(content);
        return validateAndNormalizeAnalysis(parsed);

    } catch (error) {
        console.error("[CallAnalyzer] Error analyzing transcript:", error);
        return DEFAULT_ANALYSIS;
    }
}

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildSystemPrompt(): string {
    return `You are an expert call analyst for a UK handyman service.
Your goal is to analyze call transcripts and extract structured data for lead qualification and routing.

OUTPUT JSON FORMAT:
{
  "qualificationScore": number (0-100),
  "qualificationGrade": "HOT" | "WARM" | "COLD",
  "shouldFollowUp": boolean,
  "segment": string,
  "segmentConfidence": number (0-100),
  "segmentSignals": string[],
  "jobCategory": string,
  "jobDescription": string,
  "urgency": "emergency" | "this_week" | "flexible",
  "customerName": string,
  "postcode": string,
  "isOwner": boolean,
  "propertyType": "home" | "rental_owned" | "rental_tenant" | "commercial",
  "redFlags": string[],
  "recommendedAction": "call_back_now" | "send_quote" | "nurture" | "decline"
}

=== QUALIFICATION SCORING ===

Start at 50 points. Then adjust:

ADD POINTS:
+25: Emergency situation (flooding, burst pipe, no heating, locked out)
+15: Specific job details provided (exact measurements, clear problem, location in house)
+15: Owner or landlord (decision maker with authority to book)
+10: In our service area (UK postcode mentioned)
+15: Multiple jobs mentioned (opportunity for larger ticket)
+10: Asked about availability (buying signal)
+5: Mentioned previous good experience or referral

SUBTRACT POINTS:
-20: "Just getting prices" / "Just checking" / "Shopping around"
-15: Vague job description ("something's wrong", "not sure what's needed")
-15: No authority to book (tenant needing landlord approval, needs to ask spouse)
-25: Aggressive price shopping / demanding discounts
-10: Unrealistic expectations (wants same-day for non-emergency)
-15: Outside service area
-10: Asked "how much per hour?" (commodity mindset)

GRADES:
70-100 = HOT (ready to book)
40-69 = WARM (interested, needs nurturing)
0-39 = COLD (low probability)

=== SEGMENT DETECTION ===

Detect ONE primary segment based on transcript signals:

EMERGENCY: "urgent", "flooding", "burst", "no heating", "locked out", "ASAP", "today"
BUSY_PRO: Work schedule mentioned, "key safe", "won't be home", values convenience
PROP_MGR: "I manage properties", "my tenant", multiple units, needs invoicing
LANDLORD: "my rental", "buy to let", "BTL", "tenant", investment property, remote owner
SMALL_BIZ: Business name, "our office", "shop", "after hours", "before we open"
TRUST_SEEKER: "trust", "vetted", "DBS checked", elderly caller, "live alone"
RENTER: "I'm renting", "landlord won't pay", "deposit", "end of tenancy"
DIY_DEFERRER: "Been meaning to for ages", list of small jobs, "while you're there"
BUDGET: "cheapest", "best price", "how much per hour", price-sensitive language
DEFAULT: No clear signals

=== RED FLAGS ===

Extract any of these warning signs:
- Price shopping multiple providers
- Unrealistic timeline expectations
- Disputes about pricing
- Aggressive or rude behavior
- Mentioned legal action or complaints
- Wants work done "off the books"
- Suspicious access requirements
- Previous provider complaints

=== RECOMMENDED ACTION ===

Based on analysis:
- "call_back_now": HOT lead, emergency, or time-sensitive opportunity
- "send_quote": WARM lead with clear job scope
- "nurture": Interested but not ready, needs follow-up
- "decline": Red flags, outside area, or very low qualification`;
}

function buildUserPrompt(transcript: string, callSummary?: string): string {
    let prompt = `Analyze this call transcript:\n\n${transcript}`;

    if (callSummary) {
        prompt += `\n\nCall Summary (for context):\n${callSummary}`;
    }

    return prompt;
}

// ============================================================================
// VALIDATION & NORMALIZATION
// ============================================================================

function validateAndNormalizeAnalysis(parsed: any): CallAnalysis {
    // Ensure score is within bounds
    let score = parseInt(parsed.qualificationScore) || 50;
    score = Math.max(0, Math.min(100, score));

    // Derive grade from score if not provided or invalid
    let grade: 'HOT' | 'WARM' | 'COLD';
    if (parsed.qualificationGrade && ['HOT', 'WARM', 'COLD'].includes(parsed.qualificationGrade)) {
        grade = parsed.qualificationGrade;
    } else {
        grade = score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD';
    }

    // Validate segment
    const validSegments = [
        'EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD',
        'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER',
        'BUDGET', 'DEFAULT'
    ];
    const segment = validSegments.includes(parsed.segment) ? parsed.segment : 'DEFAULT';

    // Validate urgency
    const validUrgencies = ['emergency', 'this_week', 'flexible'];
    const urgency = validUrgencies.includes(parsed.urgency) ? parsed.urgency : 'flexible';

    // Validate property type
    const validPropertyTypes = ['home', 'rental_owned', 'rental_tenant', 'commercial'];
    const propertyType = validPropertyTypes.includes(parsed.propertyType)
        ? parsed.propertyType
        : 'home';

    // Validate recommended action
    const validActions = ['call_back_now', 'send_quote', 'nurture', 'decline'];
    const recommendedAction = validActions.includes(parsed.recommendedAction)
        ? parsed.recommendedAction
        : 'nurture';

    // Determine shouldFollowUp based on grade and action
    const shouldFollowUp = grade !== 'COLD' && recommendedAction !== 'decline';

    return {
        qualificationScore: score,
        qualificationGrade: grade,
        shouldFollowUp,
        segment,
        segmentConfidence: Math.max(0, Math.min(100, parseInt(parsed.segmentConfidence) || 0)),
        segmentSignals: Array.isArray(parsed.segmentSignals) ? parsed.segmentSignals : [],
        jobCategory: parsed.jobCategory || 'general_repair',
        jobDescription: parsed.jobDescription || 'General enquiry',
        urgency: urgency as CallAnalysis['urgency'],
        customerName: parsed.customerName || '',
        postcode: normalizePostcode(parsed.postcode || ''),
        isOwner: Boolean(parsed.isOwner),
        propertyType: propertyType as CallAnalysis['propertyType'],
        redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
        recommendedAction: recommendedAction as CallAnalysis['recommendedAction']
    };
}

/**
 * Normalize UK postcode to standard format
 * "sw1a1aa" -> "SW1A 1AA"
 */
function normalizePostcode(postcode: string): string {
    if (!postcode) return '';

    // Remove all spaces and convert to uppercase
    const cleaned = postcode.replace(/\s/g, '').toUpperCase();

    // UK postcodes are 5-7 characters (without space)
    if (cleaned.length < 5 || cleaned.length > 7) {
        return postcode.toUpperCase().trim();
    }

    // Insert space before last 3 characters
    const outward = cleaned.slice(0, -3);
    const inward = cleaned.slice(-3);

    return `${outward} ${inward}`;
}
