/**
 * Seed ONE showcase dummy flex quote whose line items are run through the REAL matcher
 * (server/contextual-pricing/sku-matcher.ts) → priced + timed from the enriched/corrected
 * service_catalog. This is a live preview of what Track-B wiring will produce per quote.
 *
 * Fenced with the frozen `test_q_flex_` prefix → removable via cleanup-dummy-flex-jobs.ts.
 *   npx tsx scripts/_seed-showcase-dummy.ts
 */
import { db } from '../server/db';
import { serviceCatalog } from '../shared/schema';
import { inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { matchLineToSku } from '../server/contextual-pricing/sku-matcher';

const rid = (n = 8) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

// Realistic multi-line job spanning enriched categories; includes per_unit lines that
// showcase the corrected times (lights/poles were the worst per-unit pads).
const ITEMS: { description: string; category: string; qty: number }[] = [
  { description: 'Replace kitchen tap', category: 'plumbing_minor', qty: 1 },
  { description: 'Change 4 ceiling lights', category: 'electrical_minor', qty: 4 },
  { description: 'Mount TV to brick wall', category: 'tv_mounting', qty: 1 },
  { description: 'Re-grout bathroom tiles', category: 'tiling', qty: 6 },
  { description: 'Fit 3 curtain poles', category: 'curtain_blinds', qty: 3 },
];

function priceAndTime(row: any, qty: number): { pricePence: number; minutes: number } {
  if (row.shape === 'fixed') return { pricePence: row.pricePence ?? 0, minutes: row.scheduleMinutes ?? 0 };
  if (row.shape === 'per_unit') {
    const units = Math.max(qty, row.minimumUnits ?? 1);
    const perUnitMin = row.actualMinutesPerUnit ?? row.minutesPerUnit ?? 0; // prefer learned actuals
    return { pricePence: (row.pricePerUnitPence ?? 0) * units, minutes: (row.setupMinutes ?? 0) + perUnitMin * units };
  }
  const tiers = (row.tiers ?? []) as any[];
  const t = tiers[Math.floor(tiers.length / 2)] ?? { pricePence: 0, scheduleMinutes: 0 };
  return { pricePence: t.pricePence ?? 0, minutes: t.scheduleMinutes ?? 0 };
}

(async () => {
  // Match each line, then pull its catalog row.
  const matched = [] as { it: typeof ITEMS[number]; sku: string; name: string; conf: string }[];
  for (const it of ITEMS) {
    const m = await matchLineToSku({ description: it.description, category: it.category });
    if (!m) { console.log(`  ⚠ no match: ${it.description}`); continue; }
    matched.push({ it, sku: m.skuCode, name: m.name, conf: m.confidence });
  }
  const rows = await db.select().from(serviceCatalog).where(inArray(serviceCatalog.skuCode, matched.map((m) => m.sku)));
  const byCode = new Map(rows.map((r) => [r.skuCode, r]));

  const lineItems = matched.map((m) => {
    const row = byCode.get(m.sku)!;
    const { pricePence, minutes } = priceAndTime(row, m.it.qty);
    return {
      lineId: rid(8), source: 'sku' as const, skuCode: m.sku, category: row.category,
      description: m.it.description, unitCount: m.it.qty,
      scheduleMinutes: minutes, timeEstimateMinutes: minutes,
      guardedPricePence: pricePence, referencePricePence: pricePence, llmSuggestedPricePence: pricePence,
      materialsCostPence: 0,
    };
  });

  const basePrice = Math.min(50000, Math.max(8000, lineItems.reduce((a, l) => a + l.guardedPricePence, 0)));
  const id = `test_q_flex_${rid(10)}`;
  const shortSlug = `tf${rid(6)}`;
  const jobDescription = ITEMS.map((i) => i.description).join('; ');

  await db.execute(sql`
    INSERT INTO personalized_quotes (
      id, short_slug, customer_name, phone, email, job_description, segment, postcode,
      coordinates, flex_booking_within_days, base_price, pricing_line_items, deposit_paid_at, created_at
    ) VALUES (
      ${id}, ${shortSlug}, ${'TEST Showcase'}, ${'07700900099'}, ${'testflex99@example.com'},
      ${jobDescription}, ${'CONTEXTUAL'}, ${'NG7 2BY'},
      ${JSON.stringify({ lat: 52.951, lng: -1.151 })}::jsonb, ${7}, ${basePrice},
      ${JSON.stringify(lineItems)}::jsonb, NOW(), NOW()
    )`);

  console.log(`\n✓ showcase dummy seeded — lands in the flex pool (deposit-paid, 7-day flex)\n`);
  console.log(`  id:    ${id}`);
  console.log(`  slug:  ${shortSlug}   →  /q/${shortSlug}`);
  console.log(`  ${'DESCRIPTION'.padEnd(26)}${'→ SKU'.padEnd(18)}${'CONF'.padEnd(9)}${'PRICE'.padStart(8)}${'TIME'.padStart(8)}`);
  console.log('  ' + '─'.repeat(69));
  for (const l of lineItems) {
    const m = matched.find((x) => x.sku === l.skuCode)!;
    console.log(`  ${l.description.padEnd(26)}${('→ ' + l.skuCode).padEnd(18)}${m.conf.padEnd(9)}${('£' + (l.guardedPricePence / 100).toFixed(0)).padStart(8)}${((l.scheduleMinutes / 60).toFixed(1) + 'h').padStart(8)}`);
  }
  console.log('  ' + '─'.repeat(69));
  console.log(`  ${'TOTAL'.padEnd(53)}${('£' + (basePrice / 100).toFixed(0)).padStart(8)}${((lineItems.reduce((a, l) => a + l.scheduleMinutes, 0) / 60).toFixed(1) + 'h').padStart(8)}`);
  console.log(`\n  remove with: npx tsx scripts/cleanup-dummy-flex-jobs.ts\n`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
