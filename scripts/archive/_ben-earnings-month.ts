/**
 * Ben monthly earnings — parametrised. Commission = 10% of labour
 * (labour = basePrice − materials-with-markup), accepted basis = selectedAt in-month.
 * Usage: npx tsx scripts/_ben-earnings-month.ts 2026-06
 */
import { db } from '../server/db';
import { users, personalizedQuotes } from '../shared/schema';
import { and, eq, gte, lt, isNotNull, or } from 'drizzle-orm';

const arg = process.argv[2] || '2026-07';
const [y, m] = arg.split('-').map(Number);
const start = new Date(Date.UTC(y, m - 1, 1));
const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));

type Row = any;
const isTest = (q: Row) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');
const materials = (q: Row) => {
  let mat = 0;
  ((q.pricingLineItems as any[]) || []).forEach((it) => (mat += (it.materialsWithMarginPence ?? 0)));
  if (mat === 0 && q.materialsCostWithMarkupPence) mat = q.materialsCostWithMarkupPence;
  return mat / 100;
};

const [ben] = await db.select({ id: users.id }).from(users).where(eq(users.firstName, 'Ben'));
const rows = (await db.select().from(personalizedQuotes)
  .where(and(
    eq(personalizedQuotes.createdBy, ben.id),
    or(
      and(gte(personalizedQuotes.createdAt, start), lt(personalizedQuotes.createdAt, end)),
      and(isNotNull(personalizedQuotes.selectedAt), gte(personalizedQuotes.selectedAt, start), lt(personalizedQuotes.selectedAt, end)),
    ),
  ))) as Row[];
const real = rows.filter(q => !isTest(q));
const sent = real.filter(q => q.createdAt >= start && q.createdAt < end);
const accepted = real.filter(q => q.selectedAt && q.selectedAt >= start && q.selectedAt < end);
let rev = 0, mat = 0;
for (const q of accepted) { rev += (q.basePrice ?? 0) / 100; mat += materials(q); }
const labour = rev - mat;
const booked = accepted.filter(q => q.bookedAt).length;
console.log(`\n=== ${arg} ===`);
console.log(`Quotes sent:      ${sent.length}`);
console.log(`Quotes accepted:  ${accepted.length}  (booked: ${booked})`);
console.log(`Revenue:          £${rev.toFixed(2)}`);
console.log(`Materials(+mkup): £${mat.toFixed(2)}`);
console.log(`Labour base:      £${labour.toFixed(2)}`);
console.log(`Commission @10%:  £${(labour * 0.1).toFixed(2)}`);
process.exit(0);
