import 'dotenv/config';
import { getTravelTimeMinutes } from '../server/lib/travel-time';
import { db } from '../server/db';
import { handymanProfiles } from '../shared/schema';
import { inArray } from 'drizzle-orm';

// Simulate the Phase 6 scoring against a customer in NG7 Lenton.
async function main() {
  const candidateIds = [
    'hp_9e032a88-28bc-4398-80cb-267de3cfcdcc', // Joe
    'hp_aa21264a-9143-4116-bda2-2da998255929', // Craig
    'hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac', // Bezent
    'hp_314305b9-df55-4d6b-a35f-a54bf13616c1', // Alex
  ];
  const customer = { lat: 52.9389, lng: -1.1789, name: 'NG7 Lenton' }; // customer

  const profiles = await db
    .select({ id: handymanProfiles.id, lat: handymanProfiles.latitude, lng: handymanProfiles.longitude, postcode: handymanProfiles.postcode })
    .from(handymanProfiles)
    .where(inArray(handymanProfiles.id, candidateIds));

  console.log(`Customer in ${customer.name} (${customer.lat}, ${customer.lng})\n`);
  const scored: Array<{ id: string; name: string; postcode: string | null; score: number; source: string }> = [];
  for (const p of profiles) {
    const lat = parseFloat(p.lat || '0'); const lng = parseFloat(p.lng || '0');
    if (isNaN(lat) || isNaN(lng)) { scored.push({ id: p.id, name: 'unknown', postcode: p.postcode, score: Infinity, source: 'no-coords' }); continue; }
    const t = await getTravelTimeMinutes(lat, lng, customer.lat, customer.lng);
    scored.push({ id: p.id.slice(0, 12), name: p.postcode || '?', postcode: p.postcode, score: t.minutes, source: t.source });
  }
  scored.sort((a, b) => a.score - b.score);

  console.log('Sorted closest-first (Phase 6 order):');
  for (const s of scored) {
    console.log(`  ${s.name?.padEnd(8) || '?'.padEnd(8)}  ${String(s.score).padStart(3)}min  ${s.source}  ${s.id}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
