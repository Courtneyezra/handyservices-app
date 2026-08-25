import { personalizedQuotes } from '../shared/schema';
import { db } from '../server/db';
import { eq } from 'drizzle-orm';
import { format } from 'date-fns';
async function main() {
  const [q] = await db.select({ p: personalizedQuotes.dateTimePreferences }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'faprev01'));
  const prefs = q.p as { date: string; timeSlot: string }[];
  const allFlexible = prefs.every(p => p.timeSlot === 'flexible');
  const allowed = prefs.map(p => p.date).sort();
  const avoided: string[] = [];
  const start = new Date(allowed[0] + 'T12:00:00');
  const end = new Date(allowed[allowed.length - 1] + 'T12:00:00');
  const allowedSet = new Set(allowed);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    const iso = format(d, 'yyyy-MM-dd');
    if (!allowedSet.has(iso)) avoided.push(iso);
  }
  const label = allowed.length <= 4 ? `Works: ${allowed.map(d=>format(new Date(d+'T12:00:00'),'EEE d MMM')).join(', ')}`
    : avoided.length === 0 ? `Fully flexible · ${allowed.length} days open`
    : `Flexible · avoids: ${avoided.map(d=>format(new Date(d+'T12:00:00'),'EEE d MMM')).join(', ')}`;
  console.log('allFlexible:', allFlexible, '| allowed:', allowed.length);
  console.log('RENDER →', label);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
