import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function q(label: string, s: any) { const r: any = await db.execute(s); console.log(`\n== ${label}`); console.table(r.rows); return r.rows; }
async function main() {
  await q('boundary check: any no-sid outbound on/after 2026-08-15?', sql`
    SELECT count(*) n, max(created_at) latest FROM messages WHERE direction='outbound' AND twilio_sid IS NULL AND created_at >= '2026-08-15'`);
  await q('real-sid rows: earliest', sql`
    SELECT count(*) n, min(created_at) earliest, max(created_at) latest FROM messages WHERE direction='outbound' AND twilio_sid IS NOT NULL`);
  await q('candidate set partition', sql`
    SELECT CASE
      WHEN conversation_id LIKE 'tenant\\_%' THEN 'tenant_sandbox'
      WHEN created_at < '2026-04-01' THEN 'runaway_loop'
      ELSE 'dead_sender' END reason,
      count(*) n, count(DISTINCT conversation_id) convs, min(created_at) f, max(created_at) l
    FROM messages WHERE direction='outbound' AND twilio_sid IS NULL AND created_at < '2026-08-15'
    GROUP BY 1 ORDER BY n DESC`);
  await q('dead_sender rows: did customer reply within 7d after? (evidence of delivery)', sql`
    WITH d AS (SELECT id, conversation_id, created_at FROM messages
      WHERE direction='outbound' AND twilio_sid IS NULL AND created_at >= '2026-04-01' AND created_at < '2026-08-15'
        AND conversation_id NOT LIKE 'tenant\\_%')
    SELECT count(*) total,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages i WHERE i.conversation_id=d.conversation_id AND i.direction='inbound' AND i.created_at > d.created_at AND i.created_at < d.created_at + interval '7 days')) replied_within_7d
    FROM d`);
  await q('BEFORE: board wait state over live (non-archived) convs', sql`
    WITH a AS (
      SELECT c.id,
        max(m.created_at) FILTER (WHERE m.direction='inbound') li,
        max(m.created_at) FILTER (WHERE m.direction='outbound') lo
      FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id
      WHERE c.status IS DISTINCT FROM 'archived' GROUP BY c.id)
    SELECT count(*) convs,
      count(*) FILTER (WHERE li IS NOT NULL) with_inbound,
      count(*) FILTER (WHERE li IS NOT NULL AND (lo IS NULL OR lo < li)) awaiting_reply,
      count(*) FILTER (WHERE li IS NOT NULL AND lo IS NOT NULL AND lo >= li) answered
    FROM a`);
  await q('AFTER: same, ignoring quarantine candidates', sql`
    WITH a AS (
      SELECT c.id,
        max(m.created_at) FILTER (WHERE m.direction='inbound') li,
        max(m.created_at) FILTER (WHERE m.direction='outbound'
          AND NOT (m.twilio_sid IS NULL AND m.created_at < '2026-08-15')) lo
      FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id
      WHERE c.status IS DISTINCT FROM 'archived' GROUP BY c.id)
    SELECT count(*) convs,
      count(*) FILTER (WHERE li IS NOT NULL) with_inbound,
      count(*) FILTER (WHERE li IS NOT NULL AND (lo IS NULL OR lo < li)) awaiting_reply,
      count(*) FILTER (WHERE li IS NOT NULL AND lo IS NOT NULL AND lo >= li) answered
    FROM a`);
  await q('AFTER (loop only, ie Feb-Mar): awaiting', sql`
    WITH a AS (
      SELECT c.id,
        max(m.created_at) FILTER (WHERE m.direction='inbound') li,
        max(m.created_at) FILTER (WHERE m.direction='outbound'
          AND NOT (m.twilio_sid IS NULL AND m.created_at < '2026-04-01')) lo
      FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id
      WHERE c.status IS DISTINCT FROM 'archived' GROUP BY c.id)
    SELECT count(*) FILTER (WHERE li IS NOT NULL AND (lo IS NULL OR lo < li)) awaiting_reply FROM a`);
  await q('flip list: convs that go answered -> awaiting (full scope)', sql`
    WITH a AS (
      SELECT c.id, c.phone_number, c.contact_name, c.status, c.archived_at,
        max(m.created_at) FILTER (WHERE m.direction='inbound') li,
        max(m.created_at) FILTER (WHERE m.direction='outbound') lo_old,
        max(m.created_at) FILTER (WHERE m.direction='outbound' AND NOT (m.twilio_sid IS NULL AND m.created_at < '2026-08-15')) lo_new
      FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id GROUP BY 1,2,3,4,5)
    SELECT count(*) all_convs_flipping, count(*) FILTER (WHERE archived_at IS NULL) live_flipping
    FROM a WHERE li IS NOT NULL AND lo_old >= li AND (lo_new IS NULL OR lo_new < li)`);
  await q('first-contact impact: convs that had ONLY phantom outbound', sql`
    SELECT count(*) FROM (
      SELECT c.id FROM conversations c JOIN messages m ON m.conversation_id=c.id
      WHERE m.direction='outbound' GROUP BY c.id
      HAVING count(*) FILTER (WHERE NOT (m.twilio_sid IS NULL AND m.created_at < '2026-08-15')) = 0) t`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
