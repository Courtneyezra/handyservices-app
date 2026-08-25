import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  await db.update(personalizedQuotes).set({ dateTimePreferences: null }).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('cleared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
