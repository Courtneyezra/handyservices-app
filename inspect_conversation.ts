
import { getTwilioSettings } from "./server/settings";

async function main() {
    console.log("Fetching conversation details...");
    const settings = await getTwilioSettings();
    const apiKey = settings.elevenLabsApiKey;
    const convId = "conv_6301kf0nkj3te99vakzhf1abmemz";

    if (!apiKey) {
        console.error("No API key found!");
        return;
    }

    try {
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${convId}`, {
            headers: { 'xi-api-key': apiKey }
        });

        if (res.ok) {
            const data = await res.json();
            console.log("Conversation details:", JSON.stringify(data, null, 2));
        } else {
            console.error("Failed:", res.status, res.statusText);
            const text = await res.text();
            console.error(text);
        }
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

main().catch(console.error);
