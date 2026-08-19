/**
 * Widens bulk_campaign_sends.phone_key, which was varchar(32) and overflowed on the first
 * archive-only run of the board clear-out.
 *
 * The board holds junk "phone numbers" that are nothing of the sort: conversation keys carrying
 * invisible Unicode direction marks from copied contact cards, and at least one 16-digit string
 * (+4477001460312697@c.us). The normalised key for those is longer than 32 characters, so the
 * campaign ledger refused the insert and took the archive down with it.
 *
 * A ledger of what we did to whom must never be the thing that blocks doing it. Widen to 64 and
 * let the junk in: this table records history, it does not validate numbers.
 *
 *   npx tsx scripts/migrate-widen-campaign-phone-key.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const before: any = await db.execute(sql`
        SELECT character_maximum_length AS len FROM information_schema.columns
        WHERE table_name = 'bulk_campaign_sends' AND column_name = 'phone_key'
    `).then((r: any) => (r.rows ?? r)[0]);
    console.log('phone_key before:', before?.len ?? '(table missing)');

    await db.execute(sql`ALTER TABLE bulk_campaign_sends ALTER COLUMN phone_key TYPE varchar(64)`);
    // segment is a fixed vocabulary and safe, but the same class of surprise lives in detail/e164.
    await db.execute(sql`ALTER TABLE bulk_campaign_sends ALTER COLUMN e164 TYPE varchar(64)`);

    const after: any = await db.execute(sql`
        SELECT character_maximum_length AS len FROM information_schema.columns
        WHERE table_name = 'bulk_campaign_sends' AND column_name = 'phone_key'
    `).then((r: any) => (r.rows ?? r)[0]);
    console.log('phone_key after :', after?.len);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
