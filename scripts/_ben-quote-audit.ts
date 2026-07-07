/**
 * One-off: for each quote Ben got ACCEPTED in June 2026, dump the job scope
 * + per-line pricing (time, price, materials, effective labour £/hr) so we can
 * sanity-check whether Ben priced correctly.
 * Benchmark: Nottingham labour ~£35-40/hr (see memory pricing-strategy).
 * Usage: npx tsx scripts/_ben-quote-audit.ts
 */
import { db } from '../server/db';
import { users, personalizedQuotes } from '../shared/schema';
import { and, eq, gte, lt, isNotNull } from 'drizzle-orm';

const juneStart = new Date('2026-06-01T00:00:00Z');
const julyStart = new Date('2026-07-01T00:00:00Z');
const p = (n?: number | null) => `£${((n ?? 0) / 100).toFixed(2)}`;

async function main() {
  const [ben] = await db.select({ id: users.id }).from(users).where(eq(users.firstName, 'Ben'));
  if (!ben) throw new Error('No Ben user found');

  const rows = await db.select({
    id: personalizedQuotes.id,
    customerName: personalizedQuotes.customerName,
    phone: personalizedQuotes.phone,
    email: personalizedQuotes.email,
    selectedAt: personalizedQuotes.selectedAt,
    bookedAt: personalizedQuotes.bookedAt,
    jobDescription: personalizedQuotes.jobDescription,
    proposalSummary: personalizedQuotes.proposalSummary,
    contextualMessage: personalizedQuotes.contextualMessage,
    basePrice: personalizedQuotes.basePrice,
    pricingLineItems: personalizedQuotes.pricingLineItems,
  })
    .from(personalizedQuotes)
    .where(and(
      eq(personalizedQuotes.createdBy, ben.id),
      isNotNull(personalizedQuotes.selectedAt),
      gte(personalizedQuotes.selectedAt, juneStart),
      lt(personalizedQuotes.selectedAt, julyStart),
    ))
    .orderBy(personalizedQuotes.selectedAt);

  const isTest = (q: any) =>
    (q.id ?? '').startsWith('test_q_') ||
    /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
    /@example\.com$/i.test(q.email ?? '') ||
    /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');

  const real = rows.filter(q => !isTest(q));
  let n = 0;

  for (const q of real) {
    n++;
    const items = (q.pricingLineItems as any[]) || [];
    let sumPrice = 0, sumMins = 0, sumMat = 0;

    console.log(`\n════════ ${n}. ${(q.customerName ?? '?').trim()} — accepted ${q.selectedAt!.toISOString().slice(0, 10)}${q.bookedAt ? ' [BOOKED]' : ''} — quote ${p(q.basePrice)} ════════`);
    if (q.jobDescription) console.log(`JOB: ${q.jobDescription.trim().replace(/\s*\n\s*/g, ' ')}`);
    const summary = q.proposalSummary || q.contextualMessage;
    if (summary) console.log(`SUMMARY: ${summary.trim()}`);

    if (items.length) {
      console.log(`\n  line                                    time     price    materials   labour   £/hr`);
      for (const it of items) {
        const mins = it.timeEstimateMinutes ?? it.scheduleMinutes ?? 0;
        const price = it.guardedPricePence ?? it.llmSuggestedPricePence ?? it.referencePricePence ?? 0;
        const mat = it.materialsWithMarginPence ?? 0;
        const labour = price - mat;
        const hourly = mins > 0 ? (labour / 100) / (mins / 60) : null;
        sumPrice += price; sumMins += mins; sumMat += mat;
        const desc = (it.description ?? it.category ?? 'item').slice(0, 38).padEnd(38);
        console.log(`  ${desc}  ${String(mins + 'm').padStart(5)}  ${p(price).padStart(8)}  ${p(mat).padStart(9)}  ${p(labour).padStart(8)}  ${hourly != null ? '£' + hourly.toFixed(0) : '—'}`);
      }
      const totLabour = sumPrice - sumMat;
      const totHourly = sumMins > 0 ? (totLabour / 100) / (sumMins / 60) : null;
      console.log(`  ${'—'.repeat(38)}  ${'-'.repeat(5)}  ${'-'.repeat(8)}  ${'-'.repeat(9)}  ${'-'.repeat(8)}  ----`);
      console.log(`  ${'TOTAL'.padEnd(38)}  ${String((sumMins / 60).toFixed(1) + 'h').padStart(5)}  ${p(sumPrice).padStart(8)}  ${p(sumMat).padStart(9)}  ${p(totLabour).padStart(8)}  ${totHourly != null ? '£' + totHourly.toFixed(0) + '/hr' : '—'}`);
      if (sumPrice !== (q.basePrice ?? 0)) console.log(`  ⚠ line-item sum ${p(sumPrice)} ≠ quote price ${p(q.basePrice)}`);
    } else {
      console.log('  (no line items)');
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
