/**
 * The on-inbound lane: a customer message arrives → the comms agent triages the thread a few
 * minutes later. Debounced per conversation, because people send bursts ("hi" / photo / "can
 * you quote this?") — one run after the burst, not three during it.
 *
 * Three things happen on an inbound, and they are deliberately on different clocks:
 *
 *   GATE 0 — the opt-out check, awaited before anything else can compose a word. If the customer
 *     said STOP, the suppression is recorded, the thread is closed, and every lane below is
 *     skipped. See server/opt-out.ts.
 *
 *   IMMEDIATE — two deterministic passes, no model, no cost:
 *     · if this is a genuine FIRST contact (a number we have never messaged), or a customer
 *       returning after months, the first-contact responder acknowledges it NOW, not in ten
 *       minutes. An acknowledgement is only worth anything while the customer is still holding the
 *       phone, and it is the one sanctioned exception to draft-and-approve
 *       (server/first-contact-ack.ts owns every guard). Ships off.
 *     · if the customer is answering an acknowledgement we already sent ("yes, call me" / "no,
 *       just text"), the thread is tagged and, for a yes, pushed to urgent. Asking a question and
 *       then treating the answer as ordinary board traffic is how an auto-ask becomes a broken
 *       promise. This runs whether or not the ack feature is currently enabled, because the ack
 *       being answered may have been sent while it was.
 *
 *   DEBOUNCED — the LLM triage run, unchanged: it waits for the burst to settle, then drafts for
 *   Ben's approval. By the time it runs, the ack above is already an outbound message in the
 *   thread, so the thread is no longer a first contact and the normal gate applies.
 *
 * This module is deliberately tiny: it's imported by hot webhook paths (Twilio inbound, Meta
 * inbound, extension ingest), so the heavy agent machinery loads lazily at fire time, never at
 * ingest time. Timers live in-process; a restart drops them, and that's fine — the SLA sweep
 * is the backstop that guarantees eventual coverage.
 */
import type { FirstContactChannel } from '../first-contact-ack';

/** Ofcom test range — never spend agent runs on smoke-test numbers. */
function isTestNumber(phone: string): boolean {
    return phone.replace(/\D/g, '').includes('7700900');
}

/**
 * Call on EVERY stored inbound customer message. Fire-and-forget and exception-proof — a lane
 * must never break ingest. The eventual run is the normal worker: same gates, same approval queue.
 */
export function scheduleInboundTriage(conversationId: string, phone: string, opts: {
    channel?: FirstContactChannel;
    contactName?: string | null;
    hasMedia?: boolean;
    /** The message body — used by the opt-out detector, the spam screen and the ack-reply classifier. */
    text?: string | null;
    /** The stored message's id, so a recorded opt-out points at the exact words that caused it. */
    messageId?: string | null;
} = {}): void {
    // Live-board push: an inbound just changed the board, tell any open CommsPage now rather
    // than at its next poll. Lazy import (this module is on hot webhook paths) and swallowed
    // errors — a UI stream must never break ingest.
    if (conversationId) {
        void import('../comms-events').then(({ emitCommsEvent }) => {
            emitCommsEvent({ type: 'board_delta', conversationId, reason: 'inbound', at: new Date().toISOString() });
        }).catch((e) => console.warn('[CommsLanes] board_delta emit failed (ingest stands):', e?.message ?? e));
    }
    void runInboundLanes(conversationId, phone, opts).catch((e) =>
        console.error('[CommsLanes] scheduleInboundTriage error:', e?.message ?? e));
}

async function runInboundLanes(conversationId: string, phone: string, opts: {
    channel?: FirstContactChannel;
    contactName?: string | null;
    hasMedia?: boolean;
    text?: string | null;
    messageId?: string | null;
}): Promise<void> {
    // GATE 0 — did they just ask us to stop?
    //
    // This runs FIRST and is awaited, because every other lane below can produce a message. The
    // first-contact acknowledger in particular would happily reply to a STOP that happened to be
    // someone's first message to us, which is the single worst outcome available here: an automated
    // message to a person who has just, in writing, asked for no more automated messages.
    //
    // On a match the suppression is recorded, the thread is tagged and closed, and this returns.
    // Nothing is drafted, nothing is acknowledged, nothing is sent back. Twilio and Meta already
    // handle the STOP acknowledgement on the paths that have one, and a second message from us
    // would be exactly wrong.
    //
    // A thrown error here must not swallow the inbound, but it must also not let the lanes run as
    // if nothing was said, so it is caught and treated as "no match" only after being logged loudly.
    try {
        const { applyInboundOptOut } = await import('../opt-out');
        const optOut = await applyInboundOptOut({
            conversationId,
            phone,
            text: opts.text,
            channel: opts.channel ?? 'whatsapp',
            messageId: opts.messageId,
            contactName: opts.contactName,
        });
        if (optOut.matched) {
            console.log(`[CommsLanes] ${phone} opted out (${optOut.scope}) — no ack, no draft, no triage.`);
            // A person who just wrote STOP must also come off the call list — an open VA call
            // task would otherwise have a human ring the number the system just promised to
            // leave alone (server/agents/va-call-tasks.ts, 28 Aug 2026).
            try {
                const { dismissOpenVaCallTasksForPhone } = await import('./va-call-tasks');
                await dismissOpenVaCallTasksForPhone(phone, 'system:opt_out', 'opted_out');
            } catch (e: any) {
                console.error('[CommsLanes] va-call-task opt-out dismiss failed:', e?.message ?? e);
            }
            return;
        }
    } catch (error: any) {
        console.error('[CommsLanes] OPT-OUT CHECK FAILED — lanes continuing:', error?.message ?? error);
    }

    // Instant lane, before the debounce: only ever fires on a thread with no outbound history, or
    // one that has been silent longer than the returning threshold. Runs for test numbers too — it
    // costs no agent run, and the smoke conversation is how this path is exercised without
    // messaging a real customer.
    ackFirstContact(conversationId, phone, opts).catch((e) =>
        console.error('[CommsLanes] first-contact ack error:', e?.message ?? e));

    // Also instant, also deterministic: is this the answer to an ack we already sent?
    tagAckReply(conversationId, phone, opts).catch((e) =>
        console.error('[CommsLanes] ack-reply triage error:', e?.message ?? e));

    await arm(conversationId, phone);

    // The VA call-task lane (server/agents/va-call-tasks.ts, 28 Aug 2026): on a first-contact
    // text enquiry, open a "ring them within 15 working minutes" task and HOLD the debounced
    // triage until it resolves. Deliberately AFTER arm() and awaited: both write
    // metadata.nextTriageAt latest-writer-wins, and the hold must land on top of arm's short
    // debounce or a second message in the burst would quietly un-hold the thread. Sends nothing
    // to the customer; a failure here must not break ingest.
    try {
        const { runVaCallTaskLane } = await import('./va-call-tasks');
        await runVaCallTaskLane({
            conversationId,
            phone,
            channel: opts.channel ?? 'whatsapp',
            contactName: opts.contactName,
            text: opts.text,
        });
    } catch (error: any) {
        console.error('[CommsLanes] va-call-task lane error:', error?.message ?? error);
    }
}

async function ackFirstContact(conversationId: string, phone: string, opts: {
    channel?: FirstContactChannel;
    contactName?: string | null;
    hasMedia?: boolean;
    text?: string | null;
}): Promise<void> {
    if (!conversationId) return;
    const { maybeAutoAckFirstContact } = await import('../first-contact-ack');
    const result = await maybeAutoAckFirstContact({
        conversationId,
        phone,
        channel: opts.channel ?? 'whatsapp',
        contactName: opts.contactName,
        hasMedia: opts.hasMedia,
        text: opts.text,
    });
    // Everything is logged, including the refusals — "why did nobody get an ack?" must be answerable.
    if (result.reason !== 'DISABLED' && result.reason !== 'NOT_FIRST_CONTACT') {
        console.log(`[CommsLanes] First-contact ack for ${conversationId}: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
    }
}

async function tagAckReply(conversationId: string, phone: string, opts: { text?: string | null }): Promise<void> {
    if (!conversationId) return;
    const { triageAckReply } = await import('../first-contact-ack');
    const result = await triageAckReply({ conversationId, phone, text: opts.text });
    if (result.reason === 'TAGGED') {
        console.log(`[CommsLanes] Ack reply on ${conversationId}: tagged ${result.tagged}${result.priority ? `, priority ${result.priority}` : ''}`);
    }
}

/**
 * The debounce is a DATABASE ROW, not a setTimeout. Three deploys in one night each erased the
 * in-process timer mid-countdown and the customer's message sat unprocessed until the slow sweep
 * noticed — 20 Aug 2026, live, with the owner watching their own WhatsApp go unanswered. A due
 * time written to the conversation survives any restart; the fast ticker in comms-sweep.ts acts
 * on it within ~30s of it falling due. Every new message in a burst pushes the due time back,
 * which is the same renewal semantics the timer had.
 */
async function arm(conversationId: string, phone: string): Promise<void> {
    // Every exit says WHY, at log level. This function silently doing nothing in production while
    // working perfectly in local repro cost a morning of blind debugging on 20 Aug 2026 — the
    // fast path was believed live for two hours while every reply actually came from the slow
    // sweep. A trigger may fail; it may not fail silently.
    if (!conversationId) { console.warn('[CommsLanes] arm skipped: no conversationId'); return; }
    if (isTestNumber(phone)) { console.log(`[CommsLanes] arm skipped: test number ${phone}`); return; }

    // Phase 3: three-way switch (server/spine/switch.ts). live = the spine's requestRun owns the
    // debounce; shadow = the legacy arm below (the legacy tick runs the shadow pass itself);
    // off = legacy, byte-for-byte.
    try {
        const { spineMode } = await import('../spine/switch');
        if ((await spineMode()) === 'live') {
            const { requestRun } = await import('../spine/request-run');
            const r = await requestRun(conversationId, 'inbound_message');
            console.log(`[CommsLanes] spine requestRun ${conversationId}: ${r.queued ? 'queued' : `not queued (${r.reason})`}`);
            return;
        }
    } catch (error: any) {
        console.error('[CommsLanes] spine flag check failed, falling through to legacy arm:', error?.message ?? error);
    }

    const { getCommsAgentConfig } = await import('./comms');
    const config = await getCommsAgentConfig();
    if (!config.enabled || !config.onInbound) {
        console.log(`[CommsLanes] arm skipped: config enabled=${config.enabled} onInbound=${config.onInbound}`);
        return;
    }

    const { db } = await import('../db');
    const { conversations } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');
    const due = new Date(Date.now() + Math.max(0.05, config.inboundDebounceMinutes) * 60_000).toISOString();
    const result = await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${due}::text)`,
    }).where(eq(conversations.id, conversationId)).returning({ id: conversations.id });
    console.log(`[CommsLanes] armed ${conversationId} for ${due} (matched ${result.length} row)`);
}
