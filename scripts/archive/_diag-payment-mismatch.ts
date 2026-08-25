import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

// READ-ONLY. Diagnose a paymentType-vs-actual-charge mismatch on a quote.
// Pulls the quote's money fields, the stored PaymentIntent (its description +
// metadata reveal what it was CREATED as), and searches Stripe for every PI
// tied to this quote (reveals a full→deposit switch / multiple attempts).
const SLUG = process.argv[2] || 'vc0ikyds';
const stripeKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = stripeKey.startsWith('sk_') ? new Stripe(stripeKey) : null;

const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));
const dt = (d?: Date | string | number | null) => {
  if (d == null) return '—';
  const date = typeof d === 'number' ? new Date(d * 1000) : new Date(d);
  return date.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false });
};

function printPI(pi: Stripe.PaymentIntent, pad = '') {
  console.log(`${pad}id             : ${pi.id}`);
  console.log(`${pad}status         : ${pi.status}`);
  console.log(`${pad}amount         : ${gbp(pi.amount)}`);
  console.log(`${pad}amount_received: ${gbp(pi.amount_received)}`);
  console.log(`${pad}created        : ${dt(pi.created)}`);
  console.log(`${pad}description    : ${pi.description ?? '—'}`);
  console.log(`${pad}meta.paymentType   : ${pi.metadata?.paymentType ?? '—'}`);
  console.log(`${pad}meta.totalJobPrice : ${pi.metadata?.totalJobPrice ?? '—'}`);
  console.log(`${pad}meta.depositAmount : ${pi.metadata?.depositAmount ?? '—'}`);
  console.log(`${pad}meta.lockId        : ${pi.metadata?.lockId ?? '—'}`);
  console.log(`${pad}meta.scheduledDate : ${pi.metadata?.scheduledDate ?? '—'}`);
}

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, SLUG)).limit(1);
  if (!q) { console.log(`No quote for slug ${SLUG}`); process.exit(0); }

  console.log(`\n=== QUOTE ${SLUG} (${q.id}) ===`);
  console.log(`customer            : ${q.customerName}`);
  console.log(`segment / status    : ${q.segment} / ${q.status}`);
  console.log(`paymentType (DB)    : ${q.paymentType}`);
  console.log(`basePrice           : ${gbp(q.basePrice)}`);
  console.log(`essentialPrice      : ${gbp(q.essentialPrice)}`);
  console.log(`selectedTierPricePence       : ${gbp(q.selectedTierPricePence)}`);
  console.log(`materialsCostWithMarkupPence : ${gbp(q.materialsCostWithMarkupPence)}`);
  console.log(`depositAmountPence  : ${gbp(q.depositAmountPence)}`);
  console.log(`selectedExtras      : ${JSON.stringify(q.selectedExtras)}`);
  console.log(`selectedAt          : ${dt(q.selectedAt)}`);
  console.log(`depositPaidAt       : ${dt(q.depositPaidAt)}`);
  console.log(`bookedAt            : ${dt(q.bookedAt)}`);
  console.log(`updatedAt           : ${dt(q.updatedAt)}`);
  console.log(`stripePaymentIntentId: ${q.stripePaymentIntentId ?? '—'}`);

  const base = q.basePrice || q.essentialPrice || 0;
  const mats = q.materialsCostWithMarkupPence || 0;
  const labor = Math.max(0, base - mats);
  const depositCalc = mats + Math.round(labor * 0.30);
  const fullCalc = Math.round(base * 0.97); // pay-in-full ~3% off
  console.log(`\n=== EXPECTED CHARGES (base ${gbp(base)}, materials ${gbp(mats)}) ===`);
  console.log(`  if DEPOSIT (30% formula): ${gbp(depositCalc)}`);
  console.log(`  if FULL (~3% off)       : ${gbp(fullCalc)}`);

  if (stripe) {
    if (q.stripePaymentIntentId) {
      console.log(`\n=== STORED / PAID PI ===`);
      try { printPI(await stripe.paymentIntents.retrieve(q.stripePaymentIntentId)); }
      catch (e: any) { console.log(`  retrieve failed: ${e.message}`); }
    }
    console.log(`\n=== ALL PIs WITH metadata.quoteId='${q.id}' (chronological) ===`);
    try {
      const res = await stripe.paymentIntents.search({ query: `metadata['quoteId']:'${q.id}'`, limit: 20 });
      console.log(`  found ${res.data.length}`);
      res.data.sort((a, b) => a.created - b.created).forEach((pi, i) => {
        console.log(`\n  --- PI #${i + 1} ---`);
        printPI(pi, '  ');
      });
    } catch (e: any) {
      console.log(`  search unavailable (${e.message}) — relying on stored PI only`);
    }
  } else {
    console.log('\nStripe not configured — skipping PI inspection');
  }

  const invs = await db.select().from(invoices).where(eq(invoices.quoteId, q.id));
  console.log(`\n=== INVOICES (${invs.length}) ===`);
  invs.forEach((inv: any) => console.log(JSON.stringify(inv, null, 2)));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
