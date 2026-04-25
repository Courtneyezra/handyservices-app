/**
 * WhatsApp Chrome Extension Ingest Route
 *
 * Receives message events from the browser extension running in the VA's
 * Chrome on web.whatsapp.com. Each POST carries one or more captured
 * messages; we hand them to the shared ingest helper which upserts the
 * conversation, inserts the message, and auto-creates a lead on first
 * inbound.
 *
 * Auth: Bearer token compared with crypto.timingSafeEqual against
 *       process.env.WA_EXT_INGEST_TOKEN. The token is configured in the
 *       extension popup on first install.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ingestWhatsAppMessage, type IngestInput } from './whatsapp-ingest';

export const whatsappExtRouter = Router();

// ------------------------------------------------------------------
// Auth middleware
// ------------------------------------------------------------------
function requireExtToken(req: Request, res: Response, next: NextFunction) {
    const expected = process.env.WA_EXT_INGEST_TOKEN;
    if (!expected) {
        console.error('[wa-ext] WA_EXT_INGEST_TOKEN not set — rejecting all ingest');
        return res.status(503).json({ error: 'ingest disabled: no token configured' });
    }
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'missing bearer token' });

    const provided = match[1];
    // timingSafeEqual requires equal lengths
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'invalid token' });
    }
    next();
}

// ------------------------------------------------------------------
// Health + connectivity check (used by the extension popup)
// ------------------------------------------------------------------
whatsappExtRouter.get('/ext-ping', requireExtToken, (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});

// ------------------------------------------------------------------
// Ingest: accepts a single message or an array
// ------------------------------------------------------------------
interface ExtMessagePayload {
    rawPhone: string;
    contactName?: string;
    direction: 'inbound' | 'outbound';
    content: string;
    type?: string;
    externalMessageId?: string;
    timestamp?: string; // ISO
}

function validatePayload(p: any): ExtMessagePayload | null {
    if (!p || typeof p !== 'object') return null;
    if (typeof p.rawPhone !== 'string' || !p.rawPhone) return null;
    if (p.direction !== 'inbound' && p.direction !== 'outbound') return null;
    if (typeof p.content !== 'string') return null;
    return p as ExtMessagePayload;
}

whatsappExtRouter.post('/ext-ingest', requireExtToken, async (req: Request, res: Response) => {
    const body = req.body;
    const batch: any[] = Array.isArray(body) ? body : Array.isArray(body?.messages) ? body.messages : [body];

    if (!batch.length) {
        return res.status(400).json({ error: 'empty payload' });
    }

    const results: any[] = [];
    let createdLeads = 0;
    let created = 0;
    let duplicates = 0;
    let errors = 0;

    for (const raw of batch) {
        const valid = validatePayload(raw);
        if (!valid) {
            errors++;
            results.push({ status: 'error', reason: 'invalid payload' });
            continue;
        }

        const input: IngestInput = {
            rawPhone: valid.rawPhone,
            contactName: valid.contactName || null,
            direction: valid.direction,
            content: valid.content,
            type: valid.type || 'text',
            externalMessageId: valid.externalMessageId || null,
            timestamp: valid.timestamp ? new Date(valid.timestamp) : new Date(),
            source: 'extension',
        };

        const result = await ingestWhatsAppMessage(input);
        results.push(result);
        if (result.status === 'created') created++;
        if (result.status === 'duplicate') duplicates++;
        if (result.status === 'error') errors++;
        if (result.leadWasCreated) createdLeads++;
    }

    console.log(
        `[wa-ext] batch: received=${batch.length} created=${created} dup=${duplicates} errors=${errors} newLeads=${createdLeads}`,
    );

    res.json({
        received: batch.length,
        created,
        duplicates,
        errors,
        newLeads: createdLeads,
        results,
    });
});
