import { Router } from 'express';
import { db } from './db';
import { paymentLinks, invoices, handymanProfiles } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const paymentLinksRouter = Router();

// Generate short code for payment links
function generateShortCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Get all payment links for a contractor
paymentLinksRouter.get('/api/payment-links', async (req, res) => {
    try {
        const { contractorId } = req.query;

        if (!contractorId) {
            return res.status(400).json({ error: 'contractorId is required' });
        }

        const links = await db.select()
            .from(paymentLinks)
            .where(eq(paymentLinks.contractorId, contractorId as string))
            .orderBy(desc(paymentLinks.createdAt));

        res.json(links);
    } catch (error) {
        console.error('Failed to fetch payment links:', error);
        res.status(500).json({ error: 'Failed to fetch payment links' });
    }
});

// Get payment link by short code (public)
paymentLinksRouter.get('/api/pay/:shortCode', async (req, res) => {
    try {
        const links = await db.select()
            .from(paymentLinks)
            .where(eq(paymentLinks.shortCode, req.params.shortCode))
            .limit(1);

        if (links.length === 0) {
            return res.status(404).json({ error: 'Payment link not found' });
        }

        const link = links[0];

        if (link.expiresAt && new Date() > link.expiresAt) {
            return res.status(410).json({ error: 'Payment link has expired' });
        }

        if (link.status === 'paid') {
            return res.status(410).json({ error: 'Payment already completed', paidAt: link.paidAt });
        }

        // Get contractor info for display
        const contractors = await db.select({
            businessName: handymanProfiles.businessName,
            profileImageUrl: handymanProfiles.profileImageUrl,
        })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, link.contractorId))
            .limit(1);

        res.json({
            ...link,
            contractor: contractors[0] || null,
        });
    } catch (error) {
        console.error('Failed to fetch payment link:', error);
        res.status(500).json({ error: 'Failed to fetch payment link' });
    }
});

// Create payment link
paymentLinksRouter.post('/api/payment-links', async (req, res) => {
    try {
        const {
            contractorId,
            quoteId,
            invoiceId,
            amountPence,
            description,
            customerName,
            customerEmail,
            expiresIn,
        } = req.body;

        if (!contractorId) {
            return res.status(400).json({ error: 'contractorId is required' });
        }

        if (!amountPence || amountPence <= 0) {
            return res.status(400).json({ error: 'amountPence must be positive' });
        }

        let expiresAt = null;
        if (expiresIn) {
            expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + expiresIn);
        }

        const newLink = {
            id: uuidv4(),
            contractorId,
            quoteId: quoteId || null,
            invoiceId: invoiceId || null,
            shortCode: generateShortCode(),
            amountPence,
            description: description || null,
            customerName: customerName || null,
            customerEmail: customerEmail || null,
            status: 'active',
            expiresAt,
        };

        await db.insert(paymentLinks).values(newLink);
        res.status(201).json(newLink);
    } catch (error) {
        console.error('Failed to create payment link:', error);
        res.status(500).json({ error: 'Failed to create payment link' });
    }
});

// Mark payment as complete
paymentLinksRouter.post('/api/pay/:shortCode/complete', async (req, res) => {
    try {
        const links = await db.select()
            .from(paymentLinks)
            .where(eq(paymentLinks.shortCode, req.params.shortCode))
            .limit(1);

        if (links.length === 0) {
            return res.status(404).json({ error: 'Payment link not found' });
        }

        const link = links[0];

        if (link.status === 'paid') {
            return res.status(400).json({ error: 'Already paid' });
        }

        const { stripePaymentIntentId } = req.body;

        await db.update(paymentLinks)
            .set({
                status: 'paid',
                paidAt: new Date(),
                stripePaymentIntentId: stripePaymentIntentId || null,
            })
            .where(eq(paymentLinks.id, link.id));

        // If linked to invoice, update invoice
        if (link.invoiceId) {
            await db.update(invoices)
                .set({
                    status: 'paid',
                    paidAt: new Date(),
                    balanceDue: 0,
                })
                .where(eq(invoices.id, link.invoiceId));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to complete payment:', error);
        res.status(500).json({ error: 'Failed to complete payment' });
    }
});

// Cancel payment link
paymentLinksRouter.post('/api/payment-links/:id/cancel', async (req, res) => {
    try {
        await db.update(paymentLinks)
            .set({ status: 'cancelled' })
            .where(eq(paymentLinks.id, req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to cancel payment link:', error);
        res.status(500).json({ error: 'Failed to cancel payment link' });
    }
});
