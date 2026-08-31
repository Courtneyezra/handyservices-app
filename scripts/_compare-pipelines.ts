/**
 * Side-by-Side Pipeline Comparison Test
 *
 * Compares:
 *   OLD: Linear comms agent (Claude Sonnet 5, single LLM, tool loop)
 *   NEW: Agent Framework V2 (multi-model, specialist workers)
 *
 * Same input → both pipelines → compare outputs
 *
 * Run: npx tsx scripts/_compare-pipelines.ts
 *
 * Options:
 *   --verbose    Show detailed output
 *   --skip-old   Skip old pipeline (just run new)
 *   --skip-new   Skip new pipeline (just run old)
 */

// Load dotenv FIRST before any other imports
import 'dotenv/config';

import { db } from '../server/db';
import { conversations, messages } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';

// Old pipeline imports (using OpenRouter for comparison since Anthropic direct API has model access issues)
import { callLLM } from '../server/llm/openrouter';

// New pipeline imports
import { getOrCreateMemory, updateMemory, getMemory } from '../server/memory';
import { runScopingWorker } from '../server/workers/scoping';
import { runResearchWorker } from '../server/workers/research';
import { runPricingWorker, formatPence } from '../server/workers/pricing';
import { runReplyWorker } from '../server/workers/reply';
import type { MemoryMessage, MediaExtraction } from '../shared/conversation-memory';

// ==========================================
// CONFIG
// ==========================================

const VERBOSE = process.argv.includes('--verbose');
const SKIP_OLD = process.argv.includes('--skip-old');
const SKIP_NEW = process.argv.includes('--skip-new');

// Test conversation - simulates a customer enquiry
const TEST_INPUT = {
  customerMessage: "Hi, my kitchen tap is leaking from the base when I turn it on. It's been getting worse over the past week. Can you help fix it? I'm in NG5 area.",
  customerName: 'Test Customer',
  phone: '+447000000099',
};

// Mock extraction (simulating what vision would produce)
const MOCK_EXTRACTION: MediaExtraction = {
  mediaId: 'test-media-compare',
  model: 'mock',
  extractedAt: new Date().toISOString(),
  items: [
    {
      type: 'tap',
      material: 'chrome',
      condition: 'leaking',
      location: 'kitchen sink',
      confidence: 'high',
    },
  ],
  defects: [
    {
      type: 'leak',
      severity: 'moderate',
      description: 'Water dripping from tap base when turned on, worsening over past week',
      itemRef: 'tap',
    },
  ],
  textFound: [],
  confidence: 0.85,
  raw: '{}',
};

// ==========================================
// TYPES
// ==========================================

interface PipelineResult {
  name: string;
  reply: string;
  durationMs: number;
  tokenUsage: { input: number; output: number };
  pricing?: {
    labour: number;
    materials: number;
    total: number;
  };
  metadata: Record<string, any>;
}

// ==========================================
// OLD PIPELINE (Comms Agent)
// ==========================================

async function runOldPipeline(): Promise<PipelineResult> {
  console.log('\n--- OLD PIPELINE (Single-Model Linear) ---');
  const start = Date.now();

  // Simulates the old linear approach: ONE model does everything in ONE call
  // No specialist workers, no structured memory, just prompt → reply

  const SYSTEM = `You are a friendly, professional handyman service representative.

Your job is to analyze the customer message and write a helpful reply that:
1. Acknowledges their specific issue
2. Shows you understand their situation
3. Asks ONE clarifying question if needed
4. Is warm and professional

RULES:
- NEVER mention specific prices or costs
- NEVER commit to specific dates
- DO reference what the customer told you
- Keep responses concise but warm

OUTPUT FORMAT (JSON):
{
  "reply": "the message to send to the customer",
  "understanding": "what the customer needs",
  "questions_to_ask": ["any clarifying questions"],
  "tone": "detected customer tone"
}`;

  const response = await callLLM('conversation', [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Customer message: "${TEST_INPUT.customerMessage}"\n\nCustomer location: NG5\n\nAnalyze this enquiry and write an appropriate reply.` },
  ], { jsonMode: true, maxTokens: 1000 });

  const durationMs = Date.now() - start;

  // Parse the response
  let reply: string;
  try {
    const raw = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = JSON.parse(raw);
    reply = parsed.reply || response.content;
  } catch {
    reply = response.content;
  }

  return {
    name: 'OLD (Single-Model)',
    reply,
    durationMs,
    tokenUsage: {
      input: response.usage.inputTokens,
      output: response.usage.outputTokens,
    },
    metadata: {
      model: response.model,
      approach: 'single LLM call, no structured workers',
    },
  };
}

// ==========================================
// NEW PIPELINE (Agent Framework V2)
// ==========================================

async function runNewPipeline(): Promise<PipelineResult> {
  console.log('\n--- NEW PIPELINE (Agent Framework V2) ---');
  const start = Date.now();
  const convId = 'compare-test-' + Date.now();

  let totalTokensIn = 0;
  let totalTokensOut = 0;

  // Step 1: Create conversation memory
  const memory = await getOrCreateMemory(convId);

  const message: MemoryMessage = {
    id: 'msg-compare-1',
    content: TEST_INPUT.customerMessage,
    direction: 'inbound',
    phone: TEST_INPUT.phone,
    createdAt: new Date().toISOString(),
  };

  await updateMemory(convId, {
    messages: [message],
    mediaExtractions: [MOCK_EXTRACTION],
  }, memory.version);

  // Step 2: Scoping
  console.log('  [SCOPING]');
  const scopeResult = await runScopingWorker({
    conversationId: convId,
    trigger: 'message_received',
  });
  totalTokensIn += scopeResult.workerRun.tokenUsage.input;
  totalTokensOut += scopeResult.workerRun.tokenUsage.output;

  // Step 3: Research
  console.log('  [RESEARCH]');
  const researchResult = await runResearchWorker(convId);
  totalTokensIn += researchResult.workerRun.tokenUsage.input;
  totalTokensOut += researchResult.workerRun.tokenUsage.output;

  // Step 4: Pricing
  console.log('  [PRICING]');
  const pricingResult = await runPricingWorker(convId);

  // Step 5: Reply
  console.log('  [REPLY]');
  const finalMemory = await getMemory(convId);
  const gapsToAsk = finalMemory?.scope?.gaps.filter(g => !g.asked && g.audience === 'customer').slice(0, 1) ?? [];

  const replyResult = await runReplyWorker({
    conversationId: convId,
    trigger: 'inbound_message',
    gapsToAsk,
  });
  totalTokensIn += replyResult.workerRun.tokenUsage.input;
  totalTokensOut += replyResult.workerRun.tokenUsage.output;

  const durationMs = Date.now() - start;

  return {
    name: 'NEW (V2 Workers)',
    reply: replyResult.reply,
    durationMs,
    tokenUsage: {
      input: totalTokensIn,
      output: totalTokensOut,
    },
    pricing: {
      labour: pricingResult.pricing.labourPence,
      materials: pricingResult.pricing.materialsPence,
      total: pricingResult.pricing.totalPence,
    },
    metadata: {
      workers: ['scoping', 'research', 'pricing', 'reply'],
      models: ['claude-sonnet (scope/research)', 'gpt-4o (reply)'],
      jobLines: scopeResult.scope.lines.length,
      gaps: scopeResult.scope.gaps.length,
      convId,
    },
  };
}

// ==========================================
// COMPARISON
// ==========================================

function compareResults(old: PipelineResult | null, newP: PipelineResult | null) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  COMPARISON RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const results = [old, newP].filter(Boolean) as PipelineResult[];

  // Side by side table
  console.log('METRICS:');
  console.log('─'.repeat(60));
  console.log(`${'Metric'.padEnd(20)} | ${results.map(r => r.name.padEnd(18)).join(' | ')}`);
  console.log('─'.repeat(60));
  console.log(`${'Duration'.padEnd(20)} | ${results.map(r => `${(r.durationMs / 1000).toFixed(1)}s`.padEnd(18)).join(' | ')}`);
  console.log(`${'Tokens (in)'.padEnd(20)} | ${results.map(r => `${r.tokenUsage.input}`.padEnd(18)).join(' | ')}`);
  console.log(`${'Tokens (out)'.padEnd(20)} | ${results.map(r => `${r.tokenUsage.output}`.padEnd(18)).join(' | ')}`);
  console.log(`${'Total tokens'.padEnd(20)} | ${results.map(r => `${r.tokenUsage.input + r.tokenUsage.output}`.padEnd(18)).join(' | ')}`);
  if (newP?.pricing) {
    console.log(`${'Pricing'.padEnd(20)} | ${old ? 'N/A'.padEnd(18) : ''}${newP ? formatPence(newP.pricing.total).padEnd(18) : ''}`);
  }
  console.log('─'.repeat(60));

  // Replies
  console.log('\nGENERATED REPLIES:');
  for (const r of results) {
    console.log(`\n[${r.name}]`);
    console.log('─'.repeat(50));
    console.log(r.reply);
    console.log('─'.repeat(50));
    console.log(`Length: ${r.reply.length} chars`);
  }

  // Efficiency comparison
  if (old && newP) {
    console.log('\n\nEFFICIENCY COMPARISON:');
    console.log('─'.repeat(60));

    const speedup = old.durationMs / newP.durationMs;
    const tokenDiff = (old.tokenUsage.input + old.tokenUsage.output) - (newP.tokenUsage.input + newP.tokenUsage.output);

    console.log(`Speed: NEW is ${speedup > 1 ? speedup.toFixed(1) + 'x faster' : (1/speedup).toFixed(1) + 'x slower'}`);
    console.log(`Tokens: NEW uses ${tokenDiff > 0 ? tokenDiff + ' fewer' : Math.abs(tokenDiff) + ' more'} tokens`);

    if (newP.pricing) {
      console.log(`\nNEW pipeline also produces:`);
      console.log(`  - Structured pricing: ${formatPence(newP.pricing.total)}`);
      console.log(`  - Job lines: ${newP.metadata.jobLines}`);
      console.log(`  - Gaps identified: ${newP.metadata.gaps}`);
    }
  }

  // Metadata
  if (VERBOSE) {
    console.log('\n\nMETADATA:');
    for (const r of results) {
      console.log(`\n[${r.name}]`);
      console.log(JSON.stringify(r.metadata, null, 2));
    }
  }
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Pipeline Comparison: OLD vs NEW');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nTest input: "${TEST_INPUT.customerMessage.slice(0, 60)}..."`);
  console.log(`Location: NG5`);
  console.log(`Skip old: ${SKIP_OLD}, Skip new: ${SKIP_NEW}`);

  let oldResult: PipelineResult | null = null;
  let newResult: PipelineResult | null = null;

  if (!SKIP_OLD) {
    try {
      oldResult = await runOldPipeline();
      console.log(`  ✓ OLD completed in ${(oldResult.durationMs / 1000).toFixed(1)}s`);
    } catch (err: any) {
      console.log(`  ✗ OLD failed: ${err.message}`);
    }
  }

  if (!SKIP_NEW) {
    try {
      newResult = await runNewPipeline();
      console.log(`  ✓ NEW completed in ${(newResult.durationMs / 1000).toFixed(1)}s`);
    } catch (err: any) {
      console.log(`  ✗ NEW failed: ${err.message}`);
    }
  }

  compareResults(oldResult, newResult);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Comparison complete');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Comparison failed:', err);
  process.exit(1);
});
