/**
 * One-off: generate PDF for INV-2026-0122 (Alicia Holod, door ironmongery)
 * and save to ~/Downloads/INV-2026-0122.pdf for email attachment.
 *
 * Uses the patched server/invoice-generator.ts template:
 *  - Bank details: Handyman Nottingham, 04-00-04, 39473040
 *  - Customer notes (not internal notes)
 *  - Fixed line-item field-name compatibility
 *
 * Safe to delete after running.
 */
import { generateInvoicePdf } from '../server/invoice-generator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INVOICE_ID = '0f72e21b-c6e7-4011-98fc-5ce034fc82f6';   // INV-2026-0122
const OUT_NAME = 'INV-2026-0122.pdf';

async function main() {
    console.log(`Generating PDF for invoice ${INVOICE_ID}...`);
    const pdfBuffer = await generateInvoicePdf(INVOICE_ID);

    const outPath = path.join(os.homedir(), 'Downloads', OUT_NAME);
    fs.writeFileSync(outPath, pdfBuffer);

    const sizeKb = (pdfBuffer.length / 1024).toFixed(1);
    console.log(`\nSaved: ${outPath} (${sizeKb} KB)`);
    process.exit(0);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
