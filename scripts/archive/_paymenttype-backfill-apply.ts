import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes, invoices } from '../shared/schema';
import { isNotNull, desc, eq, and } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// WRITE script (GUARDED). Flips paymentType 'full' → 'deposit' for rows the
// dry-run identified as mislabelled deposits, RE-VALIDATING each at write time.
//
//   HIGH : Stripe PI metadata.paymentType === 'deposit' (authoritative).
//   MED  : explicit allowlist of 3 slugs hand-verified via _diag-payment-mismatch
//          (PI description "Deposit for…", exact 30% charge, deposit metadata;
//          their succeeded-PI metadata reads 'full' only because the retry PI
//          inherited the same client mislabel we're now fixing).
//
// SAFE BY DESIGN:
//   • Requires --apply to write. Without it, prints the plan and exits (no writes).
//   • Each UPDATE is guarded `WHERE payment_type='full'` → idempotent; re-runs and
//     already-correct rows are no-ops; MANUAL / KEEP / genuine-full are never touched.
//   • Only ever sets payment_type='deposit'; writes no other column.
// ─────────────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply');
const MED_ALLOWLIST = new Set(['qf3tpwu1', 'eupqbc7n', 'PeA07uEY']);
const FETCH = 250;

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = stripeKey.startsWith('sk_') ? new Stripe(stripeKey) : null;
const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));

async function main() {
  if (!stripe) { console.error('STRIPE_SECRET_KEY required to re-validate HIGH rows. Aborting.'); process.exit(1); }

  console.log('\n' + '='.repeat(78));
  console.log(`  paymentType backfill — ${APPLY ? '*** APPLY (writing) ***' : 'PREVIEW (no --apply, no writes)'}`);
  console.log('='.repeat(78) + '\n');

  const rows = await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(FETCH);

  const suspects = rows.filter((q) => q.paymentType === 'full');

  const targets: { id: string; slug: string; name: string; tier: 'HIGH' | 'MED'; balance: number }[] = [];

  for (const q of suspects) {
    let metaPT = '—';
    if (q.stripePaymentIntentId) {
      try { metaPT = (await stripe.paymentIntents.retrieve(q.stripePaymentIntentId)).metadata?.paymentType ?? '—'; }
      catch { /* manual/unretrievable PI — fall through to allowlist check */ }
    }
    const isHigh = metaPT === 'deposit';
    const isMed = MED_ALLOWLIST.has(q.shortSlug || '');
    if (!isHigh && !isMed) continue;

    const invs = await db.select().from(invoices).where(eq(invoices.quoteId, q.id));
    const balance = invs.reduce((m, i: any) => Math.max(m, i.balanceDue ?? 0), 0);
    targets.push({ id: q.id, slug: q.shortSlug || q.id, name: q.customerName || '—', tier: isHigh ? 'HIGH' : 'MED', balance });
  }

  console.log(`Re-validated ${suspects.length} 'full'-labelled paid rows → ${targets.length} confirmed flips`);
  console.log(`  HIGH (Stripe metadata='deposit'): ${targets.filter(t => t.tier === 'HIGH').length}`);
  console.log(`  MED  (hand-verified allowlist)   : ${targets.filter(t => t.tier === 'MED').length}`);
  console.log(`  Outstanding balance un-hidden    : ${gbp(targets.reduce((s, t) => s + t.balance, 0))}\n`);

  let flipped = 0, skipped = 0;
  for (const t of targets) {
    if (!APPLY) { console.log(`  WOULD FLIP [${t.tier}] ${t.slug}  ${t.name}  (bal ${gbp(t.balance)})`); continue; }
    // Guarded, idempotent: only flips a row that is STILL 'full'.
    const res = await db.update(personalizedQuotes)
      .set({ paymentType: 'deposit' })
      .where(and(eq(personalizedQuotes.id, t.id), eq(personalizedQuotes.paymentType, 'full')))
      .returning({ id: personalizedQuotes.id });
    if (res.length) { flipped++; console.log(`  FLIPPED  [${t.tier}] ${t.slug}  ${t.name}  → 'deposit'`); }
    else { skipped++; console.log(`  skipped  [${t.tier}] ${t.slug}  (no longer 'full' — already correct)`); }
  }

  console.log('\n' + '='.repeat(78));
  if (APPLY) console.log(`  DONE. Flipped ${flipped} row(s) to 'deposit'. Skipped ${skipped} (already correct).`);
  else console.log(`  PREVIEW ONLY — nothing written. Re-run with --apply to commit ${targets.length} flips.`);
  console.log('='.repeat(78) + '\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
