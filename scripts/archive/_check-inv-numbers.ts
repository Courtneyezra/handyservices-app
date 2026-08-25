import 'dotenv/config';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { sql, eq } from 'drizzle-orm';

const rows = await db.execute(sql`SELECT invoice_number, customer_name, total_amount, status, created_at FROM invoices WHERE invoice_number LIKE 'INV-2026-%' ORDER BY invoice_number DESC LIMIT 20`);
console.log('RECENT 2026 INVOICES:');
console.log(JSON.stringify(rows.rows, null, 2));

const existing = await db.select().from(invoices).where(eq(invoices.quoteId, 'quote_CTJh5dqtAqeeD1LiT8aZF'));
console.log('\nEXISTING INVOICES FOR GARETH QUOTE:', JSON.stringify(existing, null, 2));
process.exit(0);
