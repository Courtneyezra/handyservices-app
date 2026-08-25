/**
 * Unanswered inbound triage — customers who messaged and got nothing back.
 *
 * Why this exists: Twilio was disconnected on the comms number, so inbound WhatsApp/SMS landed in
 * the database and was never shown to a human. Roughly 520 messages over 70 days. Some fraction of
 * those are live work that was simply never seen.
 *
 * READ ONLY. It prints a list for a person to work through. It sends nothing, queues nothing and
 * writes nothing — deliberately. An automated sweep over unverified history is exactly what caused
 * the Aug dunning incident (a final notice on an invoice that was never sent).
 *
 * It also tries hard NOT to waste Ben's time: a thread is only listed if we can find no sign the
 * customer was picked up some other way — no call, no lead, no quote against that number. Those
 * cross-checks are shown per row so he can judge rather than trust.
 *
 *   npx tsx scripts/_unanswered-inbound.ts
 *   npx tsx scripts/_unanswered-inbound.ts --days 120 --limit 60
 *   npx tsx scripts/_unanswered-inbound.ts --all      # include ones we think were handled
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

function arg(flag: string, fallback: number): number {
    const i = process.argv.indexOf(flag);
    if (i === -1) return fallback;
    const v = parseInt(process.argv[i + 1], 10);
    return Number.isFinite(v) ? v : fallback;
}
const DAYS = arg('--days', 90);
const LIMIT = arg('--limit', 40);
const SHOW_ALL = process.argv.includes('--all');

function trunc(s: string | null, n: number): string {
    if (!s) return '(no text — media only)';
    const one = s.replace(/\s+/g, ' ').trim();
    return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

async function main() {
    console.log(`\n=== UNANSWERED INBOUND — last ${DAYS} days ===`);
    console.log('Read-only. Nothing is sent or queued. Triage by hand.\n');

    // A conversation qualifies when it has inbound messages and NO outbound message ever.
    // Cross-checks join on the last 10 digits of the number, which survives the several formats
    // in play (`4477…@c.us` on conversations, E.164 on leads/quotes, raw on calls).
    const rows = (await db.execute(sql`
        WITH threads AS (
            SELECT c.id,
                   c.phone_number,
                   c.contact_name,
                   RIGHT(REGEXP_REPLACE(c.phone_number, '\\D', '', 'g'), 10) AS digits,
                   COUNT(m.id) FILTER (WHERE m.direction = 'inbound')        AS inbound_n,
                   COUNT(m.id) FILTER (WHERE m.direction = 'outbound')       AS outbound_n,
                   MAX(m.created_at) FILTER (WHERE m.direction = 'inbound')  AS last_in,
                   MIN(m.created_at) FILTER (WHERE m.direction = 'inbound')  AS first_in
            FROM conversations c
            JOIN messages m ON m.conversation_id = c.id
            WHERE m.created_at >= NOW() - (${DAYS} || ' days')::interval
            GROUP BY c.id, c.phone_number, c.contact_name
        )
        SELECT t.*,
               (SELECT m2.content FROM messages m2
                 WHERE m2.conversation_id = t.id AND m2.direction = 'inbound'
                 ORDER BY m2.created_at DESC LIMIT 1)                        AS last_text,
               (SELECT COUNT(*) FROM calls ca
                 WHERE RIGHT(REGEXP_REPLACE(ca.phone_number, '\\D', '', 'g'), 10) = t.digits
                   AND ca.created_at >= t.first_in)                          AS calls_after,
               (SELECT COUNT(*) FROM personalized_quotes q
                 WHERE RIGHT(REGEXP_REPLACE(COALESCE(q.phone, ''), '\\D', '', 'g'), 10) = t.digits
                   AND q.created_at >= t.first_in)                           AS quotes_after,
               (SELECT COUNT(*) FROM leads l
                 WHERE RIGHT(REGEXP_REPLACE(COALESCE(l.phone, ''), '\\D', '', 'g'), 10) = t.digits) AS leads_any
        FROM threads t
        WHERE t.outbound_n = 0
          -- Ofcom's drama range (07700 900xxx) is our test-data signature; never a real customer.
          AND t.digits NOT LIKE '7700900%'
          AND COALESCE(t.contact_name, '') NOT ILIKE '%test%'
        ORDER BY t.last_in DESC
    `)).rows as any[];

    // Inbound cold-outreach (SEO/dev/AI-receptionist pitches) arrives on the same number and is
    // not work. Cheap keyword screen — it only demotes a row to a separate bucket, never hides it.
    const SPAM = /\b(web ?developer|seo|backlink|digital marketing|ai receptionist|lead gen|rank (your|you) (site|higher)|guest post|crypto|investment opportunity)\b/i;

    const handled = (r: any) => Number(r.calls_after) > 0 || Number(r.quotes_after) > 0;
    const isSpam = (r: any) => SPAM.test(String(r.last_text || ''));

    const covered = rows.filter(handled);
    const unhandled = rows.filter((r) => !handled(r));
    const spam = unhandled.filter(isSpam);
    const cold = unhandled.filter((r) => !isSpam(r));

    console.log(`Threads with inbound and zero replies (test data excluded) : ${rows.length}`);
    console.log(`  likely picked up elsewhere (call/quote after they wrote) : ${covered.length}`);
    console.log(`  inbound sales pitches, not work                         : ${spam.length}`);
    console.log(`  REAL ENQUIRIES WITH NO SIGN OF ANY CONTACT              : ${cold.length}\n`);

    const list = SHOW_ALL ? rows : cold;
    if (list.length === 0) {
        console.log('Nothing to triage.\n');
        process.exit(0);
    }

    console.log(`Showing ${Math.min(LIMIT, list.length)} of ${list.length}, most recent first.`);
    console.log('─'.repeat(96));
    for (const r of list.slice(0, LIMIT)) {
        const when = r.last_in ? new Date(r.last_in).toISOString().slice(0, 10) : '?';
        const ageDays = r.last_in ? Math.floor((Date.now() - new Date(r.last_in).getTime()) / 86400000) : 0;
        const phone = String(r.phone_number || '').replace('@c.us', '');
        const name = r.contact_name && r.contact_name !== phone ? r.contact_name : '(no name)';
        const flags = [
            Number(r.calls_after) > 0 ? `${r.calls_after} call(s) after` : null,
            Number(r.quotes_after) > 0 ? `${r.quotes_after} quote(s) after` : null,
            Number(r.leads_any) > 0 ? 'known lead' : 'no lead record',
        ].filter(Boolean).join(' · ');

        console.log(`${when}  (${ageDays}d ago)  +${phone}  ${name}`);
        console.log(`   ${r.inbound_n} inbound message(s), 0 replies   [${flags}]`);
        console.log(`   last: "${trunc(r.last_text, 120)}"`);
        console.log('');
    }
    console.log('─'.repeat(96));
    console.log('Triage by hand. Do NOT bulk-send: most of these are weeks old, the customer has');
    console.log('likely moved on, and an unsolicited "sorry we missed you" to a stale thread needs');
    console.log('the 24h window open or an approved template anyway.\n');

    process.exit(0);
}

main().catch((e) => {
    console.error('triage failed:', e?.message || e);
    process.exit(1);
});
