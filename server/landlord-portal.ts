/**
 * Landlord Portal API Routes
 *
 * Provides API endpoints for landlords to:
 * - Manage properties and tenants
 * - Configure auto-approval rules
 * - View and approve/reject issues
 * - Track spending and budget
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import {
    leads,
    properties,
    tenants,
    tenantIssues,
    landlordSettings,
    messages,
    InsertProperty,
    InsertTenant,
    InsertLandlordSettings
} from '@shared/schema';
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

export const landlordPortalRouter = Router();

// ==========================================
// PUBLIC ENDPOINTS (No Auth Required)
// ==========================================

// POST /api/landlord/signup
// Create a new landlord account
landlordPortalRouter.post('/signup', async (req: Request, res: Response) => {
    try {
        const { name, email, phone, propertyCount } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        // Normalize phone number
        let normalizedPhone = phone.replace(/[^\d+]/g, '');
        if (normalizedPhone.startsWith('0')) {
            normalizedPhone = '+44' + normalizedPhone.substring(1);
        }
        if (!normalizedPhone.startsWith('+')) {
            normalizedPhone = '+' + normalizedPhone;
        }

        // Check if landlord already exists
        const existing = await db.query.leads.findFirst({
            where: eq(leads.phone, normalizedPhone)
        });

        if (existing) {
            // If already a landlord, just return their token
            if (['LANDLORD', 'PROP_MGR'].includes(existing.segment || '')) {
                return res.json({
                    token: existing.id,
                    message: 'Welcome back!'
                });
            }
            // Update existing lead to landlord
            await db.update(leads)
                .set({
                    segment: propertyCount === '25+' || propertyCount === '11-25' ? 'PROP_MGR' : 'LANDLORD',
                    customerName: name,
                    email: email
                })
                .where(eq(leads.id, existing.id));

            return res.json({
                token: existing.id,
                message: 'Account upgraded to landlord!'
            });
        }

        // Create new landlord lead
        const landlordId = `landlord-${nanoid(8)}`;
        const segment = propertyCount === '25+' || propertyCount === '11-25' ? 'PROP_MGR' : 'LANDLORD';

        await db.insert(leads).values({
            id: landlordId,
            customerName: name,
            email: email,
            phone: normalizedPhone,
            segment: segment,
            source: 'landlord_signup',
            status: 'new',
            createdAt: new Date()
        });

        // Create default settings
        await db.insert(landlordSettings).values({
            id: nanoid(),
            landlordLeadId: landlordId,
            autoApproveUnderPence: 15000, // £150
            requireApprovalAbovePence: 50000, // £500
            autoApproveCategories: ['plumbing_emergency', 'heating', 'security', 'water_leak'],
            alwaysRequireApprovalCategories: ['cosmetic', 'upgrade'],
            notifyOnAutoApprove: true,
            notifyOnCompletion: true,
            preferredChannel: 'whatsapp',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        console.log(`[LandlordPortal] New landlord signup: ${name} (${normalizedPhone})`);

        res.json({
            token: landlordId,
            message: 'Account created successfully!'
        });
    } catch (error) {
        console.error('[LandlordPortal] Signup error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

// ==========================================
// AUTHENTICATED ENDPOINTS
// ==========================================

// Middleware to verify landlord access token
async function verifyLandlordToken(req: Request, res: Response, next: Function) {
    const token = req.params.token;

    if (!token) {
        return res.status(401).json({ error: 'Missing token' });
    }

    // Token is the landlord lead ID for now
    // In production, use a proper JWT or session token
    const landlord = await db.query.leads.findFirst({
        where: eq(leads.id, token)
    });

    if (!landlord || !['LANDLORD', 'PROP_MGR'].includes(landlord.segment || '')) {
        return res.status(403).json({ error: 'Invalid token or not a landlord' });
    }

    (req as any).landlord = landlord;
    next();
}

// ==========================================
// LANDLORD PROFILE & SETTINGS
// ==========================================

// GET /api/landlord/:token/profile
// Get landlord profile and settings
landlordPortalRouter.get('/:token/profile', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;

        const settings = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlord.id)
        });

        // Get property count
        const propertyCount = await db.select({ count: sql<number>`count(*)` })
            .from(properties)
            .where(eq(properties.landlordLeadId, landlord.id));

        // Get open issue count
        const openIssues = await db.select({ count: sql<number>`count(*)` })
            .from(tenantIssues)
            .where(and(
                eq(tenantIssues.landlordLeadId, landlord.id),
                inArray(tenantIssues.status, ['new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled'])
            ));

        res.json({
            profile: {
                id: landlord.id,
                name: landlord.customerName,
                email: landlord.email,
                phone: landlord.phone,
                segment: landlord.segment
            },
            settings: settings || null,
            stats: {
                propertyCount: Number(propertyCount[0]?.count || 0),
                openIssues: Number(openIssues[0]?.count || 0)
            }
        });
    } catch (error) {
        console.error('[LandlordPortal] Error getting profile:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// GET /api/landlord/:token/settings
// Get landlord settings
landlordPortalRouter.get('/:token/settings', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;

        let settings = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlord.id)
        });

        // Create default settings if they don't exist
        if (!settings) {
            const defaultSettings = {
                id: nanoid(),
                landlordLeadId: landlord.id,
                autoApproveUnderPence: 15000, // £150
                requireApprovalAbovePence: 50000, // £500
                autoApproveCategories: ['plumbing_emergency', 'heating', 'security', 'water_leak'],
                alwaysRequireApprovalCategories: ['cosmetic', 'upgrade'],
                monthlyBudgetPence: null,
                budgetAlertThreshold: 80,
                notifyOnAutoApprove: true,
                notifyOnCompletion: true,
                preferredChannel: 'whatsapp'
            };

            await db.insert(landlordSettings).values(defaultSettings);
            settings = defaultSettings as any;
        }

        // Get current month spending
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // For now, return 0 - would need to sum from completed jobs/invoices
        const currentSpend = 0;

        res.json({
            settings,
            currentSpend,
            landlord: {
                name: landlord.customerName,
                email: landlord.email
            }
        });
    } catch (error) {
        console.error('[LandlordPortal] Error getting settings:', error);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// PATCH /api/landlord/:token/settings
// Update landlord settings
landlordPortalRouter.patch('/:token/settings', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const updates = req.body;

        // Check if settings exist
        const existing = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlord.id)
        });

        if (existing) {
            await db.update(landlordSettings)
                .set({
                    ...updates,
                    updatedAt: new Date()
                })
                .where(eq(landlordSettings.landlordLeadId, landlord.id));
        } else {
            await db.insert(landlordSettings).values({
                id: nanoid(),
                landlordLeadId: landlord.id,
                ...updates
            });
        }

        const newSettings = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlord.id)
        });

        res.json({ success: true, settings: newSettings });
    } catch (error) {
        console.error('[LandlordPortal] Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ==========================================
// PROPERTIES
// ==========================================

// GET /api/landlord/:token/properties
// List all properties for landlord
landlordPortalRouter.get('/:token/properties', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;

        const props = await db.query.properties.findMany({
            where: eq(properties.landlordLeadId, landlord.id),
            with: {
                tenants: true,
                issues: true
            },
            orderBy: desc(properties.createdAt)
        });

        const result = props.map(p => ({
            ...p,
            tenantCount: p.tenants?.length || 0,
            openIssueCount: p.issues?.filter(i =>
                !['completed', 'resolved_diy', 'cancelled'].includes(i.status)
            ).length || 0
        }));

        res.json({
            landlord: {
                id: landlord.id,
                name: landlord.customerName,
                email: landlord.email,
                phone: landlord.phone
            },
            properties: result
        });
    } catch (error) {
        console.error('[LandlordPortal] Error listing properties:', error);
        res.status(500).json({ error: 'Failed to list properties' });
    }
});

// POST /api/landlord/:token/properties
// Add a new property
landlordPortalRouter.post('/:token/properties', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const { address, postcode, propertyType, nickname, notes } = req.body;

        if (!address || !postcode) {
            return res.status(400).json({ error: 'Address and postcode are required' });
        }

        const newProperty: InsertProperty = {
            id: nanoid(),
            landlordLeadId: landlord.id,
            address,
            postcode,
            propertyType: propertyType || null,
            nickname: nickname || null,
            notes: notes || null,
            isActive: true
        };

        await db.insert(properties).values(newProperty);

        res.json({ success: true, property: newProperty });
    } catch (error) {
        console.error('[LandlordPortal] Error adding property:', error);
        res.status(500).json({ error: 'Failed to add property' });
    }
});

// PATCH /api/landlord/:token/properties/:id
// Update a property
landlordPortalRouter.patch('/:token/properties/:id', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const propertyId = req.params.id;
        const updates = req.body;

        // Verify ownership
        const property = await db.query.properties.findFirst({
            where: and(
                eq(properties.id, propertyId),
                eq(properties.landlordLeadId, landlord.id)
            )
        });

        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        await db.update(properties)
            .set({
                ...updates,
                updatedAt: new Date()
            })
            .where(eq(properties.id, propertyId));

        res.json({ success: true });
    } catch (error) {
        console.error('[LandlordPortal] Error updating property:', error);
        res.status(500).json({ error: 'Failed to update property' });
    }
});

// DELETE /api/landlord/:token/properties/:id
// Deactivate a property
landlordPortalRouter.delete('/:token/properties/:id', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const propertyId = req.params.id;

        // Verify ownership
        const property = await db.query.properties.findFirst({
            where: and(
                eq(properties.id, propertyId),
                eq(properties.landlordLeadId, landlord.id)
            )
        });

        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        // Soft delete
        await db.update(properties)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(properties.id, propertyId));

        res.json({ success: true });
    } catch (error) {
        console.error('[LandlordPortal] Error deleting property:', error);
        res.status(500).json({ error: 'Failed to delete property' });
    }
});

// ==========================================
// TENANTS
// ==========================================

// POST /api/properties/:propertyId/tenants
// Add a tenant to a property
landlordPortalRouter.post('/:token/properties/:propertyId/tenants', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const propertyId = req.params.propertyId;
        const { name, phone, email, isPrimary } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }

        // Verify property ownership
        const property = await db.query.properties.findFirst({
            where: and(
                eq(properties.id, propertyId),
                eq(properties.landlordLeadId, landlord.id)
            )
        });

        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        // Normalize phone number
        let normalizedPhone = phone.replace(/[^\d+]/g, '');
        if (normalizedPhone.startsWith('0')) {
            normalizedPhone = '+44' + normalizedPhone.substring(1);
        }
        if (!normalizedPhone.startsWith('+')) {
            normalizedPhone = '+' + normalizedPhone;
        }

        const newTenant: InsertTenant = {
            id: nanoid(),
            propertyId,
            name,
            phone: normalizedPhone,
            email: email || null,
            isPrimary: isPrimary !== false,
            isActive: true,
            whatsappOptIn: false
        };

        await db.insert(tenants).values(newTenant);

        // Generate WhatsApp link for tenant
        const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER?.replace('+', '') || '15558601738';
        const welcomeMessage = `Hi, I'm ${name} at ${property.address}`;
        const whatsappLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(welcomeMessage)}`;

        res.json({
            success: true,
            tenant: newTenant,
            whatsappLink
        });
    } catch (error) {
        console.error('[LandlordPortal] Error adding tenant:', error);
        res.status(500).json({ error: 'Failed to add tenant' });
    }
});

// PATCH /api/tenants/:id
// Update a tenant
landlordPortalRouter.patch('/:token/tenants/:id', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const tenantId = req.params.id;
        const updates = req.body;

        // Verify ownership via property
        const tenant = await db.query.tenants.findFirst({
            where: eq(tenants.id, tenantId),
            with: {
                property: true
            }
        });

        if (!tenant || tenant.property?.landlordLeadId !== landlord.id) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        await db.update(tenants)
            .set({
                ...updates,
                updatedAt: new Date()
            })
            .where(eq(tenants.id, tenantId));

        res.json({ success: true });
    } catch (error) {
        console.error('[LandlordPortal] Error updating tenant:', error);
        res.status(500).json({ error: 'Failed to update tenant' });
    }
});

// ==========================================
// ISSUES
// ==========================================

// GET /api/landlord/:token/issues
// List all issues for landlord
landlordPortalRouter.get('/:token/issues', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const status = req.query.status as string | undefined;

        let statusFilter;
        if (status === 'open') {
            statusFilter = inArray(tenantIssues.status, ['new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled']);
        } else if (status === 'pending') {
            statusFilter = eq(tenantIssues.status, 'reported');
        } else if (status === 'completed') {
            statusFilter = inArray(tenantIssues.status, ['completed', 'resolved_diy']);
        }

        const issues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.landlordLeadId, landlord.id),
                statusFilter
            ),
            with: {
                property: true,
                tenant: true,
                quote: true
            },
            orderBy: desc(tenantIssues.createdAt)
        });

        // Calculate stats
        const allIssues = await db.query.tenantIssues.findMany({
            where: eq(tenantIssues.landlordLeadId, landlord.id)
        });

        const stats = {
            total: allIssues.length,
            open: allIssues.filter(i => ['new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled'].includes(i.status)).length,
            resolved: allIssues.filter(i => i.status === 'completed').length,
            diyResolved: allIssues.filter(i => i.status === 'resolved_diy').length
        };

        res.json({ issues, stats });
    } catch (error) {
        console.error('[LandlordPortal] Error listing issues:', error);
        res.status(500).json({ error: 'Failed to list issues' });
    }
});

// GET /api/landlord/:token/issues/:id
// Get issue details
landlordPortalRouter.get('/:token/issues/:id', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const issueId = req.params.id;

        const issue = await db.query.tenantIssues.findFirst({
            where: and(
                eq(tenantIssues.id, issueId),
                eq(tenantIssues.landlordLeadId, landlord.id)
            ),
            with: {
                property: true,
                tenant: true,
                quote: true
            }
        });

        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }

        res.json(issue);
    } catch (error) {
        console.error('[LandlordPortal] Error getting issue:', error);
        res.status(500).json({ error: 'Failed to get issue' });
    }
});

// POST /api/landlord/:token/issues/:id/approve
// Approve an issue
landlordPortalRouter.post('/:token/issues/:id/approve', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const issueId = req.params.id;
        const { notes } = req.body;

        const issue = await db.query.tenantIssues.findFirst({
            where: and(
                eq(tenantIssues.id, issueId),
                eq(tenantIssues.landlordLeadId, landlord.id)
            )
        });

        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }

        if (issue.status !== 'reported') {
            return res.status(400).json({ error: 'Issue is not awaiting approval' });
        }

        await db.update(tenantIssues)
            .set({
                status: 'approved',
                landlordApprovedAt: new Date(),
                additionalNotes: notes ? `Landlord: ${notes}` : issue.additionalNotes,
                updatedAt: new Date()
            })
            .where(eq(tenantIssues.id, issueId));

        res.json({ success: true, message: 'Issue approved' });
    } catch (error) {
        console.error('[LandlordPortal] Error approving issue:', error);
        res.status(500).json({ error: 'Failed to approve issue' });
    }
});

// POST /api/landlord/:token/issues/:id/reject
// Reject an issue
landlordPortalRouter.post('/:token/issues/:id/reject', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const issueId = req.params.id;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        const issue = await db.query.tenantIssues.findFirst({
            where: and(
                eq(tenantIssues.id, issueId),
                eq(tenantIssues.landlordLeadId, landlord.id)
            )
        });

        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }

        await db.update(tenantIssues)
            .set({
                status: 'cancelled',
                landlordRejectedAt: new Date(),
                landlordRejectionReason: reason,
                updatedAt: new Date()
            })
            .where(eq(tenantIssues.id, issueId));

        res.json({ success: true, message: 'Issue rejected' });
    } catch (error) {
        console.error('[LandlordPortal] Error rejecting issue:', error);
        res.status(500).json({ error: 'Failed to reject issue' });
    }
});

// GET /api/landlord/:token/issues/:id/messages
// Get chat messages for an issue
landlordPortalRouter.get('/:token/issues/:id/messages', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;
        const issueId = req.params.id;

        const issue = await db.query.tenantIssues.findFirst({
            where: and(
                eq(tenantIssues.id, issueId),
                eq(tenantIssues.landlordLeadId, landlord.id)
            )
        });

        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }

        if (!issue.conversationId) {
            return res.json({ messages: [] });
        }

        // Fetch messages for this conversation
        const chatMessages = await db.query.messages.findMany({
            where: eq(messages.conversationId, issue.conversationId),
            orderBy: [asc(messages.createdAt)],
        });

        res.json({
            messages: chatMessages.map(m => ({
                id: m.id,
                direction: m.direction,
                content: m.content,
                type: m.type || 'text',
                mediaUrl: m.mediaUrl,
                mediaType: m.mediaType,
                createdAt: m.createdAt,
                senderName: m.senderName,
            })),
            conversationId: issue.conversationId,
        });
    } catch (error) {
        console.error('[LandlordPortal] Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// ==========================================
// SPENDING
// ==========================================

// GET /api/landlord/:token/spending
// Get spending summary
landlordPortalRouter.get('/:token/spending', verifyLandlordToken, async (req: Request, res: Response) => {
    try {
        const landlord = (req as any).landlord;

        const settings = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlord.id)
        });

        // Get completed issues this month
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const completedIssues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.landlordLeadId, landlord.id),
                eq(tenantIssues.status, 'completed')
            )
        });

        const currentSpend = settings?.currentMonthSpendPence || 0;
        const budget = settings?.monthlyBudgetPence || null;

        res.json({
            currentMonthSpend: currentSpend / 100,
            monthlyBudget: budget ? budget / 100 : null,
            percentUsed: budget ? (currentSpend / budget) * 100 : null,
            completedJobsThisMonth: completedIssues.length,
            budgetAlertThreshold: settings?.budgetAlertThreshold || 80
        });
    } catch (error) {
        console.error('[LandlordPortal] Error getting spending:', error);
        res.status(500).json({ error: 'Failed to get spending' });
    }
});

export default landlordPortalRouter;
