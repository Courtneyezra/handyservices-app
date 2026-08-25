import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [before] = await db.select({ addr: personalizedQuotes.address, prefs: personalizedQuotes.dateTimePreferences, pc: personalizedQuotes.postcode })
    .from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('BEFORE:', JSON.stringify(before));
  await db.update(personalizedQuotes)
    .set({ address: null, dateTimePreferences: null })
    .where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('cleared address + dateTimePreferences (postcode kept:', before?.pc, ')');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
