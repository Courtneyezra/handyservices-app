/**
 * Realistic Call Transcript Test Suite
 *
 * Tests the tiered job classifier with natural language variations
 * that real customers would use when calling a handyman service.
 *
 * Run: npx tsx scripts/test-realistic-calls.ts
 */

import 'dotenv/config';
import {
  classifyJobComplexity,
  classifyMultipleJobs,
  getOverallRouteRecommendation,
  type DetectedJobInput,
} from '../server/services/job-complexity-classifier';

// Realistic job descriptions grouped by expected classification
const TEST_CASES = {
  // GREEN - Clear handyman jobs that should match SKUs
  green: [
    // Tap variations
    "my tap's been dripping for a week",
    "kitchen tap won't stop dripping",
    "the mixer tap in the bathroom is leaking a bit",
    "need someone to fix a dripping tap",

    // Mounting/hanging
    "can you hang a TV on the wall?",
    "need to mount my 50 inch telly",
    "want some shelves put up in the living room",
    "need a curtain pole fitted",
    "can you hang some pictures for me?",

    // Flatpack
    "got an IKEA wardrobe that needs building",
    "need help with flatpack furniture",
    "bought a desk from Argos, need it assembled",

    // Basic plumbing
    "toilet won't stop running",
    "need a new toilet seat fitted",
    "bathroom sink is draining slowly",

    // Doors/locks
    "my door won't close properly",
    "need a new lock fitted",
    "door handle is loose",
  ],

  // AMBER - Needs video/photos to assess properly
  amber: [
    // Vague leak descriptions
    "there's water coming from somewhere under the sink",
    "I've noticed some dampness on the wall",
    "there's a wet patch appeared on the ceiling",
    "something's leaking but I'm not sure where",

    // Mould (could be minor or serious)
    "got a bit of mould in the bathroom",
    "there's some black stuff growing in the corner",
    "mould keeps coming back on the window frame",

    // Damage assessment needed
    "there's a crack in the wall, not sure how serious",
    "my floorboards are creaking quite a lot",
    "the window doesn't close properly anymore",
    "door frame seems to have shifted",

    // Multiple/unclear jobs
    "I've got a few things that need looking at",
    "there's a couple of problems in the bathroom",
    "not really sure what's wrong, it just doesn't work",

    // Outdoor/guttering (variable complexity)
    "gutters seem to be blocked",
    "fence panel has come loose",
    "shed door won't close",
  ],

  // RED - Should trigger specialist referral flags
  red: [
    // Gas (obvious)
    "the boiler's not working properly",
    "gas cooker won't light",
    "can smell gas near the hob",
    "need the boiler serviced",

    // Electrical (major)
    "half the sockets in the house stopped working",
    "the fuse box keeps tripping",
    "lights flickering throughout the house",
    "need more sockets added in the kitchen",

    // Structural concerns (natural language)
    "there's a big crack running down the wall",
    "the wall seems to be bowing outwards",
    "door frames are all wonky now",
    "floors are sloping quite noticeably",

    // Roofing
    "tiles have come off the roof",
    "roof is leaking when it rains",
    "chimney stack looks like it's leaning",

    // Damp (serious indicators)
    "walls are wet to the touch",
    "damp coming up from the floor",
    "there's a musty smell throughout the house",
    "paint keeps peeling off the walls",
  ],

  // BORDERLINE - These should test Tier 2's nuance detection
  borderline: [
    // Could be simple or complex
    "there's a small crack above the door",
    "bathroom extractor fan stopped working",
    "radiator isn't getting hot",
    "water pressure seems low",
    "drain is blocked outside",

    // Depends on severity
    "got a leak somewhere",
    "there's damp in the corner",
    "window won't open",
    "floor feels soft in one spot",

    // Context matters
    "toilet is wobbling a bit",
    "shower isn't draining well",
    "taps are making a banging noise",
    "there's condensation on the windows",
  ],
};

// Simulate realistic multi-job calls
const MULTI_JOB_CALLS = [
  {
    name: "Simple maintenance call",
    jobs: [
      "dripping tap in the kitchen",
      "need some shelves put up",
      "toilet seat is loose",
    ],
    expectedRoute: 'instant',
  },
  {
    name: "Landlord call - mixed",
    jobs: [
      "tenant says the tap is dripping",
      "there's mould in the bathroom",
      "and the extractor fan isn't working",
    ],
    expectedRoute: 'video',
  },
  {
    name: "Call with red flag",
    jobs: [
      "need a TV mounted",
      "and the boiler's been making noises",
    ],
    expectedRoute: 'refer',
  },
  {
    name: "Vague multi-job",
    jobs: [
      "few things need fixing",
      "bathroom's got issues",
      "and something in the kitchen",
    ],
    expectedRoute: 'video',
  },
  {
    name: "Property manager - multiple units",
    jobs: [
      "flat 1 needs tap repair",
      "flat 2 has a blocked sink",
      "flat 3 the door won't close",
      "and flat 4 has damp on the wall",
    ],
    expectedRoute: 'video',
  },
];

async function runTests() {
  console.log('='.repeat(70));
  console.log('REALISTIC CALL TRANSCRIPT TESTS');
  console.log('Testing natural language variations for robustness');
  console.log('='.repeat(70));

  const results = {
    green: { correct: 0, total: 0, failures: [] as string[] },
    amber: { correct: 0, total: 0, failures: [] as string[] },
    red: { correct: 0, total: 0, failures: [] as string[] },
    borderline: { tier2Used: 0, total: 0 },
  };

  // Test GREEN cases
  console.log('\n' + '-'.repeat(70));
  console.log('GREEN TESTS (Should classify as instant quote)');
  console.log('-'.repeat(70));

  for (const desc of TEST_CASES.green) {
    const { result } = await classifyJobComplexity(desc, false, { useTier2: true });
    results.green.total++;

    const pass = result.trafficLight === 'green' || result.recommendedRoute === 'instant';
    if (pass) {
      results.green.correct++;
      console.log(`✓ "${desc.substring(0, 50)}..." → ${result.trafficLight.toUpperCase()}`);
    } else {
      results.green.failures.push(desc);
      console.log(`✗ "${desc.substring(0, 50)}..." → ${result.trafficLight.toUpperCase()} (expected GREEN)`);
      if (result.reasoning) console.log(`  Reasoning: ${result.reasoning}`);
    }
  }

  // Test AMBER cases
  console.log('\n' + '-'.repeat(70));
  console.log('AMBER TESTS (Should need video/assessment)');
  console.log('-'.repeat(70));

  for (const desc of TEST_CASES.amber) {
    const { result } = await classifyJobComplexity(desc, false, { useTier2: true });
    results.amber.total++;

    const pass = result.trafficLight === 'amber' || result.recommendedRoute === 'video';
    if (pass) {
      results.amber.correct++;
      console.log(`✓ "${desc.substring(0, 50)}..." → ${result.trafficLight.toUpperCase()}`);
    } else {
      results.amber.failures.push(desc);
      console.log(`✗ "${desc.substring(0, 50)}..." → ${result.trafficLight.toUpperCase()} (expected AMBER)`);
      if (result.reasoning) console.log(`  Reasoning: ${result.reasoning}`);
    }
  }

  // Test RED cases
  console.log('\n' + '-'.repeat(70));
  console.log('RED TESTS (Should flag for specialist/referral)');
  console.log('-'.repeat(70));

  for (const desc of TEST_CASES.red) {
    const { result } = await classifyJobComplexity(desc, false, { useTier2: true });
    results.red.total++;

    const pass = result.trafficLight === 'red' || result.recommendedRoute === 'refer' || result.recommendedRoute === 'visit';
    if (pass) {
      results.red.correct++;
      console.log(`✓ "${desc.substring(0, 50)}..." → ${result.trafficLight.toUpperCase()}`);
    } else {
      results.red.failures.push(desc);
      console.log(`✗ "${desc.substring(0, 50)}..." → ${result.trafficLight.toUpperCase()} (expected RED)`);
      if (result.reasoning) console.log(`  Reasoning: ${result.reasoning}`);
    }
  }

  // Test BORDERLINE cases - check if Tier 2 is being used
  console.log('\n' + '-'.repeat(70));
  console.log('BORDERLINE TESTS (Should trigger Tier 2 LLM)');
  console.log('-'.repeat(70));

  for (const desc of TEST_CASES.borderline) {
    const { result } = await classifyJobComplexity(desc, false, { useTier2: true });
    results.borderline.total++;

    if (result.tier === 2) {
      results.borderline.tier2Used++;
    }

    const tierLabel = result.tier === 2 ? 'T2' : 'T1';
    console.log(`[${tierLabel}] "${desc.substring(0, 45)}..." → ${result.trafficLight.toUpperCase()} (${result.recommendedRoute})`);
    if (result.reasoning) {
      console.log(`     ${result.reasoning.substring(0, 70)}...`);
    }
  }

  // Test multi-job calls
  console.log('\n' + '-'.repeat(70));
  console.log('MULTI-JOB CALL TESTS');
  console.log('-'.repeat(70));

  for (const call of MULTI_JOB_CALLS) {
    console.log(`\n📞 ${call.name}:`);

    const jobInputs: DetectedJobInput[] = call.jobs.map((desc, i) => ({
      id: `job-${i}`,
      description: desc,
      matched: false, // Simulate unmatched for testing
    }));

    const classificationResults = await classifyMultipleJobs(jobInputs, { useTier2: true });
    const recommendation = getOverallRouteRecommendation(classificationResults);

    for (const [jobId, result] of classificationResults) {
      const job = jobInputs.find(j => j.id === jobId);
      const light = result.trafficLight.toUpperCase().padEnd(5);
      console.log(`   [${light}] ${job?.description}`);
    }

    const pass = recommendation.route === call.expectedRoute;
    const icon = pass ? '✓' : '✗';
    console.log(`   ${icon} Overall: ${recommendation.route.toUpperCase()} (expected: ${call.expectedRoute.toUpperCase()})`);
    console.log(`     Reason: ${recommendation.reason}`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const greenPct = ((results.green.correct / results.green.total) * 100).toFixed(0);
  const amberPct = ((results.amber.correct / results.amber.total) * 100).toFixed(0);
  const redPct = ((results.red.correct / results.red.total) * 100).toFixed(0);
  const tier2Pct = ((results.borderline.tier2Used / results.borderline.total) * 100).toFixed(0);

  console.log(`GREEN accuracy:  ${results.green.correct}/${results.green.total} (${greenPct}%)`);
  console.log(`AMBER accuracy:  ${results.amber.correct}/${results.amber.total} (${amberPct}%)`);
  console.log(`RED accuracy:    ${results.red.correct}/${results.red.total} (${redPct}%)`);
  console.log(`Tier 2 usage:    ${results.borderline.tier2Used}/${results.borderline.total} borderline cases (${tier2Pct}%)`);

  if (results.green.failures.length > 0) {
    console.log('\nGREEN failures (review these):');
    results.green.failures.forEach(f => console.log(`  - ${f}`));
  }

  if (results.amber.failures.length > 0) {
    console.log('\nAMBER failures (review these):');
    results.amber.failures.forEach(f => console.log(`  - ${f}`));
  }

  if (results.red.failures.length > 0) {
    console.log('\nRED failures (review these):');
    results.red.failures.forEach(f => console.log(`  - ${f}`));
  }

  console.log('\n' + '='.repeat(70));
}

runTests().catch(console.error);
