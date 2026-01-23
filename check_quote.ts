
import { db } from './server/db';
import { personalizedQuotes } from './shared/schema';
import { eq } from 'drizzle-orm';

async function checkQuote() {
    const slug = 'ktVRcDmW';
    console.log(`Checking quote with slug: ${slug}`);

    const result = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug));

    if (result.length === 0) {
        console.log('Quote not found');
        return;
    }

    const quote = result[0];
    console.log('Quote found:', quote.id);
    console.log('Job Description:', quote.jobDescription);
    console.log('Quote Mode:', quote.quoteMode);
    console.log('Jobs Data:', JSON.stringify(quote.jobs, null, 2));
    console.log('Optional Extras:', JSON.stringify(quote.optionalExtras, null, 2));
    console.log('Base Price:', quote.basePrice);

    process.exit(0);
}

checkQuote().catch(console.error);
