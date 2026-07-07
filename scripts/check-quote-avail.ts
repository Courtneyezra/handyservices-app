import { db } from '../server/db';
import { personalizedQuotes, handymanAvailability, handymanProfiles, contractorAvailabilityDates } from '../shared/schema';
import { eq, or } from 'drizzle-orm';

async function main() {
  const quote = await db.query.personalizedQuotes.findFirst({
    where: or(
      eq(personalizedQuotes.shortSlug, 'vqb49nhc'),
      eq(personalizedQuotes.id, 'vqb49nhc')
    )
  });
  
  if (!quote) { console.log('Quote not found'); process.exit(1); }
  
  console.log('Quote ID:', quote.id, '| Slug:', quote.shortSlug);
  console.log('Customer:', quote.customerName, '| Postcode:', quote.postcode);
  console.log('Coordinates:', quote.coordinates);
  const lineItems = (quote.pricingLineItems as any[] || []);
  console.log('Line items:', lineItems.map(li => `${li.description} [${li.categorySlug || li.category}]`).join(', '));
  
  // Check contractor weekly patterns
  const patterns = await db.select().from(handymanAvailability);
  console.log('\nhandymanAvailability rows:', patterns.length);
  
  // Check date-specific overrides
  const overrides = await db.select().from(contractorAvailabilityDates);
  console.log('contractorAvailabilityDates rows:', overrides.length);
  if (overrides.length > 0) {
    overrides.slice(0, 5).forEach(o => console.log(' -', o.contractorId, new Date(o.date).toISOString().split('T')[0], 'available:', o.isAvailable));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
