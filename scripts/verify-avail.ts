import { db } from '../server/db';
import { resolveQuoteCandidatePoolForQuote } from '../server/lib/quote-fit';
import { personalizedQuotes } from '../shared/schema';
import { eq, or } from 'drizzle-orm';

async function main() {
  const quote = await db.query.personalizedQuotes.findFirst({
    where: or(
      eq(personalizedQuotes.shortSlug, 'vqb49nhc'),
      eq(personalizedQuotes.id, 'vqb49nhc')
    )
  });
  
  if (!quote) { console.log('Quote not found'); process.exit(1); }
  
  console.log('Resolving candidate pool for quote:', quote.id, '| postcode:', quote.postcode);
  const fit = await resolveQuoteCandidatePoolForQuote(quote);
  
  console.log('\n=== Candidate Pool ===');
  console.log('Candidates:', fit.candidates.length);
  fit.candidates.forEach(c => console.log(`  - ${c.contractorId} | ${c.contractorName} | coverage=${c.coveragePercent}% | distance=${c.distanceMiles?.toFixed(1)} mi`));
  console.log('Uncovered categories:', fit.uncoveredCategories);
  
  if (fit.candidates.length === 0) {
    console.log('\n❌ No candidates — dates will NOT show');
  } else {
    console.log('\n✅ Candidates found — July 6/7 will show if within date window');
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
