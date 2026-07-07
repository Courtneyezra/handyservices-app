import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const slug = 'r048ep92';
const nowIso = new Date().toISOString();

const [before] = await sql`
  SELECT short_slug, customer_name, base_price, deposit_amount_pence,
         jsonb_array_length(pricing_line_items) AS line_count
  FROM personalized_quotes WHERE short_slug = ${slug}
`;
console.log('BEFORE:', JSON.stringify(before, null, 2));

const newLine = {
  lineId: 'hinges-latch-' + Date.now().toString(36),
  category: 'materials',
  description: 'Supply new hinges and latch',
  guardedPricePence: 3000,
  referencePricePence: 3000,
  llmSuggestedPricePence: 3000,
  materialsWithMarginPence: 0,
  materialsCostPence: 3000,
  timeEstimateMinutes: 0,
  adjustmentFactors: [],
};

const editEntry = {
  editedAt: nowIso,
  editReason: 'Added hinges + latch £30 on day of job (scope grew)',
  changedFields: ['basePrice', 'pricingLineItems'],
};

const [after] = await sql`
  UPDATE personalized_quotes
  SET base_price = 22300,
      pricing_line_items = COALESCE(pricing_line_items, '[]'::jsonb) || ${JSON.stringify([newLine])}::jsonb,
      feedback_json = jsonb_set(
        COALESCE(feedback_json, '{}'::jsonb),
        '{editHistory}',
        COALESCE(feedback_json->'editHistory', '[]'::jsonb) || ${JSON.stringify([editEntry])}::jsonb
      )
  WHERE short_slug = ${slug}
  RETURNING short_slug, customer_name, base_price, deposit_amount_pence,
            (base_price - deposit_amount_pence) AS balance_due_pence,
            jsonb_array_length(pricing_line_items) AS line_count,
            pricing_line_items, feedback_json->'editHistory' AS edit_history
`;

console.log('\nAFTER:');
console.log('  total:', '£' + (after.base_price / 100).toFixed(2));
console.log('  deposit paid:', '£' + (after.deposit_amount_pence / 100).toFixed(2));
console.log('  balance due:', '£' + (after.balance_due_pence / 100).toFixed(2));
console.log('  line count:', after.line_count);
console.log('\nLine items:');
for (const li of after.pricing_line_items) {
  console.log(`  - ${li.description}: £${(li.guardedPricePence / 100).toFixed(2)}`);
}
console.log('\nEdit history:', JSON.stringify(after.edit_history, null, 2));
