import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// Cheap LIVE-payment test fixture: clone the working single-trade contextual
// fixture (guarprev — staffable pool, guarantee shows) and shrink the money so
// a real Apple/Google Pay test costs ~£7, refundable from the Stripe dashboard.
// Two line items so the split "×" renders too. Email left NULL on purpose —
// exercises the wallet-collects-email path (emailRequired: !customerEmail).
// Test-data signatures kept (test_q_* id, 07700 900xxx phone) for analytics scrub.
async function main() {
  const src = await db.execute(sql`SELECT * FROM personalized_quotes WHERE short_slug='guarprev' LIMIT 1`);
  if (!src.rows.length) { console.error('guarprev fixture not found'); process.exit(1); }
  const q: any = src.rows[0];

  const lineItems = [
    {
      ...(q.pricing_line_items?.[0] ?? {}),
      lineId: 'paytst01',
      skuName: 'Adjust sticking door',
      description: 'Adjust sticking door',
      customerDescription: 'Ease and adjust one internal door that catches on the frame',
      category: 'general_fixing',
      guardedPricePence: 800,
      materialsWithMarginPence: 200,
      structuralSharePence: 0,
      timeEstimateMinutes: 30,
    },
    {
      ...(q.pricing_line_items?.[0] ?? {}),
      lineId: 'paytst02',
      skuName: 'Re-seal bathroom tap',
      description: 'Re-seal bathroom tap',
      customerDescription: 'Re-seat and seal one dripping bathroom tap',
      category: 'general_fixing',
      guardedPricePence: 1000,
      materialsWithMarginPence: 0,
      structuralSharePence: 0,
      timeEstimateMinutes: 30,
    },
  ];

  await db.execute(sql`DELETE FROM personalized_quotes WHERE id = 'test_q_paytest'`);
  await db.execute(sql`
    INSERT INTO personalized_quotes (
      id, short_slug, customer_name, phone, email, postcode, address, coordinates,
      segment, quote_mode, job_description, base_price, materials_cost_with_markup_pence,
      batch_discount_percent, pricing_line_items, context_signals, value_bullets,
      layout_tier, booking_modes, optional_extras, customer_photo_urls,
      created_at, expires_at, view_count
    ) VALUES (
      'test_q_paytest', 'paytest1', 'Test Pay', '07700900321', NULL,
      ${q.postcode}, NULL, ${JSON.stringify(q.coordinates)}::jsonb,
      ${q.segment}, ${q.quote_mode}, 'Live checkout test — sticking door + dripping tap',
      1800, 200, 10,
      ${JSON.stringify(lineItems)}::jsonb,
      ${JSON.stringify(q.context_signals)}::jsonb,
      ${JSON.stringify(q.value_bullets)}::jsonb,
      ${q.layout_tier}, ${JSON.stringify(q.booking_modes)}::jsonb,
      ${JSON.stringify(q.optional_extras ?? [])}::jsonb,
      ${JSON.stringify(q.customer_photo_urls ?? [])}::jsonb,
      NOW(), NOW() + INTERVAL '30 days', 0
    )
  `);
  const check = await db.execute(sql`SELECT id, short_slug, base_price, materials_cost_with_markup_pence FROM personalized_quotes WHERE short_slug='paytest1'`);
  console.log('created:', JSON.stringify(check.rows[0]));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
