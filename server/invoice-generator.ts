import { db } from './db';
import {
    invoices,
    contractorBookingRequests,
    personalizedQuotes,
    variationOrders,
} from '../shared/schema';
import { eq, and, sql, lt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import { notifyCustomer } from './customer-notifications';
import { sendInvoiceReminderEmail } from './email-service';

// ==========================================
// BALANCE INVOICE GENERATION
// ==========================================

interface BalanceInvoiceResult {
    invoiceId: string;
    invoiceNumber: string;
    balanceDuePence: number;
}

interface InvoiceLineItem {
    description: string;
    quantity: number;
    unitPricePence: number;
    totalPence: number;
}

/**
 * Generate a detailed balance invoice when a job completes.
 * Called after contractor marks job as completed for deposit-paid jobs.
 *
 * Returns null if:
 *  - No deposit was paid (nothing to balance)
 *  - Job is already fully paid
 *  - Quote not found
 */
export async function generateBalanceInvoice(jobId: string): Promise<BalanceInvoiceResult | null> {
    // a. Fetch the job and linked quote
    const jobResults = await db.select()
        .from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, jobId))
        .limit(1);

    if (jobResults.length === 0) {
        console.error(`[Invoice Generator] Job ${jobId} not found`);
        return null;
    }

    const job = jobResults[0];

    if (!job.quoteId) {
        console.log(`[Invoice Generator] Job ${jobId} has no linked quote, skipping balance invoice`);
        return null;
    }

    const quoteResults = await db.select()
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, job.quoteId))
        .limit(1);

    if (quoteResults.length === 0) {
        console.error(`[Invoice Generator] Quote ${job.quoteId} not found for job ${jobId}`);
        return null;
    }

    const quote = quoteResults[0];

    // b. If no deposit paid, or already fully paid, return null
    if (!quote.depositPaidAt || !quote.depositAmountPence) {
        console.log(`[Invoice Generator] Job ${jobId} has no deposit paid, skipping balance invoice`);
        return null;
    }

    const depositPaid = quote.depositAmountPence;

    // c. Build line items from quote's pricingLineItems (contextual engine) or fallback to basePrice
    const lineItems: InvoiceLineItem[] = [];
    let subtotalPence = 0;

    const pricingLineItems = quote.pricingLineItems as any[] | null;

    if (pricingLineItems && Array.isArray(pricingLineItems) && pricingLineItems.length > 0) {
        // Use detailed line items from the contextual pricing engine
        for (const item of pricingLineItems) {
            const qty = item.quantity || 1;
            const unitPrice = item.unitPricePence || item.pricePence || item.totalPence || 0;
            const total = qty * unitPrice;
            lineItems.push({
                description: item.description || item.label || 'Service',
                quantity: qty,
                unitPricePence: unitPrice,
                totalPence: total,
            });
            subtotalPence += total;
        }
    } else {
        // Fallback: use basePrice or tier price as a single line item
        let totalAmount = 0;

        if (quote.quoteMode === 'simple') {
            totalAmount = quote.basePrice || 0;
        } else if (quote.selectedPackage) {
            const tierPriceMap: Record<string, number | null | undefined> = {
                essential: quote.essentialPrice,
                enhanced: quote.enhancedPrice,
                elite: quote.elitePrice,
            };
            totalAmount = tierPriceMap[quote.selectedPackage] || 0;
        }

        lineItems.push({
            description: quote.jobDescription || 'Handyman Service',
            quantity: 1,
            unitPricePence: totalAmount,
            totalPence: totalAmount,
        });
        subtotalPence = totalAmount;

        // Add selected extras
        if (quote.selectedExtras && Array.isArray(quote.selectedExtras)) {
            const optionalExtras = (quote.optionalExtras as any[]) || [];
            for (const extraLabel of quote.selectedExtras) {
                const extra = optionalExtras.find((e: any) => e.label === extraLabel);
                if (extra && extra.priceInPence) {
                    lineItems.push({
                        description: extra.label,
                        quantity: 1,
                        unitPricePence: extra.priceInPence,
                        totalPence: extra.priceInPence,
                    });
                    subtotalPence += extra.priceInPence;
                }
            }
        }
    }

    // d. Add approved variation orders as additional line items
    const approvedVariations = await db.select()
        .from(variationOrders)
        .where(and(
            eq(variationOrders.jobId, jobId),
            eq(variationOrders.status, 'approved'),
        ));

    for (const variation of approvedVariations) {
        const variationTotal = variation.additionalPricePence + (variation.materialsCostPence || 0);
        lineItems.push({
            description: `Variation: ${variation.description}`,
            quantity: 1,
            unitPricePence: variationTotal,
            totalPence: variationTotal,
        });
        subtotalPence += variationTotal;
    }

    // e. Calculate totals
    // Check if customer paid in full (deposit === full price means fully paid)
    const totalPence = subtotalPence;
    const balanceDuePence = totalPence - depositPaid;

    if (balanceDuePence <= 0) {
        console.log(`[Invoice Generator] Job ${jobId} already fully paid (balance: ${balanceDuePence}p), skipping`);
        return null;
    }

    // f. Generate invoice number with MAX+1 and retry (matching stripe-routes.ts pattern)
    const year = new Date().getFullYear();
    let invoiceNumber = '';
    const invoiceId = uuidv4();
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const [maxResult] = await db.select({
                maxNum: sql<string>`max(invoice_number)`
            }).from(invoices);

            let nextSeq = 1;
            const maxNum = maxResult?.maxNum;
            if (maxNum) {
                const match = maxNum.match(/INV-\d{4}-(\d+)/);
                if (match) nextSeq = parseInt(match[1], 10) + 1;
            }

            invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

            // g. Insert into invoices table
            await db.insert(invoices).values({
                id: invoiceId,
                invoiceNumber,
                quoteId: quote.id,
                contractorId: job.assignedContractorId || job.contractorId,
                customerName: job.customerName,
                customerEmail: job.customerEmail || quote.email || '',
                customerPhone: job.customerPhone || quote.phone || '',
                customerAddress: quote.address || '',
                totalAmount: totalPence,
                depositPaid,
                balanceDue: balanceDuePence,
                lineItems: lineItems as any,
                status: 'sent',
                dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
                paymentMethod: null,
                notes: `Auto-generated balance invoice on job completion. Job: ${jobId}`,
            });

            break; // Success
        } catch (insertError: any) {
            const isUniqueViolation = insertError?.code === '23505' ||
                insertError?.message?.includes('unique') ||
                insertError?.message?.includes('duplicate');
            if (isUniqueViolation && attempt < maxRetries - 1) continue;
            throw insertError;
        }
    }

    // Link invoice to job
    await db.update(contractorBookingRequests)
        .set({ invoiceId, updatedAt: new Date() })
        .where(eq(contractorBookingRequests.id, jobId));

    console.log(`[Invoice Generator] Balance invoice ${invoiceNumber} created for job ${jobId}. Balance: ${balanceDuePence}p`);

    // Auto-deliver invoice to customer via WhatsApp (fire-and-forget)
    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    const invoiceLink = `${baseUrl}/pay/${invoiceNumber.replace('INV-', '').replace(/-/g, '')}`;

    notifyCustomer({
        jobId,
        event: 'invoice_sent',
        data: {
            amountPence: balanceDuePence,
            invoiceLink: `${baseUrl}/invoice/${invoiceId}`,
        },
    }).catch((err) => {
        console.error(`[Invoice Generator] Failed to send invoice notification for ${invoiceNumber}:`, err);
    });

    return {
        invoiceId,
        invoiceNumber,
        balanceDuePence,
    };
}

// ==========================================
// INVOICE PDF GENERATION
// ==========================================

/**
 * Generate a PDF for an invoice using Puppeteer.
 * Returns the generated HTML (stored in pdfUrl as data or path).
 */
export async function generateInvoicePdf(invoiceId: string): Promise<Buffer> {
    const results = await db.select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

    if (results.length === 0) {
        throw new Error(`Invoice ${invoiceId} not found`);
    }

    const invoice = results[0];
    const lineItems = (invoice.lineItems as InvoiceLineItem[]) || [];

    const html = buildInvoiceHtml(invoice, lineItems);

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        });

        // Store reference in the invoice record
        // In production, upload to S3 and store URL. For now, mark as generated.
        await db.update(invoices)
            .set({
                pdfUrl: `/api/invoices/${invoiceId}/pdf`,
                updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId));

        console.log(`[Invoice Generator] PDF generated for invoice ${invoice.invoiceNumber}`);

        // Puppeteer returns Uint8Array, convert to Buffer
        return Buffer.from(pdfBuffer);
    } finally {
        await browser.close();
    }
}

/**
 * Generate the HTML string for an invoice by ID.
 * Fetches the invoice from DB, builds a clean branded HTML document.
 * Returns null if invoice not found.
 */
export async function generateInvoiceHtml(invoiceId: string): Promise<string | null> {
    const results = await db.select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

    if (results.length === 0) {
        return null;
    }

    const invoice = results[0];
    const items = (invoice.lineItems as InvoiceLineItem[]) || [];
    return buildInvoiceHtml(invoice, items);
}

function buildInvoiceHtml(invoice: any, lineItems: InvoiceLineItem[]): string {
    const formatPence = (pence: number) => `\u00a3${(pence / 100).toFixed(2)}`;
    const formatDate = (date: Date | string | null) => {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const lineItemRows = lineItems.map((item) => `
        <tr>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${item.description}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatPence(item.unitPricePence)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatPence(item.totalPence)}</td>
        </tr>
    `).join('');

    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    const paymentLink = `${baseUrl}/invoice/${invoice.id}/pay`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${invoice.invoiceNumber}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; line-height: 1.5; font-size: 14px; }
        .container { max-width: 800px; margin: 0 auto; padding: 40px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
        .company-name { font-size: 24px; font-weight: 700; color: #1a1a2e; }
        .company-details { font-size: 12px; color: #64748b; margin-top: 4px; }
        .invoice-title { font-size: 28px; font-weight: 700; color: #1a1a2e; text-align: right; }
        .invoice-meta { text-align: right; font-size: 13px; color: #64748b; margin-top: 4px; }
        .addresses { display: flex; justify-content: space-between; margin-bottom: 32px; }
        .address-block { flex: 1; }
        .address-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
        .address-value { font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        thead th { background: #f8fafc; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
        thead th:nth-child(2) { text-align: center; }
        thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
        .totals { display: flex; justify-content: flex-end; margin-bottom: 32px; }
        .totals-table { width: 280px; }
        .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
        .totals-row.total { font-weight: 700; font-size: 16px; border-top: 2px solid #1a1a2e; padding-top: 10px; margin-top: 4px; }
        .totals-row.deposit { color: #16a34a; }
        .totals-row.balance { font-weight: 700; font-size: 18px; color: #1a1a2e; border-top: 2px solid #1a1a2e; padding-top: 10px; margin-top: 4px; }
        .payment-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
        .payment-box h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
        .payment-box p { font-size: 13px; color: #475569; margin-bottom: 4px; }
        .payment-link { display: inline-block; background: #1a1a2e; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 8px; }
        .bank-details { font-size: 12px; color: #64748b; margin-top: 12px; }
        .footer { border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center; }
        .status-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
        .status-sent { background: #fef3c7; color: #92400e; }
        .status-paid { background: #d1fae5; color: #065f46; }
        .status-overdue { background: #fee2e2; color: #991b1b; }
        .status-draft { background: #f1f5f9; color: #475569; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <div class="company-name">Handy Services</div>
                <div class="company-details">
                    Nottingham, UK<br>
                    hello@handyservices.uk<br>
                    07XXX XXXXXX
                </div>
            </div>
            <div>
                <div class="invoice-title">INVOICE</div>
                <div class="invoice-meta">
                    <strong>${invoice.invoiceNumber}</strong><br>
                    Date: ${formatDate(invoice.createdAt)}<br>
                    Due: ${formatDate(invoice.dueDate)}<br>
                    <span class="status-badge status-${invoice.status}">${invoice.status}</span>
                </div>
            </div>
        </div>

        <div class="addresses">
            <div class="address-block">
                <div class="address-label">Bill To</div>
                <div class="address-value">
                    <strong>${invoice.customerName}</strong><br>
                    ${invoice.customerEmail ? invoice.customerEmail + '<br>' : ''}
                    ${invoice.customerPhone ? invoice.customerPhone + '<br>' : ''}
                    ${invoice.customerAddress ? invoice.customerAddress.replace(/\n/g, '<br>') : ''}
                </div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                ${lineItemRows}
            </tbody>
        </table>

        <div class="totals">
            <div class="totals-table">
                <div class="totals-row total">
                    <span>Subtotal</span>
                    <span>${formatPence(invoice.totalAmount)}</span>
                </div>
                ${invoice.depositPaid > 0 ? `
                <div class="totals-row deposit">
                    <span>Deposit Paid</span>
                    <span>-${formatPence(invoice.depositPaid)}</span>
                </div>
                ` : ''}
                <div class="totals-row balance">
                    <span>Balance Due</span>
                    <span>${formatPence(invoice.balanceDue)}</span>
                </div>
            </div>
        </div>

        ${invoice.status !== 'paid' && invoice.balanceDue > 0 ? `
        <div class="payment-box">
            <h3>Payment Details</h3>
            <p>Please pay within 14 days of the invoice date.</p>
            <a href="${paymentLink}" class="payment-link">Pay Online - ${formatPence(invoice.balanceDue)}</a>
            <div class="bank-details">
                <p><strong>Bank Transfer:</strong></p>
                <p>Sort Code: XX-XX-XX | Account: XXXXXXXX</p>
                <p>Reference: ${invoice.invoiceNumber}</p>
            </div>
        </div>
        ` : ''}

        ${invoice.notes ? `<p style="font-size: 13px; color: #64748b; margin-bottom: 16px;"><em>${invoice.notes}</em></p>` : ''}

        <div class="footer">
            <p>Handy Services Ltd | Company No. XXXXXXXX | VAT No. XXXXXXXXX</p>
            <p>Thank you for your business.</p>
        </div>
    </div>
</body>
</html>`;
}

// ==========================================
// OVERDUE INVOICE DETECTION
// ==========================================

/**
 * Check for overdue invoices and update their status.
 * Intended to be called from a daily cron job.
 *
 * Finds invoices where status='sent' and dueDate < now,
 * updates them to 'overdue'.
 *
 * Returns the count of newly overdue invoices.
 */
export async function checkOverdueInvoices(): Promise<number> {
    const now = new Date();

    const overdueInvoices = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(and(
            eq(invoices.status, 'sent'),
            lt(invoices.dueDate, now),
        ));

    if (overdueInvoices.length === 0) {
        return 0;
    }

    // Update each to overdue
    for (const inv of overdueInvoices) {
        await db.update(invoices)
            .set({
                status: 'overdue',
                updatedAt: new Date(),
            })
            .where(eq(invoices.id, inv.id));

        console.log(`[Invoice Generator] Invoice ${inv.invoiceNumber} marked as overdue`);
    }

    console.log(`[Invoice Generator] ${overdueInvoices.length} invoice(s) marked as overdue`);

    return overdueInvoices.length;
}


// ==========================================
// DUNNING: INVOICE PAYMENT REMINDERS
// ==========================================

/**
 * Dunning sequence for unpaid invoices.
 * Sends escalating email reminders based on days overdue:
 *   Day 7:  Friendly reminder
 *   Day 14: Firmer reminder (invoice now overdue)
 *   Day 21: Final notice
 *   Day 30: Admin escalation (no customer message, just internal alert)
 *
 * Uses invoice.notes to track which reminders have been sent (JSON dunning log).
 * Call from a daily cron.
 */
export async function runDunningSequence(): Promise<{ reminded: number; escalated: number }> {
    const now = new Date();
    let reminded = 0;
    let escalated = 0;

    // Find all unpaid invoices (status: sent or overdue) with balance > 0
    const unpaidInvoices = await db.select()
        .from(invoices)
        .where(and(
            sql`${invoices.status} IN ('sent', 'overdue')`,
            sql`${invoices.balanceDue} > 0`,
        ));

    if (unpaidInvoices.length === 0) return { reminded: 0, escalated: 0 };

    const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
    const formatPence = (p: number) => `\u00a3${(p / 100).toFixed(2)}`;

    for (const invoice of unpaidInvoices) {
        // Need at least an email to send reminders (phone-only customers skip)
        if (!invoice.customerEmail && !invoice.customerPhone) continue;

        const sentAt = invoice.sentAt || invoice.createdAt;
        if (!sentAt) continue;

        const daysSinceSent = Math.floor((now.getTime() - new Date(sentAt).getTime()) / (1000 * 60 * 60 * 24));

        // Parse existing dunning log from notes
        let dunningLog: string[] = [];
        try {
            const notesObj = invoice.notes ? JSON.parse(invoice.notes) : {};
            dunningLog = notesObj.dunningLog || [];
        } catch {
            // notes is plain text, not JSON — start fresh
            dunningLog = [];
        }

        const paymentLink = `${baseUrl}/invoice/${invoice.id}`;
        let reminderLevel: 'day_7' | 'day_14' | 'day_21' | null = null;
        let dunningStep: string | null = null;

        if (daysSinceSent >= 30 && !dunningLog.includes('day_30')) {
            // Day 30: Admin escalation only (no customer message)
            dunningStep = 'day_30';
            escalated++;
            console.log(`[Dunning] Invoice ${invoice.invoiceNumber} ESCALATED — ${daysSinceSent} days unpaid (${formatPence(invoice.balanceDue)})`);
        } else if (daysSinceSent >= 21 && !dunningLog.includes('day_21')) {
            dunningStep = 'day_21';
            reminderLevel = 'day_21';
        } else if (daysSinceSent >= 14 && !dunningLog.includes('day_14')) {
            dunningStep = 'day_14';
            reminderLevel = 'day_14';
        } else if (daysSinceSent >= 7 && !dunningLog.includes('day_7')) {
            dunningStep = 'day_7';
            reminderLevel = 'day_7';
        }

        if (!dunningStep) continue;

        // Send the reminder email (if not admin-only escalation)
        if (reminderLevel) {
            let sent = false;

            // Primary: send via email
            if (invoice.customerEmail) {
                const emailResult = await sendInvoiceReminderEmail({
                    customerName: invoice.customerName || '',
                    customerEmail: invoice.customerEmail,
                    invoiceNumber: invoice.invoiceNumber,
                    totalAmount: invoice.totalAmount,
                    depositPaid: invoice.depositPaid,
                    balanceDue: invoice.balanceDue,
                    dueDate: invoice.dueDate,
                    paymentLink,
                    invoiceId: invoice.id,
                }, reminderLevel);

                if (emailResult.success) {
                    sent = true;
                    reminded++;
                    console.log(`[Dunning] Sent ${dunningStep} email reminder for ${invoice.invoiceNumber} to ${invoice.customerEmail}`);
                } else {
                    console.error(`[Dunning] Email failed for ${invoice.invoiceNumber}: ${emailResult.error}`);
                }
            }

            // Optional WhatsApp fallback (non-blocking, expected to fail in production)
            if (invoice.customerPhone) {
                try {
                    const { sendWhatsAppMessage } = await import('./meta-whatsapp');
                    const whatsappMessages: Record<string, string> = {
                        day_7: `Friendly reminder: Invoice ${invoice.invoiceNumber} for ${formatPence(invoice.balanceDue)} is outstanding. Pay here: ${paymentLink}`,
                        day_14: `Overdue: Invoice ${invoice.invoiceNumber} for ${formatPence(invoice.balanceDue)} is past due. Please pay: ${paymentLink}`,
                        day_21: `Final notice: Invoice ${invoice.invoiceNumber} for ${formatPence(invoice.balanceDue)} requires immediate payment: ${paymentLink}`,
                    };
                    await sendWhatsAppMessage(invoice.customerPhone, whatsappMessages[reminderLevel]);
                    if (!sent) {
                        sent = true;
                        reminded++;
                    }
                } catch {
                    // WhatsApp not available — expected in production
                }
            }

            if (!sent) {
                console.error(`[Dunning] All delivery channels failed for ${invoice.invoiceNumber}, will retry next run`);
                continue; // Don't log the step if all sends failed — retry next run
            }
        }

        // Update dunning log in notes
        dunningLog.push(dunningStep);
        const updatedNotes = JSON.stringify({
            originalNote: typeof invoice.notes === 'string' && !invoice.notes.startsWith('{')
                ? invoice.notes
                : undefined,
            dunningLog,
            lastDunningAt: now.toISOString(),
        });

        await db.update(invoices)
            .set({
                notes: updatedNotes,
                updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoice.id));
    }

    if (reminded > 0 || escalated > 0) {
        console.log(`[Dunning] Complete: ${reminded} reminders sent, ${escalated} escalated to admin`);
    }

    return { reminded, escalated };
}
