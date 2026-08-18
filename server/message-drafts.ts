/**
 * Draft-and-approve: the human gate for system-originated outbound messages.
 *
 * Anything the SYSTEM composes — webform acknowledgements, post-call video requests, recovery
 * nudges — is written here as a draft. Nothing reaches a customer until a person approves it.
 * Ben's own typed replies do not pass through this; approval is for machine-authored messages.
 *
 * The reason is specific rather than theoretical: automated invoice dunning here once chased a
 * customer over an invoice that had never been sent, and had to be disabled outright. The queue
 * keeps the leverage of automation while leaving the send button with a human.
 */
import { Router } from 'express';
import { db } from './db';
import { messageDrafts, conversations, personalizedQuotes } from '@shared/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { sendWhatsAppMessage, canSendFreeform } from './meta-whatsapp';
import { normalizePhoneNumber } from './phone-utils';

export const messageDraftsRouter = Router();

export type DraftSource = 'webform_ack' | 'post_call_video' | 'recovery' | 'manual' | 'comms_agent';

/**
 * Queues a message for approval. Returns the draft id, or null if it was suppressed.
 *
 * Deliberately never sends. Callers that used to send directly should call this instead — the
 * only behavioural difference should be that a human taps approve.
 */
export async function queueDraft(input: {
    phone: string;
    body: string;
    source: DraftSource;
    reason?: string;
    contentSid?: string;
    contentVariables?: Record<string, string>;
    /** Skip if an unsent draft from the same source already exists for this number. */
    dedupe?: boolean;
}): Promise<string | null> {
    const phone = normalizePhoneNumber(input.phone);
    if (!phone) {
        console.warn('[Drafts] Refusing to queue for unparseable phone:', input.phone);
        return null;
    }

    if (input.dedupe !== false) {
        const [existing] = await db.select({ id: messageDrafts.id })
            .from(messageDrafts)
            .where(and(
                eq(messageDrafts.phone, phone),
                eq(messageDrafts.source, input.source),
                inArray(messageDrafts.status, ['pending', 'approved']),
            ))
            .limit(1);
        if (existing) {
            console.log(`[Drafts] Skipping duplicate ${input.source} draft for ${phone}`);
            return null;
        }
    }

    const convKey = `${phone.replace('+', '')}@c.us`;
    const [conv] = await db.select({ id: conversations.id })
        .from(conversations).where(eq(conversations.phoneNumber, convKey));

    const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(messageDrafts).values({
        id,
        conversationId: conv?.id ?? null,
        phone,
        body: input.body,
        channel: 'whatsapp',
        contentSid: input.contentSid ?? null,
        contentVariables: input.contentVariables ?? null,
        source: input.source,
        reason: input.reason ?? null,
        status: 'pending',
    });

    console.log(`[Drafts] Queued ${input.source} draft ${id} for ${phone}`);
    return id;
}

// GET /api/drafts — the approval queue. Pending first, newest last so it reads as a worklist.
messageDraftsRouter.get('/', async (req, res) => {
    try {
        const status = String(req.query.status || 'pending');
        const rows = await db.select().from(messageDrafts)
            .where(status === 'all' ? sql`true` : eq(messageDrafts.status, status))
            .orderBy(desc(messageDrafts.createdAt))
            .limit(200);

        // Tell the approver whether this can actually be delivered right now, rather than letting
        // them approve something the 24h window will reject.
        const enriched = await Promise.all(rows.map(async (d) => {
            const windowOpen = await canSendFreeform(d.phone).catch(() => false);
            return {
                ...d,
                windowOpen,
                sendable: windowOpen || !!d.contentSid,
                mode: windowOpen ? 'freeform' : d.contentSid ? 'template' : 'blocked',
            };
        }));

        res.json({
            drafts: enriched,
            counts: {
                pending: enriched.filter((d) => d.status === 'pending').length,
                blocked: enriched.filter((d) => d.status === 'pending' && d.mode === 'blocked').length,
            },
        });
    } catch (error: any) {
        console.error('[Drafts] List failed:', error);
        res.status(500).json({ error: 'Failed to load drafts' });
    }
});

// PATCH /api/drafts/:id — edit the wording before approving.
messageDraftsRouter.patch('/:id', async (req, res) => {
    try {
        const { body } = req.body || {};
        if (typeof body !== 'string' || !body.trim()) {
            return res.status(400).json({ error: "Missing 'body'" });
        }
        const [updated] = await db.update(messageDrafts)
            .set({ body: body.trim() })
            .where(and(eq(messageDrafts.id, req.params.id), eq(messageDrafts.status, 'pending')))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Draft not found or no longer pending' });
        res.json({ draft: updated });
    } catch (error: any) {
        console.error('[Drafts] Edit failed:', error);
        res.status(500).json({ error: 'Failed to edit draft' });
    }
});

/**
 * Approves a pending draft and sends it. The single code path behind the approve button AND the
 * agent's whitelist auto-send — both routes claim the row first so nothing can send twice.
 *
 * Returns the outcome rather than throwing on business refusals, so callers can distinguish
 * "window shut" (draft returned to pending, retryable later) from a hard send failure.
 */
export async function approveAndSendDraft(draftId: string, approvedBy: string): Promise<
    | { ok: true; draft: typeof messageDrafts.$inferSelect; mode: 'freeform' | 'template' }
    | { ok: false; code: 'NOT_PENDING' | 'OUTSIDE_WINDOW' | 'SEND_FAILED'; message: string }
> {
    // Claim the row first so a double-click (or a racing auto-send) cannot send twice.
    const [draft] = await db.update(messageDrafts)
        .set({ status: 'approved', approvedAt: new Date(), approvedBy })
        .where(and(eq(messageDrafts.id, draftId), eq(messageDrafts.status, 'pending')))
        .returning();

    if (!draft) return { ok: false, code: 'NOT_PENDING', message: 'Draft not found or already handled' };

    const windowOpen = await canSendFreeform(draft.phone).catch(() => false);
    if (!windowOpen && !draft.contentSid) {
        await db.update(messageDrafts)
            .set({ status: 'pending', approvedAt: null, approvedBy: null })
            .where(eq(messageDrafts.id, draft.id));
        return {
            ok: false,
            code: 'OUTSIDE_WINDOW',
            message: 'The 24-hour window is shut and this draft has no approved template behind it. It cannot be delivered as written.',
        };
    }

    try {
        let result: any;
        if (windowOpen) {
            // A body may contain several messages split by a lone '---' line — sent as separate
            // WhatsApp bubbles, briefly paced, because that's how a person actually texts.
            // One draft row = one approval; the split is presentation, not process.
            const parts = draft.body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 4);
            for (let i = 0; i < parts.length; i++) {
                if (i > 0) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
                result = await sendWhatsAppMessage(draft.phone, parts[i]);
            }
        } else {
            // Templates are a single fixed message — no splitting.
            result = await sendWhatsAppMessage(draft.phone, draft.body, {
                contentSid: draft.contentSid!,
                contentVariables: (draft.contentVariables as any) ?? undefined,
            });
        }

        const [sent] = await db.update(messageDrafts)
            .set({ status: 'sent', sentAt: new Date(), sentMessageId: result?.sid ?? null })
            .where(eq(messageDrafts.id, draft.id))
            .returning();

        // A draft carrying a contextual quote link (the shut-window fallback from the in-chat
        // quote card) has just delivered that quote — flip it out of draft and stage the thread,
        // exactly as a direct card send would have. Best-effort: the message is already with the
        // customer, so bookkeeping must never turn a successful send into an error.
        const quoteSlug = draft.body.match(/\/quote\/([a-z0-9]{6,12})\b/i)?.[1];
        if (quoteSlug) {
            try {
                const [flipped] = await db.update(personalizedQuotes)
                    .set({ isDraft: false })
                    .where(and(eq(personalizedQuotes.shortSlug, quoteSlug), eq(personalizedQuotes.isDraft, true)))
                    .returning({ id: personalizedQuotes.id });
                if (flipped && draft.conversationId) {
                    const [conv] = await db.select({ tags: conversations.tags }).from(conversations)
                        .where(eq(conversations.id, draft.conversationId));
                    await db.update(conversations)
                        .set({
                            stage: 'waiting',
                            tags: Array.from(new Set([...(conv?.tags ?? []), 'quote_sent'])),
                            updatedAt: new Date(),
                        })
                        .where(eq(conversations.id, draft.conversationId));
                }
            } catch (hookError: any) {
                console.warn('[Drafts] Quote-sent bookkeeping failed after send:', hookError?.message);
            }
        }

        return { ok: true, draft: sent, mode: windowOpen ? 'freeform' : 'template' };
    } catch (sendError: any) {
        // Record the failure rather than leaving it stuck as 'approved' with nothing sent.
        await db.update(messageDrafts)
            .set({ status: 'failed', error: sendError?.message ?? 'send failed' })
            .where(eq(messageDrafts.id, draft.id));
        return { ok: false, code: 'SEND_FAILED', message: sendError?.message ?? 'send failed' };
    }
}

// POST /api/drafts/:id/approve — the only path that actually sends.
messageDraftsRouter.post('/:id/approve', async (req, res) => {
    try {
        const approvedBy = (req as any).user?.email || (req as any).user?.id || 'admin';
        const result = await approveAndSendDraft(req.params.id, approvedBy);

        if (!result.ok) {
            if (result.code === 'SEND_FAILED') return res.status(500).json({ error: result.message });
            return res.status(409).json({ error: result.code === 'NOT_PENDING' ? result.message : result.code, message: result.message });
        }
        res.json({ success: true, draft: result.draft, mode: result.mode });
    } catch (error: any) {
        console.error('[Drafts] Approve failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to send draft' });
    }
});

// POST /api/drafts/:id/reject — decline without sending.
messageDraftsRouter.post('/:id/reject', async (req, res) => {
    try {
        const [updated] = await db.update(messageDrafts)
            .set({ status: 'rejected', approvedBy: (req as any).user?.email ?? 'admin', approvedAt: new Date() })
            .where(and(eq(messageDrafts.id, req.params.id), eq(messageDrafts.status, 'pending')))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Draft not found or no longer pending' });
        res.json({ success: true, draft: updated });
    } catch (error: any) {
        console.error('[Drafts] Reject failed:', error);
        res.status(500).json({ error: 'Failed to reject draft' });
    }
});
