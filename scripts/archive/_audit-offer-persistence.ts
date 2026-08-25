import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
async function main() {
  const slugs = ['i0ouwf5p', 'ok4uyor3', '83d63ax0', '9e3m7e3j', 'wb4mekl3', 'kan940fn', 'paauq4bm'];
  const events = await db.execute(sql.raw(
    `SELECT short_slug, event, offer_id, template, customer_type, created_at::time AS at FROM quote_offer_events WHERE short_slug IN (${slugs.map(s => `'${s}'`).join(',')}) ORDER BY created_at`
  ));
  console.log('── quote_offer_events ──');
  for (const r of events.rows as any[]) console.log(r.short_slug, '|', r.event, '|', r.offer_id, '|', r.template, '|', r.customer_type, '|', r.at);
  const decisions = await db.execute(sql.raw(
    `SELECT slug, rule_fired, served_play, decided_by, shadow_play FROM quote_offer_decisions WHERE slug IN (${slugs.map(s => `'${s}'`).join(',')}) ORDER BY decided_at`
  ));
  console.log('── quote_offer_decisions ──');
  for (const r of decisions.rows as any[]) console.log(r.slug, '|', r.rule_fired, '→', r.served_play, '| by:', r.decided_by, '| shadow:', r.shadow_play);
  const gifts = await db.execute(sql.raw(
    `SELECT short_slug, deposit_paid_at IS NOT NULL AS paid,
      (SELECT count(*) FROM jsonb_array_elements(COALESCE(pricing_line_items, '[]'::jsonb)) e WHERE e->>'source' IN ('welcome_gift','welcome_gift_offset','addon_menu')) AS offer_lines
     FROM personalized_quotes WHERE short_slug IN (${slugs.map(s => `'${s}'`).join(',')})`
  ));
  console.log('── persisted offer/addon line items (post-payment only by design) ──');
  for (const r of gifts.rows as any[]) console.log(r.short_slug, '| paid:', r.paid, '| offer lines on quote:', r.offer_lines);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
