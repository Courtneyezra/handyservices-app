import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import { type Message } from 'whatsapp-web.js';
import puppeteer from 'puppeteer';
import { transcribeAudio } from './deepgram';
import { WebSocket, WebSocketServer } from 'ws';
import { detectSku } from './skuDetector';
import { extractCallMetadata } from './openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, 'whatsapp_history.json');
const METADATA_FILE = path.join(__dirname, 'chat_metadata.json');
const SESSION_DIR = path.join(__dirname, '../.wwebjs_auth/session-client-one');

export type ChatRole = 'lead' | 'handyman';
export type FunnelStage = 'inbound' | 'ascertaining' | 'decision' | 'actioned';

interface ChatMetadata {
    role: ChatRole;
    stage: FunnelStage;
    name?: string;
    assignedHandymanId?: string;
}

export class WhatsAppManager {
    private client: any;
    private wss: WebSocketServer | null = null;
    private qrCode: string | null = null;
    private isReady: boolean = false;
    private stage: string = 'pre-init';
    private messageHistory: any[] = [];
    private chatMetadata: Record<string, ChatMetadata> = {};
    private initializationTimeout: NodeJS.Timeout | null = null;
    private isInitializing: boolean = false;

    constructor() {
        this.loadHistory();
        this.loadMetadata();
        this.cleanupStaleSessions();
        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: "client-one" }),
            authTimeoutMs: 120000, // 2 minute timeout for slower environments
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            },
            puppeteer: {
                headless: true,
                dumpio: true, // Crucial: shows chromium process output in our terminal
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-software-rasterizer',
                    '--disable-features=IsolateOrigins,site-per-process'
                ],
            }
        });

        // Diagnostic Heartbeat
        setInterval(() => {
            if (!this.isReady) {
                console.log(`[WhatsApp Heartbeat] ${new Date().toLocaleTimeString()} - Stage: ${this.stage}, QR: ${!!this.qrCode}, Clients: ${this.wss?.clients.size || 0}`);
            }
        }, 10000);

        this.setupListeners();
    }

    private setupListeners() {
        console.log('[WhatsApp] Setting up event listeners...');

        this.client.on('qr', (qr: string) => {
            console.log(`[${new Date().toISOString()}] WhatsApp QR Code received`);
            this.stage = 'qr-ready';
            this.qrCode = qr;
            this.broadcast({ type: 'whatsapp:qr', data: qr });
        });

        this.client.on('loading_screen', (percent: number, message: string) => {
            console.log(`[${new Date().toISOString()}] [WhatsApp] Loading: ${percent}% - ${message}`);
            this.stage = `loading-${percent}`;
            this.broadcast({ type: 'whatsapp:loading', data: { percent, message } });
        });

        this.client.on('ready', async () => {
            console.log(`[${new Date().toISOString()}] WhatsApp Client is ready!`);
            this.isReady = true;
            this.isInitializing = false;
            this.stage = 'ready';

            // Clear initialization timeout
            if (this.initializationTimeout) {
                clearTimeout(this.initializationTimeout);
                this.initializationTimeout = null;
            }

            this.broadcast({ type: 'whatsapp:ready' });
            this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'starting_sync', status: 'Client ready. Searching for chats...' } });

            // Fetch recent history from multiple chats
            const fetchHistory = async (retries = 5) => {
                try {
                    console.log(`[WhatsApp] Fetching chats (Try: ${6 - retries})...`);
                    this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'searching_chats', status: `Searching for chats (Attempt ${6 - retries}/6)...` } });

                    const chats = await this.client.getChats();
                    console.log(`[WhatsApp] Total chats found: ${chats.length}`);

                    this.broadcast({
                        type: 'whatsapp:diagnostic',
                        data: { stage: 'chats_found', count: chats.length }
                    });

                    if (chats.length > 0) {
                        // Take the top 5 most recent chats
                        const recentChats = chats.slice(0, 5);

                        for (const chat of recentChats) {
                            console.log(`[WhatsApp] Syncing chat: ${chat.name} (${chat.id._serialized})`);
                            this.broadcast({ type: 'whatsapp:diagnostic', data: { status: `Syncing ${chat.name}...` } });

                            const messages = await chat.fetchMessages({ limit: 12 });
                            console.log(`[WhatsApp]  -> Found ${messages.length} messages in ${chat.name}`);

                            // Process messages sequentially to avoid race conditions or DB locks
                            let msgCount = 0;
                            for (const m of messages) {
                                msgCount++;
                                console.log(`[WhatsApp]    -> [${msgCount}/${messages.length}] Syncing message ID: ${m.id._serialized}`);
                                await this.handleMessage(m);
                            }
                        }

                        console.log(`[WhatsApp] History sync complete. Total cached: ${this.messageHistory.length}`);
                        this.broadcast({
                            type: 'whatsapp:diagnostic',
                            data: { stage: 'history_sync_complete', count: this.messageHistory.length, processed: this.messageHistory.length }
                        });

                    } else if (retries > 0) {
                        console.log('[WhatsApp] No chats found, retrying in 4s...');
                        this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'retrying', status: 'No chats found yet. Retrying in 4s...' } });
                        await new Promise(resolve => setTimeout(resolve, 4000));
                        return fetchHistory(retries - 1);
                    } else {
                        this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'failed', status: 'No chats found after multiple attempts.' } });
                    }
                } catch (e: any) {
                    console.error('[WhatsApp] CRITICAL History Error:', e);
                    this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'error', error: `History Error: ${e.message || 'Unknown error'}` } });
                }
            };

            // Wait for internal WA store to stabilize
            setTimeout(() => fetchHistory(), 3000);
        });

        this.client.on('authenticated', () => {
            console.log(`[${new Date().toISOString()}] [WhatsApp] Authenticated successfully`);
            this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'authenticated', status: 'Authenticated. Waiting for ready...' } });
        });

        this.client.on('change_state', (state: string) => {
            console.log(`[${new Date().toISOString()}] [WhatsApp] State change: ${state}`);
            this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'state_change', status: `State: ${state}` } });
        });

        this.client.on('auth_failure', (msg: string) => {
            console.error(`[${new Date().toISOString()}] [WhatsApp] Auth Failure: ${msg}`);
            this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'auth_failure', error: msg } });
        });
        this.client.on('disconnected', (reason: string) => {
            console.log(`[${new Date().toISOString()}] [WhatsApp] Disconnected: ${reason}`);
            this.isReady = false;
            this.qrCode = null;
            this.messageHistory = [];
            this.broadcast({ type: 'whatsapp:disconnected', reason });
            if (reason !== 'LOGOUT') {
                console.log('[WhatsApp] Attempting re-init after disconnect...');
                this.client.initialize().catch(() => { });
            }
        });

        this.client.on('message_create', async (msg: Message) => {
            console.log(`[${new Date().toISOString()}] [WhatsApp] Message event (${msg.fromMe ? 'Outgoing' : 'Incoming'}): ${msg.from}`);
            await this.handleMessage(msg);
        });

        this.client.on('message_ack', (msg: Message, ack: number) => {
            // ack: 0=error, 1=sent, 2=delivered, 3=read, 4=played
            console.log(`[WhatsApp] Message ACK: ${msg.id.id} - Status: ${ack}`);
            this.broadcast({ type: 'whatsapp:ack', data: { id: msg.id.id, ack } });
        });
    }

    private cleanupStaleSessions() {
        try {
            console.log('[WhatsApp] Cleaning up stale session locks...');
            const lockFiles = [
                path.join(SESSION_DIR, 'DevToolsActivePort'),
                path.join(SESSION_DIR, 'SingletonLock'),
                path.join(SESSION_DIR, 'SingletonSocket')
            ];

            let cleaned = 0;
            for (const file of lockFiles) {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                console.log(`[WhatsApp] Removed ${cleaned} stale lock file(s)`);
            }
        } catch (e) {
            console.error('[WhatsApp] Error cleaning stale sessions:', e);
        }
    }

    private killExistingChromeProcesses() {
        try {
            console.log('[WhatsApp] Checking for zombie Chrome processes...');
            execSync('pkill -f "chromium.*session-client-one" 2>/dev/null || true', { stdio: 'ignore' });
        } catch (e) {
            // Silently ignore - pkill returns non-zero if no processes found
        }
    }

    public initialize() {
        if (this.isInitializing) {
            console.log('[WhatsApp] Already initializing, skipping...');
            return;
        }

        this.isInitializing = true;
        console.log('Initializing WhatsApp Client...');
        this.broadcast({ type: 'whatsapp:initializing' });

        // Set a 60-second timeout
        this.initializationTimeout = setTimeout(() => {
            if (!this.isReady) {
                console.error('[WhatsApp] Initialization timeout! Retrying...');
                this.broadcast({ type: 'whatsapp:diagnostic', data: { stage: 'timeout', status: 'Initialization timeout. Retrying...' } });
                this.killExistingChromeProcesses();
                this.cleanupStaleSessions();
                this.isInitializing = false;

                // Retry once
                setTimeout(() => {
                    if (!this.isReady) {
                        this.initialize();
                    }
                }, 2000);
            }
        }, 60000);

        this.client.initialize().catch((e: Error) => {
            console.error('[WhatsApp] Init error:', e);
            this.isInitializing = false;
            if (this.initializationTimeout) {
                clearTimeout(this.initializationTimeout);
            }
        });
    }

    public async destroy() {
        try {
            console.log('[WhatsApp] Shutting down gracefully...');

            // Clear timeout if exists
            if (this.initializationTimeout) {
                clearTimeout(this.initializationTimeout);
            }

            // Save current state
            this.saveHistory();
            this.saveMetadata();

            // Destroy client
            if (this.client) {
                await this.client.destroy();
            }

            // Kill any remaining Chrome processes
            this.killExistingChromeProcesses();

            console.log('[WhatsApp] Shutdown complete');
        } catch (e) {
            console.error('[WhatsApp] Error during shutdown:', e);
        }
    }

    public attachWebSocket(wss: WebSocketServer) {
        this.wss = wss;
        this.wss.on('connection', (ws) => {
            console.log('[WhatsApp] Frontend connected. State:', this.isReady ? 'Ready' : 'Initializing/QR');

            if (this.isReady) {
                ws.send(JSON.stringify({ type: 'whatsapp:ready' }));
            } else if (this.qrCode) {
                ws.send(JSON.stringify({ type: 'whatsapp:qr', data: this.qrCode }));
            } else {
                ws.send(JSON.stringify({ type: 'whatsapp:initializing' }));
            }

            if (this.messageHistory.length > 0) {
                console.log(`[WhatsApp] Syncing ${this.messageHistory.length} messages to fresh client`);
                ws.send(JSON.stringify({ type: 'whatsapp:history', data: this.messageHistory }));
            }

            // Sync metadata
            ws.send(JSON.stringify({ type: 'whatsapp:metadata', data: this.chatMetadata }));

            // Handle messages from client
            ws.on('message', async (message: any) => {
                try {
                    const rawMessage = message.toString();
                    console.log(`[WhatsApp] Received from frontend: ${rawMessage.substring(0, 100)}`);
                    const { type, data } = JSON.parse(rawMessage);

                    if (type === 'whatsapp:send' && data.to && data.body) {
                        console.log(`[WhatsApp] Outgoing to ${data.to}: ${data.body.substring(0, 50)}...`);
                        await this.sendMessage(data.to, data.body);
                    } else if (type === 'whatsapp:set_metadata') {
                        console.log(`[WhatsApp] Metadata update request. chatId: ${data?.chatId}, updates:`, data?.updates);
                        if (data && data.chatId) {
                            this.chatMetadata[data.chatId] = {
                                ...(this.chatMetadata[data.chatId] || { role: 'lead', stage: 'inbound' }),
                                ...data.updates
                            };
                            this.saveMetadata();
                            this.broadcast({ type: 'whatsapp:metadata', data: this.chatMetadata });
                            console.log(`[WhatsApp] Metadata updated for ${data.chatId}`);
                        } else {
                            console.warn('[WhatsApp] Metadata update failed: missing chatId or data');
                        }
                    } else {
                        console.log(`[WhatsApp] Unhandled message type: ${type}`);
                    }
                } catch (e) {
                    console.error('[WhatsApp] Client Msg Parse Error:', e);
                }
            });
        });
    }

    public async sendMessage(to: string, body: string) {
        try {
            if (!this.isReady) throw new Error("Client not ready");

            // Ensure @c.us suffix if it's just a number
            const chatId = to.includes('@') ? to : `${to}@c.us`;
            console.log(`[WhatsApp] Attempting send to ${chatId}`);

            const result = await this.client.sendMessage(chatId, body);

            // message_create will handle the UI update now, so we don't need manual handleMessage
            console.log(`[WhatsApp] Send result: ${result.id.id}`);
            return result;
        } catch (e) {
            console.error('[WhatsApp] Send error:', e);
            throw e;
        }
    }

    private broadcast(message: any) {
        if (!this.wss) return;
        const data = JSON.stringify({ ...message, stage: this.stage });
        const count = this.wss.clients.size;
        console.log(`[WhatsApp] Broadcast ${message.type} (stage: ${this.stage}) to ${count} clients`);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(data);
        });
    }

    private async handleMessage(msg: Message) {
        try {
            const messageData: any = {
                id: msg.id.id,
                from: msg.from,
                to: (msg as any).to, // Recipient for outgoing messages
                fromMe: msg.fromMe,
                senderName: msg.from.split('@')[0], // Default
                timestamp: msg.timestamp,
                type: msg.type,
                body: msg.body,
                transcription: null,
                analysis: null
            };

            // Non-blocking contact lookup
            msg.getContact().then(async (contact) => {
                const name = contact.pushname || contact.number || messageData.senderName;
                if (name !== messageData.senderName) {
                    messageData.senderName = name;
                }
                try {
                    const avatarUrl = await contact.getProfilePicUrl();
                    if (avatarUrl) {
                        messageData.avatarUrl = avatarUrl;
                    }
                } catch (e) { }
                // Broadcast update if name or avatar changed (optional, for now just update cache)
                // this.broadcast({ type: 'whatsapp:message_update', data: { id: messageData.id, senderName: messageData.senderName, avatarUrl: messageData.avatarUrl } });
            }).catch(() => { });

            // Media processing
            if (msg.hasMedia) {
                if (msg.type === 'ptt' || msg.type === 'audio') {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            const { text, segments } = await transcribeAudio(Buffer.from(media.data, 'base64'));
                            messageData.transcription = text;
                            if (text) messageData.analysis = await detectSku(text);
                        }
                    } catch (e) { }
                } else if (msg.type === 'image' || msg.type === 'video') {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            messageData.media = {
                                data: media.data,
                                mimetype: media.mimetype
                            };
                        }
                    } catch (e) {
                        console.error(`[WhatsApp] ${msg.type.toUpperCase()} Download Error:`, e);
                    }
                }
            }

            if (msg.type === 'chat') {
                try {
                    messageData.analysis = await detectSku(msg.body);
                } catch (e) { }
            }

            // Cache
            const existingIndex = this.messageHistory.findIndex(m => m.id === messageData.id);
            if (existingIndex === -1) {
                this.messageHistory.push(messageData);
                if (this.messageHistory.length > 50) this.messageHistory.shift();
                console.log(`[WhatsApp] Cached msg from ${messageData.senderName}`);
            } else {
                this.messageHistory[existingIndex] = messageData;
            }

            this.saveHistory();
            this.broadcast({ type: 'whatsapp:message', data: messageData });
        } catch (error) {
            console.error('[WhatsApp] Msg Error:', error);
        }
    }

    private loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
                this.messageHistory = JSON.parse(data);
                console.log(`[WhatsApp] Loaded ${this.messageHistory.length} messages from history file`);
            }
        } catch (e) {
            console.error('[WhatsApp] Load History Error:', e);
        }
    }

    private saveMetadata() {
        try {
            fs.writeFileSync(METADATA_FILE, JSON.stringify(this.chatMetadata, null, 2));
        } catch (e) {
            console.error('[WhatsApp] Save Metadata Error:', e);
        }
    }

    private loadMetadata() {
        try {
            if (fs.existsSync(METADATA_FILE)) {
                const data = fs.readFileSync(METADATA_FILE, 'utf-8');
                this.chatMetadata = JSON.parse(data);
                console.log(`[WhatsApp] Loaded metadata for ${Object.keys(this.chatMetadata).length} chats`);
            }
        } catch (e) {
            console.error('[WhatsApp] Load Metadata Error:', e);
        }
    }

    private saveHistory() {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.messageHistory, null, 2));
        } catch (e) {
            console.error('[WhatsApp] Save History Error:', e);
        }
    }
}

export const whatsAppManager = new WhatsAppManager();
