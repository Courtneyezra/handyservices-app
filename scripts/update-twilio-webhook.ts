import 'dotenv/config';
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
    console.error('Missing Twilio credentials in .env');
    process.exit(1);
}

const client = twilio(accountSid, authToken);

const newUrl = process.argv[2];

if (!newUrl) {
    console.error('Usage: tsx scripts/update-twilio-webhook.ts <NEW_WEBHOOK_URL>');
    console.log('Example: tsx scripts/update-twilio-webhook.ts https://my-app.railway.app/api/twilio/voice');
    process.exit(1);
}

async function updateWebhooks() {
    console.log(`Updating Twilio Voice Webhooks to: ${newUrl}\n`);
    try {
        const numbers = await client.incomingPhoneNumbers.list();

        if (numbers.length === 0) {
            console.log('No phone numbers found.');
            return;
        }

        for (const number of numbers) {
            console.log(`Updating ${number.phoneNumber}...`);
            await client.incomingPhoneNumbers(number.sid).update({
                voiceUrl: newUrl,
                voiceMethod: 'POST' // Ensure POST is used
            });
            console.log(`✅ Updated ${number.phoneNumber}`);
        }
        console.log('\nAll numbers updated successfully.');
    } catch (err: any) {
        console.error('Failed to update numbers:', err.message);
    }
}

updateWebhooks();
