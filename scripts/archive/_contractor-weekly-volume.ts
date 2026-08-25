/**
 * Contractor weekly volume — offered vs accepted vs completed, per contractor
 * per ISO week. Backs the pay agreement's §5 "intention to offer £X/week"
 * (set the floor from ~80% of median completed £) and verifies the
 * consistency promise is real.
 *
 * Sources:
 *  - jobDispatches (has £: totalContractorPayPence; offered=createdAt,
 *    claimed=lockedAt+lockedToContractorId, completed=completedAt)
 *  - contractorBookingRequests (funnel counts: assignedAt/acceptedAt/completedAt)
 *
 * Usage: npx tsx scripts/_contractor-weekly-volume.ts [weeks=8]
 */
import { db } from '../server/db';
import { jobDispatches, contractorBookingRequests, handymanProfiles, users, invoices } from '../shared/schema';
import { gte, eq } from 'drizzle-orm';

const WEEKS = Number(process.argv[2]) || 8;
const now = new Date();
// Monday of the current week (UTC), then back WEEKS-1 more weeks
const day = (now.getUTCDay() + 6) % 7; // Mon=0
const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
const start = new Date(thisMonday.getTime() - (WEEKS - 1) * 7 * 86400_000);

const weekKey = (d: Date) => {
  const monday = new Date(d.getTime() - (((d.getUTCDay() + 6) % 7) * 86400_000));
  return monday.toISOString().slice(0, 10);
};
const isTestName = (s: string | null | undefined) =>
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(s ?? '');

// Contractor names
const profiles = await db.select({
  id: handymanProfiles.id,
  businessName: handymanProfiles.businessName,
  first: users.firstName,
  last: users.lastName,
}).from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id));
const nameOf = (id: string | null) => {
  if (!id) return '(unclaimed)';
  const p = profiles.find(p => p.id === id);
  return p ? (p.businessName || [p.first, p.last].filter(Boolean).join(' ') || id) : id;
};

// ── Dispatches (the £ source) ──────────────────────────────────────────────
const dispatches = (await db.select().from(jobDispatches)
  .where(gte(jobDispatches.createdAt, start)))
  .filter(d => !isTestName(d.customerFirstName));

type Cell = { offeredN: number; offeredP: number; claimedN: number; claimedP: number; doneN: number; doneP: number };
const cell = (): Cell => ({ offeredN: 0, offeredP: 0, claimedN: 0, claimedP: 0, doneN: 0, doneP: 0 });
// week → contractor → cell (offers are pool-wide: attributed to '(pool)' until claimed)
const byWeek: Record<string, Record<string, Cell>> = {};
const touch = (wk: string, who: string) => ((byWeek[wk] ??= {})[who] ??= cell());

for (const d of dispatches) {
  const pay = d.totalContractorPayPence || 0;
  const offered = touch(weekKey(d.createdAt), '(pool)');
  offered.offeredN++; offered.offeredP += pay;
  if (d.lockedAt && d.lockedToContractorId) {
    const c = touch(weekKey(d.lockedAt), nameOf(d.lockedToContractorId));
    c.claimedN++; c.claimedP += pay;
  }
  if (d.completedAt && d.lockedToContractorId) {
    const c = touch(weekKey(d.completedAt), nameOf(d.lockedToContractorId));
    c.doneN++; c.doneP += pay;
  }
}

const gbp = (p: number) => `£${(p / 100).toFixed(0)}`;
console.log(`\n=== Job dispatches — last ${WEEKS} weeks (weeks start Monday) ===`);
console.log('week       | contractor           | offered      | claimed      | completed');
for (const wk of Object.keys(byWeek).sort()) {
  for (const [who, c] of Object.entries(byWeek[wk]).sort()) {
    console.log(
      `${wk} | ${who.padEnd(20).slice(0, 20)} | ` +
      `${String(c.offeredN).padStart(2)}× ${gbp(c.offeredP).padStart(6)} | ` +
      `${String(c.claimedN).padStart(2)}× ${gbp(c.claimedP).padStart(6)} | ` +
      `${String(c.doneN).padStart(2)}× ${gbp(c.doneP).padStart(6)}`,
    );
  }
}

// ── Invoiced value per contractor per week (the real £ source) ─────────────
// Completed CBRs (completedAt from the completion sweep) joined to their
// quote's invoice. £ basis = customer-invoiced value (incl. materials) —
// dedupe by quote so multi-visit jobs don't double-count the invoice.
const completedCbr = (await db.select().from(contractorBookingRequests)
  .where(gte(contractorBookingRequests.createdAt, start)))
  .filter(r => !isTestName(r.customerName) && r.completedAt && (r.assignedContractorId || r.contractorId));

const quoteIds = [...new Set(completedCbr.map(r => r.quoteId).filter(Boolean))] as string[];
const invRows = quoteIds.length
  ? (await db.select().from(invoices)).filter(i => i.quoteId && quoteIds.includes(i.quoteId))
  : [];
const invByQuote: Record<string, number> = {};
for (const i of invRows) {
  // Prefer the paid invoice's amount; otherwise keep the largest for the quote
  const cur = invByQuote[i.quoteId!] ?? 0;
  const amt = i.totalAmount || 0;
  invByQuote[i.quoteId!] = i.paidAt ? amt : Math.max(cur, amt);
}

const invoiced: Record<string, Record<string, number>> = {}; // contractor → week → £p
const seenQuote = new Set<string>();
for (const r of completedCbr) {
  if (!r.quoteId || seenQuote.has(r.quoteId)) continue;
  seenQuote.add(r.quoteId);
  const who = nameOf(r.assignedContractorId || r.contractorId);
  const wk = weekKey(r.completedAt!);
  (invoiced[who] ??= {})[wk] = (invoiced[who]?.[wk] ?? 0) + (invByQuote[r.quoteId] ?? 0);
}

console.log(`\n=== Invoiced value per contractor per week (completed jobs, customer-£ incl. materials) ===`);
for (const [who, weeks] of Object.entries(invoiced)) {
  for (const wk of Object.keys(weeks).sort()) {
    console.log(`${wk} | ${who.padEnd(20).slice(0, 20)} | invoiced ${gbp(weeks[wk])}`);
  }
}

// §5 floor suggestion — prefer the invoice-based series (richer data);
// fall back to dispatch contractor-£ where present.
const weekly: Record<string, number[]> = {};
for (const [who, weeks] of Object.entries(invoiced)) {
  weekly[who] = Object.values(weeks).filter(v => v > 0);
}
for (const wk of Object.keys(byWeek)) {
  for (const [who, c] of Object.entries(byWeek[wk])) {
    if (who === '(pool)' || c.doneP === 0 || weekly[who]?.length) continue;
    (weekly[who] ??= []).push(c.doneP);
  }
}
console.log(`\n=== §5 floor suggestion (80% of median £/active week — customer-value basis) ===`);
for (const [who, vals] of Object.entries(weekly)) {
  if (!vals.length) continue;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`${who}: median ${gbp(median)}/wk over ${vals.length} active wk → suggested §5 intention ${gbp(Math.round(median * 0.8))}/wk of offered work`);
}

// ── Booking requests (funnel counts; no £ on this table) ──────────────────
const requests = (await db.select().from(contractorBookingRequests)
  .where(gte(contractorBookingRequests.createdAt, start)))
  .filter(r => !isTestName(r.customerName));

const funnel: Record<string, Record<string, { assigned: number; accepted: number; completed: number }>> = {};
for (const r of requests) {
  const who = nameOf(r.assignedContractorId || r.contractorId);
  const wk = weekKey(r.assignedAt || r.createdAt);
  const f = ((funnel[wk] ??= {})[who] ??= { assigned: 0, accepted: 0, completed: 0 });
  f.assigned++;
  if (r.acceptedAt) f.accepted++;
  if (r.completedAt) f.completed++;
}
console.log(`\n=== Booking requests funnel (counts) ===`);
for (const wk of Object.keys(funnel).sort()) {
  for (const [who, f] of Object.entries(funnel[wk]).sort()) {
    console.log(`${wk} | ${who.padEnd(20).slice(0, 20)} | assigned ${f.assigned} → accepted ${f.accepted} → completed ${f.completed}`);
  }
}
if (dispatches.length === 0 && requests.length === 0) {
  console.log('\n(no rows in window — nothing dispatched in the last ' + WEEKS + ' weeks)');
}
process.exit(0);
