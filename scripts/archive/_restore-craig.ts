import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [before] = await db.select({ base: personalizedQuotes.basePrice }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'xx3diece'));
  console.log('before: £' + ((before?.base||0)/100).toFixed(2));
  // Restore the headline total Craig was originally quoted (pre-test).
  await db.update(personalizedQuotes).set({ basePrice: 105100 }).where(eq(personalizedQuotes.shortSlug, 'xx3diece'));
  const [after] = await db.select({ base: personalizedQuotes.basePrice, name: personalizedQuotes.customerName }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'xx3diece'));
  console.log('after:  £' + ((after?.base||0)/100).toFixed(2) + ' (' + after?.name + ')');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
