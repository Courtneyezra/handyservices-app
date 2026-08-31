/**
 * Model Router — intelligent model selection based on task and context.
 *
 * Routes requests to the optimal LLM model based on:
 * - Task type (vision, reply, scope, research, pricing, validation)
 * - Job complexity (simple vs complex)
 * - Price threshold (expensive jobs get Opus validation)
 *
 * See docs/AGENT_FRAMEWORK_V2_PLAN.md WS2 for architecture details.
 */
import { MODELS, callLLM, type ModelRole, type LLMResponse } from './openrouter';
import type OpenAI from 'openai';

/**
 * Minimal memory shape for routing decisions.
 * Full ConversationMemory comes from WS1 (shared/conversation-memory.ts).
 * This interface allows the router to work before WS1 is complete.
 */
export interface RoutingMemory {
  scope?: {
    lines?: Array<{ id: string }>;
  } | null;
  pricing?: {
    totalPence?: number;
  } | null;
}

export interface RoutingContext {
  memory: RoutingMemory;
  task: 'vision' | 'reply' | 'scope' | 'research' | 'pricing' | 'message' | 'validation';
  complexity?: 'simple' | 'complex';
}

/**
 * Select the optimal model for a given task and context.
 *
 * Routing rules:
 * - vision: Always use vision model (Gemini Flash)
 * - reply: Always use conversation model (GPT-4o) for natural tone
 * - scope/research/pricing/message: Use extraction model (Claude Sonnet)
 * - validation: Use Opus for complex jobs, Sonnet for simple ones
 *
 * Complexity triggers for validation upgrade:
 * - Job has more than 3 line items
 * - Total price exceeds £500
 * - Explicit 'complex' flag
 *
 * @param context - Task type, memory state, and complexity hint
 * @returns The model role to use
 */
export function selectModel(context: RoutingContext): ModelRole {
  const { task, complexity, memory } = context;

  switch (task) {
    case 'vision':
      return 'vision';

    case 'reply':
      return 'conversation';

    case 'scope':
    case 'research':
    case 'pricing':
    case 'message':
      return 'extraction';

    case 'validation': {
      // Use Opus for complex jobs, Sonnet for simple ones
      if (complexity === 'complex') return 'validation';

      // More than 3 scope lines = complex
      const lineCount = memory?.scope?.lines?.length ?? 0;
      if (lineCount > 3) return 'validation';

      // Over £500 = complex (pricing in pence)
      const totalPence = memory?.pricing?.totalPence ?? 0;
      if (totalPence > 50000) return 'validation';

      // Default to extraction for simple validation
      return 'extraction';
    }

    default:
      return 'extraction';
  }
}

/**
 * Call LLM with automatic model routing based on context.
 *
 * Convenience wrapper that combines selectModel + callLLM. Logs the
 * routing decision for observability.
 *
 * @param context - Routing context (task, memory, complexity)
 * @param messages - Chat messages
 * @param options - LLM call options
 * @returns LLM response
 */
export async function routedLLMCall(
  context: RoutingContext,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<LLMResponse> {
  const role = selectModel(context);
  console.log(`[Router] Task: ${context.task}, Model: ${MODELS[role]}, Role: ${role}`);
  return callLLM(role, messages, options);
}
