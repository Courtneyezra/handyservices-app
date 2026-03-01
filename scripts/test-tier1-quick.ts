/**
 * Quick Tier 1 accuracy test (no LLM calls)
 */
import 'dotenv/config';
import { tier1KeywordMatch } from '../server/services/job-complexity-classifier';

const TESTS = {
  green: [
    "my tap's been dripping for a week",
    "kitchen tap won't stop dripping",
    "need someone to fix a dripping tap",
    "can you hang a TV on the wall?",
    "need to mount my 50 inch telly",
    "want some shelves put up",
    "need a curtain pole fitted",
    "got an IKEA wardrobe that needs building",
    "toilet won't stop running",
    "need a new toilet seat fitted",
    "my door won't close properly",
    "need a new lock fitted",
    "door handle is loose",
  ],
  amber: [
    "there's water coming from somewhere under the sink",
    "I've noticed some dampness on the wall",
    "there's a wet patch appeared on the ceiling",
    "something's leaking but I'm not sure where",
    "got a bit of mould in the bathroom",
    "there's a crack in the wall, not sure how serious",
    "I've got a few things that need looking at",
    "not really sure what's wrong",
  ],
  red: [
    "the boiler's not working properly",
    "gas cooker won't light",
    "can smell gas near the hob",
    "half the sockets stopped working",
    "lights flickering throughout the house",
    "fuse box keeps tripping",
    "there's a big crack running down the wall",
    "floors are sloping noticeably",
    "tiles have come off the roof",
    "roof is leaking when it rains",
    "walls are wet to the touch",
    "damp coming up from the floor",
  ],
};

console.log('TIER 1 QUICK ACCURACY TEST');
console.log('==========================\n');

const results = { green: 0, amber: 0, red: 0 };
const totals = { green: TESTS.green.length, amber: TESTS.amber.length, red: TESTS.red.length };

// Test GREEN (these are unmatched SKUs, so Tier 1 will say AMBER - that's expected)
// GREEN accuracy for Tier 1 is N/A since it requires SKU match
console.log('GREEN tests skipped (requires SKU match, Tier 2 handles these)\n');

// Test AMBER
console.log('AMBER TESTS:');
for (const desc of TESTS.amber) {
  const result = tier1KeywordMatch(desc, false);
  const pass = result.trafficLight === 'amber';
  if (pass) results.amber++;
  console.log(`${pass ? '✓' : '✗'} ${desc.substring(0, 50)}`);
}

// Test RED
console.log('\nRED TESTS:');
for (const desc of TESTS.red) {
  const result = tier1KeywordMatch(desc, false);
  const pass = result.trafficLight === 'red';
  if (pass) results.red++;
  console.log(`${pass ? '✓' : '✗'} ${desc.substring(0, 50)}`);
}

console.log('\n==========================');
console.log('TIER 1 RESULTS:');
console.log(`AMBER: ${results.amber}/${totals.amber} (${Math.round(results.amber/totals.amber*100)}%)`);
console.log(`RED:   ${results.red}/${totals.red} (${Math.round(results.red/totals.red*100)}%)`);
console.log('\nNote: GREEN requires SKU match (handled by SKU detector, not keywords)');
