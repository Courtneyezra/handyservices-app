import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const rows = await sql`
  SELECT pricing_line_items, pricing_layer_breakdown
  FROM personalized_quotes WHERE short_slug = 'xl76reu5'
`;

const live = rows[0].pricing_line_items || [];
const snapshot = rows[0].pricing_layer_breakdown?.lineItems || [];

console.log('=== LIVE pricingLineItems (' + live.length + ' lines) ===');
for (const li of live) {
  const hasDetails = li.details && li.details.trim().length > 0;
  console.log(`  [${hasDetails ? 'D' : ' '}] ${li.lineId} :: ${li.description}`);
  if (li.details) console.log(`        ${li.details.slice(0, 100)}${li.details.length > 100 ? '...' : ''}`);
}

console.log('\n=== SNAPSHOT pricingLayerBreakdown.lineItems (' + snapshot.length + ' lines) ===');
for (const li of snapshot) {
  const hasDetails = li.details && li.details.trim().length > 0;
  console.log(`  [${hasDetails ? 'D' : ' '}] ${li.lineId} :: ${li.description}`);
}
