import { openai } from "../openai";
import { detectMultipleTasks } from "../skuDetector";
import { generateValuePricingQuote, createAnalyticsLog } from "../value-pricing-engine";
import type { ValuePricingInputs } from "../../shared/schema";

export interface AgentActionPlan {
    intent: 'service_request' | 'emergency' | 'inquiry' | 'spam';
    urgency: 'critical' | 'high' | 'medium' | 'low';
    tasks: Array<{
        sku?: string;
        description: string;
        confidence: number;
        priceEstimate?: number;
    }>;
    recommendedAction: 'create_quote' | 'book_visit' | 'request_video' | 'archive';
    quoteMode: 'simple' | 'hhh' | 'consultation';
    draftReply: string;
    reasoning: string;
    pricingAnalytics?: any; // To debug the pricing engine
    visitReason?: string; // For "Book Visit" form pre-filling
}

// Helper: Extract signals for the Pricing Engine
async function extractContextSignals(transcript: string, customerName?: string): Promise<{
    urgencyReason: 'low' | 'med' | 'high';
    ownershipContext: 'tenant' | 'landlord' | 'homeowner' | 'airbnb' | 'selling';
    desiredTimeframe: 'flex' | 'week' | 'asap';
    clientType: 'residential' | 'commercial';
    intent: 'service_request' | 'emergency' | 'inquiry' | 'spam';
    draftReply: string;
}> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Analyze the transcript for pricing signals.
RETURN JSON:
{
  "urgencyReason": "low" | "med" | "high",
  "ownershipContext": "tenant" | "landlord" | "homeowner" | "airbnb" | "selling",
  "desiredTimeframe": "flex" | "week" | "asap",
  "clientType": "residential" | "commercial",
  "intent": "service_request" | "emergency" | "inquiry" | "spam",
  "draftReply": "string (Start with 'Hi ${customerName || 'there'}', mention 'Thanks for chatting earlier'. State the specific issue (e.g. 'regarding the shower'). Then ask: 'Could you please send a quick video showing us the [issue] so we can confirm the details?')"
}
Defaults: urgency=low, ownership=homeowner, timeframe=flex, client=residential.`
                },
                { role: "user", content: transcript }
            ],
            response_format: { type: "json_object" },
            temperature: 0
        });
        const p = JSON.parse(response.choices[0].message.content || "{}");
        return {
            urgencyReason: p.urgencyReason || 'low',
            ownershipContext: p.ownershipContext || 'homeowner',
            desiredTimeframe: p.desiredTimeframe || 'flex',
            clientType: p.clientType || 'residential',
            intent: p.intent || 'service_request',
            draftReply: p.draftReply || "Thanks for getting in touch. I'm checking that for you now."
        };
    } catch (e) {
        return {
            urgencyReason: 'low', ownershipContext: 'homeowner', desiredTimeframe: 'flex', clientType: 'residential',
            intent: 'service_request', draftReply: "Thanks for your message."
        };
    }
}

/**
 * The "Brain" of the Francis Flow.
 * ORCHESTRATOR: Uses existing tools (SKU Detector, Pricing Engine) to build the plan.
 */
export async function analyzeLeadActionPlan(transcript: string, customerName?: string): Promise<AgentActionPlan> {
    console.log(`[Agent-Classic] Orchestrating tools for transcript: "${transcript.substring(0, 50)}..."`);

    // 1. Parallel: Extract Context + Detect SKUs (The Tools)
    const [context, skuResult] = await Promise.all([
        extractContextSignals(transcript, customerName),
        detectMultipleTasks(transcript)
    ]);

    // 2. Determine Route based on Tool Output
    let recommendedAction: AgentActionPlan['recommendedAction'] = 'request_video';
    let quoteMode: AgentActionPlan['quoteMode'] = 'consultation';
    let urgency: AgentActionPlan['urgency'] = 'medium';
    let selectedTierPrice = 0;
    let analyticsLog = null;

    // Map urgency from pricing engine enum to global enum
    const urgencyMap: Record<string, AgentActionPlan['urgency']> = {
        'low': 'low', 'med': 'medium', 'high': 'high' // 'critical' is reserved for manual override
    };
    urgency = urgencyMap[context.urgencyReason] || 'medium';

    // 3. Logic Tree
    // Note: skuDetector uses 'MIXED_QUOTE' to imply Visit/Complex
    if (skuResult.nextRoute === 'MIXED_QUOTE') {
        recommendedAction = 'book_visit';
        quoteMode = 'consultation';
        if (context.clientType === 'commercial') urgency = 'high';

    } else if (skuResult.nextRoute === 'INSTANT_PRICE' && skuResult.totalMatchedPrice > 0) {
        // --- PRICING ENGINE TOOL CALL ---
        const pricingInputs: ValuePricingInputs = {
            urgencyReason: context.urgencyReason,
            ownershipContext: context.ownershipContext,
            desiredTimeframe: context.desiredTimeframe,
            baseJobPrice: skuResult.totalMatchedPrice,
            clientType: context.clientType,
            jobComplexity: 'medium' // Defaulting to medium for now
        };

        const pricingResult = generateValuePricingQuote(pricingInputs);
        const log = createAnalyticsLog(pricingInputs, pricingResult);
        analyticsLog = log;

        // Success! We have a solid quote.
        recommendedAction = 'create_quote';
        quoteMode = pricingResult.quoteStyle === 'hhh' ? 'hhh' : 'simple';

    } else {
        // Fallback: Video Quote
        recommendedAction = 'request_video';
        quoteMode = 'consultation';
    }

    // 4. Construct Final Plan
    // Map detected tasks to the Agent's task format
    const tasks: AgentActionPlan['tasks'] = skuResult.matchedServices.map(m => ({
        sku: m.sku.skuCode,
        description: m.personalizedName || m.sku.name,
        confidence: m.confidence / 100,
        priceEstimate: m.sku.pricePence / 100 // Convert to pounds for display if needed
    }));

    // If no SKUs matched but we have tasks from GPT split (in detectMultipleTasks)
    if (tasks.length === 0 && skuResult.tasks.length > 0) {
        skuResult.tasks.forEach(t => {
            tasks.push({
                description: t.description,
                confidence: 0,
                priceEstimate: 0
            });
        });
    }

    return {
        intent: context.intent,
        urgency: urgency,
        tasks: tasks,
        recommendedAction: recommendedAction,
        quoteMode: quoteMode,
        draftReply: context.draftReply,
        reasoning: `Tools Used: SKU Detector (Multi-Task), Pricing Engine (${quoteMode}). Route: ${skuResult.nextRoute}.`,
        pricingAnalytics: analyticsLog,

        // PAYLOAD FOR UI:
        // This 'assessmentReason' will be pre-filled in the 'Book Visit' form.
        visitReason: recommendedAction === 'book_visit'
            ? `Diagnosis Required: ${skuResult.rationale || 'Complex issue needs on-site assessment'}`
            : undefined
    };
}
