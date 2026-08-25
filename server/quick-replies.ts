/**
 * Quick replies — canned messages Ben drops into a conversation.
 *
 * The interesting part is `/send`: it decides freeform-vs-template from the live 24-hour window
 * rather than trusting a stored flag, so a reply can never be sent in a form WhatsApp will reject.
 */
import { Router } from 'express';
import { db } from './db';
import { quickReplies, conversations } from '@shared/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { canSendFreeform } from './meta-whatsapp';
import { sendCustomerMessage } from './outbound';

export const quickRepliesRouter = Router();

/** Normalizes any phone shape to the internal `447...@c.us` conversation key. */
function toConversationKey(phone: string): string {
    const digits = phone.replace('@c.us', '').replace(/^\+/, '').replace(/\D/g, '');
    return `${digits}@c.us`;
}

/**
 * Contact names that exist in the DB but are not the customer's actual name. Ingest writes these
 * when WhatsApp gives no profile name, so they must never reach a greeting — "Hi Unknown," reads
 * far worse to a customer than "Hi there,".
 */
const PLACEHOLDER_NAMES = /^(unknown( caller)?|website visitor|customer|there|guest|no name|null|undefined)$/i;

/** True when `contactName` looks like a real human name we can safely greet by. */
function isRealName(contactName?: string | null): boolean {
    const name = (contactName || '').trim();
    if (!name) return false;
    if (PLACEHOLDER_NAMES.test(name)) return false;
    // A bare phone number stored as the name (ingest fallback) — greeting by it looks robotic.
    if (/^[+\d][\d\s()+-]{5,}$/.test(name)) return false;
    return true;
}

/**
 * Substitutes {{name}} / {{first_name}} placeholders.
 *
 * Falls back to "there" whenever we lack a trustworthy name, so a reply never goes out reading
 * "Hi ," or "Hi Unknown Caller,".
 */
export function renderQuickReply(text: string, contactName?: string | null): string {
    const full = isRealName(contactName) ? (contactName as string).trim() : '';
    const first = full.split(/\s+/)[0] || '';
    return text
        .replace(/\{\{\s*first_name\s*\}\}/gi, first || 'there')
        .replace(/\{\{\s*name\s*\}\}/gi, full || 'there');
}

/** Renders each value of a template's positional variable map. */
function renderVariables(
    vars: Record<string, string> | null | undefined,
    contactName?: string | null
): Record<string, string> | undefined {
    if (!vars) return undefined;
    return Object.fromEntries(
        Object.entries(vars).map(([k, v]) => [k, renderQuickReply(String(v), contactName)])
    );
}

// GET /api/quick-replies — the picker list. ?all=1 includes deactivated ones for the editor.
quickRepliesRouter.get('/', async (req, res) => {
    try {
        const includeInactive = req.query.all === '1';
        const rows = await db
            .select()
            .from(quickReplies)
            .where(includeInactive ? sql`true` : eq(quickReplies.isActive, true))
            .orderBy(asc(quickReplies.sortOrder), asc(quickReplies.label));
        res.json({ replies: rows });
    } catch (error: any) {
        console.error('[QuickReplies] List failed:', error);
        res.status(500).json({ error: 'Failed to load quick replies' });
    }
});

// POST /api/quick-replies — create
quickRepliesRouter.post('/', async (req, res) => {
    try {
        const { label, body, category, contentSid, contentVariables, shortcut, sortOrder } = req.body || {};
        if (!label || !body) return res.status(400).json({ error: "Missing 'label' or 'body'" });

        const id = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const [created] = await db.insert(quickReplies).values({
            id,
            label,
            body,
            category: category || 'general',
            contentSid: contentSid || null,
            contentVariables: contentVariables || null,
            shortcut: shortcut || null,
            sortOrder: typeof sortOrder === 'number' ? sortOrder : 999,
        }).returning();

        res.status(201).json({ reply: created });
    } catch (error: any) {
        console.error('[QuickReplies] Create failed:', error);
        res.status(500).json({ error: 'Failed to create quick reply' });
    }
});

// PATCH /api/quick-replies/:id — edit wording, reorder, or deactivate
quickRepliesRouter.patch('/:id', async (req, res) => {
    try {
        const { label, body, category, contentSid, contentVariables, shortcut, sortOrder, isActive } = req.body || {};
        const patch: Record<string, unknown> = { updatedAt: new Date() };

        if (label !== undefined) patch.label = label;
        if (body !== undefined) patch.body = body;
        if (category !== undefined) patch.category = category;
        if (contentSid !== undefined) patch.contentSid = contentSid || null;
        if (contentVariables !== undefined) patch.contentVariables = contentVariables || null;
        if (shortcut !== undefined) patch.shortcut = shortcut || null;
        if (sortOrder !== undefined) patch.sortOrder = sortOrder;
        if (isActive !== undefined) patch.isActive = isActive;

        const [updated] = await db.update(quickReplies)
            .set(patch)
            .where(eq(quickReplies.id, req.params.id))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Quick reply not found' });
        res.json({ reply: updated });
    } catch (error: any) {
        console.error('[QuickReplies] Update failed:', error);
        res.status(500).json({ error: 'Failed to update quick reply' });
    }
});

// DELETE /api/quick-replies/:id — deactivate rather than destroy, so history stays readable
quickRepliesRouter.delete('/:id', async (req, res) => {
    try {
        const [updated] = await db.update(quickReplies)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(quickReplies.id, req.params.id))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Quick reply not found' });
        res.json({ success: true, reply: updated });
    } catch (error: any) {
        console.error('[QuickReplies] Delete failed:', error);
        res.status(500).json({ error: 'Failed to delete quick reply' });
    }
});

// GET /api/quick-replies/preview/:id?phone=... — what would actually be sent, and in which form
quickRepliesRouter.get('/preview/:id', async (req, res) => {
    try {
        const phone = String(req.query.phone || '');
        const [reply] = await db.select().from(quickReplies).where(eq(quickReplies.id, req.params.id));
        if (!reply) return res.status(404).json({ error: 'Quick reply not found' });

        // A quick reply is a human picking a canned answer for this person, so it is a service
        // reply and a plain STOP does not block it. "Do not contact me" does.
        const { blockedByOptOut, optOutRefusalMessage } = await import('./opt-out');
        const suppression = await blockedByOptOut(phone, 'service_reply');
        if (suppression) {
            return res.status(409).json({ error: 'OPTED_OUT', message: optOutRefusalMessage(suppression) });
        }

        let contactName: string | null = null;
        let windowOpen = false;
        if (phone) {
            const [conv] = await db.select().from(conversations)
                .where(eq(conversations.phoneNumber, toConversationKey(phone)));
            contactName = conv?.contactName ?? null;
            windowOpen = await canSendFreeform(phone);
        }

        const rendered = renderQuickReply(reply.body, contactName);
        const templateBacked = !!reply.contentSid;

        res.json({
            rendered,
            contactName,
            windowOpen,
            templateBacked,
            sendable: windowOpen || templateBacked,
            mode: windowOpen ? 'freeform' : templateBacked ? 'template' : 'blocked',
        });
    } catch (error: any) {
        console.error('[QuickReplies] Preview failed:', error);
        res.status(500).json({ error: 'Failed to preview quick reply' });
    }
});

// POST /api/quick-replies/:id/send — render and send to a phone number
quickRepliesRouter.post('/:id/send', async (req, res) => {
    try {
        const { phone, via, channel } = req.body || {};
        if (!phone) return res.status(400).json({ error: "Missing 'phone'" });

        const [reply] = await db.select().from(quickReplies).where(eq(quickReplies.id, req.params.id));
        if (!reply) return res.status(404).json({ error: 'Quick reply not found' });

        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.phoneNumber, toConversationKey(phone)));
        const contactName = conv?.contactName ?? null;

        const rendered = renderQuickReply(reply.body, contactName);

        // SMS has no 24-hour window and needs no template, so an SMS quick reply is always
        // sendable — the window question below applies to WhatsApp alone.
        if (channel === 'sms') {
            const smsResult = await sendCustomerMessage({
                to: phone, body: rendered, channel: 'sms', contactName, context: `quick_reply:${reply.id}`,
                purpose: 'service_reply',
            });
            if (!smsResult.ok) return res.status(500).json({ error: smsResult.error || 'SMS send failed', rendered });
            db.update(quickReplies)
                .set({ usageCount: sql`${quickReplies.usageCount} + 1`, lastUsedAt: new Date() })
                .where(eq(quickReplies.id, reply.id))
                .catch((e) => console.warn('[QuickReplies] usage bump failed:', e));
            return res.json({ success: true, mode: 'sms', rendered, sid: smsResult.sid });
        }

        // Decide against the live window, not the denormalized conversations.can_send_freeform
        // column — that column is only refreshed on write and goes stale as the window ages out.
        const windowOpen = await canSendFreeform(phone);

        if (!windowOpen && !reply.contentSid) {
            return res.status(409).json({
                error: 'OUTSIDE_WINDOW',
                message:
                    'The 24-hour window is closed and this quick reply has no approved template behind it. ' +
                    'Use a template-backed reply, or wait for the customer to message first.',
                rendered,
            });
        }

        const transport = via === 'meta' ? 'meta' : 'twilio';
        const sendResult = await sendCustomerMessage({
            to: phone,
            body: rendered,
            purpose: 'service_reply',  // Human-initiated quick reply
            context: `quick_reply:${reply.id}`,
            contactName,
            via: transport,
            ...(windowOpen ? {} : {
                contentSid: reply.contentSid!,
                contentVariables: renderVariables(reply.contentVariables as any, contactName),
            }),
        });

        if (!sendResult.ok) {
            return res.status(500).json({
                error: sendResult.error || sendResult.reason || 'Send blocked',
                rendered,
            });
        }

        // Telemetry is best-effort — a counter must never fail a send that already went out.
        db.update(quickReplies)
            .set({ usageCount: sql`${quickReplies.usageCount} + 1`, lastUsedAt: new Date() })
            .where(eq(quickReplies.id, reply.id))
            .catch((e) => console.warn('[QuickReplies] usage bump failed:', e));

        res.json({
            success: true,
            mode: windowOpen ? 'freeform' : 'template',
            rendered,
        });
    } catch (error: any) {
        console.error('[QuickReplies] Send failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to send quick reply' });
    }
});
