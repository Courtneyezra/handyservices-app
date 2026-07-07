import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

// READ-ONLY. Blast-radius audit for the paymentType mislabel: the client's
// /track-booking PUT sends paymentType from a legacy 'full'|'installments' state
// (default 'full') that never learns the inline card's full-vs-DEPOSIT choice, so
// it can race-overwrite the webhook's authoritative 'deposit'. depositAmountPence
// is webhook-written = the ACTUAL pence collected, so the ratio to basePrice tells
// us what was really charged regardless of the (possibly wrong) paymentType label.
const FETCH = parseInt(process.argv[2] || '120', 10);
const gbp = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));
const dt = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : '—');

async function main() {
  const rows = await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(FETCH);

  let genuineFull = 0, correctDeposit = 0, installments = 0, mislabelled = 0, ambiguous = 0;
  const mislabelledRows: string[] = [];
  const ambiguousRows: string[] = [];

  for (const q of rows) {
    const base = q.basePrice || q.essentialPrice || 0;
    const paid = q.depositAmountPence;
    const ratio = base > 0 && paid != null ? paid / base : null;
    const pt = q.paymentType || '?';
    const r = ratio == null ? '—' : ratio.toFixed(2);
    const line = `${q.shortSlug}  ${dt(q.depositPaidAt)}  ${q.customerName}  base=${gbp(base)} paid=${gbp(paid)} (ratio ${r})  label=${pt}`;

    if (pt === 'installments') { installments++; continue; }
    if (ratio == null) { ambiguous++; ambiguousRows.push(line + '  [no base/paid]'); continue; }

    if (pt === 'full') {
      if (ratio <= 0.45) { mislabelled++; mislabelledRows.push(line + '  <<< paid ~30% but labelled FULL'); }
      else if (ratio >= 0.85) { genuineFull++; }
      else { ambiguous++; ambiguousRows.push(line + '  [mid ratio — eyeball]'); }
    } else if (pt === 'deposit') {
      if (ratio <= 0.45) correctDeposit++;
      else { ambiguous++; ambiguousRows.push(line + '  [labelled deposit but paid a lot — eyeball]'); }
    } else {
      ambiguous++; ambiguousRows.push(line + `  [unknown paymentType]`);
    }
  }

  console.log(`\nAudited ${rows.length} most-recent PAID quotes.\n`);
  console.log('─'.repeat(72));
  console.log(`genuine FULL (paid ~97%, labelled full)      : ${genuineFull}`);
  console.log(`correct DEPOSIT (paid ~30%, labelled deposit): ${correctDeposit}`);
  console.log(`installments                                 : ${installments}`);
  console.log(`>>> MISLABELLED (paid ~30% but labelled FULL): ${mislabelled}`);
  console.log(`ambiguous / needs eyeball                    : ${ambiguous}`);
  console.log('─'.repeat(72));

  const depositPayers = correctDeposit + mislabelled;
  if (depositPayers > 0) {
    console.log(`\nAmong the ${depositPayers} deposit-payers, ${mislabelled} (${Math.round((mislabelled / depositPayers) * 100)}%) were mislabelled 'full' (race lost to /track-booking).`);
  }

  if (mislabelledRows.length) {
    console.log(`\n=== MISLABELLED (jobs that LOOK fully paid but still owe ~70% balance) ===`);
    mislabelledRows.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}. ${l}`));
  }
  if (ambiguousRows.length) {
    console.log(`\n=== AMBIGUOUS (manual check) ===`);
    ambiguousRows.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}. ${l}`));
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
