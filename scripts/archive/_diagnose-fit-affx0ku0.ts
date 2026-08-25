/**
 * Phase 22 diagnostic — why isn't Craig showing in the fit panel for
 * quote affx0ku0 even though he has availability next week?
 *
 * Walks the same path the /api/admin/availability/fit endpoint walks,
 * but logs every decision point so we can pinpoint where Craig drops off.
 */
import 'dotenv/config';
import { db } from '../server/db';
import {
  personalizedQuotes,
  handymanProfiles,
  contractorAvailabilityDates,
  contractorBookingRequests,
  handymanAvailability,
  handymanSkills,
  users,
} from '../shared/schema';
import { eq, and, inArray, gte, lte, or } from 'drizzle-orm';
import { findCandidateContractors } from '../server/contractor-matcher';

const QUOTE_SLUG = 'affx0ku0';

async function main() {
  console.log(`\n═══ Diagnosing fit for quote ${QUOTE_SLUG} ═══\n`);

  // 1. Load the quote
  const [quote] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, QUOTE_SLUG))
    .limit(1);

  if (!quote) {
    console.log('❌ Quote not found.');
    process.exit(1);
  }

  console.log(`Quote: ${quote.id} (${quote.shortSlug})`);
  console.log(`Customer: ${quote.customerName} · ${quote.postcode}`);
  console.log(`Coords: ${JSON.stringify(quote.coordinates)}`);

  const lines: any[] = Array.isArray(quote.pricingLineItems) ? (quote.pricingLineItems as any[]) : [];
  const categories = [...new Set(lines.map((l) => l.category).filter(Boolean))];
  console.log(`Line items: ${lines.length}`);
  for (const l of lines) {
    console.log(`  · ${l.category}  "${l.description}"`);
  }
  console.log(`Unique categories: [${categories.join(', ')}]`);

  // 2. Find Craig's contractor profile
  const allProfiles = await db.query.handymanProfiles.findMany({
    with: { user: true, skills: true },
  });
  const craig = allProfiles.find((p) => {
    const name = `${p.user?.firstName || ''} ${p.user?.lastName || ''}`.toLowerCase();
    return name.includes('craig');
  });

  if (!craig) {
    console.log('\n❌ Craig profile not found.');
    process.exit(1);
  }

  console.log(`\n─── Craig ───`);
  console.log(`id: ${craig.id}`);
  console.log(`verificationStatus: ${craig.verificationStatus}`);
  console.log(`publicProfileEnabled: ${craig.publicProfileEnabled}`);
  console.log(`active: ${craig.isActive}`);
  console.log(`lat/lng: ${craig.latitude}/${craig.longitude}`);
  console.log(`radiusMiles: ${craig.radiusMiles}`);
  console.log(`skills: [${(craig.skills || []).map((s) => s.categorySlug).join(', ')}]`);

  // 3. Run the matcher with the quote's categories + coords
  const coords = quote.coordinates as { lat?: number; lng?: number } | null;
  const cLat = coords?.lat;
  const cLng = coords?.lng;

  console.log(`\n─── Matcher run ───`);
  console.log(`categorySlugs: [${categories.join(', ')}]`);
  console.log(`customerLat/Lng: ${cLat}/${cLng}`);

  const match = await findCandidateContractors({
    categorySlugs: categories,
    customerLat: cLat,
    customerLng: cLng,
  });

  console.log(`\nMatcher returned ${match.candidates.length} candidate(s):`);
  for (const c of match.candidates) {
    const isCraig = c.contractorId === craig.id;
    console.log(
      `  ${isCraig ? '★' : ' '} ${c.contractorName.padEnd(20)} ` +
        `coverage=${c.coveragePercent}% covers=[${c.coveredCategories.join(',')}] ` +
        `distance=${c.distanceMiles ?? '—'}`,
    );
  }

  const craigInCandidates = match.candidates.find((c) => c.contractorId === craig.id);

  // 4. Diagnose why Craig may have been dropped
  console.log(`\n─── Craig coverage diagnosis ───`);
  const craigSkillSlugs = new Set((craig.skills || []).map((s) => s.categorySlug));
  const missing = categories.filter((cat) => !craigSkillSlugs.has(cat));
  console.log(`Missing categories: [${missing.join(', ') || 'none'}]`);
  if (missing.length === 0) {
    console.log('✓ Craig covers every category.');
  } else {
    console.log(`❌ Craig is missing ${missing.length}/${categories.length} → matcher will mark him partial → dropped by 22b filter.`);
  }

  // 5. Distance check
  if (cLat != null && cLng != null && craig.latitude && craig.longitude) {
    const cLatNum = parseFloat(craig.latitude);
    const cLngNum = parseFloat(craig.longitude);
    const R = 3958.8;
    const dLat = ((cLatNum - cLat) * Math.PI) / 180;
    const dLng = ((cLngNum - cLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((cLat * Math.PI) / 180) *
        Math.cos((cLatNum * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    console.log(`\n─── Distance ───`);
    console.log(`Craig → customer: ${dist.toFixed(2)} miles (Craig's radius: ${craig.radiusMiles} mi)`);
    if (dist > (craig.radiusMiles || 0)) {
      console.log(`❌ Customer is outside Craig's service radius → matcher drops him before coverage check.`);
    } else {
      console.log(`✓ Within Craig's radius.`);
    }
  }

  // 6. Verified-or-public gate
  console.log(`\n─── Verified-or-public gate ───`);
  const passesGate =
    craig.verificationStatus === 'verified' || craig.publicProfileEnabled === true;
  console.log(`Passes gate: ${passesGate} (verificationStatus="${craig.verificationStatus}", publicProfileEnabled=${craig.publicProfileEnabled})`);

  // 7. Craig's next-14-day availability rows
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 14);
  console.log(`\n─── Craig's availability rows ${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)} ───`);
  const overrides = await db
    .select()
    .from(contractorAvailabilityDates)
    .where(
      and(
        eq(contractorAvailabilityDates.contractorId, craig.id),
        gte(contractorAvailabilityDates.date, start),
        lte(contractorAvailabilityDates.date, end),
      ),
    );
  console.log(`Overrides: ${overrides.length}`);
  for (const o of overrides) {
    console.log(
      `  ${new Date(o.date).toISOString().slice(0, 10)} isAvailable=${o.isAvailable} ${o.startTime ?? '—'}-${o.endTime ?? '—'}`,
    );
  }
  const jobs = await db
    .select()
    .from(contractorBookingRequests)
    .where(
      and(
        or(
          eq(contractorBookingRequests.assignedContractorId, craig.id),
          eq(contractorBookingRequests.contractorId, craig.id),
        ),
        gte(contractorBookingRequests.scheduledDate, start),
        lte(contractorBookingRequests.scheduledDate, end),
      ),
    );
  console.log(`Bookings: ${jobs.length}`);
  for (const j of jobs) {
    console.log(
      `  ${new Date(j.scheduledDate!).toISOString().slice(0, 10)} slot=${j.scheduledSlot} assignStatus=${j.assignmentStatus} status=${j.status}`,
    );
  }
  const patterns = await db
    .select()
    .from(handymanAvailability)
    .where(eq(handymanAvailability.handymanId, craig.id));
  console.log(`Weekly patterns: ${patterns.length}`);
  for (const p of patterns) {
    console.log(`  dow=${p.dayOfWeek} active=${p.isActive} ${p.startTime}-${p.endTime}`);
  }

  // 8. Verdict
  console.log(`\n═══ Verdict ═══`);
  if (!craigInCandidates) {
    if (missing.length > 0) {
      console.log(`❌ Craig is missing skills [${missing.join(', ')}] — matcher computed partial coverage.`);
      console.log(`   The 22b strict filter then dropped him from the fit panel.`);
      console.log(`   This is INTENDED behaviour, but the user expected him to show up — gap is on skill registration, not filtering.`);
    } else if (!passesGate) {
      console.log(`❌ Craig dropped by the verified-or-public gate.`);
    } else {
      console.log(`❌ Craig dropped by distance or another matcher condition. Inspect the matcher trace above.`);
    }
  } else if (craigInCandidates.coveragePercent < 100) {
    console.log(`❌ Craig is in matcher results at ${craigInCandidates.coveragePercent}% — 22b filter dropped him from the endpoint response.`);
    console.log(`   Missing: [${missing.join(', ')}]`);
  } else {
    console.log(`✓ Craig SHOULD be visible (100% match, in candidates).`);
    console.log(`   If the UI still didn't show him, check: availability rows empty? Or fit endpoint hit a 500?`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
