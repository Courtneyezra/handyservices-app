/**
 * END-TO-END SYSTEM TEST on the last 20 real generated quotes.
 * For every line: classify via the live matcher (enriched keywords) → catalog price +
 * DE-INFLATED time, compared to what was ORIGINALLY quoted. Reports coverage, price
 * fidelity, and time de-inflation. Read-only.
 *   npx tsx scripts/_backtest-last20.ts
 */
import { db } from '../server/db';
import { sql, inArray } from 'drizzle-orm';
import { matchLineToSku } from '../server/contextual-pricing/sku-matcher';
import { serviceCatalog } from '../shared/schema';

type LI = { description?: string; category?: string; guardedPricePence?: number; timeEstimateMinutes?: number; scheduleMinutes?: number; unitCount?: number };

const r: any = await db.execute(sql`
  SELECT id, customer_name AS name, pricing_line_items AS lines
  FROM personalized_quotes
  WHERE pricing_line_items IS NOT NULL AND jsonb_array_length(pricing_line_items) > 0
    AND id NOT LIKE 'test_q_%'
  ORDER BY created_at DESC LIMIT 20`);
const quotes = (r.rows ?? r) as { id: string; name: string; lines: LI[] }[];

const cat = await db.select().from(serviceCatalog);
const byCode = new Map(cat.map((c) => [c.skuCode, c]));

function catalogPriceTime(row: any, qty: number) {
  if (row.shape === 'fixed') return { pence: row.pricePence ?? 0, mins: row.scheduleMinutes ?? 0 };
  if (row.shape === 'per_unit') {
    const u = Math.max(qty, row.minimumUnits ?? 1);
    const perUnit = row.actualMinutesPerUnit ?? row.minutesPerUnit ?? 0; // prefer learned actuals
    return { pence: (row.pricePerUnitPence ?? 0) * u, mins: (row.setupMinutes ?? 0) + perUnit * u };
  }
  const t = (row.tiers ?? [])[Math.floor((row.tiers?.length ?? 1) / 2)] ?? { pricePence: 0, scheduleMinutes: 0 };
  return { pence: t.pricePence ?? 0, mins: t.scheduleMinutes ?? 0 };
}
const qtyOf = (li: LI) => li.unitCount ?? (parseInt((li.description ?? '').match(/(\d+)/)?.[1] ?? '1', 10) || 1);

const pad = (s: any, n: number) => String(s).padEnd(n);
const padL = (s: any, n: number) => String(s).padStart(n);
const h = (m: number) => (m / 60).toFixed(1) + 'h';

let allLines = 0, matched = 0;
let mHistP = 0, mCatP = 0, mHistM = 0, mCatM = 0; // matched-only, apples-to-apples

console.log(`\nLAST 20 REAL QUOTES — system back-test (enriched matcher + corrected catalog)\n`);
console.log(`  ${pad('CUSTOMER', 16)}${padL('LINES', 6)}${padL('MATCH', 6)}${padL('HIST £', 9)}${padL('CAT £', 8)}${padL('HIST t', 8)}${padL('CAT t', 8)}`);
console.log('  ' + '─'.repeat(63));

for (const q of quotes) {
  let n = 0, m = 0, hp = 0, cp = 0, hm = 0, cm = 0;
  for (const li of q.lines) {
    const desc = (li.description ?? '').trim();
    if (!desc) continue;
    n++; allLines++;
    const histP = li.guardedPricePence ?? 0;
    const histM = li.timeEstimateMinutes ?? li.scheduleMinutes ?? 0;
    hp += histP; hm += histM;
    const hit = await matchLineToSku({ description: desc, category: li.category });
    if (!hit || !byCode.has(hit.skuCode)) continue;
    m++; matched++;
    const { pence, mins } = catalogPriceTime(byCode.get(hit.skuCode), qtyOf(li));
    cp += pence; cm += mins;
    mHistP += histP; mCatP += pence; mHistM += histM; mCatM += mins;
  }
  console.log(`  ${pad((q.name || '—').slice(0, 15), 16)}${padL(n, 6)}${padL(m, 6)}${padL('£' + (hp / 100).toFixed(0), 9)}${padL('£' + (cp / 100).toFixed(0), 8)}${padL(h(hm), 8)}${padL(h(cm), 8)}`);
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
console.log('  ' + '─'.repeat(63));
console.log(`\n${'═'.repeat(72)}`);
console.log(`COVERAGE:  ${matched}/${allLines} lines auto-matched to a catalog SKU  (${pct(matched, allLines)}%)`);
console.log(`\nMATCHED LINES (apples-to-apples vs what was originally quoted):`);
console.log(`  PRICE   history £${(mHistP / 100).toFixed(0)}  →  catalog £${(mCatP / 100).toFixed(0)}   (catalog ${mCatP >= mHistP ? '+' : ''}${pct(mCatP - mHistP, mHistP)}% vs quoted)`);
console.log(`  TIME    history ${h(mHistM)}  →  catalog ${h(mCatM)}   (${mHistM ? (100 - pct(mCatM, mHistM)) : 0}% de-inflation for dispatch)`);
console.log(`${'═'.repeat(72)}\n`);
process.exit(0);
