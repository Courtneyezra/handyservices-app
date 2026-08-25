/**
 * Phase 26 / Anomaly #2 — failing test for silent tier fallback.
 *
 * BEFORE FIX:  engine silently returns a custom-LLM result.
 * AFTER FIX:   engine throws a clear error.
 *
 * Per the systematic-debugging skill: write the failing test first,
 * implement the smallest possible fix, verify it passes.
 */
import 'dotenv/config';
import { generateMultiLinePrice } from '../server/contextual-pricing/multi-line-engine';
import type { MultiLineRequest, JobLine } from '../shared/contextual-pricing-types';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

async function main() {
  console.log('\n═══ Anomaly #2 test: SKU resolution must error, not silently fall back ═══\n');

  const baseSignals = {
    urgency: 'standard',
    materialsSupply: 'labor_only',
    timeOfService: 'standard',
    isReturningCustomer: false,
    previousJobCount: 0,
    previousAvgPricePence: 0,
  } as const;

  // Case 1: invalid tier
  console.log('Case 1 — invalid tier on tiered SKU');
  try {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'painting' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'PAINT-ROOM-01', selectedTier: 'XLarge' } as JobLine],
      signals: baseSignals as any,
      customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    const line = result.lineItems[0];
    check('Throws on invalid tier', false, `did not throw; got source="${(line as any).source}" price=${line.guardedPricePence}p`);
  } catch (err: any) {
    const msg = String(err?.message || err);
    check('Throws on invalid tier', true, msg.slice(0, 120));
    check('Error message mentions skuCode', /PAINT-ROOM-01/.test(msg));
    check('Error message mentions tier', /XLarge|tier/.test(msg));
  }

  // Case 2: unknown SKU code
  console.log('\nCase 2 — unknown SKU code');
  try {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'general_fixing' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'NONEXISTENT-99' } as JobLine],
      signals: baseSignals as any,
      customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    const line = result.lineItems[0];
    check('Throws on unknown SKU', false, `did not throw; got source="${(line as any).source}" price=${line.guardedPricePence}p`);
  } catch (err: any) {
    const msg = String(err?.message || err);
    check('Throws on unknown SKU', true, msg.slice(0, 120));
    check('Error message mentions skuCode', /NONEXISTENT-99/.test(msg));
  }

  // Case 3: NEGATIVE — pure custom lines must still work (no false-positive throws)
  console.log('\nCase 3 — pure custom line still works (no false throw)');
  try {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'Bespoke alcove unit', category: 'carpentry' as any, timeEstimateMinutes: 180, source: 'custom' } as JobLine],
      signals: baseSignals as any,
      customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    check('Pure custom line returns a result', result.lineItems.length === 1);
    check('Pure custom line has positive price', result.lineItems[0].guardedPricePence > 0, `${result.lineItems[0].guardedPricePence}p`);
  } catch (err: any) {
    check('Pure custom line returns a result', false, `unexpected throw: ${err?.message}`);
  }

  // Case 4: NEGATIVE — valid SKU still works (no false-positive throws)
  console.log('\nCase 4 — valid SKU resolves correctly');
  try {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'painting' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'PAINT-ROOM-01', selectedTier: 'Medium' } as JobLine],
      signals: baseSignals as any,
      customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    check('Valid tier resolves', result.lineItems.length === 1);
    check('Valid tier returns catalog price (£150)', result.lineItems[0].guardedPricePence === 15000, `${result.lineItems[0].guardedPricePence}p`);
  } catch (err: any) {
    check('Valid tier resolves', false, `unexpected throw: ${err?.message}`);
  }

  console.log(`\n═══ ${pass} pass, ${fail} fail ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
