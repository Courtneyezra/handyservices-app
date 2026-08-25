/**
 * Phase 27b — seed SKU catalog v3 (161 SKUs).
 *
 * Full replacement of the v1 catalog. Safe because existing quotes snapshot
 * their SKU fields onto pricingLineItems JSONB at creation time — they do NOT
 * FK into service_catalog — so wiping + reseeding the catalog can't break a
 * live quote's render or price.
 *
 * Reads scripts/data/sku-catalog-v3.json (approved by owner).
 * DRY_RUN=1 to preview counts without writing.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SkuRow {
  sku_code: string;
  name: string;
  category: string;
  shape: 'fixed' | 'per_unit' | 'tiered';
  price_pence: number | null;
  schedule_minutes: number | null;
  price_per_unit_pence: number | null;
  unit_label: string | null;
  minimum_units: number | null;
  minutes_per_unit: number | null;
  setup_minutes: number | null;
  tiers: Array<{ label: string; pricePence: number; scheduleMinutes: number }> | null;
  customer_description: string;
  admin_description: string;
  flex_eligible: boolean;
  off_peak_weekend_premium_pence: number;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const data = JSON.parse(readFileSync(join(process.cwd(), 'scripts/data/sku-catalog-v3.json'), 'utf-8')) as SkuRow[];

  console.log('═══════════════════════════════════════');
  console.log('  SKU Catalog v3 Seed');
  console.log('═══════════════════════════════════════');
  console.log(`Loaded ${data.length} SKUs from sku-catalog-v3.json`);

  const before = await db.execute(sql`SELECT count(*)::int AS n FROM service_catalog`);
  console.log(`Existing rows in service_catalog: ${(before.rows as any[])[0].n}`);

  if (dryRun) {
    const shapes: Record<string, number> = {};
    for (const s of data) shapes[s.shape] = (shapes[s.shape] || 0) + 1;
    console.log('[DRY RUN] would replace with:', JSON.stringify(shapes));
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    // Full replacement — wipe then insert. No FK references to worry about.
    await tx.execute(sql`DELETE FROM service_catalog`);
    for (const s of data) {
      const tiersJson = s.tiers ? JSON.stringify(s.tiers) : null;
      await tx.execute(sql`
        INSERT INTO service_catalog (
          sku_code, name, category, shape,
          price_pence, schedule_minutes,
          price_per_unit_pence, unit_label, minimum_units, minutes_per_unit, setup_minutes,
          tiers,
          customer_description, admin_description,
          flex_eligible, off_peak_weekend_premium_pence,
          is_active, created_at, updated_at
        ) VALUES (
          ${s.sku_code}, ${s.name}, ${s.category}, ${s.shape},
          ${s.price_pence}, ${s.schedule_minutes},
          ${s.price_per_unit_pence}, ${s.unit_label}, ${s.minimum_units}, ${s.minutes_per_unit}, ${s.setup_minutes},
          ${tiersJson}::jsonb,
          ${s.customer_description}, ${s.admin_description},
          ${s.flex_eligible}, ${s.off_peak_weekend_premium_pence},
          true, NOW(), NOW()
        )
      `);
    }
  });

  const after = await db.execute(sql`SELECT count(*)::int AS n FROM service_catalog`);
  const byShape = await db.execute(sql`SELECT shape, count(*)::int AS n FROM service_catalog GROUP BY shape ORDER BY shape`);
  console.log(`\n✓ Seeded. service_catalog now has ${(after.rows as any[])[0].n} rows.`);
  console.log('By shape:');
  (byShape.rows as any[]).forEach((r) => console.log(`  ${r.shape.padEnd(10)} ${r.n}`));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
