/**
 * BACK-TEST: run REAL paid jobs through the prototype rate-card.
 * For every line item we compare:
 *   HISTORY (what we actually quoted)  vs  PROTOTYPE (rate-card rails)
 *   - time: timeEstimateMinutes (inflated)   vs  authored time + buffer
 *   - price: guardedPricePence               vs  history-seeded price rail
 * Lines the keyword parser can't classify are flagged "bespoke" (coverage gap).
 *
 * Run: npx tsx scripts/_backtest-ratecard.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { RATE_CARD, parseItem, priceOf, timeMinOf } from './pricing-prototype';

type LineItem = {
  description?: string;
  category?: string;
  timeEstimateMinutes?: number;
  scheduleMinutes?: number;
  guardedPricePence?: number;
};

const r: any = await db.execute(sql`
  SELECT id, customer_name, pricing_line_items, created_at
  FROM personalized_quotes
  WHERE pricing_line_items IS NOT NULL
    AND jsonb_array_length(pricing_line_items) > 0
    AND id NOT LIKE 'test_q_%'
    AND deposit_paid_at IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 10
`);
const quotes = (r.rows ?? r) as { id: string; customer_name: string; pricing_line_items: LineItem[] }[];

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const h = (min: number) => (min / 60).toFixed(1) + 'h';
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

let allLines = 0, matchedLines = 0, measureLines = 0;
let sumHistMin = 0, sumProtoMin = 0;   // matched lines only (apples-to-apples)
let sumHistPence = 0, sumProtoPence = 0;

for (const q of quotes) {
  console.log(`\n══ ${q.customer_name} ════════════════════════════════════════════════════════`);
  console.log(`  ${pad('LINE ITEM', 32)}${pad('→ CLASSIFIED', 20)}${padL('HIST £', 8)}${padL('PROTO £', 9)}${padL('HIST t', 8)}${padL('PROTO t', 9)}`);
  console.log('  ' + '─'.repeat(84));
  let jHistP = 0, jProtoP = 0, jHistM = 0, jProtoM = 0, jBespoke = 0, jMeasure = 0;
  for (const li of q.pricing_line_items) {
    const desc = (li.description ?? '').trim();
    if (!desc) continue;
    allLines++;
    const histP = li.guardedPricePence ?? 0;
    const histM = li.timeEstimateMinutes ?? li.scheduleMinutes ?? 0;
    jHistP += histP; jHistM += histM;
    const { type, qty, qtyExplicit } = parseItem(desc);
    if (!type) {
      jBespoke++;
      console.log(`  ${pad(trunc(desc, 31), 32)}${pad('⚠ bespoke', 20)}${padL('£' + (histP / 100).toFixed(0), 8)}${padL('—', 9)}${padL(h(histM), 8)}${padL('—', 9)}`);
      continue;
    }
    const task = RATE_CARD[type];
    if (task.needsQty && !qtyExplicit) {
      jMeasure++; measureLines++;
      console.log(`  ${pad(trunc(desc, 31), 32)}${pad('→ ' + task.category + ' (measure)', 20)}${padL('£' + (histP / 100).toFixed(0), 8)}${padL('~', 9)}${padL(h(histM), 8)}${padL('~', 9)}`);
      continue;
    }
    matchedLines++;
    const protoP = priceOf(task, qty) * 100;     // £ → pence
    const protoM = timeMinOf(task, qty);
    jProtoP += protoP; jProtoM += protoM;
    sumHistMin += histM; sumProtoMin += protoM;
    sumHistPence += histP; sumProtoPence += protoP;
    console.log(`  ${pad(trunc(desc, 31), 32)}${pad('→ ' + task.category + (qty > 1 ? '×' + qty : ''), 20)}${padL('£' + (histP / 100).toFixed(0), 8)}${padL('£' + (protoP / 100).toFixed(0), 9)}${padL(h(histM), 8)}${padL(h(protoM), 9)}`);
  }
  console.log('  ' + '─'.repeat(84));
  console.log(`  ${pad(`TOTAL (${jBespoke} bespoke · ${jMeasure} measure)`, 52)}${padL('£' + (jHistP / 100).toFixed(0), 8)}${padL(jProtoP ? '£' + (jProtoP / 100).toFixed(0) : '—', 9)}${padL(h(jHistM), 8)}${padL(jProtoM ? h(jProtoM) : '—', 9)}`);
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
console.log(`\n${'═'.repeat(88)}`);
console.log(`COVERAGE: ${matchedLines + measureLines}/${allLines} classified by the ${Object.keys(RATE_CARD).length}-task card (${pct(matchedLines + measureLines, allLines)}%)  ·  ${matchedLines} priced · ${measureLines} need a measure · ${allLines - matchedLines - measureLines} bespoke.`);
console.log(`\nMATCHED LINES ONLY (apples-to-apples):`);
console.log(`  TIME   history ${h(sumHistMin)}  →  prototype ${h(sumProtoMin)}   (${sumHistMin ? (100 - pct(sumProtoMin, sumHistMin)) : 0}% de-inflation)`);
console.log(`  PRICE  history £${(sumHistPence / 100).toFixed(0)}  →  prototype £${(sumProtoPence / 100).toFixed(0)}   (card is ${sumProtoPence >= sumHistPence ? '+' : ''}${pct(sumProtoPence - sumHistPence, sumHistPence)}% vs paid)`);
console.log(`${'═'.repeat(88)}\n`);
process.exit(0);
