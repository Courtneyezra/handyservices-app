import 'dotenv/config';
import { db } from '../server/db';
import {
  personalizedQuotes,
  contractorBookingRequests,
  jobDispatches,
  invoices,
} from '../shared/schema';
import { isNotNull, desc, inArray } from 'drizzle-orm';

const LIMIT = parseInt(process.argv[2] || '25', 10);

function gbp(pence?: number | null) {
  if (pence == null) return '—';
  return '£' + (pence / 100).toFixed(2);
}
function dt(d?: Date | string | null) {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
}

async function main() {
  const paid = await db
    .select()
    .from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(LIMIT);

  if (!paid.length) {
    console.log('No paid quotes found.');
    process.exit(0);
  }

  const ids = paid.map((q) => q.id);
  const bookings = ids.length
    ? await db.select().from(contractorBookingRequests).where(inArray(contractorBookingRequests.quoteId, ids))
    : [];
  const dispatches = ids.length
    ? await db.select().from(jobDispatches).where(inArray(jobDispatches.quoteId, ids))
    : [];
  const invs = ids.length
    ? await db.select().from(invoices).where(inArray(invoices.quoteId, ids))
    : [];

  const byQuote = <T extends { quoteId: string | null }>(rows: T[], id: string) =>
    rows.filter((r) => r.quoteId === id);

  console.log(`\n${paid.length} most-recent PAID bookings (by depositPaidAt, newest first):\n`);

  let stuck = 0;
  paid.forEach((q, i) => {
    const bk = byQuote(bookings as any, q.id);
    const dp = byQuote(dispatches as any, q.id);
    const inv = byQuote(invs as any, q.id)[0] as any;

    let state: string;
    if (dp.length) {
      const statuses = dp.map((d: any) => d.status).join(',');
      const locked = dp.find((d: any) => d.lockedToContractorId);
      state = `DISPATCHED (${statuses}${locked ? ', locked to contractor' : ''})`;
    } else if (bk.length) {
      const b: any = bk[0];
      state = `BOOKING ROW (status=${b.status}, assigned=${b.assignedContractorId || 'none'}, date=${dt(b.scheduledDate)})`;
    } else {
      state = '⚠️  PAID — PENDING DISPATCH (no booking/dispatch row)';
      stuck++;
    }

    const pool = Array.isArray(q.candidateContractorIds) ? (q.candidateContractorIds as string[]).length : 0;
    const sched = q.selectedDate ? `${dt(q.selectedDate)} (${q.schedulingTier || '?'}/${q.timeSlotType || '?'})` : 'NO DATE SELECTED';

    console.log(`${String(i + 1).padStart(2)}. ${q.shortSlug}  ${q.customerName}  ${q.postcode || '—'}`);
    console.log(`    paid ${dt(q.depositPaidAt)} · ${gbp(q.depositAmountPence)} dep of ${gbp(q.basePrice)} (${q.paymentType || '?'}) · bookedAt=${dt(q.bookedAt)}`);
    console.log(`    job: ${(q.jobDescription || '').replace(/\s+/g, ' ').slice(0, 90)}`);
    console.log(`    schedule: ${sched} · candidatePool=${pool} · matched=${q.matchedContractorName || q.matchedContractorId || 'none'}`);
    console.log(`    invoice: ${inv ? `${inv.invoiceNumber} [${inv.status}] bal ${gbp(inv.balanceDue)} — "${(inv.notes || '').slice(0, 40)}"` : 'none'}`);
    console.log(`    state: ${state}`);
    console.log(`    created by: ${q.createdByName || q.createdBy || '—'} · segment=${q.segment}`);
    console.log('');
  });

  console.log('─'.repeat(70));
  console.log(`SUMMARY: ${paid.length} paid · ${stuck} stuck in "pending dispatch" (no booking/dispatch row) · ${paid.length - stuck} progressed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
