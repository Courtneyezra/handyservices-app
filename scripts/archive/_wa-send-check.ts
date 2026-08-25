/**
 * Sends one WhatsApp message through the app's real sendWhatsAppMessage() path and reports what
 * was stored, to verify: canonical sender resolution, twilioSid persistence, and Twilio's accepted
 * status. Target defaults to the operator's own number.
 *
 *   npx tsx scripts/_wa-send-check.ts [+E164] ["body"]
 */
import { sendWhatsAppMessage } from '../server/meta-whatsapp';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const to = process.argv[2] || '+84357691573';
const body = process.argv[3] || 'Platform check: sent via the app send path.';

async function main() {
    console.log(`Sending to ${to} ...`);
    const result: any = await sendWhatsAppMessage(to, body);
    console.log('twilio sid   :', result?.sid);
    console.log('twilio status:', result?.status);
    console.log('twilio error :', result?.error_code ?? result?.errorCode ?? 'none');

    const rows: any = await db.execute(sql`
        select id, twilio_sid, direction, status, type, left(coalesce(content,''), 40) as content
        from messages
        where twilio_sid = ${result?.sid} or id = ${result?.sid}
    `);
    console.log('\nstored row(s):');
    console.table(rows.rows ?? rows);
    process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
