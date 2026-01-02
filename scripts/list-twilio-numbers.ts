import 'dotenv/config';
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
    console.error('Missing Twilio credentials in .env');
    process.exit(1);
}

const client = twilio(accountSid, authToken);

async function listNumbers() {
    console.log('Fetching incoming phone numbers from Twilio...\n');
    try {
        const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });

        if (numbers.length === 0) {
            console.log('No phone numbers found in this account.');
            return;
        }

        console.log('Phone Number | Voice Webhook URL');
        console.log('-------------------------------------------------------');
        numbers.forEach(number => {
            console.log(`${number.phoneNumber} | ${number.voiceUrl}`);
        });
    } catch (err: any) {
        console.error('Failed to fetch numbers:', err.message);
    }
}

listNumbers();
