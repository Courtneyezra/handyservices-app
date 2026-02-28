/**
 * Response Interpreter
 *
 * LLM-powered response interpretation that maps user messages
 * to expected responses in troubleshooting flows.
 */

import { getOpenAI } from '../openai';
import { FlowStep, ExpectedResponse } from './flow-schema';

/**
 * Result of interpreting a user response
 */
export interface ResponseInterpretation {
    matchedResponseId: string | null;
    confidence: number;
    extractedData: Record<string, unknown>;
    mediaReceived?: { type: 'photo' | 'video'; url: string };
    sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
    needsClarification: boolean;
}

/**
 * Interpret a user's response in the context of a troubleshooting step
 *
 * Uses GPT-4o-mini to understand natural language responses and map them
 * to the expected response patterns defined in the flow step.
 */
export async function interpretUserResponse(
    userMessage: string,
    currentStep: FlowStep,
    conversationContext: Record<string, unknown>
): Promise<ResponseInterpretation> {
    console.log('[ResponseInterpreter] Interpreting response:', {
        userMessage: userMessage.substring(0, 100),
        stepId: currentStep.id,
        stepType: currentStep.type,
        expectedResponseCount: currentStep.expectedResponses?.length || 0
    });

    // First, try pattern matching for quick responses
    const patternMatch = tryPatternMatch(userMessage, currentStep.expectedResponses || []);
    if (patternMatch) {
        console.log('[ResponseInterpreter] Pattern match found:', patternMatch);
        return {
            matchedResponseId: patternMatch,
            confidence: 0.95,
            extractedData: {},
            sentiment: 'neutral',
            needsClarification: false
        };
    }

    // Fall back to LLM interpretation for complex responses
    try {
        const openai = getOpenAI();

        const expectedResponsesDesc = (currentStep.expectedResponses || []).map(r => ({
            id: r.id,
            semanticMatch: r.semanticMatch,
            examples: r.examples
        }));

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a response interpreter for a troubleshooting chatbot. Your job is to understand what the user means and map it to one of the expected responses.

CURRENT STEP: ${currentStep.template}

EXPECTED RESPONSES:
${JSON.stringify(expectedResponsesDesc, null, 2)}

CONVERSATION CONTEXT:
${JSON.stringify(conversationContext, null, 2)}

Analyze the user's message and return JSON:
{
  "matchedResponseId": string | null,  // The ID of the best matching expected response, or null if no match
  "confidence": number,                 // 0.0 to 1.0 confidence in the match
  "extractedData": object,              // Any useful data extracted (e.g., {"pressure": "1.2 bar"})
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "needsClarification": boolean,        // True if the response is ambiguous
  "reasoning": string                   // Brief explanation of your interpretation
}

Guidelines:
- Match based on semantic meaning, not exact words
- Extract any specific values mentioned (numbers, colors, locations)
- Detect frustration if user expresses impatience or confusion
- Set needsClarification if response could match multiple options
- Confidence should be high (>0.8) only for clear matches`
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        console.log('[ResponseInterpreter] LLM interpretation:', {
            matchedResponseId: result.matchedResponseId,
            confidence: result.confidence,
            sentiment: result.sentiment,
            reasoning: result.reasoning
        });

        return {
            matchedResponseId: result.matchedResponseId || null,
            confidence: result.confidence || 0.5,
            extractedData: result.extractedData || {},
            sentiment: result.sentiment || 'neutral',
            needsClarification: result.needsClarification || false
        };

    } catch (error) {
        console.error('[ResponseInterpreter] LLM interpretation failed:', error);

        // Return a safe default that triggers clarification
        return {
            matchedResponseId: null,
            confidence: 0,
            extractedData: {},
            sentiment: 'neutral',
            needsClarification: true
        };
    }
}

/**
 * Try to match the user message against expected response patterns
 * Returns the response ID if a pattern matches, null otherwise
 */
function tryPatternMatch(
    userMessage: string,
    expectedResponses: ExpectedResponse[]
): string | null {
    const normalizedMessage = userMessage.toLowerCase().trim();

    for (const response of expectedResponses) {
        for (const pattern of response.patterns) {
            try {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(normalizedMessage)) {
                    return response.id;
                }
            } catch (e) {
                // If pattern is not valid regex, try exact match
                if (normalizedMessage.includes(pattern.toLowerCase())) {
                    return response.id;
                }
            }
        }
    }

    return null;
}

/**
 * Detect if a message contains media (photos/videos)
 * In a real implementation, this would check for actual media attachments
 */
export function detectMedia(
    messageContent: string,
    attachments?: Array<{ type: string; url: string }>
): { type: 'photo' | 'video'; url: string } | undefined {
    if (!attachments || attachments.length === 0) {
        return undefined;
    }

    const mediaAttachment = attachments.find(
        a => a.type.startsWith('image/') || a.type.startsWith('video/')
    );

    if (mediaAttachment) {
        return {
            type: mediaAttachment.type.startsWith('image/') ? 'photo' : 'video',
            url: mediaAttachment.url
        };
    }

    return undefined;
}

/**
 * Extract specific data types from user messages
 */
export function extractDataFromMessage(
    message: string,
    dataTypes: string[]
): Record<string, unknown> {
    const extracted: Record<string, unknown> = {};

    for (const dataType of dataTypes) {
        switch (dataType) {
            case 'pressure':
                // Match pressure readings like "1.2 bar", "0.5bar", "1 bar"
                const pressureMatch = message.match(/(\d+\.?\d*)\s*bar/i);
                if (pressureMatch) {
                    extracted.pressure = parseFloat(pressureMatch[1]);
                }
                break;

            case 'temperature':
                // Match temperature readings like "15 degrees", "20C", "18 celsius"
                const tempMatch = message.match(/(\d+\.?\d*)\s*(degrees?|c|celsius)/i);
                if (tempMatch) {
                    extracted.temperature = parseFloat(tempMatch[1]);
                }
                break;

            case 'location':
                // Common room/location keywords
                const locationKeywords = ['kitchen', 'bathroom', 'bedroom', 'living room', 'lounge', 'toilet', 'shower', 'sink', 'utility', 'basement', 'attic', 'garage'];
                for (const loc of locationKeywords) {
                    if (message.toLowerCase().includes(loc)) {
                        extracted.location = loc;
                        break;
                    }
                }
                break;

            case 'yes_no':
                const yesNoMatch = message.toLowerCase().match(/^(yes|no|yeah|nope|yep|nah|y|n)$/);
                if (yesNoMatch) {
                    extracted.yesNo = ['yes', 'yeah', 'yep', 'y'].includes(yesNoMatch[1]) ? 'yes' : 'no';
                }
                break;

            default:
                // Unknown data type, skip
                break;
        }
    }

    return extracted;
}
