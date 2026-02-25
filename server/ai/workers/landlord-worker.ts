/**
 * Landlord Worker
 *
 * Handles landlord interactions for approval requests,
 * settings changes, and property queries.
 */

import { BaseWorker, commonTools } from './base-worker';
import { Tool, AIProvider } from '../provider';
import { db } from '../../db';
import { landlordSettings, tenantIssues, properties, LandlordSettings } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

const LANDLORD_SYSTEM_PROMPT = `You are a property maintenance coordinator helping landlords manage their properties.
You help with approval requests, settings configuration, and property issue tracking.

## Your Goals

1. **Process Approvals** - Handle quick approval/rejection of jobs
2. **Answer Questions** - About issues, spending, properties
3. **Update Settings** - Help configure auto-approval rules

## Quick Commands
- "Approve" or "Yes" → Approve the pending request
- "Reject" or "No" → Reject the pending request
- "How much have I spent?" → Show spending summary
- "Change my threshold" → Update auto-approval settings

## Communication Style
- Professional but friendly
- Concise - landlords are busy
- Include costs in pounds (not pence)
- Provide clear next steps
`;

export class LandlordWorker extends BaseWorker {
    name: 'LANDLORD_WORKER' = 'LANDLORD_WORKER';
    systemPrompt = LANDLORD_SYSTEM_PROMPT;

    constructor(provider: AIProvider) {
        super(provider);
        this.chatOptions = {
            temperature: 0.5,
            maxTokens: 512
        };
    }

    tools: Tool[] = [
        ...commonTools,
        {
            name: 'get_pending_approvals',
            description: 'Get list of issues awaiting landlord approval',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    }
                },
                required: ['landlordId']
            },
            handler: async (args) => {
                const { landlordId } = args as { landlordId: string };
                return await getPendingApprovals(landlordId);
            }
        },
        {
            name: 'approve_issue',
            description: 'Approve a pending issue for dispatch',
            parameters: {
                type: 'object',
                properties: {
                    issueId: {
                        type: 'string',
                        description: 'Issue ID to approve'
                    },
                    notes: {
                        type: 'string',
                        description: 'Optional notes from landlord'
                    }
                },
                required: ['issueId']
            },
            handler: async (args) => {
                const { issueId, notes } = args as { issueId: string; notes?: string };
                return await approveIssue(issueId, notes);
            }
        },
        {
            name: 'reject_issue',
            description: 'Reject a pending issue',
            parameters: {
                type: 'object',
                properties: {
                    issueId: {
                        type: 'string',
                        description: 'Issue ID to reject'
                    },
                    reason: {
                        type: 'string',
                        description: 'Reason for rejection'
                    }
                },
                required: ['issueId', 'reason']
            },
            handler: async (args) => {
                const { issueId, reason } = args as { issueId: string; reason: string };
                return await rejectIssue(issueId, reason);
            }
        },
        {
            name: 'get_spending_summary',
            description: 'Get landlord spending summary for current month',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    }
                },
                required: ['landlordId']
            },
            handler: async (args) => {
                const { landlordId } = args as { landlordId: string };
                return await getSpendingSummary(landlordId);
            }
        },
        {
            name: 'get_property_issues',
            description: 'Get issues for a specific property',
            parameters: {
                type: 'object',
                properties: {
                    propertyId: {
                        type: 'string',
                        description: 'Property ID'
                    },
                    status: {
                        type: 'string',
                        enum: ['all', 'open', 'completed'],
                        description: 'Filter by status'
                    }
                },
                required: ['propertyId']
            },
            handler: async (args) => {
                const { propertyId, status } = args as { propertyId: string; status?: string };
                return await getPropertyIssues(propertyId, status);
            }
        },
        {
            name: 'update_settings',
            description: 'Update landlord auto-approval settings',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    },
                    autoApproveUnderPounds: {
                        type: 'number',
                        description: 'Auto-approve threshold in pounds'
                    },
                    monthlyBudgetPounds: {
                        type: 'number',
                        description: 'Monthly budget in pounds'
                    },
                    notifyOnAutoApprove: {
                        type: 'boolean',
                        description: 'Whether to notify on auto-approvals'
                    }
                },
                required: ['landlordId']
            },
            handler: async (args) => {
                const { landlordId, autoApproveUnderPounds, monthlyBudgetPounds, notifyOnAutoApprove } = args as {
                    landlordId: string;
                    autoApproveUnderPounds?: number;
                    monthlyBudgetPounds?: number;
                    notifyOnAutoApprove?: boolean;
                };
                return await updateSettings(landlordId, {
                    autoApproveUnderPence: autoApproveUnderPounds ? autoApproveUnderPounds * 100 : undefined,
                    monthlyBudgetPence: monthlyBudgetPounds ? monthlyBudgetPounds * 100 : undefined,
                    notifyOnAutoApprove
                });
            }
        },
        {
            name: 'list_properties',
            description: 'List all properties for a landlord',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    }
                },
                required: ['landlordId']
            },
            handler: async (args) => {
                const { landlordId } = args as { landlordId: string };
                return await listProperties(landlordId);
            }
        }
    ];
}

/**
 * Get pending approvals for landlord
 */
async function getPendingApprovals(landlordId: string): Promise<{
    count: number;
    issues: Array<{
        id: string;
        property: string;
        description: string;
        estimateLow: number;
        estimateHigh: number;
        urgency: string;
        reportedAt: Date;
    }>;
}> {
    try {
        const issues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.landlordLeadId, landlordId),
                eq(tenantIssues.status, 'reported')
            ),
            with: {
                property: true
            }
        });

        return {
            count: issues.length,
            issues: issues.map(i => ({
                id: i.id,
                property: i.property?.address || 'Unknown',
                description: i.issueDescription || 'No description',
                estimateLow: (i.priceEstimateLowPence || 0) / 100,
                estimateHigh: (i.priceEstimateHighPence || 0) / 100,
                urgency: i.urgency || 'medium',
                reportedAt: i.createdAt
            }))
        };
    } catch (error) {
        console.error('[LandlordWorker] Error getting pending approvals:', error);
        return { count: 0, issues: [] };
    }
}

/**
 * Approve an issue
 */
async function approveIssue(issueId: string, notes?: string): Promise<{
    success: boolean;
    message: string;
}> {
    try {
        await db.update(tenantIssues)
            .set({
                status: 'approved',
                landlordApprovedAt: new Date(),
                additionalNotes: notes ? `Landlord: ${notes}` : undefined,
                updatedAt: new Date()
            })
            .where(eq(tenantIssues.id, issueId));

        return {
            success: true,
            message: 'Issue approved. Our team will schedule the job.'
        };
    } catch (error) {
        console.error('[LandlordWorker] Error approving issue:', error);
        return {
            success: false,
            message: 'Failed to approve issue. Please try again.'
        };
    }
}

/**
 * Reject an issue
 */
async function rejectIssue(issueId: string, reason: string): Promise<{
    success: boolean;
    message: string;
}> {
    try {
        await db.update(tenantIssues)
            .set({
                status: 'cancelled',
                landlordRejectedAt: new Date(),
                landlordRejectionReason: reason,
                updatedAt: new Date()
            })
            .where(eq(tenantIssues.id, issueId));

        return {
            success: true,
            message: 'Issue rejected. The tenant will be notified.'
        };
    } catch (error) {
        console.error('[LandlordWorker] Error rejecting issue:', error);
        return {
            success: false,
            message: 'Failed to reject issue. Please try again.'
        };
    }
}

/**
 * Get spending summary
 */
async function getSpendingSummary(landlordId: string): Promise<{
    currentMonth: number;
    budget: number | null;
    percentUsed: number | null;
    completedJobs: number;
}> {
    try {
        const settings = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlordId)
        });

        // Count completed jobs this month
        const completedIssues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.landlordLeadId, landlordId),
                eq(tenantIssues.status, 'completed')
            )
        });

        const currentSpend = settings?.currentMonthSpendPence || 0;
        const budget = settings?.monthlyBudgetPence || null;

        return {
            currentMonth: currentSpend / 100,
            budget: budget ? budget / 100 : null,
            percentUsed: budget ? (currentSpend / budget) * 100 : null,
            completedJobs: completedIssues.length
        };
    } catch (error) {
        console.error('[LandlordWorker] Error getting spending summary:', error);
        return {
            currentMonth: 0,
            budget: null,
            percentUsed: null,
            completedJobs: 0
        };
    }
}

/**
 * Get issues for a property
 */
async function getPropertyIssues(propertyId: string, status?: string): Promise<{
    count: number;
    issues: Array<{
        id: string;
        description: string;
        status: string;
        urgency: string;
        createdAt: Date;
    }>;
}> {
    try {
        const statusFilter = status === 'completed'
            ? inArray(tenantIssues.status, ['completed', 'resolved_diy'])
            : status === 'open'
            ? inArray(tenantIssues.status, ['new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled'])
            : undefined;

        const issues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.propertyId, propertyId),
                statusFilter
            )
        });

        return {
            count: issues.length,
            issues: issues.map(i => ({
                id: i.id,
                description: i.issueDescription || 'No description',
                status: i.status,
                urgency: i.urgency || 'medium',
                createdAt: i.createdAt
            }))
        };
    } catch (error) {
        console.error('[LandlordWorker] Error getting property issues:', error);
        return { count: 0, issues: [] };
    }
}

/**
 * Update landlord settings
 */
async function updateSettings(
    landlordId: string,
    updates: Partial<{
        autoApproveUnderPence: number;
        monthlyBudgetPence: number;
        notifyOnAutoApprove: boolean;
    }>
): Promise<{
    success: boolean;
    message: string;
    newSettings?: Partial<LandlordSettings>;
}> {
    try {
        const filteredUpdates: Record<string, unknown> = {};
        if (updates.autoApproveUnderPence !== undefined) {
            filteredUpdates.autoApproveUnderPence = updates.autoApproveUnderPence;
        }
        if (updates.monthlyBudgetPence !== undefined) {
            filteredUpdates.monthlyBudgetPence = updates.monthlyBudgetPence;
        }
        if (updates.notifyOnAutoApprove !== undefined) {
            filteredUpdates.notifyOnAutoApprove = updates.notifyOnAutoApprove;
        }

        if (Object.keys(filteredUpdates).length === 0) {
            return { success: false, message: 'No settings to update' };
        }

        await db.update(landlordSettings)
            .set({
                ...filteredUpdates,
                updatedAt: new Date()
            })
            .where(eq(landlordSettings.landlordLeadId, landlordId));

        return {
            success: true,
            message: 'Settings updated successfully',
            newSettings: updates
        };
    } catch (error) {
        console.error('[LandlordWorker] Error updating settings:', error);
        return {
            success: false,
            message: 'Failed to update settings. Please try again.'
        };
    }
}

/**
 * List landlord properties
 */
async function listProperties(landlordId: string): Promise<{
    count: number;
    properties: Array<{
        id: string;
        address: string;
        nickname: string | null;
        openIssues: number;
    }>;
}> {
    try {
        const props = await db.query.properties.findMany({
            where: eq(properties.landlordLeadId, landlordId),
            with: {
                issues: true
            }
        });

        return {
            count: props.length,
            properties: props.map(p => ({
                id: p.id,
                address: p.address,
                nickname: p.nickname,
                openIssues: p.issues?.filter(i =>
                    !['completed', 'resolved_diy', 'cancelled'].includes(i.status)
                ).length || 0
            }))
        };
    } catch (error) {
        console.error('[LandlordWorker] Error listing properties:', error);
        return { count: 0, properties: [] };
    }
}
