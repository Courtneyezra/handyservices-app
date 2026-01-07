
import { Router } from 'express';
import { db } from '../db';
import { calls, leads } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { updateCall, findCallByTwilioSid } from '../call-logger';

// Interface for the ElevenLabs Webhook Payload
// Based on ElevenLabs Docs for "Conversation Analysis"
interface ElevenLabsWebhookPayload {
    type: 'conversation.analysis.completed';
    conversation_id: string;
    agent_id: string;
    call_id?: string; // Twilio Call Sid might be passed here if configured
    transcript: Array<{
        role: 'agent' | 'user';
        message: string;
        time_in_call_secs: number;
    }>;
    analysis: {
        summary?: string;
        success?: string; // "true" | "false"
        data_collection_results?: Record<string, {
            value: string | number | boolean;
            rationale?: string;
        }>;
    };
    recording_url?: string;
}

export const elevenLabsWebhookRouter = Router();

elevenLabsWebhookRouter.post('/webhooks/elevenlabs', async (req, res) => {
    console.log('[ElevenLabs-Webhook] Received webhook:', JSON.stringify(req.body, null, 2));

    try {
        const payload = req.body as ElevenLabsWebhookPayload;

        if (payload.type !== 'conversation.analysis.completed') {
            console.log(`[ElevenLabs-Webhook] Ignoring event type: ${payload.type}`);
            return res.status(200).send('Ignored');
        }

        const { conversation_id, analysis, transcript, recording_url } = payload;

        // Flatten transcript
        const fullTranscript = transcript.map(t => `${t.role.toUpperCase()}: ${t.message}`).join('\n');

        // Find the call
        // IMPORTANT: We need to link ElevenLabs Conversation ID to our Call Record.
        // If 'call_id' is passed (Twilio CallSid), we use that.
        // Otherwise, we might have stored conversation_id in a previous step (we need to check this).

        let callRecordId = null;

        if (payload.call_id) {
            callRecordId = await findCallByTwilioSid(payload.call_id);
        } else {
            console.warn('[ElevenLabs-Webhook] Payload missing call_id, cannot link to Call Record.');
        }

        if (!callRecordId) {
            console.error(`[ElevenLabs-Webhook] No matching call found for conversation ${conversation_id}`);
            return res.status(404).json({ error: "Call not found" });
        }

        console.log(`[ElevenLabs-Webhook] Updating Call ${callRecordId}`);

        // Extract Data Collection Results
        const collectedData = analysis.data_collection_results || {};

        // Map collected data to our schema
        // Assuming AI collects: valid_name, valid_address, urgency, etc.
        const customerName = collectedData['customer_name']?.value as string;
        const address = collectedData['address']?.value as string;
        const urgency = collectedData['urgency']?.value as string;
        const leadType = collectedData['lead_type']?.value as string; // homeowner, landlord etc

        // Update Call Record
        await updateCall(callRecordId, {
            transcription: fullTranscript,
            jobSummary: analysis.summary,
            recordingUrl: recording_url, // Update with high-quality AI recording if available
            customerName: customerName,
            address: address,
            urgency: urgency,
            leadType: leadType,
            outcome: 'ELEVEN_LABS_COMPLETED',
            // Store raw analysis for debugging
            liveAnalysisJson: analysis
        });

        // Update or Create Lead?
        // Logic: All calls create a "Shadow Lead" or update the existing one linked to the call.
        // For now, let's just ensure the Call table is rich. The 'leads' table sync logic usually happens elsewhere
        // or we can push it here if we want immediate visibility.

        // ... (Optional: leads table sync logic)

        res.status(200).send('OK');

    } catch (error) {
        console.error('[ElevenLabs-Webhook] Error processing webhook:', error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Helper for sql import since I used it above
import { sql } from "drizzle-orm";
