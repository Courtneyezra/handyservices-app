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
import { canSendFreeform } from './meta-whatsapp';
import { normalizePhoneNumber, isNonMobileUkNumber } from './phone-utils';
import { sendCustomerMessage, type OutboundChannel } from './outbound';

export const messageDraftsRouter = Router();

export type DraftSource = 'webform_ack' | 'post_call_video' | 'recovery' | 'manual' | 'comms_agent' | 'first_contact_ack';

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
    /**
     * Which pipe this should leave by. Defaults to WhatsApp, which is what every existing caller
     * meant. 'sms' is for a customer who has only ever used SMS, or whose number cannot have
     * WhatsApp — approveAndSendDraft honours it and never opens the window question at all.
     */
    channel?: OutboundChannel;
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
        // A UK landline can never receive WhatsApp, so a draft for one is an SMS draft from the
        // moment it is written — the approver should see the truth, not discover it at send time.
        channel: input.channel ?? (isNonMobileUkNumber(phone) ? 'sms' : 'whatsapp'),
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
            // An SMS draft is always sendable: there is no window and no template gate on SMS.
            const smsOnly = d.channel === 'sms' || isNonMobileUkNumber(d.phone);
            const windowOpen = smsOnly ? false : await canSendFreeform(d.phone).catch(() => false);
            return {
                ...d,
                windowOpen,
                sendable: smsOnly || windowOpen || !!d.contentSid,
                mode: smsOnly ? 'sms' : windowOpen ? 'freeform' : d.contentSid ? 'template' : 'blocked',
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
    | { ok: true; draft: typeof messageDrafts.$inferSelect; mode: 'freeform' | 'template' | 'sms'; channel: OutboundChannel; fellBack: boolean }
    | { ok: false; code: 'NOT_PENDING' | 'OUTSIDE_WINDOW' | 'SEND_FAILED'; message: string }
> {
    // Claim the row first so a double-click (or a racing auto-send) cannot send twice.
    const [draft] = await db.update(messageDrafts)
        .set({ status: 'approved', approvedAt: new Date(), approvedBy })
        .where(and(eq(messageDrafts.id, draftId), eq(messageDrafts.status, 'pending')))
        .returning();

    if (!draft) return { ok: false, code: 'NOT_PENDING', message: 'Draft not found or already handled' };

    // Which pipe. An SMS draft (explicitly chosen, or a landline) skips the window question
    // entirely: Meta's 24-hour rule governs WhatsApp and nothing else, so an SMS reply is always
    // allowed. Only a WhatsApp draft can be blocked by a shut window.
    const smsOnly = draft.channel === 'sms' || isNonMobileUkNumber(draft.phone);
    const windowOpen = smsOnly ? false : await canSendFreeform(draft.phone).catch(() => false);

    if (!smsOnly && !windowOpen && !draft.contentSid) {
        await db.update(messageDrafts)
            .set({ status: 'pending', approvedAt: null, approvedBy: null })
            .where(eq(messageDrafts.id, draft.id));
        return {
            ok: false,
            code: 'OUTSIDE_WINDOW',
            message: 'The 24-hour window is shut and this draft has no approved template behind it. It cannot be delivered as written. Switch the draft to SMS, or use a template.',
        };
    }

    try {
        let result: Awaited<ReturnType<typeof sendCustomerMessage>>;
        if (smsOnly) {
            // One SMS carrying the whole reply — sendCustomerMessage rejoins the '---' bursts,
            // because on SMS each burst is a separately billed message.
            result = await sendCustomerMessage({
                to: draft.phone, body: draft.body, channel: 'sms',
                context: `draft:${draft.source}`,
            });
        } else if (windowOpen) {
            // A body may contain several messages split by a lone '---' line — sent as separate
            // WhatsApp bubbles, briefly paced, because that's how a person actually texts.
            // One draft row = one approval; the split is presentation, not process.
            //
            // Only the FIRST burst may fall back to SMS: if it did, the rest must follow it down
            // the same pipe, or the customer gets bubble one by SMS and bubble two by WhatsApp.
            const parts = draft.body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 4);
            result = await sendCustomerMessage({
                to: draft.phone, body: parts[0] ?? draft.body, context: `draft:${draft.source}`,
            });
            if (result.ok && result.channel === 'whatsapp') {
                for (let i = 1; i < parts.length; i++) {
                    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
                    const next = await sendCustomerMessage({
                        to: draft.phone, body: parts[i], context: `draft:${draft.source}`,
                        allowSmsFallback: false,   // see above: no split-brain threads
                    });
                    if (!next.ok) break;           // already alerted; the first burst did land
                    result = next;
                }
            } else if (result.ok && result.channel === 'sms' && parts.length > 1) {
                // The whole reply belongs in that one SMS, so send the remainder as one more.
                await sendCustomerMessage({
                    to: draft.phone, body: parts.slice(1).join('\n\n'), channel: 'sms',
                    context: `draft:${draft.source}`,
                });
            }
        } else {
            // Templates are a single fixed message — no splitting. The rendered body travels with
            // it so an SMS fallback has real words to send.
            result = await sendCustomerMessage({
                to: draft.phone, body: draft.body,
                contentSid: draft.contentSid!,
                contentVariables: (draft.contentVariables as any) ?? undefined,
                context: `draft:${draft.source}`,
            });
        }

        if (!result.ok) {
            // sendCustomerMessage has already alerted — nothing reached the customer by any route.
            await db.update(messageDrafts)
                .set({ status: 'failed', error: result.error ?? 'send failed on every channel' })
                .where(eq(messageDrafts.id, draft.id));
            return { ok: false, code: 'SEND_FAILED', message: result.error ?? 'send failed on every channel' };
        }

        const [sent] = await db.update(messageDrafts)
            .set({
                status: 'sent', sentAt: new Date(), sentMessageId: result.sid ?? null,
                // Record the channel that ACTUALLY carried it, not the one we intended, so the
                // thread and the draft agree about what the customer received.
                channel: result.channel ?? draft.channel,
            })
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
                            stage: 'quote_sent',
                            tags: Array.from(new Set([...(conv?.tags ?? []), 'quote_sent'])),
                            updatedAt: new Date(),
                        })
                        .where(eq(conversations.id, draft.conversationId));
                }
            } catch (hookError: any) {
                console.warn('[Drafts] Quote-sent bookkeeping failed after send:', hookError?.message);
            }
        }

        return {
            ok: true,
            draft: sent,
            mode: result.channel === 'sms' ? 'sms' : windowOpen ? 'freeform' : 'template',
            channel: result.channel ?? 'whatsapp',
            fellBack: result.fellBack,
        };
    } catch (sendError: any) {
        // sendCustomerMessage returns rather than throws for delivery problems, so reaching here
        // means something unexpected broke (a bad phone number, a DB error mid-send). Record the
        // failure rather than leaving it stuck as 'approved' with nothing sent — and alert, because
        // a 'failed' row nobody reads is the exact silence this work exists to remove.
        await db.update(messageDrafts)
            .set({ status: 'failed', error: sendError?.message ?? 'send failed' })
            .where(eq(messageDrafts.id, draft.id));
        const { notifyOutboundSendFailure } = await import('./pushover');
        await notifyOutboundSendFailure({
            phone: draft.phone,
            context: `draft:${draft.source}`,
            attempts: [{ channel: draft.channel, ok: false, error: sendError?.message }],
            recovered: false,
            body: draft.body,
        }).catch(() => { });
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
