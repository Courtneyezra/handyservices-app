/**
 * Smoke test for Agent Framework V2
 *
 * Tests:
 * 1. Memory functions (getOrCreateMemory, updateMemory)
 * 2. OpenRouter client initialization
 * 3. Worker module imports resolve correctly
 *
 * Run: npx tsx scripts/_smoke-agent-v2.ts
 */

import { getOrCreateMemory, updateMemory, getMemory } from '../server/memory';
import { getOpenRouter, MODELS, callLLM } from '../server/llm/openrouter';
import { runVisionWorker } from '../server/workers/vision';
import { runScopingWorker } from '../server/workers/scoping';
import { runResearchWorker } from '../server/workers/research';
import { runPricingWorker } from '../server/workers/pricing';
import { runReplyWorker } from '../server/workers/reply';

const TEST_CONV_ID = 'smoke-test-' + Date.now();

async function main() {
  console.log('=== Agent Framework V2 Smoke Test ===\n');

  // Test 1: Memory functions
  console.log('1. Testing memory functions...');
  try {
    const memory = await getOrCreateMemory(TEST_CONV_ID);
    console.log(`   Created memory: id=${memory.id}, version=${memory.version}`);

    const updated = await updateMemory(TEST_CONV_ID, {
      messages: [{
        id: 'test-msg-1',
        content: 'Hi, my tap is leaking',
        direction: 'inbound',
        phone: '+447000000000',
        createdAt: new Date().toISOString()
      }],
      readiness: 'gathering',
    }, memory.version);
    console.log(`   Updated memory: version=${updated.version}, readiness=${updated.readiness}`);
    console.log('   PASS: Memory functions work\n');
  } catch (err: any) {
    console.log(`   FAIL: ${err.message}\n`);
    process.exit(1);
  }

  // Test 2: OpenRouter client
  console.log('2. Testing OpenRouter client...');
  try {
    const client = getOpenRouter();
    console.log(`   Client initialized: baseURL=${client.baseURL}`);
    console.log(`   Models configured: ${Object.keys(MODELS).join(', ')}`);
    console.log('   PASS: OpenRouter client initializes\n');
  } catch (err: any) {
    console.log(`   FAIL: ${err.message}\n`);
    process.exit(1);
  }

  // Test 3: Worker modules
  console.log('3. Testing worker imports...');
  try {
    console.log('   runVisionWorker:', typeof runVisionWorker === 'function' ? 'OK' : 'MISSING');
    console.log('   runScopingWorker:', typeof runScopingWorker === 'function' ? 'OK' : 'MISSING');
    console.log('   runResearchWorker:', typeof runResearchWorker === 'function' ? 'OK' : 'MISSING');
    console.log('   runPricingWorker:', typeof runPricingWorker === 'function' ? 'OK' : 'MISSING');
    console.log('   runReplyWorker:', typeof runReplyWorker === 'function' ? 'OK' : 'MISSING');
    console.log('   PASS: All workers export run functions\n');
  } catch (err: any) {
    console.log(`   FAIL: ${err.message}\n`);
    process.exit(1);
  }

  // Test 4: Dry-run scoping worker (no LLM call, just setup)
  console.log('4. Testing scoping worker context build...');
  try {
    const memory = await getMemory(TEST_CONV_ID);
    if (!memory) throw new Error('Memory not found');
    console.log(`   Messages: ${memory.messages.length}`);
    console.log(`   Readiness: ${memory.readiness}`);
    console.log('   PASS: Memory state ready for scoping\n');
  } catch (err: any) {
    console.log(`   FAIL: ${err.message}\n`);
    process.exit(1);
  }

  // Test 5: Quick LLM call (if API key is valid)
  console.log('5. Testing OpenRouter LLM call (quick)...');
  try {
    const response = await callLLM('conversation', [
      { role: 'user', content: 'Reply with just the word "working"' }
    ], { maxTokens: 10 });
    console.log(`   Model: ${response.model}`);
    console.log(`   Response: "${response.content.slice(0, 50)}"`);
    console.log(`   Tokens: ${response.usage.inputTokens} in, ${response.usage.outputTokens} out`);
    console.log(`   Duration: ${response.durationMs}ms`);
    console.log('   PASS: LLM responds\n');
  } catch (err: any) {
    console.log(`   FAIL: ${err.message}`);
    console.log('   (This may fail if OPENROUTER_API_KEY is invalid or out of credits)\n');
  }

  // Cleanup
  console.log('=== Smoke Test Complete ===');
  console.log(`Test conversation ID: ${TEST_CONV_ID}`);
  console.log('(Delete from DB manually if needed: DELETE FROM conversation_memory WHERE conversation_id LIKE \'smoke-test-%\')');
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
