import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNull, lt, desc } from 'drizzle-orm';

async function main() {
    const rows = await db.select({
        slug: personalizedQuotes.shortSlug,
        id: personalizedQuotes.id,
        customer: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        email: personalizedQuotes.email,
        expiresAt: personalizedQuotes.expiresAt,
        basePrice: personalizedQuotes.basePrice,
        extensionCount: personalizedQuotes.extensionCount,
    })
        .from(personalizedQuotes)
        .where(and(
            lt(personalizedQuotes.expiresAt, new Date()),
            isNull(personalizedQuotes.depositPaidAt),
        ))
        .orderBy(desc(personalizedQuotes.createdAt))
        .limit(40);

    const isTest = (r: any) =>
        /^0770090/.test(r.phone || '') ||
        /example\.com$/i.test(r.email || '') ||
        /test|qa|phase|dummy/i.test(`${r.customer || ''} ${r.id || ''}`);

    console.log('TEST-SIGNATURE expired unbooked quotes:');
    console.table(rows.filter(isTest));
    console.log('\nFirst few REAL expired unbooked (render-only, do NOT click refresh):');
    console.table(rows.filter((r) => !isTest(r)).slice(0, 5));
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
