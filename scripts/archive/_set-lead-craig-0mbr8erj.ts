import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929'; // Craig Smith, core tier

async function main() {
  const [before] = await db.select({
    id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug,
    lead: personalizedQuotes.leadContractorId, booked: personalizedQuotes.bookedAt,
    deposit: personalizedQuotes.depositPaidAt, flex: personalizedQuotes.flexBookingWithinDays,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);

  if (!before) { console.log('Quote not found'); process.exit(1); }
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  if (before.lead) {
    console.log(`\n⚠ Already has a lead (${before.lead}) — no change made.`);
    process.exit(0);
  }
  if (before.booked) {
    console.log('\n⚠ Already booked — flex queue would not show it. Aborting.');
    process.exit(1);
  }

  await db.update(personalizedQuotes)
    .set({ leadContractorId: CRAIG, leadContractorSource: 'manual' as any })
    .where(eq(personalizedQuotes.id, before.id));

  const [after] = await db.select({
    lead: personalizedQuotes.leadContractorId, source: (personalizedQuotes as any).leadContractorSource,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.id, before.id)).limit(1);
  console.log('\nAFTER:', JSON.stringify(after, null, 2));
  console.log('\n✅ Craig set as lead. Job will now appear in his flex queue ("complete fires" / jobs list).');
  console.log('   Deadline (deposit 23 Jul + 14d): 6 Aug 2026 — he picks the day in-app.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
