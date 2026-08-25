import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select({ prefs: personalizedQuotes.dateTimePreferences }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log(JSON.stringify(q?.prefs));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
