import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { inArray, or, eq } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(invoices).where(or(
    inArray(invoices.invoiceNumber, ['INV-2026-0236', 'INV-2026-0189', 'INV-2026-0025', 'INV-2026-0221', 'INV-2026-0177']),
    eq(invoices.customerEmail, 'mariaasmat1@hotmail.com'),
  ));
  for (const inv of rows) {
    let notes: any = {};
    try { notes = JSON.parse(inv.notes || '{}'); } catch { /* plain text */ }
    console.log({
      number: inv.invoiceNumber,
      customer: (inv.customerName || '').trim(),
      email: inv.customerEmail,
      status: inv.status,
      total: `£${(inv.totalAmount / 100).toFixed(2)}`,
      deposit: `£${(inv.depositPaid / 100).toFixed(2)}`,
      balance: `£${(inv.balanceDue / 100).toFixed(2)}`,
      createdAt: inv.createdAt?.toISOString().slice(0, 10),
      paidAt: (inv as any).paidAt ? new Date((inv as any).paidAt).toISOString().slice(0, 16) : null,
      dunning: notes.dunningLog,
      lastDunningAt: notes.lastDunningAt,
      jobDesc: (inv as any).jobDescription?.slice(0, 60) ?? null,
    });
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
