/**
 * Reset Ben's password.
 *
 * Usage (LOCAL):
 *   npx tsx scripts/reset-ben-password.ts
 *
 * Usage (PRODUCTION):
 *   DATABASE_URL='<your prod connection string>' npx tsx scripts/reset-ben-password.ts
 *
 * The connection string is read from env at runtime so this script never has
 * production credentials baked in.
 *
 * Change NEW_PASSWORD below to whatever you want. The current default is a
 * temporary value — change it before running, or change it again immediately
 * after Ben logs in.
 */

import bcrypt from 'bcrypt';
import { db } from '../server/db';
import { users } from '../shared/schema';
import { eq } from 'drizzle-orm';

const BEN_EMAIL = 'ben@handyservices.com';
const NEW_PASSWORD = process.env.BEN_NEW_PASSWORD || 'BenTemp2026!';

async function main() {
  // Sanity: confirm we found Ben before touching anything
  const [ben] = await db
    .select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, BEN_EMAIL))
    .limit(1);

  if (!ben) {
    console.error(`❌ No user found with email ${BEN_EMAIL}. Aborting.`);
    process.exit(1);
  }

  console.log(`Found user:`);
  console.log(`  id:       ${ben.id}`);
  console.log(`  email:    ${ben.email}`);
  console.log(`  role:     ${ben.role}`);
  console.log(`  active:   ${ben.isActive}`);

  if (ben.role !== 'admin' && ben.role !== 'va') {
    console.error(`❌ Refusing to reset password for role "${ben.role}" — expected admin or va.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 10);

  await db
    .update(users)
    .set({ password: hash })
    .where(eq(users.id, ben.id));

  console.log(`\n✅ Password reset for ${ben.email}`);
  console.log(`   New password: ${NEW_PASSWORD}`);
  console.log(`   (Tell Ben to change it on first login.)`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
