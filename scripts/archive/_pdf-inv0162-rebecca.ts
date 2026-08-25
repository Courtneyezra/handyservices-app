/** One-off: generate PDF for amended INV-2026-0162 (Rebecca). Safe to delete. */
import 'dotenv/config';
process.env.BASE_URL = 'https://www.handyservices.app';

import { generateInvoicePdf } from '../server/invoice-generator';
import * as fs from 'fs';

const INVOICE_ID = '5b62d308-b784-4031-8fda-9999574da014';
const OUT = 'INV-2026-0162-rebecca-amended.pdf';

const pdf = await generateInvoicePdf(INVOICE_ID);
fs.writeFileSync(OUT, pdf);
console.log(`Saved: ${OUT} (${(pdf.length / 1024).toFixed(1)} KB)`);
process.exit(0);
