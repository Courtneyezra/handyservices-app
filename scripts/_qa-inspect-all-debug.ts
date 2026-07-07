import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { inArray } from 'drizzle-orm';

const slugs = ['qd2501','qd2502','qd2503','qd2504','qd2505','qd2506','qd2507','qd2508','qd2509','qd2510','qd2511','qd2512'];
const rows = await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, slugs));
const bySlug = new Map(rows.map(r => [r.shortSlug, r]));
for (const slug of slugs) {
  const q = bySlug.get(slug);
  if (!q) { console.log(`${slug} MISSING`); continue; }
  const lines = q.pricingLineItems as any[];
  console.log(`\n${slug} (${q.jobDescription})  basePrice=£${((q.basePrice||0)/100).toFixed(2)}`);
  for (const li of lines) {
    const tag = li.source === 'sku' ? `${li.skuShape}` : 'custom';
    const qual = li.unitCount != null ? `×${li.unitCount}${li.skuUnitLabel ? ' ' + li.skuUnitLabel : ''}` : li.selectedTier ? `tier=${li.selectedTier}` : '';
    console.log(`  [${tag}] ${li.skuName || li.description || '(no title)'} ${qual} → £${(li.guardedPricePence/100).toFixed(2)} (sched ${li.scheduleMinutes || li.timeEstimateMinutes}min)`);
  }
}
process.exit(0);
