/**
 * Seed data for the /contractors Job Pay Checker.
 *
 * Buckets every line item from REAL PAID quotes (deposit_paid_at set, test
 * rows scrubbed) by contractor tier and job size, runs each through the
 * actual pay engine, and prints median contractor pay + a representative
 * example per bucket. Numbers get hardcoded into ContractorsPage.tsx presets
 * so every figure on the recruiting page is a job that really happened.
 *
 *   npx tsx scripts/_job-pay-presets.ts
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull } from 'drizzle-orm';
import { calculateMultiLineRevenueShare, CATEGORY_TIER_MAP } from '../server/revenue-share-tiers';
import type { JobCategory } from '../shared/contextual-pricing-types';

type Row = any;
const isTest = (q: Row) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.customerName ?? '');

// quick ≤ 90min · half 91–300min · full > 300min
const sizeOf = (mins: number) => (mins <= 90 ? 'quick' : mins <= 300 ? 'half' : 'full');

async function main() {
  const quotes = ((await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))) as Row[])
    .filter(q => !isTest(q));

  const buckets: Record<string, Array<{ pay: number; mins: number; desc: string; method: string }>> = {};

  for (const q of quotes) {
    const items = ((q.pricingLineItems as any[]) || []).filter((l: any) => (l.guardedPricePence || 0) > 0);
    const disc = q.batchDiscountPercent ? 1 - Number(q.batchDiscountPercent) / 100 : 1;
    for (const l of items) {
      const cat = (l.category || 'other') as JobCategory;
      const tier = CATEGORY_TIER_MAP[cat] || 'general';
      const mins = l.timeEstimateMinutes || 60;
      // Single-line job: visit minimum applies, same as a one-task dispatch.
      const r = calculateMultiLineRevenueShare([{
        categorySlug: cat,
        pricePence: Math.round((l.guardedPricePence || 0) * disc),
        timeEstimateMinutes: mins,
      }]);
      const line = (r as any).lines?.[0];
      buckets[`${tier}:${sizeOf(mins)}`] ??= [];
      buckets[`${tier}:${sizeOf(mins)}`].push({
        pay: r.totalContractorPay,
        mins,
        desc: (l.description || '').slice(0, 60),
        method: line?.payMethod || '?',
      });
    }
  }

  console.log(`\nPaid quotes analysed: ${quotes.length}\n`);
  for (const tier of ['general', 'skilled', 'specialist', 'outdoor']) {
    for (const size of ['quick', 'half', 'full']) {
      const b = (buckets[`${tier}:${size}`] || []).sort((a, x) => a.pay - x.pay);
      if (!b.length) { console.log(`${tier.padEnd(10)} ${size.padEnd(5)}  — no data`); continue; }
      const med = b[Math.floor(b.length / 2)];
      const methods = b.reduce((m: Record<string, number>, x) => ((m[x.method] = (m[x.method] || 0) + 1), m), {});
      console.log(
        `${tier.padEnd(10)} ${size.padEnd(5)} n=${String(b.length).padStart(3)}  ` +
        `median £${(med.pay / 100).toFixed(0).padStart(4)} (${med.mins}min)  ` +
        `methods=${JSON.stringify(methods)}  eg "${med.desc}"`
      );
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
// (appended) dump full buckets for sparse tiers — pick honest examples
