/**
 * One-off: full June 2026 listing for Ben — every quote sent in June with
 * status, plus commission detail (10% of basePrice − materials-with-markup)
 * for quotes ACCEPTED in June (selectedAt basis, regardless of send month).
 * Mirrors scripts/check-ben-materials.ts. Excludes known test/dummy quotes.
 *
 * Usage: npx tsx scripts/_ben-june-earnings.ts
 */
import { db } from '../server/db';
import { users, personalizedQuotes } from '../shared/schema';
import { and, eq, gte, lt, isNotNull, or } from 'drizzle-orm';

const juneStart = new Date('2026-06-01T00:00:00Z');
const julyStart = new Date('2026-07-01T00:00:00Z');

type Row = {
  id: string; customerName: string | null; phone: string | null; email: string | null;
  createdAt: Date | null; viewedAt: Date | null; selectedAt: Date | null; bookedAt: Date | null;
  rejectionReason: string | null; expiresAt: Date | null;
  basePrice: number | null; materialsCostWithMarkupPence: number | null; pricingLineItems: unknown;
};

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

const status = (q: Row) => {
  if (q.bookedAt) return 'BOOKED';
  if (q.selectedAt) return 'accepted';
  if (q.rejectionReason) return 'rejected';
  if (q.expiresAt && q.expiresAt < new Date()) return 'expired';
  if (q.viewedAt) return 'viewed';
  return 'sent';
};

async function main() {
  const [ben] = await db.select({ id: users.id }).from(users).where(eq(users.firstName, 'Ben'));
  if (!ben) throw new Error('No Ben user found');

  const fields = {
    id: personalizedQuotes.id,
    customerName: personalizedQuotes.customerName,
    phone: personalizedQuotes.phone,
    email: personalizedQuotes.email,
    createdAt: personalizedQuotes.createdAt,
    viewedAt: personalizedQuotes.viewedAt,
    selectedAt: personalizedQuotes.selectedAt,
    bookedAt: personalizedQuotes.bookedAt,
    rejectionReason: personalizedQuotes.rejectionReason,
    expiresAt: personalizedQuotes.expiresAt,
    basePrice: personalizedQuotes.basePrice,
    materialsCostWithMarkupPence: personalizedQuotes.materialsCostWithMarkupPence,
    pricingLineItems: personalizedQuotes.pricingLineItems,
  };

  const rows = (await db.select(fields).from(personalizedQuotes)
    .where(and(
      eq(personalizedQuotes.createdBy, ben.id),
      or(
        and(gte(personalizedQuotes.createdAt, juneStart), lt(personalizedQuotes.createdAt, julyStart)),
        and(isNotNull(personalizedQuotes.selectedAt), gte(personalizedQuotes.selectedAt, juneStart), lt(personalizedQuotes.selectedAt, julyStart)),
      ),
    ))
    .orderBy(personalizedQuotes.createdAt)) as Row[];

  const real = rows.filter(q => !isTest(q));
  const excluded = rows.filter(isTest);

  // ── Section 1: every quote SENT in June ──
  const sentJune = real.filter(q => q.createdAt! >= juneStart && q.createdAt! < julyStart);
  console.log(`=== ALL QUOTES SENT IN JUNE 2026: ${sentJune.length} (test excluded: ${excluded.length}) ===\n`);
  for (const q of sentJune) {
    console.log(
      `  ${q.createdAt!.toISOString().slice(0, 10)} | ${(q.customerName ?? '').trim().padEnd(20)} | £${((q.basePrice ?? 0) / 100).toFixed(2).padStart(8)} | ${status(q)}`
    );
  }

  // ── Section 2: commission detail for quotes ACCEPTED in June ──
  const acceptedJune = real.filter(q => q.selectedAt && q.selectedAt >= juneStart && q.selectedAt < julyStart);
  console.log(`\n=== ACCEPTED IN JUNE (commission basis): ${acceptedJune.length} ===\n`);
  let totalRev = 0, totalMat = 0;
  for (const q of acceptedJune) {
    const rev = (q.basePrice ?? 0) / 100;
    const mat = materials(q);
    const labour = rev - mat;
    totalRev += rev; totalMat += mat;
    const sentBefore = q.createdAt! < juneStart ? ` (sent ${q.createdAt!.toISOString().slice(0, 10)})` : '';
    console.log(
      `  ${q.selectedAt!.toISOString().slice(0, 10)} | ${(q.customerName ?? '').trim().padEnd(20)} | rev £${rev.toFixed(2).padStart(8)} | mat £${mat.toFixed(2).padStart(7)} | labour £${labour.toFixed(2).padStart(8)} | 10% £${(labour * 0.1).toFixed(2).padStart(7)}${q.bookedAt ? ' [booked]' : ''}${sentBefore}`
    );
  }
  const labourBase = totalRev - totalMat;
  console.log(`\nTOTALS — Sent: ${sentJune.length} | Accepted: ${acceptedJune.length} (booked: ${acceptedJune.filter(q => q.bookedAt).length})`);
  console.log(`Revenue £${totalRev.toFixed(2)} | Materials (w/ markup) £${totalMat.toFixed(2)} | Labour base £${labourBase.toFixed(2)}`);
  console.log(`10% COMMISSION: £${(labourBase * 0.1).toFixed(2)}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
