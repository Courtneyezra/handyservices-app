/**
 * REAL two-week P&L — only jobs in Craig's app schedule (contractor_booking_requests,
 * scheduled 29 Jul–12 Aug). Revenue from each linked quote's line items; contractor
 * cost = ACTUAL snapshotted payouts in booking_assignments (all assignments on the job).
 * Handy gross = revenue − materials cost − contractor payout. Still PAPER on delivery
 * quality (rework/replacements not captured).
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const gbp = (p: number) => '£' + (Math.round(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function econ(li: any) {
  const items = Array.isArray(li) ? li : (li?.items && Array.isArray(li.items) ? li.items : []);
  let labour = 0, matCost = 0, matSell = 0;
  for (const it of items) { labour += it.guardedPricePence || 0; matCost += it.materialsCostPence || 0; matSell += it.materialsWithMarginPence || 0; }
  return { labour, matCost, matSell, revenue: labour + matSell, hasItems: items.length > 0 };
}

async function main() {
  // Craig's scheduled jobs in the two-week window
  const jobs = await db.execute(sql`
    SELECT cbr.id AS booking_id, cbr.customer_name, cbr.scheduled_date, cbr.status, cbr.quote_id,
           q.pricing_line_items, q.base_price, q.selected_tier_price_pence, q.customer_name AS q_name,
           (SELECT coalesce(sum(ba.payout_pence),0) FROM booking_assignments ba WHERE ba.booking_id = cbr.id) AS contractor_payout,
           (SELECT count(*) FROM booking_assignments ba WHERE ba.booking_id = cbr.id) AS n_assignments
    FROM contractor_booking_requests cbr
    LEFT JOIN personalized_quotes q ON q.id = cbr.quote_id
    WHERE (cbr.contractor_id = ${CRAIG} OR cbr.assigned_contractor_id = ${CRAIG})
      AND cbr.scheduled_date >= '2026-07-29' AND cbr.scheduled_date < '2026-08-13'
    ORDER BY cbr.scheduled_date
  `);

  let T = { revenue: 0, matCost: 0, matSell: 0, labour: 0, payout: 0, gross: 0 };
  let noQuote = 0;
  console.log('date        customer            revenue   matCost   Craig/contractor  HandyGross   note');
  for (const j of jobs.rows as any[]) {
    const e = econ(j.pricing_line_items);
    const payout = Number(j.contractor_payout || 0);
    const rev = e.hasItems ? e.revenue : Number(j.selected_tier_price_pence || j.base_price || 0);
    const gross = rev - e.matCost - payout;
    if (!j.quote_id) noQuote++;
    T.revenue += rev; T.matCost += e.matCost; T.matSell += e.matSell; T.labour += e.labour; T.payout += payout; T.gross += gross;
    const note = !j.quote_id ? 'NO QUOTE LINK' : (!e.hasItems ? 'no line items (tier px)' : (Number(j.n_assignments) > 1 ? `${j.n_assignments} contractors` : ''));
    console.log(
      String(j.scheduled_date).slice(0, 10) + '  ' +
      String(j.customer_name || j.q_name || '?').slice(0, 18).padEnd(20) +
      gbp(rev).padEnd(10) + gbp(e.matCost).padEnd(10) + gbp(payout).padEnd(18) + gbp(gross).padEnd(13) + note
    );
  }
  const n = (jobs.rows as any[]).length;
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`Jobs in Craig's 2-week schedule : ${n}   (${noQuote} with no quote link)`);
  console.log(`Revenue (labour + materials)    : ${gbp(T.revenue)}`);
  console.log(`  ├ labour                       : ${gbp(T.labour)}`);
  console.log(`  └ materials (sell)             : ${gbp(T.matSell)}`);
  console.log(`− Materials at cost             : ${gbp(T.matCost)}`);
  console.log(`− Contractor payout (actual)    : ${gbp(T.payout)}   (${T.labour ? Math.round(100 * T.payout / T.labour) : 0}% of labour)`);
  console.log(`──────────────────────────────────────────────────────────────`);
  console.log(`= HANDY GROSS (before Ben+overhead): ${gbp(T.gross)}   (${T.revenue ? Math.round(100 * T.gross / T.revenue) : 0}% of revenue)`);
  console.log(`  Avg Handy gross / job          : ${gbp(n ? T.gross / n : 0)}`);
  console.log(`\nPer-week: revenue ${gbp(T.revenue / 2)}  |  Handy gross ${gbp(T.gross / 2)}  (before Ben + overhead)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
