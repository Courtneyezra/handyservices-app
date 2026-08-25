import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, leads } from '../shared/schema';
import { eq } from 'drizzle-orm';

const SLUGS = process.argv.slice(2);
const TARGETS = SLUGS.length ? SLUGS : ['xfz2r059', 'xsbc3ynk'];

const gbp = (pence?: number | null) =>
  pence == null ? '—' : `£${(pence / 100).toFixed(2)}`;
const when = (d?: Date | null) =>
  d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—';
const arr = (a?: any[] | null) => (a && a.length ? a.join(', ') : '—');

function hr(t: string) {
  console.log('\n' + '━'.repeat(72) + `\n${t}\n` + '━'.repeat(72));
}

function renderLineItems(li: any): string {
  if (!li) return '  —';
  const items = Array.isArray(li) ? li : Array.isArray(li?.items) ? li.items : null;
  if (!items) return '  ' + JSON.stringify(li);
  return items
    .map((it: any) => {
      const label = it.label ?? it.name ?? it.description ?? it.category ?? '(item)';
      const price =
        it.priceInPence ?? it.pricePence ?? it.customerPricePence ?? it.totalPence ?? null;
      return `  • ${label}${price != null ? ` — ${gbp(price)}` : ''}`;
    })
    .join('\n');
}

async function scan(slug: string) {
  const [q] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, slug))
    .limit(1);

  hr(`QUOTE  ${slug}`);
  if (!q) {
    console.log('  ❌ No quote found for this slug.');
    return;
  }

  let lead: any = null;
  if (q.leadId) {
    [lead] = await db.select().from(leads).where(eq(leads.id, q.leadId)).limit(1);
  }

  console.log(`Customer   : ${q.customerName}   |   ${q.phone}${q.email ? '  |  ' + q.email : ''}`);
  console.log(`Address    : ${q.address ?? '—'}`);
  console.log(`Postcode   : ${q.postcode ?? '—'}   ${q.coordinates ? JSON.stringify(q.coordinates) : ''}`);
  console.log(`Segment    : ${q.segment}  |  jobType ${q.jobType}  |  quotability ${q.quotability}  |  clientType ${q.clientType}`);
  console.log(`Contractor : ${q.matchedContractorName ?? '—'}${q.matchCoveragePercent != null ? `  (coverage ${q.matchCoveragePercent}%)` : ''}`);
  if (arr(q.uncoveredCategories) !== '—') console.log(`Uncovered  : ${arr(q.uncoveredCategories)}`);
  if (arr(q.matchFlags) !== '—') console.log(`MatchFlags : ${arr(q.matchFlags)}`);

  console.log(`\nJob desc   : ${q.jobDescription}`);
  if (q.jobTopLine) console.log(`Top line   : ${q.jobTopLine}`);
  if (q.proposalSummary) console.log(`Scope      : ${q.proposalSummary}`);
  if (arr(q.tasks) !== '—') console.log(`Tasks      : ${arr(q.tasks)}`);
  if (arr(q.categories) !== '—') console.log(`Categories : ${arr(q.categories)}`);
  if (q.completionDate) console.log(`Timeframe  : ${q.completionDate}`);
  if (q.additionalNotes) console.log(`Notes      : ${q.additionalNotes}`);
  if (q.assessmentReason) console.log(`AssessWhy  : ${q.assessmentReason}`);

  console.log(`\nPrice      : ${gbp(q.basePrice)}   (deposit ${gbp(q.depositAmountPence)})`);
  console.log(`Line items :\n${renderLineItems(q.pricingLineItems)}`);
  if (q.optionalExtras) {
    const ex = q.optionalExtras as any[];
    if (Array.isArray(ex) && ex.length) {
      console.log('Extras     :');
      ex.forEach((e: any) => console.log(`  • ${e.label ?? e.name} — ${gbp(e.priceInPence ?? e.pricePence)}${e.isRecommended ? '  [recommended]' : ''}`));
    }
  }

  console.log(`\nScheduling : tier ${q.schedulingTier ?? '—'}  |  slot ${q.timeSlotType ?? '—'}${q.exactTimeRequested ? ' @' + q.exactTimeRequested : ''}  |  selectedDate ${when(q.selectedDate)}`);
  if (q.availableDates) console.log(`AvailDates : ${JSON.stringify(q.availableDates)}`);
  if (q.dateTimePreferences) console.log(`DateTimePref: ${JSON.stringify(q.dateTimePreferences)}`);

  console.log(`\nFunnel     : created→ viewed ${when(q.viewedAt)} (×${q.viewCount})  |  selected ${when(q.selectedAt)}  |  booked ${when(q.bookedAt)}  |  depositPaid ${when(q.depositPaidAt)}`);
  console.log(`Status     : ${q.depositPaidAt ? '💰 PAID' : q.bookedAt ? '📅 booked (unpaid)' : q.selectedAt ? '🛒 selected' : q.viewedAt ? '👀 viewed' : '— not viewed'}`);

  if (lead) {
    console.log(`\nLead       : ${lead.id}  status=${lead.status ?? '—'}  source=${lead.source ?? '—'}`);
    if (lead.notes) console.log(`Lead notes : ${lead.notes}`);
  }
}

async function main() {
  for (const slug of TARGETS) await scan(slug);
  hr('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
