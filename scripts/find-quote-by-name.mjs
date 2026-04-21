import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const name = process.argv[2] || 'Sharon';
const rows = await sql`
  SELECT id, short_slug, customer_name, phone, email, job_description,
         base_price, deposit_amount_pence, selected_tier_price_pence,
         deposit_paid_at, installment_status, selected_date,
         booked_at, completed_at, created_at
  FROM personalized_quotes
  WHERE customer_name ILIKE ${'%' + name + '%'}
  ORDER BY created_at DESC
  LIMIT 20
`;
console.log(JSON.stringify(rows, null, 2));
