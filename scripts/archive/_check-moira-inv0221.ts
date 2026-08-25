import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [inv] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, 'INV-2026-0221')).limit(1);
  if (!inv) { console.log('INV-2026-0221 not found'); process.exit(0); }
  console.log({
    id: inv.id,
    number: inv.invoiceNumber,
    customer: inv.customerName,
    email: inv.customerEmail,
    status: inv.status,
    totalAmount: inv.totalAmount,
    depositPaid: inv.depositPaid,
    balanceDue: inv.balanceDue,
    sentAt: inv.sentAt,
    dueDate: inv.dueDate,
    paidAt: (inv as any).paidAt,
    createdAt: inv.createdAt,
    notes: inv.notes,
  });
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
