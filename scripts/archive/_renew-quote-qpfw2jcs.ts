import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const QUOTE_VALIDITY_MS = 48 * 60 * 60 * 1000;
const SLUG = 'qpfw2jcs';

async function main() {
    const [quote] = await db.select().from(personalizedQuotes)
        .where(eq(personalizedQuotes.shortSlug, SLUG)).limit(1);

    if (!quote) {
        console.error(`No quote found for slug "${SLUG}"`);
        process.exit(1);
    }

    console.log('BEFORE:', {
        slug: quote.shortSlug,
        customer: quote.customerName,
        createdAt: quote.createdAt,
        expiresAt: quote.expiresAt,
        regenerationCount: quote.regenerationCount,
    });

    const newExpiresAt = new Date(Date.now() + QUOTE_VALIDITY_MS);

    await db.update(personalizedQuotes)
        .set({
            expiresAt: newExpiresAt,
            regenerationCount: (quote.regenerationCount || 0) + 1,
        })
        .where(eq(personalizedQuotes.id, quote.id));

    console.log('AFTER: expiresAt reset to', newExpiresAt.toISOString(), '(price unchanged)');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
