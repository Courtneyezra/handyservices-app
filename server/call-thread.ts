/**
 * Phone calls as first-class comms-board activity.
 *
 * Before this module, a call existed only in the `calls` table. The board reads `messages` for
 * everything it shows — the channel icons, the preview line, the SLA clock, the "unanswered"
 * headline — so a person who only ever phoned us rendered as a blank card with no wait badge, or
 * (for 180-odd callers) as no card at all. A missed call is the single most urgent thing that can
 * arrive, and it was the one thing the board could not see.
 *
 * The fix is deliberately boring: every call also gets written into the thread as a message row
 * with `channel = 'call'`. Nothing else has to learn about calls. Previews, icons, SLA, the sweeps
 * and the comms agent all inherit the behaviour they already have for messages.
 *
 * Three rules this module must never break:
 *
 *   1. A CALL DOES NOT OPEN THE WHATSAPP WINDOW. `conversations.lastInboundAt` is WhatsApp-window
 *      semantics only (see the comment on the column in shared/schema.ts). Touching it here would
 *      make the app believe it can send freeform and get rejected with error 63016. Ageing goes on
 *      `lastCustomerContactAt`, which is the any-channel clock the board already reads.
 *   2. NO DUPLICATES IN THE THREAD. The thread endpoint already merges the richer `calls` rows into
 *      the timeline. The message row carries a deterministic id (`call_<callRecordId>`) so both the
 *      board endpoint and the comms agent can drop the message copy and keep the call event.
 *   3. IDEMPOTENT. finalizeCall runs more than once for some calls (status callback plus the
 *      call-ended redirect), and the backfill re-runs over history. Writing twice must be a no-op,
 *      so the second write updates the existing row rather than inserting another.
 */
import { db } from './db';
import { calls, conversations, messages } from '@shared/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { stageAfterInbound } from './conversation-stage';
import type { FirstContactAckResult } from './first-contact-ack';

type CallRow = typeof calls.$inferSelect;

// ---------------------------------------------------------------- identity

/** Deterministic message id for a call, so a re-run updates rather than duplicates. */
export function callMessageId(callRecordId: string): string {
    return `call_${callRecordId}`;
}

/** True for a message row this module wrote — the thread uses it to prefer the richer call event. */
export function isCallMessageId(id: string | null | undefined): boolean {
    return typeof id === 'string' && id.startsWith('call_');
}

// ---------------------------------------------------------------- eligibility

/**
 * Why this call must not become thread activity, or null when it may.
 *
 * `anonymous` is a real value in this table (27 rows): a withheld caller has no thread to belong to
 * and creating one would produce a card nobody can ever reply to. Test numbers are skipped for the
 * backfill only — the live path deliberately accepts them so the Ofcom range can exercise this code
 * without touching a customer.
 */
export function callThreadSkipReason(
    phoneNumber: string | null | undefined,
    opts: { skipTestNumbers?: boolean } = {},
): string | null {
    const raw = (phoneNumber ?? '').trim();
    if (!raw) return 'NO_NUMBER';
    if (/^(anonymous|unknown|private|restricted|withheld|blocked|unavailable)$/i.test(raw)) return 'WITHHELD';
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7) return 'UNUSABLE_NUMBER';
    if (opts.skipTestNumbers && digits.includes('7700900')) return 'TEST_NUMBER';
    return null;
}

// ---------------------------------------------------------------- the human line

/** Seconds as "18s" / "4m 12s". Raw seconds on a card read as noise. */
function formatDuration(seconds: number | null | undefined): string {
    const s = Math.max(0, Math.round(seconds ?? 0));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Filler that must never reach a card.
 *
 * `calls.jobSummary` is not always a summary. Three things write it: the AI summariser (which
 * writes a sentence even when the transcript said nothing, "Unable to extract job description"),
 * the template variable filler ("the job we discussed", 737 rows), and the Twilio log importer
 * ("Recovered from Twilio Logs", 50 rows). A preview of "the job we discussed" on 737 cards is
 * worse than no preview at all, because it looks like real content and hides the ones that are.
 */
const FILLER_SUMMARY = [
    /^(unable to|could not|couldn't|insufficient|not enough)/i,
    /^i (cannot|can't|could not|couldn't|am unable|was unable)/i,   // the summariser writing in first person
    /^no\b/i,                                   // "No job description provided.", "No specific job mentioned"
    /^the job we discussed\.?$/i,               // template variable, not a summary
    /^recovered from twilio logs\.?$/i,         // importer marker
];

function usableSummary(jobSummary: string | null | undefined): string | null {
    const s = (jobSummary ?? '').trim();
    if (!s) return null;
    if (FILLER_SUMMARY.some((re) => re.test(s))) return null;
    return s.split(/\n\s*\n/)[0].trim().slice(0, 300) || null;
}

export type CallDescriptor = {
    /** True when nobody actually spoke to them. Drives both the wording and the ack. */
    missed: boolean;
    direction: 'inbound' | 'outbound';
    /** One line, board-preview length. */
    preview: string;
    /** The AI job summary when it says something, else null. */
    summary: string | null;
};

/**
 * Was this call actually answered?
 *
 * Reads the explicit signals only. `missedReason = 'no_answer'` alone is NOT missed: it means the
 * VA did not pick up and the AI agent took it instead, which is a handled call, and treating those
 * as missed would fire a "sorry we missed you" at someone we just spoke to.
 */
function isMissedCall(call: Pick<CallRow, 'status' | 'outcome' | 'handledBy' | 'duration'>): boolean {
    const status = (call.status ?? '').toLowerCase();
    if (['no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(status)) return true;
    if ((call.outcome ?? '').toUpperCase() === 'MISSED_CALL') return true;
    if (['missed', 'voicemail'].includes((call.handledBy ?? '').toLowerCase())) return true;
    // Never connected and never finalized (the 'ringing' rows) — nobody spoke to them.
    if (status === 'ringing' && !call.duration) return true;
    return false;
}

/** The line the board shows and the message row stores. Brand voice: plain, no em dashes. */
export function describeCall(call: Pick<CallRow,
    'direction' | 'status' | 'outcome' | 'handledBy' | 'duration' | 'ringSeconds' | 'jobSummary'>
): CallDescriptor {
    const direction: 'inbound' | 'outbound' = (call.direction ?? '').startsWith('out') ? 'outbound' : 'inbound';
    const missed = isMissedCall(call);
    const summary = usableSummary(call.jobSummary);

    if (direction === 'outbound') {
        return {
            missed, direction, summary,
            preview: missed
                ? 'Outbound call, no answer'
                : `Outbound call (${formatDuration(call.duration)})`,
        };
    }

    if (missed) {
        // Ring time is the honest number for a call nobody answered; duration is the fallback.
        const rang = call.ringSeconds ?? call.duration ?? null;
        return {
            missed, direction, summary,
            preview: rang ? `Missed call (${formatDuration(rang)})` : 'Missed call',
        };
    }

    const head = `Inbound call (${formatDuration(call.duration)})`;
    return { missed, direction, summary, preview: summary ? `${head}: ${summary}` : head };
}

// ---------------------------------------------------------------- ingest

export type CallThreadResult = {
    status: 'written' | 'updated' | 'skipped';
    /** Machine-readable, always present — the audit trail for "why is this call not on the board?". */
    reason: string;
    conversationId?: string;
    conversationCreated?: boolean;
    messageId?: string;
    preview?: string;
    missed?: boolean;
    /** Present only when the ack lane ran (live path, inbound, missed). */
    ack?: FirstContactAckResult | { sent: false; reason: string };
};

export interface IngestCallOptions {
    /** Create a conversation when the caller has none. Inbound only; outbound never opens a card. */
    createConversation?: boolean;
    /** Backfill passes true so smoke numbers stay out of history. Live ingest passes false. */
    skipTestNumbers?: boolean;
    /** Bump the unread badge. True on the live path, false for the backfill. */
    markUnread?: boolean;
    /** Run the first-contact acknowledgement lane. Live path only; never the backfill. */
    ack?: boolean;
    /**
     * Move the funnel stage the way an inbound message does. True on the live path. The backfill
     * passes false: a thread Ben closed in March should not reopen because we are only now writing
     * down the call that ended it.
     */
    advanceStage?: boolean;
    /** Report what would happen and write nothing. */
    dryRun?: boolean;
}

/**
 * Put one call on the board. Never throws: this runs inside call finalization and a comms feature
 * must not be able to break telephony.
 */
export async function ingestCallIntoThread(
    callRecordId: string,
    opts: IngestCallOptions = {},
): Promise<CallThreadResult> {
    try {
        const [call] = await db.select().from(calls).where(eq(calls.id, callRecordId)).limit(1);
        if (!call) return { status: 'skipped', reason: 'NO_CALL_RECORD' };
        return await ingestCallRow(call, opts);
    } catch (error: any) {
        console.error(`[CallThread] Ingest failed for ${callRecordId}:`, error?.message ?? error);
        return { status: 'skipped', reason: 'ERROR' };
    }
}

/** Same as ingestCallIntoThread but for a row already in hand (the backfill reads in batches). */
export async function ingestCallRow(call: CallRow, opts: IngestCallOptions = {}): Promise<CallThreadResult> {
    const skip = callThreadSkipReason(call.phoneNumber, { skipTestNumbers: opts.skipTestNumbers });
    if (skip) return { status: 'skipped', reason: skip };

    const digits = (call.phoneNumber ?? '').replace(/\D/g, '');
    const info = describeCall(call);
    const at = call.startTime ?? call.endTime ?? new Date();
    const createConversation = opts.createConversation ?? (info.direction === 'inbound');

    // The message id is derived from the call id alone, so "have we already done this one?" is
    // answerable before we know anything about the conversation — which is what lets --dry-run
    // report exact would-write counts without touching a row.
    const messageId = callMessageId(call.id);
    const content = info.summary && !info.preview.includes(info.summary)
        ? `${info.preview}\n${info.summary}`
        : info.preview;
    const [existing] = await db.select({ id: messages.id, content: messages.content })
        .from(messages).where(eq(messages.id, messageId)).limit(1);

    // --- 1. the thread it belongs to -------------------------------------------------
    let [conv] = await db.select().from(conversations)
        .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);

    let conversationCreated = false;
    if (!conv) {
        if (!createConversation) return { status: 'skipped', reason: 'NO_CONVERSATION' };
        if (opts.dryRun) {
            return {
                status: existing ? 'updated' : 'written',
                reason: existing ? 'DRY_RUN_WOULD_UPDATE' : 'DRY_RUN_WOULD_WRITE',
                conversationCreated: true, messageId,
                preview: info.preview, missed: info.missed,
            };
        }

        const name = (call.customerName ?? '').trim();
        const realName = name && !/^(unknown( caller)?|voice caller|caller|customer|test)$/i.test(name) ? name : null;

        await db.insert(conversations).values({
            id: crypto.randomBytes(16).toString('hex'),
            phoneNumber: `${digits}@c.us`,
            contactName: realName,
            status: 'active',
            stage: 'enquiry',
            unreadCount: opts.markUnread ? 1 : 0,
            lastMessageAt: at,
            lastMessagePreview: info.preview,
            // NOT lastInboundAt: a call does not open WhatsApp's 24h freeform window.
            lastCustomerContactAt: info.direction === 'inbound' ? at : null,
        }).onConflictDoNothing({ target: conversations.phoneNumber });

        [conv] = await db.select().from(conversations)
            .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
            .limit(1);
        if (!conv) return { status: 'skipped', reason: 'CONVERSATION_INSERT_FAILED' };
        conversationCreated = true;
    }

    // --- 2. the message row ----------------------------------------------------------
    if (opts.dryRun) {
        return {
            status: existing ? 'updated' : 'written',
            reason: existing ? 'DRY_RUN_WOULD_UPDATE' : 'DRY_RUN_WOULD_WRITE',
            conversationId: conv.id, conversationCreated, messageId,
            preview: info.preview, missed: info.missed,
        };
    }

    if (existing) {
        // A call is written at ringing time and rewritten at finalization, when we finally know the
        // duration and whether anyone answered. Same row, better words.
        if (existing.content !== content) {
            await db.update(messages).set({ content }).where(eq(messages.id, messageId));
        }
    } else {
        await db.insert(messages).values({
            id: messageId,
            conversationId: conv.id,
            direction: info.direction,
            content,
            type: 'text',
            channel: 'call',
            // A connected call is as delivered as a message ever gets.
            status: 'delivered',
            senderName: info.direction === 'inbound' ? (call.customerName ?? null) : 'Handy Services',
            createdAt: at,
        }).onConflictDoNothing({ target: messages.id });
    }

    // --- 3. the conversation's own clocks --------------------------------------------
    // Only advance them when this call really is the newest thing on the thread, so replaying old
    // calls during a backfill cannot drag a live conversation's preview backwards.
    //
    // Measured against the newest MESSAGE, not against conversations.lastMessageAt. That column is
    // a cache several code paths write loosely: the post-call agentic analysis, for instance, sets
    // it minutes after the call it is describing, which would make every call look older than the
    // thread it belongs to and leave "[Agent Plan] request_video" on the card forever.
    const [newestOther] = await db
        .select({ at: sql<string | null>`max(${messages.createdAt})` })
        .from(messages)
        .where(and(eq(messages.conversationId, conv.id), ne(messages.id, messageId)));
    const newestOtherAt = newestOther?.at ? new Date(newestOther.at) : null;
    const isNewest = newestOtherAt ? at >= newestOtherAt : true;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (isNewest) {
        patch.lastMessageAt = at;
        patch.lastMessagePreview = info.preview;
        // A customer ringing is a customer speaking, so the funnel moves exactly as it does for an
        // inbound message: a closed thread reopens as an enquiry, everything else keeps its place.
        if (info.direction === 'inbound' && (opts.advanceStage ?? true)) {
            patch.stage = stageAfterInbound(conv.stage);
        }
    }
    if (info.direction === 'inbound'
        && (!conv.lastCustomerContactAt || at > new Date(conv.lastCustomerContactAt))) {
        patch.lastCustomerContactAt = at;
    }
    if (opts.markUnread && info.direction === 'inbound' && !existing) {
        patch.unreadCount = (conv.unreadCount ?? 0) + 1;
    }
    // Deliberately absent: lastInboundAt, canSendFreeform, templateRequired. See the file header.
    await db.update(conversations).set(patch).where(eq(conversations.id, conv.id));

    const result: CallThreadResult = {
        status: existing ? 'updated' : 'written',
        reason: existing ? 'UPDATED' : 'WRITTEN',
        conversationId: conv.id,
        conversationCreated,
        messageId,
        preview: info.preview,
        missed: info.missed,
    };

    // --- 4. the first-contact acknowledgement ----------------------------------------
    if (opts.ack && info.direction === 'inbound' && !existing) {
        result.ack = await ackForCall(conv.id, `+${digits}`, call, info);
    }

    return result;
}

/**
 * Context-aware first contact on the phone.
 *
 *   missed   -> "sorry we missed your call, we'll ring you back". The only honest thing to say to
 *               someone whose call nobody picked up.
 *   answered -> nothing here. We spoke to them, and the post-call video request
 *               (server/post-call-outreach.ts) already owns that follow-up and runs a moment later
 *               from the same status callback. Acking here as well would send two messages for one
 *               call, which is exactly the failure the draft queue exists to prevent.
 *
 * Every guard still lives in first-contact-ack.ts: disabled by default, first contact only,
 * acknowledgement intents only, approved-template fallback when the window is shut. And the window
 * IS shut for a caller, almost always, because a phone call does not open it.
 */
async function ackForCall(
    conversationId: string,
    e164: string,
    call: CallRow,
    info: CallDescriptor,
): Promise<FirstContactAckResult | { sent: false; reason: string }> {
    if (!info.missed) return { sent: false, reason: 'ANSWERED_HANDLED_BY_POST_CALL_OUTREACH' };
    try {
        const { maybeAutoAckFirstContact } = await import('./first-contact-ack');
        const result = await maybeAutoAckFirstContact({
            conversationId,
            phone: e164,
            channel: 'post_call',
            contactName: call.customerName,
            intent: 'ack_missed_call',
        });
        if (result.reason !== 'DISABLED' && result.reason !== 'NOT_FIRST_CONTACT') {
            console.log(`[CallThread] Missed-call ack for ${e164}: ${result.reason}`);
        }
        return result;
    } catch (error: any) {
        console.error('[CallThread] Missed-call ack failed:', error?.message ?? error);
        return { sent: false, reason: 'ERROR' };
    }
}
