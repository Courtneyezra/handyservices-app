import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [src] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  if (!src) throw new Error('faprev01 not found');
  const items = ((src.pricingLineItems as any[]) || []);
  // keep ONLY the curtain-pole line (single general-handyman trade → non-empty pool)
  const kept = items.filter((li:any) => /curtain/i.test(JSON.stringify(li)));
  if (!kept.length) throw new Error('no curtain line');
  const newId = 'test_q_guarantee_prev', newSlug = 'guarprev';
  await db.delete(personalizedQuotes).where(eq(personalizedQuotes.id, newId));
  const row:any = { ...src };
  row.id = newId; row.shortSlug = newSlug;
  row.pricingLineItems = kept;
  row.jobDescription = 'Install curtain pole';
  row.address = null; row.dateTimePreferences = null;
  row.viewedAt = null; row.depositPaidAt = null; row.bookedAt = null;
  row.expiresAt = new Date(Date.now() + 7*24*3600*1000);
  await db.insert(personalizedQuotes).values(row);
  console.log('created single-trade bookable preview:', newSlug, '(', kept.length, 'item )');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
