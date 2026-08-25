import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { sql } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(invoices)
    .where(sql`${invoices.notes} LIKE '%dunningLog%'`);

  console.log(`${rows.length} invoice(s) with dunning activity:\n`);
  for (const inv of rows) {
    let log: string[] = [];
    let lastAt = '';
    try {
      const n = JSON.parse(inv.notes || '{}');
      log = n.dunningLog || [];
      lastAt = n.lastDunningAt || '';
    } catch { /* ignore */ }
    console.log([
      inv.invoiceNumber,
      (inv.customerName || '?').trim(),
      inv.customerEmail || 'NO EMAIL',
      inv.customerPhone || 'no phone',
      `status=${inv.status}`,
      `total=£${(inv.totalAmount / 100).toFixed(2)}`,
      `balance=£${(inv.balanceDue / 100).toFixed(2)}`,
      `sentAt=${inv.sentAt ? new Date(inv.sentAt).toISOString().slice(0, 10) : 'NEVER SENT'}`,
      `steps=[${log.join(',')}]`,
      `last=${lastAt.slice(0, 10)}`,
    ].join('  '));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
