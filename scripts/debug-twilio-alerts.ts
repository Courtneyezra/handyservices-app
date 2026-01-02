import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

async function checkTwilioAlerts() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        console.error("Twilio credentials missing.");
        return;
    }

    const client = twilio(accountSid, authToken);

    console.log("Fetching last 5 Twilio Debugger Alerts...");
    try {
        const alerts = await client.monitor.v1.alerts.list({ limit: 5 });

        for (const alert of alerts) {
            console.log("\n--- Alert ---");
            console.log(`SID: ${alert.sid}`);
            console.log(`Alert Text: ${alert.alertText}`);
            console.log(`Resource SID: ${alert.resourceSid}`);
            console.log(`Error Code: ${alert.errorCode}`);
            console.log(`Date Created: ${alert.dateCreated}`);
            if (alert.requestUrl) console.log(`Request URL: ${alert.requestUrl}`);
            if (alert.responseBody) console.log(`Response Body Snapshot: ${alert.responseBody.substring(0, 200)}...`);
        }
    } catch (e) {
        console.error("Failed to fetch alerts:", e);
    }
}

checkTwilioAlerts().then(() => process.exit(0)).catch(console.error);
