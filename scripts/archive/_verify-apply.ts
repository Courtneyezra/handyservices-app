import { db } from '../server/db';
import { serviceCatalog } from '../shared/schema';
import { inArray } from 'drizzle-orm';
import * as fs from 'fs';

const snapFile = fs.readdirSync('scripts').filter((f) => f.startsWith('_catalog-snapshot-')).sort().pop()!;
const snap = JSON.parse(fs.readFileSync(`scripts/${snapFile}`, 'utf8')) as any[];
const timeAll = JSON.parse(fs.readFileSync('scripts/_proposed-times.json', 'utf8')) as any[];
const confByCode = new Map(timeAll.map((t) => [t.skuCode, t.confidence]));

const codes = snap.map((s) => s.skuCode);
const live = await db.select().from(serviceCatalog).where(inArray(serviceCatalog.skuCode, codes));
const liveByCode = new Map(live.map((r) => [r.skuCode, r]));

const timeKey = (r: any) => JSON.stringify([r.scheduleMinutes, r.setupMinutes, r.minutesPerUnit, r.tiers]);
const kwKey = (r: any) => JSON.stringify([r.keywords, r.negativeKeywords]);

let kwChanged = 0, timeChangedHigh = 0, timeChangedOther = 0, timeNoop = 0;
const ownerCallTouched: string[] = [];

for (const s of snap) {
  const l = liveByCode.get(s.skuCode); if (!l) continue;
  if (kwKey(s) !== kwKey(l)) kwChanged++;
  const conf = confByCode.get(s.skuCode);
  if (timeKey(s) !== timeKey(l)) {
    if (conf === 'high') timeChangedHigh++;
    else { timeChangedOther++; ownerCallTouched.push(`${s.skuCode}(${conf})`); }
  } else if (conf === 'high') {
    timeNoop++;
  }
}

console.log(`snapshot: ${snapFile}  (${snap.length} SKUs)`);
console.log(`keyword arrays changed:        ${kwChanged}`);
console.log(`TIME changed — high-confidence: ${timeChangedHigh}  (the approved cuts)`);
console.log(`TIME changed — high but no-op:  ${timeNoop}  (suggested == current, harmless re-write)`);
console.log(`TIME changed — NON-high:        ${timeChangedOther}  ← must be 0`);
if (ownerCallTouched.length) console.log(`  ⚠ owner-call/other times touched: ${ownerCallTouched.join(', ')}`);
else console.log(`  ✓ zero owner-call times touched`);
process.exit(0);
