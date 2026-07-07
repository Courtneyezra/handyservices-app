import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const id = 'quote_s4tC6QwvfVoo1YJSnOe0b';
const rows = await sql`SELECT id, pricing_line_items, base_price, address, job_description FROM personalized_quotes WHERE id = ${id}`;
const q = rows[0];
console.log('quote:', q.id, 'base £', (q.base_price/100).toFixed(2));
console.log('address:', q.address);
console.log('job:', q.job_description);
console.log('\nLINE ITEMS:');
const lines = q.pricing_line_items || [];
for (const l of lines) {
  console.log(JSON.stringify(l, null, 2));
}
