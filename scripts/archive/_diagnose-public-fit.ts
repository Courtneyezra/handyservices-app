import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes, handymanSkills, handymanProfiles, contractorAvailabilityDates, contractorBookingRequests, users } from '../shared/schema';
import { eq, and, inArray, gte, lte, or } from 'drizzle-orm';

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, 'affx0ku0')).limit(1);
  if (!q) { console.log('not found'); process.exit(1); }
  console.log('candidateContractorIds on quote:', q.candidateContractorIds);
  const lines: any[] = Array.isArray(q.pricingLineItems) ? q.pricingLineItems as any[] : [];
  const cats = Array.from(new Set(lines.map(l => l.category).filter(Boolean)));
  console.log('Categories from line items:', cats);

  // Fallback path: any contractor with ANY of the categories
  const ids = new Set<string>();
  for (const c of cats) {
    const rows = await db.select({ hid: handymanSkills.handymanId }).from(handymanSkills).where(eq(handymanSkills.categorySlug, c));
    rows.forEach(r => ids.add(r.hid));
  }
  console.log(`Fallback contractor pool (any-category match): ${ids.size} contractors`);
  const ps = await db.select({ id: handymanProfiles.id, lat: handymanProfiles.latitude, lng: handymanProfiles.longitude, radius: handymanProfiles.radiusMiles, uid: handymanProfiles.userId }).from(handymanProfiles).where(inArray(handymanProfiles.id, [...ids]));
  for (const p of ps) {
    const [u] = await db.select().from(users).where(eq(users.id, p.uid)).limit(1);
    const name = `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
    console.log(`  · ${name} (${p.id}) lat=${p.lat} lng=${p.lng} radius=${p.radius}`);
  }

  // Customer location
  const custLat = 52.874713, custLng = -1.509897;
  console.log(`\nCustomer DE24 3EJ → ${custLat}, ${custLng}`);
  for (const p of ps) {
    if (!p.lat || !p.lng) continue;
    const R = 3958.8;
    const dLat = ((parseFloat(p.lat) - custLat) * Math.PI) / 180;
    const dLng = ((parseFloat(p.lng) - custLng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((custLat * Math.PI) / 180) * Math.cos((parseFloat(p.lat) * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const out = d > (p.radius || 0);
    console.log(`  → ${p.id.slice(0,12)}…: ${d.toFixed(1)} mi (radius ${p.radius}) ${out ? '⚠ OUT OF RANGE' : 'in range'}`);
  }

  // Show 4-5 June overrides for the pool
  const start = new Date('2026-06-04T00:00:00.000Z'); const end = new Date('2026-06-06T00:00:00.000Z');
  const ov = await db.select().from(contractorAvailabilityDates).where(and(inArray(contractorAvailabilityDates.contractorId, [...ids]), gte(contractorAvailabilityDates.date, start), lte(contractorAvailabilityDates.date, end)));
  console.log(`\nAvailability overrides Jun 4-5 in pool:`);
  for (const o of ov) console.log(`  ${o.contractorId.slice(0,12)}… ${new Date(o.date).toISOString().slice(0,10)} isAvail=${o.isAvailable} ${o.startTime}-${o.endTime}`);
}
main().then(() => process.exit(0));
