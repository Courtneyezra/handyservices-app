import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929';

async function main() {
  const [q] = await db.select({
    id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug,
    lead: personalizedQuotes.leadContractorId, booked: personalizedQuotes.bookedAt,
    contractorId: personalizedQuotes.contractorId,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'fc3f6fzw')).limit(1);

  if (!q) { console.log('not found'); process.exit(1); }
  console.log('BEFORE:', JSON.stringify(q));

  if (q.booked || q.contractorId) {
    console.log('\n⚠ This job is already BOOKED/hard-assigned — removing the lead alone won\'t undo the booking. Aborting; needs a cancel instead.');
    process.exit(1);
  }
  if (q.lead !== CRAIG) {
    console.log(`\n⚠ Lead is not Craig (${q.lead}) — nothing to remove.`);
    process.exit(0);
  }

  await db.update(personalizedQuotes)
    .set({ leadContractorId: null, leadContractorSource: null as any })
    .where(eq(personalizedQuotes.id, q.id));

  const [after] = await db.select({ lead: personalizedQuotes.leadContractorId }).from(personalizedQuotes).where(eq(personalizedQuotes.id, q.id)).limit(1);
  console.log('AFTER :', JSON.stringify(after));
  console.log('\n✅ Removed from Craig. Job is now unassigned (still a paid flex job in the dispatch pool for reassignment).');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
