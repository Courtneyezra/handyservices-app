/**
 * Mints a short-lived local admin session token for UI verification during development.
 * Prints the token plus the localStorage snippet to paste into a dev browser.
 *
 *   npx tsx scripts/_dev-admin-token.ts
 */
import { db } from '../server/db';
import { users, contractorSessions } from '@shared/schema';
import { eq, or } from 'drizzle-orm';
import crypto from 'crypto';

async function main() {
    const admin = await db.query.users.findFirst({
        where: or(eq(users.role, 'admin'), eq(users.role, 'va')),
    });
    if (!admin) {
        console.error('No admin/va user exists in this database.');
        process.exit(1);
    }

    const sessionToken = `dev_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours is plenty for a check.

    await db.insert(contractorSessions).values({
        id: `sess_dev_${Date.now()}`,
        userId: admin.id,
        sessionToken,
        expiresAt,
    });

    console.log(`user   : ${admin.email ?? admin.id} (${admin.role})`);
    console.log(`expires: ${expiresAt.toISOString()}`);
    console.log(`token  : ${sessionToken}`);
    console.log(`\nlocalStorage.setItem('adminToken', '${sessionToken}')`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
