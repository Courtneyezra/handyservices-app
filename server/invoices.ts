import { Router } from 'express';
import Stripe from 'stripe';
import { db } from './db';
import { invoices, contractorBookingRequests, personalizedQuotes, leads } from '../shared/schema';
import type { Invoice, InsertInvoice } from '../shared/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sendInvoiceEmail } from './email-service';
import { getInvoiceUpsells, getWhatsAppNumber, type InvoiceUpsell } from './invoice-upsells';

// Helper to get Stripe instance lazily
const getStripe = () => {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
    if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
        return null;
    }
    return new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
};

// Generate next invoice number with MAX+1 and retry on unique-constraint collision.
// Tolerates gaps from deleted invoices (COUNT+1 does not). Matches the pattern in
// server/invoice-generator.ts:175-217.
export async function insertInvoiceWithRetry(
    buildRow: (invoiceNumber: string) => Omit<InsertInvoice, 'invoiceNumber'>,
    maxRetries = 5,
): Promise<Invoice> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const [maxResult] = await db
            .select({ maxNum: sql<string>`max(invoice_number)` })
            .from(invoices);
        let nextSeq = 1;
        const match = maxResult?.maxNum?.match(/INV-\d{4}-(\d+)/);
        if (match) nextSeq = parseInt(match[1], 10) + 1;
        const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;
        try {
            const [created] = await db
                .insert(invoices)
                .values({ ...buildRow(invoiceNumber), invoiceNumber } as InsertInvoice)
                .returning();
            return created;
        } catch (err: any) {
            const isDuplicate = err?.code === '23505'
                || err?.message?.includes('unique')
                || err?.message?.includes('duplicate');
            if (isDuplicate && attempt < maxRetries - 1) continue;
            throw err;
        }
    }
    throw new Error('Failed to generate unique invoice number after retries');
}

// ---- WhatsApp message builders ----
function firstName(full: string | null | undefined): string {
    return (full || '').trim().split(/\s+/)[0] || 'there';
}

function pounds(pence: number | null | undefined): string {
    return `£${((pence ?? 0) / 100).toFixed(2)}`;
}

function buildSingleInvoiceMessage(
    _quote: typeof personalizedQuotes.$inferSelect,
    invoice: Invoice,
    link: string,
): string {
    // Build job list from line items (pricing-engine output — already polished),
    // not from raw jobDescription which may contain VA spelling/grammar issues.
    const lineItems = (invoice.lineItems as Array<{ description: string; isPropertyHeader?: boolean }> | null) || [];
    const jobItems = lineItems
        .filter((li) => !li?.isPropertyHeader && !/^\s*\+\s/.test(li?.description || ''))
        .map((li) => li.description)
        .filter(Boolean);

    const jobBlock = jobItems.length === 0
        ? 'Your invoice is ready.'
        : jobItems.length === 1
            ? `Your invoice for "${jobItems[0]}" is ready.`
            : `Your invoice is ready:\n${jobItems.map((j) => `• ${j}`).join('\n')}`;

    const hasDeposit = (invoice.depositPaid ?? 0) > 0;
    const amountBlock = hasDeposit
        ? `Total: *${pounds(invoice.totalAmount)}* · Deposit received: ${pounds(invoice.depositPaid)}\nBalance due: *${pounds(invoice.balanceDue)}*`
        : `Amount due: *${pounds(invoice.balanceDue)}*`;
    return `📄 *Invoice ${invoice.invoiceNumber}*

Hi ${firstName(invoice.customerName)},

${jobBlock}

${amountBlock}

View & pay: ${link}

Thank you for choosing Handy Services 👍`;
}

function buildConsolidatedInvoiceMessage(
    quotes: Array<typeof personalizedQuotes.$inferSelect>,
    parent: Invoice,
    link: string,
): string {
    const propertiesLine = quotes.length === 1 ? '1 property' : `${quotes.length} properties`;
    const hasDeposits = (parent.depositPaid ?? 0) > 0;
    const amountBlock = hasDeposits
        ? `Total: *${pounds(parent.totalAmount)}* · Deposits received: ${pounds(parent.depositPaid)}\nBalance due: *${pounds(parent.balanceDue)}*`
        : `Total due: *${pounds(parent.balanceDue)}*`;
    return `📄 *Invoice ${parent.invoiceNumber}*

Hi ${firstName(parent.customerName)},

Consolidated invoice for ${quotes.length} jobs across ${propertiesLine} is ready.

${amountBlock}

View & pay all: ${link}

Thank you for choosing Handy Services 👍`;
}

export const invoiceRouter = Router();

// B2: Generate Invoice from Job/Quote
invoiceRouter.post('/api/invoices/generate', async (req, res) => {
    try {
        const { jobId, quoteId } = req.body;

        if (!jobId && !quoteId) {
            return res.status(400).json({ error: 'Either jobId or quoteId is required' });
        }

        let job, quote;
        let totalAmount = 0;
        let depositPaid = 0;
        let customerName = '';
        let customerEmail = '';
        let customerPhone = '';
        let customerAddress = '';
        let contractorId = '';

        // Fetch job details if jobId provided
        if (jobId) {
            const jobResults = await db.select()
                .from(contractorBookingRequests)
                .where(eq(contractorBookingRequests.id, jobId))
                .limit(1);

            if (jobResults.length === 0) {
                return res.status(404).json({ error: 'Job not found' });
            }

            job = jobResults[0];
            customerName = job.customerName;
            customerEmail = job.customerEmail || '';
            customerPhone = job.customerPhone || '';
            contractorId = job.assignedContractorId || job.contractorId;

            // If job has a quote, fetch it for pricing
            if (job.quoteId) {
                const quoteResults = await db.select()
                    .from(personalizedQuotes)
                    .where(eq(personalizedQuotes.id, job.quoteId))
                    .limit(1);

                if (quoteResults.length > 0) {
                    quote = quoteResults[0];
                }
            }
        }

        // Fetch quote details if quoteId provided (and not already fetched)
        if (quoteId && !quote) {
            const quoteResults = await db.select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, quoteId))
                .limit(1);

            if (quoteResults.length === 0) {
                return res.status(404).json({ error: 'Quote not found' });
            }

            quote = quoteResults[0];
            customerName = quote.customerName;
            customerEmail = quote.email || '';
            customerPhone = quote.phone;
            customerAddress = quote.address || '';
            contractorId = quote.contractorId || '';
        }

        // Calculate total amount from quote
        if (quote) {
            if (quote.quoteMode === 'simple') {
                totalAmount = quote.basePrice || 0;
            } else if (quote.selectedPackage) {
                // HHH mode - use selected tier
                const tierPriceMap: Record<string, number | null | undefined> = {
                    essential: quote.essentialPrice,
                    enhanced: quote.enhancedPrice,
                    elite: quote.elitePrice
                };
                totalAmount = tierPriceMap[quote.selectedPackage] || 0;
            }

            // Add selected extras
            if (quote.selectedExtras && Array.isArray(quote.selectedExtras)) {
                const optionalExtras = (quote.optionalExtras as any[]) || [];
                for (const extraLabel of quote.selectedExtras) {
                    const extra = optionalExtras.find((e: any) => e.label === extraLabel);
                    if (extra) {
                        totalAmount += extra.priceInPence || 0;
                    }
                }
            }

            // Check if deposit was paid
            if (quote.depositPaidAt && quote.depositAmountPence) {
                depositPaid = quote.depositAmountPence;
            }
        }

        const balanceDue = totalAmount - depositPaid;

        // Create line items
        const lineItems = [];
        if (quote) {
            if (quote.quoteMode === 'simple') {
                lineItems.push({
                    description: quote.jobDescription || 'Service',
                    quantity: 1,
                    unitPrice: totalAmount,
                    total: totalAmount
                });
            } else if (quote.selectedPackage) {
                lineItems.push({
                    description: `${quote.selectedPackage.charAt(0).toUpperCase() + quote.selectedPackage.slice(1)} Package`,
                    quantity: 1,
                    unitPrice: totalAmount - (depositPaid || 0),
                    total: totalAmount - (depositPaid || 0)
                });
            }
        }

        // Create invoice (MAX+1 numbering with retry on collisions)
        const createdInvoice = await insertInvoiceWithRetry((invoiceNumber) => ({
            id: uuidv4(),
            invoiceNumber,
            quoteId: quote?.id || quoteId,
            customerId: null,
            contractorId,
            customerName,
            customerEmail,
            customerPhone,
            customerAddress,
            totalAmount,
            depositPaid,
            balanceDue,
            lineItems: lineItems as any,
            status: 'draft' as const,
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
            paymentMethod: null,
            notes: null,
            customerNotes: null,
        }));

        // Update job with invoice reference if jobId provided
        if (jobId) {
            await db.update(contractorBookingRequests)
                .set({ invoiceId: createdInvoice.id })
                .where(eq(contractorBookingRequests.id, jobId));
        }

        res.json({
            success: true,
            invoice: createdInvoice
        });

    } catch (error: any) {
        console.error('[Invoices] Error generating invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to generate invoice' });
    }
});

// C1: Create Manual Invoice (Contractor)
invoiceRouter.post('/api/invoices', async (req, res) => {
    try {
        const {
            contractorId,
            customerName,
            customerEmail,
            customerPhone,
            customerAddress,
            lineItems,
            dueDate,
            notes
        } = req.body;

        if (!contractorId || !customerName || !lineItems || lineItems.length === 0) {
            return res.status(400).json({ error: 'Missing required fields: contractorId, customerName, lineItems' });
        }

        // Calculate totals
        let totalAmount = 0;
        const processedLineItems = lineItems.map((item: any) => {
            const total = (item.quantity || 1) * (item.unitPrice || 0);
            totalAmount += total;
            return {
                ...item,
                total
            };
        });

        const createdInvoice = await insertInvoiceWithRetry((invoiceNumber) => ({
            id: uuidv4(),
            invoiceNumber,
            contractorId,
            customerId: null, // Ad-hoc customer
            customerName,
            customerEmail,
            customerPhone,
            customerAddress,
            totalAmount,
            depositPaid: 0,
            balanceDue: totalAmount,
            lineItems: processedLineItems,
            status: 'draft' as const,
            dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            notes: notes || null,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        res.json({
            success: true,
            invoice: createdInvoice
        });

    } catch (error: any) {
        console.error('[Invoices] Error creating manual invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to create invoice' });
    }
});

// Get invoice HTML (for browser viewing / printing)
invoiceRouter.get('/api/invoices/:id/html', async (req, res) => {
    try {
        const { id } = req.params;
        const { generateInvoiceHtml } = await import('./invoice-generator');
        const html = await generateInvoiceHtml(id);

        if (!html) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error: any) {
        console.error('[Invoices] Error generating invoice HTML:', error);
        res.status(500).json({ error: error.message || 'Failed to generate invoice HTML' });
    }
});

// Get invoice by ID
invoiceRouter.get('/api/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const results = await db.select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        res.json(results[0]);
    } catch (error: any) {
        console.error('[Invoices] Error fetching invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch invoice' });
    }
});

// Get invoice by quote ID (for confirmation screen)
invoiceRouter.get('/api/invoices/by-quote/:quoteId', async (req, res) => {
    try {
        const { quoteId } = req.params;

        const results = await db.select()
            .from(invoices)
            .where(eq(invoices.quoteId, quoteId))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found for this quote' });
        }

        res.json(results[0]);
    } catch (error: any) {
        console.error('[Invoices] Error fetching invoice by quote:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch invoice' });
    }
});

// List invoices with filters
invoiceRouter.get('/api/invoices', async (req, res) => {
    try {
        const { status, customerId, contractorId } = req.query;

        let query = db.select().from(invoices);

        if (status) {
            query = query.where(eq(invoices.status, status as string)) as any;
        }

        const results = await query;

        res.json(results);
    } catch (error: any) {
        console.error('[Invoices] Error listing invoices:', error);
        res.status(500).json({ error: error.message || 'Failed to list invoices' });
    }
});

// Mark invoice as paid (manual)
invoiceRouter.post('/api/invoices/:id/mark-paid', async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentMethod = 'other' } = req.body;

        const [updated] = await db.update(invoices)
            .set({
                status: 'paid',
                paidAt: new Date(),
                paymentMethod,
                updatedAt: new Date()
            })
            .where(eq(invoices.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        res.json({ success: true, invoice: updated });
    } catch (error: any) {
        console.error('[Invoices] Error marking invoice as paid:', error);
        res.status(500).json({ error: error.message || 'Failed to mark invoice as paid' });
    }
});

// Send invoice to customer via WhatsApp (and mark as sent)
invoiceRouter.post('/api/invoices/:id/send', async (req, res) => {
    try {
        const { id } = req.params;

        const results = await db.select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = results[0];

        // Mark as sent
        const [updated] = await db.update(invoices)
            .set({
                status: 'sent',
                sentAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(invoices.id, id))
            .returning();

        // Send via email (primary delivery method)
        const deliveryResults: { email?: boolean; whatsapp?: boolean } = {};
        const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
        const paymentLink = `${baseUrl}/invoice/${invoice.id}`;

        if (invoice.customerEmail) {
            const emailResult = await sendInvoiceEmail({
                customerName: invoice.customerName || '',
                customerEmail: invoice.customerEmail,
                invoiceNumber: invoice.invoiceNumber,
                totalAmount: invoice.totalAmount,
                depositPaid: invoice.depositPaid,
                balanceDue: invoice.balanceDue,
                dueDate: invoice.dueDate,
                paymentLink,
                invoiceId: invoice.id,
            });
            deliveryResults.email = emailResult.success;
            if (emailResult.success) {
                console.log(`[Invoices] Invoice ${invoice.invoiceNumber} sent via email to ${invoice.customerEmail}`);
            }
        }

        // Optional WhatsApp fallback (non-blocking, will silently fail if not available)
        if (invoice.customerPhone) {
            try {
                const { sendWhatsAppMessage } = await import('./meta-whatsapp');
                const formatPence = (p: number) => `\u00a3${(p / 100).toFixed(2)}`;
                const message = [
                    `\ud83d\udcc4 *Invoice ${invoice.invoiceNumber}*`,
                    '',
                    `Hi ${invoice.customerName || 'there'},`,
                    '',
                    `Your invoice for *${formatPence(invoice.balanceDue)}* is ready.`,
                    '',
                    `View & pay: ${paymentLink}`,
                    '',
                    `Thank you for choosing Handy Services \ud83d\udc4d`,
                ].filter(Boolean).join('\n');

                await sendWhatsAppMessage(invoice.customerPhone, message);
                deliveryResults.whatsapp = true;
            } catch {
                // WhatsApp not available in production — this is expected
                deliveryResults.whatsapp = false;
            }
        }

        const deliveryMessage = deliveryResults.email
            ? `Invoice sent via email to ${invoice.customerEmail}`
            : deliveryResults.whatsapp
                ? `Invoice sent via WhatsApp to ${invoice.customerPhone}`
                : 'Invoice marked as sent but no delivery channel available (no email on file).';

        res.json({
            success: true,
            invoice: updated,
            delivery: deliveryResults,
            message: deliveryMessage,
        });
    } catch (error: any) {
        console.error('[Invoices] Error sending invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to send invoice' });
    }
});

// Pay invoice balance via Stripe
invoiceRouter.post('/api/invoices/:id/pay', async (req, res) => {
    try {
        const { id } = req.params;
        const { payerEmail } = req.body;

        const stripe = getStripe();
        if (!stripe) {
            return res.status(500).json({ error: 'Payment processing not configured' });
        }

        // Fetch invoice
        const results = await db.select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = results[0];

        if (invoice.status === 'paid') {
            return res.status(400).json({ error: 'Invoice already paid' });
        }

        if (invoice.balanceDue <= 0) {
            return res.status(400).json({ error: 'No balance due' });
        }

        // Create payment intent for balance
        const paymentIntent = await stripe.paymentIntents.create({
            amount: invoice.balanceDue,
            currency: 'gbp',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                invoiceId: id,
                invoiceNumber: invoice.invoiceNumber,
                paymentType: 'balance_payment',
            },
            receipt_email: payerEmail || invoice.customerEmail || undefined,
            description: `Balance payment for ${invoice.invoiceNumber}`,
        });

        console.log(`[Invoices] Created payment intent ${paymentIntent.id} for invoice ${invoice.invoiceNumber}`);

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            amount: invoice.balanceDue,
            invoiceNumber: invoice.invoiceNumber,
        });

    } catch (error: any) {
        console.error('[Invoices] Error creating payment:', error);
        res.status(500).json({ error: error.message || 'Failed to create payment' });
    }
});

// ==========================================
// PUBLIC INVOICE PAGE (with quote context + upsells)
// ==========================================

invoiceRouter.get('/api/invoices/public/:invoiceId', async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const results = await db.select()
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .limit(1);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = results[0];

        // Fetch quote context if available
        let quoteContext: {
            jobDescription: string;
            address: string;
            customerName: string;
            segment: string | null;
            pricingLineItems: any;
        } | null = null;

        if (invoice.quoteId) {
            const quoteResults = await db.select()
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, invoice.quoteId))
                .limit(1);

            if (quoteResults.length > 0) {
                const quote = quoteResults[0];
                quoteContext = {
                    jobDescription: quote.jobDescription || '',
                    address: quote.address || '',
                    customerName: quote.customerName,
                    segment: quote.segment,
                    pricingLineItems: quote.pricingLineItems,
                };
            }
        }

        // Fetch job evidence photos if available
        let jobEvidence: { evidenceUrls: string[]; completedAt: string | null; completionNotes: string | null } | null = null;

        if (invoice.quoteId) {
            const jobResults = await db.select()
                .from(contractorBookingRequests)
                .where(eq(contractorBookingRequests.quoteId, invoice.quoteId))
                .limit(1);

            if (jobResults.length > 0 && jobResults[0].status === 'completed') {
                jobEvidence = {
                    evidenceUrls: (jobResults[0].evidenceUrls as string[]) || [],
                    completedAt: jobResults[0].completedAt ? jobResults[0].completedAt.toISOString() : null,
                    completionNotes: jobResults[0].completionNotes,
                };
            }
        }

        // Get contextual upsells
        const upsellContext = {
            customerName: invoice.customerName || quoteContext?.customerName || '',
            jobDescription: quoteContext?.jobDescription || '',
            notes: invoice.notes || '',
            lineItems: (invoice.lineItems as any[]) || [],
        };

        const upsells = getInvoiceUpsells(upsellContext);
        const whatsappNumber = getWhatsAppNumber();

        res.json({
            invoice: {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                customerName: invoice.customerName,
                customerEmail: invoice.customerEmail,
                customerPhone: invoice.customerPhone,
                customerAddress: invoice.customerAddress,
                totalAmount: invoice.totalAmount,
                depositPaid: invoice.depositPaid,
                balanceDue: invoice.balanceDue,
                lineItems: invoice.lineItems,
                status: invoice.status,
                dueDate: invoice.dueDate,
                paidAt: invoice.paidAt,
                createdAt: invoice.createdAt,
            },
            quoteContext,
            jobEvidence,
            upsells,
            whatsappNumber,
        });

    } catch (error: any) {
        console.error('[Invoices] Error fetching public invoice:', error);
        res.status(500).json({ error: 'Failed to fetch invoice' });
    }
});

// ==========================================
// MANUAL INVOICE GENERATION (for Panda / ad-hoc jobs)
// ==========================================

invoiceRouter.post('/api/invoices/generate-manual', async (req, res) => {
    try {
        const {
            customerName,
            customerEmail,
            customerPhone,
            customerAddress,
            lineItems,
            notes,
            dueDate,
        } = req.body;

        if (!customerName || !lineItems || lineItems.length === 0) {
            return res.status(400).json({ error: 'customerName and lineItems are required' });
        }

        // Calculate totals
        let totalAmount = 0;
        const processedLineItems = lineItems.map((item: any) => {
            const quantity = item.quantity || 1;
            const unitPrice = item.unitPrice || item.priceInPence || 0;
            const total = quantity * unitPrice;
            totalAmount += total;
            return {
                description: item.description,
                quantity,
                unitPrice,
                total,
            };
        });

        const invoiceId = uuidv4();
        const createdInvoice = await insertInvoiceWithRetry((invoiceNumber) => ({
            id: invoiceId,
            invoiceNumber,
            quoteId: null,
            customerId: null,
            contractorId: null,
            customerName,
            customerEmail: customerEmail || null,
            customerPhone: customerPhone || null,
            customerAddress: customerAddress || null,
            totalAmount,
            depositPaid: 0,
            balanceDue: totalAmount,
            lineItems: processedLineItems as any,
            status: 'draft' as const,
            dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            notes: notes || null,
            paymentMethod: null,
            customerNotes: null,
        }));

        const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';
        const invoiceLink = `${baseUrl}/invoice/${invoiceId}`;

        res.json({
            success: true,
            invoice: createdInvoice,
            invoiceLink,
        });

    } catch (error: any) {
        console.error('[Invoices] Error generating manual invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to generate invoice' });
    }
});

// ==========================================
// MARK QUOTES AS COMPLETED
// ==========================================

invoiceRouter.post('/api/quotes/mark-complete', async (req, res) => {
    try {
        const { quoteIds } = req.body;

        if (!quoteIds || !Array.isArray(quoteIds) || quoteIds.length === 0) {
            return res.status(400).json({ error: 'quoteIds array is required' });
        }

        const updated = await db.update(personalizedQuotes)
            .set({ completedAt: new Date() })
            .where(inArray(personalizedQuotes.id, quoteIds))
            .returning({ id: personalizedQuotes.id, customerName: personalizedQuotes.customerName });

        console.log(`[Invoices] Marked ${updated.length} quotes as completed`);

        res.json({
            success: true,
            completed: updated.length,
            quotes: updated,
        });
    } catch (error: any) {
        console.error('[Invoices] Error marking quotes complete:', error);
        res.status(500).json({ error: error.message || 'Failed to mark quotes as complete' });
    }
});

// ==========================================
// CONSOLIDATED INVOICE (multiple quotes → one invoice, grouped by property)
// ==========================================

// Build line items + totals for a single quote. Used by both single and bulk paths.
function buildQuoteLineItems(quote: typeof personalizedQuotes.$inferSelect) {
    const deposit = quote.depositAmountPence || 0;
    const quoteBasePrice = quote.basePrice || 0;
    const pricingLineItems = (quote.pricingLineItems as any[]) || [];
    const address = quote.address || quote.postcode || 'Unspecified property';

    const lineItems: any[] = [];
    if (pricingLineItems.length > 0) {
        for (const li of pricingLineItems) {
            const labourPrice = li.guardedPricePence || li.llmSuggestedPricePence || li.referencePricePence || 0;
            const materialsPrice = li.materialsWithMarginPence || 0;
            const fullPrice = labourPrice + materialsPrice;
            lineItems.push({
                description: li.description,
                quantity: 1,
                unitPrice: fullPrice,
                total: fullPrice,
            });
        }
    } else {
        lineItems.push({
            description: quote.jobDescription || 'Service',
            quantity: 1,
            unitPrice: quoteBasePrice,
            total: quoteBasePrice,
        });
    }

    let extrasTotal = 0;
    if (quote.selectedExtras && Array.isArray(quote.selectedExtras)) {
        const optionalExtras = (quote.optionalExtras as any[]) || [];
        for (const extraLabel of quote.selectedExtras as string[]) {
            const extra = optionalExtras.find((e: any) => e.label === extraLabel);
            if (extra && extra.priceInPence) {
                lineItems.push({
                    description: `  + ${extra.label}`,
                    quantity: 1,
                    unitPrice: extra.priceInPence,
                    total: extra.priceInPence,
                });
                extrasTotal += extra.priceInPence;
            }
        }
    }

    const quoteTotal = quoteBasePrice + extrasTotal;
    return { lineItems, quoteTotal, deposit, quoteBalance: quoteTotal - deposit, address };
}

invoiceRouter.post('/api/invoices/consolidated', async (req, res) => {
    try {
        const { quoteIds, customerName, customerEmail, customerPhone } = req.body;

        if (!quoteIds || !Array.isArray(quoteIds) || quoteIds.length === 0) {
            return res.status(400).json({ error: 'quoteIds array is required' });
        }

        // Fetch all quotes
        const quotes = await db.select()
            .from(personalizedQuotes)
            .where(inArray(personalizedQuotes.id, quoteIds));

        if (quotes.length === 0) {
            return res.status(404).json({ error: 'No quotes found' });
        }

        const firstQuote = quotes[0];
        const effectiveName = customerName || firstQuote.customerName;
        const effectiveEmail = customerEmail || firstQuote.email || null;
        const effectivePhone = customerPhone || firstQuote.phone || null;
        const baseUrl = process.env.BASE_URL || 'https://handyservices.uk';

        // ---- Single-quote path: create one plain invoice, no parent wrapper ----
        if (quotes.length === 1) {
            const quote = quotes[0];
            const { lineItems, quoteTotal, deposit, quoteBalance, address } = buildQuoteLineItems(quote);

            const created = await insertInvoiceWithRetry((invoiceNumber) => ({
                id: uuidv4(),
                invoiceNumber,
                quoteId: quote.id,
                customerId: null,
                contractorId: null,
                customerName: effectiveName,
                customerEmail: effectiveEmail,
                customerPhone: effectivePhone,
                customerAddress: address,
                totalAmount: quoteTotal,
                depositPaid: deposit,
                balanceDue: quoteBalance,
                lineItems: lineItems as any,
                status: 'draft' as const,
                dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                notes: null,
                paymentMethod: null,
                customerNotes: null,
            }));

            const invoiceLink = `${baseUrl}/invoice/${created.id}`;
            const whatsappMessage = buildSingleInvoiceMessage(quote, created, invoiceLink);

            console.log(`[Invoices] Single: ${created.invoiceNumber} for quote ${quote.id}. Total: £${(quoteTotal / 100).toFixed(2)}, Balance: £${(quoteBalance / 100).toFixed(2)}`);

            return res.json({
                success: true,
                invoice: created,
                invoiceLink,
                whatsappMessage,
                summary: {
                    totalQuotes: 1,
                    totalProperties: 1,
                    grandTotal: quoteTotal,
                    totalDeposits: deposit,
                    balanceDue: quoteBalance,
                },
            });
        }

        // ---- Bulk path: children + consolidated parent ----
        const childInvoices: any[] = [];
        let grandTotal = 0;
        let totalDeposits = 0;

        for (const quote of quotes) {
            const { lineItems, quoteTotal, deposit, quoteBalance, address } = buildQuoteLineItems(quote);

            const created = await insertInvoiceWithRetry((invoiceNumber) => ({
                id: uuidv4(),
                invoiceNumber,
                quoteId: quote.id,
                customerId: null,
                contractorId: null,
                customerName: effectiveName,
                customerEmail: effectiveEmail,
                customerPhone: effectivePhone,
                customerAddress: address,
                totalAmount: quoteTotal,
                depositPaid: deposit,
                balanceDue: quoteBalance,
                lineItems: lineItems as any,
                status: 'draft' as const,
                dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                notes: null,
                paymentMethod: null,
                customerNotes: null,
            }));
            childInvoices.push({ ...created, propertyAddress: address });

            grandTotal += quoteTotal;
            totalDeposits += deposit;
        }

        const balanceDue = grandTotal - totalDeposits;

        // Build consolidated line items with per-quote sections
        const consolidatedLineItems: any[] = [];
        for (const child of childInvoices) {
            consolidatedLineItems.push({
                description: `--- ${child.propertyAddress} ---`,
                quantity: 0,
                unitPrice: 0,
                total: 0,
                isPropertyHeader: true,
                propertyAddress: child.propertyAddress,
                invoiceNumber: child.invoiceNumber,
                sectionTotal: child.totalAmount,
                sectionDeposit: child.depositPaid,
                sectionBalance: child.balanceDue,
            });
            for (const item of (child.lineItems as any[])) {
                consolidatedLineItems.push({
                    ...item,
                    propertyAddress: child.propertyAddress,
                    invoiceNumber: child.invoiceNumber,
                });
            }
        }

        const parentId = uuidv4();
        const createdParent = await insertInvoiceWithRetry((invoiceNumber) => ({
            id: parentId,
            invoiceNumber,
            quoteId: null,
            customerId: null,
            contractorId: null,
            customerName: effectiveName,
            customerEmail: effectiveEmail,
            customerPhone: effectivePhone,
            customerAddress: null,
            totalAmount: grandTotal,
            depositPaid: totalDeposits,
            balanceDue,
            lineItems: consolidatedLineItems as any,
            status: 'draft' as const,
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            notes: JSON.stringify({
                isConsolidated: true,
                childInvoiceIds: childInvoices.map((c: any) => c.id),
                childInvoiceNumbers: childInvoices.map((c: any) => c.invoiceNumber),
            }),
            paymentMethod: null,
            customerNotes: null,
        }));

        const invoiceLink = `${baseUrl}/invoice/${parentId}`;
        const whatsappMessage = buildConsolidatedInvoiceMessage(quotes, createdParent, invoiceLink);

        console.log(`[Invoices] Consolidated: parent ${createdParent.invoiceNumber} with ${childInvoices.length} child invoices. Total: £${(grandTotal / 100).toFixed(2)}, Balance: £${(balanceDue / 100).toFixed(2)}`);

        res.json({
            success: true,
            invoice: createdParent,
            invoiceLink,
            whatsappMessage,
            childInvoices: childInvoices.map((c: any) => ({
                id: c.id,
                invoiceNumber: c.invoiceNumber,
                address: c.propertyAddress,
                total: c.totalAmount,
                deposit: c.depositPaid,
                balance: c.balanceDue,
            })),
            summary: {
                totalQuotes: quotes.length,
                totalProperties: quotes.length,
                grandTotal,
                totalDeposits,
                balanceDue,
            },
        });

    } catch (error: any) {
        console.error('[Invoices] Error generating consolidated invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to generate consolidated invoice' });
    }
});

export default invoiceRouter;
