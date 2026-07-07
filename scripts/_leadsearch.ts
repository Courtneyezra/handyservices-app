import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const when = (d?: any) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
async function main() {
  const l: any = await db.execute(sql`
    select customer_name, phone, postcode, address, status, stage, created_at,
           coalesce(job_description, job_summary) as detail
    from leads
    where customer_name ilike '%linda%' or customer_name ilike '%chris%'
       or postcode ilike 'DE22%' or replace(postcode,' ','') ilike 'NG1%'
    order by created_at desc nulls last limit 30`);
  const rows = l.rows ?? l;
  console.log('=== LEADS Linda/Chris/DE22/NG1 ===  (' + rows.length + ')');
  rows.forEach((r: any) => console.log(
    `  ${(r.customer_name || '—').padEnd(16)} ${(r.phone || '—').padEnd(14)} ${(r.postcode || '—').padEnd(9)} ${(r.stage || r.status || '—').toString().padEnd(14)} ${when(r.created_at)} | ${String(r.detail || '').slice(0, 55)}`));
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
