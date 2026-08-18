/**
 * The on-inbound lane: a customer message arrives → the comms agent triages the thread a few
 * minutes later. Debounced per conversation, because people send bursts ("hi" / photo / "can
 * you quote this?") — one run after the burst, not three during it.
 *
 * This module is deliberately tiny: it's imported by hot webhook paths (Twilio inbound, Meta
 * inbound, extension ingest), so the heavy agent machinery loads lazily at fire time, never at
 * ingest time. Timers live in-process; a restart drops them, and that's fine — the SLA sweep
 * is the backstop that guarantees eventual coverage.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Ofcom test range — never spend agent runs on smoke-test numbers. */
function isTestNumber(phone: string): boolean {
    return phone.replace(/\D/g, '').includes('7700900');
}

/**
 * Call on EVERY stored inbound customer message. Fire-and-forget and exception-proof — a lane
 * must never break ingest. The eventual run is the normal worker: same gates, same approval queue.
 */
export function scheduleInboundTriage(conversationId: string, phone: string): void {
    arm(conversationId, phone).catch((e) =>
        console.error('[CommsLanes] scheduleInboundTriage error:', e?.message ?? e));
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
