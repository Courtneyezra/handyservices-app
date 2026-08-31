/**
 * Research Worker — Materials and Time Estimation
 *
 * Agent Framework V2, WS6: Research & Pricing Workers.
 *
 * Uses Claude Sonnet via OpenRouter for accurate materials research:
 * 1. Identifies materials needed for each scope line
 * 2. Estimates time with reasoning
 * 3. Generates step-by-step procedure
 * 4. Matches against historical jobs for price anchoring
 *
 * See docs/AGENT_FRAMEWORK_V2_PLAN.md WS6 for architecture details.
 */
import { callLLM } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type {
  ConversationMemory,
  ConversationResearch,
  ResearchedLine,
  WorkerRun,
} from '../../shared/conversation-memory';

// ==========================================
// SYSTEM PROMPT
// ==========================================

const RESEARCH_SYSTEM_PROMPT = `You are a materials and time estimation expert for a UK handyman service.

For each job line, research:
1. Materials needed (name, quantity, approximate price in pence)
2. Time estimate (minutes, with reasoning)
3. Procedure (step-by-step work breakdown)

Use realistic UK prices (Screwfix/Toolstation typical). When uncertain, note "needsReview: true".

OUTPUT FORMAT (JSON):
{
  "lines": [
    {
      "lineId": "matches input line ID",
      "materials": [
        { "name": "15mm compression fitting", "quantity": 2, "unitPricePence": 350, "supplier": "screwfix", "confidence": "high", "needsReview": false }
      ],
      "timeEstimate": { "minutes": 45, "confidence": "medium", "basis": "estimated", "reasoning": "Standard mono mixer, good access" },
      "procedure": ["Isolate water supply", "Disconnect old tap", "Clean connections", "Fit new tap", "Test for leaks"]
    }
  ],
  "historicalMatches": []
}

SUPPLIER OPTIONS: "catalog" (internal stock), "screwfix", "toolstation", "web", "estimated"
CONFIDENCE: "high" (exact match), "medium" (similar item), "low" (rough estimate)
TIME BASIS: "historical" (from past jobs), "estimated" (trade knowledge), "standard" (industry norms)

RULES:
- All prices in PENCE (£3.50 = 350)
- Include consumables (silicone, PTFE tape, screws)
- Account for waste factor on materials (10-15% extra)
- Time includes setup and cleanup
- Flag anything unusual with needsReview: true`;

// ==========================================
// TYPES
// ==========================================

export interface ResearchWorkerOutput {
  research: ConversationResearch;
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
 * Run the research worker to estimate materials and time for scope lines.
 *
 * @param conversationId - The conversation to research
 * @returns Research results with materials, time estimates, and procedures
 * @throws Error if no scope lines to research
 */
export async function runResearchWorker(conversationId: string): Promise<ResearchWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(conversationId);

  if (!memory.scope?.lines.length) {
    throw new Error('No scope lines to research');
  }

  // Update readiness to researching
  await updateMemory(conversationId, { readiness: 'researching' }, memory.version);

  // Build context and call LLM
  const context = buildResearchContext(memory);

  const response = await callLLM('extraction', [
    { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
    { role: 'user', content: context },
  ], { jsonMode: true, maxTokens: 2048 });

  // Parse response
  let parsed: { lines: ResearchedLine[]; historicalMatches?: any[] };
  try {
    const raw = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse research response: ${response.content.slice(0, 200)}`);
  }

  // Build research object
  const research: ConversationResearch = {
    lines: parsed.lines ?? [],
    historicalMatches: parsed.historicalMatches ?? [],
    lastResearchedAt: new Date().toISOString(),
  };

  // Update memory with research results
  const updatedMemory = await getOrCreateMemory(conversationId);
  await updateMemory(conversationId, {
    research,
    readiness: 'researched',
  }, updatedMemory.version);

  // Log worker run
  const workerRun: WorkerRun = {
    id: runId,
    worker: 'research',
    model: response.model,
    trigger: 'scope_complete',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: ['research', 'readiness'],
    error: null,
    tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
  };

  await appendWorkerRun(conversationId, workerRun);

  return {
    research,
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
 * Build context string for the LLM from conversation memory.
 */
function buildResearchContext(memory: ConversationMemory): string {
  const parts: string[] = [];

  // Job lines to research
  parts.push('JOB LINES TO RESEARCH:');
  memory.scope!.lines.forEach((line, i) => {
    parts.push(`\n${i + 1}. ${line.title} [ID: ${line.id}]`);
    parts.push(`   Detail: ${line.detail}`);
    if (line.assumptions.length > 0) {
      parts.push(`   Assumptions: ${line.assumptions.map(a => a.text).join('; ')}`);
    }
    if (line.customerWords) {
      parts.push(`   Customer said: "${line.customerWords}"`);
    }
  });

  // Include media extractions for material identification
  if (memory.mediaExtractions.length > 0) {
    parts.push('\nFROM MEDIA (use for material identification):');
    memory.mediaExtractions.forEach(ext => {
      // Include audio/visual summary for videos
      if (ext.whatIsShown) {
        parts.push(`- Summary: ${ext.whatIsShown}`);
      }
      ext.items.forEach(item => {
        const desc = [
          item.type,
          item.material && `material: ${item.material}`,
          item.condition && `condition: ${item.condition}`,
          item.location && `at ${item.location}`,
        ].filter(Boolean).join(', ');
        parts.push(`- ${desc}`);
      });
      ext.defects.forEach(def => {
        parts.push(`- DEFECT: ${def.severity} ${def.type} — ${def.description}`);
      });
      if (ext.textFound.length > 0) {
        parts.push(`- Text/brands found: ${ext.textFound.join(', ')}`);
      }
    });
  }

  // Location context
  if (memory.scope?.postcode) {
    parts.push(`\nLOCATION: ${memory.scope.postcode}`);
  }

  parts.push('\nResearch materials, time, and procedure for each line. Use the line IDs provided.');

  return parts.join('\n');
}
