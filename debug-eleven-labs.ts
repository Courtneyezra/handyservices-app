import 'dotenv/config';
import { getTwilioSettings } from './server/settings';

async function main() {
    console.log("Fetching recent Eleven Labs conversations...");

    // Get settings directly or mock them if DB is needed (but DB is available)
    // We can just use process.env if available, or fetch from DB
    // To be safe, let's assume we need to fetch settings from DB or just check if env var is set

    const apiKey = process.env.ELEVEN_LABS_API_KEY; // Or check DB
    if (!apiKey) {
        console.error("ELEVEN_LABS_API_KEY is not set in env.");
        // Try to fetch from DB
        const settings = await getTwilioSettings();
        if (settings.elevenLabsApiKey) {
            console.log("Found API Key in DB settings.");
            await fetchConversations(settings.elevenLabsApiKey, settings.elevenLabsAgentId);
        } else {
            console.error("No API key found.");
        }
    } else {
        // We probably also need Agent ID? Get from settings
        const settings = await getTwilioSettings();
        await fetchConversations(apiKey, settings.elevenLabsAgentId);
    }

    process.exit(0);
}

async function fetchConversations(apiKey: string, agentId?: string) {
    // If agentId is provided, we can filter, but let's list all first to see structure
    const url = `https://api.elevenlabs.io/v1/convai/conversations?page_size=5`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'xi-api-key': apiKey
            }
        });

        if (!response.ok) {
            console.error(`Error: ${response.status} ${await response.text()}`);
            return;
        }

        const data = await response.json();
        console.log("Conversations found:", data.conversations.length);

        for (const conv of data.conversations) {
            console.log("---------------------------------------------------");
            console.log(`ID: ${conv.conversation_id}`);
            console.log(`Date: ${new Date(conv.start_time_unix_secs * 1000).toISOString()}`);
            console.log(`Status: ${conv.status}`);
            console.log(`Metadata:`, JSON.stringify(conv.metadata, null, 2));
            console.log(`Analysis:`, JSON.stringify(conv.analysis, null, 2));
        }

    } catch (e) {
        console.error("Fetch error:", e);
    }
}

main().catch(console.error);
