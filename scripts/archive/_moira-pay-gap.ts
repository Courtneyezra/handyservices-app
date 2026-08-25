import { db } from '../server/db';
import { personalizedQuotes, handymanProfiles } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { computeContractorPay } from '../server/lib/contractor-pay';

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);
  const items = (q.pricingLineItems as any[]) || [];
  const deferred = ((q as any).deferredLineItems as any[]) || [];
  const deferredIds = new Set(deferred.map(d => String(d.lineId)));

  const gross = (l: any) => (l.guardedPricePence||0)+(l.materialsWithMarginPence||0)+(l.structuralSharePence||0);

  console.log('ALL 8 LINES on the quote:');
  for (const l of items) {
    const label = l.skuName || l.customerDescription || l.description || l.label || '?';
    console.log(`  ${deferredIds.has(String(l.lineId))?'✗ DEFERRED':'✓ do-now  '}  ${label.slice(0,45).padEnd(45)} £${(gross(l)/100).toFixed(2)}  id=${l.lineId}`);
  }

  const active = items.filter(l => !deferredIds.has(String(l.lineId)));
  const activeGross = active.reduce((s,l)=>s+gross(l),0);
  const deferredGross = deferred.reduce((s:number,d:any)=>s+(d.pricePence||0),0);

  const [craig] = await db.select({ tier: handymanProfiles.deliveryTier }).from(handymanProfiles).where(eq(handymanProfiles.id, 'hp_aa21264a-9143-4116-bda2-2da998255929')).limit(1);
  const payFull = computeContractorPay(items, craig.tier);
  const payKept = computeContractorPay(active, craig.tier);

  console.log('\n── What Craig\'s app currently shows (reads full pricingLineItems) ──');
  console.log(`  job value       £${((q.basePrice||0)/100).toFixed(2)}   (basePrice, unchanged)`);
  console.log(`  Craig pay       £${(payFull.totalPayPence/100).toFixed(2)}   (computeContractorPay on all 8)`);
  console.log(`  materials allow £${(payFull.totalMaterialsPence/100).toFixed(2)}`);

  console.log('\n── What Moira actually booked (kept scope, 4 lines) ──');
  console.log(`  kept gross      £${(activeGross/100).toFixed(2)}`);
  console.log(`  deferred gross  £${(deferredGross/100).toFixed(2)}  (recorded in deferredLineItems, NOT billed now)`);
  console.log(`  Craig pay SHOULD be  £${(payKept.totalPayPence/100).toFixed(2)}   (on kept 4 lines)`);
  console.log(`  materials SHOULD be  £${(payKept.totalMaterialsPence/100).toFixed(2)}`);
  console.log(`\n  OVERSTATEMENT in app: pay +£${((payFull.totalPayPence-payKept.totalPayPence)/100).toFixed(2)}, scope +${deferred.length} extra tasks`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
