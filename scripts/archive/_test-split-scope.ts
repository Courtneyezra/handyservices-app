import { computeSplitScope } from '../shared/split-scope';

const lineItems = [
  { lineId: 'gdhtcldh', guardedPricePence: 4000, materialsWithMarginPence: 1500, structuralSharePence: 0 },   // curtain pole  raw 5500
  { lineId: 'nrsjomka', guardedPricePence: 17000, materialsWithMarginPence: 3000, structuralSharePence: 0 },  // gas hob       raw 20000
  { lineId: 'wmz6w5wb', guardedPricePence: 14000, materialsWithMarginPence: 0, structuralSharePence: 0 },      // gas cert      raw 14000
];
const fullNetPence = 36000; // basePrice

function show(label: string, deferred: string[]) {
  const s = computeSplitScope({ lineItems, fullNetPence, deferredLineIds: deferred, depositFraction: 0.30 });
  console.log(`\n${label} (defer=[${deferred}])`);
  console.log(`  active £${s.activeJobPricePence/100} | saving £${s.activeSavingPence/100} | materials £${s.activeMaterialsPence/100} | DEPOSIT £${s.activeDepositPence/100} | balance £${s.activeBalancePence/100} | kept=${s.activeCount} deferred=${s.deferredCount}`);
}

show('full scope', []);
show('defer curtain pole', ['gdhtcldh']);       // expect active £310, saving £30, materials £30, deposit £114
show('defer gas hob', ['nrsjomka']);
show('defer curtain + cert', ['gdhtcldh','wmz6w5wb']); // 1 active → no saving
show('defer ALL (blocked)', ['gdhtcldh','nrsjomka','wmz6w5wb']); // should no-op to full
process.exit(0);
