/**
 * End-to-End Pipeline Test for Agent Framework V2
 *
 * Tests the full pipeline: message → vision → scoping → research → pricing → reply
 *
 * This is an INTEGRATION test that makes real LLM calls.
 * Estimated cost: ~$0.05-0.10 per run (vision + 3 LLM calls)
 *
 * Run: npx tsx scripts/_e2e-agent-pipeline.ts
 *
 * Options:
 *   --skip-vision    Skip vision worker (use mock extraction)
 *   --verbose        Show detailed output at each stage
 */

import fs from 'fs';
import path from 'path';
import { getOrCreateMemory, updateMemory, getMemory } from '../server/memory';
import { runVisionWorker, loadImageAsBase64 } from '../server/workers/vision';
import { runScopingWorker } from '../server/workers/scoping';
import { runResearchWorker } from '../server/workers/research';
import { runPricingWorker, formatPence } from '../server/workers/pricing';
import { runReplyWorker } from '../server/workers/reply';
import type { MemoryMessage, MediaExtraction } from '../shared/conversation-memory';

// ==========================================
// CONFIG
// ==========================================

const TEST_CONV_ID = 'e2e-test-' + Date.now();
const VERBOSE = process.argv.includes('--verbose');
const SKIP_VISION = process.argv.includes('--skip-vision');

// Test image - use an existing image from the codebase
const TEST_IMAGE_PATH = path.join(
  process.cwd(),
  'server/storage/media/contractors/gallery/gallery-1767698178792-d3235b60-d5f8-472e-aaa7-9305fcd5d1ce.jpg'
);

// ==========================================
// HELPERS
// ==========================================

function log(stage: string, message: string, data?: any) {
  console.log(`[${stage}] ${message}`);
  if (VERBOSE && data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function success(stage: string, message: string) {
  console.log(`✓ [${stage}] ${message}`);
}

function fail(stage: string, message: string) {
  console.log(`✗ [${stage}] ${message}`);
  process.exit(1);
}

// ==========================================
// MOCK DATA (for skip-vision mode)
// ==========================================

const MOCK_EXTRACTION: MediaExtraction = {
  mediaId: 'test-media-1',
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
      description: 'Water dripping from tap base when turned on',
      itemRef: 'tap',
    },
  ],
  textFound: [],
  confidence: 0.85,
  raw: '{}',
};

// ==========================================
// PIPELINE STAGES
// ==========================================

async function stage1_CreateConversation(): Promise<void> {
  log('INIT', 'Creating test conversation...');

  const memory = await getOrCreateMemory(TEST_CONV_ID);

  // Add initial customer message
  const message: MemoryMessage = {
    id: 'msg-1',
    content: "Hi, my kitchen tap is leaking badly. Water's dripping from the base when I turn it on. Can you help? Here's a photo.",
    direction: 'inbound',
    phone: '+447000000001',
    createdAt: new Date().toISOString(),
  };

  await updateMemory(TEST_CONV_ID, {
    messages: [message],
    media: [{
      id: 'test-media-1',
      path: TEST_IMAGE_PATH,
      mediaType: 'image/jpeg',
      messageId: 'msg-1',
      createdAt: new Date().toISOString(),
    }],
  }, memory.version);

  success('INIT', `Created conversation: ${TEST_CONV_ID}`);
}

async function stage2_Vision(): Promise<void> {
  if (SKIP_VISION) {
    log('VISION', 'Skipping vision worker (--skip-vision flag)');

    // Insert mock extraction
    const memory = await getMemory(TEST_CONV_ID);
    if (!memory) throw new Error('Memory not found');

    await updateMemory(TEST_CONV_ID, {
      mediaExtractions: [MOCK_EXTRACTION],
      readiness: 'extracting_media',
    }, memory.version);

    success('VISION', 'Inserted mock extraction');
    return;
  }

  log('VISION', 'Running vision worker...');

  // Check if test image exists
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    fail('VISION', `Test image not found: ${TEST_IMAGE_PATH}`);
  }

  try {
    const result = await runVisionWorker({
      conversationId: TEST_CONV_ID,
      mediaId: 'test-media-1',
      mediaPath: TEST_IMAGE_PATH,
      mediaType: 'image/jpeg',
      customerContext: 'Kitchen tap is leaking from the base',
    });

    log('VISION', `Extracted ${result.extraction.items.length} items, ${result.extraction.defects.length} defects`);
    log('VISION', `Confidence: ${(result.extraction.confidence * 100).toFixed(0)}%`);
    log('VISION', `Duration: ${result.workerRun.durationMs}ms, Tokens: ${result.workerRun.tokenUsage.input}/${result.workerRun.tokenUsage.output}`);

    if (VERBOSE) {
      console.log('Items:', result.extraction.items);
      console.log('Defects:', result.extraction.defects);
    }

    success('VISION', 'Vision extraction complete');
  } catch (err: any) {
    fail('VISION', `Vision worker failed: ${err.message}`);
  }
}

async function stage3_Scoping(): Promise<void> {
  log('SCOPING', 'Running scoping worker...');

  try {
    const result = await runScopingWorker({
      conversationId: TEST_CONV_ID,
      trigger: 'media_extracted',
    });

    log('SCOPING', `Extracted ${result.scope.lines.length} job lines, ${result.scope.gaps.length} gaps`);
    log('SCOPING', `Customer type: ${result.scope.customerType}, Tone: ${result.scope.tone}`);
    log('SCOPING', `Readiness: ${result.readiness}`);
    log('SCOPING', `Duration: ${result.workerRun.durationMs}ms`);

    if (VERBOSE) {
      console.log('Lines:', result.scope.lines.map(l => l.title));
      console.log('Gaps:', result.scope.gaps.map(g => g.question));
    }

    if (result.scope.lines.length === 0) {
      fail('SCOPING', 'No job lines extracted - cannot proceed to research');
    }

    success('SCOPING', 'Scope extraction complete');
  } catch (err: any) {
    fail('SCOPING', `Scoping worker failed: ${err.message}`);
  }
}

async function stage4_Research(): Promise<void> {
  log('RESEARCH', 'Running research worker...');

  try {
    const result = await runResearchWorker(TEST_CONV_ID);

    log('RESEARCH', `Researched ${result.research.lines.length} lines`);

    for (const line of result.research.lines) {
      const materialsCost = line.materials.reduce((sum, m) => sum + m.unitPricePence * m.quantity, 0);
      log('RESEARCH', `  - ${line.lineId}: ${line.materials.length} materials (${formatPence(materialsCost)}), ${line.timeEstimate.minutes} mins`);
    }

    log('RESEARCH', `Duration: ${result.workerRun.durationMs}ms`);

    success('RESEARCH', 'Research complete');
  } catch (err: any) {
    fail('RESEARCH', `Research worker failed: ${err.message}`);
  }
}

async function stage5_Pricing(): Promise<void> {
  log('PRICING', 'Running pricing worker...');

  try {
    const result = await runPricingWorker(TEST_CONV_ID);

    log('PRICING', `Labour: ${formatPence(result.pricing.labourPence)}`);
    log('PRICING', `Materials: ${formatPence(result.pricing.materialsPence)}`);
    log('PRICING', `Subtotal: ${formatPence(result.pricing.subtotalPence)}`);
    log('PRICING', `VAT: ${formatPence(result.pricing.vatPence)}`);
    log('PRICING', `TOTAL: ${formatPence(result.pricing.totalPence)}`);
    log('PRICING', `Margin: ${(result.pricing.margin * 100).toFixed(1)}%`);
    log('PRICING', `Duration: ${result.workerRun.durationMs}ms`);

    success('PRICING', 'Pricing complete');
  } catch (err: any) {
    fail('PRICING', `Pricing worker failed: ${err.message}`);
  }
}

async function stage6_Reply(): Promise<void> {
  log('REPLY', 'Running reply worker...');

  try {
    // Get any unanswered gaps to include in reply
    const memory = await getMemory(TEST_CONV_ID);
    const gapsToAsk = memory?.scope?.gaps.filter(g => !g.asked && g.audience === 'customer').slice(0, 1) ?? [];

    const result = await runReplyWorker({
      conversationId: TEST_CONV_ID,
      trigger: 'inbound_message',
      gapsToAsk,
    });

    log('REPLY', `Generated reply (${result.reply.length} chars)`);
    log('REPLY', `Questions asked: ${result.questionsAsked.length}`);
    log('REPLY', `Duration: ${result.workerRun.durationMs}ms`);

    console.log('\n--- GENERATED REPLY ---');
    console.log(result.reply);
    console.log('--- END REPLY ---\n');

    if (VERBOSE) {
      console.log('Reasoning:', result.reasoning);
    }

    success('REPLY', 'Reply generation complete');
  } catch (err: any) {
    fail('REPLY', `Reply worker failed: ${err.message}`);
  }
}

async function stage7_Verify(): Promise<void> {
  log('VERIFY', 'Verifying final memory state...');

  const memory = await getMemory(TEST_CONV_ID);
  if (!memory) {
    fail('VERIFY', 'Memory not found');
    return;
  }

  const checks = [
    { name: 'Messages', ok: memory.messages.length > 0, value: memory.messages.length },
    { name: 'Media extractions', ok: memory.mediaExtractions.length > 0, value: memory.mediaExtractions.length },
    { name: 'Scope', ok: !!memory.scope, value: memory.scope?.lines.length ?? 0 },
    { name: 'Research', ok: !!memory.research, value: memory.research?.lines.length ?? 0 },
    { name: 'Pricing', ok: !!memory.pricing, value: memory.pricing?.totalPence ?? 0 },
    { name: 'Worker runs', ok: memory.workerRuns.length >= 4, value: memory.workerRuns.length },
    { name: 'Readiness', ok: memory.readiness === 'priced', value: memory.readiness },
  ];

  console.log('\nFinal Memory State:');
  for (const check of checks) {
    const icon = check.ok ? '✓' : '✗';
    console.log(`  ${icon} ${check.name}: ${check.value}`);
  }

  const allPassed = checks.every(c => c.ok);
  if (allPassed) {
    success('VERIFY', 'All checks passed');
  } else {
    fail('VERIFY', 'Some checks failed');
  }
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Agent Framework V2 - End-to-End Pipeline Test');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Conversation ID: ${TEST_CONV_ID}`);
  console.log(`  Skip Vision: ${SKIP_VISION}`);
  console.log(`  Verbose: ${VERBOSE}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const startTime = Date.now();

  await stage1_CreateConversation();
  await stage2_Vision();
  await stage3_Scoping();
  await stage4_Research();
  await stage5_Pricing();
  await stage6_Reply();
  await stage7_Verify();

  const totalTime = Date.now() - startTime;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  ✓ E2E PIPELINE TEST PASSED`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nCleanup: DELETE FROM conversation_memory WHERE conversation_id = '${TEST_CONV_ID}'`);
}

main().catch(err => {
  console.error('\n✗ E2E Pipeline test failed:', err);
  process.exit(1);
});
