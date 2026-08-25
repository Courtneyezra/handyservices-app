/**
 * Dump the financial + line-item picture for a quote, for milestone valuation.
 * Usage: npx tsx scripts/_read-quote-milestone.ts <slug>
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const gbp = (p: any) => (p == null ? '—' : `£${(Number(p) / 100).toFixed(2)}`);

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('Usage: npx tsx scripts/_read-quote-milestone.ts <slug>'); process.exit(1); }

  const res = await db.execute(sql`
    SELECT short_slug, customer_name, address, delivery_status,
           base_price, selected_tier_price_pence, deposit_amount_pence,
           deposit_paid_at, materials_cost_with_markup_pence, batch_discount_percent,
           installment_status, completed_installments, total_installments,
           installment_amount_pence, completed_at, completion_date, selected_at, booked_at,
           pricing_line_items, optional_extras, selected_extras, deferred_line_items, tasks
    FROM personalized_quotes
    WHERE short_slug = ${slug}
    LIMIT 1
  `);
  const r: any = res.rows?.[0];
  if (!r) { console.log(`No quote for slug "${slug}".`); process.exit(0); }

  console.log(`\n=== QUOTE ${r.short_slug} — ${r.customer_name || '(no name)'} ===`);
  console.log(`Address: ${r.address || '—'}`);
  console.log(`delivery_status: ${r.delivery_status || '—'}   Selected: ${r.selected_at || '—'}   Booked: ${r.booked_at || '—'}`);
  console.log(`Completed_at: ${r.completed_at || '—'}   completion_date: ${r.completion_date || '—'}`);
  console.log(`\n--- MONEY ---`);
  console.log(`base_price (canonical)        : ${gbp(r.base_price)}`);
  console.log(`selected_tier_price_pence     : ${gbp(r.selected_tier_price_pence)}  <- agreed total (source of truth)`);
  console.log(`materials_cost_with_markup    : ${gbp(r.materials_cost_with_markup_pence)}`);
  console.log(`batch_discount_percent        : ${r.batch_discount_percent ?? '—'}%`);
  console.log(`deposit_amount_pence          : ${gbp(r.deposit_amount_pence)}`);
  console.log(`deposit_paid_at               : ${r.deposit_paid_at || 'NOT PAID'}`);
  console.log(`installments                  : ${r.completed_installments || 0}/${r.total_installments || 0} @ ${gbp(r.installment_amount_pence)} (status ${r.installment_status || '—'})`);

  const parse = (x: any) => (x == null ? null : (typeof x === 'string' ? JSON.parse(x) : x));
  const li = parse(r.pricing_line_items);
  console.log(`\n--- PRICING LINE ITEMS (${Array.isArray(li) ? li.length : 0}) ---`);
  if (Array.isArray(li)) {
    let sum = 0;
    for (const it of li) {
      const price = it.pricePence ?? it.priceInPence ?? it.total ?? it.pence ?? null;
      if (typeof price === 'number') sum += price;
      const label = it.label || it.description || it.name || it.title || '(no label)';
      const status = it.status ? `  [${it.status}]` : '';
      const cat = it.categorySlug || it.category || '';
      console.log(`  • ${label}  —  ${gbp(price)}${cat ? `  (${cat})` : ''}${status}`);
      if (it.subItems || it.items) {
        for (const s of (it.subItems || it.items)) {
          console.log(`       - ${s.label || s.description || '(sub)'}  ${gbp(s.pricePence ?? s.total ?? null)}`);
        }
      }
    }
    console.log(`  ---- line-item sum: ${gbp(sum)} ----`);
  } else {
    console.log('  (none / not an array)');
    console.log(JSON.stringify(li, null, 2)?.slice(0, 2000));
  }

  const extras = parse(r.optional_extras);
  if (Array.isArray(extras) && extras.length) {
    console.log(`\n--- OPTIONAL EXTRAS ---`);
    for (const e of extras) console.log(`  • ${e.label || e.description}  ${gbp(e.priceInPence ?? e.pricePence)}  ${e.isRecommended ? '(recommended)' : ''}`);
  }
  const selExtras = parse(r.selected_extras);
  if (selExtras) console.log(`\nselected_extras: ${JSON.stringify(selExtras)}`);
  const deferred = parse(r.deferred_line_items);
  if (Array.isArray(deferred) && deferred.length) {
    console.log(`\n--- DEFERRED (saved for later, NOT in paid scope) ---`);
    for (const d of deferred) console.log(`  • ${d.label}  ${gbp(d.pricePence)}`);
  }
  const tasks = parse(r.tasks);
  if (tasks) {
    console.log(`\n--- TASKS (completion tracking) ---`);
    if (Array.isArray(tasks)) {
      for (const t of tasks) console.log(`  • ${t.label || t.description || t.title || JSON.stringify(t).slice(0,80)}  ${t.status ? `[${t.status}]` : ''}  ${t.pricePence ? gbp(t.pricePence) : ''}`);
    } else {
      console.log(JSON.stringify(tasks, null, 2).slice(0, 1500));
    }
  }
  console.log('');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
