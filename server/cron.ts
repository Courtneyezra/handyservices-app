
import cron from "node-cron";
import { db } from "./db";
import { personalizedQuotes } from "@shared/schema";
import { lt, and, eq, isNull } from "drizzle-orm";

// Initialize Cron Jobs
export function setupCronJobs() {
    console.log("[Cron] Initializing scheduler...");

    // Run every hour to check for reminders
    cron.schedule("0 * * * *", async () => {
        console.log("[Cron] Checking for quote reminders...");
        try {
            const now = new Date();
            const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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

    console.log("[Cron] Scheduler running.");
}
