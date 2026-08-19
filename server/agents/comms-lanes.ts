/**
 * The on-inbound lane: a customer message arrives → the comms agent triages the thread a few
 * minutes later. Debounced per conversation, because people send bursts ("hi" / photo / "can
 * you quote this?") — one run after the burst, not three during it.
 *
 * Two things happen on an inbound, and they are deliberately on different clocks:
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

const timers = new Map<string, ReturnType<typeof setTimeout>>();

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
    /** The message body — used by the spam screen and by the ack-reply classifier. */
    text?: string | null;
} = {}): void {
    // Instant lane, before the debounce: only ever fires on a thread with no outbound history, or
    // one that has been silent longer than the returning threshold. Runs for test numbers too — it
    // costs no agent run, and the smoke conversation is how this path is exercised without
    // messaging a real customer.
    ackFirstContact(conversationId, phone, opts).catch((e) =>
        console.error('[CommsLanes] first-contact ack error:', e?.message ?? e));

    // Also instant, also deterministic: is this the answer to an ack we already sent?
    tagAckReply(conversationId, phone, opts).catch((e) =>
        console.error('[CommsLanes] ack-reply triage error:', e?.message ?? e));

    arm(conversationId, phone).catch((e) =>
        console.error('[CommsLanes] scheduleInboundTriage error:', e?.message ?? e));
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

async function arm(conversationId: string, phone: string): Promise<void> {
    if (!conversationId || isTestNumber(phone)) return;

    // Config read up front so a disabled agent costs one cached-pool query, not a timer.
    const { getCommsAgentConfig } = await import('./comms');
    const config = await getCommsAgentConfig();
    if (!config.enabled || !config.onInbound) return;

    const existing = timers.get(conversationId);
    if (existing) clearTimeout(existing); // renew the debounce — the burst is still going

    const timer = setTimeout(async () => {
        timers.delete(conversationId);
        try {
            const { getCommsAgentConfig: getCfg, runCommsAgent } = await import('./comms');
            const cfg = await getCfg();
            if (!cfg.enabled || !cfg.onInbound) return; // re-check: may have been switched off mid-wait
            console.log(`[CommsLanes] On-inbound triage firing for ${conversationId}`);
            const outcome = await runCommsAgent(conversationId, 'inbound_message');
            console.log(`[CommsLanes] On-inbound done: ${outcome.actions.map((a) => a.tool).join(', ') || 'no actions'}`);
        } catch (error: any) {
            console.error(`[CommsLanes] On-inbound triage failed for ${conversationId}:`, error?.message);
        }
    }, Math.max(0.05, config.inboundDebounceMinutes) * 60_000);

    timer.unref?.(); // don't let a pending timer keep the process alive on shutdown
    timers.set(conversationId, timer);
}
