/**
 * Test script for tiered job complexity classifier
 *
 * Run: npx tsx scripts/test-job-classifier.ts
 */

import 'dotenv/config';

import {
  tier1KeywordMatch,
  tier2LLMClassify,
  classifyJobComplexity,
  classifyMultipleJobs,
  getOverallRouteRecommendation,
} from '../server/services/job-complexity-classifier';

const TEST_JOBS = [
  // GREEN - should match SKUs
  { description: 'Fix dripping tap', matched: true },
  { description: 'Hang a picture', matched: true },

  // AMBER - needs video
  { description: 'Something is leaking under the sink', matched: false },
  { description: 'Small damp patch on ceiling', matched: false },
  { description: 'Door not closing properly', matched: false },

  // RED - specialist work
  { description: 'Need to rewire the whole house', matched: false },
  { description: 'Gas boiler needs replacing', matched: false },
  { description: 'Crack in load bearing wall', matched: false },
  { description: 'Think there might be asbestos', matched: false },

  // BORDERLINE - needs Tier 2 to decide
  { description: 'Bit of mould in bathroom corner', matched: false },
  { description: 'Black mould spreading across entire wall', matched: false },
  { description: 'Small crack appeared in plaster', matched: false },
  { description: 'Large structural crack getting wider', matched: false },
];

async function runTests() {
  console.log('='.repeat(60));
  console.log('TIER 1 TESTS (Instant Keyword Matching)');
  console.log('='.repeat(60));

  for (const job of TEST_JOBS) {
    const result = tier1KeywordMatch(job.description, job.matched);
    const light = result.trafficLight.toUpperCase().padEnd(5);
    const conf = `${result.confidence}%`.padStart(4);
    console.log(`[${light}] ${conf} | ${job.description}`);
    if (result.signals.length > 0) {
      console.log(`         Signals: ${result.signals.join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('TIER 2 TESTS (LLM Classification)');
  console.log('='.repeat(60));

  // Test a few borderline cases with Tier 2
  const borderlineCases = [
    'Bit of mould in bathroom corner',
    'Black mould spreading across entire wall',
    'Small crack appeared in plaster',
    'Large structural crack getting wider',
    'Leak under the kitchen sink',
    'Major water leak flooding the basement',
  ];

  for (const desc of borderlineCases) {
    console.log(`\nAnalyzing: "${desc}"`);
    const result = await tier2LLMClassify(desc);
    if (result) {
      console.log(`  Traffic Light: ${result.trafficLight.toUpperCase()}`);
      console.log(`  Route: ${result.recommendedRoute}`);
      console.log(`  Complexity: ${result.complexityScore}/10`);
      console.log(`  Specialist: ${result.needsSpecialist ? 'YES' : 'No'}`);
      console.log(`  Reasoning: ${result.reasoning}`);
    } else {
      console.log('  [ERROR] No result from Tier 2');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('BATCH CLASSIFICATION TEST');
  console.log('='.repeat(60));

  const batchJobs = [
    { id: '1', description: 'Fix leaky tap', matched: true, skuName: 'Tap Repair' },
    { id: '2', description: 'Damp patch on wall', matched: false },
    { id: '3', description: 'Gas cooker not working', matched: false },
  ];

  console.log('\nClassifying batch of 3 jobs...');
  const results = await classifyMultipleJobs(batchJobs);

  for (const [jobId, result] of results) {
    const job = batchJobs.find(j => j.id === jobId);
    console.log(`\nJob ${jobId}: "${job?.description}"`);
    console.log(`  Tier: ${result.tier}`);
    console.log(`  Traffic Light: ${result.trafficLight.toUpperCase()}`);
    console.log(`  Route: ${result.recommendedRoute}`);
    if (result.reasoning) {
      console.log(`  Reasoning: ${result.reasoning}`);
    }
  }

  const recommendation = getOverallRouteRecommendation(results);
  console.log('\n' + '-'.repeat(40));
  console.log('OVERALL RECOMMENDATION:');
  console.log(`  Route: ${recommendation.route.toUpperCase()}`);
  console.log(`  Reason: ${recommendation.reason}`);
  console.log(`  Confidence: ${recommendation.confidence}%`);

  console.log('\n' + '='.repeat(60));
  console.log('TESTS COMPLETE');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
