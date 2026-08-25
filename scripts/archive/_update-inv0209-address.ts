import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const [updated] = await db.update(invoices)
    .set({
        customerAddress: 'Inicio Group, 301 Genesis Centre, Garrett Field, Birchwood, Warrington WA7 3BH (site: 122 Osmaston Rd, Derby DE1 2RF)',
        updatedAt: new Date(),
    })
    .where(eq(invoices.invoiceNumber, 'INV-2026-0209'))
    .returning();
console.log('Updated address:', updated.customerAddress);
process.exit(0);
