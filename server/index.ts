import dns from "node:dns";
dns.setDefaultResultOrder('ipv4first');

import 'dotenv/config';
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { db } from "./db";
import { productizedServices, skuMatchLogs, calls, callSkus, handymanProfiles, conversations } from "../shared/schema";
import { desc, eq, and, ne, or, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { detectSku, detectMultipleTasks, loadAndCacheSkus } from "./skuDetector";
import { setupTwilioSocket } from "./twilio-realtime";
import { createCall, findCallByTwilioSid, updateCall, finalizeCall } from './call-logger';
import { determineCallRouting, CallRoutingSettings, AgentMode, FallbackAction } from "./call-routing-engine";
import { quotesRouter } from "./quotes";
import { leadsRouter } from "./leads";
import voiceRouter from "./voice";
import { testRouter } from "./test-routes";
import { dashboardRouter } from "./dashboard";
import { whatsappRouter } from "./whatsapp-api";
import { metaWhatsAppRouter, attachMetaWebSocket } from "./meta-whatsapp";
import { trainingRouter } from './training-routes';
import handymenRouter from './handymen';
import callsRouter from './calls';
import { generateWhatsAppMessage, refineWhatsAppMessage } from './openai';
import { searchAddresses, validatePostcode } from './google-places'; // B8: Address lookup
import { devRouter } from './dev-tools';
import { settingsRouter, getTwilioSettings } from './settings';
import contractorAuthRouter from './contractor-auth';
import contractorAvailabilityRouter from './availability-routes';
import contractorJobsRouter from './job-routes';
import contractorDashboardRouter from './contractor-dashboard-routes';
import placesRouter from './places-routes';
import { stripeRouter } from './stripe-routes';
import { elevenLabsWebhookRouter } from './eleven-labs/webhook';
import contentRouter from './content';
import { setupCronJobs } from './cron';
import uploadRouter from "./upload";


import publicRoutes from './public-routes';
import mediaRouter from './media-upload';
import session from "express-session";
import passport from "passport";
import authRouter, { requireAdmin } from "./auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' })); // Increased limit for large transcriptions
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
    secret: process.env.SESSION_SECRET || "dev_secret_key_123",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production" }
}));

app.use(passport.initialize());
// app.use(passport.session()); // Not strictly needed as we use manual tokens, but harmless if configured correctly

// DEBUG: Global Logger removed
// Force restart for schema update

app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));

// Serve static files from attached_assets directory if needed
// app.use('/attached_assets', express.static('attached_assets'));

// Serve WhatsApp Media
const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');
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

// Start Cron Jobs
setupCronJobs();

// ==========================================
// DOMAIN ROUTING MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
    const host = req.headers.host || '';

    // Check if we are on the "Contractors" domain (e.g., richard.handy.contractors or richard.localhost:5001)
    // Production: *.handy.contractors
    // Dev: *.localhost:5001 or *.ngrok-free.app (if configured via wildcard tunnel, usually tough locally)

    // Simple logic: If host starts with a subdomain that IS NOT 'www', 'api', or 'app'
    // AND the domain part matches our known contractor domain.

    // For local dev, let's assume we test with: http://richard.localhost:5001
    // (Note: /etc/hosts needs to map richard.localhost to 127.0.0.1)

    const isLocalhost = host.includes('localhost');
    const isContractorDomain = host.includes('handy.contractors');

    if (isLocalhost || isContractorDomain) {
        const parts = host.split('.');

        // Handling "richard.localhost:5001" -> parts = ['richard', 'localhost:5001']
        // Handling "richard.handy.contractors" -> parts = ['richard', 'handy', 'contractors']

        if (parts.length > 1) {
            const subdomain = parts[0];

            // Exclude reserved subdomains
            const reserved = ['www', 'api', 'app', 'admin', 'switchboard'];

            if (!reserved.includes(subdomain) && !req.path.startsWith('/api')) {
                // It's a contractor profile request!
                console.log(`[DomainRouting] Detected contractor subdomain: ${subdomain}`);

                // Rewrite the request to serve the SPA, but we need the Frontend to know the slug.
                // We can't easily Rewrite the SPA routing on the fly without SSR.
                // STRATEGY: We serve the main SPA index.html, but we inject a global window variable 
                // OR relies on the frontend to parse window.location.host

                // For now, let's just log it. The capabilities of "Rewrite" in Express + CSR (Client Side Rendering) 
                // are limited to serving the index.html. The React Router needs to handle the logic.
            }
        }
    }

    next();
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
            stripe_key_set: !!process.env.STRIPE_SECRET_KEY,
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

    if (!checks.infrastructure.database) {
        res.status(503).json(checks);
    } else {
        res.json(checks);
    }
});

// Register Quotes Router (Migrated from V5)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use(quotesRouter);
app.use(leadsRouter);
app.use('/api', voiceRouter);
app.use('/api/places', placesRouter); // API: Places Search
app.use('/api', testRouter);
app.use('/api/whatsapp', whatsappRouter); // Legacy Twilio Webhooks
app.use('/api/whatsapp', metaWhatsAppRouter); // Meta Cloud API Webhooks
app.use('/api/dashboard', requireAdmin, dashboardRouter);
app.use('/api/handymen', handymenRouter);
app.use('/api/calls', callsRouter);
app.use('/api/calls', callsRouter);
app.use(trainingRouter);
app.use('/api', devRouter);
app.use('/api/settings', settingsRouter);
app.use(stripeRouter); // Stripe payment routes
app.use('/api', elevenLabsWebhookRouter); // ElevenLabs Webhooks
app.use('/api', contentRouter); // Landing Pages & Banners
app.use('/api', uploadRouter);
app.use('/uploads', express.static(path.join(process.cwd(), "uploads")));

// Contractor Portal Routes
app.use('/api/contractor', contractorAuthRouter);
app.use('/api/contractor', contractorDashboardRouter);
app.use('/api/contractor/media', mediaRouter);
app.use('/api/contractor/availability', contractorAvailabilityRouter);
app.use('/api/contractor/jobs', contractorJobsRouter);
app.use('/api/public', publicRoutes); // Public API Routes
app.use('/api/auth', authRouter); // Auth Routes
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

// AI-Refined WhatsApp Message (Weave in excuses/reasons)
app.post('/api/whatsapp/ai-refine', async (req, res) => {
    const { message } = req.body;
    console.log("[AI Refine] Endpoint hit with message length:", message?.length);
    if (!message) return res.status(400).json({ error: "Message is required" });

    try {
        const refined = await refineWhatsAppMessage(message);
        res.json({ message: refined });
    } catch (e) {
        console.error("AI refine error:", e);
        res.status(500).json({ error: "Failed to refine message" });
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

    // Log call to database
    let callRecordId: string | null = null;
    try {
        const existingCallId = await findCallByTwilioSid(req.body.CallSid);
        if (existingCallId) {
            callRecordId = existingCallId;
        } else {
            callRecordId = await createCall({
                callId: req.body.CallSid,
                phoneNumber: req.body.From,
                direction: "inbound",
                status: "ringing",
                customerName: "Unknown Caller",
            });
            console.log(`[Twilio] Initial call logged for ${req.body.CallSid}`);
        }
    } catch (e) {
        console.error(`[Twilio] Failed to log initial call ${req.body.CallSid}:`, e);
    }

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
        elevenLabsBusyAgentId: settings.elevenLabsBusyAgentId,
        elevenLabsApiKey: settings.elevenLabsApiKey,
    };

    // Determine call routing
    const routing = determineCallRouting(routingSettings, false, getActiveCallCount());
    console.log(`[Twilio] Routing decision: ${routing.reason} (mode: ${routing.effectiveMode}, destination: ${routing.destination})`);

    // Update call record with routing info
    if (callRecordId) {
        let initialOutcome = 'UNKNOWN';
        if (routing.destination === 'eleven-labs' || routing.destination === 'busy-agent') initialOutcome = 'ELEVEN_LABS';
        else if (routing.destination === 'va-forward') initialOutcome = 'FORWARDED';
        else if (routing.destination === 'voicemail') initialOutcome = 'VOICEMAIL';

        // Only update outcome if we have a meaningful one
        if (initialOutcome !== 'UNKNOWN') {
            const updateProps: Record<string, any> = { outcome: initialOutcome };

            // Store routing context for differentiation
            if (routing.destination === 'busy-agent') {
                updateProps.missedReason = 'busy_agent';
            } else if (routing.destination === 'eleven-labs') {
                if (routing.elevenLabsContext === 'out-of-hours') {
                    updateProps.missedReason = 'out_of_hours';
                } else {
                    // Start of Catch-all: Ensure we tag it as an agent call even if in-hours
                    updateProps.missedReason = 'ai_agent';
                }
            }

            await updateCall(callRecordId, updateProps);
        }
    }

    const welcomeMessage = (settings.welcomeMessage as string).replace('{business_name}', settings.businessName as string);
    const holdMusicUrl = `${httpProtocol}://${host}/api/twilio/hold-music`;

    // Start TwiML response
    let twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>`;

    // REAL-TIME TRANSCRIPTION: Always stream to Deepgram (even for Eleven Labs calls)
    twiml += `
      <Start>
        <Stream url="${streamUrl}">
            <Parameter name="phoneNumber" value="${req.body.From}" />
        </Stream>
      </Start>`;

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
      <Dial timeout="${settings.maxWaitSeconds || 30}" action="${httpProtocol}://${host}/api/twilio/dial-status" method="POST" answerOnBridge="false" ringTone="uk" callerId="${req.body.To || req.body.Called}">
        <Number url="${holdMusicUrl}">${settings.forwardNumber}</Number>
      </Dial>`;
    } else if (routing.destination === 'eleven-labs' || routing.destination === 'busy-agent') {
        // Redirect to Eleven Labs Register Call endpoint (DIRECT MODE)
        const context = routing.elevenLabsContext || 'in-hours';
        // We pass context via query param to the register endpoint
        const registerUrl = `${httpProtocol}://${host}/api/twilio/eleven-labs-register?context=${context}`;

        twiml += `
      <Redirect>${registerUrl}</Redirect>`;
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

// Eleven Labs Register Call - Uses official Eleven Labs API
import { registerElevenLabsCall } from './eleven-labs/register-call';

app.post('/api/twilio/eleven-labs-register', async (req, res) => {
    try {
        const context = (req.query.context as string) || 'in-hours';
        const fromNumber = req.body.From;
        const toNumber = req.body.To || req.body.Called;

        console.log(`[ElevenLabs-Register] Incoming request: From=${fromNumber}, To=${toNumber}, Context=${context}`);

        const settings = await getTwilioSettings();

        // Get context message from settings
        const contextMessages: Record<string, string> = {
            'in-hours': settings.agentContextDefault || 'How can I help you today?',
            'out-of-hours': settings.agentContextOutOfHours || "We're currently closed, but I can help you schedule a service or take a message.",
            'missed-call': settings.agentContextMissed || "I'm sorry we missed your call. Let me help you with that.",
            'busy': 'I am currently on another line, but I can help you with your request while you wait.',
        };

        const contextMessage = contextMessages[context] || contextMessages['in-hours'];
        const agentId = (context === 'busy' && settings.elevenLabsBusyAgentId)
            ? settings.elevenLabsBusyAgentId
            : settings.elevenLabsAgentId;

        // Register call with Eleven Labs
        const twiml = await registerElevenLabsCall({
            agentId,
            apiKey: settings.elevenLabsApiKey,
            fromNumber,
            toNumber,
            context,
            contextMessage,
        });

        // Return TwiML directly to Twilio
        res.type('text/xml');
        res.send(twiml);
    } catch (error) {
        console.error('[ElevenLabs-Register] Error:', error);

        const host = req.headers.host;
        const httpProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';

        // Fallback to voicemail on error
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Say>We're experiencing technical difficulties. Please leave a message.</Say>
                <Redirect>${httpProtocol}://${host}/api/twilio/voicemail</Redirect>
            </Response>`);
    }
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
            elevenLabsBusyAgentId: settings.elevenLabsBusyAgentId,
            elevenLabsApiKey: settings.elevenLabsApiKey,
        };

        // Determine fallback routing (VA missed call scenario)
        const routing = determineCallRouting(routingSettings, true, getActiveCallCount()); // isVAMissedCall = true, pass active call count
        console.log(`[Twilio] Fallback routing: ${routing.reason} (destination: ${routing.destination})`);

        // Action Center: Mark as Missed Call (Critical) immediately
        // We do this BEFORE fallback handling to ensure even if fallback fails, the call is flagged
        try {
            // Find call record ID
            const callRecordId = await findCallByTwilioSid(CallSid);
            if (callRecordId) {
                await updateCall(callRecordId, {
                    outcome: 'MISSED_CALL', // Explicitly mark as missed
                    actionStatus: 'pending',
                    actionUrgency: 1, // Critical - immediate callback required
                    missedReason: 'no_answer',
                    tags: ['missed_call', 'va_no_answer']
                });
                console.log(`[ActionCenter] Call ${callRecordId} flagged as MISSED_CALL (Critical).`);
            }
        } catch (e) {
            console.warn("[ActionCenter] Failed to flag missed call:", e);
        }

        // Handle Eleven Labs fallback - direct registration (no redirect)
        if (routing.destination === 'eleven-labs' || routing.destination === 'busy-agent') {
            const context = routing.elevenLabsContext || 'missed-call';
            console.log(`[Twilio] Connecting to Eleven Labs with context: ${context} (Direct, Dest: ${routing.destination})`);

            // Get context message from settings
            const contextMessages: Record<string, string> = {
                'in-hours': settings.agentContextDefault || 'How can I help you today?',
                'out-of-hours': settings.agentContextOutOfHours || "We're currently closed, but I can help you schedule a service or take a message.",
                'missed-call': settings.agentContextMissed || "I'm sorry we missed your call. Let me help you with that.",
                'busy': 'I am currently on another line, but I can help you with your request while you wait.',
            };

            const contextMessage = contextMessages[context] || contextMessages['in-hours'];

            // Determine correct Agent ID (Normal vs Busy)
            const agentId = (routing.destination === 'busy-agent' && settings.elevenLabsBusyAgentId)
                ? settings.elevenLabsBusyAgentId
                : settings.elevenLabsAgentId;

            try {
                // Register call with Eleven Labs directly
                // We append the redirect to call-ended here as well for consistency, although registerElevenLabsCall already does it!
                // Wait, registerElevenLabsCall was modified to always append the redirect.
                // So we just call it.
                const twiml = await registerElevenLabsCall({
                    agentId: agentId,
                    apiKey: settings.elevenLabsApiKey,
                    fromNumber: From,
                    toNumber: req.body.To || req.body.Called,
                    context,
                    contextMessage,
                });

                res.type('text/xml');
                return res.send(twiml);
            } catch (error) {
                console.error('[Twilio] Eleven Labs direct registration failed:', error);
                // Fallback to voicemail unique to this failure
                const twiml = `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                    <Say>We're having trouble connecting you. Please leave a message.</Say>
                    <Redirect>${httpProtocol}://${host}/api/twilio/voicemail</Redirect>
                </Response>`;
                res.type('text/xml');
                return res.send(twiml);
            }
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

// Twilio Status Callback - Reliable call completion signal
app.post('/api/twilio/status-callback', async (req, res) => {
    const { CallSid, CallStatus, Duration, SequenceNumber } = req.body;
    console.log(`[Twilio] Status callback for ${CallSid}: ${CallStatus} (Duration: ${Duration}s, Seq: ${SequenceNumber})`);

    // DEBUG: Write to file removed

    // We only care about final states
    const terminalStates = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];
    if (!terminalStates.includes(CallStatus)) {
        return res.status(200).send('OK');
    }

    try {
        const callRecordId = await findCallByTwilioSid(CallSid);

        if (callRecordId) {
            // Finalize the call with the accurate duration from Twilio
            // We pass undefined for outcome to avoid overwriting existing specific outcomes like 'ELEVEN_LABS'
            await finalizeCall(callRecordId, {
                duration: Duration ? parseInt(Duration) : undefined,
                endTime: new Date(),
                // Only set outcome if we don't have one, or if it's a "bad" outcome
                outcome: (CallStatus === 'busy' || CallStatus === 'no-answer') ? 'MISSED_CALL' : undefined
            });
            console.log(`[Twilio] Finalized call ${callRecordId} via StatusCallback`);
        } else {
            console.log(`[Twilio] No call record found for ${CallSid} in status callback`);
        }
    } catch (e) {
        console.error(`[Twilio] Error processing status callback:`, e);
    }

    res.status(200).send('OK');
});

// Explicit Call Ended Endpoint - For TwiML Redirects (Eleven Labs fallback)
app.all('/api/twilio/call-ended', async (req, res) => {
    const { CallSid, CallStatus } = req.body;
    console.log(`[Twilio] Call ended redirect for ${CallSid}: ${CallStatus}`);

    try {
        const callRecordId = await findCallByTwilioSid(CallSid);

        if (callRecordId) {
            await finalizeCall(callRecordId, {
                endTime: new Date(),
                // If we hit this, it means the flow finished (e.g. AI hung up)
                outcome: 'COMPLETED'
            });
            console.log(`[Twilio] Finalized call ${callRecordId} via CallEnded redirect`);
        }
    } catch (e) {
        console.error(`[Twilio] Error processing call ended redirect:`, e);
    }

    res.type('text/xml');
    res.send('<Response><Hangup/></Response>');
});

// Twilio Recording Status Callback - Fallback transcription for calls with missing transcripts
import { transcribeFromUrl } from './deepgram';


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

// Action Center API: Get Calls Requiring Action
app.get('/api/calls/actions', async (req, res) => {
    try {
        const actionItems = await db.select()
            .from(calls)
            .where(
                or(
                    eq(calls.actionStatus, 'pending'),
                    eq(calls.actionStatus, 'attempting')
                )
            )
            .orderBy(asc(calls.actionUrgency), desc(calls.startTime)) // Highest urgency (1) first, then newest
            .limit(50);

        res.json(actionItems);
    } catch (error) {
        console.error('Failed to fetch action center items:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

// Action Center API: Update Action Status (Resolve/Dismiss)
app.patch('/api/calls/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { actionStatus } = req.body;

        await updateCall(id, { actionStatus });
        res.json({ success: true });
    } catch (error) {
        console.error(`Failed to update call ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update call' });
    }
});

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
    const PORT = parseInt(process.env.PORT || "5001", 10);
    server.listen(PORT, '0.0.0.0', async () => {
        console.log(`[V6 Switchboard] Production server running on port ${PORT}`);
        console.log(`[V6 Switchboard] Environment: ${process.env.NODE_ENV || 'development'}`);

        // B4: Preload SKU cache at startup
        console.log('[V6 Switchboard] Preloading SKU cache...');
        try {
            await loadAndCacheSkus();
            console.log('[V6 Switchboard] SKU cache ready');
        } catch (e) {
            console.error('[V6 Switchboard] SKU cache preload failed:', e);
        }
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
