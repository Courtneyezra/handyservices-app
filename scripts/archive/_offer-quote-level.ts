import { db } from '../server/db';
import { sql } from 'drizzle-orm';
// Collapse to one row per quote: did they accept / decline the offer, and did they pay?
const r = await db.execute(sql`
  WITH per_quote AS (
    SELECT e.quote_id,
      bool_or(e.event='impression') AS saw,
      bool_or(e.event='accept')     AS accepted,
      bool_or(e.event='decline')    AS declined
    FROM quote_offer_events e GROUP BY 1
  )
  SELECT
    count(*)::int AS quotes_saw_offer,
    count(*) FILTER (WHERE accepted)::int AS accepted,
    count(*) FILTER (WHERE declined AND NOT accepted)::int AS declined_only,
    count(*) FILTER (WHERE NOT accepted AND NOT declined)::int AS no_choice,
    count(*) FILTER (WHERE accepted AND q.deposit_paid_at IS NOT NULL)::int AS accepted_paid,
    count(*) FILTER (WHERE NOT accepted AND q.deposit_paid_at IS NOT NULL)::int AS notaccepted_paid,
    count(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL)::int AS total_paid
  FROM per_quote pq JOIN personalized_quotes q ON q.id = pq.quote_id
  WHERE q.id NOT LIKE 'test\_q\_%'`);
const x = r.rows[0] as any;
console.log('=== OFFER PAGE — per unique quote (person-level) ===');
console.log(`Quotes that saw the offer page:  ${x.quotes_saw_offer}`);
console.log(`  ├─ Accepted the offer:         ${x.accepted}  (${(100*x.accepted/x.quotes_saw_offer).toFixed(0)}%)`);
console.log(`  ├─ Declined (no accept):       ${x.declined_only}  (${(100*x.declined_only/x.quotes_saw_offer).toFixed(0)}%)`);
console.log(`  └─ No explicit choice:         ${x.no_choice}  (${(100*x.no_choice/x.quotes_saw_offer).toFixed(0)}%)`);
console.log(`\n=== Does accepting the offer relate to PAYING? ===`);
console.log(`Accepted offer → PAID:      ${x.accepted_paid} of ${x.accepted}   (${x.accepted?(100*x.accepted_paid/x.accepted).toFixed(0):'-'}%)`);
console.log(`Did NOT accept → PAID:      ${x.notaccepted_paid} of ${x.quotes_saw_offer - x.accepted}   (${(x.quotes_saw_offer-x.accepted)?(100*x.notaccepted_paid/(x.quotes_saw_offer-x.accepted)).toFixed(0):'-'}%)`);
console.log(`\n(No holdout: every quote gets the 'at_home' offer, so this is correlation, not causal effectiveness.)`);
process.exit(0);
