
import cron from "node-cron";
import { db } from "./db";
import { personalizedQuotes, contractorBookingRequests, handymanProfiles, users } from "@shared/schema";
import { lt, and, eq, isNull, gte, lte, inArray, not, sql } from "drizzle-orm";
import { sendCustomerMessage } from "./outbound";
import { getKillSwitch } from "./settings";
import { gateCustomerLoop } from "./worker-gate";
import {
    runRankTracking, runGmbPull, runGscPull, rankEnabled, gmbEnabled, gscEnabled,
    RANK_SCHEDULE, GMB_SCHEDULE, GSC_SCHEDULE,
} from "./seo-automation";

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
    // CUSTOMER-FACING SCHEDULES — Phase 0 (2 Sep 2026): each one below is wrapped in
    // gateCustomerLoop and registers ONLY when COMMS_WORKER=1 (the Railway worker). A dev
    // checkout pointed at production logs a skip line per schedule and registers nothing.
    // Read-only pulls (template poll, won auto-archive, SEO/GMB/GSC) stay ungated.
    // ==========================================

    // ==========================================
    // COMMS AGENT SLA SWEEP — every 30 min during working hours (Mon-Fri 8-18 UK).
    // Ensures every conversation whose SLA clock is running ends up with either a
    // pending draft for Ben to approve or an ask-Ben question. NEVER sends anything
    // itself (drafts go through the approval gate). Gated on appSettings 'comms_agent'
    // .enabled, which ships false — flip it via scripts/_comms-agent-config.ts.
    // ==========================================
    gateCustomerLoop('cron: comms agent SLA sweep (Mon-Fri 8-18)', () => cron.schedule("*/30 8-17 * * 1-5", async () => {
        try {
            const { getCommsAgentConfig, sweepCommsAgent } = await import('./agents/comms');
            const config = await getCommsAgentConfig();
            if (!config.enabled) return;
            const outcome = await sweepCommsAgent();
            if (outcome.processed.length > 0) {
                console.log(`[Cron] Comms sweep: ${outcome.eligible} eligible, ${outcome.processed.length} processed`);
            }
        } catch (error) {
            console.error("[Cron] Comms agent sweep failed:", error);
        }
    }, { timezone: 'Europe/London' }));

    // COMMS AGENT WINDOW-CLOSING LANE — hourly, ALL days/hours (the 24h window doesn't keep
    // office hours; a Sunday-morning enquiry's window dies Monday 09:00 if nobody drafts).
    // Same master gate as the sweep.
    gateCustomerLoop('cron: comms agent window-closing lane (hourly)', () => cron.schedule("15 * * * *", async () => {
        try {
            const { getCommsAgentConfig, windowClosingSweep } = await import('./agents/comms');
            const config = await getCommsAgentConfig();
            if (!config.enabled) return;
            const outcome = await windowClosingSweep();
            if (outcome.processed.length > 0) {
                console.log(`[Cron] Window-closing sweep: ${outcome.eligible} eligible, ${outcome.processed.length} processed`);
            }
        } catch (error) {
            console.error("[Cron] Window-closing sweep failed:", error);
        }
    }, { timezone: 'Europe/London' }));

    // COMMS AGENT AGEING LANE — weekly (Mon 09:30 UK). Enquiries nobody answered for 21+
    // days get auto-triaged with the backlog_revival trigger: dead/spam → closed with a
    // reason tag, genuine leads → revive_candidate tag + ask-Ben. Same master gate as the
    // other comms-agent lanes; never sends anything itself.
    gateCustomerLoop('cron: comms agent backlog ageing lane (Mon 09:30)', () => cron.schedule("30 9 * * 1", async () => {
        try {
            const { getCommsAgentConfig, backlogSweep } = await import('./agents/comms');
            const config = await getCommsAgentConfig();
            if (!config.enabled) return;
            const outcome = await backlogSweep({ olderThanDays: 21, limit: 10 });
            console.log(`[Cron] Backlog ageing sweep: ${outcome.eligible} eligible, ${outcome.processed.length} processed ` +
                `(closed=${outcome.tallies.closed}, revive=${outcome.tallies.reviveCandidates}, asked=${outcome.tallies.questions})`);
        } catch (error) {
            console.error("[Cron] Backlog ageing sweep failed:", error);
        }
    }, { timezone: 'Europe/London' }));

    // WHATSAPP TEMPLATE APPROVAL POLL — hourly at :40 (off the hour, so it never races the
    // other lanes). Twilio has NO webhook for Meta's approval decision, so polling is the only
    // way to learn a template went live. Read-only against Twilio, no LLM, no sends, so it runs
    // ungated — and it alerts via Pushover on approve/reject (see whatsapp-template-sync.ts).
    cron.schedule("40 * * * *", async () => {
        try {
            const { syncWhatsAppTemplates } = await import('./whatsapp-template-sync');
            await syncWhatsAppTemplates('cron');
        } catch (error) {
            console.error("[Cron] WhatsApp template sync failed:", error);
        }
    }, { timezone: 'Europe/London' });

    // WON AUTO-ARCHIVE — daily 03:10. Won cards stay on the board 7 days (post-payment
    // coordination), then archive off it. Pure bookkeeping — no LLM, no sends, no gate.
    // The thread stays searchable; archiving is a board filter, not a deletion.
    cron.schedule("10 3 * * *", async () => {
        try {
            const { archiveStaleWonConversations } = await import('./conversation-stage');
            await archiveStaleWonConversations(7);
        } catch (error) {
            console.error("[Cron] Won auto-archive failed:", error);
        }
    }, { timezone: 'Europe/London' });

    // ==========================================
    // DAY-BEFORE REMINDERS - Runs daily at 6pm
    // Sends WhatsApp reminders to CUSTOMERS about tomorrow's jobs
    // ==========================================
    gateCustomerLoop('cron: day-before customer reminders (18:00)', () => cron.schedule("0 18 * * *", async () => {
        console.log("[DayBefore] Running day-before customer reminders...");
        await sendDayBeforeCustomerReminders();
    }));

    // ==========================================
    // SEO AUTOMATION — self-activates only when the relevant credentials are set,
    // so the scheduler stays quiet before go-live (see server/seo-automation.ts).
    // ==========================================
    if (rankEnabled()) {
        cron.schedule(RANK_SCHEDULE.cron, () => runRankTracking("cron"));
        console.log(`[Cron] SEO rank tracking scheduled (${RANK_SCHEDULE.label}).`);
    } else {
        console.log("[Cron] SEO rank tracking NOT scheduled — APIFY_TOKEN not set.");
    }

    if (gmbEnabled()) {
        cron.schedule(GMB_SCHEDULE.cron, () => runGmbPull("cron"));
        console.log(`[Cron] SEO GMB metrics pull scheduled (${GMB_SCHEDULE.label}).`);
    } else {
        console.log("[Cron] SEO GMB metrics pull NOT scheduled — GOOGLE_GBP_* not set.");
    }

    // GMB POSTING — writes a brand-voice post to the Business Profile.
    // Gated on the same GOOGLE_GBP_* creds as the metrics pull. Mon/Wed/Fri
    // 10:05 (staggered off the hour so it never races the hourly job).
    if (gmbEnabled()) {
        const GMB_POST_CRON = process.env.GMB_POST_CRON || "5 10 * * 1,3,5";
        cron.schedule(GMB_POST_CRON, async () => {
            const { runGmbPostCycle } = await import("./gmb-posts");
            await runGmbPostCycle("cron").catch((err) =>
                console.error("[Cron] GMB post cycle failed:", err));
        });
        console.log(`[Cron] GMB posting scheduled (${GMB_POST_CRON}).`);
    } else {
        console.log("[Cron] GMB posting NOT scheduled — GOOGLE_GBP_* not set.");
    }

    if (gscEnabled()) {
        cron.schedule(GSC_SCHEDULE.cron, () => runGscPull("cron"));
        console.log(`[Cron] SEO GSC pull scheduled (${GSC_SCHEDULE.label}).`);
    } else {
        console.log("[Cron] SEO GSC pull NOT scheduled — GSC_GOOGLE_* not set.");
    }

    console.log("[Cron] Scheduler running.");
}

/**
 * Send day-before WhatsApp reminders to customers with jobs scheduled for tomorrow.
 * Queries contractorBookingRequests where scheduledDate is tomorrow and the job
 * is confirmed (assigned/accepted). Looks up contractor name and sends a friendly
 * reminder message via WhatsApp.
 */
export async function sendDayBeforeCustomerReminders(): Promise<void> {
    // Kill switch check — allows disabling without a deploy
    const killed = await getKillSwitch('day_before_reminders');
    if (killed) {
        console.log('[DayBefore] Kill switch active — skipping customer reminders');
        return;
    }

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

                // Send WhatsApp message via choke point (with opt-out enforcement)
                const sendResult = await sendCustomerMessage({
                    to: customerPhone,
                    body: message,
                    purpose: 'service_reply',  // Job-related, not marketing
                    context: 'day_before_reminder',
                    contactName: customerName,
                });

                if (!sendResult.ok) {
                    console.log(`[DayBefore] Blocked reminder for ${firstName} (${customerPhone}) — ${sendResult.reason || sendResult.error}`);
                    skippedCount++;
                    continue;
                }

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
