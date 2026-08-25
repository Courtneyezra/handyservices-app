import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const [q] = await db.select({
    selectedDate: personalizedQuotes.selectedDate,
    availableDates: personalizedQuotes.availableDates,
    dateTimePreferences: personalizedQuotes.dateTimePreferences,
  }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));

  const prefDates = Array.isArray(q.dateTimePreferences)
    ? [...new Set((q.dateTimePreferences as { date: string }[]).map(p => p.date))]
    : [];

  let bucket: string;
  if (q.selectedDate) bucket = 'CONFIRMED(' + new Date(q.selectedDate).toISOString().slice(0,10) + ')';
  else if (prefDates.length > 0) bucket = 'ALLOWED-DAYS group keys → ' + prefDates.length + ' dates: ' + prefDates.slice(0,3).join(',') + ' … ' + prefDates.slice(-1);
  else if (Array.isArray(q.availableDates) && (q.availableDates as string[]).length > 0) bucket = 'LEGACY availableDates';
  else bucket = 'UNSCHEDULED';

  console.log('selectedDate:', q.selectedDate, '| availableDates:', q.availableDates, '| prefs:', prefDates.length);
  console.log('→ BEFORE fix (availableDates only): ' + (q.selectedDate ? 'CONFIRMED' : (Array.isArray(q.availableDates)&&(q.availableDates as any[]).length) ? 'LEGACY' : 'UNSCHEDULED'));
  console.log('→ AFTER fix:', bucket);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
