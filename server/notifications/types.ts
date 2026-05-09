// server/notifications/types.ts
//
// Module 10 — Notifications Layer: shared types + 17-event catalogue.
//
// Every send is keyed by (event, recipient). Modules emit *intents*; the
// orchestrator picks channels, renders templates, dispatches, retries.
//
// Refs:
// - docs/architecture/modules/10-notifications.md §5 (event catalogue)
// - docs/architecture/state-machine.md (events fire on transitions)

/**
 * 17-event catalogue. Closed for v1 — adding an event requires a template
 * AND a default-channel + fallback entry. Modules cannot send "raw"
 * messages; they emit one of these events.
 */
export type NotificationEvent =
    | 'quote_sent'                      // → customer (draft → quoted)
    | 'payment_received'                // → customer + admin (quoted → booked_pending_routing)
    | 'routing_offer_round_1'           // → contractor (top unit, round 1)
    | 'routing_offer_round_2'           // → contractor (ranks 2-3, round 2)
    | 'routing_offer_broadcast'         // → all eligible contractors (round 3)
    | 'offer_accepted'                  // → customer + contractor (offer_round_X → dispatched)
    | 'pack_offered'                    // → Builder contractor (reserved_for_pack → pack-offered)
    | 'pack_accepted'                   // → admin + customers in pack
    | 'pack_released'                   // → admin (pack expired/cancelled)
    | 'pre_arrival_reminder'            // → contractor + customer (~15 min before slot)
    | 'check_in_no_show'                // → admin alert (no check-in past start)
    | 'job_completed'                   // → customer (review prompt; → completed_pending_review)
    | 'review_window_close'             // → contractor (24h after job_completed)
    | 'payout_fired'                    // → contractor (→ paid_out)
    | 'pay_adjustment_filed'            // → admin (review queue)
    | 'pay_adjustment_approved'         // → contractor
    | 'reschedule_required';            // → customer (offer cascade exhausted)

/** Channels supported by the layer. `whatsapp` covers Twilio WABA + Meta. */
export type Channel = 'whatsapp' | 'sms' | 'email' | 'in_app' | 'push';

export type RecipientType = 'contractor' | 'customer' | 'admin';

export interface Recipient {
    type: RecipientType;
    id: string;          // user / contractor / customer id (admin = 'admin')
    /**
     * Display name for the recipient — used in template salutations.
     * Without this, callers shoved `id` (UUIDs / `pq_...` slugs) into "Hi {name}"
     * templates and customer messages came out as "Hi pq_stress_t_q11_moypqo2t".
     * Populate from `handyman_profiles.business_name` (contractor) or
     * `personalized_quotes.customer_name` (customer); admin can stay undefined.
     */
    name?: string;
    phone?: string;
    email?: string;
    timezone?: string;   // defaults Europe/London
}

export interface NotificationRequest {
    event: NotificationEvent;
    recipient: Recipient;
    /** Template variables. Shape is event-specific; templates document required keys. */
    payload: Record<string, unknown>;
    /** Bypass quiet hours. Reserved for time-critical ops alerts. */
    urgent?: boolean;
    /** Force a specific channel — tests + admin diagnostics. Skips fallback. */
    channelOverride?: Channel;
    /** Correlation id (e.g. quoteId / dispatchId) for the audit trail. */
    correlationId?: string;
}

export type DeliveryStatus = 'sent' | 'failed' | 'queued' | 'skipped';

export interface DeliveryResult {
    requestId: string;
    event: NotificationEvent;
    channel: Channel;
    status: DeliveryStatus;
    sentAt?: Date;
    error?: string;
    /** Channels we tried and bounced off before this one. Empty when primary worked. */
    fallbackTried?: Channel[];
    /** Provider message id when available (Twilio sid / Resend id). */
    messageId?: string;
}

/** What a channel adapter returns. */
export interface ChannelSendResult {
    status: 'sent' | 'failed';
    messageId?: string;
    error?: string;
}

/** Rendered message body, with optional subject for email. */
export interface RenderedMessage {
    subject?: string;
    body: string;
}
