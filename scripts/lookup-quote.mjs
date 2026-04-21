import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const slug = process.argv[2] || 'r048ep92';
const rows = await sql`
  SELECT * FROM personalized_quotes WHERE short_slug = ${slug}
`;
console.log(JSON.stringify(rows, null, 2));

if (rows[0]?.invoice_id) {
  const inv = await sql`SELECT * FROM invoices WHERE id = ${rows[0].invoice_id}`;
  console.log('\n--- LINKED INVOICE ---');
  console.log(JSON.stringify(inv, null, 2));
}
