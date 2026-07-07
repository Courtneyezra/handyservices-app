import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

// READ-ONLY. For the last N paid quotes, lay out the three prices side by side:
//   GENERATED  — what the engine produced  (basePrice; baseJobPrice/anchor for context)
//   SHOWN      — what the customer saw/selected (selectedTierPricePence + extras; depositAmountPence)
//   PAID       — what Stripe actually captured (sum of succeeded PI amount_received)
// and flag every divergence. Charge logic mirrors server/stripe-routes.ts:
//   totalJobPrice = basePrice + selectedExtras; deposit = materials + 30%*(total-materials).
const LIMIT = parseInt(process.argv[2] || '10', 10);
const stripeKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = stripeKey.startsWith('sk_') ? new Stripe(stripeKey) : null;
const DEPOSIT_FRACTION = 0.30; // default; real value is settings.depositPercent/100

const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));
const dt = (d?: Date | string | number | null) => {
  if (d == null) return '—';
  const date = typeof d === 'number' ? new Date(d * 1000) : new Date(d);
  return date.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false });
};
const depositOf = (total: number, materials: number) =>
  materials + Math.round((total - materials) * DEPOSIT_FRACTION);

async function piForQuote(qid: string, storedId?: string | null) {
  if (!stripe) return null;
  try {
    const res = await stripe.paymentIntents.search({ query: `metadata['quoteId']:'${qid}'`, limit: 20 });
    const all = res.data.sort((a, b) => a.created - b.created);
    const succeeded = all.filter((pi) => pi.status === 'succeeded');
    const latest = succeeded[succeeded.length - 1];
    return {
      count: all.length,
      statuses: all.map((p) => p.status).join(','),
      paid: succeeded.reduce((s, pi) => s + pi.amount_received, 0),
      metaTotal: latest ? parseInt(latest.metadata?.totalJobPrice || '0', 10) || null : null,
      metaDeposit: latest ? parseInt(latest.metadata?.depositAmount || '0', 10) || null : null,
      metaPayType: latest?.metadata?.paymentType ?? null,
      metaExtras: latest?.metadata?.selectedExtras ?? null,
    };
  } catch {
    if (!storedId) return null;
    try {
      const pi = await stripe.paymentIntents.retrieve(storedId);
      return {
        count: 1, statuses: pi.status,
        paid: pi.status === 'succeeded' ? pi.amount_received : 0,
        metaTotal: parseInt(pi.metadata?.totalJobPrice || '0', 10) || null,
        metaDeposit: parseInt(pi.metadata?.depositAmount || '0', 10) || null,
        metaPayType: pi.metadata?.paymentType ?? null,
        metaExtras: pi.metadata?.selectedExtras ?? null,
      };
    } catch { return null; }
  }
}

async function main() {
  const paid = await db
    .select()
    .from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(LIMIT);

  console.log(`\n${paid.length} most-recent PAID quotes (by depositPaidAt, newest first)\n`);
  let mismatched = 0;

  for (let i = 0; i < paid.length; i++) {
    const q = paid[i] as any;

    // GENERATED
    const basePrice = q.basePrice || q.essentialPrice || 0;
    // SHOWN (snapshot the customer selected against)
    const seenTier = q.selectedTierPricePence as number | null;
    const schedFee = (q.schedulingFeeInPence as number) || 0;
    const batchPct = (q.batchDiscountPercent as number) || 0;

    // extras the customer selected, priced from the quote's optionalExtras
    const optionalExtras = (q.optionalExtras as any[]) || [];
    const selExtras = (q.selectedExtras as string[]) || [];
    let extrasTotal = 0;
    let extrasMaterials = 0;
    for (const lbl of selExtras) {
      const e = optionalExtras.find((x: any) => x.label === lbl);
      if (e) { extrasTotal += e.priceInPence || 0; extrasMaterials += e.materialsCostInPence || 0; }
    }
    const materials = ((q.materialsCostWithMarkupPence as number) || 0) + extrasMaterials;

    // server's authoritative total (what it charges off) vs what the page implied
    const serverTotal = basePrice + extrasTotal;             // from basePrice
    const seenTotal = (seenTier ?? basePrice) + extrasTotal; // from snapshot
    const depositShown = q.depositAmountPence as number | null;
    const expDepFromSeen = depositOf(seenTotal, materials);
    const expFullFromSeen = Math.round(seenTotal * 0.97);

    const pi = await piForQuote(q.id, q.stripePaymentIntentId);

    // FLAGS
    const flags: string[] = [];
    if (seenTier != null && seenTier !== basePrice)
      flags.push(`SHOWN≠GENERATED: customer saw ${gbp(seenTier)} but basePrice is ${gbp(basePrice)}`);
    if (q.selectedAt && q.updatedAt && new Date(q.updatedAt) > new Date(q.selectedAt))
      flags.push(`EDITED AFTER SELECT: updatedAt ${dt(q.updatedAt)} > selectedAt ${dt(q.selectedAt)}`);
    if (schedFee > 0) flags.push(`schedulingFee ${gbp(schedFee)} present (NOT in Stripe charge)`);
    if (batchPct > 0) flags.push(`batchDiscount ${batchPct}% present (NOT in Stripe charge)`);
    if (pi) {
      if (pi.metaTotal != null && pi.metaTotal !== serverTotal)
        flags.push(`PI total ${gbp(pi.metaTotal)} ≠ base+extras ${gbp(serverTotal)}`);
      if (seenTier != null && pi.metaTotal != null && pi.metaTotal !== seenTotal)
        flags.push(`PI total ${gbp(pi.metaTotal)} ≠ shown total ${gbp(seenTotal)}`);
      const payType = pi.metaPayType || q.paymentType;
      const expectedCharge = payType === 'full' ? expFullFromSeen : expDepFromSeen;
      if (pi.paid != null && Math.abs(pi.paid - expectedCharge) > 1)
        flags.push(`PAID ${gbp(pi.paid)} ≠ expected-from-shown ${gbp(expectedCharge)} (${payType})`);
      if (pi.count > 1) flags.push(`${pi.count} PIs (statuses: ${pi.statuses})`);
    }
    if (flags.length) mismatched++;

    console.log(`${String(i + 1).padStart(2)}. ${q.shortSlug}  ${(q.customerName || '').trim()}  [${q.paymentType || '?'}]  paid ${dt(q.depositPaidAt)}`);
    console.log(`    job        : ${(q.jobDescription || '').replace(/\s+/g, ' ').slice(0, 80)}`);
    console.log(`    GENERATED  : basePrice ${gbp(basePrice)}  (baseJob ${gbp(q.baseJobPricePence)}, anchor ${gbp(q.anchorPrice)})  generatedAt ${dt(q.createdAt)}`);
    console.log(`    SHOWN      : selectedTier ${gbp(seenTier)}  + extras ${gbp(extrasTotal)} ${selExtras.length ? '(' + selExtras.join(', ') + ')' : ''}  = shownTotal ${gbp(seenTotal)}  | depositShown ${gbp(depositShown)}  selectedAt ${dt(q.selectedAt)}`);
    console.log(`    PAID       : ${pi ? gbp(pi.paid) + `  (PI total meta ${gbp(pi.metaTotal)}, deposit meta ${gbp(pi.metaDeposit)}, ${pi.count} PI, ${pi.statuses})` : 'stripe unavailable'}`);
    console.log(`    EXPECT     : deposit-from-shown ${gbp(expDepFromSeen)} | full-from-shown ${gbp(expFullFromSeen)}`);
    console.log(`    ${flags.length ? '⚠️  ' + flags.join('\n    ⚠️  ') : '✓ consistent'}`);
    console.log('');
  }

  console.log('─'.repeat(72));
  console.log(`SUMMARY: ${paid.length} paid · ${mismatched} with at least one flag · ${paid.length - mismatched} clean`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
