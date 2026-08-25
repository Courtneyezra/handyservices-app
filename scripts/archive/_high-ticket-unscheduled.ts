/**
 * High-ticket scheduling triage — accepted quotes ≥£700 and where they stand:
 * booked? dispatched? claimed? scheduled when? Plus each contractor's upcoming
 * accepted commitments so we can see who has room.
 * Usage: npx tsx scripts/_high-ticket-unscheduled.ts [minPounds=700]
 */
import { db } from '../server/db';
import { personalizedQuotes, contractorBookingRequests, jobDispatches, handymanProfiles, users } from '../shared/schema';
import { isNotNull, or, desc, sql, gte } from 'drizzle-orm';

const MIN = (Number(process.argv[2]) || 700) * 100;

type Row = any;
const isTest = (q: Row) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');

const quotes = ((await db.select().from(personalizedQuotes)
  .where(or(isNotNull(personalizedQuotes.depositPaidAt), isNotNull(personalizedQuotes.selectedAt)))
  .orderBy(desc(sql`coalesce(deposit_paid_at, selected_at)`))
  .limit(60)) as Row[])
  .filter(q => !isTest(q) && (q.selectedTierPricePence || 0) >= MIN);

const cbrs = await db.select().from(contractorBookingRequests);
const disps = await db.select().from(jobDispatches);
const profiles = await db.select({
  id: handymanProfiles.id, businessName: handymanProfiles.businessName,
  first: users.firstName, last: users.lastName,
}).from(handymanProfiles).leftJoin(users, eq2(handymanProfiles.userId, users.id));
function eq2(a: any, b: any) { return sql`${a} = ${b}`; }
const nameOf = (id: string | null) => {
  const p = profiles.find(p => p.id === id);
  return p ? (p.businessName || [p.first, p.last].filter(Boolean).join(' ') || id) : id || '—';
};

const gbp = (p: number) => `£${(p / 100).toFixed(0)}`;
console.log(`\n════ Accepted quotes ≥ ${gbp(MIN)} — scheduling status ════`);
for (const q of quotes) {
  const items = ((q.pricingLineItems as any[]) || []).filter((l: any) => l.description || l.guardedPricePence);
  const mins = items.reduce((s: number, l: any) => s + (l.timeEstimateMinutes || 60), 0);
  const days = Math.ceil(mins / 60 / 8);
  const cats = [...new Set(items.map((l: any) => l.category || 'other'))];
  const myCbrs = cbrs.filter(c => c.quoteId === q.id);
  const myDisps = disps.filter(d => d.quoteId === q.id);

  console.log(`\n─── ${q.shortSlug} · ${q.customerName} · ${gbp(q.selectedTierPricePence || 0)} · ${(mins / 60).toFixed(1)}h ≈ ${days} day(s) · ${items.length} lines`);
  console.log(`   accepted: ${(q.depositPaidAt || q.selectedAt)?.toISOString().slice(0, 10)} · deposit: ${q.depositPaidAt ? 'PAID' : 'not paid'} · customer date pref: ${q.selectedDate ? new Date(q.selectedDate).toISOString().slice(0, 10) : (JSON.stringify(q.dateTimePreferences)?.slice(0, 60) || 'none')}`);
  console.log(`   trades: ${cats.join(', ')}`);
  console.log(`   postcode: ${q.postcode || '?'} · completed: ${q.completedAt ? 'YES ' + q.completedAt.toISOString().slice(0, 10) : 'no'}`);
  if (myCbrs.length === 0 && myDisps.length === 0) console.log(`   ⚠️ NO booking request, NO dispatch — completely unscheduled`);
  for (const c of myCbrs) console.log(`   CBR: ${nameOf(c.assignedContractorId || c.contractorId)} · status ${c.status}/${c.assignmentStatus} · scheduled ${c.scheduledDate ? c.scheduledDate.toISOString().slice(0, 10) : '—'}`);
  for (const d of myDisps) console.log(`   Dispatch: ${d.status} · locked to ${d.lockedToContractorId ? nameOf(d.lockedToContractorId) : 'NOBODY (open link)'} · pay ${gbp(d.totalContractorPayPence)} · scheduled ${d.scheduledDate ? d.scheduledDate.toISOString().slice(0, 10) : '—'}`);
}

console.log(`\n════ Contractor upcoming commitments (accepted CBRs, today onward) ════`);
const now = new Date(); now.setHours(0, 0, 0, 0);
const upcoming = cbrs.filter(c => (c.status === 'accepted') && c.scheduledDate && c.scheduledDate >= now);
if (upcoming.length === 0) console.log('   (none — every contractor calendar is open from today)');
for (const c of upcoming.sort((a, b) => +a.scheduledDate! - +b.scheduledDate!)) {
  console.log(`   ${c.scheduledDate!.toISOString().slice(0, 10)} ${c.scheduledSlot || ''} · ${nameOf(c.assignedContractorId || c.contractorId)} · ${c.customerName}`);
}
process.exit(0);
