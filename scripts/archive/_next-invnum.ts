import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const rows = await db.execute(sql`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE 'INV-2026-%'
    ORDER BY invoice_number DESC LIMIT 1
`);
const last = (rows.rows?.[0] as any)?.invoice_number as string | undefined;
const lastSeq = last ? parseInt(last.split('-')[2], 10) : 0;
const next = `INV-2026-${(lastSeq + 1).toString().padStart(4, '0')}`;
console.log(`last=${last}  next=${next}`);
process.exit(0);
