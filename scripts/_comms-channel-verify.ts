/**
 * Verifies channel-aware ingest, specifically the rule that matters most:
 *
 *   an inbound SMS must NOT open the WhatsApp 24-hour freeform window.
 *
 * If it did, the inbox would offer Ben a freeform composer that Meta rejects with error 63016.
 *
 * Posts to the live /api/whatsapp/incoming webhook in both Twilio shapes (bare number = SMS,
 * "whatsapp:" prefix = WhatsApp) against an Ofcom test number, then asserts the stored state.
 *
 *   npx tsx scripts/_comms-channel-verify.ts <port>
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const PORT = process.argv[2] || '55190';
const TEST_NUMBER = '447700900555'; // Ofcom drama/test range — never a real subscriber.
const KEY = `${TEST_NUMBER}@c.us`;

async function post(from: string, body: string, sid: string) {
    const res = await fetch(`http://localhost:${PORT}/api/whatsapp/incoming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: from, Body: body, MessageSid: sid, NumMedia: '0' }).toString(),
    });
    return res.status;
}

async function state() {
    const r: any = await db.execute(sql`
        select last_inbound_at, can_send_freeform, last_customer_contact_at
        from conversations where phone_number = ${KEY}
    `);
    return (r.rows ?? r)[0] ?? null;
}

async function channels() {
    const r: any = await db.execute(sql`
        select m.channel, m.direction, m.content
        from messages m join conversations c on c.id = m.conversation_id
        where c.phone_number = ${KEY} order by m.created_at
    `);
    return r.rows ?? r;
}

async function cleanup() {
    await db.execute(sql`
        delete from messages where conversation_id in
        (select id from conversations where phone_number = ${KEY})
    `);
    await db.execute(sql`delete from conversations where phone_number = ${KEY}`);
}

async function main() {
    await cleanup(); // Start from nothing so assertions are unambiguous.
    let failures = 0;
    const check = (label: string, ok: boolean, detail: string) => {
        if (!ok) failures++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
    };

    // --- 1. SMS arrives first ---
    console.log(`\nPOST SMS from +${TEST_NUMBER} (bare number = SMS)`);
    console.log('  http', await post(`+${TEST_NUMBER}`, 'sms hello', `SMchanneltest1`));
    await new Promise((r) => setTimeout(r, 1500));

    let s = await state();
    check('SMS creates the conversation', !!s, JSON.stringify(s));
    check(
        'SMS does NOT open the WhatsApp window',
        !!s && s.last_inbound_at === null && s.can_send_freeform !== true,
        `last_inbound_at=${s?.last_inbound_at} can_send_freeform=${s?.can_send_freeform}`
    );
    check(
        'SMS DOES start the SLA clock',
        !!s?.last_customer_contact_at,
        `last_customer_contact_at=${s?.last_customer_contact_at}`
    );

    // --- 2. WhatsApp arrives on the SAME number ---
    console.log(`\nPOST WhatsApp from whatsapp:+${TEST_NUMBER}`);
    console.log('  http', await post(`whatsapp:+${TEST_NUMBER}`, 'whatsapp hello', `SMchanneltest2`));
    await new Promise((r) => setTimeout(r, 1500));

    s = await state();
    check(
        'WhatsApp DOES open the window',
        !!s?.last_inbound_at && s?.can_send_freeform === true,
        `last_inbound_at=${s?.last_inbound_at} can_send_freeform=${s?.can_send_freeform}`
    );

    const rows = await channels();
    check(
        'both channels share ONE conversation',
        rows.length === 2,
        `${rows.length} message(s) on one thread`
    );
    check(
        'each message is tagged with its own channel',
        rows.some((r: any) => r.channel === 'sms') && rows.some((r: any) => r.channel === 'whatsapp'),
        JSON.stringify(rows.map((r: any) => ({ channel: r.channel, content: r.content })))
    );

    await cleanup();
    console.log(failures === 0 ? '\nAll channel checks passed. Test data removed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
