
import 'dotenv/config';
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { db } from "./db";
import { productizedServices, skuMatchLogs } from "../shared/schema";
import { desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { detectSku, detectMultipleTasks, loadAndCacheSkus } from "./skuDetector";
import { setupTwilioSocket } from "./twilio-realtime";
import { determineCallRouting, CallRoutingSettings, AgentMode, FallbackAction } from "./call-routing-engine";
import { quotesRouter } from "./quotes";
import { leadsRouter } from "./leads";
import { testRouter } from "./test-routes";
import { dashboardRouter } from "./dashboard";
import { whatsappRouter } from "./whatsapp-api";
import { metaWhatsAppRouter, attachMetaWebSocket } from "./meta-whatsapp";
import { trainingRouter } from './training-routes';
import handymenRouter from './handymen';
import callsRouter from './calls';
import { generateWhatsAppMessage } from './openai';
import { searchAddresses, validatePostcode } from './google-places'; // B8: Address lookup
import { devRouter } from './dev-tools';
import { settingsRouter, getTwilioSettings } from './settings';
import contractorAuthRouter from './contractor-auth';
import contractorAvailabilityRouter from './availability-routes';
import contractorJobsRouter from './job-routes';
import placesRouter from './places-routes';
import { stripeRouter } from './stripe-routes';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' })); // Increased limit for large transcriptions
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from attached_assets directory if needed
// app.use('/attached_assets', express.static('attached_assets'));

// Serve WhatsApp Media
const MEDIA_DIR = path.join(__dirname, 'storage/media');
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
app.use('/api/media', express.static(MEDIA_DIR));


// Logging Middleware
app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
            let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
            if (capturedJsonResponse) {
                logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 50)}...`;
            }
            console.log(logLine);
        }
    });

    next();
});

// Health Check Endpoint (for Railway and keep-alive pings)
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Diagnostics Endpoint (Inlined for reliability)
import { getActiveCallCount } from './twilio-realtime';
import { sql } from 'drizzle-orm';
import { getNgrokUrl } from './dev-tools';

app.get('/api/diagnostics', async (req, res) => {
    console.log('[Diagnostics] Endpoint hit');
    const checks = {
        timestamp: new Date().toISOString(),
        env: {
            deepgram_key_set: !!process.env.DEEPGRAM_API_KEY,
            openai_key_set: !!process.env.OPENAI_API_KEY,
            twilio_account_sid_set: !!process.env.TWILIO_ACCOUNT_SID,
            twilio_auth_token_set: !!process.env.TWILIO_AUTH_TOKEN,
            node_env: process.env.NODE_ENV
        },
        infrastructure: {
            database: false,
            host: req.headers.host,
            protocol: req.headers['x-forwarded-proto'] || req.protocol,
            server_uptime: process.uptime(),
            active_tunnel: await getNgrokUrl('http://127.0.0.1:4040/api/tunnels')
        },
        voice_server: {
            active_calls: getActiveCallCount(),
        }
    };

    try {
        await db.execute(sql`SELECT 1`);
        checks.infrastructure.database = true;
    } catch (e) {
        console.error("Diagnostics: DB Check Failed", e);
        checks.infrastructure.database = false;
    }

    res.json(checks);
});

// Register Quotes Router (Migrated from V5)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use(quotesRouter);
app.use(leadsRouter);
app.use('/api/places', placesRouter); // API: Places Search
app.use('/api', testRouter);
app.use('/api/whatsapp', whatsappRouter); // Legacy Twilio Webhooks
app.use('/api/whatsapp', metaWhatsAppRouter); // Meta Cloud API Webhooks
app.use('/api/dashboard', dashboardRouter);
app.use('/api/handymen', handymenRouter);
app.use('/api/calls', callsRouter);
app.use('/api/calls', callsRouter);
app.use(trainingRouter);
app.use('/api', devRouter);
app.use('/api/settings', settingsRouter);
app.use(stripeRouter); // Stripe payment routes

// Contractor Portal Routes
app.use('/api/contractor', contractorAuthRouter);
app.use('/api/contractor/availability', contractorAvailabilityRouter);
app.use('/api/contractor/jobs', contractorJobsRouter);
// app.use('/api/places', placesRouter); // API: Places Search (Moved to register before catch-all)

// Serve static assets (for hold music)
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));




// Audio Upload Endpoint (Deepgram)
// import { deepgram } from "./deepgram";

app.post('/api/deepgram/upload', async (req, res) => {
    try {
        if (!req.headers['content-type']?.includes('audio')) {
            return res.status(400).json({ error: "Invalid content type" });
        }

        // Stream the audio directly to Deepgram? 
        // For simplicity in this demo, accessing raw body might require body-parser config or similar.
        // Assuming express.raw or similar is needed if we want the buffer.
        // But here we might just rely on a simple buffer collection for now if small.

        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', async () => {
            const buffer = Buffer.concat(chunks);
            // Process with Deepgram (omitted actual call for brevity unless needed)
            // Mock response for now or actual call if deepgram module is ready
            try {
                // const transcription = await deepgram.transcription.preRecorded({ buffer, mimetype: req.headers['content-type'] });
                // res.json({ transcription });
                res.json({ transcription: "Audio processing placeholder" });
            } catch (err) {
                console.error("Deepgram error:", err);
                res.status(500).json({ error: "Failed to process audio" });
            }
        });

        req.on('error', (err) => {
            console.error("Upload stream error:", err);
            res.status(500).json({ error: "Upload failed" });
        });

    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// SKU Detection Endpoint
app.post('/api/sku/detect', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    const result = await detectSku(text);
    res.json(result);
});

// Multi-Task Detection
app.post('/api/intake/sku-detect-multi', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    try {
        const result = await detectMultipleTasks(text);
        res.json(result);
    } catch (e) {
        console.error("Multi-task detect error:", e);
        res.status(500).json({ error: "Detection failed" });
    }
});

// AI-Generated WhatsApp Message
app.post('/api/whatsapp/ai-message', async (req, res) => {
    const { transcription, customerName, tone, detection } = req.body;
    try {
        const message = await generateWhatsAppMessage(transcription, customerName, tone || 'casual', detection);
        res.json({ message });
    } catch (e) {
        console.error("AI message error:", e);
        res.status(500).json({ error: "Failed to generate message" });
    }
});

// B8: Address Lookup by Postcode
app.post('/api/addresses/lookup', async (req, res) => {
    const { postcode } = req.body;

    if (!postcode) {
        return res.status(400).json({ error: "Postcode is required" });
    }

    try {
        // Validate postcode first (free API call)
        const validation = await validatePostcode(postcode);

        if (!validation.valid) {
            return res.json({
                addresses: [],
                cached: false,
                error: "Invalid postcode"
            });
        }

        // Get addresses from Google Places (with caching)
        const addresses = await searchAddresses(postcode);

        res.json({
            addresses,
            cached: addresses.length > 0, // If we got results, they might be cached
            postcode: validation.postcode // Return normalized postcode
        });
    } catch (e) {
        console.error("Address lookup error:", e);
        res.status(500).json({ error: "Failed to lookup addresses" });
    }
});

// SKU / Services Management API
// ------------------------------------------------------------------

// 1. List all SKUs
app.get('/api/skus', async (req, res) => {
    try {
        const skus = await db.select().from(productizedServices).orderBy(desc(productizedServices.skuCode));
        res.json(skus);
    } catch (error) {
        console.error("Failed to fetch SKUs:", error);
        res.status(500).json({ error: "Failed to fetch SKUs" });
    }
});

// 2. Create SKU
app.post('/api/skus', async (req, res) => {
    try {
        const newSku = {
            id: uuidv4(),
            ...req.body,
            // Ensure strict defaults if missing
            isActive: req.body.isActive ?? true,
            keywords: req.body.keywords || [],
        };

        await db.insert(productizedServices).values(newSku);
        res.json(newSku);
    } catch (error) {
        console.error("Failed to create SKU:", error);
        res.status(500).json({ error: "Failed to create SKU" });
    }
});

// 3. Update SKU
app.put('/api/skus/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Remove ID from updates to avoid PK conflict if passed
        delete updates.id;

        await db.update(productizedServices)
            .set(updates)
            .where(eq(productizedServices.id, id));

        res.json({ success: true, id });
    } catch (error) {
        console.error("Failed to update SKU:", error);
        res.status(500).json({ error: "Failed to update SKU" });
    }
});

// 4. Delete SKU
app.delete('/api/skus/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.delete(productizedServices).where(eq(productizedServices.id, id));
        res.json({ success: true });
    } catch (error) {
        console.error("Failed to delete SKU:", error);
        res.status(500).json({ error: "Failed to delete SKU" });
    }
});

// Mock Endpoints
app.post('/api/intake/pre-analyze', (req, res) => {
    res.json({ visualReason: "To assess access", needsVisual: true });
});

app.post('/api/intake/decision', (req, res) => {
    res.json({
        intakeId: `intake_${Date.now()}`,
        recommendation: 'VIDEO_QUOTE',
        rationale: "We need to see the job to give an accurate price.",
        confidence: 80,
        primaryAction: {
            label: "Get Video Quote",
            description: "Send a quick video for a fixed price",
            route: "/video-quote"
        },
        alternatives: [],
        freeVideoOption: {
            label: "Quick Video",
            description: "Free assessment",
            visualReason: "Complex job",
            route: "/video-instant"
        }
    });
});

// Twilio Voice Webhook - Dynamic settings-based call routing
app.post('/api/twilio/voice', async (req, res) => {
    console.log(`[Twilio] Incoming call from ${req.body.From}`);
    const host = req.headers.host;
    const wsProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const httpProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const streamUrl = `${wsProtocol}://${host}/api/twilio/realtime`;
    const leadNumber = req.body.From;

    // Log call to database - TODO: implement this function
    // try {
    //     await logCallToDatabase({
    //         twilioCallSid: req.body.CallSid,
    //         phoneNumber: req.body.From,
    //         direction: "inbound",
    //         status: "ringing",
    //         customerName: "Unknown Caller",
    //     });
    // } catch (e) {
    //     console.error(`[Twilio] Failed to log initial call ${req.body.CallSid}:`, e);
    // }

    // Get dynamic settings
    const settings = await getTwilioSettings();

    // Build routing settings for the engine
    const routingSettings: CallRoutingSettings = {
        agentMode: (settings.agentMode || 'auto') as AgentMode,
        forwardEnabled: settings.forwardEnabled,
        forwardNumber: settings.forwardNumber,
        fallbackAction: (settings.fallbackAction || 'voicemail') as FallbackAction,
        businessHoursStart: settings.businessHoursStart,
        businessHoursEnd: settings.businessHoursEnd,
        businessDays: settings.businessDays,
        elevenLabsAgentId: settings.elevenLabsAgentId,
        elevenLabsApiKey: settings.elevenLabsApiKey,
    };

    // Determine call routing
    const routing = determineCallRouting(routingSettings);
    console.log(`[Twilio] Routing decision: ${routing.reason} (mode: ${routing.effectiveMode}, destination: ${routing.destination})`);

    const welcomeMessage = (settings.welcomeMessage as string).replace('{business_name}', settings.businessName as string);
    const holdMusicUrl = `${httpProtocol}://${host}/api/twilio/hold-music`;

    // Start TwiML response
    let twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>`;

    // If going to Eleven Labs, skip Deepgram stream
    if (routing.destination !== 'eleven-labs') {
        twiml += `
      <Start>
        <Stream url="${streamUrl}">
            <Parameter name="phoneNumber" value="${req.body.From}" />
        </Stream>
      </Start>`;
    }

    // Add welcome audio/message based on routing
    if (routing.playWelcomeAudio) {
        if (settings.welcomeAudioUrl) {
            const audioUrl = (settings.welcomeAudioUrl as string).startsWith('http')
                ? settings.welcomeAudioUrl
                : `${httpProtocol}://${host}${settings.welcomeAudioUrl}`;
            twiml += `
      <Play>${audioUrl}</Play>`;
        } else {
            twiml += `
      <Say voice="${settings.voice}">${welcomeMessage}</Say>`;
        }
    }

    // Handle routing destination
    if (routing.destination === 'va-forward') {
        // Forward to VA with hold music
        const holdMusicUrl = settings.holdMusicUrl || `${httpProtocol}://${host}/assets/hold-music.mp3`;
        twiml += `
      <Dial timeout="${settings.maxWaitSeconds || 30}" action="${httpProtocol}://${host}/api/twilio/dial-status" method="POST" answerOnBridge="false" ringTone="gb" callerId="${req.body.To || req.body.Called}">
        <Number url="${holdMusicUrl}">${settings.forwardNumber}</Number>
      </Dial>`;
    } else if (routing.destination === 'eleven-labs') {
        // Redirect to Eleven Labs (with context)
        const elevenLabsUrl = `${httpProtocol}://${host}/api/twilio/eleven-labs-personal?agentId=${settings.elevenLabsAgentId}&leadPhoneNumber=${encodeURIComponent(leadNumber)}&context=${routing.elevenLabsContext}`;
        twiml += `
      <Redirect>${elevenLabsUrl}</Redirect>`;
    } else if (routing.destination === 'voicemail') {
        // Go to voicemail
        twiml += `
      <Redirect>${httpProtocol}://${host}/api/twilio/voicemail</Redirect>`;
    } else if (routing.destination === 'hangup') {
        // Just hangup
        twiml += `
      <Hangup/>`;
    } else {
        // Fallback: transcription mode
        twiml += `
      <Pause length="30" />
      <Say voice="${settings.voice}">I'm still listening. Go ahead whenever you're ready.</Say>
      <Pause length="30" />
      <Say voice="${settings.voice}">Thank you for the details. We are analyzing your request and will be with you shortly.</Say>
      <Pause length="10" />`;
    }

    twiml += `
    </Response>`;

    res.type('text/xml');
    res.send(twiml);
});

// Eleven Labs Personal Endpoint - Returns TwiML to connect to our WebSocket stream
app.all('/api/twilio/eleven-labs-personal', async (req, res) => {
    const agentId = req.query.agentId || req.body.agentId;
    const context = req.query.context || req.body.context || 'in-hours';
    const leadNumber = req.query.leadPhoneNumber || req.body.From;
    const callSid = req.body.CallSid || '';

    console.log(`[ElevenLabs-Personal] Redirecting to stream: Agent=${agentId}, Context=${context}, Lead=${leadNumber}`);

    const settings = await getTwilioSettings();
    const host = req.headers.host;
    const wsProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';

    if (!settings.elevenLabsApiKey || !agentId) {
        console.error('[ElevenLabs-Personal] Missing API key or Agent ID');
        return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, voice agent is not configured.</Say><Hangup/></Response>');
    }

    try {
        // Return TwiML with Connect to our WebSocket stream
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsProtocol}://${host}/api/twilio/eleven-labs-stream?agentId=${agentId}&amp;context=${context}&amp;leadPhoneNumber=${encodeURIComponent(leadNumber)}&amp;callSid=${callSid}">
      <Parameter name="agentId" value="${agentId}" />
      <Parameter name="context" value="${context}" />
      <Parameter name="leadPhoneNumber" value="${leadNumber}" />
    </Stream>
  </Connect>
</Response>`;

        console.log(`[ElevenLabs-Personal] Returning Stream TwiML for ${callSid}`);
        return res.type('text/xml').send(twiml);

    } catch (error) {
        console.error('[ElevenLabs-Personal] Error:', error);
        return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say><Hangup/></Response>');
    }
});

// Twilio Dial Status Callback - Handles missed call fallback routing
app.post('/api/twilio/dial-status', async (req, res) => {
    const { DialCallStatus, From, CallSid } = req.body;
    console.log(`[Twilio] Dial status for ${CallSid}: ${DialCallStatus}`);

    const settings = await getTwilioSettings();
    const host = req.headers.host;
    const httpProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';

    // If call was not answered, trigger fallback
    if (DialCallStatus !== 'completed' && DialCallStatus !== 'answered') {
        console.log(`[Twilio] Call not answered, determining fallback...`);

        // Build routing settings for the engine
        const routingSettings: CallRoutingSettings = {
            agentMode: (settings.agentMode || 'auto') as AgentMode,
            forwardEnabled: settings.forwardEnabled,
            forwardNumber: settings.forwardNumber,
            fallbackAction: (settings.fallbackAction || 'voicemail') as FallbackAction,
            businessHoursStart: settings.businessHoursStart,
            businessHoursEnd: settings.businessHoursEnd,
            businessDays: settings.businessDays,
            elevenLabsAgentId: settings.elevenLabsAgentId,
            elevenLabsApiKey: settings.elevenLabsApiKey,
        };

        // Determine fallback routing (VA missed call scenario)
        const routing = determineCallRouting(routingSettings, true); // isVAMissedCall = true
        console.log(`[Twilio] Fallback routing: ${routing.reason} (destination: ${routing.destination})`);

        // Handle Eleven Labs fallback - return Stream TwiML directly
        if (routing.destination === 'eleven-labs') {
            console.log(`[Twilio] Connecting to Eleven Labs with context: ${routing.elevenLabsContext}`);

            // Get WebSocket protocol
            const wsProtocol = httpProtocol === 'https' ? 'wss' : 'ws';

            // Return TwiML with Connect to our WebSocket stream (directly, no redirect)
            // Note: We add a custom header to signal that Deepgram should be skipped
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Connect>
                <Stream url="${wsProtocol}://${host}/api/twilio/eleven-labs-stream?agentId=${settings.elevenLabsAgentId}&amp;context=${routing.elevenLabsContext}&amp;leadPhoneNumber=${encodeURIComponent(From)}&amp;callSid=${CallSid}">
                  <Parameter name="agentId" value="${settings.elevenLabsAgentId}" />
                  <Parameter name="context" value="${routing.elevenLabsContext}" />
                  <Parameter name="leadPhoneNumber" value="${From}" />
                  <Parameter name="skipDeepgram" value="true" />
                </Stream>
              </Connect>
            </Response>`;

            res.type('text/xml');
            return res.send(twiml);
        }

        // Handle voicemail fallback
        if (routing.destination === 'voicemail') {
            console.log(`[Twilio] Redirecting to voicemail`);
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Redirect>${httpProtocol}://${host}/api/twilio/voicemail</Redirect>
            </Response>`;

            res.type('text/xml');
            return res.send(twiml);
        }

        // Handle WhatsApp/hangup fallback
        if (settings.fallbackAction === 'whatsapp' && From) {
            try {
                const fallbackMessage = (settings.fallbackMessage as string).replace('{business_name}', settings.businessName as string);
                // Use conversation engine to send message
                const { conversationEngine } = await import('./conversation-engine');
                await conversationEngine.sendMessage(From.replace('+', ''), fallbackMessage);
                console.log(`[Twilio] WhatsApp fallback sent to ${From}`);
            } catch (error) {
                console.error('[Twilio] Failed to send WhatsApp fallback:', error);
            }
        }

        // Default: Play apology message and hang up
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="${settings.voice}">Sorry we missed your call. We'll be in touch shortly.</Say>
          <Hangup/>
        </Response>`;

        res.type('text/xml');
        res.send(twiml);
    } else {
        // Call was answered successfully - just end gracefully
        res.type('text/xml');
        res.send('<Response></Response>');
    }
});

// Twilio Recording Status Callback - Fallback transcription for calls with missing transcripts
import { transcribeFromUrl } from './deepgram';
import { calls } from '../shared/schema';
import { findCallByTwilioSid, updateCall } from './call-logger';

app.post('/api/twilio/recording-status', async (req, res) => {
    const { CallSid, RecordingSid, RecordingUrl, RecordingStatus } = req.body;
    console.log(`[Twilio] Recording status for ${CallSid}: ${RecordingStatus}`);

    // Respond immediately to Twilio
    res.status(200).send('OK');

    // Only process completed recordings
    if (RecordingStatus !== 'completed') {
        return;
    }

    try {
        // Find the call record by Twilio SID
        const callRecordId = await findCallByTwilioSid(CallSid);

        if (!callRecordId) {
            console.log(`[Recording] No call record found for ${CallSid}`);
            return;
        }

        // Get the call to check if it already has a transcript
        const [call] = await db.select({
            id: calls.id,
            transcription: calls.transcription,
            recordingUrl: calls.recordingUrl,
        }).from(calls).where(eq(calls.id, callRecordId));

        if (!call) {
            console.log(`[Recording] Call record ${callRecordId} not found`);
            return;
        }

        // Build the MP3 URL from the recording SID
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${RecordingSid}.mp3`;

        // Always update the recording URL
        await updateCall(callRecordId, { recordingUrl: mp3Url });
        console.log(`[Recording] Updated call ${callRecordId} with recording URL`);

        // If transcription is missing or very short, trigger fallback transcription
        if (!call.transcription || call.transcription.length < 10) {
            console.log(`[Recording] Transcript missing/short for ${CallSid}, triggering fallback transcription...`);

            const transcript = await transcribeFromUrl(mp3Url);

            if (transcript) {
                await updateCall(callRecordId, { transcription: transcript });
                console.log(`[Recording] Fallback transcription saved for ${callRecordId} (${transcript.length} chars)`);
            } else {
                console.log(`[Recording] Fallback transcription failed for ${callRecordId}`);
            }
        } else {
            console.log(`[Recording] Call ${callRecordId} already has transcript (${call.transcription.length} chars)`);
        }

    } catch (error) {
        console.error('[Recording] Error processing recording status:', error);
    }
});

import { conversationEngine } from './conversation-engine';

// Create Server
const server = createServer(app);

// Setup WebSockets
const wssTwilio = new WebSocketServer({ noServer: true });
const wssClient = new WebSocketServer({ noServer: true });
const wssElevenLabs = new WebSocketServer({ noServer: true });

export function broadcastToClients(message: any) {
    const data = JSON.stringify(message);
    wssClient.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(data);
        }
    });
}

// Handle client WebSocket connections from frontend
wssClient.on('connection', (ws, req) => {
    console.log('[Client WS] Frontend client connected');
    console.log(`[Client WS] Total clients: ${wssClient.clients.size}`);

    ws.on('close', () => {
        console.log('[Client WS] Client disconnected');
        console.log(`[Client WS] Remaining clients: ${wssClient.clients.size}`);
    });

    ws.on('error', (error) => {
        console.error('[Client WS] WebSocket error:', error);
    });
});

setupTwilioSocket(wssTwilio, broadcastToClients);
conversationEngine.attachWebSocket(wssClient);

// Setup Eleven Labs WebSocket handler
import { ElevenLabsStreamHandler } from './eleven-labs/stream-handler';
import { StreamConfig } from './eleven-labs/types';

wssElevenLabs.on('connection', async (ws, req) => {
    console.log('[ElevenLabs-WS] New WebSocket connection');

    try {
        // Extract parameters from URL
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        console.log(`[ElevenLabs-WS] Full URL: ${req.url}`);
        console.log(`[ElevenLabs-WS] Query params:`, Object.fromEntries(url.searchParams));

        const agentId = url.searchParams.get('agentId') || '';
        const context = (url.searchParams.get('context') || 'in-hours') as 'in-hours' | 'out-of-hours' | 'missed-call';
        const leadNumber = url.searchParams.get('leadPhoneNumber') || '';
        const callSid = url.searchParams.get('callSid') || '';
        const streamSid = url.searchParams.get('streamSid') || '';

        const config: StreamConfig = {
            agentId,
            context,
            leadNumber,
            callSid,
            streamSid,
        };

        // Create and initialize stream handler
        const handler = new ElevenLabsStreamHandler(ws, config);
        await handler.initialize();
    } catch (error) {
        console.error('[ElevenLabs-WS] Failed to initialize stream handler:', error);
        ws.close();
    }
});

server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    console.log(`[Server] Upgrade request for ${pathname}`);

    if (pathname === '/api/twilio/realtime') {
        process.stdout.write('[Server] Upgrading to Twilio Realtime\n');
        wssTwilio.handleUpgrade(request, socket, head, (ws) => {
            wssTwilio.emit('connection', ws, request);
        });
    } else if (pathname === '/api/ws/client') {
        process.stdout.write('[Server] Upgrading to WhatsApp Client WS\n');
        wssClient.handleUpgrade(request, socket, head, (ws) => {
            wssClient.emit('connection', ws, request);
        });
    } else if (pathname === '/api/twilio/eleven-labs-stream') {
        process.stdout.write('[Server] Upgrading to Eleven Labs Stream\n');
        wssElevenLabs.handleUpgrade(request, socket, head, (ws) => {
            wssElevenLabs.emit('connection', ws, request);
        });
    } else {
        process.stdout.write(`[Server] Unexpected upgrade for ${pathname} - destroying socket\n`);
        socket.destroy();
    }
});



async function startServer() {
    // Vite Middleware Setup
    if (process.env.NODE_ENV !== 'production') {
        try {
            const { createServer: createViteServer } = await import('vite');
            const vite = await createViteServer({
                server: { middlewareMode: true },
                appType: 'custom'
            });

            // Use vite's connect instance as middleware
            app.use(vite.middlewares);

            // Serve index.html
            app.use('*', async (req, res, next) => {
                const url = req.originalUrl;
                try {
                    // This block seems to be a misplaced snippet from a simulation context.
                    // It's not syntactically valid here and doesn't align with the surrounding code.
                    // Removing the malformed snippet.
                    // The instruction "Update transcription in LiveCallContext simulation" implies a change
                    // within a simulation context, which is not directly present in this `index.ts` file
                    // in a way that would allow this snippet to be correctly inserted.
                    // The original code for serving index.html is restored.
                    console.log(`[Vite SSR] Serving ${url}`);
                    let template = fs.readFileSync(path.resolve(__dirname, '../client/index.html'), 'utf-8');
                    template = await vite.transformIndexHtml(url, template);
                    res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
                } catch (e) {
                    vite.ssrFixStacktrace(e as Error);
                    next(e);
                }
            });
            console.log("[V6 Switchboard] Vite middleware attached");
        } catch (e) {
            console.error("Failed to setup Vite middleware:", e);
        }
    } else {
        // Production
        app.use(express.static(path.resolve(__dirname, '../dist/public')));
        app.use('*', (req, res) => {
            res.sendFile(path.resolve(__dirname, '../dist/public/index.html'));
        });
    }

    // Start Listener
    const PORT = process.env.PORT || 5001;
    server.listen(PORT, async () => {
        console.log(`[V6 Switchboard] Listening on port ${PORT}`);
        console.log(`[V6 Switchboard] WebSocket at ws://localhost:${PORT}/api/twilio/realtime`);

        // B4: Preload SKU cache at startup
        console.log('[V6 Switchboard] Preloading SKU cache...');
        await loadAndCacheSkus();
        console.log('[V6 Switchboard] SKU cache ready');
    });
}

// execute start
startServer().catch(err => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});

// Handle EADDRINUSE at the process level for better DX
server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`[V6 Switchboard] Port ${process.env.PORT || 5001} is in use.`);
        if (process.env.NODE_ENV !== 'production') {
            console.log('[V6 Switchboard] Dev mode detected: Attempting to kill the process occupying the port...');
            try {
                const port = process.env.PORT || 5001;
                const pid = execSync(`lsof -t -i:${port} -sTCP:LISTEN`).toString().trim();
                if (pid) {
                    process.kill(parseInt(pid), 'SIGKILL');
                    console.log(`[V6 Switchboard] Killed process ${pid}. Restarting server in 1s...`);
                    setTimeout(() => {
                        server.close();
                        server.listen(port);
                    }, 1000);
                    return;
                }
            } catch (err) {
                console.error('[V6 Switchboard] Failed to auto-kill process:', err);
            }
        }
        console.error(`[V6 Switchboard] Address in use, retrying...`);
        setTimeout(() => {
            server.close();
            server.listen(process.env.PORT || 5001);
        }, 1000);
    } else {
        console.error('[V6 Switchboard] Server error:', e);
    }
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    console.log('\n[V6 Switchboard] Received SIGINT, shutting down gracefully...');
    conversationEngine.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[V6 Switchboard] Received SIGTERM, shutting down gracefully...');
    conversationEngine.destroy();
    process.exit(0);
});
