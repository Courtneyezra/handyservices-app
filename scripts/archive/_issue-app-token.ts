/**
 * Issue (or print the existing) contractor-app link token for a contractor —
 * same lazy idempotent semantics as POST /api/admin/contractor-hub/:id/app-link.
 *
 *   npx tsx scripts/_issue-app-token.ts [contractorId]   (defaults to Craig)
 */
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../server/db';
import { handymanProfiles } from '../shared/schema';

const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const id = process.argv[2] || CRAIG;

(async () => {
  const rows = await db.select({ id: handymanProfiles.id, appToken: handymanProfiles.appToken })
    .from(handymanProfiles).where(eq(handymanProfiles.id, id)).limit(1);
  if (!rows.length) { console.error(`Contractor ${id} not found`); process.exit(1); }
  let token = rows[0].appToken;
  if (!token) {
    token = randomBytes(24).toString('base64url');
    await db.update(handymanProfiles).set({ appToken: token }).where(eq(handymanProfiles.id, id));
  }
  console.log(`/my-week/${token}`);
  process.exit(0);
})();
