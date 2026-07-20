/**
 * Seed delivery tiers per the founder-confirmed roster (PRD §4):
 * Core = Craig (1), Bezent (2), Joe (3) — Craig first. Everyone else stays
 * ad-hoc (the column default). Idempotent.
 */
import { eq } from 'drizzle-orm';
import { db } from '../server/db';
import { handymanProfiles } from '../shared/schema';

const CORE: Array<{ id: string; name: string; priority: number }> = [
  { id: 'hp_aa21264a-9143-4116-bda2-2da998255929', name: 'Craig Smith', priority: 1 },
  { id: 'hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac', name: 'Bezent Bonnick', priority: 2 },
  { id: 'hp_9e032a88-28bc-4398-80cb-267de3cfcdcc', name: "Joe O'neil", priority: 3 },
];

(async () => {
  for (const c of CORE) {
    await db.update(handymanProfiles).set({ deliveryTier: 'core', deliveryPriority: c.priority }).where(eq(handymanProfiles.id, c.id));
    console.log(`✓ ${c.name} → core, priority ${c.priority}`);
  }
  console.log('\nRoster tiers seeded.');
  process.exit(0);
})().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});
