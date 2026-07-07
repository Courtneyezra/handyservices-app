import { getAnthropic } from "./anthropic";

// ============================================================
// AI Call Scoring — VA performance dashboard (feedback/training)
// Outcome-based: scores what a finished call ACHIEVED, not the
// sequence it followed — real calls don't run in a fixed order.
// ============================================================

export interface CallScoreDimension {
    score: number; // 0-100
    evidence: string; // short verbatim transcript quote, or ""
}

export interface CallScorecard {
    version: 5;
    overall: number; // 0-100, weighted composite
    dimensions: {
        discovery: CallScoreDimension & {
            captured: {
                name: boolean;
                phone: boolean;
                postcode: boolean;
                jobDescription: boolean;
                urgency: boolean;
            };
        };
        conversionBehaviour: CallScoreDimension & {
            nextStepSecured: 'instant_quote' | 'video_request' | 'site_visit' | 'callback' | 'none';
        };
        rapport: CallScoreDimension & {
            toneMatch: { score: number; evidence: string };
        };
        accuracy: CallScoreDimension;
    };
    flags: string[];
    coachingNote: string;
    callerName: string; // caller's name as stated on the call, "" if not given (NEVER the agent's name)
    mediaRequestPhrase: string; // short noun phrase for "send us a video showing us ___", "" if unclear
}

export interface ScorableCall {
    transcription?: string | null;
    duration?: number | null;
    ringSeconds?: number | null;
    handledBy?: string | null; // 'va' | 'ai_agent' | 'missed' | 'voicemail'
    outcome?: string | null;
    jobSummary?: string | null;
    detectedSkusJson?: any;
}

// Weights for the composite overall score (must sum to 1).
// Outcome-weighted: securing the next step is what converts.
const WEIGHTS = {
    discovery: 0.30,
    conversionBehaviour: 0.40,
    rapport: 0.15,
    accuracy: 0.15,
} as const;

const ALLOWED_FLAGS = [
    'no_follow_up_promised',
    'price_given_without_scoping',
    'missed_upsell',
    'customer_frustrated',
    'call_ended_abruptly',
    'no_next_step',
] as const;

const ALLOWED_NEXT_STEPS = ['instant_quote', 'video_request', 'site_visit', 'callback', 'none'] as const;

// What a good call ACHIEVES (Handy Services). Outcomes, not sequence —
// calls are scored on what was true by the end, in whatever order it happened.
const CALL_OUTCOMES = `
WHAT A GOOD CALL ACHIEVES (by the end of the call, in any order):
- The caller felt heard — they got to explain the job in their own words.
- We know who they are (homeowner / landlord / property manager / tenant) and how to reach them.
- We know the job: description, postcode, and how urgent it is.
- The job was qualified: is this something we can actually do?
- THE PRIMARY GOAL: the caller AGREES to send us media (photos/video of the job) via WhatsApp.
  After the call we send them a WhatsApp message; they reply to it with the media, and we quote
  from that. The best calls secure explicit agreement AND set the expectation: "I'll send you a
  WhatsApp message now — reply with the videos/photos and we'll get your quote over."
- Alternative valid outcomes when WhatsApp media doesn't fit the job:
  - INSTANT QUOTE: simple standard job → we generate & send a quote directly.
  - SITE VISIT: genuinely complex job → a visit gets booked.
  - (a specific CALLBACK with an agreed time is a weak fallback, not a win.)

GUARDRAILS:
- Emergency (flooding / no heating / security) → quote immediately; escalate if over £500.
- Any job over £500 → send the quote but flag to the owner for review.
- Don't commit to a firm price without scoping the job first.
`.trim();

const SCORING_SYSTEM_PROMPT = `You are a call-quality assessor for a UK handyman company. You score finished inbound calls on OUTCOMES — what the call achieved — to produce a coaching scorecard for the person (or AI agent) who handled it.

${CALL_OUTCOMES}

IMPORTANT: judge outcomes, not sequence. There is no required order of steps — a natural conversation that ends with the job understood and a next step committed is a good call, however it flowed.

SCORING DIMENSIONS (each 0-100):
1. discovery — by the end of the call, did we know what we need? Report which items were captured (name, phone, postcode, job description, urgency). Note: the caller's phone number is usually captured automatically by the phone system — count "phone" as captured if it was confirmed on the call OR if there was no need to ask.
2. conversionBehaviour — did the handler secure the PRIMARY GOAL: explicit caller agreement to send photos/video via WhatsApp (nextStepSecured: 'video_request')? Top marks require clear agreement AND the expectation set that a WhatsApp message is coming for them to reply to. 'instant_quote' or 'site_visit' score well when genuinely better suited to the job. A vague callback is weak; a call ending with no committed next step is a conversion failure regardless of how pleasant it was.
3. rapport — tone, empathy, professionalism, letting the customer feel heard. Includes a toneMatch subscore: did the handler MATCH the caller's energy and communication style? (An anxious caller with an emergency needs urgency and reassurance, not flat procedure; a brisk, task-focused caller needs efficiency, not small talk; a chatty caller needs warmth before business.) Score toneMatch on how well the handler read and mirrored the caller — mismatched energy caps rapport.
4. accuracy — was the information given (pricing, process, timescales, capabilities) correct and consistent with the guardrails? Penalise firm prices quoted without scoping the job.

EVIDENCE: for each dimension give a SHORT verbatim quote from the transcript that best supports the score (or "" if nothing suitable).

FLAGS: include only flags that clearly apply, from exactly this list:
'no_follow_up_promised', 'price_given_without_scoping', 'missed_upsell', 'customer_frustrated', 'call_ended_abruptly', 'no_next_step'.

COACHING NOTE: 1-2 sentences, constructive, addressed directly to the call handler ("you"). If the call was handled by the AI agent, phrase it as feedback for tuning the agent's behaviour rather than personal coaching.

CALLER NAME: extract the CALLER's own name if they state it (from [Caller]: turns — e.g. "my name is Mark", "it's Sarah calling", "this is Mrs Ward"). Return their first name, plus surname if given. CRITICAL: this is the CUSTOMER's name, never the call handler's. The handler/agent is called "Ben" (and may introduce themselves as "Ben", "Ben from Handy Services", or "Courtnee") — NEVER return "Ben" or "Courtnee" as the caller name. If the caller never gives their name, return an empty string "".

MEDIA REQUEST PHRASE: write a SHORT noun phrase naming the job, designed to drop seamlessly into the sentence "please send us a video showing us ___". Use "your"/"the" naturally, lowercase start, no trailing punctuation, max ~8 words. Examples: "the leaking tap under your kitchen sink", "your garden fence and the broken panels", "the cracked bathroom tiles". If the job is too vague to name specifically, return an empty string "".

The same rubric applies to both human VA calls and AI-agent calls. Be fair: short calls where the customer got what they needed quickly can still score well. Score each dimension independently on 0-100.

Respond ONLY with JSON.`;

const SCORECARD_JSON_SCHEMA = {
    name: "call_scorecard",
    strict: true,
    schema: {
        type: "object",
        additionalProperties: false,
        properties: {
            discovery: {
                type: "object",
                additionalProperties: false,
                properties: {
                    score: { type: "number" },
                    evidence: { type: "string" },
                    captured: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            name: { type: "boolean" },
                            phone: { type: "boolean" },
                            postcode: { type: "boolean" },
                            jobDescription: { type: "boolean" },
                            urgency: { type: "boolean" },
                        },
                        required: ["name", "phone", "postcode", "jobDescription", "urgency"],
                    },
                },
                required: ["score", "evidence", "captured"],
            },
            conversionBehaviour: {
                type: "object",
                additionalProperties: false,
                properties: {
                    score: { type: "number" },
                    evidence: { type: "string" },
                    nextStepSecured: { type: "string", enum: [...ALLOWED_NEXT_STEPS] },
                },
                required: ["score", "evidence", "nextStepSecured"],
            },
            rapport: {
                type: "object",
                additionalProperties: false,
                properties: {
                    score: { type: "number" },
                    evidence: { type: "string" },
                    toneMatch: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            score: { type: "number" },
                            evidence: { type: "string" },
                        },
                        required: ["score", "evidence"],
                    },
                },
                required: ["score", "evidence", "toneMatch"],
            },
            accuracy: dimensionSchema(),
            flags: { type: "array", items: { type: "string", enum: [...ALLOWED_FLAGS] } },
            coachingNote: { type: "string" },
            callerName: { type: "string" },
            mediaRequestPhrase: { type: "string" },
        },
        required: ["discovery", "conversionBehaviour", "rapport", "accuracy", "flags", "coachingNote", "callerName", "mediaRequestPhrase"],
    },
} as const;

function dimensionSchema() {
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            score: { type: "number" },
            evidence: { type: "string" },
        },
        required: ["score", "evidence"],
    } as const;
}

/**
 * Run the scoring prompt on Claude (claude-opus-4-8) with structured JSON
 * output constrained to SCORECARD_JSON_SCHEMA; caller parses + validates.
 */
async function generateScorecardJson(userPrompt: string): Promise<string> {
    const response = await getAnthropic().messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system: SCORING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
            format: { type: "json_schema", schema: SCORECARD_JSON_SCHEMA.schema as any },
        },
    });
    if (response.stop_reason === "refusal") throw new Error("Claude refused to score this call");
    const textBlock = response.content.find(
        (b): b is Extract<typeof response.content[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock?.text) throw new Error("Empty response from Claude");
    return textBlock.text;
}

// System/IVR lines that play before (or instead of) a human picking up.
const IVR_LINE = /please wait while we connect|leak wait while we connect|only local handyman service|you have reached our voice ?mail|thank you for calling/i;

/**
 * True when the transcript shows a real two-way conversation — i.e. someone
 * actually handled the call. Filters out IVR-only recordings, voicemail
 * greetings, and failed "Hello? Hello?" connections that otherwise look like
 * answered calls (they carry a transcript and an outcome label).
 */
export function isSubstantiveCallTranscript(transcription: string): boolean {
    const lines = transcription.split("\n").map((l) => l.trim()).filter(Boolean);
    const callerChars = lines
        .filter((l) => l.startsWith("[Caller]"))
        .map((l) => l.replace("[Caller]:", "").trim())
        .join(" ").length;
    const agentChars = lines
        .filter((l) => l.startsWith("[Agent]") && !IVR_LINE.test(l))
        .map((l) => l.replace("[Agent]:", "").trim())
        .join(" ").length;
    return callerChars >= 60 && agentChars >= 20;
}

function clampScore(n: unknown): number {
    const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
    return Math.round(Math.min(100, Math.max(0, v)));
}

/**
 * Score a finished call against the company script.
 * Returns null (without calling the LLM) when the call is unscoreable:
 * missing/short transcription, or a missed/voicemail call.
 */
export async function scoreCall(call: ScorableCall): Promise<CallScorecard | null> {
    const transcription = call.transcription;
    if (!transcription || transcription.length < 100) return null;
    if (!isSubstantiveCallTranscript(transcription)) return null;
    if (call.handledBy === 'missed' || call.handledBy === 'voicemail') return null;
    if (call.outcome && ['MISSED_CALL', 'NO_ANSWER', 'VOICEMAIL', 'VOICEMAIL_LEFT'].includes(call.outcome)) return null;

    const handledBy = call.handledBy === 'ai_agent' ? 'AI agent' : 'human VA';
    const durationLine = call.duration != null ? `${call.duration}s` : 'unknown';
    const ringLine = call.ringSeconds != null ? `${call.ringSeconds}s to answer` : 'unknown';
    const skus = Array.isArray(call.detectedSkusJson)
        ? call.detectedSkusJson.map((s: any) => s?.name || s?.sku || s?.title).filter(Boolean).join(', ')
        : '';

    const userPrompt = [
        `CALL HANDLED BY: ${handledBy}`,
        `CALL DURATION: ${durationLine} (time to answer: ${ringLine})`,
        `LOGGED OUTCOME: ${call.outcome || 'unknown'}`,
        call.jobSummary ? `JOB SUMMARY: ${call.jobSummary}` : null,
        skus ? `DETECTED SERVICES: ${skus}` : null,
        ``,
        `TRANSCRIPT ([Agent]: = call handler, [Caller]: = customer):`,
        transcription.slice(0, 24000),
    ].filter((l) => l !== null).join('\n');

    const raw = await generateScorecardJson(userPrompt);
    const parsed = JSON.parse(raw);

    const dimensions: CallScorecard["dimensions"] = {
        discovery: {
            score: clampScore(parsed.discovery?.score),
            evidence: String(parsed.discovery?.evidence ?? ""),
            captured: {
                name: !!parsed.discovery?.captured?.name,
                phone: !!parsed.discovery?.captured?.phone,
                postcode: !!parsed.discovery?.captured?.postcode,
                jobDescription: !!parsed.discovery?.captured?.jobDescription,
                urgency: !!parsed.discovery?.captured?.urgency,
            },
        },
        conversionBehaviour: {
            score: clampScore(parsed.conversionBehaviour?.score),
            evidence: String(parsed.conversionBehaviour?.evidence ?? ""),
            nextStepSecured: (ALLOWED_NEXT_STEPS as readonly string[]).includes(parsed.conversionBehaviour?.nextStepSecured)
                ? parsed.conversionBehaviour.nextStepSecured
                : 'none',
        },
        rapport: {
            score: clampScore(parsed.rapport?.score),
            evidence: String(parsed.rapport?.evidence ?? ""),
            toneMatch: {
                score: clampScore(parsed.rapport?.toneMatch?.score),
                evidence: String(parsed.rapport?.toneMatch?.evidence ?? ""),
            },
        },
        accuracy: {
            score: clampScore(parsed.accuracy?.score),
            evidence: String(parsed.accuracy?.evidence ?? ""),
        },
    };

    const overall = Math.round(
        dimensions.discovery.score * WEIGHTS.discovery +
        dimensions.conversionBehaviour.score * WEIGHTS.conversionBehaviour +
        dimensions.rapport.score * WEIGHTS.rapport +
        dimensions.accuracy.score * WEIGHTS.accuracy
    );

    const flags = Array.isArray(parsed.flags)
        ? parsed.flags.filter((f: unknown): f is string => (ALLOWED_FLAGS as readonly string[]).includes(f as string))
        : [];

    return {
        version: 5,
        overall,
        dimensions,
        flags,
        coachingNote: String(parsed.coachingNote ?? ""),
        callerName: sanitizeCallerName(parsed.callerName),
        mediaRequestPhrase: sanitizeMediaPhrase(parsed.mediaRequestPhrase),
    };
}

// Normalise the media-request phrase to slot into "video showing us ___".
export function sanitizeMediaPhrase(raw: unknown): string {
    let p = String(raw ?? "").trim().replace(/[.!?,;:\s]+$/, "");
    if (!p || p.length > 90) return "";
    p = p.charAt(0).toLowerCase() + p.slice(1); // mid-sentence, lowercase start
    return p;
}

/**
 * Cheap standalone media-phrase extraction — used to backfill the WhatsApp
 * video-request phrase on already-scored calls. Returns "" if the job is too
 * vague to name specifically.
 */
export async function extractMediaPhrase(transcription: string): Promise<string> {
    if (!transcription || transcription.length < 40) return "";
    const response = await getAnthropic().messages.create({
        model: "claude-opus-4-8",
        max_tokens: 200,
        system: `From this UK handyman-company call transcript ([Caller]: = customer, [Agent]: = handler), write a SHORT noun phrase naming the job to drop into "please send us a video showing us ___". Use "your"/"the" naturally, lowercase start, no trailing punctuation, max ~8 words (e.g. "the leaking tap under your kitchen sink", "your garden fence and the broken panels"). If too vague to name specifically, return "". Respond with JSON: {"mediaRequestPhrase": "..."}.`,
        messages: [{ role: "user", content: transcription.slice(0, 24000) }],
        output_config: {
            format: {
                type: "json_schema",
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: { mediaRequestPhrase: { type: "string" } },
                    required: ["mediaRequestPhrase"],
                },
            },
        },
    });
    if (response.stop_reason === "refusal") return "";
    const textBlock = response.content.find(
        (b): b is Extract<typeof response.content[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock?.text) return "";
    try {
        return sanitizeMediaPhrase(JSON.parse(textBlock.text).mediaRequestPhrase);
    } catch {
        return "";
    }
}

// Guard: never let the agent's own name land as the caller name.
const AGENT_NAMES = /^(ben|courtnee|courtney|handy services|handy)$/i;
function sanitizeCallerName(raw: unknown): string {
    const name = String(raw ?? "").trim();
    if (!name || name.length > 60) return "";
    if (AGENT_NAMES.test(name)) return "";
    if (AGENT_NAMES.test(name.split(/\s+/)[0])) return "";
    return name;
}

/**
 * Cheap standalone name-only extraction from a full transcript — used to
 * backfill customerName where the live pipeline missed it. Returns "" if the
 * caller never states their name (or only the agent's name appears).
 */
export async function extractCallerName(transcription: string): Promise<string> {
    if (!transcription || transcription.length < 40) return "";
    const response = await getAnthropic().messages.create({
        model: "claude-opus-4-8",
        max_tokens: 200,
        system: `Extract the CALLER's own name from this UK handyman-company call transcript ([Caller]: = customer, [Agent]: = the handler). Return ONLY the caller's name (first name, plus surname if given). The handler is called "Ben" (may say "it's Ben" / "Ben from Handy Services") or "Courtnee" — NEVER return "Ben" or "Courtnee". If the caller never gives their own name, return an empty string. Respond with JSON: {"callerName": "..."}.`,
        messages: [{ role: "user", content: transcription.slice(0, 24000) }],
        output_config: {
            format: {
                type: "json_schema",
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: { callerName: { type: "string" } },
                    required: ["callerName"],
                },
            },
        },
    });
    if (response.stop_reason === "refusal") return "";
    const textBlock = response.content.find(
        (b): b is Extract<typeof response.content[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock?.text) return "";
    try {
        return sanitizeCallerName(JSON.parse(textBlock.text).callerName);
    } catch {
        return "";
    }
}
