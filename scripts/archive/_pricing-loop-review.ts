/**
 * Two-sided pricing loop — fortnightly review (CLI wrapper).
 * Same data as /admin/pricing-loop in Handy OS; logic lives in
 * server/pricing-loop.ts. Usage: npx tsx scripts/_pricing-loop-review.ts [days=60]
 */
import { buildPricingLoopReview } from '../server/pricing-loop';

const days = Number(process.argv[2]) || 60;
const r = await buildPricingLoopReview(days);

const pct = (v: number | null) => (v === null ? '  —' : `${Math.round(v * 100)}%`.padStart(4));
console.log(`\n════ PRICING LOOP REVIEW · last ${r.windowDays} days · ${r.quotesInWindow} real quotes ════`);
console.log(`\n── DEMAND DIAL (WTP) — conversion = paid % of viewed ──`);
console.log('band      gen  viewed  paid  conv  target  margin  suggestion');
for (const b of r.demand) {
  console.log(
    `${b.band.padEnd(9)} ${String(b.generated).padStart(3)}  ${String(b.viewed).padStart(5)}  ${String(b.paid).padStart(4)}  ` +
    `${pct(b.conversion)}  ${pct(b.target)}   ${b.marginPercent === null ? '  — ' : (b.marginPercent + '%').padStart(4)}  ${b.suggestion}`,
  );
  console.log(`${''.padEnd(9)} └ ${b.note}`);
}
console.log(`\n── SUPPLY DIAL (WTBP) — claim rate + time-to-claim ──`);
console.log('tier        share  floor  visit-min  offered  claimed  rate  med-hrs  suggestion');
for (const t of r.supply) {
  console.log(
    `${t.tier.padEnd(11)} ${String(t.sharePercent).padStart(3)}%  £${String(t.floorPerHour).padStart(2)}    £${String(t.visitMin).padStart(3)}     ` +
    `${String(t.offered).padStart(4)}    ${String(t.claimed).padStart(4)}  ${pct(t.claimRate)}  ${t.medianHoursToClaim === null ? '    —' : t.medianHoursToClaim.toFixed(1).padStart(5)}  ${t.suggestion}`,
  );
}
if (r.supply.length === 0) console.log('   (no dispatches in window)');
console.log(`\nActive launch bonuses: ${r.boosts.length ? r.boosts.map(b => `${b.contractor} +${b.percent}%×${b.jobsRemaining}`).join(' · ') : 'none'}`);
console.log(`Guardrails: ${r.guardrails.join(' · ')}`);
process.exit(0);
