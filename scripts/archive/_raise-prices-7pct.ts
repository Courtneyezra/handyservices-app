/**
 * Raise all service_catalog base prices by 7% (rounded to whole £) so the
 * default 7% "flexible booking" discount nets back to ~today's price, and a
 * specific-date booking pays the new (higher) rate.
 *
 * Touches: pricePence (fixed), pricePerUnitPence (per_unit), tiers[].pricePence
 * (tiered). Leaves icon / pickCount / scheduleMinutes / off-peak premium alone.
 * Also rewrites scripts/data/sku-catalog-v3.json so the seed source stays in
 * sync with the DB (no reseed → icons/pickCounts preserved).
 *
 * DRY_RUN=1 previews before/after without writing.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { serviceCatalog } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const FACTOR = 1.07;
const dryRun = process.env.DRY_RUN === '1';
const bump = (p: number | null | undefined): number | null =>
  p == null ? (p ?? null) : Math.round((p * FACTOR) / 100) * 100; // round to whole £

async function main() {
  const rows = await db.select().from(serviceCatalog);
  let changed = 0;
  let beforeTotal = 0;
  let afterTotal = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const updates: any = {};
    if (r.pricePence != null) updates.pricePence = bump(r.pricePence);
    if (r.pricePerUnitPence != null) updates.pricePerUnitPence = bump(r.pricePerUnitPence);
    if (r.tiers && Array.isArray(r.tiers) && r.tiers.length > 0) {
      updates.tiers = (r.tiers as any[]).map((t) => ({ ...t, pricePence: bump(t.pricePence) }));
    }
    if (Object.keys(updates).length === 0) continue;
    changed++;

    const beforeHead = r.pricePence ?? r.pricePerUnitPence ?? (r.tiers as any[])?.[0]?.pricePence ?? 0;
    const afterHead = updates.pricePence ?? updates.pricePerUnitPence ?? updates.tiers?.[0]?.pricePence ?? 0;
    beforeTotal += beforeHead;
    afterTotal += afterHead;
    if (samples.length < 14) {
      const unit = r.shape === 'per_unit' ? '/unit' : r.shape === 'tiered' ? ' (tier1)' : '';
      samples.push(`  ${r.skuCode.padEnd(16)} [${r.shape.padEnd(8)}] £${beforeHead / 100}${unit} → £${afterHead / 100}${unit}`);
    }

    if (!dryRun) {
      updates.updatedAt = new Date();
      await db.update(serviceCatalog).set(updates).where(eq(serviceCatalog.id, r.id));
    }
  }

  console.log(`${dryRun ? '[DRY RUN] ' : '[APPLIED] '}${changed} SKUs ${dryRun ? 'would be' : 'were'} raised ×${FACTOR} (rounded to whole £)`);
  console.log(`Sample head-price changes:`);
  samples.forEach((s) => console.log(s));
  const pct = (((afterTotal - beforeTotal) / beforeTotal) * 100).toFixed(2);
  console.log(`\nHead-price sum: £${(beforeTotal / 100).toFixed(0)} → £${(afterTotal / 100).toFixed(0)} (+${pct}% after rounding)`);

  // Keep the seed source-of-truth JSON in sync (only when actually applying).
  if (!dryRun) {
    const p = join(process.cwd(), 'scripts/data/sku-catalog-v3.json');
    const data = JSON.parse(readFileSync(p, 'utf-8')) as any[];
    for (const s of data) {
      if (s.price_pence != null) s.price_pence = bump(s.price_pence);
      if (s.price_per_unit_pence != null) s.price_per_unit_pence = bump(s.price_per_unit_pence);
      if (Array.isArray(s.tiers)) s.tiers = s.tiers.map((t: any) => ({ ...t, pricePence: bump(t.pricePence) }));
    }
    writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
    console.log('Synced scripts/data/sku-catalog-v3.json');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
