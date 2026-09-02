/**
 * Retire the seeded test contractor (scripts/seed-test-contractor.ts: "Mike Thompson",
 * 07700900001 — an Ofcom reserved drama number, mike.test@handyservices.co.uk).
 *
 *   npx tsx scripts/_retire-test-contractor.ts --dry-run     # default: list what would change, write nothing
 *   npx tsx scripts/_retire-test-contractor.ts --apply       # users.is_active=false, users.phone=NULL,
 *                                                            # handyman_profiles.public_profile_enabled=false
 *   npx tsx scripts/_retire-test-contractor.ts --apply --clear-availability
 *                                                            # additionally DELETE the seeded weekly pattern and
 *                                                            # date rows, so the quote-date picker and the
 *                                                            # auto-assigner can never offer this contractor
 *
 * Why: the contractor lane (Phase 4) resolves audience from the phone, the availability picker reads
 * per-contractor patterns/dates, and the ledger's test-data scrub keys on 07700900xxx. A live-looking
 * contractor on a drama number is a wrong-audience risk once the spine is live. Nothing here touches
 * customers. Match is by phone digits (07700900001 / 447700900001) OR the seed email, role contractor;
 * more than one match, or a non-contractor match, refuses to --apply. Writes one system_events row.
 */
import 'dotenv/config';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../server/db';
import {
    users, handymanProfiles, handymanSkills, handymanAvailability, contractorAvailabilityDates,
} from '../shared/schema';

const SEED_EMAIL = 'mike.test@handyservices.co.uk';
const SEED_DIGITS = ['07700900001', '447700900001'];
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CLEAR_AVAIL = argv.includes('--clear-availability');
const dbHost = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '');

async function main() {
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · database: ${dbHost || '(unset)'}\n`);
    const matches = await db.select({
        id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName,
        phone: users.phone, role: users.role, isActive: users.isActive, lastLogin: users.lastLogin, createdAt: users.createdAt,
    }).from(users).where(or(
        eq(users.email, SEED_EMAIL),
        inArray(sql`regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g')`, SEED_DIGITS),
    ));

    if (!matches.length) { console.log('No user matches the seed email or 07700900001. Nothing to do.'); process.exit(0); }

    for (const u of matches) {
        const profiles = await db.select({
            id: handymanProfiles.id, slug: handymanProfiles.slug, publicProfileEnabled: handymanProfiles.publicProfileEnabled,
            availabilityStatus: handymanProfiles.availabilityStatus, verificationStatus: handymanProfiles.verificationStatus,
        }).from(handymanProfiles).where(eq(handymanProfiles.userId, u.id));
        console.log(`user ${u.id}`);
        console.log(`  ${u.firstName ?? ''} ${u.lastName ?? ''} <${u.email}> phone=${u.phone ?? 'null'} role=${u.role} is_active=${u.isActive} last_login=${u.lastLogin ? new Date(u.lastLogin).toISOString() : 'never'}`);
        for (const p of profiles) {
            const [skills] = await db.select({ n: sql<number>`count(*)::int` }).from(handymanSkills).where(eq(handymanSkills.handymanId, p.id));
            const [pattern] = await db.select({ n: sql<number>`count(*)::int` }).from(handymanAvailability).where(eq(handymanAvailability.handymanId, p.id));
            const [dates] = await db.select({ n: sql<number>`count(*)::int`, future: sql<number>`count(*) FILTER (WHERE date >= current_date)::int` })
                .from(contractorAvailabilityDates).where(eq(contractorAvailabilityDates.contractorId, p.id));
            console.log(`  profile ${p.id} slug=${p.slug} public=${p.publicProfileEnabled} availability=${p.availabilityStatus} verification=${p.verificationStatus}`);
            console.log(`    skills ${skills?.n ?? 0} · weekly pattern rows ${pattern?.n ?? 0} · date rows ${dates?.n ?? 0} (${dates?.future ?? 0} today or later)`);
        }
        console.log('  would set: users.is_active=false, users.phone=NULL' + (profiles.length ? ', handyman_profiles.public_profile_enabled=false' : '')
            + (CLEAR_AVAIL ? ', DELETE weekly pattern + date rows' : ' (availability rows kept; add --clear-availability to remove them)'));
    }

    if (!APPLY) { console.log('\nDry run: nothing written. Add --apply to do it.'); process.exit(0); }
    if (matches.length !== 1) { console.error(`\nRefusing --apply: ${matches.length} users matched; expected exactly one.`); process.exit(2); }
    const u = matches[0];
    if (u.role !== 'contractor') { console.error(`\nRefusing --apply: matched user has role ${u.role}, not contractor.`); process.exit(2); }

    const profiles = await db.select({ id: handymanProfiles.id }).from(handymanProfiles).where(eq(handymanProfiles.userId, u.id));
    const profileIds = profiles.map((p) => p.id);
    const changes: Record<string, unknown> = {};

    await db.update(users).set({ isActive: false, phone: null, updatedAt: new Date() }).where(and(eq(users.id, u.id), eq(users.role, 'contractor')));
    changes.users = { id: u.id, isActive: false, phone: null, previousPhone: u.phone };
    if (profileIds.length) {
        await db.update(handymanProfiles).set({ publicProfileEnabled: false }).where(inArray(handymanProfiles.id, profileIds));
        changes.handymanProfiles = { ids: profileIds, publicProfileEnabled: false };
        if (CLEAR_AVAIL) {
            const delPattern = await db.delete(handymanAvailability).where(inArray(handymanAvailability.handymanId, profileIds)).returning({ id: handymanAvailability.id });
            const delDates = await db.delete(contractorAvailabilityDates).where(inArray(contractorAvailabilityDates.contractorId, profileIds)).returning({ id: contractorAvailabilityDates.id });
            changes.availability = { patternRowsDeleted: delPattern.length, dateRowsDeleted: delDates.length };
        }
    }
    try {
        const { logSystemEvent } = await import('../server/system-events');
        await logSystemEvent({
            kind: 'config_change', source: 'retire-test-contractor',
            summary: `test contractor retired: ${u.email} (was ${u.phone ?? 'no phone'}) deactivated by script:${process.env.USER ?? 'unknown'}`,
            detail: changes,
        });
    } catch (e: any) { console.warn('system_events row failed (retirement stands):', e?.message); }
    console.log('\nApplied:', JSON.stringify(changes, null, 2));
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
