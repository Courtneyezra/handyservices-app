
import cron from "node-cron";
import { db } from "./db";
import { personalizedQuotes, contractorBookingRequests, handymanProfiles, users } from "@shared/schema";
import { lt, and, eq, isNull, gte, lte, inArray, not, sql } from "drizzle-orm";
import { sendWhatsAppMessage } from "./meta-whatsapp";

// Initialize Cron Jobs
export function setupCronJobs() {
    console.log("[Cron] Initializing scheduler...");

    // Run every hour to check for quote reminders
    cron.schedule("0 * * * *", async () => {
        console.log("[Cron] Checking for quote reminders...");
        try {
            const now = new Date();

            // Find quotes created > 24h ago, not booked, not rejected, not reminded
            // Note: This is a simplified query. In production, we'd have a 'lastReminderSentAt' column.
            // For V1, we'll just log potential candidates.

            // For now, let's just log a "heartbeat" or query recent pending quotes
            const pendingQuotes = await db.select().from(personalizedQuotes)
                .where(and(
                    isNull(personalizedQuotes.bookedAt),
                    isNull(personalizedQuotes.rejectionReason)
                ))
                .limit(5);

            console.log(`[Cron] Found ${pendingQuotes.length} pending quotes potentially needing reminders.`);

            // Here we would iterate and send emails/SMS via our share API logic
            // await sendReminder(quote);

        } catch (error) {
            console.error("[Cron] Error processing reminders:", error);
        }
    });

    // ==========================================
    // DAY-BEFORE REMINDERS - Runs daily at 6pm
    // Sends WhatsApp reminders to CUSTOMERS about tomorrow's jobs
    // ==========================================
    cron.schedule("0 18 * * *", async () => {
        console.log("[DayBefore] Running day-before customer reminders...");
        await sendDayBeforeCustomerReminders();
    });

    console.log("[Cron] Scheduler running.");
}

/**
 * Send day-before WhatsApp reminders to customers with jobs scheduled for tomorrow.
 * Queries contractorBookingRequests where scheduledDate is tomorrow and the job
 * is confirmed (assigned/accepted). Looks up contractor name and sends a friendly
 * reminder message via WhatsApp.
 */
export async function sendDayBeforeCustomerReminders(): Promise<void> {
    try {
        const now = new Date();
        const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

        // Find all confirmed jobs scheduled for tomorrow
        const tomorrowJobs = await db
            .select({
                bookingId: contractorBookingRequests.id,
                customerName: contractorBookingRequests.customerName,
                customerPhone: contractorBookingRequests.customerPhone,
                scheduledDate: contractorBookingRequests.scheduledDate,
                scheduledStartTime: contractorBookingRequests.scheduledStartTime,
                requestedSlot: contractorBookingRequests.requestedSlot,
                assignmentStatus: contractorBookingRequests.assignmentStatus,
                status: contractorBookingRequests.status,
                assignedContractorId: contractorBookingRequests.assignedContractorId,
                contractorId: contractorBookingRequests.contractorId,
                quoteId: contractorBookingRequests.quoteId,
            })
            .from(contractorBookingRequests)
            .where(and(
                gte(contractorBookingRequests.scheduledDate, tomorrowStart),
                lte(contractorBookingRequests.scheduledDate, tomorrowEnd),
                inArray(contractorBookingRequests.assignmentStatus, ['assigned', 'accepted']),
                not(inArray(contractorBookingRequests.status, ['declined', 'completed']))
            ));

        if (tomorrowJobs.length === 0) {
            console.log("[DayBefore] No confirmed jobs scheduled for tomorrow.");
            return;
        }

        console.log(`[DayBefore] Found ${tomorrowJobs.length} confirmed jobs for tomorrow.`);

        let sentCount = 0;
        let skippedCount = 0;

        for (const job of tomorrowJobs) {
            try {
                // Get customer phone — from booking request directly, or fall back to linked quote
                let customerPhone = job.customerPhone;
                let customerName = job.customerName;

                if (!customerPhone && job.quoteId) {
                    const quote = await db.select({
                        phone: personalizedQuotes.phone,
                        customerName: personalizedQuotes.customerName,
                    })
                        .from(personalizedQuotes)
                        .where(eq(personalizedQuotes.id, job.quoteId))
                        .limit(1);

                    if (quote.length > 0) {
                        customerPhone = quote[0].phone;
                        if (!customerName) customerName = quote[0].customerName;
                    }
                }

                // Skip if no phone number available
                if (!customerPhone) {
                    console.log(`[DayBefore] Skipping booking ${job.bookingId} — no customer phone.`);
                    skippedCount++;
                    continue;
                }

                // Look up contractor name
                const effectiveContractorId = job.assignedContractorId || job.contractorId;
                let contractorName = "your handyman";

                if (effectiveContractorId) {
                    const profile = await db.select({
                        userId: handymanProfiles.userId,
                        businessName: handymanProfiles.businessName,
                    })
                        .from(handymanProfiles)
                        .where(eq(handymanProfiles.id, effectiveContractorId))
                        .limit(1);

                    if (profile.length > 0) {
                        if (profile[0].businessName) {
                            contractorName = profile[0].businessName;
                        } else {
                            // Fall back to user first name
                            const user = await db.select({
                                firstName: users.firstName,
                                lastName: users.lastName,
                            })
                                .from(users)
                                .where(eq(users.id, profile[0].userId))
                                .limit(1);

                            if (user.length > 0 && user[0].firstName) {
                                contractorName = user[0].firstName;
                            }
                        }
                    }
                }

                // Determine time slot description
                const timeSlotLabel = getTimeSlotLabel(job.scheduledStartTime, job.requestedSlot);

                // Format the date for the message (e.g., "Tuesday 15th April")
                const scheduledDate = job.scheduledDate ? new Date(job.scheduledDate) : tomorrowStart;
                const dayName = scheduledDate.toLocaleDateString('en-GB', { weekday: 'long' });
                const dayOfMonth = scheduledDate.getDate();
                const monthName = scheduledDate.toLocaleDateString('en-GB', { month: 'long' });
                const ordinal = getOrdinalSuffix(dayOfMonth);
                const formattedDate = `${dayName} ${dayOfMonth}${ordinal} ${monthName}`;

                // Build message
                const firstName = (customerName || "there").split(" ")[0];
                const message = `Hi ${firstName}! 👋\n\nJust a reminder — ${contractorName} from Handy Services will be with you tomorrow (${formattedDate}), ${timeSlotLabel}.\n\nIf you need to reach us: 07449 501762\n\nSee you tomorrow! 🔧`;

                // Send WhatsApp message
                await sendWhatsAppMessage(customerPhone, message);
                sentCount++;
                console.log(`[DayBefore] Sent customer reminder to ${firstName} (${customerPhone}) for booking ${job.bookingId}`);

            } catch (error) {
                console.error(`[DayBefore] Failed to send reminder for booking ${job.bookingId}:`, error);
                // Continue to next job — don't let one failure block others
            }
        }

        console.log(`[DayBefore] Sent ${sentCount} customer reminders for tomorrow. Skipped ${skippedCount}.`);

    } catch (error) {
        console.error("[DayBefore] Customer reminder cron failed:", error);
    }
}

/**
 * Map time slot info to a human-readable label.
 * Checks scheduledStartTime first, then requestedSlot.
 */
function getTimeSlotLabel(scheduledStartTime: string | null, requestedSlot: string | null): string {
    // Check scheduledStartTime (e.g., "09:00", "13:00")
    if (scheduledStartTime) {
        const hour = parseInt(scheduledStartTime.split(":")[0], 10);
        if (!isNaN(hour)) {
            if (hour < 12) return "in the morning";
            if (hour >= 12) return "in the afternoon";
        }
    }

    // Check requestedSlot for AM/PM/FULL_DAY patterns
    if (requestedSlot) {
        const slot = requestedSlot.toUpperCase();
        if (slot === 'AM' || slot === 'MORNING' || slot.includes('MORNING')) return "in the morning";
        if (slot === 'PM' || slot === 'AFTERNOON' || slot.includes('AFTERNOON')) return "in the afternoon";
        if (slot === 'FULL_DAY' || slot.includes('FULL')) return "during the day";
    }

    // Default
    return "during the day";
}

/**
 * Get ordinal suffix for a day number (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinalSuffix(day: number): string {
    if (day >= 11 && day <= 13) return "th";
    switch (day % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
    }
}
