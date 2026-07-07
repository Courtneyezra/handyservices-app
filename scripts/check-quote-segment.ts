import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { or, eq } from 'drizzle-orm';

async function main() {
  const q = await db.query.personalizedQuotes.findFirst({
    where: or(eq(personalizedQuotes.shortSlug, 'vqb49nhc'), eq(personalizedQuotes.id, 'vqb49nhc'))
  });
  console.log('segment:', q?.segment);
  console.log('bookingModes:', q?.bookingModes);
  console.log('customerKind:', (q as any)?.customerKind);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
