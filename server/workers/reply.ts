/**
 * Reply Worker — Tone-Aware Customer Message Generation
 *
 * Agent Framework V2, WS4: Conversation Worker.
 *
 * Uses GPT-4o via OpenRouter for natural, human-like replies that:
 * 1. Show understanding of the customer's specific situation
 * 2. Reference their words back to them (builds trust)
 * 3. Adapt tone to match customer's energy (urgent, anxious, relaxed, etc.)
 * 4. Ask ONE gap question if needed (never more)
 *
 * See docs/AGENT_FRAMEWORK_V2_PLAN.md WS4 for architecture details.
 */
import { callLLM } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type {
  ConversationMemory,
  ScopeGap,
  WorkerRun,
} from '../../shared/conversation-memory';

// ==========================================
// SYSTEM PROMPT
// ==========================================

const REPLY_SYSTEM_PROMPT = `You are a friendly, professional handyman service representative.

Your job is to write warm, human replies that:
1. Show you've understood what the customer needs
2. Reference their specific situation (use their words)
3. Ask ONE question if needed (never more)
4. Match their energy/tone

TONE ADAPTATION:
- urgent: Be reassuring, move fast, acknowledge urgency
- anxious: Be patient, explain what happens next
- relaxed: Be friendly, conversational
- price_sensitive: Lead with value, explain what's included
- detailed: Match their detail level
- terse: Keep it short, no fluff

RULES:
- NEVER mention prices, costs, or money
- NEVER commit to dates or times
- NEVER make promises you can't keep
- DO reflect back what they said to show understanding
- DO ask smart, job-specific questions (not generic)

OUTPUT FORMAT (JSON):
{
  "reply": "the message to send",
  "reasoning": "why this reply works for this customer",
  "questionsAsked": ["list of questions in this reply"]
}`;

// ==========================================
// TYPES
// ==========================================

export type ReplyTrigger = 'inbound_message' | 'gaps_identified' | 'sla_chase';

export interface ReplyWorkerInput {
  conversationId: string;
  trigger: ReplyTrigger;
  gapsToAsk?: ScopeGap[];
}

export interface ReplyWorkerOutput {
  reply: string;
  questionsAsked: string[];
  reasoning: string;
  workerRun: {
    id: string;
    durationMs: number;
    tokenUsage: { input: number; output: number };
  };
}

// ==========================================
// MAIN WORKER
// ==========================================

/**
 * Run the reply worker to generate a tone-aware customer message.
 *
 * @param input - Conversation ID, trigger type, and optional gaps to ask
 * @returns Generated reply with metadata
 */
export async function runReplyWorker(input: ReplyWorkerInput): Promise<ReplyWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(input.conversationId);

  // Build context from memory
  const context = buildReplyContext(memory, input);

  // Call GPT-4o via OpenRouter for natural conversation
  const response = await callLLM('conversation', [
    { role: 'system', content: REPLY_SYSTEM_PROMPT },
    { role: 'user', content: context },
  ], { jsonMode: true });

  // Parse response
  let parsed: { reply: string; reasoning: string; questionsAsked?: string[] };
  try {
    const raw = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    parsed = JSON.parse(raw);
  } catch {
    // Fallback if JSON parsing fails
    parsed = {
      reply: response.content,
      reasoning: 'Direct response (JSON parse failed)',
      questionsAsked: [],
    };
  }

  // Mark gaps as asked if included in reply
  if (input.gapsToAsk?.length && memory.scope) {
    const updatedGaps = memory.scope.gaps.map(gap => {
      const wasAsked = input.gapsToAsk?.some(g => g.id === gap.id);
      if (wasAsked) {
        return {
          ...gap,
          asked: true,
          askedAt: new Date().toISOString(),
        };
      }
      return gap;
    });

    await updateMemory(input.conversationId, {
      scope: { ...memory.scope, gaps: updatedGaps },
    }, memory.version);
  }

  // Log worker run
  const workerRun: WorkerRun = {
    id: runId,
    worker: 'reply',
    model: response.model,
    trigger: input.trigger,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: input.gapsToAsk?.length ? ['scope.gaps[].asked'] : [],
    error: null,
    tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
  };

  await appendWorkerRun(input.conversationId, workerRun);

  return {
    reply: parsed.reply,
    questionsAsked: parsed.questionsAsked ?? [],
    reasoning: parsed.reasoning,
    workerRun: {
      id: runId,
      durationMs: response.durationMs,
      tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
    },
  };
}

// ==========================================
// CONTEXT BUILDER
// ==========================================

/**
 * Build the context string for the LLM from conversation memory.
 *
 * Includes:
 * - Customer info (name, type, tone)
 * - Recent messages (last 10)
 * - Photo extractions (items and defects)
 * - Gap questions to work into the reply
 * - Job lines if scoped
 */
function buildReplyContext(memory: ConversationMemory, input: ReplyWorkerInput): string {
  const parts: string[] = [];

  // Customer info from scope
  if (memory.scope) {
    parts.push(`CUSTOMER: ${memory.scope.customerName ?? 'Unknown'}`);
    parts.push(`TONE: ${memory.scope.tone}`);
    parts.push(`TYPE: ${memory.scope.customerType}`);
    if (memory.scope.postcode) {
      parts.push(`LOCATION: ${memory.scope.postcode}`);
    }
  } else {
    parts.push('CUSTOMER: Unknown');
    parts.push('TONE: relaxed');
    parts.push('TYPE: homeowner');
  }

  // Recent messages (last 10)
  const recentMessages = memory.messages.slice(-10);
  if (recentMessages.length > 0) {
    parts.push('\nRECENT CONVERSATION:');
    recentMessages.forEach(m => {
      const direction = m.direction === 'inbound' ? 'CUSTOMER' : 'US';
      parts.push(`${direction}: ${m.content}`);
    });
  }

  // What we know from photos
  if (memory.mediaExtractions.length > 0) {
    parts.push('\nFROM PHOTOS:');
    memory.mediaExtractions.forEach(ext => {
      ext.items.forEach(item => {
        const desc = [
          item.type,
          item.material && `(${item.material})`,
          item.condition && `(${item.condition})`,
          item.location && `at ${item.location}`,
        ].filter(Boolean).join(' ');
        parts.push(`- ${desc}`);
      });
      ext.defects.forEach(def => {
        parts.push(`- DEFECT: ${def.severity} ${def.type} — ${def.description}`);
      });
    });
  }

  // Gaps to ask (work these into the reply naturally)
  if (input.gapsToAsk?.length) {
    parts.push('\nQUESTIONS TO ASK (work these in naturally, max ONE):');
    input.gapsToAsk.forEach(gap => {
      parts.push(`- ${gap.question} (impact: ${gap.impact})`);
    });
  }

  // Job lines if we have them
  if (memory.scope?.lines.length) {
    parts.push("\nJOB LINES WE'VE IDENTIFIED:");
    memory.scope.lines.forEach((line, i) => {
      parts.push(`${i + 1}. ${line.title}`);
      if (line.customerWords) {
        parts.push(`   Customer said: "${line.customerWords}"`);
      }
    });
  }

  // Call transcripts if available
  if (memory.calls.length > 0) {
    const lastCall = memory.calls[memory.calls.length - 1];
    if (lastCall.summary) {
      parts.push(`\nFROM PHONE CALL: ${lastCall.summary}`);
    }
  }

  parts.push('\nWrite a reply that shows understanding and moves the conversation forward.');

  return parts.join('\n');
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get the appropriate greeting based on customer tone.
 */
export function getGreetingForTone(tone: string, name: string | null): string {
  const greeting = name || 'there';

  switch (tone) {
    case 'urgent':
      return `Hi ${greeting},`;
    case 'anxious':
      return `Hi ${greeting},`;
    case 'relaxed':
      return `Hey ${greeting}!`;
    case 'price_sensitive':
      return `Hi ${greeting},`;
    case 'detailed':
      return `Hello ${greeting},`;
    case 'terse':
      return `Hi ${greeting}`;
    default:
      return `Hi ${greeting}!`;
  }
}

/**
 * Check if a reply contains a question.
 */
export function containsQuestion(text: string): boolean {
  return text.includes('?');
}

/**
 * Count questions in a reply.
 */
export function countQuestions(text: string): number {
  return (text.match(/\?/g) || []).length;
}
