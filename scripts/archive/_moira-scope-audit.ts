import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);
  if (!q) { console.log('not found'); process.exit(1); }

  // Show every column so we can spot any edit/removal tracking fields.
  const keys = Object.keys(q).sort();
  console.log('=== ALL COLUMNS (non-null / interesting) ===');
  for (const k of keys) {
    const v = (q as any)[k];
    if (v == null) continue;
    if (Array.isArray(v)) { console.log(`${k}: [array len ${v.length}]`); continue; }
    if (typeof v === 'object') { console.log(`${k}: {object}`); continue; }
    const s = String(v);
    console.log(`${k}: ${s.length > 100 ? s.slice(0,100)+'…' : s}`);
  }

  console.log('\n=== pricingLineItems ===');
  const items = (q.pricingLineItems as any[]) || [];
  let sum = 0;
  for (const it of items) {
    const price = it.pricePence ?? it.customerPricePence ?? 0;
    sum += price;
    console.log(`  [${it.status ?? '—'}] ${(it.description || it.label || '?').slice(0,60)} — £${(price/100).toFixed(2)}  deselected=${it.deselected ?? it.removed ?? it.deferred ?? '—'}  included=${it.included ?? '—'}`);
  }
  console.log(`  Σ line items = £${(sum/100).toFixed(2)}`);
  console.log(`  basePrice    = £${((q.basePrice||0)/100).toFixed(2)}`);
  console.log(`  depositPaid  = £${(((q as any).depositAmount ?? 0)/100).toFixed(2)}  at ${q.depositPaidAt}`);

  // Look for split / deferral / selection fields anywhere
  console.log('\n=== possible scope-change fields ===');
  for (const k of keys) {
    if (/defer|remove|deselect|select|split|scope|excluded|included|edit|amend|revis|original/i.test(k)) {
      console.log(`  ${k} =`, JSON.stringify((q as any)[k]));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
