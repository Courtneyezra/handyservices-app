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
import { messageDrafts, conversations, personalizedQuotes, messages } from '@shared/schema';
import { eq, and, desc, gte, inArray, sql } from 'drizzle-orm';
import { canSendFreeform } from './meta-whatsapp';
import { normalizePhoneNumber, isNonMobileUkNumber } from './phone-utils';
import { sendCustomerMessage, type OutboundChannel } from './outbound';
import { blockedByOptOut, optOutRefusalMessage, type OutboundPurpose } from './opt-out';
import { recordDraftProposal, recordDraftVerdict, safely } from './agent-outcomes';
import { logSystemEvent } from './system-events';
import { emitCommsEvent, type CommsEvent } from './comms-events';

/**
 * Fire-and-forget push to the live SSE stream. A UI notification must never be able to throw
 * into the business logic that produced it — the stream is a view, the DB is the truth, and a
 * missed event costs the client nothing but freshness (it refetches on reconnect anyway).
 */
function pushCommsEvent(evt: CommsEvent): void {
    try {
        emitCommsEvent(evt);
    } catch (error: any) {
        console.warn('[Drafts] comms event emit failed (send/queue stands):', error?.message);
    }
}

export const messageDraftsRouter = Router();

export type DraftSource = 'webform_ack' | 'post_call_video' | 'post_call_continuation' | 'recovery' | 'manual' | 'comms_agent' | 'first_contact_ack';

/**
 * Which draft sources count as a service reply for opt-out purposes, and which are outreach.
 *
 * One table rather than a flag on every caller, so the decision is visible in one place and cannot
 * drift call site by call site. Anything not listed here is treated as MARKETING and blocked by a
 * plain STOP — the default is refuse.
 *
 *   webform_ack        the customer just filled in our form. Answering them is service.
 *   first_contact_ack  the customer just wrote to us. Same.
 *   comms_agent        a reply drafted onto a live inbound thread. Service.
 *   manual             a human composed it about a specific job. Service.
 *
 * NOT listed, therefore blocked by a plain STOP:
 *   post_call_video    we decided to ask for something after a call. Outreach.
 *   post_call_continuation  same family: we chose to message after a call ended. Outreach.
 *   recovery           chasing a quote that went quiet. Outreach — this is the one PECR is about.
 *
 * None of this gets past an 'all' ("do not contact") suppression; that blocks every source.
 */
const SERVICE_DRAFT_SOURCES = new Set<DraftSource>(['webform_ack', 'first_contact_ack', 'comms_agent', 'manual']);

export function purposeForDraftSource(source: DraftSource): OutboundPurpose {
    return SERVICE_DRAFT_SOURCES.has(source) ? 'service_reply' : 'marketing';
}

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
    /**
     * Caller-supplied draft id, for paths that need a DETERMINISTIC one ("one draft per call,
     * ever" — the post-call continuation derives it from the call record id, mirroring the
     * `call_<id>` message-id pattern). The insert's primary-key constraint then makes replays a
     * hard no-op instead of a race. Leave unset for the normal timestamped id.
     */
    id?: string;
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
    /**
     * Override the source's default purpose. Rarely needed — the source table above is the right
     * place for a standing decision. Present so a caller with genuine context (a booking
     * confirmation queued as 'manual', say) can be explicit.
     */
    purpose?: OutboundPurpose;
}): Promise<string | null> {
    const phone = normalizePhoneNumber(input.phone);
    if (!phone) {
        console.warn('[Drafts] Refusing to queue for unparseable phone:', input.phone);
        return null;
    }

    // Refuse at the door. A suppressed contact must not even reach the approval queue: a pending
    // draft is a send waiting for one distracted click, and "Ben approved it" is not a defence
    // against a PECR complaint. Checked again at approve time, because a customer can opt out in
    // the hours between a draft being written and someone reading it.
    const purpose = input.purpose ?? purposeForDraftSource(input.source);
    const suppression = await blockedByOptOut(phone, purpose);
    if (suppression) {
        console.warn(
            `[Drafts] Refusing to queue a ${input.source} draft for ${phone}: ` +
            `opted out (${suppression.scope}) on ${suppression.at.toISOString()}`,
        );
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

    const id = input.id ?? `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (input.id) {
        // A deterministic id means "this exact draft may only ever exist once" — in ANY status.
        // The source dedupe above only sees pending/approved; a sent or rejected row must also
        // block a replay, or a re-ingested call would message the customer twice.
        const [prior] = await db.select({ id: messageDrafts.id })
            .from(messageDrafts).where(eq(messageDrafts.id, id)).limit(1);
        if (prior) {
            console.log(`[Drafts] Skipping duplicate deterministic draft ${id}`);
            return null;
        }
    }
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

    // OUTCOME LEDGER — freeze the proposal as written, before anyone can edit it.
    //
    // This has to happen HERE and not at approval time: PATCH /api/drafts/:id rewrites `body` in
    // place, so by the time a human approves, the agent's original wording no longer exists
    // anywhere. Capturing it at the choke point also means an agent author cannot forget to.
    // Fire-and-forget: a bookkeeping failure must never cost a customer their reply.
    safely('recordDraftProposal', () => recordDraftProposal({
        draftId: id,
        conversationId: conv?.id ?? null,
        phone,
        body: input.body,
        source: input.source,
        reason: input.reason ?? null,
    }));

    console.log(`[Drafts] Queued ${input.source} draft ${id} for ${phone}`);
    pushCommsEvent({ type: 'draft_delta', draftId: id, conversationId: conv?.id ?? undefined, status: 'pending', at: new Date().toISOString() });
    void logSystemEvent({
        kind: 'hold',
        phone,
        conversationId: conv?.id ?? null,
        summary: input.reason?.trim() || `${input.source} draft held for approval`,
        detail: { draftId: id, source: input.source },
        source: 'message-drafts',
    });
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
        pushCommsEvent({ type: 'draft_delta', draftId: updated.id, conversationId: updated.conversationId ?? undefined, status: 'edited', at: new Date().toISOString() });
        res.json({ draft: updated });
    } catch (error: any) {
        console.error('[Drafts] Edit failed:', error);
        res.status(500).json({ error: 'Failed to edit draft' });
    }
});

// ------------------------------------------------------------------ 27 Aug 2026 autosend guards
//
// On 27 Aug 2026 (conv b57b6790401ff28a3db04d58ff1e366f, +447950552830, "James") three agent runs
// fired within 40 seconds and each auto-sent: the customer received "sorry for the wait on this
// one" twice in 15 seconds and a third redundant variant a minute later, all approved_by
// comms_agent:autosend. The run-claim race is fixed at its source in comms-sweep.ts, but this is
// the queue exit — EVERY automated send passes through here, so this is where "never say the same
// thing twice in ten minutes" and "never auto-send a malformed run's draft" are enforced,
// whichever trigger path produced the draft.

/** Approvers that are code, not people. A block here reverts to pending for a human; a human
 *  approver is looking at the thread and may deliberately repeat themselves. */
const AUTOMATED_APPROVER = /^(comms_agent|hours_gate|first_contact_ack):/;

/** Stable markers appended to `reason` when an autosend is held. The timed releases in
 *  comms-sweep.ts skip drafts carrying these, so a held draft cannot re-enter the 15s release
 *  loop — it waits for a person. */
export const NEAR_DUPLICATE_HOLD_MARKER = '[near_duplicate_hold]';
export const MALFORMED_REASON_HOLD_MARKER = '[malformed_reason_hold]';

/**
 * A reason that reads as a broken agent run. Draft 1 of the 27 Aug incident carried
 * "[answer_question] placeholder" and draft 3 "[unlabelled] undefined" — both templates' failure
 * modes, not judgements, and neither should ever have licensed an automatic send.
 */
export function isMalformedAgentReason(reason: string | null | undefined): boolean {
    const raw = (reason ?? '').trim();
    if (!raw) return true;
    if (/\[unlabelled\]/i.test(raw)) return true;
    // Strip the leading "[intent]" tag; what remains must be a real sentence, not a stub.
    const rest = raw.replace(/^\[[^\]]*\]\s*/, '').trim();
    if (!rest) return true;
    return /\b(placeholder|undefined|null)\b/i.test(rest);
}

/** Lowercase, punctuation and whitespace collapsed — the comparison a customer's eyes make. */
function normalizeForDupCheck(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Exact normalized match, or token overlap >= 0.9 against the LARGER of the two sets — strict
 * enough that "sorry for the wait" vs "thanks for your patience" stays distinct, loose enough
 * that a re-worded copy of the same sentence is still caught. No dependencies on purpose.
 */
export function isNearDuplicateText(a: string, b: string): boolean {
    const na = normalizeForDupCheck(a);
    const nb = normalizeForDupCheck(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = new Set(na.split(' '));
    const tb = new Set(nb.split(' '));
    let common = 0;
    for (const t of ta) if (tb.has(t)) common++;
    return common / Math.max(ta.size, tb.size) >= 0.9;
}

/** How far back an outbound message still makes a repeat of itself redundant. */
const NEAR_DUPLICATE_WINDOW_MINUTES = 10;

/**
 * Approves a pending draft and sends it. The single code path behind the approve button AND the
 * agent's whitelist auto-send — both routes claim the row first so nothing can send twice.
 *
 * Returns the outcome rather than throwing on business refusals, so callers can distinguish
 * "window shut" (draft returned to pending, retryable later) from a hard send failure.
 */
export async function approveAndSendDraft(draftId: string, approvedBy: string): Promise<
    | { ok: true; draft: typeof messageDrafts.$inferSelect; mode: 'freeform' | 'template' | 'sms'; channel: OutboundChannel; fellBack: boolean }
    | { ok: false; code: 'NOT_PENDING' | 'OUTSIDE_WINDOW' | 'SEND_FAILED' | 'OPTED_OUT' | 'NEAR_DUPLICATE' | 'MALFORMED_REASON'; message: string }
> {
    // Claim the row first so a double-click (or a racing auto-send) cannot send twice.
    const [draft] = await db.update(messageDrafts)
        .set({ status: 'approved', approvedAt: new Date(), approvedBy })
        .where(and(eq(messageDrafts.id, draftId), eq(messageDrafts.status, 'pending')))
        .returning();

    if (!draft) return { ok: false, code: 'NOT_PENDING', message: 'Draft not found or already handled' };

    // Re-check the suppression list at send time, not just at queue time. A draft can sit in the
    // queue for hours, and the customer may have said STOP in the meantime — that is exactly the
    // window in which a campaign reply arrives. sendCustomerMessage would refuse anyway; catching
    // it here gives the approver a real reason instead of a generic send failure, and kills the
    // draft rather than leaving it to be retried.
    const suppression = await blockedByOptOut(draft.phone, purposeForDraftSource(draft.source as DraftSource));
    if (suppression) {
        await db.update(messageDrafts)
            .set({ status: 'rejected', error: `opted out (${suppression.scope}) on ${suppression.at.toISOString()}` })
            .where(eq(messageDrafts.id, draft.id));
        console.warn(`[Drafts] Refused to send draft ${draft.id} to ${draft.phone}: opted out (${suppression.scope})`);
        // Recorded as 'blocked', not 'rejected': the system refused it, no human judged the wording.
        safely('recordDraftVerdict:blocked', () => recordDraftVerdict({
            draftId: draft.id, outcome: 'blocked', decidedBy: approvedBy,
        }));
        pushCommsEvent({ type: 'draft_delta', draftId: draft.id, conversationId: draft.conversationId ?? undefined, status: 'blocked', at: new Date().toISOString() });
        return { ok: false, code: 'OPTED_OUT', message: optOutRefusalMessage(suppression) };
    }

    // -------------------------------------------------------- 27 Aug 2026 autosend-only guards
    //
    // Both guards below revert to PENDING rather than reject (the OUTSIDE_WINDOW pattern): the
    // system refused to send this by itself, but the words may still be right — a human can read
    // the thread and decide. The ledger records the refusal as 'blocked' (the same shape as the
    // opt-out refusal above); if a human later approves, their verdict overwrites it.
    const automatedApprover = AUTOMATED_APPROVER.test(approvedBy);
    const holdForHuman = async (marker: string, note: string) => {
        // The note is appended once — a draft that keeps tripping the guard must not grow its
        // reason on every pass.
        const alreadyMarked = (draft.reason ?? '').includes(marker);
        await db.update(messageDrafts)
            .set({
                status: 'pending', approvedAt: null, approvedBy: null,
                ...(alreadyMarked ? {} : { reason: `${draft.reason ?? ''} ${marker} ${note}`.trim() }),
            })
            .where(eq(messageDrafts.id, draft.id));
        safely('recordDraftVerdict:blocked', () => recordDraftVerdict({
            draftId: draft.id, outcome: 'blocked', decidedBy: approvedBy,
        }));
        void logSystemEvent({
            kind: 'hold',
            phone: draft.phone,
            conversationId: draft.conversationId,
            summary: `Autosend blocked: ${note}`,
            detail: { draftId: draft.id, by: approvedBy, marker },
            source: 'message-drafts',
        });
        pushCommsEvent({ type: 'draft_delta', draftId: draft.id, conversationId: draft.conversationId ?? undefined, status: 'blocked', at: new Date().toISOString() });
    };

    // A malformed reason means a malformed RUN — the agent that wrote this draft did not know why
    // it was writing it, and "why" is exactly what an automatic approval is trusting. Draft 1 and
    // draft 3 of the triple-send both carried stub reasons; either being held here would have
    // turned three sends into one.
    if (automatedApprover && isMalformedAgentReason(draft.reason)) {
        console.warn(`[Drafts] Refused autosend of ${draft.id}: malformed reason ${JSON.stringify(draft.reason)}`);
        await holdForHuman(MALFORMED_REASON_HOLD_MARKER, 'the agent run gave no usable reason for this draft — held for human review');
        return { ok: false, code: 'MALFORMED_REASON', message: 'Draft reason is malformed (empty/placeholder), so it cannot auto-send. Held pending for human review.' };
    }

    // Near-duplicate of something we JUST said. Compared per burst part, because draft 2 of the
    // triple-send was a 3-part burst whose first bubble repeated draft 1's send verbatim — the
    // whole-body comparison would have missed it.
    if (draft.conversationId) {
        const windowStart = new Date(Date.now() - NEAR_DUPLICATE_WINDOW_MINUTES * 60_000);
        const recentOutbound = await db.select({ content: messages.content, createdAt: messages.createdAt })
            .from(messages)
            .where(and(
                eq(messages.conversationId, draft.conversationId),
                eq(messages.direction, 'outbound'),
                gte(messages.createdAt, windowStart),
            ))
            .limit(50);
        const parts = draft.body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean);
        const dupPart = parts.find((p) =>
            recentOutbound.some((m) => !!m.content && isNearDuplicateText(p, m.content)));
        if (dupPart) {
            if (automatedApprover) {
                console.warn(`[Drafts] Refused autosend of ${draft.id}: near-duplicate of an outbound sent within ${NEAR_DUPLICATE_WINDOW_MINUTES} min ("${dupPart.slice(0, 60)}")`);
                await holdForHuman(NEAR_DUPLICATE_HOLD_MARKER, `repeats an outbound message from the last ${NEAR_DUPLICATE_WINDOW_MINUTES} min — held for human review`);
                return { ok: false, code: 'NEAR_DUPLICATE', message: 'Draft repeats a message the customer already received minutes ago, so it cannot auto-send. Held pending for human review.' };
            }
            // A human clicked approve with the thread in front of them — repeating yourself on
            // purpose is a thing people legitimately do. Logged so the choice is visible.
            console.log(`[Drafts] ${approvedBy} approved ${draft.id} despite a near-duplicate outbound in the last ${NEAR_DUPLICATE_WINDOW_MINUTES} min — human override allowed.`);
        }
    }

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

    // Every send below carries the draft source's purpose, so the choke point in outbound.ts
    // reaches the same verdict this function just did rather than second-guessing it.
    const purpose = purposeForDraftSource(draft.source as DraftSource);

    try {
        let result: Awaited<ReturnType<typeof sendCustomerMessage>>;
        if (smsOnly) {
            // One SMS carrying the whole reply — sendCustomerMessage rejoins the '---' bursts,
            // because on SMS each burst is a separately billed message.
            result = await sendCustomerMessage({
                to: draft.phone, body: draft.body, channel: 'sms',
                context: `draft:${draft.source}`, purpose,
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
                to: draft.phone, body: parts[0] ?? draft.body, context: `draft:${draft.source}`, purpose,
            });
            if (result.ok && result.channel === 'whatsapp') {
                for (let i = 1; i < parts.length; i++) {
                    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
                    const next = await sendCustomerMessage({
                        to: draft.phone, body: parts[i], context: `draft:${draft.source}`, purpose,
                        allowSmsFallback: false,   // see above: no split-brain threads
                    });
                    if (!next.ok) break;           // already alerted; the first burst did land
                    result = next;
                }
            } else if (result.ok && result.channel === 'sms' && parts.length > 1) {
                // The whole reply belongs in that one SMS, so send the remainder as one more.
                await sendCustomerMessage({
                    to: draft.phone, body: parts.slice(1).join('\n\n'), channel: 'sms',
                    context: `draft:${draft.source}`, purpose,
                });
            }
        } else {
            // Templates are a single fixed message — no splitting. The rendered body travels with
            // it so an SMS fallback has real words to send.
            result = await sendCustomerMessage({
                to: draft.phone, body: draft.body,
                contentSid: draft.contentSid!,
                contentVariables: (draft.contentVariables as any) ?? undefined,
                context: `draft:${draft.source}`, purpose,
            });
        }

        if (!result.ok) {
            // sendCustomerMessage has already alerted — nothing reached the customer by any route.
            await db.update(messageDrafts)
                .set({ status: 'failed', error: result.error ?? 'send failed on every channel' })
                .where(eq(messageDrafts.id, draft.id));
            // The approval still happened and is still a judgement on the wording — send_status
            // carries the delivery failure separately, so a broken pipe cannot look like a
            // rejected draft in the trust metrics.
            safely('recordDraftVerdict:failed', () => recordDraftVerdict({
                draftId: draft.id, outcome: 'approved', decidedBy: approvedBy,
                finalBody: draft.body, sendStatus: 'failed',
            }));
            void logSystemEvent({
                kind: 'delivery_fail',
                phone: draft.phone,
                conversationId: draft.conversationId,
                summary: `Approved draft failed on every channel: ${result.error ?? 'send failed'}`,
                detail: { by: approvedBy, channel: draft.channel, draftId: draft.id },
                source: 'message-drafts',
            });
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

        // OUTCOME LEDGER — the verdict. `draft.body` here is the text as it actually went out,
        // carrying whatever the approver changed; the ledger holds the agent's original, so the
        // diff between them is the training signal. `approvedBy` distinguishes a human approval
        // from the agent auto-sending itself, which must never count toward the trust ladder.
        safely('recordDraftVerdict:sent', () => recordDraftVerdict({
            draftId: draft.id, outcome: 'approved', decidedBy: approvedBy,
            finalBody: draft.body, sendStatus: 'sent',
            sentAt: sent?.sentAt ?? new Date(), sentMessageId: result.sid ?? null,
        }));
        void logSystemEvent({
            kind: 'send',
            phone: draft.phone,
            conversationId: draft.conversationId,
            summary: draft.body.slice(0, 80),
            detail: { by: approvedBy, channel: result.channel ?? draft.channel, draftId: draft.id },
            source: 'message-drafts',
        });
        pushCommsEvent({ type: 'draft_delta', draftId: draft.id, conversationId: draft.conversationId ?? undefined, status: 'sent', at: new Date().toISOString() });
        if (draft.conversationId) {
            pushCommsEvent({ type: 'board_delta', conversationId: draft.conversationId, reason: 'outbound', at: new Date().toISOString() });
        }

        // Beta read-along ping for sends released OUTSIDE an agent run (Ben approving, the
        // first-contact ack, sweeps). Agent autosends are excluded here — the run-completion
        // ping in comms.ts already reports those, and one action must not buzz twice.
        if (!approvedBy.startsWith('comms_agent') && draft.conversationId) {
            void (async () => {
                const { notifyCommsBeta } = await import('./pushover');
                await notifyCommsBeta({
                    conversationId: draft.conversationId!,
                    phoneNumber: draft.phone,
                    headline: `Message sent (${approvedBy.split('@')[0]})`,
                    detail: [draft.body.slice(0, 200)],
                });
            })().catch((e) => console.warn('[MessageDrafts] beta ping failed:', e?.message));
        }

        // A SENT promise is a debt with a timer, whoever released it (27 Aug 2026, James: held
        // drafts carrying "I'll come back to you" started no timer when a person approved them,
        // so the promise-tracker only saw agent autosends). comms_agent approvers are excluded
        // here for the same reason as the ping above — comms.ts records those itself, and one
        // promise must not be booked twice. Best-effort: never breaks a completed send.
        if (!approvedBy.startsWith('comms_agent') && draft.conversationId) {
            void import('./agents/promise-tracker')
                .then((m) => m.recordOutboundCommitment({ conversationId: draft.conversationId!, body: draft.body }))
                .catch((e) => console.warn('[MessageDrafts] commitment recording failed (send stands):', e?.message));
        }

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
                if (flipped) {
                    // Same supersede contract as the direct send: the replacement just reached the
                    // customer, so the quote it regenerated (if any) is revoked now.
                    const { revokeSupersededQuote } = await import('./agent-staff');
                    await revokeSupersededQuote(flipped.id);
                }
                if (flipped && draft.conversationId) {
                    const [conv] = await db.select({ tags: conversations.tags }).from(conversations)
                        .where(eq(conversations.id, draft.conversationId));
                    // Same tag retirement as finalizeQuoteSent: the send completes Ben's move, so
                    // the desk tags come off with it.
                    const { RETIRED_ON_QUOTE_SENT } = await import('./agent-staff');
                    const kept = (conv?.tags ?? []).filter((t) => !RETIRED_ON_QUOTE_SENT.includes(t));
                    await db.update(conversations)
                        .set({
                            stage: 'quote_sent',
                            tags: Array.from(new Set([...kept, 'quote_sent'])),
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
        safely('recordDraftVerdict:threw', () => recordDraftVerdict({
            draftId: draft.id, outcome: 'approved', decidedBy: approvedBy,
            finalBody: draft.body, sendStatus: 'failed',
        }));
        void logSystemEvent({
            kind: 'delivery_fail',
            phone: draft.phone,
            conversationId: draft.conversationId,
            summary: `Approved draft threw mid-send: ${sendError?.message ?? 'send failed'}`,
            detail: { by: approvedBy, channel: draft.channel, draftId: draft.id },
            source: 'message-drafts',
        });
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
            // OPTED_OUT is a 409 like the window refusal: the request was well-formed, the state
            // says no. The message is the one the approver needs to read.
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
        const rejectedBy = (req as any).user?.email ?? 'admin';
        const [updated] = await db.update(messageDrafts)
            .set({ status: 'rejected', approvedBy: rejectedBy, approvedAt: new Date() })
            .where(and(eq(messageDrafts.id, req.params.id), eq(messageDrafts.status, 'pending')))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Draft not found or no longer pending' });
        // A rejection is the loudest signal the ledger gets — a human read the agent's words and
        // decided none of them should reach the customer.
        safely('recordDraftVerdict:rejected', () => recordDraftVerdict({
            draftId: updated.id, outcome: 'rejected', decidedBy: rejectedBy,
        }));
        pushCommsEvent({ type: 'draft_delta', draftId: updated.id, conversationId: updated.conversationId ?? undefined, status: 'rejected', at: new Date().toISOString() });
        res.json({ success: true, draft: updated });
    } catch (error: any) {
        console.error('[Drafts] Reject failed:', error);
        res.status(500).json({ error: 'Failed to reject draft' });
    }
});
