/**
 * Phase 26 / Anomaly #1 — per-unit SKU without unitCount should
 * still emit the effective count (= minimum_units) on the engine
 * output so the customer page can render "× 1 door".
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
  console.log('\n═══ Anomaly #1 test: per-unit SKU writes effective unitCount ═══\n');
  const baseSignals = { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 } as const;

  // Case A: per-unit, NO unitCount → engine must populate the resolved minimum
  console.log('Case A — per-unit SKU with NO unitCount (DOOR-15, min=1)');
  {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'general_fixing' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'DOOR-15' } as JobLine],
      signals: baseSignals as any, customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    const line = result.lineItems[0] as any;
    check('Line resolves as SKU', line.source === 'sku' || line.skuCode === 'DOOR-15');
    check('unitCount populated on output', line.unitCount != null && line.unitCount > 0, `unitCount=${line.unitCount}`);
    check('unitCount equals minimum (1)', line.unitCount === 1, `unitCount=${line.unitCount}`);
    check('Price reflects single unit (£85)', line.guardedPricePence === 8500, `${line.guardedPricePence}p`);
  }

  // Case B: per-unit WITH unitCount=3 → engine echoes it through (no regression)
  console.log('\nCase B — per-unit SKU with unitCount=3 (no regression)');
  {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'general_fixing' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'DOOR-15', unitCount: 3 } as JobLine],
      signals: baseSignals as any, customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    const line = result.lineItems[0] as any;
    check('unitCount === 3 echoed through', line.unitCount === 3, `unitCount=${line.unitCount}`);
  }

  // Case C: per-unit with unitCount BELOW min (0) → engine clamps to minimum
  console.log('\nCase C — per-unit SKU with unitCount=0 (below min)');
  {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'general_fixing' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'DOOR-15', unitCount: 0 } as JobLine],
      signals: baseSignals as any, customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    const line = result.lineItems[0] as any;
    check('unitCount clamped UP to min (1)', line.unitCount === 1, `unitCount=${line.unitCount}`);
    check('Price reflects minimum (£85)', line.guardedPricePence === 8500, `${line.guardedPricePence}p`);
  }

  // Case D: fixed SKU should NOT have a unitCount written
  console.log('\nCase D — fixed SKU (TAP-01) does NOT get a unitCount');
  {
    const req: MultiLineRequest = {
      lines: [{ id: 'L1', description: 'x', category: 'plumbing_minor' as any, timeEstimateMinutes: 60, source: 'sku', skuCode: 'TAP-01' } as JobLine],
      signals: baseSignals as any, customerKnown: false,
    };
    const result = await generateMultiLinePrice(req);
    const line = result.lineItems[0] as any;
    check('Fixed SKU has no unitCount (or undefined)', line.unitCount == null, `unitCount=${line.unitCount}`);
  }

  console.log(`\n═══ ${pass} pass, ${fail} fail ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
