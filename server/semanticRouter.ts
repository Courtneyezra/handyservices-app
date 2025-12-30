// Phase 4 B4: Semantic Router
// Analyzes input complexity and routes to optimal detection method

export type DetectionMethod = 'keyword' | 'embedding' | 'gpt';

export interface RoutingDecision {
    method: DetectionMethod;
    confidence: number;
    rationale: string;
}

export function routeDetection(text: string): RoutingDecision {
    const normalized = text.toLowerCase().trim();
    const wordCount = normalized.split(/\s+/).length;

    // Complexity indicators
    const hasQuestions = /\?|how|what|when|where|why|which/.test(normalized);
    const hasNegations = /not|don't|doesn't|can't|won't|never/.test(normalized);
    const hasMultipleTasks = /and|also|plus|as well/.test(normalized);
    const hasVagueTerms = /stuff|things|issues|problems|mess/.test(normalized);
    const hasUrgency = /urgent|emergency|asap|immediately|now/.test(normalized);

    // Simple: Direct, specific requests
    if (wordCount <= 5 && !hasQuestions && !hasNegations && !hasVagueTerms) {
        return {
            method: 'keyword',
            confidence: 0.9,
            rationale: 'Simple, direct request - keyword match sufficient'
        };
    }

    // Medium: Clear but detailed requests
    if (wordCount <= 15 && !hasVagueTerms && !hasMultipleTasks) {
        return {
            method: 'embedding',
            confidence: 0.8,
            rationale: 'Detailed request - semantic matching recommended'
        };
    }

    // Complex: Vague, multi-part, or question-based requests
    return {
        method: 'gpt',
        confidence: 0.7,
        rationale: 'Complex request - GPT classification required'
    };
}

// Helper: Get estimated latency for each method
export function getEstimatedLatency(method: DetectionMethod): number {
    const latencies = {
        'keyword': 5,      // 5ms
        'embedding': 50,   // 50ms
        'gpt': 500        // 500ms
    };
    return latencies[method];
}
