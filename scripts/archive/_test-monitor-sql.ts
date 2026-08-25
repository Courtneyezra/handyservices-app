import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const scrub = `q.phone NOT LIKE '%7700900%' AND q.customer_name NOT ILIKE 'test%'`;
  const since = `now() - interval '30 days'`;
  const mix = await db.execute(sql.raw(`
    SELECT d.served_play, COUNT(*)::int AS decisions,
           COUNT(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL)::int AS paid,
           COUNT(*) FILTER (WHERE q.viewed_at IS NOT NULL OR q.view_count > 0)::int AS viewed
    FROM quote_offer_decisions d JOIN personalized_quotes q ON q.id = d.quote_id
    WHERE d.decided_at >= ${since} AND ${scrub}
    GROUP BY d.served_play ORDER BY decisions DESC`));
  console.log('playMix (real customers):', JSON.stringify(mix.rows));
  const unmet = await db.execute(sql.raw(`
    SELECT d.target_play, COUNT(*)::int AS wanted, COALESCE(SUM((d.inputs->>'totalPence')::bigint),0)::bigint AS total_pence
    FROM quote_offer_decisions d JOIN personalized_quotes q ON q.id = d.quote_id
    WHERE d.decided_at >= ${since} AND d.target_play <> d.served_play AND ${scrub}
    GROUP BY d.target_play ORDER BY wanted DESC`));
  console.log('unmetIntent:', JSON.stringify(unmet.rows));
  const gifts = await db.execute(sql.raw(`
    SELECT e.gift_id, COUNT(*)::int AS accepts FROM quote_offer_events e
    JOIN personalized_quotes q ON q.id = e.quote_id
    WHERE e.created_at >= ${since} AND e.event = 'accept' AND e.gift_id IS NOT NULL AND ${scrub}
    GROUP BY e.gift_id ORDER BY accepts DESC`));
  console.log('giftPicks:', JSON.stringify(gifts.rows));
  process.exit(0);
}
main().catch((e) => { console.error('SQL FAILED:', e.message); process.exit(1); });
