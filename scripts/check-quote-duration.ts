import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { or, eq } from 'drizzle-orm';

async function main() {
  const q = await db.query.personalizedQuotes.findFirst({
    where: or(eq(personalizedQuotes.shortSlug, 'vqb49nhc'), eq(personalizedQuotes.id, 'vqb49nhc'))
  });
  const lineItems = (q?.pricingLineItems as any[]) || [];
  let totalMinutes = 0;
  lineItems.forEach(li => { totalMinutes += (li.estimatedMinutes || li.durationMinutes || 0); });
  console.log('Line items:', lineItems.map(li => `${li.description}: ${li.estimatedMinutes || li.durationMinutes}min`));
  console.log('Total minutes:', totalMinutes);
  console.log('isLargeJob (>=240min):', totalMinutes >= 240);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
