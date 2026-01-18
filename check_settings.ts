
import { getTwilioSettings } from "./server/settings";

async function main() {
    console.log("Checking settings...");
    const settings = await getTwilioSettings();
    console.log("Eleven Labs API Key present:", !!settings.elevenLabsApiKey);
    if (settings.elevenLabsApiKey) {
        console.log("Eleven Labs API Key length:", settings.elevenLabsApiKey.length);
    } else {
        console.log("WARNING: Eleven Labs API key is MISSING.");
    }
    process.exit(0);
}

main().catch(console.error);
