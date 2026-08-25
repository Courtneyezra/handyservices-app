/**
 * Removes rows created by this session's endpoint smoke tests (the +447700900999 "ping" webhook
 * posts). Ofcom reserves 07700 900xxx for testing, so nothing here belongs to a real customer.
 *
 *   npx tsx scripts/_wa-cleanup-testdata.ts        # report only
 *   npx tsx scripts/_wa-cleanup-testdata.ts --apply
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const TEST_PHONE = '447700900999@c.us';

async function main() {
    const apply = process.argv.includes('--apply');

    const found: any = await db.execute(sql`
        select m.id, m.direction, m.content, m.created_at, m.twilio_sid
        from messages m
        join conversations c on c.id = m.conversation_id
        where c.phone_number = ${TEST_PHONE}
          and (m.twilio_sid = 'SMtest123' or m.id = 'SMtest123' or m.content = 'ping')
        order by m.created_at desc
    `);
    const rows = found.rows ?? found;
    console.log(`Test messages on ${TEST_PHONE}:`);
    console.table(rows);

    if (!apply) {
        console.log('\nDry run. Re-run with --apply to delete.');
        process.exit(0);
    }

    const del: any = await db.execute(sql`
        delete from messages
        where id in (
            select m.id from messages m
            join conversations c on c.id = m.conversation_id
            where c.phone_number = ${TEST_PHONE}
              and (m.twilio_sid = 'SMtest123' or m.id = 'SMtest123' or m.content = 'ping')
        )
        returning id
    `);
    console.log(`Deleted ${(del.rows ?? del).length} test message(s).`);

    // Drop the conversation too, but only if the smoke test was the only thing in it.
    const remaining: any = await db.execute(sql`
        select count(*)::int as n from messages m
        join conversations c on c.id = m.conversation_id
        where c.phone_number = ${TEST_PHONE}
    `);
    const n = (remaining.rows ?? remaining)[0]?.n ?? 0;
    if (n === 0) {
        await db.execute(sql`delete from conversations where phone_number = ${TEST_PHONE}`);
        console.log('Removed the now-empty test conversation.');
    } else {
        console.log(`Kept the conversation — ${n} other message(s) remain on it.`);
    }
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
