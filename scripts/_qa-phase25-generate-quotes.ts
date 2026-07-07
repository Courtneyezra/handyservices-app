/**
 * Phase 25 systematic debug — generate quotes across edge cases and capture
 * anomalies at each boundary. EVIDENCE GATHERING ONLY. No fixes.
 *
 * For each scenario:
 *   1. Build a MultiLineRequest mirroring what /api/contextual-pricing/create
 *      sends (admin builder default shape)
 *   2. Run generateMultiLinePrice (engine)
 *   3. Insert into personalized_quotes (mirroring what the route handler does)
 *   4. Report engine output + persisted JSONB shape — flag any anomaly
 *
 * A second pass walks the customer page DOM and reports rendering issues.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { inArray } from 'drizzle-orm';
import { resolveLineItemFromSku } from '../server/contextual-pricing/sku-resolver';
import { generateMultiLinePrice } from '../server/contextual-pricing/multi-line-engine';
import type { JobLine, MultiLineRequest } from '../shared/contextual-pricing-types';

interface Scenario {
  slug: string;
  name: string;
  lines: Array<{
    id: string;
    source?: 'sku' | 'custom';
    skuCode?: string;
    unitCount?: number;
    selectedTier?: string;
    description?: string;
    category?: string;
    timeEstimateMinutes?: number;
    materialsCostPence?: number;
  }>;
  expectedShape: 'fixed' | 'per_unit' | 'tiered' | 'mixed' | 'custom' | 'multi-day';
  expectedAnomalyHint?: string;
}

const TEST_PHONE = '07700000000';
const TEST_POSTCODE = 'NG1 1AA';
const TEST_COORDS = { lat: 52.954, lng: -1.156 };

const SCENARIOS: Scenario[] = [
  // 1. Fixed-price SKU only
  {
    slug: 'qd2501', name: 'D01 Fixed only',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'TAP-01' }],
    expectedShape: 'fixed',
  },
  // 2. Per-unit at minimum
  {
    slug: 'qd2502', name: 'D02 Per-unit ×1',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'DOOR-15', unitCount: 1 }],
    expectedShape: 'per_unit',
  },
  // 3. Per-unit above minimum
  {
    slug: 'qd2503', name: 'D03 Per-unit ×3',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'DOOR-15', unitCount: 3 }],
    expectedShape: 'per_unit',
  },
  // 4. Per-unit high count
  {
    slug: 'qd2504', name: 'D04 Per-unit ×10',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'DOOR-15', unitCount: 10 }],
    expectedShape: 'per_unit',
  },
  // 5. Per-unit no unitCount — should fall back to minimum_units
  {
    slug: 'qd2505', name: 'D05 Per-unit no count',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'DOOR-15' }],
    expectedShape: 'per_unit',
    expectedAnomalyHint: 'falls back to minimum_units; check qualifier renders',
  },
  // 6-8. Tiered all three tiers
  {
    slug: 'qd2506', name: 'D06 Tier Small',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'RPNT-28', selectedTier: 'Small' }],
    expectedShape: 'tiered',
  },
  {
    slug: 'qd2507', name: 'D07 Tier Medium',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'RPNT-28', selectedTier: 'Medium' }],
    expectedShape: 'tiered',
  },
  {
    slug: 'qd2508', name: 'D08 Tier Large',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'RPNT-28', selectedTier: 'Large' }],
    expectedShape: 'tiered',
  },
  // 9. Tiered with invalid tier name — engine should fall through gracefully
  {
    slug: 'qd2509', name: 'D09 Tier invalid',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'RPNT-28', selectedTier: 'XLarge' }],
    expectedShape: 'tiered',
    expectedAnomalyHint: 'invalid tier should fall through to custom or fail gracefully',
  },
  // 10. Mixed SKU + custom
  {
    slug: 'qd2510', name: 'D10 Mixed',
    lines: [
      { id: 'L1', source: 'sku', skuCode: 'TAP-01' },
      { id: 'L2', source: 'custom', description: 'Bespoke alcove unit', category: 'carpentry', timeEstimateMinutes: 180 },
    ],
    expectedShape: 'mixed',
  },
  // 11. Multi-day via stacked SKU
  {
    slug: 'qd2511', name: 'D11 Multi-day',
    lines: [
      { id: 'L1', source: 'sku', skuCode: 'RPNT-28', selectedTier: 'Large' },
      { id: 'L2', source: 'sku', skuCode: 'TILE-36', selectedTier: 'Large' },
      { id: 'L3', source: 'sku', skuCode: 'WIN-23' },
    ],
    expectedShape: 'multi-day',
    expectedAnomalyHint: 'total schedule should require ≥ 2 days',
  },
  // 12. SKU + materials
  {
    slug: 'qd2512', name: 'D12 SKU+materials',
    lines: [{ id: 'L1', source: 'sku', skuCode: 'TAP-01', materialsCostPence: 4500 }],
    expectedShape: 'fixed',
    expectedAnomalyHint: 'materials should add to line total',
  },
];

interface Anomaly {
  scenario: string;
  layer: 'engine' | 'persist' | 'render';
  severity: 'error' | 'warning' | 'note';
  message: string;
  evidence?: any;
}

const anomalies: Anomaly[] = [];

function flag(scenario: string, layer: Anomaly['layer'], severity: Anomaly['severity'], message: string, evidence?: any) {
  anomalies.push({ scenario, layer, severity, message, evidence });
}

async function runScenario(s: Scenario) {
  console.log(`\n── ${s.name} (${s.slug}) — expected ${s.expectedShape}${s.expectedAnomalyHint ? ` · hint: ${s.expectedAnomalyHint}` : ''} ──`);

  // ─── Layer A: engine input ───
  const lines: JobLine[] = s.lines.map((l) => ({
    id: l.id,
    description: l.description || 'placeholder',
    category: (l.category || 'general_fixing') as any,
    timeEstimateMinutes: l.timeEstimateMinutes || 60,
    materialsCostPence: l.materialsCostPence || 0,
    source: l.source,
    skuCode: l.skuCode,
    unitCount: l.unitCount,
    selectedTier: l.selectedTier,
  } as JobLine));

  const request: MultiLineRequest = {
    lines,
    signals: {
      urgency: 'standard',
      materialsSupply: 'labor_only',
      timeOfService: 'standard',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: 0,
    },
    customerKnown: false,
  };

  // ─── Layer B: engine output ───
  let result: any;
  try {
    result = await generateMultiLinePrice(request);
  } catch (err: any) {
    flag(s.slug, 'engine', 'error', `Engine threw: ${err?.message || err}`, { stack: err?.stack });
    return;
  }

  if (!result?.lineItems?.length) {
    flag(s.slug, 'engine', 'error', `No lineItems returned`, result);
    return;
  }

  for (const li of result.lineItems) {
    if (li.guardedPricePence == null || isNaN(li.guardedPricePence)) {
      flag(s.slug, 'engine', 'error', `Line ${li.lineId}: guardedPricePence missing/NaN`, li);
    }
    if (li.scheduleMinutes == null && li.timeEstimateMinutes == null) {
      flag(s.slug, 'engine', 'error', `Line ${li.lineId}: no schedule/time minutes`, li);
    }
    if (li.source === 'sku') {
      if (!li.skuName) flag(s.slug, 'engine', 'error', `SKU line ${li.lineId}: skuName missing`, li);
      if (!li.skuCustomerDescription) flag(s.slug, 'engine', 'error', `SKU line ${li.lineId}: skuCustomerDescription missing`, li);
      if (li.skuShape === 'per_unit') {
        if (li.unitCount == null) flag(s.slug, 'engine', 'warning', `Per-unit line ${li.lineId}: unitCount missing on engine output`, li);
        if (!li.skuUnitLabel) flag(s.slug, 'engine', 'warning', `Per-unit line ${li.lineId}: skuUnitLabel missing`, li);
      }
      if (li.skuShape === 'tiered') {
        if (!li.selectedTier) flag(s.slug, 'engine', 'warning', `Tiered line ${li.lineId}: selectedTier missing`, li);
      }
    } else if (li.source === 'custom' || li.source == null) {
      // Custom lines shouldn't have SKU display fields
      if (li.skuName != null) flag(s.slug, 'engine', 'warning', `Custom line ${li.lineId}: has stray skuName`, li);
    }
  }

  const totalFromLines = result.lineItems.reduce((s: number, li: any) => s + (li.guardedPricePence || 0) + (li.materialsWithMarginPence || 0), 0);
  if (result.totalPricePence != null && Math.abs(totalFromLines - result.totalPricePence) > 100) {
    flag(s.slug, 'engine', 'warning', `Total mismatch — sum=${totalFromLines}, reported=${result.totalPricePence}`);
  }

  // ─── Layer C: persist ───
  // Delete any prior row at this slug, then insert.
  await db.delete(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, [s.slug]));
  const id = `qd25_${s.slug}_${Date.now()}`;
  try {
    await db.insert(personalizedQuotes).values({
      id,
      shortSlug: s.slug,
      customerName: `QA ${s.slug}`,
      phone: TEST_PHONE,
      postcode: TEST_POSTCODE,
      coordinates: TEST_COORDS as any,
      jobDescription: s.name,
      pricingLineItems: result.lineItems as any,
      basePrice: totalFromLines,
    });
  } catch (err: any) {
    flag(s.slug, 'persist', 'error', `Insert threw: ${err?.message || err}`);
    return;
  }

  // Read back + verify round-trip
  const [readBack] = await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, [s.slug]));
  const persisted = readBack?.pricingLineItems as any[];
  if (!Array.isArray(persisted) || persisted.length !== result.lineItems.length) {
    flag(s.slug, 'persist', 'error', `Round-trip mismatch: expected ${result.lineItems.length} lines, got ${persisted?.length}`);
    return;
  }
  for (let i = 0; i < persisted.length; i++) {
    const orig = result.lineItems[i];
    const pers = persisted[i];
    for (const key of ['guardedPricePence', 'source', 'skuName', 'skuCustomerDescription', 'description']) {
      if (orig[key] !== pers[key] && !(orig[key] === undefined && pers[key] === null)) {
        flag(s.slug, 'persist', 'warning', `Round-trip drift on ${key}`, { orig: orig[key], persisted: pers[key] });
      }
    }
  }

  console.log(`  ✓ engine + persist OK · total £${(totalFromLines / 100).toFixed(2)} · ${result.lineItems.length} line(s)`);
}

async function main() {
  console.log('═══ Phase 25 debug: generate + verify across edge cases ═══');
  await db.delete(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, SCENARIOS.map(s => s.slug)));

  for (const s of SCENARIOS) {
    await runScenario(s);
  }

  // ─── Report ───
  console.log('\n\n═══ Phase 1 evidence report ═══');
  if (anomalies.length === 0) {
    console.log('  ✓ No anomalies surfaced at engine or persist layer');
  } else {
    const byLayer = anomalies.reduce((m: any, a) => { (m[a.layer] = m[a.layer] || []).push(a); return m; }, {});
    for (const [layer, list] of Object.entries(byLayer)) {
      console.log(`\n  ${layer.toUpperCase()} (${(list as Anomaly[]).length}):`);
      for (const a of list as Anomaly[]) {
        const sev = a.severity === 'error' ? '❌' : a.severity === 'warning' ? '⚠' : 'ℹ';
        console.log(`    ${sev} [${a.scenario}] ${a.message}`);
        if (a.evidence !== undefined) {
          const ev = typeof a.evidence === 'string' ? a.evidence : JSON.stringify(a.evidence).slice(0, 200);
          console.log(`        evidence: ${ev}`);
        }
      }
    }
  }

  const port = process.env.PREVIEW_PORT || '50174';
  console.log('\n\n═══ Customer page URLs for render-layer inspection ═══');
  for (const s of SCENARIOS) {
    console.log(`  ${s.slug} · ${s.name} · http://localhost:${port}/quote-link/${s.slug}`);
  }

  console.log('\n(Quotes persisted. Run scripts/_qa-phase25-debug-cleanup.ts when done.)');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
