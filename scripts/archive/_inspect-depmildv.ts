import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const [q] = await db
  .select()
  .from(personalizedQuotes)
  .where(eq(personalizedQuotes.shortSlug, 'depmildv'))
  .limit(1);

if (!q) {
  console.log('NOT FOUND');
  process.exit(0);
}
const { contextualData, ...rest } = q as any;
console.log(JSON.stringify(rest, null, 2));
console.log('--- contextualData ---');
console.log(JSON.stringify(contextualData, null, 2));
process.exit(0);
