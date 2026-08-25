import { db } from '../server/db';
import { calls, users } from '../shared/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
async function main() {
  const [ben] = await db.select({ id: users.id }).from(users).where(eq(users.firstName, 'Ben'));
  if (!ben) { console.log('No Ben'); process.exit(0); }
  const before = await db.select({ n: sql<number>`count(*)` }).from(calls).where(and(eq(calls.handledBy, 'va'), isNull(calls.handledByUserId)));
  console.log(`VA calls missing handledByUserId: ${before[0].n}`);
  const res = await db.update(calls).set({ handledByUserId: ben.id })
    .where(and(eq(calls.handledBy, 'va'), isNull(calls.handledByUserId)));
  console.log('Backfilled all historical VA calls → Ben (he was the only VA).');
  const after = await db.select({ n: sql<number>`count(*)` }).from(calls).where(and(eq(calls.handledBy, 'va'), isNull(calls.handledByUserId)));
  console.log(`Remaining unattributed VA calls: ${after[0].n}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
