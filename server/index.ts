
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
import { detectSku, detectMultipleTasks } from "./skuDetector";
import { setupTwilioSocket } from "./twilio-realtime";
import { quotesRouter } from "./quotes";
import { leadsRouter } from "./leads";
import { testRouter } from "./test-routes";
import { dashboardRouter } from "./dashboard";
import { whatsappRouter } from "./whatsapp-api";
import { trainingRouter } from './training-routes';
import handymenRouter from './handymen';
import { generateWhatsAppMessage } from './openai';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' })); // Increased limit for large transcriptions
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from attached_assets directory if needed
// app.use('/attached_assets', express.static('attached_assets'));

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

// Register Quotes Router (Migrated from V5)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use(quotesRouter);
app.use(leadsRouter);
app.use('/api', testRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/handymen', handymenRouter);
app.use(trainingRouter);


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

// Twilio Voice Webhook
app.post('/api/twilio/voice', (req, res) => {
    console.log(`[Twilio] Incoming call from ${req.body.From}`);
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${host}/api/twilio/realtime`;

    const twiml = `
    <Response>
      <Start>
        <Stream url="${streamUrl}">
            <Parameter name="phoneNumber" value="${req.body.From}" />
        </Stream>
      </Start>
      <Say voice="Polly.Amy-Neural">Hello! This is the Switchboard. Please describe the plumbing or electrical job you need help with.</Say>
      <Pause length="30" />
      <Say voice="Polly.Amy-Neural">I'm still listening. Go ahead whenever you're ready.</Say>
      <Pause length="30" />
      <Say voice="Polly.Amy-Neural">Thank you for the details. We are analyzing your request and will be with you shortly.</Say>
      <Pause length="10" />
    </Response>
  `;
    res.type('text/xml');
    res.send(twiml);
});

import { whatsAppManager } from './whatsapp';

// Create Server
const server = createServer(app);

// Setup WebSockets
const wssTwilio = new WebSocketServer({ noServer: true });
const wssClient = new WebSocketServer({ noServer: true });

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
whatsAppManager.attachWebSocket(wssClient);

// Startup health check: kill any zombie Chrome processes
console.log('[V6 Switchboard] Running startup health check...');
try {
    execSync('pkill -f "chromium.*session-client-one" 2>/dev/null || true', { stdio: 'ignore' });
    console.log('[V6 Switchboard] Cleaned up any existing Chrome processes');
} catch (e) {
    // Silently ignore
}

whatsAppManager.initialize();

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
    server.listen(PORT, () => {
        console.log(`[V6 Switchboard] Listening on port ${PORT}`);
        console.log(`[V6 Switchboard] WebSocket at ws://localhost:${PORT}/api/twilio/realtime`);
    });
}

// execute start
startServer().catch(err => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    console.log('\n[V6 Switchboard] Received SIGINT, shutting down gracefully...');
    await whatsAppManager.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[V6 Switchboard] Received SIGTERM, shutting down gracefully...');
    await whatsAppManager.destroy();
    process.exit(0);
});
