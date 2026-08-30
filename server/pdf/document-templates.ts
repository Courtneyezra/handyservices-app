/**
 * Server-side branded document templates (Track A).
 *
 * Renders the Handy Services branded invoice and job-sheet HTML and converts
 * HTML → PDF with Puppeteer. The look is ported from the hand-built branded
 * documents:
 *   - scripts/_pdf-craig-invoice.py (reportlab invoice, e.g. INV-2026-0252-martin-branded.pdf)
 *   - client/public/job-sheet-*.html (hand-written job sheets)
 *
 * Brand palette (from the reportlab scripts):
 *   NAVY #1B2A4A · YELLOW #F5A623 · LIGHT #F7F8FC · MID #D0D5E3
 *   DARK #111827 · MUTED #6B7280 · YELLOW_SOFT #FFF8EC
 */
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

// ---------- Shared helpers ----------

const BRAND = {
    navy: '#1B2A4A',
    yellow: '#F5A623',
    light: '#F7F8FC',
    mid: '#D0D5E3',
    dark: '#111827',
    muted: '#6B7280',
    yellowSoft: '#FFF8EC',
    name: 'Handy Services',
    phone: '07449 501 762',
    email: 'hello@handyservices.uk',
    reviews: '4.9 from 300+ Reviews',
};

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatPence(pence: number | null | undefined): string {
    return `\u00a3${((pence ?? 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date | string | null | undefined): string {
    if (!date) return '\u2014';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Logo embedded as a data URI so the PDF renders without a running web server.
let cachedLogoDataUri: string | null | undefined;
function getLogoDataUri(): string | null {
    if (cachedLogoDataUri !== undefined) return cachedLogoDataUri;
    try {
        const logoPath = path.resolve(process.cwd(), 'client', 'public', 'logo.png');
        cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
    } catch {
        cachedLogoDataUri = null;
    }
    return cachedLogoDataUri;
}

function brandCss(): string {
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: ${BRAND.dark}; font-size: 13px; line-height: 1.55; background: white;
    }
    .page { padding: 0 0 10mm 0; }
    .content { padding: 0 18mm; }
    /* Navy nav bar */
    .nav { background: ${BRAND.navy}; color: white; display: flex; align-items: center; gap: 14px; padding: 12px 18mm; }
    .nav .logo { width: 40px; height: 40px; object-fit: contain; }
    .nav .brand { font-size: 19px; font-weight: 700; }
    .nav .reviews { font-size: 11px; color: #C8CBD6; margin-left: 10px; }
    .nav .reviews .stars { color: ${BRAND.yellow}; }
    .nav .phone { margin-left: auto; font-weight: 700; font-size: 15px; }
    /* Yellow strip */
    .strip { background: ${BRAND.yellow}; color: ${BRAND.navy}; text-align: center; font-weight: 700; font-size: 11.5px; letter-spacing: 0.4px; padding: 7px 18mm; }
    /* Hero */
    .hero { margin-top: 11mm; }
    .hero h1 { font-size: 34px; font-weight: 700; color: ${BRAND.navy}; line-height: 1.15; }
    .hero .docno { font-size: 27px; font-weight: 700; color: ${BRAND.yellow}; margin-top: 2px; }
    .hero .sub { color: ${BRAND.muted}; font-weight: 300; font-size: 13px; margin-top: 8px; }
    /* Credential badges */
    .badges { display: flex; background: ${BRAND.navy}; margin-top: 9mm; }
    .badges div { flex: 1; color: white; font-weight: 700; font-size: 10px; text-align: center; padding: 9px 4px; border-right: 0.5px solid ${BRAND.yellow}; }
    .badges div:last-child { border-right: none; }
    /* Two-column meta */
    .meta-cols { display: flex; justify-content: space-between; margin-top: 9mm; gap: 24px; }
    .meta-cols .label { color: ${BRAND.muted}; font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; margin-bottom: 4px; }
    .meta-cols .col-right { text-align: right; }
    .meta-cols .val { font-size: 13px; line-height: 1.6; }
    /* Section headings */
    h2.section { font-size: 16px; font-weight: 700; color: ${BRAND.navy}; margin-top: 9mm; padding-bottom: 5px; border-bottom: 2.5px solid ${BRAND.yellow}; }
    /* Line-item table */
    table.items { width: 100%; border-collapse: collapse; margin-top: 5mm; }
    table.items thead th { background: ${BRAND.navy}; color: white; font-weight: 700; font-size: 11.5px; text-align: left; padding: 9px 12px; }
    table.items thead th.num { text-align: right; }
    table.items thead th.ctr { text-align: center; }
    table.items tbody td { padding: 11px 12px; font-size: 12.5px; border-bottom: 0.5px solid ${BRAND.mid}; vertical-align: top; }
    table.items tbody tr:nth-child(even) td { background: ${BRAND.light}; }
    table.items tbody td.num { text-align: right; white-space: nowrap; }
    table.items tbody td.ctr { text-align: center; }
    /* Totals */
    .totals { display: flex; justify-content: flex-end; margin-top: 5mm; }
    .totals table { width: 300px; border-collapse: collapse; }
    .totals td { padding: 7px 12px; font-size: 13px; border-bottom: 0.5px solid ${BRAND.mid}; }
    .totals td.num { text-align: right; white-space: nowrap; }
    .totals tr.deposit td { color: #16a34a; }
    .totals tr.balance td { background: ${BRAND.yellowSoft}; color: ${BRAND.navy}; font-weight: 700; font-size: 15px; border-top: 1.5px solid ${BRAND.navy}; border-bottom: 2px solid ${BRAND.yellow}; }
    /* Payment / info boxes */
    .box { background: ${BRAND.yellowSoft}; border: 0.5px solid ${BRAND.yellow}; border-left: 4px solid ${BRAND.yellow}; padding: 14px 18px; margin-top: 6mm; break-inside: avoid; }
    .box h3 { font-size: 14px; font-weight: 700; color: ${BRAND.navy}; margin-bottom: 6px; }
    .box p { font-size: 12px; color: ${BRAND.navy}; margin: 2px 0; }
    .box .fine { color: ${BRAND.muted}; font-size: 10.5px; margin-top: 8px; }
    .note { font-style: italic; color: ${BRAND.muted}; font-size: 12px; margin-top: 6mm; line-height: 1.6; }
    /* Footer */
    .footer { background: ${BRAND.navy}; color: white; display: flex; align-items: center; gap: 12px; padding: 14px 18mm; margin-top: 10mm; break-inside: avoid; }
    .footer .logo { width: 38px; height: 38px; object-fit: contain; }
    .footer .strap { font-size: 11px; }
    .footer .strap b { font-size: 12.5px; }
    .footer .strap .tag { color: ${BRAND.yellow}; }
    .footer .contact { margin-left: auto; text-align: right; font-size: 11px; line-height: 1.6; }
    @media print { .box, .footer, table.items tr { break-inside: avoid; } }
    `;
}

function navBarHtml(): string {
    const logo = getLogoDataUri();
    return `
    <div class="nav">
        ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
        <span class="brand">${BRAND.name}</span>
        <span class="reviews"><span class="stars">\u2605\u2605\u2605\u2605\u2605</span> ${BRAND.reviews}</span>
        <span class="phone">${BRAND.phone}</span>
    </div>`;
}

function footerHtml(): string {
    const logo = getLogoDataUri();
    return `
    <div class="footer">
        ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
        <div class="strap">
            <b>${BRAND.name}</b><br>
            <span class="tag">Next-day slots \u00b7 Fast &amp; reliable \u00b7 Fully insured</span>
        </div>
        <div class="contact">
            <b>Get in Touch</b><br>
            ${BRAND.phone}<br>
            ${BRAND.email}
        </div>
    </div>`;
}

function docShell(title: string, bodyHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
<style>${brandCss()}</style>
</head>
<body><div class="page">${bodyHtml}</div></body>
</html>`;
}

// ---------- Invoice ----------

interface InvoiceLineItemLike {
    description?: string;
    quantity?: number;
    unitPricePence?: number;
    unitPrice?: number;
    totalPence?: number;
    total?: number;
    isPropertyHeader?: boolean;
    propertyAddress?: string;
}

/**
 * Render the branded invoice HTML for an invoices-table row.
 * Accepts the raw drizzle row — lineItems tolerates both the generator shape
 * ({unitPricePence,totalPence}) and the manual/route shape ({unitPrice,total}).
 */
export function renderInvoiceHtml(invoice: any): string {
    const lineItems: InvoiceLineItemLike[] = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

    const rows = lineItems.map((item) => {
        if (item.isPropertyHeader) {
            return `<tr><td colspan="3" style="background:${BRAND.navy};color:white;font-weight:700;">${escapeHtml(item.propertyAddress || item.description || '')}</td></tr>`;
        }
        const qty = item.quantity ?? 1;
        const total = item.totalPence ?? item.total ?? ((item.unitPricePence ?? item.unitPrice ?? 0) * qty);
        return `<tr>
            <td>${escapeHtml(item.description || 'Service')}</td>
            <td class="ctr">${escapeHtml(qty)}</td>
            <td class="num">${formatPence(total)}</td>
        </tr>`;
    }).join('\n');

    const statusLabel = invoice.status
        ? escapeHtml(String(invoice.status).charAt(0).toUpperCase() + String(invoice.status).slice(1))
        : '\u2014';

    const depositPaid = invoice.depositPaid ?? 0;
    const balanceDue = invoice.balanceDue ?? 0;
    const showPayment = invoice.status !== 'paid' && invoice.status !== 'void' && balanceDue > 0;

    const preparedForBits = [
        `Prepared for <b>${escapeHtml(invoice.customerName || 'Customer')}</b>`,
        invoice.customerAddress ? escapeHtml(String(invoice.customerAddress).split('\n')[0]) : null,
        formatDate(invoice.createdAt),
    ].filter(Boolean).join(' \u00b7 ');

    const billToLines = [
        `<b>${escapeHtml(invoice.customerName || 'Customer')}</b>`,
        invoice.customerEmail ? escapeHtml(invoice.customerEmail) : null,
        invoice.customerPhone ? escapeHtml(invoice.customerPhone) : null,
        invoice.customerAddress ? escapeHtml(invoice.customerAddress).replace(/\n/g, '<br>') : null,
    ].filter(Boolean).join('<br>');

    const body = `
    ${navBarHtml()}
    <div class="strip">INVOICE \u00b7 ${escapeHtml(invoice.invoiceNumber)} \u00b7 PAYMENT DUE WITHIN 14 DAYS</div>
    <div class="content">
        <div class="hero">
            <h1>Invoice</h1>
            <div class="docno">${escapeHtml(invoice.invoiceNumber)}</div>
            <div class="sub">${preparedForBits}</div>
        </div>
        <div class="badges">
            <div>\u2713 \u00a32M Public Liability</div>
            <div>\u2605 4.9 Google (300+ reviews)</div>
            <div>\u2713 DBS Checked</div>
            <div>\u26a1 Fully Insured</div>
        </div>
        <div class="meta-cols">
            <div>
                <div class="label">Bill To</div>
                <div class="val">${billToLines}</div>
            </div>
            <div class="col-right">
                <div class="label">Invoice Details</div>
                <div class="val">
                    <b>Invoice No:</b> ${escapeHtml(invoice.invoiceNumber)}<br>
                    <b>Date:</b> ${formatDate(invoice.createdAt)}<br>
                    <b>Due:</b> ${formatDate(invoice.dueDate)}<br>
                    <b>Status:</b> ${statusLabel}
                </div>
            </div>
        </div>
        <h2 class="section">Work Completed</h2>
        <table class="items">
            <thead><tr><th>Description</th><th class="ctr" style="width:52px;">Qty</th><th class="num" style="width:110px;">Amount</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="3">Handyman services</td></tr>`}</tbody>
        </table>
        <div class="totals">
            <table>
                <tr><td>Subtotal</td><td class="num">${formatPence(invoice.totalAmount)}</td></tr>
                ${depositPaid > 0 ? `<tr class="deposit"><td>Deposit Paid</td><td class="num">\u2212${formatPence(depositPaid)}</td></tr>` : ''}
                <tr class="balance"><td>Balance Due</td><td class="num">${formatPence(balanceDue)}</td></tr>
            </table>
        </div>
        ${showPayment ? `
        <div class="box">
            <h3>Payment Details</h3>
            <p>Please settle the balance of <b>${formatPence(balanceDue)}</b> within 14 days by bank transfer:</p>
            <p style="margin-top:8px;">Account Name: <b>HANDY NETWORK LTD</b></p>
            <p>Sort Code: <b>04-00-06</b> &nbsp;|&nbsp; Account No: <b>76360634</b></p>
            <p>Payment Reference: <b>${escapeHtml(invoice.invoiceNumber)}</b></p>
            <p class="fine">Please use the invoice number as your payment reference so we can match the payment to your account.</p>
        </div>` : ''}
        ${invoice.customerNotes ? `<p class="note">${escapeHtml(invoice.customerNotes)}</p>` : ''}
        <p class="note">Thank you for trusting ${BRAND.name} with your maintenance \u2014 we genuinely appreciate the work and look forward to helping again. Any questions about this invoice, please get in touch.</p>
    </div>
    ${footerHtml()}`;

    return docShell(`Invoice ${invoice.invoiceNumber}`, body);
}

// ---------- Job sheet ----------

interface JobSheetRenderOpts {
    sheet?: any;   // job_sheets row (lineItems, accessInstructions, parkingNotes, materialsChecklist, specialEquipmentNeeded)
    quote?: any;   // personalized_quotes row (address, jobDescription)
}

/**
 * Render the branded job-sheet HTML for a contractor_booking_requests row.
 * Styling ported from the hand-built client/public/job-sheet-*.html sheets
 * (navy header, yellow ribbon, dark customer card, numbered plan).
 */
export function renderJobSheetHtml(job: any, opts: JobSheetRenderOpts = {}): string {
    const { sheet, quote } = opts;

    const address = quote?.address || quote?.postcode || job.customerAccessNotes || null;
    const scheduledDate = job.scheduledDate ? formatDate(job.scheduledDate) : 'To be confirmed';
    const slot = job.scheduledSlot
        ? String(job.scheduledSlot).replace('_', ' ').toUpperCase()
        : [job.scheduledStartTime, job.scheduledEndTime].filter(Boolean).join(' \u2013 ') || null;

    const sheetItems: any[] = Array.isArray(sheet?.lineItems) ? sheet.lineItems : [];
    const workItems = sheetItems.length > 0
        ? sheetItems.map((li) => ({
            description: li.description || 'Task',
            minutes: li.estimatedMinutes || null,
            materials: Array.isArray(li.materialsRequired) ? li.materialsRequired : [],
            status: li.status || null,
        }))
        : (job.description || quote?.jobDescription)
            ? [{ description: job.description || quote?.jobDescription, minutes: null, materials: [], status: null }]
            : [];

    const planRows = workItems.map((item) => `
        <li>
            <div>
                <div>${escapeHtml(item.description)}</div>
                ${item.minutes ? `<div class="mins">Est. ${escapeHtml(item.minutes)} min${item.materials.length ? ` \u00b7 Materials: ${escapeHtml(item.materials.join(', '))}` : ''}</div>`
                    : item.materials.length ? `<div class="mins">Materials: ${escapeHtml(item.materials.join(', '))}</div>` : ''}
            </div>
        </li>`).join('\n');

    const materialsChecklist: any[] = Array.isArray(sheet?.materialsChecklist) ? sheet.materialsChecklist : [];
    const materialsHtml = materialsChecklist.length > 0
        ? `<div class="have">${materialsChecklist.map((m) => `<span>\u2713 ${escapeHtml(typeof m === 'string' ? m : m?.item || m?.description || '')}</span>`).join('')}</div>`
        : '';

    const jobSheetCss = `
        .cust { background: ${BRAND.navy}; color: white; border-radius: 12px; padding: 16px 20px; margin-top: 7mm; }
        .cust .addr { font-size: 19px; font-weight: 700; line-height: 1.3; }
        .cust .line { font-size: 12.5px; color: #D3D6E2; margin-top: 6px; }
        .cust .line .lbl { color: #9AA0BD; }
        .cust .line .val { color: white; font-weight: 700; }
        ol.plan { margin-top: 5mm; padding-left: 0; list-style: none; counter-reset: p; }
        ol.plan li { counter-increment: p; display: flex; gap: 12px; padding: 10px 0; font-size: 13px; border-bottom: 1.5px solid #EEF0F5; align-items: baseline; }
        ol.plan li::before { content: counter(p); flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; background: ${BRAND.navy}; color: white; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; }
        ol.plan li:last-child { border-bottom: none; }
        ol.plan .mins { color: ${BRAND.muted}; font-size: 11px; margin-top: 2px; }
        .note-box { background: #F0F2F8; border-left: 6px solid ${BRAND.navy}; border-radius: 8px; padding: 13px 17px; margin-top: 5mm; font-size: 12.5px; break-inside: avoid; }
        .note-box.warn2 { background: ${BRAND.yellowSoft}; border-left-color: ${BRAND.yellow}; }
        .note-box b.title { display: block; margin-bottom: 4px; font-size: 13.5px; }
        .have { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .have span { background: #DBE7D8; color: #2F6B2A; font-weight: 700; font-size: 11px; padding: 4px 10px; border-radius: 7px; }
    `;

    const body = `
    <style>${jobSheetCss}</style>
    ${navBarHtml()}
    <div class="strip">JOB SHEET \u00b7 ${escapeHtml((job.customerName || 'CUSTOMER').toUpperCase())} \u00b7 ${escapeHtml(scheduledDate.toUpperCase())}</div>
    <div class="content">
        <div class="hero">
            <h1>Job Sheet</h1>
            <div class="sub">Job ref <b>${escapeHtml(job.id)}</b> \u00b7 ${escapeHtml(scheduledDate)}${slot ? ` \u00b7 ${escapeHtml(slot)}` : ''}</div>
        </div>
        <div class="cust">
            ${address ? `<div class="addr">${escapeHtml(address).replace(/\n/g, '<br>')}</div>` : `<div class="addr">${escapeHtml(job.customerName || 'Customer')}</div>`}
            <div class="line">
                <span class="lbl">Customer:</span> <span class="val">${escapeHtml(job.customerName || '\u2014')}</span>
                ${job.customerPhone ? ` &nbsp;\u00b7&nbsp; <span class="val">${escapeHtml(job.customerPhone)}</span>` : ''}
            </div>
            <div class="line">
                <span class="lbl">Scheduled:</span> <span class="val">${escapeHtml(scheduledDate)}${slot ? ` \u00b7 ${escapeHtml(slot)}` : ''}</span>
                ${job.durationDays && job.durationDays > 1 ? ` &nbsp;\u00b7&nbsp; <span class="val">${escapeHtml(job.durationDays)} days</span>` : ''}
            </div>
            ${sheet?.customerContactPreference ? `<div class="line"><span class="lbl">Contact preference:</span> <span class="val">${escapeHtml(sheet.customerContactPreference)}</span></div>` : ''}
        </div>
        <h2 class="section">Work to Complete</h2>
        ${planRows ? `<ol class="plan">${planRows}</ol>` : `<p class="note">No line items on file \u2014 see the job description with dispatch.</p>`}
        ${sheet?.accessInstructions ? `<div class="note-box"><b class="title">\ud83d\udd11 Access</b>${escapeHtml(sheet.accessInstructions)}</div>` : ''}
        ${sheet?.parkingNotes ? `<div class="note-box"><b class="title">\ud83d\ude97 Parking</b>${escapeHtml(sheet.parkingNotes)}</div>` : ''}
        ${materialsHtml ? `<div class="note-box warn2"><b class="title">Materials checklist</b>${materialsHtml}</div>` : ''}
        ${sheet?.specialEquipmentNeeded ? `<div class="note-box warn2"><b class="title">\u26a0 Special equipment</b>${escapeHtml(sheet.specialEquipmentNeeded)}</div>` : ''}
        <div class="note-box">
            <b class="title">Before you leave site</b>
            Take before/after photos of every item \u00b7 tidy the work area \u00b7 confirm the customer is happy \u00b7 mark the job complete in the app so the invoice goes out.
        </div>
    </div>
    ${footerHtml()}`;

    return docShell(`Job Sheet \u2014 ${job.customerName || job.id}`, body);
}

// ---------- HTML → PDF ----------

/**
 * Convert an HTML document to a PDF buffer with Puppeteer.
 * Same launch pattern as server/invoice-generator.ts generateInvoicePdf.
 * Zero page margins — the branded templates are full-bleed (navy nav bar /
 * yellow strip run edge-to-edge) and carry their own internal padding.
 */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        // 'networkidle0' can hang forever when the Google Fonts <link> stalls
        // (offline / slow network). Wait for 'load', then give webfonts a
        // bounded window to settle before printing.
        await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
        await page.evaluate(() => Promise.race([
            (document as any).fonts?.ready ?? Promise.resolve(),
            new Promise((resolve) => setTimeout(resolve, 3000)),
        ]));
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
        });
        return Buffer.from(pdfBuffer);
    } finally {
        await browser.close();
    }
}
