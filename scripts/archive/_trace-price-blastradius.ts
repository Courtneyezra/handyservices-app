import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

// READ-ONLY. The Stripe charge is computed off quote.basePrice (+ optionalExtras)
// only — it ignores flex discount, tenant-liaison premium, date/time scheduling
// fees and Saturday premium that the customer-facing card (UnifiedQuoteCard.tsx)
// folds into the displayed total/deposit. This script finds, among recent PAID
// quotes, the ones where the customer selected such an adjustment, so the price
// they SAW differs from what they were CHARGED. It estimates the £ gap from DB
// fields (flex discount + schedulingFeeInPence + liaison). Saturday SKU premium
// may live outside schedulingFeeInPence, so gaps are a lower bound.
const LIMIT = parseInt(process.argv[2] || '50', 10);
const FLEX_PCT = 0.07, FLEX_MIN = 1200, FLEX_MAX = 3000, LIAISE = 2500, DEP = 0.30;
const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));
const dt = (d?: Date | string | null) => (!d ? '—' : new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }));

async function main() {
  const paid = await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(LIMIT);

  let exposed = 0, totalGap = 0;
  const rows: string[] = [];

  for (const q of paid as any[]) {
    const base = q.basePrice || q.essentialPrice || 0;
    const schedFee = q.schedulingFeeInPence || 0;
    const flexDays = q.flexBookingWithinDays || 0;
    const isLandlord = q.segment === 'LANDLORD';
    const isBusiness = q.segment === 'BUSINESS' || q.segment === 'BUSY_PRO';
    const sched = q.schedulingTier || '';
    const slot = q.timeSlotType || '';
    const weekend = q.selectedDate ? [0, 6].includes(new Date(q.selectedDate).getDay()) : false;

    // Reconstruct the display-side adjustments the charge omits
    const flexDiscount = (flexDays > 0 && !isLandlord && !isBusiness)
      ? Math.min(FLEX_MAX, Math.max(FLEX_MIN, Math.round(base * FLEX_PCT))) : 0;
    const liaise = (isLandlord && flexDays > 0) ? LIAISE : 0;
    const displayTotal = base - flexDiscount + liaise + schedFee;

    const exposedHere = flexDiscount > 0 || liaise > 0 || schedFee > 0 ||
      ['express', 'priority'].includes(sched) || ['exact', 'out_of_hours'].includes(slot) || weekend;
    if (!exposedHere) continue;
    exposed++;

    // Charge is % of base; display implied % of displayTotal. Gap on the deposit
    // (or full) the customer actually paid:
    const payType = q.paymentType || 'deposit';
    const chargeOnBase = payType === 'full' ? Math.round(base * 0.97) : Math.round(base * DEP);
    const chargeOnDisplay = payType === 'full' ? Math.round(displayTotal * 0.97) : Math.round(displayTotal * DEP);
    const gap = chargeOnDisplay - chargeOnBase; // + => customer saw higher than charged; - => saw lower (overcharged)
    totalGap += gap;

    const tags = [
      flexDiscount > 0 ? `flex -${gbp(flexDiscount)}` : '',
      liaise > 0 ? `liaison +${gbp(liaise)}` : '',
      schedFee > 0 ? `schedFee +${gbp(schedFee)}` : '',
      ['express', 'priority'].includes(sched) ? `tier=${sched}` : '',
      ['exact', 'out_of_hours'].includes(slot) ? `slot=${slot}` : '',
      weekend ? 'weekend' : '',
    ].filter(Boolean).join(', ');

    rows.push(
      `  ${q.shortSlug}  ${(q.customerName || '').trim().slice(0, 18).padEnd(18)} ${q.segment?.padEnd(10) || ''} base ${gbp(base)} → display ${gbp(displayTotal)}  [${payType}] paid≈${gbp(chargeOnBase)} vs shown≈${gbp(chargeOnDisplay)}  ${gap === 0 ? '' : (gap < 0 ? `OVERCHARGED ${gbp(-gap)}` : `undercharged ${gbp(gap)}`)}\n      ${tags} · paid ${dt(q.depositPaidAt)}`
    );
  }

  console.log(`\nBlast radius over last ${paid.length} PAID quotes:\n`);
  console.log(rows.join('\n') || '  (none exposed)');
  console.log('\n' + '─'.repeat(72));
  console.log(`EXPOSED: ${exposed}/${paid.length} paid customers selected an adjustment the charge ignores.`);
  console.log(`Net deposit/charge gap across exposed (display − charged): ${gbp(totalGap)}  (negative = customers overcharged vs what they saw)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
