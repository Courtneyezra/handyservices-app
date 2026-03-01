/**
 * Quick test for RED keyword detection (Tier 1 only)
 */
import 'dotenv/config';
import { tier1KeywordMatch } from '../server/services/job-complexity-classifier';

const redCases = [
  "the boiler's not working properly",
  "gas cooker won't light",
  "half the sockets in the house stopped working",
  "lights flickering throughout the house",
  "there's a big crack running down the wall",
  "tiles have come off the roof",
  "roof is leaking when it rains",
  "walls are wet to the touch",
  "damp coming up from the floor",
  "fuse box keeps tripping",
  "need more sockets added in the kitchen",
  "floors are sloping quite noticeably",
];

console.log('RED KEYWORD DETECTION TEST (Tier 1 only)');
console.log('=========================================');

let passed = 0;
for (const desc of redCases) {
  const result = tier1KeywordMatch(desc, false);
  const isRed = result.trafficLight === 'red';
  const icon = isRed ? '✓' : '✗';
  if (isRed) passed++;
  console.log(`${icon} ${result.trafficLight.toUpperCase().padEnd(5)} | ${desc}`);
  if (result.signals.length > 0 && !result.signals[0].includes('No SKU')) {
    console.log(`         Keywords: ${result.signals.join(', ')}`);
  }
}
console.log(`\nResult: ${passed}/${redCases.length} correctly flagged RED by Tier 1`);
