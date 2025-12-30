import { Router } from 'express';
import twilio from 'twilio';
import { spawn } from 'child_process';

// Only use in dev mode ideally, but for this task we expose it
export const devRouter = Router();

devRouter.post('/dev/fix-connection', async (req, res) => {
    console.log('[DevTools] Attempting to fix connection...');
    const API_URL = 'http://127.0.0.1:4040/api/tunnels';

    try {
        // 1. Try to find existing tunnel
        let publicUrl = await getNgrokUrl(API_URL);

        // 2. If not found, try to start ngrok
        if (!publicUrl) {
            console.log('[DevTools] No tunnel found. Starting ngrok...');
            startNgrok();
            // Wait for startup
            await new Promise(r => setTimeout(r, 3000));
            publicUrl = await getNgrokUrl(API_URL);
        }

        if (!publicUrl) {
            throw new Error("Failed to find or start ngrok tunnel. Please start 'ngrok http 5001' manually.");
        }

        console.log(`[DevTools] Found public URL: ${publicUrl}`);

        // 3. Update Twilio
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            throw new Error("Missing Twilio credentials in .env");
        }

        const client = twilio(accountSid, authToken);

        // Find the first voice-capable number
        const numbers = await client.incomingPhoneNumbers.list({ limit: 1 });

        if (numbers.length === 0) {
            throw new Error("No incoming phone numbers found in this Twilio account.");
        }

        const targetNumber = numbers[0];
        const webhookUrl = `${publicUrl}/api/twilio/voice`;

        console.log(`[DevTools] Updating number ${targetNumber.phoneNumber} to ${webhookUrl}`);

        await client.incomingPhoneNumbers(targetNumber.sid).update({
            voiceUrl: webhookUrl,
            voiceMethod: 'POST'
        });

        res.json({
            success: true,
            message: `Updated ${targetNumber.phoneNumber} to use ${publicUrl}`,
            url: publicUrl
        });

    } catch (error: any) {
        console.error('[DevTools] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || "Unknown error"
        });
    }
});

export async function getNgrokUrl(apiUrl: string): Promise<string | null> {
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) return null;

        const data: any = await response.json();
        const tunnel = data.tunnels?.find((t: any) => t.proto === 'https');
        return tunnel ? tunnel.public_url : null;
    } catch (e) {
        return null;
    }
}

function startNgrok() {
    // Spawn ngrok in detached mode
    const ngrok = spawn('ngrok', ['http', '5001'], {
        detached: true,
        stdio: 'ignore'
    });
    ngrok.unref();
}
