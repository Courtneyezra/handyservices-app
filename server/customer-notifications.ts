/**
 * Customer Notification Service
 *
 * Dispatches WhatsApp notifications to customers at key booking/job lifecycle events.
 * Uses the same Twilio-backed sendWhatsAppMessage from meta-whatsapp.ts.
 */

import { db } from './db';
import { contractorBookingRequests, handymanProfiles, users, personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { sendWhatsAppMessage } from './meta-whatsapp';
import { getBaseUrlFromEnv } from './url-utils';

type NotificationEvent =
    | 'booking_confirmed'
    | 'contractor_en_route'
    | 'contractor_arrived'
    | 'job_completed'
    | 'invoice_sent'
    | 'payout_processed'
    | 'variation_request'
    | 'reschedule_confirmed'
    | 'cancellation_confirmed';

interface NotifyCustomerParams {
    quoteId?: string;
    jobId?: string;
    event: NotificationEvent;
    data?: Record<string, any>;
}

/**
 * Look up job details either by quoteId (on the booking request) or by jobId directly.
 */
async function resolveJobDetails(params: NotifyCustomerParams) {
    let job: any = null;

    if (params.jobId) {
        const results = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, params.jobId))
            .limit(1);
        job = results[0] || null;
    }

    if (!job && params.quoteId) {
        const results = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.quoteId, params.quoteId))
            .limit(1);
        job = results[0] || null;
    }

    if (!job) return null;

    // Get contractor name
    let contractorName = 'Your contractor';
    if (job.assignedContractorId) {
        const profile = await db.select({
            businessName: handymanProfiles.businessName,
            userId: handymanProfiles.userId,
        })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, job.assignedContractorId))
            .limit(1);

        if (profile[0]) {
            if (profile[0].businessName) {
                contractorName = profile[0].businessName;
            } else {
                const user = await db.select({ firstName: users.firstName, lastName: users.lastName })
                    .from(users)
                    .where(eq(users.id, profile[0].userId))
                    .limit(1);
                if (user[0]) {
                    contractorName = `${user[0].firstName}${user[0].lastName ? ' ' + user[0].lastName : ''}`;
                }
            }
        }
    }

    // Get customer phone — try job first, then quote
    let customerPhone = job.customerPhone;
    let customerName = job.customerName;
    let address = '';

    if ((!customerPhone || !customerName) && job.quoteId) {
        const quote = await db.select({
            phone: personalizedQuotes.phone,
            customerName: personalizedQuotes.customerName,
            address: personalizedQuotes.address,
            postcode: personalizedQuotes.postcode,
        })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, job.quoteId))
            .limit(1);

        if (quote[0]) {
            customerPhone = customerPhone || quote[0].phone;
            customerName = customerName || quote[0].customerName;
            address = quote[0].address || quote[0].postcode || '';
        }
    }

    return {
        job,
        contractorName,
        customerPhone,
        customerName,
        address,
    };
}

function formatDate(date: Date | string | null): string {
    if (!date) return 'TBC';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function formatSlot(slot: string | null): string {
    if (!slot) return '';
    switch (slot) {
        case 'AM': return 'Morning (8am-12pm)';
        case 'PM': return 'Afternoon (12pm-5pm)';
        case 'FULL_DAY': return 'Full Day';
        default: return slot;
    }
}

function formatCurrency(pence: number): string {
    return `\u00a3${(pence / 100).toFixed(2)}`;
}

/**
 * Build the notification message for each event type.
 */
function buildMessage(
    event: NotificationEvent,
    details: {
        contractorName: string;
        customerName: string;
        address: string;
        job: any;
    },
    data?: Record<string, any>,
): string {
    const { contractorName, customerName, address, job } = details;
    const baseUrl = getBaseUrlFromEnv();
    const portalLink = job.quoteId ? `${baseUrl}/booking-confirmed/${job.quoteId}` : baseUrl;

    switch (event) {
        case 'booking_confirmed': {
            const date = formatDate(data?.date || job.scheduledDate || job.requestedDate);
            const slot = formatSlot(data?.slot || job.scheduledSlot || job.requestedSlot);
            const addr = data?.address || address || 'As confirmed';
            return `\u2705 Your booking is confirmed! ${contractorName} will visit on ${date}${slot ? ', ' + slot : ''}. Address: ${addr}`;
        }

        case 'contractor_en_route':
            return `\ud83d\ude97 ${contractorName} is on the way! ETA ~20 mins.`;

        case 'contractor_arrived':
            return `\ud83d\udccd ${contractorName} has arrived at your property.`;

        case 'job_completed':
            return `\u2705 Your job is complete! ${contractorName} has finished. View photos and your invoice: ${portalLink}`;

        case 'invoice_sent': {
            const amount = data?.amountPence ? formatCurrency(data.amountPence) : 'See details';
            const invoiceLink = data?.invoiceLink || portalLink;
            return `\ud83d\udcc4 Your invoice for ${amount} is ready. View & pay: ${invoiceLink}`;
        }

        case 'payout_processed':
            return `\u2705 Your payment has been processed. Thank you for choosing Handy Services!`;

        case 'variation_request': {
            const description = data?.description || 'additional work';
            const amount = data?.amountPence ? formatCurrency(data.amountPence) : '';
            const approvalLink = data?.approvalLink ? `${baseUrl}${data.approvalLink}` : portalLink;
            return `\ud83d\udcdd ${contractorName} found additional work needed: ${description}${amount ? ' \u2014 ' + amount : ''}. Approve here: ${approvalLink}`;
        }

        case 'reschedule_confirmed': {
            const newDate = formatDate(data?.newDate);
            const newSlot = data?.newSlot ? formatSlot(data.newSlot) : '';
            return `\ud83d\udcc5 Your booking has been rescheduled to ${newDate}${newSlot ? ', ' + newSlot : ''}. We look forward to seeing you!`;
        }

        case 'cancellation_confirmed': {
            const refundInfo = data?.refundAmountPence != null
                ? ` A refund of ${formatCurrency(data.refundAmountPence)} will be processed within 5-7 business days.`
                : '';
            return `\u274c Your booking has been cancelled.${refundInfo} If you need anything else, we're here to help.`;
        }
    }
}

/**
 * Main dispatch function. Looks up the job/quote, resolves customer phone,
 * builds the templated message, and sends via WhatsApp.
 */
export async function notifyCustomer(params: NotifyCustomerParams): Promise<void> {
    try {
        const details = await resolveJobDetails(params);

        if (!details) {
            console.warn(`[CustomerNotify] Could not resolve job for event '${params.event}' (quoteId=${params.quoteId}, jobId=${params.jobId})`);
            return;
        }

        if (!details.customerPhone) {
            console.warn(`[CustomerNotify] No customer phone for event '${params.event}' (jobId=${details.job.id})`);
            return;
        }

        const message = buildMessage(params.event, details, params.data);

        console.log(`[CustomerNotify] Sending '${params.event}' to ${details.customerPhone}`);

        await sendWhatsAppMessage(details.customerPhone, message);

        console.log(`[CustomerNotify] '${params.event}' sent successfully to ${details.customerPhone}`);
    } catch (error) {
        console.error(`[CustomerNotify] Failed to send '${params.event}':`, error);
        throw error;
    }
}
