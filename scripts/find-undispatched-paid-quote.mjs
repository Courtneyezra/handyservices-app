import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);
const rows = await sql`
  SELECT q.short_slug, q.id, q.customer_name, q.deposit_paid_at, d.id AS dispatch_id
  FROM personalized_quotes q
  LEFT JOIN job_dispatches d ON d.quote_id = q.id
  WHERE q.deposit_paid_at IS NOT NULL AND d.id IS NULL
  ORDER BY q.deposit_paid_at DESC LIMIT 5
`;
console.log(rows);
