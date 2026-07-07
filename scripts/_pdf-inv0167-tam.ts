/** One-off: generate PDF for amended INV-2026-0167 (Tam). Safe to delete. */
import 'dotenv/config';
process.env.BASE_URL = 'https://www.handyservices.app';

import { generateInvoicePdf } from '../server/invoice-generator';
import * as fs from 'fs';

const INVOICE_ID = '43189f48-42dc-47e9-8547-676ed6e4067d';
const OUT = 'INV-2026-0167-tam-amended.pdf';

const pdf = await generateInvoicePdf(INVOICE_ID);
fs.writeFileSync(OUT, pdf);
console.log(`Saved: ${OUT} (${(pdf.length / 1024).toFixed(1)} KB)`);
process.exit(0);
