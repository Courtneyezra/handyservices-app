import { Router } from 'express';
import { db } from './db';
import { invoices, invoiceTokens, contractorReviews, personalizedQuotes, handymanProfiles } from '../shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const clientPortalRouter = Router();

function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

// ==========================================
// INVOICE TOKENS
// ==========================================

// Create invoice token for client access
clientPortalRouter.post('/api/client-portal/invoices/:invoiceId/token', async (req, res) => {
    try {
        const inv = await db.select()
            .from(invoices)
            .where(eq(invoices.id, req.params.invoiceId))
            .limit(1);

        if (inv.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Check if token exists
        const existing = await db.select()
            .from(invoiceTokens)
            .where(eq(invoiceTokens.invoiceId, req.params.invoiceId))
            .limit(1);

        if (existing.length > 0) {
            return res.json(existing[0]);
        }

        const token = {
            id: uuidv4(),
            invoiceId: req.params.invoiceId,
            token: generateToken(),
            viewCount: 0,
        };

        await db.insert(invoiceTokens).values(token);
        res.status(201).json(token);
    } catch (error) {
        console.error('Failed to create invoice token:', error);
        res.status(500).json({ error: 'Failed to create invoice token' });
    }
});

// Get invoice by token (public)
clientPortalRouter.get('/api/client-portal/invoices/token/:token', async (req, res) => {
    try {
        const tokens = await db.select()
            .from(invoiceTokens)
            .where(eq(invoiceTokens.token, req.params.token))
            .limit(1);

        if (tokens.length === 0) {
            return res.status(404).json({ error: 'Invalid token' });
        }

        const tokenRecord = tokens[0];

        if (tokenRecord.expiresAt && new Date() > tokenRecord.expiresAt) {
            return res.status(410).json({ error: 'Link has expired' });
        }

        const inv = await db.select()
            .from(invoices)
            .where(eq(invoices.id, tokenRecord.invoiceId))
            .limit(1);

        if (inv.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Update view count
        await db.update(invoiceTokens)
            .set({
                viewCount: (tokenRecord.viewCount || 0) + 1,
                lastViewedAt: new Date(),
            })
            .where(eq(invoiceTokens.id, tokenRecord.id));

        res.json({ invoice: inv[0], token: tokenRecord.token });
    } catch (error) {
        console.error('Failed to fetch invoice:', error);
        res.status(500).json({ error: 'Failed to fetch invoice' });
    }
});

// ==========================================
// REVIEWS
// ==========================================

// Create review request (generates token)
clientPortalRouter.post('/api/client-portal/reviews/request', async (req, res) => {
    try {
        const { contractorId, customerName, customerEmail, quoteId } = req.body;

        if (!contractorId || !customerName) {
            return res.status(400).json({ error: 'contractorId and customerName required' });
        }

        const review = {
            id: uuidv4(),
            contractorId,
            customerName,
            customerEmail: customerEmail || null,
            quoteId: quoteId || null,
            overallRating: 0, // Will be set on submission
            reviewToken: generateToken(),
            isVerified: !!quoteId,
            isPublic: true,
        };

        await db.insert(contractorReviews).values(review);

        res.status(201).json({
            id: review.id,
            reviewToken: review.reviewToken,
            reviewUrl: `/review/${review.reviewToken}`,
        });
    } catch (error) {
        console.error('Failed to create review request:', error);
        res.status(500).json({ error: 'Failed to create review request' });
    }
});

// Get review by token (public - for submission page)
clientPortalRouter.get('/api/client-portal/reviews/token/:token', async (req, res) => {
    try {
        const reviews = await db.select()
            .from(contractorReviews)
            .where(eq(contractorReviews.reviewToken, req.params.token))
            .limit(1);

        if (reviews.length === 0) {
            return res.status(404).json({ error: 'Review link not found' });
        }

        const review = reviews[0];

        if (review.overallRating > 0) {
            return res.status(410).json({ error: 'Review already submitted' });
        }

        // Get contractor info
        const contractors = await db.select({
            businessName: handymanProfiles.businessName,
            profileImageUrl: handymanProfiles.profileImageUrl,
        })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, review.contractorId))
            .limit(1);

        res.json({
            id: review.id,
            customerName: review.customerName,
            isVerified: review.isVerified,
            contractor: contractors[0] || null,
        });
    } catch (error) {
        console.error('Failed to fetch review:', error);
        res.status(500).json({ error: 'Failed to fetch review' });
    }
});

// Submit review (public)
clientPortalRouter.post('/api/client-portal/reviews/token/:token/submit', async (req, res) => {
    try {
        const reviews = await db.select()
            .from(contractorReviews)
            .where(eq(contractorReviews.reviewToken, req.params.token))
            .limit(1);

        if (reviews.length === 0) {
            return res.status(404).json({ error: 'Review link not found' });
        }

        const review = reviews[0];

        if (review.overallRating > 0) {
            return res.status(400).json({ error: 'Already submitted' });
        }

        const {
            overallRating,
            qualityRating,
            timelinessRating,
            communicationRating,
            valueRating,
            reviewText,
        } = req.body;

        if (!overallRating || overallRating < 1 || overallRating > 5) {
            return res.status(400).json({ error: 'Rating must be 1-5' });
        }

        await db.update(contractorReviews)
            .set({
                overallRating,
                qualityRating: qualityRating || null,
                timelinessRating: timelinessRating || null,
                communicationRating: communicationRating || null,
                valueRating: valueRating || null,
                reviewText: reviewText || null,
                reviewToken: null, // Clear token after use
            })
            .where(eq(contractorReviews.id, review.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to submit review:', error);
        res.status(500).json({ error: 'Failed to submit review' });
    }
});

// Get public reviews for contractor
clientPortalRouter.get('/api/client-portal/reviews/contractor/:contractorId', async (req, res) => {
    try {
        const reviews = await db.select()
            .from(contractorReviews)
            .where(and(
                eq(contractorReviews.contractorId, req.params.contractorId),
                eq(contractorReviews.isPublic, true),
            ))
            .orderBy(desc(contractorReviews.createdAt));

        // Only return submitted reviews
        const submittedReviews = reviews.filter(r => r.overallRating > 0);

        // Calculate stats
        const count = submittedReviews.length;
        const avgRating = count > 0
            ? submittedReviews.reduce((sum, r) => sum + r.overallRating, 0) / count
            : 0;

        res.json({
            reviews: submittedReviews.map(r => ({
                id: r.id,
                customerName: r.customerName,
                overallRating: r.overallRating,
                qualityRating: r.qualityRating,
                timelinessRating: r.timelinessRating,
                communicationRating: r.communicationRating,
                valueRating: r.valueRating,
                reviewText: r.reviewText,
                isVerified: r.isVerified,
                contractorResponse: r.contractorResponse,
                createdAt: r.createdAt,
            })),
            stats: { count, averageRating: avgRating },
        });
    } catch (error) {
        console.error('Failed to fetch reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// Contractor responds to review
clientPortalRouter.post('/api/client-portal/reviews/:reviewId/respond', async (req, res) => {
    try {
        const { response, contractorId } = req.body;

        const reviews = await db.select()
            .from(contractorReviews)
            .where(eq(contractorReviews.id, req.params.reviewId))
            .limit(1);

        if (reviews.length === 0) {
            return res.status(404).json({ error: 'Review not found' });
        }

        if (reviews[0].contractorId !== contractorId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await db.update(contractorReviews)
            .set({
                contractorResponse: response,
                respondedAt: new Date(),
            })
            .where(eq(contractorReviews.id, req.params.reviewId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to respond to review:', error);
        res.status(500).json({ error: 'Failed to respond' });
    }
});
