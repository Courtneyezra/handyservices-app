import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const SLUG = 'jitqojb7';
const gbp = (p?: number | null) => p == null ? '—' : '£' + (p / 100).toFixed(2);

async function main() {
  const q = (await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, SLUG)))[0] as any;
  if (!q) { console.log('NO QUOTE FOUND for slug', SLUG); process.exit(0); }

  console.log('stripePaymentIntentId =', q.stripePaymentIntentId || '—');
  console.log('selectedDate/Time     =', q.selectedDate || q.scheduledDate || '—', '/', q.selectedTimeSlot || q.selectedSlot || '—');
  console.log('createdAt             =', q.createdAt, ' depositPaidAt =', q.depositPaidAt);
  console.log('');

  // Search the entire raw row for any field that equals 220 / 22000 / "220"
  console.log('--- HUNT for 220 / 22000 anywhere in the row ---');
  let found = false;
  const raw = JSON.stringify(q);
  for (const [k, v] of Object.entries(q)) {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s == null) continue;
    if (/(^|[^0-9])(220|22000)([^0-9]|$)/.test(s)) {
      console.log('  HIT:', k, '=', s.length > 200 ? s.slice(0, 200) + '…' : s);
      found = true;
    }
  }
  if (!found) console.log('  No field contains 220 or 22000. (raw row length', raw.length, 'chars)');
  console.log('');

  console.log('--- key fields ---');
  console.log('basePrice                    ', gbp(q.basePrice));
  console.log('selectedTierPricePence       ', gbp(q.selectedTierPricePence));
  console.log('selectedPackage              ', q.selectedPackage);
  console.log('depositAmountPence           ', gbp(q.depositAmountPence));
  console.log('paymentType                  ', q.paymentType);
  console.log('flexBookingWithinDays        ', q.flexBookingWithinDays);
  console.log('lanePricing/contextSignals   ', JSON.stringify(q.contextSignals || q.lanePricing || null));
  console.log('');

  const inv = (await db.select().from(invoices).where(eq(invoices.quoteId, q.id)))[0] as any;
  console.log('--- INVOICE ---');
  if (inv) {
    console.log('  number=', inv.invoiceNumber, ' status=', inv.status, ' stripePI=', inv.stripePaymentIntentId || '—');
    console.log('  total=', gbp(inv.totalAmount), ' depositPaid=', gbp(inv.depositPaid), ' balanceDue=', gbp(inv.balanceDue), ' paidAt=', inv.paidAt || '—', ' createdAt=', inv.createdAt);
  } else console.log('  NONE');

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
