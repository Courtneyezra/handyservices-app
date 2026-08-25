import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

// READ-ONLY over/under-charge audit. For each recent PAID quote we pull EVERY
// Stripe PI (source of truth for what was charged AND what flex/date the customer
// selected at payment — these aren't persisted on the quote row). We then compare:
//   CHARGED  = sum of succeeded amount_received
//   SEEN     = what the customer-facing card showed = formula( basePrice
//              − flexDiscount(£12–30) + liaison(+£25) + extras ), materials-aware
// Charge formula mirrors stripe-routes.ts: deposit = materials + 30%*(total−materials);
// full = round(total*0.97). Date/slot premiums shown on the card aren't reconstructable
// here (not persisted), so those are flagged qualitatively, not in the £ delta.
const LIMIT = parseInt(process.argv[2] || '40', 10);
const key = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = new Stripe(key);
const DEP = 0.30, FULL = 0.97, FLEX_PCT = 0.07, FLEX_MIN = 1200, FLEX_MAX = 3000, LIAISE = 2500;

const gbp = (p?: number | null) => (p == null ? '—' : (p < 0 ? '-£' + (-p / 100).toFixed(2) : '£' + (p / 100).toFixed(2)));
const dt = (d?: Date | string | null) => (!d ? '—' : new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }));
const depOf = (total: number, mats: number) => mats + Math.round((total - mats) * DEP);
const fullOf = (total: number) => Math.round(total * FULL);

async function main() {
  const paid = await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(LIMIT);

  let over = 0, under = 0, exact = 0, drift = 0, flexAtPay = 0, premiumDate = 0;
  let overSum = 0, underSum = 0, balanceDriftSum = 0;
  const issues: string[] = [];

  for (const q of paid as any[]) {
    const base = q.basePrice || q.essentialPrice || 0;
    const seenTier = q.selectedTierPricePence as number | null;
    const isLandlord = q.segment === 'LANDLORD';
    const isBusiness = q.segment === 'BUSINESS' || q.segment === 'BUSY_PRO';

    const optionalExtras = (q.optionalExtras as any[]) || [];
    const selExtras = (q.selectedExtras as string[]) || [];
    let extras = 0, extrasMats = 0;
    for (const l of selExtras) { const e = optionalExtras.find((x: any) => x.label === l); if (e) { extras += e.priceInPence || 0; extrasMats += e.materialsCostInPence || 0; } }
    const mats = ((q.materialsCostWithMarkupPence as number) || 0) + extrasMats;

    // Pull PIs (truth for charge + flex/date + the price the charge was based on)
    let charged = 0, payType = q.paymentType || 'deposit', flexDays = 0, schedDate = '', schedSlot = '', metaTotal: number | null = null;
    try {
      const res = await stripe.paymentIntents.search({ query: `metadata['quoteId']:'${q.id}'`, limit: 20 });
      const succ = res.data.filter(p => p.status === 'succeeded');
      charged = succ.reduce((s, p) => s + p.amount_received, 0);
      const latest = succ.sort((a, b) => b.created - a.created)[0] || res.data[0];
      if (latest) {
        payType = latest.metadata?.paymentType || payType;
        flexDays = parseInt(latest.metadata?.flexBookingWithinDays || '0', 10) || 0;
        schedDate = latest.metadata?.scheduledDate || '';
        schedSlot = latest.metadata?.scheduledSlot || '';
        metaTotal = parseInt(latest.metadata?.totalJobPrice || '', 10) || null; // price the charge was based on, frozen at payment
      }
    } catch (e: any) { issues.push(`${q.shortSlug}: stripe search failed (${e.message})`); continue; }
    if (charged === 0) continue; // not actually captured

    // Reconstruct flex/liaison the customer may have seen at payment
    const flexDiscount = (flexDays > 0 && !isLandlord && !isBusiness) ? Math.min(FLEX_MAX, Math.max(FLEX_MIN, Math.round(base * FLEX_PCT))) : 0;
    const liaise = (isLandlord && flexDays > 0) ? LIAISE : 0;

    // (1) POINT-OF-SALE: did Stripe capture the right amount for the total the
    //     charge was based on (metaTotal, frozen at payment)? Should be exact.
    const agreedTotal = metaTotal != null ? metaTotal : (base + extras); // what they paid against
    const seenTotal = agreedTotal - flexDiscount + liaise; // if flex/liaison were live at pay
    const expectAtPay = payType === 'full' ? fullOf(seenTotal) : depOf(seenTotal, Math.max(0, mats - 0));
    const posGap = charged - expectAtPay; // + over, - under, AT THE TILL

    // (2) POST-PAYMENT DRIFT: was the price changed after the deposit? Compare the
    //     frozen agreed total to the CURRENT price. >0 = customer now owes more.
    const driftGap = metaTotal != null ? (base + extras) - metaTotal : 0;

    const tags: string[] = [];
    if (flexDays > 0) { flexAtPay++; tags.push(`FLEX@pay(${flexDays}d, disc ${gbp(flexDiscount)})`); }
    if (schedDate) { const wd = new Date(schedDate).getDay(); if ([0, 6].includes(wd)) { premiumDate++; tags.push(`weekend date ${schedDate.slice(0, 10)}`); } }
    if (Math.abs(driftGap) > 1) { drift++; balanceDriftSum += driftGap; tags.push(`PRICE CHANGED AFTER PAY: agreed ${gbp(metaTotal)} → now ${gbp(base + extras)} (balance ${driftGap > 0 ? '+' : ''}${gbp(driftGap)})`); }

    let verdict: string;
    if (Math.abs(posGap) <= 1) { exact++; verdict = '✓ at-till'; }
    else if (posGap > 1) { over++; overSum += posGap; verdict = `OVER +${gbp(posGap)}`; }
    else { under++; underSum += -posGap; verdict = `UNDER ${gbp(posGap)}`; }

    if (verdict !== '✓ at-till' || tags.length) {
      issues.push(
        `${q.shortSlug}  ${(q.customerName || '').trim().slice(0, 16).padEnd(16)} ${(q.segment || '').padEnd(10)} [${payType}]  agreed ${gbp(agreedTotal)} charged ${gbp(charged)} (expect ${gbp(expectAtPay)}) → ${verdict}\n     ${tags.join(' · ') || ''}  paid ${dt(q.depositPaidAt)}`
      );
    }
  }

  console.log(`\nOVER/UNDER-CHARGE AUDIT — last ${paid.length} paid quotes\n  (at-till = charged vs the total the charge was based on; drift = price edited after deposit)\n`);
  console.log(issues.join('\n') || '  (no anomalies)');
  console.log('\n' + '─'.repeat(74));
  console.log(`AT THE TILL — Exact: ${exact}  ·  Overcharged: ${over} (Σ ${gbp(overSum)})  ·  Undercharged: ${under} (Σ ${gbp(underSum)})`);
  console.log(`POST-PAY PRICE CHANGES: ${drift} quotes  ·  net balance shift ${gbp(balanceDriftSum)} (positive = customers now owe MORE than they agreed)`);
  console.log(`Other signals — flex active at payment: ${flexAtPay}  ·  weekend date at payment: ${premiumDate}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
