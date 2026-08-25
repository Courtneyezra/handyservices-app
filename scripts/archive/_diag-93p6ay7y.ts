import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [q] = await db.select().from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, '93p6ay7y'));
  if (!q) { console.log('NOT FOUND'); process.exit(0); }
  console.log(JSON.stringify(q, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
