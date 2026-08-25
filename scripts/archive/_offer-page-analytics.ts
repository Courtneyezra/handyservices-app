import { db } from '../server/db';
import { sql } from 'drizzle-orm';
// Offer-page funnel: impression → accept / decline. Per template + overall + weekly.
const overall = await db.execute(sql`
  SELECT
    count(DISTINCT quote_id) FILTER (WHERE event='impression')::int AS q_impressions,
    count(*) FILTER (WHERE event='impression')::int AS impressions,
    count(*) FILTER (WHERE event='accept')::int AS accepts,
    count(*) FILTER (WHERE event='decline')::int AS declines
  FROM quote_offer_events`);
const o = overall.rows[0] as any;
const acted = o.accepts + o.declines;
console.log('=== OFFER PAGE — overall (all time) ===');
console.log(`Impressions (offer page shown):  ${o.impressions}  (${o.q_impressions} unique quotes)`);
console.log(`Accepted offer:                  ${o.accepts}`);
console.log(`Declined offer:                  ${o.declines}`);
console.log(`No choice (left/closed):         ${o.impressions - acted}`);
console.log(`>> ACCEPT RATE (of impressions): ${o.impressions? (100*o.accepts/o.impressions).toFixed(1):'-'}%`);
console.log(`>> ACCEPT RATE (of those who chose): ${acted? (100*o.accepts/acted).toFixed(1):'-'}%`);

console.log('\n=== By offer template ===');
const byT = await db.execute(sql`
  SELECT template,
    count(*) FILTER (WHERE event='impression')::int AS imp,
    count(*) FILTER (WHERE event='accept')::int AS acc,
    count(*) FILTER (WHERE event='decline')::int AS dec
  FROM quote_offer_events GROUP BY 1 ORDER BY 2 DESC`);
for(const x of byT.rows as any[]) console.log(`${String(x.template??'—').padEnd(14)} imp ${String(x.imp).padStart(3)}  acc ${String(x.acc).padStart(3)}  dec ${String(x.dec).padStart(3)}  accept% ${x.imp?(100*x.acc/x.imp).toFixed(0):'-'}`);

console.log('\n=== By customer type ===');
const byC = await db.execute(sql`
  SELECT customer_type,
    count(*) FILTER (WHERE event='impression')::int AS imp,
    count(*) FILTER (WHERE event='accept')::int AS acc
  FROM quote_offer_events GROUP BY 1 ORDER BY 2 DESC`);
for(const x of byC.rows as any[]) console.log(`${String(x.customer_type??'—').padEnd(16)} imp ${String(x.imp).padStart(3)}  acc ${String(x.acc).padStart(3)}  accept% ${x.imp?(100*x.acc/x.imp).toFixed(0):'-'}`);

console.log('\n=== Weekly ===');
const wk = await db.execute(sql`
  SELECT to_char(date_trunc('week',created_at),'MM-DD') AS week,
    count(*) FILTER (WHERE event='impression')::int AS imp,
    count(*) FILTER (WHERE event='accept')::int AS acc,
    count(*) FILTER (WHERE event='decline')::int AS dec
  FROM quote_offer_events GROUP BY 1 ORDER BY 1`);
for(const x of wk.rows as any[]) console.log(`${x.week}  imp ${String(x.imp).padStart(3)}  acc ${String(x.acc).padStart(3)}  dec ${String(x.dec).padStart(3)}  accept% ${x.imp?(100*x.acc/x.imp).toFixed(0):'-'}`);
process.exit(0);
