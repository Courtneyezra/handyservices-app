/**
 * Landlord Notifications Service
 *
 * Handles all outbound WhatsApp notifications to landlords:
 * - L3: Approval requests
 * - L4: Approval reply handling
 * - L6: Job completion reports
 * - L9: Emergency escalation chain
 * - L10: Quarterly maintenance check-ins
 * - L11: Monthly spend summaries
 */

import { sendWhatsAppMessage } from '../meta-whatsapp';
import { db } from '../db';
import { tenantIssues, landlordSettings, leads, properties, tenants } from '@shared/schema';
import { eq, and, isNull, lte, sql, desc, ne } from 'drizzle-orm';

// ==========================================
// L3: APPROVAL REQUEST
// ==========================================

/**
 * Send an approval request to the landlord via WhatsApp.
 * Called when the dispatch decision is 'request_approval'.
 */
export async function sendApprovalRequest(
    landlordPhone: string,
    propertyAddress: string,
    issueDescription: string,
    estimateLow: number,
    estimateHigh: number
): Promise<void> {
    const message = `\u{1F514} *Approval Needed*

Property: ${propertyAddress}
Issue: ${issueDescription.substring(0, 120)}${issueDescription.length > 120 ? '...' : ''}
Estimated cost: \u00A3${estimateLow}-\u00A3${estimateHigh}

Reply YES to approve or NO to discuss.`;

    try {
        await sendWhatsAppMessage(landlordPhone, message);
        console.log(`[LandlordNotifications] Approval request sent to ${landlordPhone}`);
    } catch (error) {
        console.error(`[LandlordNotifications] Failed to send approval request to ${landlordPhone}:`, error);
    }
}

// ==========================================
// L4: LANDLORD APPROVAL REPLY HANDLER
// ==========================================

/**
 * Handle a landlord's reply to an approval request.
 * Checks for simple YES/NO/APPROVE/REJECT keywords.
 *
 * Returns { handled: true } if the message was an approval reply,
 * { handled: false } if not (so the AI worker can handle it).
 */
export async function handleLandlordApprovalReply(
    landlordPhone: string,
    replyText: string
): Promise<{ handled: boolean; action: string }> {
    const normalizedReply = replyText.trim().toUpperCase();

    // Check if this is a simple approval/rejection keyword
    const approveKeywords = ['YES', 'APPROVE', 'APPROVED', 'OK', 'GO AHEAD', 'DO IT'];
    const rejectKeywords = ['NO', 'REJECT', 'REJECTED', 'STOP', 'HOLD', 'WAIT', 'CANCEL'];

    const isApproval = approveKeywords.includes(normalizedReply);
    const isRejection = rejectKeywords.includes(normalizedReply);

    if (!isApproval && !isRejection) {
        return { handled: false, action: 'not_approval_reply' };
    }

    try {
        // Find the landlord by phone
        const normalizedPhone = normalizePhone(landlordPhone);
        const landlord = await db.query.leads.findFirst({
            where: eq(leads.phone, normalizedPhone)
        });

        if (!landlord) {
            console.log(`[LandlordNotifications] No landlord found for phone ${normalizedPhone}`);
            return { handled: false, action: 'landlord_not_found' };
        }

        // Find pending approval issues for this landlord
        const pendingIssue = await db.query.tenantIssues.findFirst({
            where: and(
                eq(tenantIssues.landlordLeadId, landlord.id),
                eq(tenantIssues.status, 'reported'),
                isNull(tenantIssues.landlordApprovedAt),
                isNull(tenantIssues.landlordRejectedAt)
            ),
            orderBy: desc(tenantIssues.createdAt),
            with: {
                tenant: true,
                property: true
            }
        });

        if (!pendingIssue) {
            console.log(`[LandlordNotifications] No pending approval found for landlord ${landlord.id}`);
            // Still handled - send a message back
            try {
                await sendWhatsAppMessage(normalizedPhone,
                    `There are no pending approvals at the moment. If you have a question, just type it and we'll help.`
                );
            } catch (err) {
                console.error(`[LandlordNotifications] Failed to send no-pending reply:`, err);
            }
            return { handled: true, action: 'no_pending_approval' };
        }

        if (isApproval) {
            // Approve the issue
            await db.update(tenantIssues)
                .set({
                    status: 'approved',
                    landlordApprovedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(tenantIssues.id, pendingIssue.id));

            console.log(`[LandlordNotifications] Issue ${pendingIssue.id} approved by landlord ${landlord.id}`);

            // Notify landlord of confirmation
            try {
                await sendWhatsAppMessage(normalizedPhone,
                    `\u2705 *Approved*\n\nJob at ${pendingIssue.property?.address || 'your property'} has been approved. We'll schedule it and keep you updated.`
                );
            } catch (err) {
                console.error(`[LandlordNotifications] Failed to send approval confirmation:`, err);
            }

            // Notify tenant that work is approved
            if (pendingIssue.tenant?.phone) {
                try {
                    await sendWhatsAppMessage(pendingIssue.tenant.phone,
                        `Great news! Your landlord has approved the repair at ${pendingIssue.property?.address || 'your property'}. We'll be in touch to schedule a time.`
                    );
                } catch (err) {
                    console.error(`[LandlordNotifications] Failed to notify tenant of approval:`, err);
                }
            }

            return { handled: true, action: 'approved' };
        } else {
            // Reject the issue
            await db.update(tenantIssues)
                .set({
                    status: 'cancelled',
                    landlordRejectedAt: new Date(),
                    landlordRejectionReason: `Landlord replied: ${replyText}`,
                    updatedAt: new Date()
                })
                .where(eq(tenantIssues.id, pendingIssue.id));

            console.log(`[LandlordNotifications] Issue ${pendingIssue.id} rejected by landlord ${landlord.id}`);

            // Notify landlord of confirmation
            try {
                await sendWhatsAppMessage(normalizedPhone,
                    `\u274C *Noted*\n\nJob at ${pendingIssue.property?.address || 'your property'} has been put on hold. Reply if you'd like to discuss options.`
                );
            } catch (err) {
                console.error(`[LandlordNotifications] Failed to send rejection confirmation:`, err);
            }

            // Notify admin of rejection (don't notify tenant directly about rejection)
            console.log(`[LandlordNotifications] ADMIN ALERT: Landlord ${landlord.customerName} rejected issue ${pendingIssue.id} at ${pendingIssue.property?.address}`);

            return { handled: true, action: 'rejected' };
        }
    } catch (error) {
        console.error(`[LandlordNotifications] Error handling approval reply:`, error);
        return { handled: false, action: 'error' };
    }
}

// ==========================================
// L6: JOB COMPLETION REPORT TO LANDLORD
// ==========================================

/**
 * Notify the landlord that a job has been completed.
 * Includes property, issue summary, cost, and photos link.
 */
export async function notifyLandlordJobComplete(
    landlordPhone: string,
    propertyAddress: string,
    issueDescription: string,
    cost: number,
    photosLink: string
): Promise<void> {
    const message = `\u2705 *Job Complete*

Property: ${propertyAddress}
Issue: ${issueDescription.substring(0, 100)}${issueDescription.length > 100 ? '...' : ''}
Cost: \u00A3${cost.toFixed(2)}
Photos: ${photosLink}

Invoice will follow.`;

    try {
        await sendWhatsAppMessage(landlordPhone, message);
        console.log(`[LandlordNotifications] Job completion notification sent to ${landlordPhone}`);
    } catch (error) {
        console.error(`[LandlordNotifications] Failed to send job completion notification to ${landlordPhone}:`, error);
    }
}

// ==========================================
// L9: EMERGENCY ESCALATION CHAIN
// ==========================================

/**
 * Send an emergency escalation message to the landlord.
 * Called when landlord hasn't responded to an emergency notification within 30 minutes.
 */
export async function sendEmergencyEscalation(
    landlordPhone: string,
    propertyAddress: string,
    issueDescription: string
): Promise<void> {
    const message = `\u26A0\uFE0F URGENT: No response received for emergency at ${propertyAddress}: ${issueDescription.substring(0, 80)}${issueDescription.length > 80 ? '...' : ''}. Auto-dispatching in 30 minutes unless you reply HOLD.`;

    try {
        await sendWhatsAppMessage(landlordPhone, message);
        console.log(`[LandlordNotifications] Emergency escalation sent to ${landlordPhone}`);
    } catch (error) {
        console.error(`[LandlordNotifications] Failed to send emergency escalation to ${landlordPhone}:`, error);
    }
}

/**
 * Cron function: Check for emergency issues needing escalation.
 *
 * Logic:
 * 1. Find emergency issues where landlord was notified 30+ minutes ago with no response
 * 2. If reminderCount === 0: Send first escalation, increment reminderCount
 * 3. If reminderCount === 1 and 60+ minutes since notification: Auto-dispatch and notify landlord
 */
export async function checkEmergencyEscalations(): Promise<void> {
    console.log(`[LandlordNotifications] Running emergency escalation check...`);

    try {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000);

        // Find emergency issues that have been notified to landlord but not yet responded to
        const emergencyIssues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.urgency, 'emergency'),
                eq(tenantIssues.status, 'reported'),
                isNull(tenantIssues.landlordApprovedAt),
                isNull(tenantIssues.landlordRejectedAt)
            ),
            with: {
                landlord: true,
                property: true
            }
        });

        for (const issue of emergencyIssues) {
            if (!issue.landlordNotifiedAt || !issue.landlord?.phone || !issue.property?.address) {
                continue;
            }

            const notifiedAt = new Date(issue.landlordNotifiedAt);
            const reminderCount = issue.landlordReminderCount || 0;

            // First escalation: 30 minutes after initial notification
            if (reminderCount === 0 && notifiedAt <= thirtyMinutesAgo) {
                try {
                    await sendEmergencyEscalation(
                        issue.landlord.phone,
                        issue.property.address,
                        issue.issueDescription || 'Emergency issue'
                    );

                    await db.update(tenantIssues)
                        .set({
                            landlordReminderCount: 1,
                            landlordLastRemindedAt: new Date(),
                            updatedAt: new Date()
                        })
                        .where(eq(tenantIssues.id, issue.id));

                    console.log(`[LandlordNotifications] First emergency escalation sent for issue ${issue.id}`);
                } catch (err) {
                    console.error(`[LandlordNotifications] Failed first escalation for issue ${issue.id}:`, err);
                }
            }

            // Auto-dispatch: 60 minutes after initial notification (30 mins after first escalation)
            if (reminderCount === 1 && notifiedAt <= sixtyMinutesAgo) {
                try {
                    // Auto-dispatch the issue
                    await db.update(tenantIssues)
                        .set({
                            status: 'approved',
                            dispatchDecision: 'auto_dispatch',
                            dispatchReason: 'Emergency auto-dispatch: landlord did not respond within 60 minutes',
                            landlordApprovedAt: new Date(),
                            landlordReminderCount: 2,
                            landlordLastRemindedAt: new Date(),
                            updatedAt: new Date()
                        })
                        .where(eq(tenantIssues.id, issue.id));

                    // Notify landlord of auto-dispatch
                    await sendWhatsAppMessage(issue.landlord.phone,
                        `\u{1F6A8} *Emergency Auto-Dispatched*\n\nNo response received. A handyman has been dispatched to ${issue.property.address} for: ${(issue.issueDescription || 'Emergency issue').substring(0, 80)}.\n\nWe'll send updates as the job progresses.`
                    );

                    console.log(`[LandlordNotifications] Emergency auto-dispatched for issue ${issue.id}`);
                } catch (err) {
                    console.error(`[LandlordNotifications] Failed auto-dispatch for issue ${issue.id}:`, err);
                }
            }
        }

        console.log(`[LandlordNotifications] Emergency escalation check complete. Checked ${emergencyIssues.length} issues.`);
    } catch (error) {
        console.error(`[LandlordNotifications] Emergency escalation check failed:`, error);
    }
}

// ==========================================
// L10: QUARTERLY MAINTENANCE CHECK-IN
// ==========================================

/**
 * Send a quarterly maintenance check-in message to a landlord.
 */
export async function sendMaintenanceCheckIn(
    landlordPhone: string,
    landlordName: string,
    propertyAddress: string
): Promise<void> {
    const message = `Hi ${landlordName}, it's time for your seasonal property check at ${propertyAddress}. Want us to schedule an inspection? Reply YES to book.`;

    try {
        await sendWhatsAppMessage(landlordPhone, message);
        console.log(`[LandlordNotifications] Quarterly maintenance check-in sent to ${landlordPhone}`);
    } catch (error) {
        console.error(`[LandlordNotifications] Failed to send maintenance check-in to ${landlordPhone}:`, error);
    }
}

/**
 * Cron function: Find landlords due for quarterly maintenance check-in.
 *
 * Logic: Find landlords whose last completed job was 90+ days ago (or who have never had a job).
 * Send them a check-in message for each property.
 */
export async function checkQuarterlyMaintenance(): Promise<void> {
    console.log(`[LandlordNotifications] Running quarterly maintenance check...`);

    try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        // Find active landlords with properties
        const landlords = await db.query.leads.findMany({
            where: and(
                eq(leads.status, 'completed'),
                // Only landlord segments
                sql`${leads.segment} IN ('LANDLORD', 'PROP_MGR')`
            )
        });

        // Also find landlords who have properties but may have different statuses
        const landlordProperties = await db.query.properties.findMany({
            where: eq(properties.isActive, true),
            with: {
                landlord: true,
                issues: {
                    orderBy: desc(tenantIssues.createdAt),
                    limit: 1
                }
            }
        });

        const checkedLandlords = new Set<string>();

        for (const prop of landlordProperties) {
            if (!prop.landlord?.phone || !prop.landlord?.customerName) {
                continue;
            }

            // Only send one check-in per landlord per run
            const landlordId = prop.landlordLeadId;
            if (checkedLandlords.has(landlordId)) {
                continue;
            }

            // Check if the landlord is in a landlord segment
            if (!['LANDLORD', 'PROP_MGR'].includes(prop.landlord.segment || '')) {
                continue;
            }

            // Check last completed issue date
            const lastIssue = prop.issues?.[0];
            const lastActivity = lastIssue?.resolvedAt || lastIssue?.createdAt;

            // If no activity or last activity was 90+ days ago, send check-in
            if (!lastActivity || new Date(lastActivity) <= ninetyDaysAgo) {
                try {
                    await sendMaintenanceCheckIn(
                        prop.landlord.phone,
                        prop.landlord.customerName,
                        prop.address
                    );
                    checkedLandlords.add(landlordId);
                } catch (err) {
                    console.error(`[LandlordNotifications] Failed check-in for landlord ${landlordId}:`, err);
                }
            }
        }

        console.log(`[LandlordNotifications] Quarterly maintenance check complete. Sent ${checkedLandlords.size} check-ins.`);
    } catch (error) {
        console.error(`[LandlordNotifications] Quarterly maintenance check failed:`, error);
    }
}

// ==========================================
// L11: MONTHLY SPEND SUMMARY
// ==========================================

/**
 * Send a monthly spend summary to a single landlord.
 */
export async function sendMonthlySummary(
    landlordPhone: string,
    landlordName: string,
    jobCount: number,
    totalSpend: number,
    dashboardLink: string
): Promise<void> {
    const message = `Hi ${landlordName}, your monthly property report:
\u2022 ${jobCount} job${jobCount !== 1 ? 's' : ''} completed
\u2022 Total spend: \u00A3${totalSpend.toFixed(2)}

View full report: ${dashboardLink}`;

    try {
        await sendWhatsAppMessage(landlordPhone, message);
        console.log(`[LandlordNotifications] Monthly summary sent to ${landlordPhone}`);
    } catch (error) {
        console.error(`[LandlordNotifications] Failed to send monthly summary to ${landlordPhone}:`, error);
    }
}

/**
 * Cron function: Send monthly summaries to all active landlords.
 * Intended to run on the 1st of each month.
 *
 * Logic: For each landlord with LANDLORD or PROP_MGR segment,
 * sum up completed jobs and total spend from the previous month.
 */
export async function sendMonthlySummaries(): Promise<void> {
    console.log(`[LandlordNotifications] Running monthly summaries...`);

    try {
        const now = new Date();
        // Previous month date range
        const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Find all landlord-segment leads with phone numbers
        const landlordLeads = await db.query.leads.findMany({
            where: sql`${leads.segment} IN ('LANDLORD', 'PROP_MGR') AND ${leads.phone} IS NOT NULL`
        });

        let sentCount = 0;

        for (const landlord of landlordLeads) {
            if (!landlord.phone || !landlord.customerName) {
                continue;
            }

            try {
                // Get completed issues for this landlord in the previous month
                const completedIssues = await db.query.tenantIssues.findMany({
                    where: and(
                        eq(tenantIssues.landlordLeadId, landlord.id),
                        eq(tenantIssues.status, 'completed'),
                        sql`${tenantIssues.resolvedAt} >= ${firstOfLastMonth}`,
                        sql`${tenantIssues.resolvedAt} < ${firstOfThisMonth}`
                    )
                });

                const jobCount = completedIssues.length;

                // Sum up costs (use high estimate as proxy for actual cost)
                const totalSpendPence = completedIssues.reduce((sum, issue) => {
                    return sum + (issue.priceEstimateHighPence || issue.priceEstimateLowPence || 0);
                }, 0);
                const totalSpend = totalSpendPence / 100;

                // Only send if there was activity or if landlord has active properties
                if (jobCount > 0) {
                    const dashboardLink = `${process.env.APP_URL || 'https://app.handyservices.co.uk'}/landlord/dashboard`;

                    await sendMonthlySummary(
                        landlord.phone,
                        landlord.customerName,
                        jobCount,
                        totalSpend,
                        dashboardLink
                    );
                    sentCount++;
                }
            } catch (err) {
                console.error(`[LandlordNotifications] Failed monthly summary for landlord ${landlord.id}:`, err);
            }
        }

        console.log(`[LandlordNotifications] Monthly summaries complete. Sent ${sentCount} summaries.`);
    } catch (error) {
        console.error(`[LandlordNotifications] Monthly summaries failed:`, error);
    }
}

// ==========================================
// UTILITY: Phone Normalization
// ==========================================

/**
 * Normalize phone number to E.164 format (consistent with tenant-chat.ts)
 */
function normalizePhone(phone: string): string {
    // Remove @c.us suffix if present
    let normalized = phone.replace('@c.us', '');

    // Remove any non-digit characters except +
    normalized = normalized.replace(/[^\d+]/g, '');

    // If starts with 0, assume UK and add +44
    if (normalized.startsWith('0')) {
        normalized = '+44' + normalized.substring(1);
    }

    // If doesn't start with +, add it
    if (!normalized.startsWith('+')) {
        normalized = '+' + normalized;
    }

    return normalized;
}
