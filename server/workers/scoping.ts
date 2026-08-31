/**
 * Scoping Worker — Claude Sonnet-powered job scope extraction.
 *
 * Agent Framework V2, WS5: Scoping Worker.
 *
 * Analyzes conversation and photo extractions to extract:
 * - Customer info (name, type, tone)
 * - Job lines (what needs to be done)
 * - Assumptions (what we're assuming)
 * - Gaps (what we still need to know)
 *
 * Uses Claude Sonnet via OpenRouter for structured extraction with low hallucination.
 * Updates the ConversationMemory with scope for downstream workers.
 */

import { callLLM } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type {
  ConversationMemory,
  ConversationScope,
  ScopeLine,
  ScopeGap,
  ScopeAssumption,
  MemoryMessage,
  MemoryReadiness,
  Blocker,
} from '../../shared/conversation-memory';

// ==========================================
// SCOPING PROMPT
// ==========================================

const SCOPING_SYSTEM_PROMPT = `You are a quote intake clerk for a handyman service.

Analyze the conversation and photos to extract:
1. What job(s) the customer needs
2. Key details from photos (use the structured extractions provided)
3. What assumptions we're making
4. What questions we still need answered

CRITICAL: Use the customer's own words in your output. This helps us write human-like replies.

RULES:
- Max 60 characters for line titles
- Split multi-part jobs into separate lines
- Note assumptions with confidence level
- Only flag gaps that would meaningfully change the price
- Detect customer tone from their message style

OUTPUT FORMAT (JSON):
{
  "customerName": "string or null",
  "customerType": "homeowner | landlord | letting_agent | business",
  "tone": "urgent | anxious | relaxed | price_sensitive | detailed | terse",
  "lines": [
    {
      "id": "uuid",
      "title": "customer-facing title, max 60 chars",
      "detail": "internal notes with evidence",
      "customerWords": "exact quote from customer about this",
      "assumptions": [
        { "text": "assumption", "confidence": "observed | inferred | assumed", "source": "photo | customer_said | typical_for_job" }
      ]
    }
  ],
  "gaps": [
    {
      "id": "uuid",
      "question": "what to ask, ending in ?",
      "audience": "customer | ben",
      "lineId": "which line this relates to, or null",
      "impact": "none | small | large | forks_job"
    }
  ],
  "readiness": "quote_ready | needs_info | visit_first | decline",
  "declineReason": "gas_work | roofing_height | structural | major_electrical | null"
}`;

// ==========================================
// TYPES
// ==========================================

export interface ScopingWorkerInput {
  conversationId: string;
  trigger: 'message_received' | 'media_extracted' | 'gap_answered';
}

export interface ScopingWorkerOutput {
  scope: ConversationScope;
  readiness: MemoryReadiness;
  workerRun: {
    durationMs: number;
    tokenUsage: { input: number; output: number };
  };
}

/** Raw LLM output structure */
interface ScopingRawOutput {
  customerName?: string | null;
  customerType?: 'homeowner' | 'landlord' | 'letting_agent' | 'business';
  tone?: 'urgent' | 'anxious' | 'relaxed' | 'price_sensitive' | 'detailed' | 'terse';
  lines?: Array<{
    id?: string;
    title?: string;
    detail?: string;
    customerWords?: string;
    assumptions?: Array<{
      text?: string;
      confidence?: 'observed' | 'inferred' | 'assumed';
      source?: 'photo' | 'customer_said' | 'typical_for_job';
    }>;
  }>;
  gaps?: Array<{
    id?: string;
    question?: string;
    audience?: 'customer' | 'ben';
    lineId?: string | null;
    impact?: 'none' | 'small' | 'large' | 'forks_job';
  }>;
  readiness?: 'quote_ready' | 'needs_info' | 'visit_first' | 'decline';
  declineReason?: 'gas_work' | 'roofing_height' | 'structural' | 'major_electrical' | null;
}

// ==========================================
// CONTEXT BUILDING
// ==========================================

/**
 * Build the context string for the scoping LLM call.
 * Includes conversation messages, photo extractions, and previous scope if any.
 */
function buildScopingContext(memory: ConversationMemory): string {
  const parts: string[] = [];

  // All messages
  parts.push('CONVERSATION:');
  memory.messages.forEach(m => {
    const direction = m.direction === 'inbound' ? 'CUSTOMER' : 'US';
    parts.push(`[${m.createdAt}] ${direction}: ${m.content}`);
  });

  // Photo/video extractions from vision worker
  if (memory.mediaExtractions.length > 0) {
    parts.push('\nMEDIA ANALYSIS (from vision model):');
    memory.mediaExtractions.forEach((ext, i) => {
      parts.push(`\nMedia ${i + 1}:`);
      // What the media shows (includes audio transcription for videos)
      if (ext.whatIsShown) {
        parts.push(`Summary: ${ext.whatIsShown}`);
      }
      if (ext.whatIsMissing) {
        parts.push(`Missing info: ${ext.whatIsMissing}`);
      }
      parts.push(`Items: ${JSON.stringify(ext.items)}`);
      parts.push(`Defects: ${JSON.stringify(ext.defects)}`);
      if (ext.textFound.length) {
        parts.push(`Text found: ${ext.textFound.join(', ')}`);
      }
    });
  }

  // Previous scope if exists (for incremental updates)
  if (memory.scope) {
    parts.push('\nPREVIOUS SCOPE (update if new info):');
    parts.push(JSON.stringify(memory.scope, null, 2));
  }

  parts.push('\nExtract the job scope from this conversation.');

  return parts.join('\n');
}

// ==========================================
// POSTCODE EXTRACTION
// ==========================================

/**
 * Extract UK postcode from messages if present.
 */
function extractPostcode(messages: MemoryMessage[]): string | null {
  // UK postcode regex: 1-2 letters, 1-2 digits, optional space, digit, 2 letters
  const postcodeRegex = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
  for (const msg of messages) {
    const match = msg.content?.match(postcodeRegex);
    if (match) return match[1].toUpperCase().replace(/\s+/g, ' ');
  }
  return null;
}

// ==========================================
// OUTPUT PARSING
// ==========================================

/**
 * Parse and validate raw LLM output into typed scope data.
 */
function parseScopingOutput(
  raw: ScopingRawOutput,
  memory: ConversationMemory
): ConversationScope {
  // Parse lines with proper typing
  const lines: ScopeLine[] = (raw.lines ?? []).map((line) => ({
    id: line.id ?? crypto.randomUUID(),
    title: (line.title ?? 'Untitled job').slice(0, 60),
    detail: line.detail ?? '',
    customerWords: line.customerWords ?? '',
    assumptions: (line.assumptions ?? []).map((a) => ({
      text: a.text ?? '',
      confidence: a.confidence ?? 'assumed',
      source: a.source ?? 'typical_for_job',
    })),
    evidence: {
      messageIds: [],
      mediaIds: memory.mediaExtractions.map(e => e.mediaId),
      callIds: [],
    },
  }));

  // Parse gaps with proper typing
  const gaps: ScopeGap[] = (raw.gaps ?? []).map((gap) => ({
    id: gap.id ?? crypto.randomUUID(),
    question: gap.question ?? '',
    audience: gap.audience ?? 'customer',
    lineId: gap.lineId ?? null,
    impact: gap.impact ?? 'small',
    asked: false,
    askedAt: null,
    answered: false,
    answeredAt: null,
    answer: null,
  }));

  // Collect all assumptions from lines
  const assumptions: ScopeAssumption[] = lines.flatMap(l => l.assumptions);

  return {
    customerName: raw.customerName ?? null,
    phone: memory.messages[0]?.phone ?? '',
    postcode: extractPostcode(memory.messages),
    customerType: raw.customerType ?? 'homeowner',
    tone: raw.tone ?? 'relaxed',
    lines,
    assumptions,
    gaps,
    lastScopedAt: new Date().toISOString(),
  };
}

/**
 * Determine memory readiness based on scope and LLM output.
 */
function determineReadiness(
  scope: ConversationScope,
  rawReadiness: ScopingRawOutput['readiness']
): MemoryReadiness {
  // Check for unanswered customer gaps
  const customerGaps = scope.gaps.filter(g => g.audience === 'customer' && !g.answered);

  if (customerGaps.length > 0) {
    return 'gathering';
  }

  if (rawReadiness === 'decline' || rawReadiness === 'visit_first') {
    return 'needs_human';
  }

  return 'scoped';
}

/**
 * Build blockers array if there's a decline reason.
 */
function buildBlockers(
  declineReason: ScopingRawOutput['declineReason'],
  existingBlockers: Blocker[]
): Blocker[] {
  if (!declineReason) {
    return existingBlockers;
  }

  return [{
    type: 'decline_trade',
    reason: declineReason,
    createdAt: new Date().toISOString(),
  }];
}

// ==========================================
// MAIN WORKER
// ==========================================

/**
 * Run the scoping worker to extract job scope from conversation.
 *
 * This worker:
 * 1. Builds context from conversation and photo extractions
 * 2. Sends to Claude Sonnet via OpenRouter for extraction
 * 3. Parses the structured JSON output
 * 4. Updates ConversationMemory with scope
 * 5. Logs the worker run for audit trail
 *
 * @param input - Scoping worker input with conversation ID and trigger
 * @returns Scope results and worker run metadata
 */
export async function runScopingWorker(input: ScopingWorkerInput): Promise<ScopingWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(input.conversationId);

  // Build context for LLM
  const context = buildScopingContext(memory);

  // Call the extraction model (Claude Sonnet)
  let response;
  try {
    response = await callLLM('extraction', [
      { role: 'system', content: SCOPING_SYSTEM_PROMPT },
      { role: 'user', content: context },
    ], { jsonMode: true });
  } catch (error: any) {
    // Log the failed run
    await appendWorkerRun(input.conversationId, {
      id: runId,
      worker: 'scoping',
      model: 'claude-sonnet',
      trigger: input.trigger,
      startedAt: new Date(start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      changes: [],
      error: error?.message ?? 'Unknown error',
      tokenUsage: null,
    });
    throw error;
  }

  // Parse the JSON response (strip markdown code blocks if present)
  let parsed: ScopingRawOutput;
  try {
    const raw = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    parsed = JSON.parse(raw);
  } catch (parseError) {
    console.warn(`[ScopingWorker] Failed to parse JSON response: ${response.content.slice(0, 200)}...`);
    parsed = {};
  }

  // Build the scope result
  const scope = parseScopingOutput(parsed, memory);
  const readiness = determineReadiness(scope, parsed.readiness);
  const blockers = buildBlockers(parsed.declineReason, memory.blockers);

  // Update conversation memory
  await updateMemory(input.conversationId, {
    scope,
    readiness,
    blockers,
  }, memory.version);

  // Log the worker run
  await appendWorkerRun(input.conversationId, {
    id: runId,
    worker: 'scoping',
    model: response.model,
    trigger: input.trigger,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: ['scope', 'readiness'],
    error: null,
    tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
  });

  return {
    scope,
    readiness,
    workerRun: {
      durationMs: response.durationMs,
      tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
    },
  };
}

/**
 * Re-scope a conversation after a gap has been answered.
 *
 * Marks the gap as answered and re-runs scoping with updated context.
 *
 * @param conversationId - The conversation to re-scope
 * @param gapId - The gap that was answered
 * @param answer - The customer's answer
 * @returns Updated scope
 */
export async function rescopeAfterGapAnswer(
  conversationId: string,
  gapId: string,
  answer: string
): Promise<ScopingWorkerOutput> {
  const memory = await getOrCreateMemory(conversationId);

  // Mark the gap as answered
  if (memory.scope) {
    const updatedGaps = memory.scope.gaps.map(gap => {
      if (gap.id === gapId) {
        return {
          ...gap,
          answered: true,
          answeredAt: new Date().toISOString(),
          answer,
        };
      }
      return gap;
    });

    await updateMemory(conversationId, {
      scope: { ...memory.scope, gaps: updatedGaps },
    }, memory.version);
  }

  // Re-run scoping with updated context
  return runScopingWorker({
    conversationId,
    trigger: 'gap_answered',
  });
}
