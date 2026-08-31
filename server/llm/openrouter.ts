/**
 * OpenRouter Integration — unified multi-model API client for Agent Framework V2.
 *
 * OpenRouter provides a single API endpoint for multiple LLM providers (OpenAI,
 * Anthropic, Google, etc.), enabling optimal model selection per task without
 * managing multiple SDK clients. See docs/AGENT_FRAMEWORK_V2_PLAN.md WS2.
 *
 * Model routing strategy:
 * - Vision: Gemini Flash (best price/quality for image understanding)
 * - Conversation: GPT-4o (natural, human-like tone)
 * - Extraction: Claude Sonnet (structured output, low hallucination)
 * - Validation: Claude Opus (complex reasoning, edge cases)
 */
import OpenAI from 'openai';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/** Timeout for OpenRouter API calls (2 minutes). Generous headroom for
 * vision tasks which can take 20-40s on large images. */
const OPENROUTER_TIMEOUT_MS = 2 * 60 * 1000;

// Lazy initialization to allow testing without API key
let _openrouter: OpenAI | null = null;

export function getOpenRouter(): OpenAI {
  if (!_openrouter) {
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY is required for multi-model routing');
    }
    _openrouter = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
      timeout: OPENROUTER_TIMEOUT_MS,
      defaultHeaders: {
        'X-Title': 'V6-Switchboard',
        'HTTP-Referer': 'https://handyservices.app',
      },
    });
  }
  return _openrouter;
}

// Legacy-style proxy export for convenience
export const openrouter = new Proxy({} as OpenAI, {
  get(target, prop) {
    return (getOpenRouter() as any)[prop];
  },
});

/**
 * Model identifiers — mapped to OpenRouter's provider/model format.
 * Each role maps to the best model for that task type.
 */
export const MODELS = {
  // Vision — best accuracy on photos
  vision: 'google/gemini-flash-1.5',

  // Conversation — natural, human-like tone
  conversation: 'openai/gpt-4o',

  // Extraction — structured output, low hallucination
  extraction: 'anthropic/claude-sonnet-4',

  // Validation — complex reasoning, edge cases
  validation: 'anthropic/claude-opus-4',

  // Fallbacks — used when primary model fails
  fallback_vision: 'openai/gpt-4o',
  fallback_conversation: 'anthropic/claude-sonnet-4',
} as const;

export type ModelRole = keyof typeof MODELS;

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}

export interface CallLLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

/**
 * Call an LLM via OpenRouter with automatic model selection by role.
 *
 * @param role - The semantic role determining which model to use
 * @param messages - OpenAI-format chat messages
 * @param options - Temperature, max tokens, JSON mode
 * @returns LLM response with content, model used, and usage stats
 */
export async function callLLM(
  role: ModelRole,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: CallLLMOptions
): Promise<LLMResponse> {
  const model = MODELS[role];
  const start = Date.now();

  try {
    const response = await getOpenRouter().chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      response_format: options?.jsonMode ? { type: 'json_object' } : undefined,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const durationMs = Date.now() - start;

    // Log usage for observability
    console.log(
      `[openrouter:${model}] role=${role} tokens: in=${response.usage?.prompt_tokens ?? 0} ` +
      `out=${response.usage?.completion_tokens ?? 0} duration=${durationMs}ms`
    );

    return {
      content,
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      durationMs,
    };
  } catch (error) {
    // Try fallback for critical roles
    const fallbackRole = `fallback_${role}` as ModelRole;
    if (fallbackRole in MODELS && role !== fallbackRole) {
      console.warn(`[openrouter] ${model} failed, trying fallback ${MODELS[fallbackRole]}`);
      return callLLM(fallbackRole, messages, options);
    }
    throw error;
  }
}

/**
 * Call an LLM with image inputs — for vision tasks.
 *
 * Constructs multimodal messages with base64-encoded images and routes to
 * the vision model. Used by the Vision Worker for photo extraction.
 *
 * @param role - Model role (typically 'vision')
 * @param systemPrompt - System prompt for the vision task
 * @param images - Array of base64-encoded images with media types
 * @param userPrompt - User prompt describing what to extract
 * @param options - JSON mode, etc.
 * @returns LLM response with extracted content
 */
export async function callLLMWithImages(
  role: ModelRole,
  systemPrompt: string,
  images: Array<{ base64: string; mediaType: string }>,
  userPrompt: string,
  options?: { jsonMode?: boolean; maxTokens?: number }
): Promise<LLMResponse> {
  const imageContent: OpenAI.ChatCompletionContentPart[] = images.map(img => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:${img.mediaType};base64,${img.base64}`,
      detail: 'high' as const,
    },
  }));

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        ...imageContent,
        { type: 'text' as const, text: userPrompt },
      ],
    },
  ];

  return callLLM(role, messages, {
    jsonMode: options?.jsonMode,
    maxTokens: options?.maxTokens,
  });
}
