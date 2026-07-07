import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

const LIMIT = parseInt(process.argv[2] || '40', 10);

function dt(d?: Date | string | null) {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
}
function gbp(p?: number | null) {
  return p == null ? '—' : '£' + (p / 100).toFixed(2);
}

async function main() {
  const rows = await db
    .select()
    .from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(LIMIT);

  const buckets = { flex: 0, pickdate: 0, neither: 0 };
  // cross-tab: customerType -> verdict counts
  const byType: Record<string, { flex: number; pickdate: number; neither: number }> = {};

  console.log(`\n${rows.length} most-recent PAID quotes — flex vs pick-a-date vs NEITHER\n`);

  rows.forEach((q, i) => {
    const flex = q.flexBookingWithinDays != null;
    const hasDate = q.selectedDate != null;
    const verdict = flex ? 'FLEX' : hasDate ? 'PICK-DATE' : 'NEITHER';
    if (flex) buckets.flex++;
    else if (hasDate) buckets.pickdate++;
    else buckets.neither++;

    const ctype =
      ((q as any).contextSignals?.customerType as string) || (q.segment ?? 'unknown');
    byType[ctype] ??= { flex: 0, pickdate: 0, neither: 0 };
    if (flex) byType[ctype].flex++;
    else if (hasDate) byType[ctype].pickdate++;
    else byType[ctype].neither++;

    const tag = verdict === 'NEITHER' ? '  <<< NEITHER' : '';
    console.log(
      `${String(i + 1).padStart(2)}. ${q.shortSlug}  ${dt(q.depositPaidAt)}  ${gbp(q.depositAmountPence)}/${gbp(q.basePrice)} (${q.paymentType || '?'})  type=${ctype}  seg=${q.segment}  -> ${verdict}${tag}`,
    );
  });

  console.log('\n' + '─'.repeat(70));
  console.log(
    `TOTALS: FLEX=${buckets.flex}  PICK-DATE=${buckets.pickdate}  NEITHER=${buckets.neither}  (of ${rows.length})`,
  );
  console.log('\nBy customerType / segment:');
  Object.entries(byType)
    .sort((a, b) => b[1].neither - a[1].neither)
    .forEach(([t, c]) => {
      console.log(
        `  ${t.padEnd(18)} flex=${c.flex}  pick-date=${c.pickdate}  NEITHER=${c.neither}`,
      );
    });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
