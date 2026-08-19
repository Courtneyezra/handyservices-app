/**
 * Quarantined messages — rows that are on the record but never reached the customer.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 *
 * The `messages` table carries 58,216 outbound rows written between 18 Feb and 14 Aug 2026 that no
 * customer ever saw:
 *
 *   runaway_loop    57,833 rows, 37 conversations, Feb-Mar 2026. A retry loop that re-sent the same
 *                   quote-ready / follow-up notice thousands of times ("Hi Test! Your quote is
 *                   ready" x 11,751). Twilio's own usage records show ~171 real messages for the
 *                   period.
 *   dead_sender        344 rows, 110 conversations, Apr - 14 Aug 2026. Ordinary automation (invoice
 *                   chasers, day-before confirmations) fired through a WhatsApp sender that could
 *                   not deliver: +15558874602 never worked, and production was pointed at the
 *                   offline sandbox number. See project-whatsapp-ingest-incident.
 *   tenant_sandbox      39 rows, 3 conversations. The tenant-chat AI sandbox talking to itself.
 *
 * Left as ordinary outbound they poison one specific judgement: `computeWaitState` calls a thread
 * ANSWERED when lastOutbound >= lastInbound. 71 conversations read as handled when nobody had
 * replied — invisible in the Unanswered headline, skipped by the comms agent's SLA sweep, and
 * disqualified from the first-contact auto-ack (which asks "has any outbound EVER gone out?").
 *
 * ─── THE RULE ──────────────────────────────────────────────────────────────────────────────────
 *
 * A quarantined row means WE NEVER REPLIED. So:
 *   - every read that asks "did we answer this person?" must SKIP it   → `notQuarantined`
 *   - every read that asks "what happened on this thread?" must SHOW it, marked → `neverSentMeta`
 *
 * ─── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────────
 *
 * Not "no twilio_sid". A message sent through the Meta Cloud API transport
 * (server/meta-whatsapp.ts recordOutboundMessage) legitimately has no Twilio SID, and so does any
 * future non-Twilio transport. The missing SID was only ever *evidence* used once, offline, inside
 * a closed historical window by scripts/migrate-quarantine-phantom-messages.ts. At runtime the
 * quarantine is read from the explicit column and never re-derived.
 */
import { isNull, sql } from 'drizzle-orm';
import { messages } from '@shared/schema';

/** Drizzle predicate: rows that actually counted as contact. AND this into any "did we reply?" read. */
export const notQuarantined = isNull(messages.quarantinedAt);

/** Raw-SQL equivalent, for the handful of read paths built on db.execute(sql`...`). */
export const NOT_QUARANTINED_SQL = sql`quarantined_at IS NULL`;

/** Human-readable reason per marker value, for the thread view and for reports. */
export const QUARANTINE_LABELS: Record<string, string> = {
    runaway_loop: 'Never sent — runaway retry loop, Feb-Mar 2026',
    dead_sender: 'Never sent — the WhatsApp sender was dead at the time',
    tenant_sandbox: 'Never sent — tenant-chat sandbox, not a real customer thread',
};

/**
 * What the UI and the agents need to render a quarantined row honestly: it stays in the timeline,
 * it just stops pretending to be a reply.
 */
export function neverSentMeta(row: { quarantinedAt?: Date | string | null; quarantineReason?: string | null }) {
    if (!row.quarantinedAt) return { neverSent: false as const, neverSentReason: null };
    return {
        neverSent: true as const,
        neverSentReason: QUARANTINE_LABELS[row.quarantineReason ?? ''] ?? 'Never sent',
    };
}
