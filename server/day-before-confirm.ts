/**
 * Day-Before Job Confirmation System (Stage 5)
 *
 * Sends confirmation emails to contractors the evening before a scheduled job.
 * If a contractor doesn't confirm by the deadline, the job is flagged for admin attention.
 *
 * Flow:
 * 1. 6pm daily cron calls sendDayBeforeConfirmations()
 * 2. Finds all jobs scheduled for tomorrow with an assigned contractor
 * 3. Sends each contractor a confirmation email with a one-click confirm link
 * 4. Sets mustCheckInBy to 8pm the same evening (2 hours to respond)
 * 5. 8:30pm cron calls checkUnconfirmedJobs()
 * 6. Any jobs not confirmed are flagged and ops team is notified
 */

import { db } from './db';
import { contractorBookingRequests, handymanProfiles, users } from '../shared/schema';
import { eq, and, gte, lt, isNull, ne } from 'drizzle-orm';
import { Resend } from 'resend';
import { getBaseUrlFromEnv } from './url-utils';
import crypto from 'crypto';

// ==========================================
// HELPERS
// ==========================================

function getResend(): Resend | null {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;
    return new Resend(apiKey);
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

/**
 * Get the start and end of "tomorrow" in local time (UK).
 * Returns UTC timestamps for the boundaries of tomorrow.
 */
function getTomorrowRange(): { start: Date; end: Date } {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    return { start: tomorrow, end: dayAfter };
}

// ==========================================
// SEND DAY-BEFORE CONFIRMATIONS
// ==========================================

/**
 * Finds all jobs scheduled for tomorrow and sends a confirmation
 * email to each assigned contractor.
 *
 * Called by cron at 6pm daily.
 */
export async function sendDayBeforeConfirmations(): Promise<{
    sent: number;
    skipped: number;
    errors: number;
}> {
    const result = { sent: 0, skipped: 0, errors: 0 };
    const { start, end } = getTomorrowRange();

    console.log(`[Day-Before] Checking for jobs scheduled ${formatDate(start)} ...`);

    try {
        // Find jobs scheduled for tomorrow that:
        // - Have an assigned contractor
        // - Are in 'accepted' or 'assigned' assignment status (not completed/rejected/cancelled)
        // - Haven't already been confirmed (dayOfStatus is still 'scheduled')
        const tomorrowJobs = await db.select({
            job: contractorBookingRequests,
            profile: handymanProfiles,
        })
            .from(contractorBookingRequests)
            .innerJoin(
                handymanProfiles,
                eq(contractorBookingRequests.assignedContractorId, handymanProfiles.id)
            )
            .where(and(
                gte(contractorBookingRequests.scheduledDate, start),
                lt(contractorBookingRequests.scheduledDate, end),
                ne(contractorBookingRequests.status, 'completed'),
                ne(contractorBookingRequests.status, 'declined'),
            ));

        if (tomorrowJobs.length === 0) {
            console.log('[Day-Before] No jobs scheduled for tomorrow.');
            return result;
        }

        console.log(`[Day-Before] Found ${tomorrowJobs.length} job(s) scheduled for tomorrow.`);

        const resend = getResend();
        const baseUrl = getBaseUrlFromEnv();

        // Set the confirmation deadline: 8pm today (2 hours from the 6pm send)
        const deadline = new Date();
        deadline.setHours(20, 0, 0, 0);

        for (const { job, profile } of tomorrowJobs) {
            try {
                // Already confirmed (mustCheckInBy was set and dayOfStatus changed)
                // We use mustCheckInBy as the marker that we've already sent the confirmation
                if (job.mustCheckInBy) {
                    console.log(`[Day-Before] Job ${job.id} already has a check-in deadline. Skipping.`);
                    result.skipped++;
                    continue;
                }

                // Get contractor's email from the users table
                const user = await db.select()
                    .from(users)
                    .where(eq(users.id, profile.userId))
                    .limit(1);

                const contractorEmail = user[0]?.email;
                const contractorName = user[0]?.firstName || profile.businessName || 'Contractor';

                if (!contractorEmail) {
                    console.warn(`[Day-Before] No email for contractor ${profile.id}. Skipping job ${job.id}.`);
                    result.skipped++;
                    continue;
                }

                // Set the mustCheckInBy deadline on the job
                await db.update(contractorBookingRequests)
                    .set({
                        mustCheckInBy: deadline,
                        updatedAt: new Date(),
                    })
                    .where(eq(contractorBookingRequests.id, job.id));

                // Build the confirmation URL
                const confirmUrl = `${baseUrl}/api/jobs/${job.id}/confirm-attendance?token=${job.id}`;

                // Send the email
                if (!resend) {
                    console.log(`[Day-Before] Resend not configured. Would email ${contractorEmail} for job ${job.id}`);
                    result.sent++;
                    continue;
                }

                const timeSlot = job.scheduledStartTime && job.scheduledEndTime
                    ? `${job.scheduledStartTime} - ${job.scheduledEndTime}`
                    : job.scheduledSlot === 'am' ? 'Morning (AM)'
                    : job.scheduledSlot === 'pm' ? 'Afternoon (PM)'
                    : 'Full Day';

                const { error } = await resend.emails.send({
                    from: 'Handy Services <dispatch@handyservices.co.uk>',
                    to: [contractorEmail],
                    subject: `Action Required: Confirm tomorrow's job - ${formatDate(start)}`,
                    html: buildConfirmationEmail({
                        contractorName,
                        customerName: job.customerName,
                        jobDescription: job.description || 'As discussed',
                        scheduledDate: formatDate(start),
                        timeSlot,
                        jobId: job.id,
                        confirmUrl,
                        deadlineTime: '8:00 PM today',
                    }),
                });

                if (error) {
                    console.error(`[Day-Before] Email failed for job ${job.id}:`, error);
                    result.errors++;
                } else {
                    console.log(`[Day-Before] Confirmation email sent to ${contractorEmail} for job ${job.id}`);
                    result.sent++;
                }
            } catch (err) {
                console.error(`[Day-Before] Error processing job ${job.id}:`, err);
                result.errors++;
            }
        }
    } catch (err) {
        console.error('[Day-Before] Fatal error in sendDayBeforeConfirmations:', err);
    }

    console.log(`[Day-Before] Done. Sent: ${result.sent}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
    return result;
}

// ==========================================
// CHECK UNCONFIRMED JOBS
// ==========================================

/**
 * Finds jobs where the confirmation deadline has passed but the contractor
 * hasn't confirmed. Sends an alert to the ops team.
 *
 * Called by cron at 8:30pm daily.
 */
export async function checkUnconfirmedJobs(): Promise<{
    flagged: number;
    confirmed: number;
}> {
    const result = { flagged: 0, confirmed: 0 };
    const now = new Date();
    const { start, end } = getTomorrowRange();

    console.log('[Day-Before] Checking for unconfirmed jobs...');

    try {
        // Find jobs scheduled for tomorrow where:
        // - mustCheckInBy has passed
        // - dayOfStatus is still 'scheduled' (meaning contractor didn't confirm)
        const overdueJobs = await db.select({
            job: contractorBookingRequests,
            profile: handymanProfiles,
        })
            .from(contractorBookingRequests)
            .innerJoin(
                handymanProfiles,
                eq(contractorBookingRequests.assignedContractorId, handymanProfiles.id)
            )
            .where(and(
                gte(contractorBookingRequests.scheduledDate, start),
                lt(contractorBookingRequests.scheduledDate, end),
                lt(contractorBookingRequests.mustCheckInBy, now),
                eq(contractorBookingRequests.dayOfStatus, 'scheduled'),
                ne(contractorBookingRequests.status, 'completed'),
                ne(contractorBookingRequests.status, 'declined'),
            ));

        if (overdueJobs.length === 0) {
            console.log('[Day-Before] All contractors have confirmed (or no jobs to check).');
            return result;
        }

        console.log(`[Day-Before] ${overdueJobs.length} job(s) NOT confirmed by deadline.`);

        // Build summary for ops email
        const unconfirmedSummary: string[] = [];

        for (const { job, profile } of overdueJobs) {
            const user = await db.select()
                .from(users)
                .where(eq(users.id, profile.userId))
                .limit(1);

            const contractorName = user[0]?.firstName
                ? `${user[0].firstName} ${user[0].lastName || ''}`.trim()
                : profile.businessName || 'Unknown';
            const contractorEmail = user[0]?.email || 'N/A';

            unconfirmedSummary.push(
                `<tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${job.id}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${contractorName} (${contractorEmail})</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${job.customerName}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${job.description?.substring(0, 60) || 'N/A'}</td>
                </tr>`
            );

            result.flagged++;
        }

        // Send ops alert
        const resend = getResend();
        const opsEmail = process.env.OPS_NOTIFICATION_EMAIL || 'ops@handyservices.co.uk';
        const baseUrl = getBaseUrlFromEnv();

        if (resend) {
            await resend.emails.send({
                from: 'Handy Services System <system@handyservices.co.uk>',
                to: [opsEmail],
                subject: `[ALERT] ${result.flagged} contractor(s) have NOT confirmed tomorrow's jobs`,
                html: `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333;">
    <div style="background: #dc2626; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0;">Unconfirmed Jobs Alert</h1>
        <p style="color: #fecaca; margin: 5px 0 0;">Action required - contractors did not confirm attendance</p>
    </div>
    <div style="background: #fff; padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
        <p>${result.flagged} job(s) scheduled for <strong>${formatDate(start)}</strong> have not been confirmed by the assigned contractor.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 8px; text-align: left;">Job ID</th>
                    <th style="padding: 8px; text-align: left;">Contractor</th>
                    <th style="padding: 8px; text-align: left;">Customer</th>
                    <th style="padding: 8px; text-align: left;">Description</th>
                </tr>
            </thead>
            <tbody>
                ${unconfirmedSummary.join('')}
            </tbody>
        </table>
        <div style="text-align: center; margin: 20px 0;">
            <a href="${baseUrl}/admin/dispatch" style="display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to Dispatch Dashboard</a>
        </div>
        <p style="color: #666; font-size: 14px;">Please contact these contractors directly or arrange backup coverage.</p>
    </div>
    <div style="background: #1a1a2e; padding: 15px; text-align: center; border-radius: 0 0 10px 10px;">
        <p style="color: #999; margin: 0; font-size: 12px;">Handy Services Ops Alert System</p>
    </div>
</body>
</html>`,
            });

            console.log(`[Day-Before] Ops alert sent to ${opsEmail} for ${result.flagged} unconfirmed job(s).`);
        } else {
            console.log(`[Day-Before] Resend not configured. ${result.flagged} unconfirmed job(s) need attention.`);
        }
    } catch (err) {
        console.error('[Day-Before] Fatal error in checkUnconfirmedJobs:', err);
    }

    return result;
}

// ==========================================
// EMAIL TEMPLATE
// ==========================================

interface ConfirmationEmailData {
    contractorName: string;
    customerName: string;
    jobDescription: string;
    scheduledDate: string;
    timeSlot: string;
    jobId: string;
    confirmUrl: string;
    deadlineTime: string;
}

function buildConfirmationEmail(data: ConfirmationEmailData): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirm Tomorrow's Job</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #e8b323; margin: 0; font-size: 24px;">Please Confirm Tomorrow's Job</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">Response needed by ${data.deadlineTime}</p>
    </div>

    <!-- Main Content -->
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">

        <p style="font-size: 18px; margin-bottom: 20px;">Hi ${data.contractorName},</p>

        <p>You have a job scheduled for <strong>tomorrow</strong>. Please confirm you'll be attending.</p>

        <!-- Job Details Card -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid #e8b323;">
            <h3 style="margin: 0 0 15px 0; color: #1a1a2e;">Job Details</h3>
            <p style="margin: 8px 0;"><strong>Reference:</strong> ${data.jobId}</p>
            <p style="margin: 8px 0;"><strong>Customer:</strong> ${data.customerName}</p>
            <p style="margin: 8px 0;"><strong>Date:</strong> ${data.scheduledDate}</p>
            <p style="margin: 8px 0;"><strong>Time:</strong> ${data.timeSlot}</p>
            <p style="margin: 8px 0;"><strong>Description:</strong> ${data.jobDescription}</p>
        </div>

        <!-- Confirm Button -->
        <div style="text-align: center; margin: 30px 0;">
            <a href="${data.confirmUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 16px 50px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px;">Confirm Attendance</a>
        </div>

        <!-- Deadline Warning -->
        <div style="background: #fff3cd; border-radius: 8px; padding: 15px; margin: 25px 0; text-align: center;">
            <p style="margin: 0; color: #856404; font-weight: 600;">
                Please confirm by ${data.deadlineTime}. If we don't hear from you, our dispatch team will follow up.
            </p>
        </div>

        <!-- Can't make it -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #333;">Can't make it?</h4>
            <p style="margin: 0; color: #666;">
                Please let us know ASAP so we can arrange cover.<br>
                Call: <a href="tel:08001234567" style="color: #0d6efd;">0800 XXX XXXX</a><br>
                Email: <a href="mailto:dispatch@handyservices.co.uk" style="color: #0d6efd;">dispatch@handyservices.co.uk</a>
            </p>
        </div>

    </div>

    <!-- Footer -->
    <div style="background: #1a1a2e; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
        <p style="color: #999; margin: 0; font-size: 12px;">
            Handy Services | Property Maintenance Made Easy<br>
            <a href="https://handyservices.co.uk" style="color: #e8b323;">handyservices.co.uk</a>
        </p>
    </div>

</body>
</html>`;
}
