#!/usr/bin/env npx tsx
/**
 * Seed WTBP Rate Card with CVS-Calculated Hourly Rates
 *
 * Closes out all current rates and inserts new hourly rates
 * calculated by the Contractor Value Score (CVS) engine.
 *
 * Usage: npx tsx scripts/seed-wtbp-cvs-rates.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { wtbpRateCard } from '../shared/schema';
import { isNull, eq, and } from 'drizzle-orm';
import { getAllCVSResults } from '../server/contractor-value-score';
import { CATEGORY_LABELS } from '../shared/categories';
import type { JobCategory } from '../shared/categories';

function fmtGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

async function main() {
  console.log('\nSeed WTBP Rate Card — CVS Hourly Rates\n');

  // Fetch current rates from DB
  const currentRates = await db
    .select()
    .from(wtbpRateCard)
    .where(isNull(wtbpRateCard.effectiveTo));

  const currentMap: Record<string, number> = {};
  for (const r of currentRates) {
    currentMap[r.categorySlug] = r.ratePence;
  }

  // Get CVS-calculated rates
  const cvsResults = getAllCVSResults();
  const now = new Date();

  console.log(`Found ${currentRates.length} existing rates, ${cvsResults.length} CVS categories.\n`);

  // Close out all current rates
  if (currentRates.length > 0) {
    await db
      .update(wtbpRateCard)
      .set({ effectiveTo: now, updatedAt: now })
      .where(isNull(wtbpRateCard.effectiveTo));
    console.log(`Closed out ${currentRates.length} existing rates.\n`);
  }

  // Insert new hourly rates
  const rows = cvsResults.map((r) => ({
    categorySlug: r.category,
    ratePence: r.wtbpHourlyPence,
    rateType: 'hourly' as const,
    effectiveFrom: now,
    notes: 'CVS-calculated: subbie rate \u00d7 (1 - surplus discount)',
  }));

  const inserted = await db.insert(wtbpRateCard).values(rows).returning();

  // Print summary table
  console.log('  ' + pad('Category', 24) + pad('Old Rate', 14) + pad('New Rate/hr', 14) + 'Change');
  console.log('  ' + '-'.repeat(66));

  const sorted = [...cvsResults].sort((a, b) => a.label.localeCompare(b.label));
  for (const r of sorted) {
    const oldRate = currentMap[r.category];
    const oldStr = oldRate ? fmtGBP(oldRate) + '/job' : 'N/A';
    const newStr = fmtGBP(r.wtbpHourlyPence) + '/hr';
    const change = oldRate
      ? `${oldRate < r.wtbpHourlyPence ? '+' : ''}${fmtGBP(r.wtbpHourlyPence - oldRate)} (flat->hourly)`
      : 'NEW';

    console.log('  ' + pad(r.label, 24) + pad(oldStr, 14) + pad(newStr, 14) + change);
  }

  console.log(`\nInserted ${inserted.length} new hourly rates.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
