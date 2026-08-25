import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, contractorBookingRequests } from '../shared/schema';
import { isNotNull, eq } from 'drizzle-orm';

// "Today" — reference date for the plan.
const TODAY = new Date('2026-07-13T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// Test/dummy signatures to scrub (see memory: project-quote-test-data)
function isTest(q: { id: string; phone: string | null; customerName: string | null; email: string | null }): boolean {
  const phone = q.phone ?? '';
  const name = (q.customerName ?? '').toLowerCase();
  const email = (q.email ?? '').toLowerCase();
  return (
    q.id.startsWith('test_q_') ||
    phone.includes('07700900') ||
    email.includes('@example.com') ||
    /\b(test|qa|phase|dummy|debug)\b/.test(name)
  );
}

function d(x: Date | null): string {
  if (!x) return '—';
  return new Date(x).toISOString().slice(0, 10);
}

async function main() {
  // All PAID quotes = booked jobs
  const quotes = await db
    .select({
      id: personalizedQuotes.id,
      slug: personalizedQuotes.shortSlug,
      name: personalizedQuotes.customerName,
      phone: personalizedQuotes.phone,
      email: personalizedQuotes.email,
      postcode: personalizedQuotes.postcode,
      address: personalizedQuotes.address,
      job: personalizedQuotes.jobDescription,
      segment: personalizedQuotes.segment,
      basePrice: personalizedQuotes.basePrice,
      paidAt: personalizedQuotes.depositPaidAt,
      selectedDate: personalizedQuotes.selectedDate,
      exactTime: personalizedQuotes.exactTimeRequested,
      isWeekend: personalizedQuotes.isWeekendBooking,
      flexDays: personalizedQuotes.flexBookingWithinDays,
      paymentType: personalizedQuotes.paymentType,
    })
    .from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt));

  // All booking-request/dispatch rows keyed by quoteId
  const jobs = await db
    .select({
      quoteId: contractorBookingRequests.quoteId,
      status: contractorBookingRequests.status,
      assignedTo: contractorBookingRequests.assignedContractorId,
      scheduledDate: contractorBookingRequests.scheduledDate,
      scheduledStart: contractorBookingRequests.scheduledStartTime,
      completedAt: contractorBookingRequests.completedAt,
      durationDays: contractorBookingRequests.durationDays,
    })
    .from(contractorBookingRequests)
    .where(isNotNull(contractorBookingRequests.quoteId));

  const jobByQuote = new Map<string, typeof jobs[number]>();
  for (const j of jobs) if (j.quoteId) jobByQuote.set(j.quoteId, j);

  const real = quotes.filter((q) => !isTest(q));

  type Row = {
    q: typeof real[number];
    job?: typeof jobs[number];
    effectiveDate: Date | null; // scheduled (dispatch) OR customer-selected
    isFlex: boolean;
    flexDeadline: Date | null;
    flexOverdue: boolean;
    category: 'COMPLETED' | 'UPCOMING' | 'UNSCHEDULED' | 'PAST_UNRESOLVED';
  };

  const rows: Row[] = real.map((q) => {
    const job = jobByQuote.get(q.id);
    const scheduled = job?.scheduledDate ? new Date(job.scheduledDate) : null;
    const selected = q.selectedDate ? new Date(q.selectedDate) : null;
    const effectiveDate = scheduled ?? selected;
    const isFlex = q.flexDays != null && !selected && !scheduled;
    const flexDeadline =
      q.flexDays != null && q.paidAt ? new Date(new Date(q.paidAt).getTime() + q.flexDays * DAY) : null;
    const completed = !!job?.completedAt || job?.status === 'completed';

    let category: Row['category'];
    if (completed) category = 'COMPLETED';
    else if (effectiveDate && effectiveDate >= TODAY) category = 'UPCOMING';
    else if (effectiveDate && effectiveDate < TODAY) category = 'PAST_UNRESOLVED';
    else category = 'UNSCHEDULED';

    const flexOverdue = !effectiveDate && flexDeadline != null && flexDeadline < TODAY;

    return { q, job, effectiveDate, isFlex, flexDeadline, flexOverdue, category };
  });

  const fmtMoney = (p: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(0));
  const cleanPhone = (p: string | null) => (p ?? '').replace(/[‪‬\s]/g, '').trim();
  const row = (r: Row) => {
    const q = r.q;
    const when = r.effectiveDate ? d(r.effectiveDate) + (q.exactTime ? ` ${q.exactTime}` : '') : '—';
    const loc = (q.postcode || (q.address ? q.address.slice(0, 20) : '—')).trim();
    const job = (q.job ?? '').replace(/\s+/g, ' ').trim();
    const flex = r.flexDeadline
      ? `by ${d(r.flexDeadline)}${r.flexOverdue ? ' ⚠️' : ''}`
      : '';
    return `| ${when} | ${(q.name ?? '?').trim()} | ${loc} | ${fmtMoney(q.basePrice)} | ${d(q.paidAt)} | ${flex} | ${cleanPhone(q.phone)} | /${q.slug} | ${job} |`;
  };
  const HEAD = `| Date | Customer | Area | Value | Paid | Flex due | Phone | Quote | Job |\n|---|---|---|---|---|---|---|---|---|`;

  const upcoming = rows
    .filter((r) => r.category === 'UPCOMING')
    .sort((a, b) => a.effectiveDate!.getTime() - b.effectiveDate!.getTime());
  const flex = rows.filter((r) => r.category === 'UNSCHEDULED' && r.q.flexDays != null);
  const flexOverdue = flex
    .filter((r) => r.flexOverdue)
    .sort((a, b) => a.flexDeadline!.getTime() - b.flexDeadline!.getTime());
  const flexLive = flex
    .filter((r) => !r.flexOverdue)
    .sort((a, b) => a.flexDeadline!.getTime() - b.flexDeadline!.getTime());
  const legacy = rows
    .filter((r) => r.category === 'UNSCHEDULED' && r.q.flexDays == null)
    .sort((a, b) => (a.q.paidAt?.getTime() ?? 0) - (b.q.paidAt?.getTime() ?? 0));
  const pastUnresolved = rows
    .filter((r) => r.category === 'PAST_UNRESOLVED')
    .sort((a, b) => a.effectiveDate!.getTime() - b.effectiveDate!.getTime());
  const sum = (rs: Row[]) => rs.reduce((t, r) => t + (r.q.basePrice ?? 0), 0);

  const out: string[] = [];
  out.push(`# Job Planning Board — as of ${d(TODAY)}`);
  out.push(`\n${real.length} paid jobs on file (${quotes.length - real.length} test rows scrubbed). Live backlog to schedule = **${flex.length} flex jobs** worth **${fmtMoney(sum(flex))}**, of which **${flexOverdue.length} are past their flex window** and need chasing now.\n`);

  out.push(`## ▶ Upcoming — date already set (${upcoming.length})`);
  out.push(HEAD, ...upcoming.map(row), '');

  out.push(`## ⚠️ Flex window LAPSED — contact customer, agree a date now (${flexOverdue.length}) — ${fmtMoney(sum(flexOverdue))}`);
  out.push(`These paid on a "I'm flexible" promise (we schedule within N days) and that window has passed.`);
  out.push(HEAD, ...flexOverdue.map(row), '');

  out.push(`## ⏳ Flex — still in window, schedule this week (${flexLive.length}) — ${fmtMoney(sum(flexLive))}`);
  out.push(HEAD, ...flexLive.map(row), '');

  if (pastUnresolved.length) {
    out.push(`## ❗ Past date, not marked complete — reconcile (${pastUnresolved.length})`);
    out.push(HEAD, ...pastUnresolved.map(row), '');
  }

  out.push(`## 🗄️ Legacy paid, no date/flex captured — likely already completed, verify & close (${legacy.length})`);
  out.push(`Pre-flex-system jobs (paid ${legacy.length ? d(legacy[0].q.paidAt) : ''}–${legacy.length ? d(legacy[legacy.length-1].q.paidAt) : ''}). Not part of the live plan — Ben to confirm done and close, or resurface if genuinely outstanding.`);
  out.push(HEAD, ...legacy.map(row), '');

  const md = out.join('\n');
  const fs = await import('fs');
  const path = 'docs/JOB-PLANNING-BOARD.md';
  fs.writeFileSync(path, md + '\n');
  console.log(md);
  console.log(`\n\nWritten to ${path}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
