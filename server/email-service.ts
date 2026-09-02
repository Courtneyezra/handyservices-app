import { newRunId } from './approver';
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

// ─────────────────────────────────────────────────────────────────────────
// BRANDED EMAIL SHELL — the official Handy Services brand (navy #1B2A4A /
// yellow #F5A623 / Poppins), translated to email-safe HTML: table layout +
// inline styles only, Poppins with a sans-serif fallback (most clients ignore
// web fonts), hosted logo. Every customer-facing email wraps its content in
// `brandedEmail()` so they all share one nav bar / yellow strip / footer.
// ─────────────────────────────────────────────────────────────────────────
export const BRAND = {
    navy: '#1B2A4A',
    yellow: '#F5A623',
    light: '#F7F8FC',
    dark: '#111827',
    muted: '#6B7280',
    border: '#D0D5E3',
    softYellow: '#FFF8EC',
    logo: 'https://www.handyservices.app/logo.png',
    phone: '07449 501 762',
    site: 'handyservices.app',
};
const FONT_STACK = `'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

/** Wrap body HTML in the branded nav-bar + yellow-strip + footer shell. */
export function brandedEmail(opts: { stripTitle: string; body: string; preheader?: string }): string {
    const { stripTitle, body, preheader = '' } = opts;
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Handy Services</title></head>
<body style="margin:0; padding:0; background:${BRAND.light}; font-family:${FONT_STACK}; color:${BRAND.dark};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.light}; padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 8px 30px rgba(17,24,39,0.08);">
      <tr><td style="background:${BRAND.navy}; padding:15px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="white-space:nowrap;">
            <img src="${BRAND.logo}" width="30" height="30" alt="" style="vertical-align:middle; border:0;">
            <span style="color:#ffffff; font-size:16px; font-weight:700; vertical-align:middle; padding-left:8px;">Handy Services</span>
          </td>
          <td valign="middle" align="right" style="white-space:nowrap;">
            <span style="color:${BRAND.yellow}; font-size:12px;">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
            <span style="color:#cbd5e1; font-size:12px;">&nbsp;4.9 &middot; 300+ reviews</span>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${BRAND.yellow}; padding:9px 24px; text-align:center;">
        <span style="color:${BRAND.navy}; font-size:12px; font-weight:700; letter-spacing:0.6px; text-transform:uppercase;">${stripTitle}</span>
      </td></tr>
      <tr><td style="padding:30px 26px; background:#ffffff;">${body}</td></tr>
      <tr><td style="background:${BRAND.navy}; padding:22px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle">
            <span style="color:#ffffff; font-size:14px; font-weight:700;">Handy Services</span>
            <div style="color:${BRAND.yellow}; font-size:11px; padding-top:5px;">Next-day slots &middot; Fast &amp; reliable &middot; Fully insured</div>
          </td>
          <td valign="middle" align="right" style="white-space:nowrap;">
            <div style="color:#ffffff; font-size:13px; font-weight:700;">${BRAND.phone}</div>
            <div style="color:#94a3b8; font-size:11px; padding-top:3px;">${BRAND.site}</div>
          </td>
        </tr></table>
      </td></tr>
    </table>
    <div style="color:${BRAND.muted}; font-size:11px; padding-top:14px;">&copy; Handy Services &middot; Nottingham</div>
  </td></tr></table>
</body></html>`;
}

/** Yellow CTA button (navy text), centred. */
export function emailButton(label: string, url: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 8px;"><tr>
      <td style="background:${BRAND.yellow}; border-radius:12px;">
        <a href="${url}" style="display:inline-block; padding:14px 36px; color:${BRAND.navy}; font-weight:700; font-size:16px; text-decoration:none;">${label}</a>
      </td></tr></table>`;
}

/** Soft-yellow highlight box with a thick yellow left border (brand "recommended" block). */
export function emailHighlightBox(innerHtml: string): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;"><tr>
      <td style="background:${BRAND.softYellow}; border:1px solid ${BRAND.yellow}; border-left:4px solid ${BRAND.yellow}; border-radius:10px; padding:16px 18px;">${innerHtml}</td>
    </tr></table>`;
}

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
            from: 'Handy Services <bookings@handyservices.app>',
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

// Visit moved — sent when the contractor reschedules a booked visit to a new day.
interface VisitRescheduledData {
    customerName: string;
    customerEmail: string;
    jobDescription: string;
    newDateLabel: string; // e.g. "Thursday 7 August, 9am–6pm"
    contractorName?: string;
}

export async function sendVisitRescheduledEmail(data: VisitRescheduledData): Promise<{ success: boolean; error?: string }> {
    const resend = getResend();
    if (!resend) {
        console.log('[Email] Resend not configured - would notify', data.customerEmail, 'of new date', data.newDateLabel);
        return { success: false, error: 'Email service not configured' };
    }
    if (!data.customerEmail) return { success: false, error: 'No email address provided' };

    const firstName = (data.customerName || '').trim().split(/\s+/)[0] || 'there';
    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Your visit has moved</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #e8b323; margin: 0; font-size: 26px;">Your visit has been rescheduled</h1>
    </div>
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p>Hi ${firstName},</p>
        <p>Just to let you know${data.contractorName ? ` — ${data.contractorName}` : ' — your handyman'} has moved your visit to a new day:</p>
        <div style="background: #e8f5e9; border: 1px solid #43a047; border-radius: 8px; padding: 18px; margin: 20px 0; text-align: center;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #2e7d32; font-weight: bold;">New date</div>
            <div style="font-size: 20px; font-weight: bold; color: #1b5e20; margin-top: 4px;">${data.newDateLabel}</div>
        </div>
        <p style="color:#555;"><strong>What we're doing:</strong> ${data.jobDescription}</p>
        <p>Nothing else changes — same price, same job. If the new day doesn't suit you, just reply to this email and we'll sort it.</p>
    </div>
    <div style="text-align: center; padding: 16px;"><p style="color: #999; margin: 0; font-size: 12px;">Handy Services · <a href="https://handyservices.co.uk" style="color: #b8860b;">handyservices.co.uk</a></p></div>
</body>
</html>`;

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <bookings@handyservices.app>',
            to: [data.customerEmail],
            subject: `Your visit has moved to ${data.newDateLabel}`,
            html: emailHtml,
        });
        if (error) { console.error('[Email] Failed to send reschedule notice:', error); return { success: false, error: error.message }; }
        console.log(`[Email] Reschedule notice sent to ${data.customerEmail} (ID: ${result?.id})`);
        return { success: true };
    } catch (err: any) {
        console.error('[Email] Error sending reschedule notice:', err);
        return { success: false, error: err.message };
    }
}

// Prize-wheel reward — sent when a customer claims their post-payment prize.
interface PrizeEmailData {
    customerName: string;
    customerEmail: string;
    prizeTitle: string;
    prizeMessage: string;
    prizeTerms?: string;
    code: string;
    expiresAt: Date;
    bookUrl: string;
}

export async function sendPrizeEmail(data: PrizeEmailData): Promise<{ success: boolean; error?: string }> {
    const resend = getResend();
    if (!resend) {
        console.log('[Email] Resend not configured - skipping prize email to', data.customerEmail);
        return { success: false, error: 'Email service not configured' };
    }
    if (!data.customerEmail) return { success: false, error: 'No email address provided' };

    const expires = data.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const body = `
      <div style="text-align:center;">
        <div style="font-size:44px; line-height:1;">🎁</div>
        <h1 style="color:${BRAND.navy}; margin:12px 0 4px; font-size:24px; font-weight:800;">You won a little something${data.customerName ? `, ${data.customerName}` : ''}</h1>
        <p style="color:${BRAND.muted}; font-size:14px; margin:0 0 6px;">A little thank-you for choosing Handy Services.</p>
      </div>
      ${emailHighlightBox(`
        <div style="text-align:center;">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#b45309; font-weight:700;">Your prize</div>
          <div style="font-size:22px; font-weight:800; color:${BRAND.navy}; margin:6px 0;">${data.prizeTitle}</div>
          ${data.prizeMessage ? `<div style="font-size:14px; color:${BRAND.muted};">${data.prizeMessage}</div>` : ''}
        </div>
      `)}
      <div style="text-align:center; margin:24px 0 4px;">
        <div style="font-size:12px; color:${BRAND.muted}; margin-bottom:8px;">Quote this code when you book</div>
        <div style="display:inline-block; font-family:'Courier New',monospace; font-size:22px; font-weight:800; letter-spacing:3px; color:${BRAND.navy}; background:${BRAND.light}; border:2px dashed ${BRAND.border}; border-radius:10px; padding:12px 22px;">${data.code}</div>
        <div style="font-size:13px; color:${BRAND.muted}; margin-top:10px;">Valid until <strong style="color:${BRAND.dark};">${expires}</strong></div>
      </div>
      ${emailButton('Book it now →', data.bookUrl)}
      ${data.prizeTerms ? `<p style="text-align:center; font-size:11px; color:${BRAND.muted}; margin-top:18px; line-height:1.5;">${data.prizeTerms}<br><a href="${process.env.BASE_URL || 'https://www.handyservices.app'}/rewards-terms" style="color:${BRAND.muted};">Terms &amp; conditions apply</a></p>` : ''}
    `;
    const emailHtml = brandedEmail({
        stripTitle: 'A little thank-you',
        preheader: `Your reward: ${data.prizeTitle} — code ${data.code}`,
        body,
    });

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <bookings@handyservices.app>',
            to: [data.customerEmail],
            subject: `🎁 Your Handy reward: ${data.prizeTitle}`,
            html: emailHtml,
        });
        if (error) { console.error('[Email] Failed to send prize email:', error); return { success: false, error: error.message }; }
        console.log(`[Email] Prize email sent to ${data.customerEmail} (ID: ${result?.id})`);
        return { success: true };
    } catch (err: any) {
        console.error('[Email] Error sending prize email:', err);
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
            from: 'Handy Services <dispatch@handyservices.app>',
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
export async function sendInternalBookingNotification(data: BookingConfirmationData & { phone: string; flexBookingWithinDays?: number | null }): Promise<void> {
    const resend = getResend();

    if (!resend) {
        console.log('[Email] Internal notification skipped - Resend not configured');
        return;
    }

    const opsEmail = process.env.OPS_NOTIFICATION_EMAIL || 'ops@handyservices.co.uk';
    const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

    try {
        await resend.emails.send({
            from: 'Handy Services System <system@handyservices.app>',
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
                <p><strong>Scheduling:</strong> ${data.flexBookingWithinDays && data.flexBookingWithinDays > 0
                    ? `🟢 Flexible — book within ${data.flexBookingWithinDays} days (route to a thin day)`
                    : (data.scheduledDate ? `📅 Customer picked ${data.scheduledDate}` : 'Awaiting dispatch')}</p>
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

    const body = `
      <h1 style="color:${BRAND.navy}; margin:0 0 4px; font-size:24px; font-weight:800;">Invoice ${data.invoiceNumber}</h1>
      <p style="color:${BRAND.muted}; font-size:14px; margin:0 0 18px;">Hi ${data.customerName || 'there'}, here's your invoice — thanks for choosing Handy Services.</p>
      ${emailHighlightBox(`
        <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#b45309; font-weight:700; margin-bottom:8px;">Payment summary</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          <tr><td style="padding:5px 0; color:${BRAND.muted};">Total amount</td><td style="padding:5px 0; text-align:right; color:${BRAND.dark}; font-weight:700;">${formatCurrency(data.totalAmount)}</td></tr>
          ${data.depositPaid > 0 ? `<tr><td style="padding:5px 0; color:${BRAND.muted};">Deposit paid</td><td style="padding:5px 0; text-align:right; color:#2e7d32; font-weight:700;">-${formatCurrency(data.depositPaid)}</td></tr>` : ''}
          <tr><td style="padding:12px 0 2px; border-top:1px solid ${BRAND.border}; font-weight:800; font-size:17px; color:${BRAND.navy};">Balance due</td><td style="padding:12px 0 2px; border-top:1px solid ${BRAND.border}; text-align:right; font-weight:800; font-size:17px; color:${BRAND.navy};">${formatCurrency(data.balanceDue)}</td></tr>
        </table>
        <div style="color:${BRAND.muted}; font-size:13px; margin-top:8px;">Due by ${formatDate(data.dueDate)}</div>
      `)}
      ${emailButton('View invoice & pay online →', data.paymentLink)}
      <p style="text-align:center; color:${BRAND.muted}; font-size:13px; margin-top:14px;">Questions about this invoice? Call us on <a href="tel:+447449501762" style="color:${BRAND.navy}; font-weight:700; text-decoration:none;">${BRAND.phone}</a></p>
    `;
    const emailHtml = brandedEmail({
        stripTitle: `Invoice ${data.invoiceNumber}`,
        preheader: `Invoice ${data.invoiceNumber} — balance ${formatCurrency(data.balanceDue)} due ${formatDate(data.dueDate)}`,
        body,
    });

    try {
        const { data: result, error } = await resend.emails.send({
            from: 'Handy Services <invoices@handyservices.app>',
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
            from: 'Handy Services <invoices@handyservices.app>',
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

        await conversationEngine.sendMessage(data.customerPhone, message, {
            approver: 'system.notification',
            runId: newRunId('sys'),
        });

        console.log(`[WhatsApp] Booking confirmation sent to ${data.customerPhone}`);
        return { success: true };
    } catch (err: any) {
        console.error('[WhatsApp] Failed to send booking confirmation:', err);
        return { success: false, error: err.message };
    }
}
