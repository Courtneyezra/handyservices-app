import { Router } from 'express';
import { db } from './db';
import { partnerApplications, clientReferences, trainingProgress, trainingModules, handymanProfiles } from '../shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const partnerApplicationRouter = Router();

function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

// Get or create application for contractor
partnerApplicationRouter.get('/api/partner-application/contractor/:contractorId', async (req, res) => {
    try {
        let apps = await db.select()
            .from(partnerApplications)
            .where(eq(partnerApplications.contractorId, req.params.contractorId))
            .limit(1);

        let application = apps[0];

        if (!application) {
            // Auto-create on first access
            application = {
                id: uuidv4(),
                contractorId: req.params.contractorId,
                status: 'not_started',
                insuranceStatus: 'pending',
                identityStatus: 'pending',
                referencesStatus: 'pending',
                trainingStatus: 'incomplete',
                createdAt: new Date(),
                updatedAt: new Date(),
            } as any;

            await db.insert(partnerApplications).values(application);
        }

        // Get references
        const refs = await db.select()
            .from(clientReferences)
            .where(eq(clientReferences.applicationId, application.id));

        // Get training progress
        const progress = await db.select()
            .from(trainingProgress)
            .where(eq(trainingProgress.contractorId, req.params.contractorId));

        res.json({ application, references: refs, trainingProgress: progress });
    } catch (error) {
        console.error('Failed to get application:', error);
        res.status(500).json({ error: 'Failed to get application' });
    }
});

// Start application
partnerApplicationRouter.post('/api/partner-application/contractor/:contractorId/start', async (req, res) => {
    try {
        await db.update(partnerApplications)
            .set({ status: 'application_started', updatedAt: new Date() })
            .where(eq(partnerApplications.contractorId, req.params.contractorId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to start application:', error);
        res.status(500).json({ error: 'Failed to start application' });
    }
});

// Step 1: Submit insurance
partnerApplicationRouter.post('/api/partner-application/contractor/:contractorId/insurance', async (req, res) => {
    try {
        const { documentUrl, policyNumber, expiryDate } = req.body;

        if (!documentUrl || !policyNumber || !expiryDate) {
            return res.status(400).json({ error: 'All fields required' });
        }

        const expiry = new Date(expiryDate);
        if (expiry < new Date()) {
            return res.status(400).json({ error: 'Insurance must not be expired' });
        }

        await db.update(partnerApplications)
            .set({
                insuranceDocumentUrl: documentUrl,
                insurancePolicyNumber: policyNumber,
                insuranceExpiryDate: expiry,
                insuranceStatus: 'submitted',
                status: 'insurance_pending',
                updatedAt: new Date(),
            })
            .where(eq(partnerApplications.contractorId, req.params.contractorId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to submit insurance:', error);
        res.status(500).json({ error: 'Failed to submit insurance' });
    }
});

// Step 2: Submit identity
partnerApplicationRouter.post('/api/partner-application/contractor/:contractorId/identity', async (req, res) => {
    try {
        const { identityDocumentUrl, dbsCertificateUrl } = req.body;

        if (!identityDocumentUrl) {
            return res.status(400).json({ error: 'Identity document required' });
        }

        await db.update(partnerApplications)
            .set({
                identityDocumentUrl,
                dbsCertificateUrl: dbsCertificateUrl || null,
                identityStatus: 'submitted',
                status: 'identity_pending',
                updatedAt: new Date(),
            })
            .where(eq(partnerApplications.contractorId, req.params.contractorId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to submit identity:', error);
        res.status(500).json({ error: 'Failed to submit identity' });
    }
});

// Step 3: Add reference
partnerApplicationRouter.post('/api/partner-application/contractor/:contractorId/references', async (req, res) => {
    try {
        const apps = await db.select()
            .from(partnerApplications)
            .where(eq(partnerApplications.contractorId, req.params.contractorId))
            .limit(1);

        if (apps.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const { clientName, clientEmail, clientPhone, jobDescription } = req.body;

        if (!clientName || !clientEmail) {
            return res.status(400).json({ error: 'Name and email required' });
        }

        // Check limit
        const existing = await db.select()
            .from(clientReferences)
            .where(eq(clientReferences.applicationId, apps[0].id));

        if (existing.length >= 3) {
            return res.status(400).json({ error: 'Maximum 3 references' });
        }

        const ref = {
            id: uuidv4(),
            applicationId: apps[0].id,
            clientName,
            clientEmail,
            clientPhone: clientPhone || null,
            jobDescription: jobDescription || null,
            requestToken: generateToken(),
            verified: false,
        };

        await db.insert(clientReferences).values(ref);

        // Update status
        if (apps[0].referencesStatus === 'pending') {
            await db.update(partnerApplications)
                .set({ referencesStatus: 'submitted', status: 'references_pending', updatedAt: new Date() })
                .where(eq(partnerApplications.id, apps[0].id));
        }

        res.status(201).json(ref);
    } catch (error) {
        console.error('Failed to add reference:', error);
        res.status(500).json({ error: 'Failed to add reference' });
    }
});

// Send reference request
partnerApplicationRouter.post('/api/partner-application/references/:referenceId/send', async (req, res) => {
    try {
        await db.update(clientReferences)
            .set({ requestSentAt: new Date() })
            .where(eq(clientReferences.id, req.params.referenceId));

        const refs = await db.select()
            .from(clientReferences)
            .where(eq(clientReferences.id, req.params.referenceId))
            .limit(1);

        res.json({
            success: true,
            referenceUrl: `/reference/${refs[0]?.requestToken}`,
        });
    } catch (error) {
        console.error('Failed to send reference:', error);
        res.status(500).json({ error: 'Failed to send reference' });
    }
});

// Get reference by token (public)
partnerApplicationRouter.get('/api/partner-application/references/token/:token', async (req, res) => {
    try {
        const refs = await db.select()
            .from(clientReferences)
            .where(eq(clientReferences.requestToken, req.params.token))
            .limit(1);

        if (refs.length === 0) {
            return res.status(404).json({ error: 'Reference not found' });
        }

        if (refs[0].responseReceivedAt) {
            return res.status(410).json({ error: 'Already submitted' });
        }

        res.json({
            id: refs[0].id,
            clientName: refs[0].clientName,
            jobDescription: refs[0].jobDescription,
        });
    } catch (error) {
        console.error('Failed to get reference:', error);
        res.status(500).json({ error: 'Failed to get reference' });
    }
});

// Submit reference response (public)
partnerApplicationRouter.post('/api/partner-application/references/token/:token/submit', async (req, res) => {
    try {
        const refs = await db.select()
            .from(clientReferences)
            .where(eq(clientReferences.requestToken, req.params.token))
            .limit(1);

        if (refs.length === 0) {
            return res.status(404).json({ error: 'Reference not found' });
        }

        if (refs[0].responseReceivedAt) {
            return res.status(400).json({ error: 'Already submitted' });
        }

        const { rating, feedback, wouldRecommend } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating 1-5 required' });
        }

        const verified = rating >= 3 && wouldRecommend;

        await db.update(clientReferences)
            .set({
                rating,
                feedback: feedback || null,
                wouldRecommend,
                responseReceivedAt: new Date(),
                verified,
            })
            .where(eq(clientReferences.id, refs[0].id));

        // Check if enough references verified
        const allRefs = await db.select()
            .from(clientReferences)
            .where(eq(clientReferences.applicationId, refs[0].applicationId));

        const verifiedCount = allRefs.filter(r => r.verified).length;

        if (verifiedCount >= 2) {
            await db.update(partnerApplications)
                .set({
                    referencesStatus: 'verified',
                    referencesVerifiedAt: new Date(),
                    status: 'references_verified',
                    updatedAt: new Date(),
                })
                .where(eq(partnerApplications.id, refs[0].applicationId));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to submit reference:', error);
        res.status(500).json({ error: 'Failed to submit reference' });
    }
});

// Step 5: Sign agreement
partnerApplicationRouter.post('/api/partner-application/contractor/:contractorId/agreement', async (req, res) => {
    try {
        const { highvisSize, agreedToTerms } = req.body;

        if (!agreedToTerms) {
            return res.status(400).json({ error: 'Must agree to terms' });
        }

        if (!highvisSize) {
            return res.status(400).json({ error: 'High-vis size required' });
        }

        await db.update(partnerApplications)
            .set({
                highvisSize,
                agreementSignedAt: new Date(),
                status: 'agreement_pending',
                updatedAt: new Date(),
            })
            .where(eq(partnerApplications.contractorId, req.params.contractorId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to sign agreement:', error);
        res.status(500).json({ error: 'Failed to sign agreement' });
    }
});

// Admin: Verify insurance
partnerApplicationRouter.post('/api/partner-application/admin/:id/verify-insurance', async (req, res) => {
    try {
        const { approved } = req.body;

        await db.update(partnerApplications)
            .set({
                insuranceStatus: approved ? 'verified' : 'rejected',
                insuranceVerifiedAt: approved ? new Date() : null,
                status: approved ? 'insurance_verified' : 'rejected',
                updatedAt: new Date(),
            })
            .where(eq(partnerApplications.id, req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to verify insurance:', error);
        res.status(500).json({ error: 'Failed to verify insurance' });
    }
});

// Admin: Verify identity
partnerApplicationRouter.post('/api/partner-application/admin/:id/verify-identity', async (req, res) => {
    try {
        const { approved } = req.body;

        await db.update(partnerApplications)
            .set({
                identityStatus: approved ? 'verified' : 'rejected',
                identityVerifiedAt: approved ? new Date() : null,
                status: approved ? 'identity_verified' : 'rejected',
                updatedAt: new Date(),
            })
            .where(eq(partnerApplications.id, req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to verify identity:', error);
        res.status(500).json({ error: 'Failed to verify identity' });
    }
});

// Admin: Activate partner
partnerApplicationRouter.post('/api/partner-application/admin/:id/activate', async (req, res) => {
    try {
        const apps = await db.select()
            .from(partnerApplications)
            .where(eq(partnerApplications.id, req.params.id))
            .limit(1);

        if (apps.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const app = apps[0];

        // Check requirements
        if (app.insuranceStatus !== 'verified') {
            return res.status(400).json({ error: 'Insurance not verified' });
        }
        if (app.identityStatus !== 'verified') {
            return res.status(400).json({ error: 'Identity not verified' });
        }
        if (app.referencesStatus !== 'verified') {
            return res.status(400).json({ error: 'References not verified' });
        }
        if (app.trainingStatus !== 'complete') {
            return res.status(400).json({ error: 'Training not completed' });
        }
        if (!app.agreementSignedAt) {
            return res.status(400).json({ error: 'Agreement not signed' });
        }

        await db.update(partnerApplications)
            .set({
                status: 'partner_active',
                activatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(partnerApplications.id, req.params.id));

        // Update contractor profile
        await db.update(handymanProfiles)
            .set({
                subscriptionTier: 'partner',
                partnerStatus: 'partner_active',
                partnerActivatedAt: new Date(),
            })
            .where(eq(handymanProfiles.id, app.contractorId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to activate partner:', error);
        res.status(500).json({ error: 'Failed to activate partner' });
    }
});

// Admin: Get all applications
partnerApplicationRouter.get('/api/partner-application/admin/applications', async (req, res) => {
    try {
        const apps = await db.select()
            .from(partnerApplications)
            .orderBy(desc(partnerApplications.updatedAt));

        res.json(apps);
    } catch (error) {
        console.error('Failed to get applications:', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});
