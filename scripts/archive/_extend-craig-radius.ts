/**
 * One-off: extend Craig Smith's service radius so quote affx0ku0
 * (customer in Derby DE24 3EJ, 16.3 mi away) becomes fulfillable.
 *
 * Current radius: 10 mi (Mapperley-local only)
 * New radius:     20 mi (covers Derby + Mansfield + Long Eaton reliably,
 *                       leaves room for travel-time without overstretching)
 *
 * Single-row UPDATE against handyman_profiles. Run once; safe to re-run
 * (idempotent — sets the value rather than incrementing).
 */
import 'dotenv/config';
import { db } from '../server/db';
import { handymanProfiles, users } from '../shared/schema';
import { eq } from 'drizzle-orm';

const CRAIG_ID = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const NEW_RADIUS = 20;

async function main() {
  const [before] = await db.select({
    id: handymanProfiles.id,
    uid: handymanProfiles.userId,
    radius: handymanProfiles.radiusMiles,
  }).from(handymanProfiles).where(eq(handymanProfiles.id, CRAIG_ID)).limit(1);

  if (!before) { console.log('❌ Craig profile not found'); process.exit(1); }
  const [u] = await db.select().from(users).where(eq(users.id, before.uid)).limit(1);
  console.log(`Contractor: ${u?.firstName} ${u?.lastName} (${before.id})`);
  console.log(`Before:  radiusMiles = ${before.radius}`);

  if (before.radius === NEW_RADIUS) {
    console.log(`Already at ${NEW_RADIUS} mi — no change.`);
    process.exit(0);
  }

  await db.update(handymanProfiles)
    .set({ radiusMiles: NEW_RADIUS, updatedAt: new Date() })
    .where(eq(handymanProfiles.id, CRAIG_ID));

  const [after] = await db.select({ radius: handymanProfiles.radiusMiles })
    .from(handymanProfiles)
    .where(eq(handymanProfiles.id, CRAIG_ID))
    .limit(1);

  console.log(`After:   radiusMiles = ${after.radius}`);
  console.log(`\n✓ Craig's radius extended to ${NEW_RADIUS} mi. DE24 3EJ (16.3 mi) is now in range.`);
  console.log(`  Re-open quote affx0ku0 — fit panel should now show Craig + Jun 4-5 availability.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
