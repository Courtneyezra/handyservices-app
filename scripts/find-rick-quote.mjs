import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);
const rows = await sql`
  SELECT id, short_slug, customer_name, postcode, address, deposit_paid_at, segment, base_price
  FROM personalized_quotes
  WHERE customer_name ILIKE '%rick%'
  ORDER BY created_at DESC LIMIT 5
`;
console.log(JSON.stringify(rows, null, 2));
