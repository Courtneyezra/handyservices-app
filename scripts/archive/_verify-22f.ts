/**
 * Phase 22f verification — confirm both endpoints now agree about quote
 * affx0ku0. Expected: ZERO candidates from both, because Craig + Bezent
 * are out of their service radius for DE24 3EJ.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { resolveQuoteCandidatePool, resolveQuoteCandidatePoolForQuote } from '../server/lib/quote-fit';

async function main() {
  const [quote] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'affx0ku0')).limit(1);
  if (!quote) { console.log('not found'); process.exit(1); }

  console.log('═══ Phase 22f verification: quote affx0ku0 ═══\n');
  console.log(`Postcode: ${quote.postcode}`);
  console.log(`Coords stored: ${JSON.stringify(quote.coordinates)}`);
  const lines: any[] = Array.isArray(quote.pricingLineItems) ? quote.pricingLineItems as any[] : [];
  const cats = Array.from(new Set(lines.map(l => l.category).filter(Boolean)));
  console.log(`Categories: [${cats.join(', ')}]\n`);

  // Public endpoint path (uses resolveQuoteCandidatePoolForQuote — geocodes if coords null)
  console.log('── PUBLIC endpoint path (resolveQuoteCandidatePoolForQuote) ──');
  const pub = await resolveQuoteCandidatePoolForQuote(quote);
  console.log(`  candidates: ${pub.candidates.length}`);
  console.log(`  uncoveredCategories: [${pub.uncoveredCategories.join(',')}]`);
  console.log(`  partialDropped: ${pub.partialCoverageDropped}`);
  for (const c of pub.candidates) {
    console.log(`    · ${c.contractorName} ${c.coveragePercent}% dist=${c.distanceMiles}`);
  }

  // Admin fit endpoint path (uses resolveQuoteCandidatePool — coords passed by client)
  console.log('\n── ADMIN /fit endpoint path (resolveQuoteCandidatePool with geocoded coords) ──');
  // simulate the admin builder which receives lat/lng from quote.coordinates or geocoded postcode
  const adminCoords = (quote.coordinates as any) || { lat: 52.874713, lng: -1.509897 };
  const adm = await resolveQuoteCandidatePool({ categorySlugs: cats, customerLat: adminCoords.lat, customerLng: adminCoords.lng });
  console.log(`  candidates: ${adm.candidates.length}`);
  console.log(`  uncoveredCategories: [${adm.uncoveredCategories.join(',')}]`);
  for (const c of adm.candidates) {
    console.log(`    · ${c.contractorName} ${c.coveragePercent}% dist=${c.distanceMiles}`);
  }

  // Agreement check
  console.log('\n══ AGREEMENT ══');
  const pubSet = new Set(pub.candidates.map(c => c.contractorId));
  const admSet = new Set(adm.candidates.map(c => c.contractorId));
  const same = pubSet.size === admSet.size && [...pubSet].every(id => admSet.has(id));
  console.log(`Identical candidate sets: ${same ? '✓ YES' : '❌ NO'}`);
  console.log(`Public: ${pub.candidates.length} contractors`);
  console.log(`Admin:  ${adm.candidates.length} contractors`);
  if (pub.candidates.length === 0 && adm.candidates.length === 0) {
    console.log('\n✓ Both endpoints correctly return ZERO candidates for DE24 3EJ — no one in range can do this whole job.');
    console.log('  Customer sees "no dates" instead of being offered Craig\'s 4-5 June (Craig is 16 mi away, his radius is 10).');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
