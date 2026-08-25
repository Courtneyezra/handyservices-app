/**
 * APPLY Track-A catalog changes to service_catalog:
 *   1. keyword + negative-keyword enrichment (union/dedupe) from _proposed-keywords.json
 *   2. high-confidence ONLY time corrections from _proposed-times.json
 * Snapshots current values first (reversible), runs in a transaction, idempotent.
 * Prices are NEVER touched — only keywords + time columns.
 * Run: npx tsx scripts/_apply-catalog-changes.ts
 */
import { db } from '../server/db';
import { serviceCatalog } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';
import * as fs from 'fs';

const kwData = JSON.parse(fs.readFileSync('scripts/_proposed-keywords.json', 'utf8'));
const timeData = JSON.parse(fs.readFileSync('scripts/_proposed-times.json', 'utf8'));

const kwAdds = kwData.additions as Array<{ skuCode: string; addKeywords: string[]; addNegativeKeywords: string[] }>;
const timeAll = timeData as Array<{ skuCode: string; shape: string; suggestedMinutes: any; confidence: string }>;
const timeHigh = timeAll.filter((t) => t.confidence === 'high');

console.log(`proposals: ${kwAdds.length} keyword SKUs, ${timeHigh.length} high-confidence time SKUs (of ${timeAll.length} total)`);

const affected = Array.from(new Set([...kwAdds.map((k) => k.skuCode), ...timeHigh.map((t) => t.skuCode)]));
const rows = await db.select().from(serviceCatalog).where(inArray(serviceCatalog.skuCode, affected));
const byCode = new Map(rows.map((r) => [r.skuCode, r]));

const missing = affected.filter((c) => !byCode.has(c));
if (missing.length) console.warn(`WARN — ${missing.length} skuCodes not in catalog (skipped): ${missing.join(', ')}`);

// ── Snapshot (rollback artifact) ────────────────────────────────────────────────
const snap = rows.map((r) => ({
  skuCode: r.skuCode, keywords: r.keywords, negativeKeywords: r.negativeKeywords,
  scheduleMinutes: r.scheduleMinutes, setupMinutes: r.setupMinutes, minutesPerUnit: r.minutesPerUnit, tiers: r.tiers,
}));
const snapPath = `scripts/_catalog-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));

const dedupe = (arr: string[]) => Array.from(new Set((arr ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)));

let kwUpdated = 0, timeUpdated = 0;
const timeSkipped: string[] = [];

await db.transaction(async (tx) => {
  for (const a of kwAdds) {
    const r = byCode.get(a.skuCode); if (!r) continue;
    const keywords = dedupe([...(r.keywords ?? []), ...(a.addKeywords ?? [])]);
    const negativeKeywords = dedupe([...(r.negativeKeywords ?? []), ...(a.addNegativeKeywords ?? [])]);
    await tx.update(serviceCatalog).set({ keywords, negativeKeywords, updatedAt: new Date() }).where(eq(serviceCatalog.skuCode, a.skuCode));
    kwUpdated++;
  }
  for (const t of timeHigh) {
    const r = byCode.get(t.skuCode); if (!r) continue;
    const s = t.suggestedMinutes;
    if (t.shape === 'fixed' && typeof s === 'number') {
      await tx.update(serviceCatalog).set({ scheduleMinutes: s, updatedAt: new Date() }).where(eq(serviceCatalog.skuCode, t.skuCode));
      timeUpdated++;
    } else if (t.shape === 'per_unit' && s && typeof s === 'object' && !Array.isArray(s)) {
      await tx.update(serviceCatalog).set({ setupMinutes: s.setupMinutes, minutesPerUnit: s.minutesPerUnit, updatedAt: new Date() }).where(eq(serviceCatalog.skuCode, t.skuCode));
      timeUpdated++;
    } else if (t.shape === 'tiered' && Array.isArray(s) && Array.isArray(r.tiers) && r.tiers.length === s.length) {
      const newTiers = (r.tiers as any[]).map((tier, i) => ({ ...tier, scheduleMinutes: s[i] })); // label + pricePence preserved
      await tx.update(serviceCatalog).set({ tiers: newTiers, updatedAt: new Date() }).where(eq(serviceCatalog.skuCode, t.skuCode));
      timeUpdated++;
    } else {
      timeSkipped.push(`${t.skuCode}(${t.shape})`);
    }
  }
});

console.log(`\n✓ applied.`);
console.log(`  snapshot (rollback): ${snapPath}`);
console.log(`  keyword SKUs updated: ${kwUpdated}/${kwAdds.length}`);
console.log(`  time SKUs updated (high-conf): ${timeUpdated}/${timeHigh.length}`);
if (timeSkipped.length) console.log(`  time SKUs skipped (shape/tier mismatch — review): ${timeSkipped.join(', ')}`);
process.exit(0);
