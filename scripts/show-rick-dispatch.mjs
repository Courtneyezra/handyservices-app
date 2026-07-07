import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const rows = await sql`
  SELECT id, status, public_token, total_hours, total_contractor_pay_pence, customer_revenue_pence, tasks, created_at, quote_id
  FROM job_dispatches
  WHERE customer_first_name ILIKE 'Rick'
  ORDER BY created_at DESC
`;
console.log(`${rows.length} Rick dispatches`);
for (const d of rows) {
  console.log(`\n=== ${d.id} (${d.status}) created ${d.created_at}`);
  console.log(`   quote_id: ${d.quote_id}  hours: ${(d.total_hours/10).toFixed(1)}  pay: £${(d.total_contractor_pay_pence/100).toFixed(2)}  revenue: £${(d.customer_revenue_pence/100).toFixed(2)}`);
  for (const t of d.tasks) {
    console.log(`   #${t.num} [${t.tier}] ${t.title} — ${t.hours}h £${(t.payPence/100).toFixed(2)}`);
  }
}
