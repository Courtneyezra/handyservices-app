import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { isFirstTimeCustomer, isWelcomeGiftEligible } from '../server/welcome-gift';

async function main() {
  const q = await db.execute(sql.raw(
    "SELECT id, short_slug AS slug, customer_name, phone, email, base_price, essential_price, pricing_line_items, deposit_paid_at, viewed_at, created_at FROM personalized_quotes WHERE short_slug = 'ml8cyy2z'"
  ));
  const quote = (q.rows as any[])[0];
  if (!quote) { console.log('quote not found'); process.exit(0); }
  console.log('QUOTE:', quote.slug, '|', quote.customer_name, '| phone:', quote.phone, '| email:', quote.email);
  console.log('  base_price:', quote.base_price, '| created:', quote.created_at, '| viewed:', quote.viewed_at, '| deposit_paid:', quote.deposit_paid_at);

  const shape = {
    id: quote.id, phone: quote.phone, email: quote.email,
    basePrice: quote.base_price, essentialPrice: quote.essential_price,
    pricingLineItems: quote.pricing_line_items,
  };
  console.log('firstTime (server logic):', await isFirstTimeCustomer(shape));
  console.log('welcomeGiftEligible (server logic):', await isWelcomeGiftEligible(shape));

  const identity: string[] = [];
  if (quote.phone) identity.push(`phone = '${String(quote.phone).replace(/'/g, "''")}'`);
  if (quote.email) identity.push(`email = '${String(quote.email).replace(/'/g, "''")}'`);
  if (identity.length) {
    const hist = await db.execute(sql.raw(
      `SELECT short_slug AS slug, customer_name, base_price, deposit_paid_at, created_at FROM personalized_quotes WHERE (${identity.join(' OR ')}) AND id != '${quote.id}' ORDER BY created_at DESC LIMIT 15`
    ));
    console.log('\nOTHER QUOTES same phone/email:');
    for (const r of hist.rows as any[]) {
      console.log(' ', r.slug, '|', r.customer_name, '| £' + ((r.base_price || 0) / 100).toFixed(0), '| created', r.created_at?.toISOString?.()?.slice(0, 10) ?? r.created_at, '| deposit_paid:', r.deposit_paid_at ?? '—');
    }
  }

  const dec = await db.execute(sql.raw(
    "SELECT rule_fired, target_play, served_play, inputs, decided_at FROM quote_offer_decisions WHERE slug = 'ml8cyy2z' ORDER BY decided_at DESC"
  ));
  console.log('\nOFFER DECISIONS logged:', dec.rows.length);
  for (const r of dec.rows as any[]) console.log(' ', r.decided_at, r.rule_fired, r.target_play, '→', r.served_play, JSON.stringify(r.inputs));

  const gift = await db.execute(sql.raw(
    `SELECT jsonb_array_elements(pricing_line_items) AS li FROM personalized_quotes WHERE short_slug = 'ml8cyy2z'`
  ));
  const giftLines = (gift.rows as any[]).map(r => r.li).filter((li: any) => String(li?.source || '').startsWith('welcome_gift'));
  console.log('\nwelcome_gift lines on quote:', giftLines.length ? JSON.stringify(giftLines) : 'none');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
