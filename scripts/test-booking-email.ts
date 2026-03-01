import 'dotenv/config';
import { Resend } from 'resend';

async function main() {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const formatCurrency = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  const depositPaid = 5000;
  const totalJobPrice = 15000;
  const balanceDue = 10000;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Booking Confirmation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #7DB00E 0%, #5a8a0a 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">✓ Booking Confirmed!</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Thank you for your booking, Test Customer</p>
    </div>

    <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #333; font-size: 18px; margin: 0 0 15px; border-bottom: 2px solid #7DB00E; padding-bottom: 10px;">Payment Summary</h2>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #666;">Deposit Paid</td><td style="padding: 8px 0; text-align: right; font-weight: bold; color: #7DB00E;">${formatCurrency(depositPaid)}</td></tr>
                <tr><td style="padding: 8px 0; color: #666;">Total Job Cost</td><td style="padding: 8px 0; text-align: right;">${formatCurrency(totalJobPrice)}</td></tr>
                <tr style="border-top: 1px solid #eee;"><td style="padding: 12px 0; font-weight: bold;">Balance Due on Completion</td><td style="padding: 12px 0; text-align: right; font-weight: bold; font-size: 18px;">${formatCurrency(balanceDue)}</td></tr>
            </table>
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #333; font-size: 18px; margin: 0 0 15px;">Job Details</h2>
            <p style="margin: 0; color: #666;"><strong>Job:</strong> Test booking - Bathroom tap repair</p>
            <p style="margin: 10px 0 0; color: #666;"><strong>Date:</strong> ${tomorrow.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <p style="margin: 10px 0 0; color: #666;"><strong>Reference:</strong> INV-2025-TEST</p>
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px;">
            <h2 style="color: #333; font-size: 18px; margin: 0 0 15px;">What Happens Next?</h2>
            <p style="margin: 0 0 10px;">1. ✓ We will confirm your appointment within 24 hours</p>
            <p style="margin: 0 0 10px;">2. ✓ You will receive a reminder the day before</p>
            <p style="margin: 0;">3. ✓ Our contractor completes the work</p>
        </div>
    </div>

    <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
        <p>Questions? Call us on <strong>0800 123 4567</strong></p>
    </div>
</body>
</html>
`;

  console.log('Sending test booking confirmation email...');

  const { data, error } = await resend.emails.send({
    from: 'Handy Services <onboarding@resend.dev>',
    to: 'ezramarketingltd@gmail.com',
    subject: '✓ Booking Confirmed - Test booking - Bathroom tap repair',
    html: emailHtml,
  });

  if (error) {
    console.error('❌ Error sending email:', error);
    return;
  }

  console.log('✅ Email sent successfully!');
  console.log('Email ID:', data?.id);
}

main().catch(console.error);
