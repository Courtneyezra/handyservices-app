import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

async function main() {
    const rows = await db.select({
        slug: personalizedQuotes.shortSlug,
        id: personalizedQuotes.id,
        customer: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        email: personalizedQuotes.email,
        createdAt: personalizedQuotes.createdAt,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        selectedAt: personalizedQuotes.selectedAt,
        bookedAt: personalizedQuotes.bookedAt,
        flexBookingWithinDays: personalizedQuotes.flexBookingWithinDays,
        dateTimePreferences: personalizedQuotes.dateTimePreferences,
    })
        .from(personalizedQuotes)
        .where(isNotNull(personalizedQuotes.dateTimePreferences))
        .orderBy(desc(personalizedQuotes.createdAt))
        .limit(500);

    const withCounts = rows
        .map((r) => ({ ...r, allowedDays: Array.isArray(r.dateTimePreferences) ? r.dateTimePreferences.length : 0 }))
        .filter((r) => r.allowedDays > 0 && r.allowedDays <= 4)
        .sort((a, b) => a.allowedDays - b.allowedDays);

    console.log(`Quotes with <=4 allowed days (heavily crossed-off). Found ${withCounts.length}:\n`);
    for (const r of withCounts) {
        const dates = (r.dateTimePreferences as any[]).map((p) => `${p.date}${p.timeSlot && p.timeSlot !== 'flexible' ? '/' + p.timeSlot : ''}`).sort();
        const status = r.depositPaidAt ? 'PAID' : r.bookedAt ? 'BOOKED' : r.selectedAt ? 'SELECTED' : 'unpaid';
        console.log(`allowed=${r.allowedDays}  ${r.slug}  ${r.customer}  ${r.phone || r.email || ''}  [${status}]  created=${r.createdAt?.toISOString?.().slice(0,10)}  flexWithin=${r.flexBookingWithinDays ?? '—'}`);
        console.log(`   open dates: ${dates.join(', ')}`);
    }
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
