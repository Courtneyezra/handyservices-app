import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

async function checkLatestCalls() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.error("Twilio credentials missing.");
        return;
    }

    const client = twilio(accountSid, authToken);

    console.log("Fetching last 5 calls...");
    const calls = await client.calls.list({ limit: 5 });

    for (const call of calls) {
        console.log(`\nSID: ${call.sid}`);
        console.log(`From: ${call.from}`);
        console.log(`To: ${call.to}`);
        console.log(`Status: ${call.status}`);
        console.log(`Direction: ${call.direction}`);
        console.log(`Duration: ${call.duration}s`);
        console.log(`Date Created: ${call.dateCreated}`);
        if (call.direction === 'outbound-api') {
            console.log(`Answered By: ${call.answeredBy || 'N/A'}`);
        }
    }
}

checkLatestCalls().then(() => process.exit(0)).catch(console.error);
