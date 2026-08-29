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
 *   4. A CALL WE MADE IS NOT AN ENQUIRY. An outbound call may open a card (see
 *      MIN_OUTBOUND_SECONDS_TO_OPEN_CARD and outboundCardRefusal), but it must never look like
 *      someone waiting on us: no unread badge, no SLA clock, no acknowledgement message, and it
 *      lands in 'scoping' rather than 'enquiry'. All four fall out of `direction`, which is why
 *      every write below is guarded on it rather than on the caller passing the right flags.
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

// ---------------------------------------------------------------- classification

/**
 * The AI verdict on an answered inbound call, written to `calls.classification` (jsonb) by
 * server/call-classifier.ts. Mirrored here rather than imported so this module stands on its own
 * feet: the classifier can change without dragging the board's rendering with it.
 */
export type CallClassification = {
    kind: 'job_enquiry' | 'existing_customer' | 'supplier' | 'sales_spam' | 'wrong_number' | 'complaint' | 'other';
    whatsappAgreed: 'agreed' | 'declined' | 'not_discussed';
    messagingObjection: boolean;
    jobSummary: string;
    urgency: 'high' | 'normal';
    callbackPromised: boolean;
    /** Optional here: verdicts stored before Aug 2026 don't carry it, and this module reads raw jsonb. */
    callIncomplete?: boolean;
    classifiedAt: string;
};

/**
 * Read the classifier's verdict off a call row, defensively.
 *
 * Reads via `any` and treats anything missing or malformed as simply unclassified: most historic
 * rows are null, the classifier only runs on answered inbound calls, and a caller handing in a
 * partial row (tests, projections) should degrade to the plain preview rather than throw.
 */
export function readCallClassification(call: unknown): CallClassification | null {
    const c = (call as any)?.classification;
    if (!c || typeof c !== 'object' || typeof c.kind !== 'string') return null;
    return c as CallClassification;
}

/** What each kind is called on a card. `other` earns no label: it would say nothing. */
const KIND_LABEL: Record<CallClassification['kind'], string | null> = {
    job_enquiry: 'job enquiry',
    existing_customer: 'existing customer',
    supplier: 'supplier',
    sales_spam: 'sales call',
    wrong_number: 'wrong number',
    complaint: 'complaint',
    other: null,
    outbound_call: null, // the preview already says "Outbound call"; repeating it is noise
};

/** One line at ~`max` chars. The full summary still travels in the message body. */
function clip(s: string, max: number): string {
    const t = s.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The verdict as one short human line: "job enquiry: fence panels blown down; WhatsApp agreed".
 *
 * Order is deliberate: what the call WAS, then what was said, then the flags that change what
 * happens next. `omitKind` is for previews that already lead with the kind (the complaint head).
 */
export function classificationLine(
    cls: CallClassification,
    opts: { omitKind?: boolean } = {},
): string {
    const label = opts.omitKind ? null : KIND_LABEL[cls.kind];
    const summary = (cls.jobSummary ?? '').trim();
    const head = summary
        ? (label ? `${label}: ${clip(summary, 90)}` : clip(summary, 90))
        : label;
    const parts: string[] = head ? [head] : [];
    if (cls.urgency === 'high') parts.push('urgent');
    if (cls.whatsappAgreed === 'agreed') parts.push('WhatsApp agreed');
    else if (cls.whatsappAgreed === 'declined' || cls.messagingObjection) parts.push('WhatsApp declined');
    if (cls.callbackPromised) parts.push('callback promised');
    return parts.join('; ');
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
    const outcome = (call.outcome ?? '').toUpperCase();
    if (outcome === 'MISSED_CALL') return true;
    // A call Ben placed that nobody picked up. Needed as its own case because the outbound dial
    // handler records status 'completed' (the TwiML verb completed fine) and carries the real
    // result in `outcome` — without this an unanswered outbound reads as "Outbound call (0s)".
    if (outcome === 'OUTBOUND_NO_ANSWER') return true;
    if (['missed', 'voicemail'].includes((call.handledBy ?? '').toLowerCase())) return true;
    // Never connected and never finalized (the 'ringing' rows) — nobody spoke to them.
    if (status === 'ringing' && !call.duration) return true;
    return false;
}

/** The line the board shows and the message row stores. Brand voice: plain, no em dashes. */
export function describeCall(call: Pick<CallRow,
    'direction' | 'status' | 'outcome' | 'handledBy' | 'duration' | 'ringSeconds' | 'jobSummary'>
    // Optional rather than in the Pick, so partial call shapes (tests, older call sites) still
    // satisfy the signature; a full CallRow carries the column and matches either way.
    & { classification?: unknown }
): CallDescriptor {
    const direction: 'inbound' | 'outbound' = (call.direction ?? '').startsWith('out') ? 'outbound' : 'inbound';
    const missed = isMissedCall(call);
    const summary = usableSummary(call.jobSummary);

    if (direction === 'outbound') {
        // Outbound calls get the summariser's line too ("summary and bullets per incoming and
        // outbound" — owner, 21 Aug): why we called and how it ended, not just how long it ran.
        const outCls = readCallClassification(call);
        const line = outCls ? classificationLine(outCls, { omitKind: true }) : '';
        return {
            missed, direction, summary,
            preview: missed
                ? 'Outbound call, no answer'
                : `Outbound call (${formatDuration(call.duration)})${line ? `: ${line}` : ''}`,
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

    // Answered inbound with a classifier verdict: say what the call WAS, not just how long it ran.
    // A complaint leads the preview outright — a complaint filed under "Inbound call" is a
    // complaint nobody scans for.
    const cls = readCallClassification(call);
    if (cls) {
        const complaint = cls.kind === 'complaint';
        const head = complaint
            ? `Complaint call (${formatDuration(call.duration)})`
            : `Inbound call (${formatDuration(call.duration)})`;
        const line = classificationLine(cls, { omitKind: complaint });
        if (line || complaint) {
            return {
                missed, direction,
                // The classifier's summary backfills when the raw jobSummary was filler.
                summary: summary ?? ((cls.jobSummary ?? '').trim() || null),
                preview: line ? `${head}, ${line}` : head,
            };
        }
    }

    const head = `Inbound call (${formatDuration(call.duration)})`;
    return { missed, direction, summary, preview: summary ? `${head}: ${summary}` : head };
}

// ---------------------------------------------------------------- the outbound gate

/**
 * How long an outbound call must last before it is allowed to OPEN a new card.
 *
 * Chosen from the 148 calls Ben actually made from Groundwire between 30 Apr and 18 Aug 2026
 * (Twilio's own call log — the `calls` table holds almost no outbound history because this capture
 * path is new). Their durations are sharply bimodal:
 *
 *     0s      35   every one of them no-answer, busy or failed. Nobody spoke.
 *     1-3s    25   answered and instantly over: misdials and redial storms. One number was
 *                  dialled seven times, longest 5s; another six times, longest 3s.
 *     4-10s   14
 *     11-30s   5
 *     31s+    69   real conversations, median around two minutes.
 *
 * So 41% of outbound calls are 3 seconds or less, and there is a thin valley between the fumbles
 * and the conversations. Grouping by destination and asking how many NEW cards each threshold would
 * have opened, every value from 11s to 31s gives the identical answer (22 new cards, 11 suppressed)
 * — the numbers in that band are all people already on the board. 10s is chosen at the bottom of
 * that flat region: it clears the entire misdial mass, and on 110 days of real traffic it differs
 * from a 30s rule by a single call. Erring low is deliberate, because the cost of the two mistakes
 * is not symmetric — a spurious card is visible and deletable, a conversation that never got
 * recorded is invisible and gone.
 *
 * This gate governs CREATING A CARD only. A call to someone we already have a thread with is
 * appended whatever its length, so no call is ever lost from a conversation that exists.
 */
export const MIN_OUTBOUND_SECONDS_TO_OPEN_CARD = 10;

/**
 * May this outbound call open a brand new card? Returns the refusal reason, or null to allow.
 *
 * The order matters: identity first (a two-minute call to a contractor is still not a customer
 * card), then substance.
 */
async function outboundCardRefusal(call: CallRow, info: CallDescriptor): Promise<string | null> {
    const { classifyNonCustomerNumber } = await import('./internal-numbers');
    const nonCustomer = await classifyNonCustomerNumber(call.phoneNumber);
    if (nonCustomer) return `OUTBOUND_NON_CUSTOMER:${nonCustomer.code}`;

    // Rang out, engaged or failed. A call nobody answered is not the start of a relationship, and
    // it is 24% of everything Ben dials.
    if (info.missed) return 'OUTBOUND_UNANSWERED';

    // Duration not recorded yet. Ingest is idempotent and re-runs once finalization fills it in, so
    // this defers the decision rather than making it wrongly.
    if (call.duration === null || call.duration === undefined) return 'OUTBOUND_DURATION_UNKNOWN';

    if (call.duration < MIN_OUTBOUND_SECONDS_TO_OPEN_CARD) return 'OUTBOUND_TOO_SHORT';

    return null;
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
    /**
     * Force the create/don't-create decision. Leave unset to use the normal rules: an inbound call
     * always opens a card, an outbound one only if it passes `outboundCardRefusal`.
     */
    createConversation?: boolean;
    /**
     * Let a call BEN MADE open a new card. Live path only.
     *
     * Defaults to FALSE, and that default is load-bearing: the owner asked for future calls only
     * and explicitly does NOT want history rewritten. scripts/migrate-calls-into-threads.ts inherits
     * these defaults, so leaving this off is what keeps a backfill from conjuring cards for every
     * supplier Ben has ever rung. Only server/call-logger.ts finalizeCall turns it on.
     */
    outboundOpensCard?: boolean;
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
    /**
     * Run the post-call continuation lane (server/post-call-outreach.ts). Live path only.
     * Defaults to FALSE and, like outboundOpensCard, that default is load-bearing: the backfill
     * inherits it, so replaying history can never message a customer about a call from March.
     */
    continuation?: boolean;
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

    // May this call open a card that does not exist yet?
    //
    // Inbound: always. Someone rang us; that is the most urgent thing the board can show.
    //
    // Outbound: only on the live path, and only when it survives the gate. Before this, an outbound
    // call could join a thread but never start one, so the first time Ben rang a NEW number the
    // conversation was recorded and transcribed and then shown to nobody — the record went missing
    // at exactly the moment a relationship begins. Opening a card for EVERY outbound call is the
    // other failure: he also rings suppliers, merchants and his own team all day.
    let createConversation: boolean;
    let outboundRefusal: string | null = null;
    if (opts.createConversation !== undefined) {
        createConversation = opts.createConversation;
    } else if (info.direction === 'inbound') {
        createConversation = true;
    } else if (!opts.outboundOpensCard) {
        createConversation = false;
        outboundRefusal = 'OUTBOUND_CARDS_DISABLED';
    } else {
        outboundRefusal = await outboundCardRefusal(call, info);
        createConversation = outboundRefusal === null;
    }

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
        // The refusal reason travels out with the result, so "why is this call not on the board?"
        // is answerable from the log line rather than by re-deriving the rules.
        if (!createConversation) return { status: 'skipped', reason: outboundRefusal ?? 'NO_CONVERSATION' };
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
            // A thread WE started is not an enquiry. 'enquiry' means new and unanswered, with the
            // SLA clock running and someone waiting on us — and nobody enquired here, we rang them.
            // Filing it as an enquiry would put a card in the column Ben works top-down for people
            // who are waiting, when this one is already spoken to. 'scoping' is the honest column:
            // "we're in conversation, gathering what a quote needs". It is also exactly where the
            // thread would have landed anyway — stageAfterOutbound() moves an enquiry to scoping the
            // moment we reply, so an outbound-first thread simply starts where our first outbound
            // would have put it.
            stage: info.direction === 'outbound' ? 'scoping' : 'enquiry',
            // Unread means "they said something you have not read". A call we placed is not unread,
            // Ben was on it. (The update path further down already guards this on direction; the
            // insert did not, because until outbound calls could open a card it never came up.)
            unreadCount: opts.markUnread && info.direction === 'inbound' ? 1 : 0,
            lastMessageAt: at,
            lastMessagePreview: info.preview,
            // NOT lastInboundAt: a call does not open WhatsApp's 24h freeform window. Doubly true
            // for one we placed — nothing has arrived FROM them at all.
            //
            // NOT lastCustomerContactAt either, on an outbound call. That column is the any-channel
            // "last heard from them" clock; setting it because we rang them would age the thread as
            // though they had made contact, and the comms agent's re-engagement query reads it.
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

    // --- 3b. the loop closes itself ---------------------------------------------------
    // A thread tagged callback_due is waiting for exactly one thing: us ringing them. This
    // outbound call IS that ring, so the debt is settled the moment it lands on the thread —
    // no button, no checkbox. The tag and its clock go together (the sweep's fallback measures
    // metadata.callbackDueAt, and a cleared tag with a live clock would be a lie in waiting).
    // Only callback_due is touched; every other tag is someone else's bookkeeping.
    if (info.direction === 'outbound' && (conv.tags ?? []).includes('callback_due')) {
        try {
            await db.update(conversations).set({
                tags: (conv.tags ?? []).filter((t) => t !== 'callback_due'),
                metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) - 'callbackDueAt'`,
                updatedAt: new Date(),
            }).where(eq(conversations.id, conv.id));
            console.log(`[CallThread] Callback made — callback_due cleared (${conv.id})`);
        } catch (error: any) {
            console.warn('[CallThread] Could not clear callback_due:', error?.message ?? error);
        }
    }

    // --- 3c. the VA call task closes the same way -------------------------------------
    // A "ring this enquiry" task (server/agents/va-call-tasks.ts, 28 Aug 2026) is fulfilled by a
    // call landing on the thread — ANY direction, because them ringing us settles it just as
    // surely as us ringing them. The module's own predicate handles the fine print (open tasks
    // only, calls before the task's creation don't count, so the backfill can replay history
    // without retiring a live task) and releases the triage hold. Never breaks call ingest.
    try {
        const { completeVaCallTasksForCall } = await import('./agents/va-call-tasks');
        await completeVaCallTasksForCall(conv.id, at);
    } catch (error: any) {
        console.warn('[CallThread] va-call-task completion check failed:', error?.message ?? error);
    }

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

    // --- 5. the post-call continuation (flag-gated, fails closed) ---------------------
    // Fire-and-forget: the continuation does its own classification wait, idempotency and
    // guard-rails, and ingest must never block on (or break because of) outreach. NOT gated on
    // `!existing` — the ring-time ingest already wrote the row, so by finalization this is
    // always an update.
    if (opts.continuation && info.direction === 'inbound' && !info.missed) {
        void (async () => {
            const { maybeSendPostCallContinuation } = await import('./post-call-outreach');
            const d = await maybeSendPostCallContinuation(call.id);
            if (d.reason !== 'DISABLED') {
                console.log(`[CallThread] Continuation for ${call.id}: ${d.sent ? 'SENT' : d.reason}`);
            }
        })().catch((e: any) => console.warn('[CallThread] Continuation trigger failed:', e?.message ?? e));
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
