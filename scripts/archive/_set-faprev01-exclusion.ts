import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { addDays, format, startOfDay } from 'date-fns';
async function main() {
  const start = startOfDay(addDays(new Date(), 1));
  const allowed: { date: string; timeSlot: 'flexible' }[] = [];
  const isoAvoid: string[] = [];
  let wd = 0; // working-day index
  for (let i = 0; i < 21; i++) {
    const d = addDays(start, i);
    if (d.getDay() === 0) continue; // Sunday closed
    const iso = format(d, 'yyyy-MM-dd');
    if (wd === 1 || wd === 5) isoAvoid.push(iso);       // cross off 2nd + 6th working day
    else allowed.push({ date: iso, timeSlot: 'flexible' });
    wd++;
  }
  await db.update(personalizedQuotes).set({ dateTimePreferences: allowed }).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  console.log('allowed', allowed.length, '| avoided', JSON.stringify(isoAvoid));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
