
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { desc } from "drizzle-orm";
import { twilioClient } from "../server/twilio-client";
import fs from "fs";
import path from "path";
import "dotenv/config";

// Mock environment variables availability check
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error("Twilio credentials missing in environment");
    process.exit(1);
}

async function checkUrl(url: string, headers: Record<string, string> = {}): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { method: 'HEAD', headers, signal: controller.signal });
        clearTimeout(timeout);
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function run() {
    console.log("Fetching last 10 calls...");
    const recentCalls = await db.select()
        .from(calls)
        .orderBy(desc(calls.startTime))
        .limit(10);

    console.log(`Found ${recentCalls.length} calls. Checking status...\n`);
    console.log("--------------------------------------------------------------------------------");
    console.log("| Date                 | Caller         | Source          | Primary | Backup (Twilio) |");
    console.log("--------------------------------------------------------------------------------");

    for (const call of recentCalls) {
        const dateStr = call.startTime ? new Date(call.startTime).toISOString().slice(0, 16).replace('T', ' ') : 'N/A';
        const caller = call.phoneNumber || "?";

        // Determine Expected Source
        let source = "Unknown";
        let hasPrimary = false;
        let hasBackup = false;

        // Check Primary
        if (call.recordingUrl) {
            if (call.recordingUrl.includes('elevenlabs')) {
                source = "ElevenLabs";
                hasPrimary = await checkUrl(call.recordingUrl, { "xi-api-key": process.env.ELEVEN_LABS_API_KEY || "" });
            } else if (call.recordingUrl.startsWith('http')) {
                source = "S3/Cloud";
                hasPrimary = await checkUrl(call.recordingUrl);
            } else {
                source = "Local";
                const localPath = path.resolve(process.cwd(), call.recordingUrl);
                hasPrimary = fs.existsSync(localPath);
            }
        } else {
            source = "None Set";
        }

        // Check Backup (Twilio)
        try {
            if (call.callId && call.callId.startsWith('CA')) {
                const recordings = await twilioClient.recordings.list({ callSid: call.callId, limit: 1 });
                hasBackup = recordings.length > 0;
            }
        } catch (e) {
            // console.error(`Twilio check failed: ${e}`);
        }

        const primaryStatus = hasPrimary ? "✅ OK" : (call.recordingUrl ? "❌ Broken" : "⚪ Empty");
        const backupStatus = hasBackup ? "✅ Available" : "❌ Missing";

        console.log(`| ${dateStr.padEnd(20)} | ${caller.padEnd(14)} | ${source.padEnd(15)} | ${primaryStatus.padEnd(7)} | ${backupStatus.padEnd(15)} |`);
    }
    console.log("--------------------------------------------------------------------------------");
    process.exit(0);
}

run().catch(console.error);
