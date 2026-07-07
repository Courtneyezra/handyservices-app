import 'dotenv/config';
import { db } from '../server/db';
import {
  personalizedQuotes,
  leads,
  contractorBookingRequests,
  jobSheets,
  invoices,
  paymentLinks,
  jobDispatches,
  quoteSectionEvents,
  bookingSlotLocks,
  contractorJobs,
  handymanProfiles,
} from '../shared/schema';
import { eq, or } from 'drizzle-orm';

const SLUG = process.argv[2] || 'xfz2r059';

function hr(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

function dump(obj: any) {
  console.log(JSON.stringify(obj, null, 2));
}

async function safe<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    const rows = await fn();
    return rows;
  } catch (e: any) {
    console.log(`  [!] ${label} query failed: ${e?.message || e}`);
    return [];
  }
}

async function main() {
  hr(`QUOTE LOOKUP — slug "${SLUG}"`);
  const [quote] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SLUG))
    .limit(1);

  if (!quote) {
    console.log(`No quote found for slug "${SLUG}".`);
    process.exit(0);
  }

  dump(quote);
  const quoteId = quote.id;

  if (quote.leadId) {
    hr('ORIGINATING LEAD');
    const [lead] = await safe('leads', () =>
      db.select().from(leads).where(eq(leads.id, quote.leadId!)).limit(1),
    );
    if (lead) dump(lead);
    else console.log('  (leadId set but lead row not found)');
  } else {
    hr('ORIGINATING LEAD');
    console.log('  (no leadId on quote — quote not tied to a lead record)');
  }

  hr('BOOKING REQUESTS (contractor_booking_requests)');
  const bookings = await safe('contractorBookingRequests', () =>
    db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.quoteId, quoteId)),
  );
  console.log(`  count: ${bookings.length}`);
  bookings.forEach((b) => dump(b));

  hr('JOB SHEETS (job_sheets)');
  const sheetsByQuote = await safe('jobSheets by quoteId', () =>
    db.select().from(jobSheets).where(eq(jobSheets.quoteId, quoteId)),
  );
  const sheetsByJob = bookings.length
    ? await safe('jobSheets by jobId', () =>
        db
          .select()
          .from(jobSheets)
          .where(or(...bookings.map((b: any) => eq(jobSheets.jobId, b.id)))),
      )
    : [];
  const sheets = [...sheetsByQuote, ...sheetsByJob.filter((s: any) => !sheetsByQuote.some((q: any) => q.id === s.id))];
  console.log(`  count: ${sheets.length}`);
  sheets.forEach((s) => dump(s));

  hr('INVOICES');
  const invs = await safe('invoices', () =>
    db.select().from(invoices).where(eq(invoices.quoteId, quoteId)),
  );
  console.log(`  count: ${invs.length}`);
  invs.forEach((i) => dump(i));

  hr('PAYMENT LINKS');
  const plinks = await safe('paymentLinks', () =>
    db.select().from(paymentLinks).where(eq(paymentLinks.quoteId, quoteId)),
  );
  console.log(`  count: ${plinks.length}`);
  plinks.forEach((p) => dump(p));

  hr('JOB DISPATCHES (auto-assign attempts)');
  const dispatches = await safe('jobDispatches', () =>
    db.select().from(jobDispatches).where(eq(jobDispatches.quoteId, quoteId)),
  );
  console.log(`  count: ${dispatches.length}`);
  dispatches.forEach((d) => dump(d));

  hr('BOOKING SLOT LOCKS');
  const locks = await safe('bookingSlotLocks', () =>
    db.select().from(bookingSlotLocks).where(eq(bookingSlotLocks.quoteId, quoteId)),
  );
  console.log(`  count: ${locks.length}`);
  locks.forEach((l) => dump(l));

  hr('LEGACY CONTRACTOR JOBS');
  const legacyJobs = await safe('contractorJobs', () =>
    db.select().from(contractorJobs).where(eq(contractorJobs.quoteId, quoteId)),
  );
  console.log(`  count: ${legacyJobs.length}`);
  legacyJobs.forEach((j) => dump(j));

  hr('QUOTE SECTION EVENTS (engagement analytics)');
  const events = await safe('quoteSectionEvents', () =>
    db.select().from(quoteSectionEvents).where(eq(quoteSectionEvents.quoteId, quoteId)),
  );
  console.log(`  count: ${events.length}`);
  events.forEach((e) => dump(e));

  // Resolve any contractor referenced by the quote/booking
  const contractorIds = new Set<string>();
  if (quote.matchedContractorId) contractorIds.add(quote.matchedContractorId);
  if (quote.contractorId) contractorIds.add(quote.contractorId);
  bookings.forEach((b: any) => {
    if (b.contractorId) contractorIds.add(b.contractorId);
    if (b.assignedContractorId) contractorIds.add(b.assignedContractorId);
  });
  if (Array.isArray(quote.candidateContractorIds)) {
    (quote.candidateContractorIds as string[]).forEach((id) => contractorIds.add(id));
  }

  if (contractorIds.size) {
    hr('CONTRACTOR PROFILES (matched / candidate / assigned)');
    for (const cid of contractorIds) {
      const [c] = await safe('handymanProfiles', () =>
        db.select().from(handymanProfiles).where(eq(handymanProfiles.id, cid)).limit(1),
      );
      if (c) dump(c);
      else console.log(`  (contractor ${cid} not found)`);
    }
  }

  hr('DONE');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
