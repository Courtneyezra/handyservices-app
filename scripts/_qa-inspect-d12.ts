import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'qd2512'));
const l = (q!.pricingLineItems as any[])[0];
console.log(JSON.stringify({
  basePrice: q!.basePrice,
  line: { guardedPricePence: l.guardedPricePence, materialsCostPence: l.materialsCostPence, materialsWithMarginPence: l.materialsWithMarginPence, allKeys: Object.keys(l) },
}, null, 2));
process.exit(0);
