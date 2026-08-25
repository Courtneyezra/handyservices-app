import { db } from '../server/db';
import { users, vaEndpoints, vaShifts } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
async function main() {
  const [ben] = await db.select({ id: users.id }).from(users).where(eq(users.firstName, 'Ben'));
  if (!ben) { console.log('No Ben'); process.exit(0); }
  const s = await db.execute(sql`SELECT value FROM app_settings WHERE key = 'twilio.forward_number' LIMIT 1`);
  const fwd = ((s as any).rows?.[0]?.value || 'sip:courtnee@handyservices.sip.twilio.com').trim();
  console.log('Ben user:', ben.id, '| current forward target:', fwd);

  const epId = 'vaep_ben';
  const existing = await db.select({ id: vaEndpoints.id }).from(vaEndpoints).where(eq(vaEndpoints.id, epId));
  if (existing.length === 0) {
    await db.insert(vaEndpoints).values({ id: epId, userId: ben.id, sipAddress: fwd, displayName: 'Ben', active: true });
    console.log('Inserted Ben endpoint →', fwd);
  } else {
    await db.update(vaEndpoints).set({ userId: ben.id, sipAddress: fwd, active: true }).where(eq(vaEndpoints.id, epId));
    console.log('Updated Ben endpoint →', fwd);
  }

  await db.delete(vaShifts).where(eq(vaShifts.vaEndpointId, epId));
  for (const d of [1,2,3,4,5,6]) { // Mon–Sat
    await db.insert(vaShifts).values({ id: `vash_ben_${d}`, vaEndpointId: epId, dayOfWeek: d, startMinute: 0, endMinute: 1020 });
  }
  console.log('Seeded Ben shifts: Mon–Sat 00:00–17:00 UK, Sunday off');

  // verify the attribution lookup resolves
  const [match] = await db.select({ userId: vaEndpoints.userId }).from(vaEndpoints)
    .where(sql`lower(sip_address) = ${fwd.toLowerCase()} AND active = true`).limit(1);
  console.log('Attribution check: forward SIP resolves to userId =', match?.userId, '(Ben =', ben.id + ')', match?.userId === ben.id ? '✓' : '✗');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
