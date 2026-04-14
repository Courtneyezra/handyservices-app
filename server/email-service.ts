import { Resend } from 'resend';
import { getBaseUrlFromEnv } from './url-utils';

// Initialize Resend with API key (optional - will gracefully degrade if not set)
const getResend = () => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        return null;
    }
    return new Resend(apiKey);
};

// Email templates
interface BookingConfirmationData {
    customerName: string;
    customerEmail: string;
    jobDescription: string;
    scheduledDate?: string | null;
    depositPaid: number; // in pence
    totalJobPrice: number; // in pence
    balanceDue: number; // in pence
    invoiceNumber: string;
    jobId: string;
    quoteSlug?: string;
}

export async function sendBookingConfirmationEmail(data: BookingConfirmationData): Promise<{ success: boolean; error?: string }> {
    const resend = getResend();

    if (!resend) {
        console.log('[Email] Resend not configured - skipping email send');
        console.log('[Email] Would have sent booking confirmation to:', data.customerEmail);
        return { success: false, error: 'Email service not configured' };
    }

    if (!data.customerEmail) {
        console.log('[Email] No customer email provided - skipping');
        return { success: false, error: 'No email address provided' };
    }

    const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Booking Confirmation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #e8b323; margin: 0; font-size: 28px;">Booking Confirmed!</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px;">Thank you for your payment</p>
    </div>

    <!-- Main Content -->
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">

        <p style="font-size: 18px; margin-bottom: 20px;">Hi ${data.customerName},</p>

        <p>Great news! Your booking has been confirmed and we're getting everything ready for your job.</p>

        <!-- Job Details Card -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid #e8b323;">
            <h3 style="margin: 0 0 15px 0; color: #1a1a2e;">Job Details</h3>
            <p style="margin: 8px 0;"><strong>Reference:</strong> ${data.jobId}</p>
            <p style="margin: 8px 0;"><strong>Invoice:</strong> ${data.invoiceNumber}</p>
            <p style="margin: 8px 0;"><strong>Description:</strong> ${data.jobDescription || 'As discussed'}</p>
            ${data.scheduledDate ? `<p style="margin: 8px 0;"><strong>Scheduled:</strong> ${new Date(data.scheduledDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>` : ''}
        </div>

        <!-- Payment Summary -->
        <div style="background: #e8f5e9; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h3 style="margin: 0 0 15px 0; color: #2e7d32;">Payment Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; color: #666;">Total Job Price:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formatCurrency(data.totalJobPrice)}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666;">Deposit Paid:</td>
                    <td style="padding: 8px 0; text-align: right; color: #2e7d32; font-weight: bold;">-${formatCurrency(data.depositPaid)}</td>
                </tr>
                <tr style="border-top: 2px solid #c8e6c9;">
                    <td style="padding: 12px 0; font-weight: bold;">Balance Due on Completion:</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; font-size: 18px;">${formatCurrency(data.balanceDue)}</td>
                </tr>
            </table>
        </div>

        <!-- What's Next -->
        <div style="margin: 25px 0;">
            <h3 style="color: #1a1a2e;">What Happens Next?</h3>
            <ol style="padding-left: 20px; color: #555;">
                <li style="margin-bottom: 10px;"><strong>We're matching your job:</strong> We're reviewing your preferred dates and matching you with the best contractor in your area. You'll receive a WhatsApp within 24 hours confirming your date.</li>
                <li style="margin-bottom: 10px;"><strong>Day-before reminder:</strong> You'll receive a reminder the day before your scheduled date.</li>
                <li style="margin-bottom: 10px;"><strong>Job completed:</strong> Your contractor will complete the work and collect the balance.</li>
                <li style="margin-bottom: 10px;"><strong>Follow-up:</strong> We'll follow up to make sure you're 100% satisfied.</li>
            </ol>
        </div>

        <!-- Contact Info -->
        <div style="background: #fff3cd; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #856404;">Need to make changes?</h4>
            <p style="margin: 0; color: #856404;">
                Call us: <a href="tel:01onal" style="color: #0d6efd;">0800 XXX XXXX</a><br>
                Email: <a href="mailto:hello@handyservices.co.uk" style="color: #0d6efd;">hello@handyservices.co.uk</a>
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
</html>
    `;

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <bookings@handyservices.co.uk>',
            to: [data.customerEmail],
            subject: `Booking Confirmed - ${data.jobId}`,
            html: emailHtml,
        });

        if (error) {
            console.error('[Email] Failed to send booking confirmation:', error);
            return { success: false, error: error.message };
        }

        console.log(`[Email] Booking confirmation sent to ${data.customerEmail} (ID: ${result?.id})`);
        return { success: true };
    } catch (err: any) {
        console.error('[Email] Error sending email:', err);
        return { success: false, error: err.message };
    }
}

// Job assignment notification for contractors
interface JobAssignmentEmailData {
    contractorName: string;
    contractorEmail: string;
    customerName: string;
    address: string;
    jobDescription: string;
    scheduledDate: string;
    scheduledStartTime?: string;
    scheduledEndTime?: string;
    jobId: string;
}

export async function sendJobAssignmentEmail(data: JobAssignmentEmailData): Promise<{ success: boolean; error?: string }> {
    const resend = getResend();

    if (!resend) {
        console.log('[Email] Resend not configured - skipping job assignment email');
        console.log('[Email] Would have sent job assignment to:', data.contractorEmail);
        return { success: false, error: 'Email service not configured' };
    }

    if (!data.contractorEmail) {
        console.log('[Email] No contractor email provided - skipping');
        return { success: false, error: 'No email address provided' };
    }

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        } catch {
            return dateStr;
        }
    };

    const timeSlot = data.scheduledStartTime && data.scheduledEndTime
        ? `${data.scheduledStartTime} - ${data.scheduledEndTime}`
        : data.scheduledStartTime || 'To be confirmed';

    const baseUrl = getBaseUrlFromEnv();
    const acceptUrl = `${baseUrl}/contractor/jobs/${data.jobId}`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Job Assignment</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #e8b323; margin: 0; font-size: 28px;">New Job Assigned!</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px;">Action required</p>
    </div>

    <!-- Main Content -->
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">

        <p style="font-size: 18px; margin-bottom: 20px;">Hi ${data.contractorName},</p>

        <p>You've been assigned a new job. Please review the details below and accept or decline as soon as possible.</p>

        <!-- Job Details Card -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid #e8b323;">
            <h3 style="margin: 0 0 15px 0; color: #1a1a2e;">Job Details</h3>
            <p style="margin: 8px 0;"><strong>Reference:</strong> ${data.jobId}</p>
            <p style="margin: 8px 0;"><strong>Customer:</strong> ${data.customerName}</p>
            <p style="margin: 8px 0;"><strong>Address:</strong> ${data.address || 'To be confirmed'}</p>
            <p style="margin: 8px 0;"><strong>Description:</strong> ${data.jobDescription || 'As discussed'}</p>
        </div>

        <!-- Schedule Card -->
        <div style="background: #e3f2fd; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid #1976d2;">
            <h3 style="margin: 0 0 15px 0; color: #1976d2;">Schedule</h3>
            <p style="margin: 8px 0;"><strong>Date:</strong> ${formatDate(data.scheduledDate)}</p>
            <p style="margin: 8px 0;"><strong>Time:</strong> ${timeSlot}</p>
        </div>

        <!-- Action Buttons -->
        <div style="text-align: center; margin: 30px 0;">
            <a href="${acceptUrl}" style="display: inline-block; background: #e8b323; color: #1a1a2e; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">View Job & Respond</a>
        </div>

        <!-- Instructions -->
        <div style="background: #fff3cd; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #856404;">What to do next</h4>
            <ol style="padding-left: 20px; color: #856404; margin: 0;">
                <li style="margin-bottom: 8px;">Click the button above to view full job details</li>
                <li style="margin-bottom: 8px;">Accept or decline the job</li>
                <li style="margin-bottom: 8px;">If you accept, add to your calendar</li>
            </ol>
        </div>

        <!-- Contact Info -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #333;">Questions?</h4>
            <p style="margin: 0; color: #666;">
                Call us: <a href="tel:08001234567" style="color: #0d6efd;">0800 XXX XXXX</a><br>
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
</html>
    `;

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <dispatch@handyservices.co.uk>',
            to: [data.contractorEmail],
            subject: `New Job Assigned - ${formatDate(data.scheduledDate)}`,
            html: emailHtml,
        });

        if (error) {
            console.error('[Email] Failed to send job assignment email:', error);
            return { success: false, error: error.message };
        }

        console.log(`[Email] Job assignment email sent to ${data.contractorEmail} (ID: ${result?.id})`);
        return { success: true };
    } catch (err: any) {
        console.error('[Email] Error sending job assignment email:', err);
        return { success: false, error: err.message };
    }
}

// Internal notification for ops team
export async function sendInternalBookingNotification(data: BookingConfirmationData & { phone: string }): Promise<void> {
    const resend = getResend();

    if (!resend) {
        console.log('[Email] Internal notification skipped - Resend not configured');
        return;
    }

    const opsEmail = process.env.OPS_NOTIFICATION_EMAIL || 'ops@handyservices.co.uk';
    const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

    try {
        await resend.emails.send({
            from: 'Handy Services System <system@handyservices.co.uk>',
            to: [opsEmail],
            subject: `[DEPOSIT RECEIVED] ${data.customerName} - ${formatCurrency(data.depositPaid)} — Ready for dispatch`,
            html: `
                <h2>💰 New Deposit Received — Ready for Dispatch</h2>
                <div style="background:#fff3cd;padding:12px;border-radius:6px;margin:10px 0;">
                    <strong>⚡ Action needed:</strong> This job is in the dispatch pool. Pick a date and assign a contractor.
                </div>
                <p><strong>Customer:</strong> ${data.customerName}</p>
                <p><strong>Phone:</strong> ${data.phone}</p>
                <p><strong>Email:</strong> ${data.customerEmail || 'Not provided'}</p>
                <p><strong>Job:</strong> ${data.jobDescription}</p>
                <hr>
                <p><strong>Deposit Paid:</strong> ${formatCurrency(data.depositPaid)}</p>
                <p><strong>Total Job:</strong> ${formatCurrency(data.totalJobPrice)}</p>
                <p><strong>Balance Due:</strong> ${formatCurrency(data.balanceDue)}</p>
                <hr>
                <p><strong>Invoice:</strong> ${data.invoiceNumber}</p>
                <p><strong>Customer's preferred dates:</strong> Awaiting dispatch</p>
                <hr>
                <p><a href="${getBaseUrlFromEnv()}/admin/daily-planner" style="display:inline-block;background:#e8b323;color:#1a1a2e;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Open Daily Planner →</a></p>
            `,
        });

        console.log('[Email] Internal notification sent to ops team');
    } catch (err: any) {
        console.error('[Email] Failed to send internal notification:', err);
    }
}

// ==========================================
// INVOICE EMAIL NOTIFICATIONS
// ==========================================

interface InvoiceEmailData {
    customerName: string;
    customerEmail: string;
    invoiceNumber: string;
    totalAmount: number; // in pence
    depositPaid: number; // in pence
    balanceDue: number; // in pence
    dueDate: string | Date | null;
    paymentLink: string;
    invoiceId: string;
}

export async function sendInvoiceEmail(data: InvoiceEmailData): Promise<{ success: boolean; error?: string }> {
    const resend = getResend();

    if (!resend) {
        console.log('[Email] Resend not configured - skipping invoice email');
        console.log('[Email] Would have sent invoice to:', data.customerEmail);
        return { success: false, error: 'Email service not configured' };
    }

    if (!data.customerEmail) {
        console.log('[Email] No customer email provided - skipping invoice email');
        return { success: false, error: 'No email address provided' };
    }

    const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;
    const formatDate = (date: string | Date | null) => {
        if (!date) return '14 days from issue';
        return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${data.invoiceNumber}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #e8b323; margin: 0; font-size: 28px;">Invoice ${data.invoiceNumber}</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px;">Payment requested</p>
    </div>

    <!-- Main Content -->
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">

        <p style="font-size: 18px; margin-bottom: 20px;">Hi ${data.customerName || 'there'},</p>

        <p>Please find your invoice details below.</p>

        <!-- Payment Summary -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid #e8b323;">
            <h3 style="margin: 0 0 15px 0; color: #1a1a2e;">Payment Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; color: #666;">Total Amount:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formatCurrency(data.totalAmount)}</td>
                </tr>
                ${data.depositPaid > 0 ? `
                <tr>
                    <td style="padding: 8px 0; color: #666;">Deposit Paid:</td>
                    <td style="padding: 8px 0; text-align: right; color: #2e7d32; font-weight: bold;">-${formatCurrency(data.depositPaid)}</td>
                </tr>
                ` : ''}
                <tr style="border-top: 2px solid #e0e0e0;">
                    <td style="padding: 12px 0; font-weight: bold; font-size: 18px;">Balance Due:</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; font-size: 18px;">${formatCurrency(data.balanceDue)}</td>
                </tr>
            </table>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">Due by: ${formatDate(data.dueDate)}</p>
        </div>

        <!-- Pay Button -->
        <div style="text-align: center; margin: 30px 0;">
            <a href="${data.paymentLink}" style="display: inline-block; background: #e8b323; color: #1a1a2e; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">View Invoice & Pay Online</a>
        </div>

        <!-- Bank Transfer -->
        <div style="background: #f0f9ff; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">Prefer bank transfer?</h4>
            <p style="margin: 0; color: #475569; font-size: 14px;">
                Sort Code: XX-XX-XX | Account: XXXXXXXX<br>
                Reference: ${data.invoiceNumber}
            </p>
        </div>

        <!-- Contact Info -->
        <div style="background: #fff3cd; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #856404;">Questions about this invoice?</h4>
            <p style="margin: 0; color: #856404;">
                Call us: <a href="tel:08001234567" style="color: #0d6efd;">0800 XXX XXXX</a><br>
                Email: <a href="mailto:hello@handyservices.co.uk" style="color: #0d6efd;">hello@handyservices.co.uk</a>
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
</html>
    `;

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <invoices@handyservices.co.uk>',
            to: [data.customerEmail],
            subject: `Invoice ${data.invoiceNumber} — ${formatCurrency(data.balanceDue)} due`,
            html: emailHtml,
        });

        if (error) {
            console.error('[Email] Failed to send invoice email:', error);
            return { success: false, error: error.message };
        }

        console.log(`[Email] Invoice email sent to ${data.customerEmail} (ID: ${result?.id})`);
        return { success: true };
    } catch (err: any) {
        console.error('[Email] Error sending invoice email:', err);
        return { success: false, error: err.message };
    }
}

export async function sendInvoiceReminderEmail(
    data: InvoiceEmailData,
    reminderLevel: 'day_7' | 'day_14' | 'day_21',
): Promise<{ success: boolean; error?: string }> {
    const resend = getResend();

    if (!resend) {
        console.log('[Email] Resend not configured - skipping invoice reminder email');
        return { success: false, error: 'Email service not configured' };
    }

    if (!data.customerEmail) {
        console.log('[Email] No customer email provided - skipping invoice reminder');
        return { success: false, error: 'No email address provided' };
    }

    const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;
    const formatDate = (date: string | Date | null) => {
        if (!date) return 'recently';
        return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const levelConfig: Record<string, { subject: string; heading: string; headingColor: string; tone: string; urgency: string }> = {
        day_7: {
            subject: `Friendly reminder — Invoice ${data.invoiceNumber}`,
            heading: 'Payment Reminder',
            headingColor: '#e8b323',
            tone: `Just a friendly reminder that your invoice for <strong>${formatCurrency(data.balanceDue)}</strong> is still outstanding. Please settle at your convenience.`,
            urgency: '',
        },
        day_14: {
            subject: `Overdue: Invoice ${data.invoiceNumber}`,
            heading: 'Invoice Overdue',
            headingColor: '#f59e0b',
            tone: `Your invoice for <strong>${formatCurrency(data.balanceDue)}</strong> was due on ${formatDate(data.dueDate)} and is now overdue. Please pay at your earliest convenience.`,
            urgency: '<p style="color: #92400e; background: #fef3c7; padding: 12px; border-radius: 6px; font-size: 14px;">This invoice is now past its due date.</p>',
        },
        day_21: {
            subject: `Final notice — Invoice ${data.invoiceNumber}`,
            heading: 'Final Payment Notice',
            headingColor: '#ef4444',
            tone: `Your invoice for <strong>${formatCurrency(data.balanceDue)}</strong> is significantly overdue. Please settle this promptly to avoid any further action.`,
            urgency: '<p style="color: #991b1b; background: #fee2e2; padding: 12px; border-radius: 6px; font-size: 14px; font-weight: bold;">This is a final notice. Please pay immediately to avoid escalation.</p>',
        },
    };

    const config = levelConfig[reminderLevel];

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: ${config.headingColor}; margin: 0; font-size: 28px;">${config.heading}</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px;">${data.invoiceNumber}</p>
    </div>

    <!-- Main Content -->
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">

        <p style="font-size: 18px; margin-bottom: 20px;">Hi ${data.customerName || 'there'},</p>

        <p>${config.tone}</p>

        ${config.urgency}

        <!-- Payment Summary -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid ${config.headingColor};">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; color: #666;">Invoice:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: bold;">${data.invoiceNumber}</td>
                </tr>
                <tr style="border-top: 1px solid #e0e0e0;">
                    <td style="padding: 12px 0; font-weight: bold; font-size: 18px;">Amount Due:</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; font-size: 18px;">${formatCurrency(data.balanceDue)}</td>
                </tr>
            </table>
        </div>

        <!-- Pay Button -->
        <div style="text-align: center; margin: 30px 0;">
            <a href="${data.paymentLink}" style="display: inline-block; background: #e8b323; color: #1a1a2e; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Pay Now</a>
        </div>

        <p style="font-size: 14px; color: #666; text-align: center;">If you've already paid, please disregard this email.</p>

        <!-- Contact Info -->
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #333;">Need help?</h4>
            <p style="margin: 0; color: #666;">
                Call us: <a href="tel:08001234567" style="color: #0d6efd;">0800 XXX XXXX</a><br>
                Email: <a href="mailto:hello@handyservices.co.uk" style="color: #0d6efd;">hello@handyservices.co.uk</a>
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
</html>
    `;

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <invoices@handyservices.co.uk>',
            to: [data.customerEmail],
            subject: config.subject,
            html: emailHtml,
        });

        if (error) {
            console.error(`[Email] Failed to send invoice reminder (${reminderLevel}):`, error);
            return { success: false, error: error.message };
        }

        console.log(`[Email] Invoice reminder (${reminderLevel}) sent to ${data.customerEmail} (ID: ${result?.id})`);
        return { success: true };
    } catch (err: any) {
        console.error(`[Email] Error sending invoice reminder (${reminderLevel}):`, err);
        return { success: false, error: err.message };
    }
}

// WhatsApp booking confirmation (for customers without email)
interface WhatsAppConfirmationData {
    customerName: string;
    customerPhone: string;
    jobDescription: string;
    depositPaid: number; // in pence
    totalJobPrice: number; // in pence
    balanceDue: number; // in pence
    invoiceNumber: string;
    jobId: string;
    scheduledDate?: string | null;
}

export async function sendBookingConfirmationWhatsApp(data: WhatsAppConfirmationData): Promise<{ success: boolean; error?: string }> {
    try {
        // Import conversation engine to send WhatsApp
        const { conversationEngine } = await import('./conversation-engine');

        const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

        const message = `✅ *Booking Confirmed!*

Hi ${data.customerName}, your booking is confirmed.

📋 *Job:* ${data.jobDescription.substring(0, 100)}${data.jobDescription.length > 100 ? '...' : ''}

💳 *Payment Received:* ${formatCurrency(data.depositPaid)}
💰 *Total Job:* ${formatCurrency(data.totalJobPrice)}
📊 *Balance Due:* ${formatCurrency(data.balanceDue)}

🔖 *Reference:* ${data.invoiceNumber}
📅 *Scheduled:* ${data.scheduledDate || "We will confirm your date shortly"}

We're matching your job to the best contractor in your area. You'll receive a WhatsApp within 24 hours confirming your date and who's coming. Reply here if you have any questions!

- Handy Services Team`;

        await conversationEngine.sendMessage(data.customerPhone, message);

        console.log(`[WhatsApp] Booking confirmation sent to ${data.customerPhone}`);
        return { success: true };
    } catch (err: any) {
        console.error('[WhatsApp] Failed to send booking confirmation:', err);
        return { success: false, error: err.message };
    }
}
