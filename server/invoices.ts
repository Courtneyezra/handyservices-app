import { Router } from 'express';
import { db } from './db';
import { invoices, contractorBookingRequests, personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

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

        // Generate invoice number (simple sequential for now)
        const year = new Date().getFullYear();
        const existingInvoices = await db.select()
            .from(invoices)
            .orderBy(invoices.createdAt);
        const invoiceNumber = `INV-${year}-${String(existingInvoices.length + 1).padStart(4, '0')}`;

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

        // Create invoice
        const newInvoice = {
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
        };

        const [createdInvoice] = await db.insert(invoices).values(newInvoice).returning();

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

        // Generate invoice number
        const year = new Date().getFullYear();
        const existingInvoices = await db.select().from(invoices); // Optimizable: usage of count
        const invoiceNumber = `INV-${year}-${String(existingInvoices.length + 1).padStart(4, '0')}`;

        const newInvoice = {
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
        };

        const [createdInvoice] = await db.insert(invoices).values(newInvoice).returning();

        res.json({
            success: true,
            invoice: createdInvoice
        });

    } catch (error: any) {
        console.error('[Invoices] Error creating manual invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to create invoice' });
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

// Send invoice to customer (placeholder - would integrate with email service)
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

        // TODO: Integrate with email service (SendGrid, etc.)
        // For now, just mark as sent
        const [updated] = await db.update(invoices)
            .set({
                status: 'sent',
                sentAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(invoices.id, id))
            .returning();

        console.log(`[Invoices] Would send invoice ${invoice.invoiceNumber} to ${invoice.customerEmail}`);

        res.json({
            success: true,
            invoice: updated,
            message: 'Invoice marked as sent. Email integration pending.'
        });
    } catch (error: any) {
        console.error('[Invoices] Error sending invoice:', error);
        res.status(500).json({ error: error.message || 'Failed to send invoice' });
    }
});

export default invoiceRouter;
