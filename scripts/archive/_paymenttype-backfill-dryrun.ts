import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { isNotNull, desc, eq } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY DRY-RUN. *** PERFORMS NO WRITES. *** Pure db.select + Stripe reads.
//
// Previews the paymentType-mislabel backfill: for every PAID quote currently
// labelled paymentType='full', reconcile against the AUTHORITATIVE evidence and
// decide whether a backfill WOULD flip it to 'deposit'.
//
// Why the mislabel exists: the customer page's fire-and-forget /track-booking PUT
// sent a stale 'full' (its legacy paymentMode state never learned the inline
// card's deposit choice) that race-clobbered the Stripe webhook's correct
// 'deposit'. Net effect: a deposit-payer's row reads 'full', and the confirmation
// page then tells them "paid in full / nothing more to pay" while they still owe.
//
// Authoritative truth, in priority order:
//   1. Stripe PI metadata.paymentType  — what the PI was CREATED as (the card's
//      real choice). Highest confidence.
//   2. depositAmountPence / basePrice   — webhook-written ACTUAL pence collected.
//      ~0.30 ⇒ a deposit was charged regardless of the (wrong) label.
//   3. invoice.balanceDue > 0           — corroborates money still outstanding.
//
// Verdicts:
//   FLIP (HIGH)  — PI metadata says 'deposit'. Backfill should set 'deposit'.
//   FLIP (MED)   — no/again-'full' metadata, BUT ratio ≤ 0.45 AND balanceDue > 0.
//   MANUAL       — mid ratio (0.45–0.85): eyeball before touching.
//   KEEP         — genuine full (ratio ≥ 0.85, no outstanding balance).
//   SKIP         — no charge data (e.g. QA seed rows) — nothing to reconcile.
// ─────────────────────────────────────────────────────────────────────────────

const FETCH = parseInt(process.argv[2] || '250', 10);
const LOW = 0.45;   // ≤ this ⇒ looks like a 30% deposit
const HIGH = 0.85;  // ≥ this ⇒ looks like a ~full payment

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = stripeKey.startsWith('sk_') ? new Stripe(stripeKey) : null;

const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));
const dt = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : '—';

type Verdict = 'FLIP-HIGH' | 'FLIP-MED' | 'MANUAL' | 'KEEP' | 'SKIP';

async function main() {
  console.log('\n' + '='.repeat(78));
  console.log('  READ-ONLY DRY-RUN — paymentType backfill preview. NO WRITES PERFORMED.');
  console.log('='.repeat(78));
  console.log(`  Stripe PI cross-check: ${stripe ? 'ENABLED' : 'DISABLED (no STRIPE_SECRET_KEY)'}`);

  const rows = await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(FETCH);

  const suspects = rows.filter((q) => q.paymentType === 'full');
  console.log(`  Fetched ${rows.length} paid quotes · ${suspects.length} currently labelled 'full'\n`);

  const buckets: Record<Verdict, string[]> = {
    'FLIP-HIGH': [], 'FLIP-MED': [], 'MANUAL': [], 'KEEP': [], 'SKIP': [],
  };
  let hiddenBalance = 0; // sum of outstanding balance on rows we'd flip

  for (const q of suspects) {
    const base = q.basePrice || q.essentialPrice || 0;
    const paid = q.depositAmountPence;
    const ratio = base > 0 && paid != null ? paid / base : null;

    // invoice corroboration — largest outstanding balance for this quote
    const invs = await db.select().from(invoices).where(eq(invoices.quoteId, q.id));
    const balanceDue = invs.reduce((m, i: any) => Math.max(m, i.balanceDue ?? 0), 0);
    const invNo = invs.find((i: any) => (i.balanceDue ?? 0) > 0)?.invoiceNumber
      || invs[0]?.invoiceNumber || '—';

    // authoritative Stripe metadata (what the PI was created as)
    let metaPT = '—';
    let piAmount: number | null = null;
    if (stripe && q.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(q.stripePaymentIntentId);
        metaPT = pi.metadata?.paymentType ?? '—';
        piAmount = pi.amount_received ?? pi.amount ?? null;
      } catch (e: any) {
        metaPT = `(fetch failed: ${e.message})`;
      }
    }

    // ── verdict ──────────────────────────────────────────────────────────────
    let verdict: Verdict;
    let why: string;
    if (paid == null || base === 0) {
      verdict = 'SKIP';
      why = 'no charge/base data (QA seed or pre-webhook row)';
    } else if (metaPT === 'deposit') {
      verdict = 'FLIP-HIGH';
      why = `PI metadata.paymentType='deposit' (authoritative); charged ${gbp(piAmount)} (ratio ${ratio!.toFixed(2)})`;
    } else if (ratio! <= LOW && balanceDue > 0) {
      verdict = 'FLIP-MED';
      why = `charged ${gbp(paid)} = ${(ratio! * 100).toFixed(0)}% of base + invoice balance ${gbp(balanceDue)} outstanding`;
    } else if (ratio! < HIGH) {
      verdict = 'MANUAL';
      why = `mid ratio ${(ratio! * 100).toFixed(0)}% — eyeball (metaPT=${metaPT}, balance=${gbp(balanceDue)})`;
    } else {
      verdict = 'KEEP';
      why = `ratio ${(ratio! * 100).toFixed(0)}% + balance ${gbp(balanceDue)} ⇒ genuine full`;
    }

    if (verdict === 'FLIP-HIGH' || verdict === 'FLIP-MED') hiddenBalance += balanceDue;

    const line = `${q.shortSlug}  ${dt(q.depositPaidAt)}  ${q.customerName}  `
      + `base=${gbp(base)} paid=${gbp(paid)} bal=${gbp(balanceDue)} inv=${invNo} metaPT=${metaPT}`;
    buckets[verdict].push(`${line}\n        → ${why}`);
  }

  const order: Verdict[] = ['FLIP-HIGH', 'FLIP-MED', 'MANUAL', 'KEEP', 'SKIP'];
  for (const v of order) {
    const list = buckets[v];
    if (!list.length) continue;
    console.log('─'.repeat(78));
    console.log(`${v}  (${list.length})`);
    console.log('─'.repeat(78));
    list.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}. ${l}`));
    console.log('');
  }

  const flipHigh = buckets['FLIP-HIGH'].length;
  const flipMed = buckets['FLIP-MED'].length;
  console.log('='.repeat(78));
  console.log('  SUMMARY (DRY-RUN — nothing was written)');
  console.log('='.repeat(78));
  console.log(`  WOULD FLIP → 'deposit' (HIGH, Stripe-authoritative): ${flipHigh}`);
  console.log(`  WOULD FLIP → 'deposit' (MED, ratio+invoice)        : ${flipMed}`);
  console.log(`  MANUAL (mid ratio — eyeball)                       : ${buckets['MANUAL'].length}`);
  console.log(`  KEEP (genuine full)                                : ${buckets['KEEP'].length}`);
  console.log(`  SKIP (no charge data / QA seed)                    : ${buckets['SKIP'].length}`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  Total rows that WOULD flip                         : ${flipHigh + flipMed}`);
  console.log(`  Outstanding balance un-hidden by the flip          : ${gbp(hiddenBalance)}`);
  console.log('='.repeat(78));
  console.log('\n  To actually apply: review the FLIP lists above, then ask me to run the');
  console.log('  write version. MANUAL rows are excluded from any auto-backfill.\n');

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
