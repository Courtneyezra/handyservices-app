/**
 * Tenant Notification Service
 *
 * Sends WhatsApp notifications to tenants for issue lifecycle events:
 * - Status changes (T4)
 * - Contractor assignment (T5)
 * - Appointment reminders (T6)
 * - Job completion (T7)
 * - Satisfaction surveys (T8)
 * - Payment confirmations (L7)
 * - Balance/invoice reminders (L8)
 *
 * All outbound messages use sendWhatsAppMessage() from meta-whatsapp.ts.
 * All sends are wrapped in try/catch so a failed notification never crashes the main flow.
 */

import { sendWhatsAppMessage } from '../meta-whatsapp';
import { db } from '../db';
import { tenantIssues, contractorJobs } from '@shared/schema';
import { eq, and, between } from 'drizzle-orm';

// ==========================================
// T4: Issue Status Updates
// ==========================================

/**
 * Notify a tenant when their issue status changes.
 *
 * @param tenantPhone  - E.164 phone number (e.g. "+447508744402")
 * @param tenantName   - Tenant first name / display name
 * @param issueDescription - Short description of the issue
 * @param newStatus    - The new status the issue has moved to
 * @param extra        - Optional extra data (e.g. scheduled date)
 */
export async function notifyTenantStatusChange(
    tenantPhone: string,
    tenantName: string,
    issueDescription: string,
    newStatus: string,
    extra?: { scheduledDate?: string }
): Promise<void> {
    const statusMessages: Record<string, string> = {
        quoted: `Hi ${tenantName}, we've assessed your ${issueDescription} and prepared a quote for your landlord.`,
        approved: `Hi ${tenantName}, your landlord has approved the repair for ${issueDescription}. We're scheduling it now.`,
        scheduled: `Hi ${tenantName}, your ${issueDescription} repair has been scheduled${extra?.scheduledDate ? ` for ${extra.scheduledDate}` : ''}.`,
        in_progress: `Hi ${tenantName}, work has started on your ${issueDescription}.`,
        completed: `Hi ${tenantName}, your ${issueDescription} has been completed! If you notice any problems, just message us here.`,
    };

    const message = statusMessages[newStatus];
    if (!message) {
        console.log(`[TenantNotifications] No notification template for status: ${newStatus}`);
        return;
    }

    try {
        await sendWhatsAppMessage(tenantPhone, message);
        console.log(`[TenantNotifications] Status update (${newStatus}) sent to ${tenantPhone}`);
    } catch (error) {
        console.error(`[TenantNotifications] Failed to send status update (${newStatus}) to ${tenantPhone}:`, error);
    }
}

// ==========================================
// T5: Contractor Assigned Notification
// ==========================================

/**
 * Notify a tenant that a contractor has been assigned to their issue.
 *
 * @param tenantPhone    - E.164 phone number
 * @param tenantName     - Tenant display name
 * @param contractorName - Contractor name / business name
 * @param issueDescription - Short description of the issue
 * @param date           - Scheduled date string (e.g. "Monday 3rd March")
 * @param timeWindow     - Arrival window (e.g. "9am - 12pm")
 */
export async function notifyTenantContractorAssigned(
    tenantPhone: string,
    tenantName: string,
    contractorName: string,
    issueDescription: string,
    date: string,
    timeWindow: string
): Promise<void> {
    const message = `Hi ${tenantName}, good news! ${contractorName} has been assigned to your ${issueDescription} and is scheduled for ${date}. They'll arrive between ${timeWindow}.`;

    try {
        await sendWhatsAppMessage(tenantPhone, message);
        console.log(`[TenantNotifications] Contractor assigned notification sent to ${tenantPhone}`);
    } catch (error) {
        console.error(`[TenantNotifications] Failed to send contractor assigned notification to ${tenantPhone}:`, error);
    }
}

// ==========================================
// T6: Appointment Reminder (Day Before) - Cron
// ==========================================

/**
 * Cron function: finds tenant issues with a job scheduled for tomorrow and sends a reminder.
 *
 * NOTE: The tenant_issues table does not have a `reminderSent` or `lastReminderAt` column.
 *       A migration should add one of these fields to avoid duplicate reminders.
 *       For now, this function uses the `landlordLastRemindedAt` field as a proxy,
 *       but a dedicated `tenantReminderSentAt` timestamp column is recommended.
 *
 * Should be wired into a daily cron scheduler (not done here).
 */
export async function checkAppointmentReminders(): Promise<void> {
    console.log('[TenantNotifications] Running appointment reminder check...');

    try {
        const now = new Date();
        const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

        // Find tenant issues that are scheduled and linked to a contractor job scheduled for tomorrow
        const scheduledIssues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.status, 'scheduled')
            ),
            with: {
                tenant: true,
                property: true,
                job: true
            }
        });

        let remindersSent = 0;

        for (const issue of scheduledIssues) {
            // Check if the linked job is scheduled for tomorrow
            if (!issue.job?.scheduledDate) continue;

            const jobDate = new Date(issue.job.scheduledDate);
            if (jobDate < tomorrowStart || jobDate > tomorrowEnd) continue;

            // Skip if we already sent a reminder (using landlordLastRemindedAt as proxy)
            // TODO: Add a dedicated `tenantReminderSentAt` column to tenant_issues
            if (issue.landlordLastRemindedAt) {
                const lastReminder = new Date(issue.landlordLastRemindedAt);
                const hoursSinceReminder = (now.getTime() - lastReminder.getTime()) / (1000 * 60 * 60);
                if (hoursSinceReminder < 20) continue; // Skip if reminded within 20 hours
            }

            if (!issue.tenant?.phone) continue;

            const timeWindow = issue.job.scheduledTime
                ? `${issue.job.scheduledTime} (approx. ${issue.job.estimatedDuration || 60} minutes)`
                : '9am - 5pm';

            const message = `Hi ${issue.tenant.name}, just a reminder: your repair for ${issue.issueDescription || 'your reported issue'} is scheduled for tomorrow. The contractor will arrive between ${timeWindow}.`;

            try {
                await sendWhatsAppMessage(issue.tenant.phone, message);
                remindersSent++;

                // Mark as reminded (using landlordLastRemindedAt as proxy until schema is updated)
                await db.update(tenantIssues)
                    .set({ landlordLastRemindedAt: now, updatedAt: now })
                    .where(eq(tenantIssues.id, issue.id));

                console.log(`[TenantNotifications] Appointment reminder sent to ${issue.tenant.name} (${issue.tenant.phone})`);
            } catch (error) {
                console.error(`[TenantNotifications] Failed to send appointment reminder to ${issue.tenant.phone}:`, error);
            }
        }

        console.log(`[TenantNotifications] Appointment reminder check complete. ${remindersSent} reminders sent.`);
    } catch (error) {
        console.error('[TenantNotifications] Appointment reminder check failed:', error);
    }
}

// ==========================================
// T7: Job Completion Notification
// ==========================================

/**
 * Notify a tenant that their job has been completed.
 *
 * @param tenantPhone      - E.164 phone number
 * @param tenantName       - Tenant display name
 * @param issueDescription - Short description of the issue
 */
export async function notifyTenantJobComplete(
    tenantPhone: string,
    tenantName: string,
    issueDescription: string
): Promise<void> {
    const message = `Hi ${tenantName}, your ${issueDescription} has been completed! If you notice any issues, just message us here. We're always happy to help.`;

    try {
        await sendWhatsAppMessage(tenantPhone, message);
        console.log(`[TenantNotifications] Job completion notification sent to ${tenantPhone}`);
    } catch (error) {
        console.error(`[TenantNotifications] Failed to send job completion notification to ${tenantPhone}:`, error);
    }
}

// ==========================================
// T8: Satisfaction Survey
// ==========================================

/**
 * Send a satisfaction survey to a tenant after job completion.
 *
 * @param tenantPhone      - E.164 phone number
 * @param tenantName       - Tenant display name
 * @param issueDescription - Short description of the issue
 */
export async function sendSatisfactionSurvey(
    tenantPhone: string,
    tenantName: string,
    issueDescription: string
): Promise<void> {
    const message = `Hi ${tenantName}, how was the recent work on your ${issueDescription}? Reply with a number 1-5 (1=poor, 5=excellent). Your feedback helps us improve!`;

    try {
        await sendWhatsAppMessage(tenantPhone, message);
        console.log(`[TenantNotifications] Satisfaction survey sent to ${tenantPhone}`);
    } catch (error) {
        console.error(`[TenantNotifications] Failed to send satisfaction survey to ${tenantPhone}:`, error);
    }
}

/**
 * Cron function: finds issues completed ~24 hours ago and sends satisfaction surveys.
 *
 * Should be wired into a daily cron scheduler (not done here).
 */
export async function checkSatisfactionSurveys(): Promise<void> {
    console.log('[TenantNotifications] Running satisfaction survey check...');

    try {
        const now = new Date();
        // Look for issues completed between 23 and 25 hours ago (window around 24h mark)
        const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000);
        const windowEnd = new Date(now.getTime() - 23 * 60 * 60 * 1000);

        const completedIssues = await db.query.tenantIssues.findMany({
            where: and(
                eq(tenantIssues.status, 'completed'),
                between(tenantIssues.resolvedAt, windowStart, windowEnd)
            ),
            with: {
                tenant: true,
                property: true
            }
        });

        let surveysSent = 0;

        for (const issue of completedIssues) {
            if (!issue.tenant?.phone) continue;

            try {
                await sendSatisfactionSurvey(
                    issue.tenant.phone,
                    issue.tenant.name,
                    issue.issueDescription || 'your reported issue'
                );
                surveysSent++;
            } catch (error) {
                console.error(`[TenantNotifications] Failed to send survey for issue ${issue.id}:`, error);
            }
        }

        console.log(`[TenantNotifications] Satisfaction survey check complete. ${surveysSent} surveys sent.`);
    } catch (error) {
        console.error('[TenantNotifications] Satisfaction survey check failed:', error);
    }
}

// ==========================================
// L7: Payment Confirmation
// ==========================================

/**
 * Notify a recipient that a payment has been received.
 *
 * @param recipientPhone - E.164 phone number (tenant or landlord)
 * @param amount         - Formatted amount string (e.g. "\u00A3150.00")
 * @param jobDescription - Description of the job paid for
 * @param reference      - Payment reference number
 */
export async function notifyPaymentReceived(
    recipientPhone: string,
    amount: string,
    jobDescription: string,
    reference: string
): Promise<void> {
    const message = `Payment of ${amount} received for ${jobDescription}. Thank you! Reference: ${reference}`;

    try {
        await sendWhatsAppMessage(recipientPhone, message);
        console.log(`[TenantNotifications] Payment confirmation sent to ${recipientPhone}`);
    } catch (error) {
        console.error(`[TenantNotifications] Failed to send payment confirmation to ${recipientPhone}:`, error);
    }
}

// ==========================================
// L8: Balance / Invoice Reminder
// ==========================================

/**
 * Send a balance/invoice reminder to a recipient.
 *
 * @param recipientPhone  - E.164 phone number (landlord typically)
 * @param amount          - Formatted amount string (e.g. "\u00A3150.00")
 * @param jobDescription  - Description of the job
 * @param propertyAddress - Property address for context
 * @param paymentLink     - URL where recipient can pay
 */
export async function sendBalanceReminder(
    recipientPhone: string,
    amount: string,
    jobDescription: string,
    propertyAddress: string,
    paymentLink: string
): Promise<void> {
    const message = `Reminder: outstanding balance of ${amount} for ${jobDescription} at ${propertyAddress}. Pay here: ${paymentLink}`;

    try {
        await sendWhatsAppMessage(recipientPhone, message);
        console.log(`[TenantNotifications] Balance reminder sent to ${recipientPhone}`);
    } catch (error) {
        console.error(`[TenantNotifications] Failed to send balance reminder to ${recipientPhone}:`, error);
    }
}

/**
 * Cron function: finds outstanding balances on completed jobs and sends reminders.
 *
 * Looks for contractor_jobs that are completed but unpaid, and sends a reminder
 * to the associated landlord.
 *
 * Should be wired into a weekly or bi-weekly cron scheduler (not done here).
 */
export async function checkOutstandingBalances(): Promise<void> {
    console.log('[TenantNotifications] Running outstanding balance check...');

    try {
        // Find completed but unpaid contractor jobs
        const unpaidJobs = await db.query.contractorJobs.findMany({
            where: and(
                eq(contractorJobs.status, 'completed'),
                eq(contractorJobs.paymentStatus, 'unpaid')
            )
        });

        let remindersSent = 0;

        for (const job of unpaidJobs) {
            // Find the tenant issue linked to this job to get landlord info
            const issue = await db.query.tenantIssues.findFirst({
                where: eq(tenantIssues.jobId, job.id),
                with: {
                    landlord: true,
                    property: true
                }
            });

            if (!issue?.landlord?.phone) continue;

            const amount = job.payoutPence
                ? `\u00A3${(job.payoutPence / 100).toFixed(2)}`
                : 'outstanding amount';
            const propertyAddress = issue.property?.address || job.address || 'your property';
            const jobDesc = job.jobDescription || issue.issueDescription || 'completed work';

            // TODO: Replace with actual payment link when Stripe integration is complete
            const paymentLink = `https://handyservices.co.uk/pay/${job.id}`;

            try {
                await sendBalanceReminder(
                    issue.landlord.phone,
                    amount,
                    jobDesc,
                    propertyAddress,
                    paymentLink
                );
                remindersSent++;
            } catch (error) {
                console.error(`[TenantNotifications] Failed to send balance reminder for job ${job.id}:`, error);
            }
        }

        console.log(`[TenantNotifications] Outstanding balance check complete. ${remindersSent} reminders sent.`);
    } catch (error) {
        console.error('[TenantNotifications] Outstanding balance check failed:', error);
    }
}
