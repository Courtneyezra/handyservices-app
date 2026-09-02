/**
 * Auto-acknowledgements are not replies.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 *
 * `computeWaitState` calls a thread ANSWERED the moment `lastOutbound >= lastInbound`. The
 * first-contact auto-acknowledgement (server/first-contact-ack.ts) is an outbound message, so the
 * second it lands the customer stops counting as waiting: they drop out of the Unanswered headline
 * on the board, out of the comms agent's SLA sweep, out of the window-closing sweep and out of the
 * backlog sweep. Nobody has read their message. They have a machine receipt and a four-hour SLA
 * that is no longer running.
 *
 * This is the same class of error as the phantom outbound (server/message-quarantine.ts), and it
 * gets the same treatment: no data is mutated, the message stays in the thread exactly as sent, and
 * the single read that asks "did we reply?" simply stops counting it.
 *
 * ─── THE DISCRIMINATOR, AND WHY THIS ONE ───────────────────────────────────────────────────────
 *
 * A `message_drafts` row with BOTH:
 *
 *     source      = 'first_contact_ack'      (which lane composed it)
 *     approved_by LIKE 'first_contact_ack:%' (who pressed send: the machine)
 *
 * Both halves are load-bearing, and the pair is what "cannot drift" means here:
 *
 *   · `source` alone is not enough. A first-contact ack whose window was shut gets QUEUED for Ben
 *     and carries the same source. When Ben reads that thread and taps approve, `approved_by` is
 *     his email — a human decided to send it, and that MUST stop the clock. Excluding on source
 *     alone would leave a thread Ben has personally answered sitting in the unanswered column.
 *   · `approved_by` alone is not enough either. `maybeAutoSendFirstContactDraft()` auto-sends
 *     webform acknowledgements and post-call video requests under the same first-contact
 *     exception and stamps the same approver. Those are substantive first messages composed by a
 *     different lane, and widening the exclusion to them is not what this fix is for.
 *
 * Why NOT the alternatives:
 *
 *   · `first_contact_ack_log` is an AUDIT table, written fire-and-forget inside its own try/catch
 *     precisely so a logging failure can never break a send ("the worst case is a missing row").
 *     A discriminator that is allowed to be missing silently reinstates the bug. `message_drafts`
 *     is on the send path itself: `approveAndSendDraft` CLAIMS the draft row before it sends, so
 *     no row means no send, ever.
 *   · Matching `messages.twilio_sid` to `message_drafts.sent_message_id` looks tidier and is
 *     wrong. An ack body is two bursts split on '---' and goes out as two WhatsApp messages, but
 *     the draft only records the sid of the LAST one. Excluding by sid would leave burst one
 *     counting as a reply, which is the whole bug.
 *
 * ─── HOW A SEND IS BOUNDED ─────────────────────────────────────────────────────────────────────
 *
 * `approveAndSendDraft` stamps `approved_at` when it claims the row, BEFORE anything is sent, and
 * `sent_at` after the last burst has gone. Every `messages` row that send produced is written in
 * between, by the same process, from the same clock. So [approved_at, sent_at] contains all of
 * them and nothing else. That interval is derived from the draft's own record: no constants, no
 * guessing, and it covers one burst or four identically.
 *
 * The small tolerance below only absorbs timestamp rounding between the app and Postgres.
 *
 * ─── WHAT STILL STOPS THE CLOCK ────────────────────────────────────────────────────────────────
 *
 * Ben's own typed reply, a draft Ben approved (including an ack he approved by hand), an agent
 * draft he approved, a quote send, a template send. All of them. Only the machine's own
 * acknowledgement does not.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT TOUCH ─────────────────────────────────────────────────────
 *
 * `readContactHistory()` / `isFirstContact()` in server/first-contact-ack.ts, where the ack
 * absolutely DOES count as prior contact. Those answer a different question ("have we ever
 * messaged this person?") and the answer has to be yes, or the same person is acknowledged twice.
 * The asymmetry is the point: an ack is contact, it is just not an answer.
 */
import { db } from './db';
import { messageDrafts, conversations } from '@shared/schema';
import { and, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm';
import type { Approver } from './approver';

/** The draft source the first-contact lane composes under. */
export const AUTO_ACK_SOURCE = 'first_contact_ack';
/** The approver the lane stamps when the MACHINE sends, since Phase 0 (2 Sep 2026). */
export const AUTO_ACK_APPROVER: Approver = 'rules.first_contact';
/** What the lane stamped before Phase 0: `first_contact_ack:<channel>`. Older rows still carry it. */
export const AUTO_ACK_APPROVER_PREFIX = 'first_contact_ack:';

/**
 * Rounding slack on the interval, in milliseconds. Not a heuristic window: containment is
 * guaranteed by construction (see the header), this only absorbs sub-second timestamp rounding
 * between the Node clock and the stored `timestamp` columns.
 */
const TOLERANCE_SECONDS = 5;
const BOUND_TOLERANCE_MS = TOLERANCE_SECONDS * 1000;

/** One machine-sent acknowledgement, as the span of time its message rows occupy. */
export type AutoAckSend = {
    draftId: string;
    /** The conversation the draft was written against; null when none existed at queue time. */
    conversationId: string | null;
    /** Digits-only phone, so a person with more than one thread is still matched. */
    digits: string;
    from: Date;
    to: Date;
};

/**
 * Every acknowledgement the machine has sent. Small by construction: one row per auto-ack ever
 * sent, and the feature ships disabled. Indexed by (status, created_at).
 *
 * Never throws — a failure here must degrade to the old behaviour (acks counted as replies), not
 * to a board that will not render.
 */
export async function loadAutoAckSends(): Promise<AutoAckSend[]> {
    try {
        const rows = await db
            .select({
                id: messageDrafts.id,
                conversationId: messageDrafts.conversationId,
                phone: messageDrafts.phone,
                // Read as raw strings, NOT through drizzle's typed timestamp mapper.
                //
                // These columns are `timestamp` (no time zone) and the two read paths in this
                // codebase disagree about them by exactly the server's UTC offset: the typed mapper
                // hands back an instant shifted by it, the raw string parses back to the instant
                // that was written. loadActivity's lastInbound/lastOutbound come off the raw path,
                // so these have to as well or the comparison below is out by hours on any machine
                // that is not on UTC. (That underlying inconsistency is older and wider than this
                // module; this just refuses to be caught by it.)
                approvedAt: sql<string | null>`${messageDrafts.approvedAt}`,
                sentAt: sql<string | null>`${messageDrafts.sentAt}`,
            })
            .from(messageDrafts)
            .where(and(
                eq(messageDrafts.status, 'sent'),
                eq(messageDrafts.source, AUTO_ACK_SOURCE),
                or(eq(messageDrafts.approvedBy, AUTO_ACK_APPROVER), like(messageDrafts.approvedBy, `${AUTO_ACK_APPROVER_PREFIX}%`)),
                isNotNull(messageDrafts.approvedAt),
                isNotNull(messageDrafts.sentAt),
            ));

        return rows.map((r) => ({
            draftId: r.id,
            conversationId: r.conversationId,
            digits: (r.phone ?? '').replace(/\D/g, ''),
            from: new Date(new Date(r.approvedAt!).getTime() - BOUND_TOLERANCE_MS),
            to: new Date(new Date(r.sentAt!).getTime() + BOUND_TOLERANCE_MS),
        }));
    } catch (error: any) {
        console.warn('[AutoAck] Could not read auto-ack sends, treating every outbound as a reply:', error?.message);
        return [];
    }
}

/**
 * Group the sends by conversation. A draft usually carries its own `conversation_id`; when it was
 * queued before the thread existed it is matched on digits instead, which also catches a person
 * who has both a WhatsApp and an SMS thread.
 */
export async function autoAckSpansByConversation(
    conversationIds: string[],
    sends: AutoAckSend[],
): Promise<Map<string, AutoAckSend[]>> {
    const byConversation = new Map<string, AutoAckSend[]>();
    if (!conversationIds.length || !sends.length) return byConversation;

    const add = (id: string, span: AutoAckSend) => {
        const list = byConversation.get(id);
        if (list) list.push(span); else byConversation.set(id, [span]);
    };

    const wanted = new Set(conversationIds);
    const unmatchedDigits = new Set<string>();

    for (const s of sends) {
        if (s.conversationId && wanted.has(s.conversationId)) add(s.conversationId, s);
        else if (s.digits) unmatchedDigits.add(s.digits);
    }

    // Only pay for the phone lookup when a send did not resolve by id.
    if (unmatchedDigits.size) {
        const rows = await db
            .select({ id: conversations.id, phoneNumber: conversations.phoneNumber })
            .from(conversations)
            .where(inArray(conversations.id, conversationIds))
            .catch(() => [] as Array<{ id: string; phoneNumber: string }>);

        const byDigits = new Map<string, string[]>();
        for (const r of rows) {
            const d = (r.phoneNumber ?? '').replace(/\D/g, '');
            if (!d) continue;
            const list = byDigits.get(d);
            if (list) list.push(r.id); else byDigits.set(d, [r.id]);
        }
        for (const s of sends) {
            if (s.conversationId && wanted.has(s.conversationId)) continue;
            for (const id of byDigits.get(s.digits) ?? []) add(id, s);
        }
    }

    return byConversation;
}

/**
 * Drizzle predicate: this message row was NOT written by one of the given acknowledgements.
 *
 * The interval is re-read from `message_drafts` INSIDE Postgres rather than passed in as two
 * JavaScript Dates, so no timestamp ever crosses the driver boundary in this comparison and the
 * `timestamp`-without-zone marshalling described above cannot skew it. `${TOLERANCE_SECONDS}` is
 * interpolated as a bound parameter by drizzle, not spliced into the SQL text.
 */
export function notWrittenByAnyAutoAck(createdAtColumn: any, draftIds: string[]) {
    if (!draftIds.length) return sql`true`;
    const ids = sql.join(draftIds.map((id) => sql`${id}`), sql`, `);
    return sql`NOT EXISTS (
        SELECT 1 FROM message_drafts d
        WHERE d.id IN (${ids})
          AND ${createdAtColumn} BETWEEN d.approved_at - make_interval(secs => ${TOLERANCE_SECONDS})
                                     AND d.sent_at     + make_interval(secs => ${TOLERANCE_SECONDS})
    )`;
}

/**
 * True when this instant falls inside one of the spans. Only a cheap pre-check: it decides whether
 * a thread needs the corrective query at all, and the query itself is the authority.
 */
export function insideAnyAutoAckSpan(at: Date, spans: Array<{ from: Date; to: Date }>): boolean {
    return spans.some((s) => at >= s.from && at <= s.to);
}
