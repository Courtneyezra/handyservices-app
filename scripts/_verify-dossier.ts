// Verify getCustomerDossier(phone) — READ-ONLY.
//   npx tsx scripts/_verify-dossier.ts <phone>
//   npx tsx scripts/_verify-dossier.ts            (lists recent invoice phones to pick from)
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { desc } from 'drizzle-orm';
import { getCustomerDossier } from '../server/customer-dossier';

async function main() {
    const phone = process.argv[2];

    if (!phone) {
        const recent = await db.select({
            invoiceNumber: invoices.invoiceNumber,
            customerName: invoices.customerName,
            customerPhone: invoices.customerPhone,
            createdAt: invoices.createdAt,
        }).from(invoices).orderBy(desc(invoices.createdAt)).limit(10);
        console.log('Recent invoice customers (pass a phone as argv):');
        for (const r of recent) {
            console.log(`  ${r.invoiceNumber}  ${r.customerName}  ${r.customerPhone}  ${r.createdAt?.toISOString()}`);
        }
        process.exit(0);
    }

    const t0 = Date.now();
    const dossier = await getCustomerDossier(phone);
    const ms = Date.now() - t0;

    console.log(`\n=== Dossier for ${phone} (key=${dossier.phoneKey}) in ${ms}ms ===`);
    console.log('name:', dossier.name);
    console.log('summary:', JSON.stringify(dossier.summary, null, 2));
    for (const section of ['leads', 'quotes', 'jobs', 'invoices', 'conversations', 'calls'] as const) {
        const rows = dossier[section];
        console.log(`\n--- ${section} (${rows.length} shown) ---`);
        for (const row of rows) console.log(JSON.stringify(row));
    }
    console.log(`\napprox blob size: ${JSON.stringify(dossier).length} chars`);
    process.exit(0);
}

main().catch((err) => {
    console.error('VERIFY FAILED:', err);
    process.exit(1);
});
