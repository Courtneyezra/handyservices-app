// server/notifications/index.ts
//
// Module 10 — Notifications: orchestrator.
//
// Single entry point. Modules call `sendNotification` (or the convenience
// helpers `dispatchEvent` / `notifyOnTransition`) — never Twilio / SMTP /
// Meta directly.
//
// Pipeline:
//   1. Flag check       — FF_NOTIFICATIONS_V2 OFF → status='skipped' early
//   2. Channel select   — channelOverride > recipient default > fallback chain
//   3. Quiet hours      — defer unless urgent / urgent-event / exempt role
//   4. Render template  — missing required var → fail
//   5. Adapter call     — channel send; on failure walk the chain
//   6. Audit            — every terminal result hits routing_decisions
//
// Refs:
// - docs/architecture/modules/10-notifications.md (whole spec)
// - docs/architecture/state-machine.md (notifyOnTransition mapping)
// - docs/architecture/feature-flags.md (FF_NOTIFICATIONS_V2)

import { FLAGS } from '../feature-flags';
import {
    Channel,
    DeliveryResult,
    NotificationEvent,
    NotificationRequest,
    Recipient,
    RecipientType,
    RenderedMessage,
    ChannelSendResult,
} from './types';
import { hasTemplate, MissingTemplateVarError, renderTemplate } from './templates';
import { nextMorningSlot, shouldDeferUntilMorning } from './quiet-hours';
import {
    buildDeliveryResult,
    enqueue,
    recordAudit,
} from './delivery-tracking';
import * as whatsappCh from './channels/whatsapp';
import * as smsCh from './channels/sms';
import * as emailCh from './channels/email';
import * as inAppCh from './channels/in-app';

// ---------------------------------------------------------------------------
// Channel routing — defaults per recipient role + fallback chain.
// ---------------------------------------------------------------------------

const ROLE_DEFAULTS: Record<RecipientType, Channel> = {
    contractor: 'whatsapp',
    customer:   'whatsapp',
    admin:      'email',
};

/** Deterministic fallback walk for a given primary. WhatsApp → SMS → email → in-app. */
const FALLBACK_CHAIN: Record<Channel, Channel[]> = {
    whatsapp: ['sms', 'email', 'in_app'],
    sms:      ['whatsapp', 'email', 'in_app'],
    email:    ['sms', 'in_app'],
    in_app:   ['email'],
    push:     ['whatsapp', 'sms', 'email', 'in_app'],
};

function pickPrimary(req: NotificationRequest): Channel {
    if (req.channelOverride) return req.channelOverride;
    return ROLE_DEFAULTS[req.recipient.type];
}

// Walk primary → fallback channels, returning the first that has a template.
function* channelChain(req: NotificationRequest): Generator<Channel> {
    const visited = new Set<Channel>();
    const primary = pickPrimary(req);
    const chain: Channel[] = [primary, ...FALLBACK_CHAIN[primary]];
    for (const c of chain) {
        if (visited.has(c)) continue;
        visited.add(c);
        if (hasTemplate(req.event, c)) yield c;
    }
}

async function sendOnChannel(channel: Channel, recipient: Recipient, msg: RenderedMessage): Promise<ChannelSendResult> {
    switch (channel) {
        case 'whatsapp': return whatsappCh.send(recipient, msg);
        case 'sms':      return smsCh.send(recipient, msg);
        case 'email':    return emailCh.send(recipient, msg);
        case 'in_app':   return inAppCh.send(recipient, msg);
        case 'push':
            // Push channel reuses the in-app store for now (web push wiring is
            // module-local). Future: dispatch via web-push.ts.
            return inAppCh.send(recipient, msg);
        default:         return { status: 'failed', error: `unknown_channel:${channel}` };
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a single notification. Returns a DeliveryResult that records which
 * channel actually went out (after fallbacks) plus an audit row.
 *
 * When FF_NOTIFICATIONS_V2 is OFF, returns status='skipped' immediately.
 * Modules calling this on legacy paths still record `notification_skipped`
 * to the audit log so we can compare shadow-mode against legacy sends.
 */
export async function sendNotification(req: NotificationRequest): Promise<DeliveryResult> {
    const requestId = `nreq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!FLAGS.NOTIFICATIONS_V2) {
        const skipped = buildDeliveryResult(requestId, req.event, pickPrimary(req), 'skipped');
        await recordAudit({ requestId, correlationId: req.correlationId, event: req.event, channel: skipped.channel, status: 'skipped' });
        return skipped;
    }

    // Quiet hours — defer non-urgent customer-facing messages.
    const now = new Date();
    if (shouldDeferUntilMorning(req, now)) {
        const deferUntil = nextMorningSlot(now, req.recipient.timezone);
        enqueue(req, { deferUntil });
        const queued = buildDeliveryResult(requestId, req.event, pickPrimary(req), 'queued');
        await recordAudit({ requestId, correlationId: req.correlationId, event: req.event, channel: queued.channel, status: 'queued' });
        return queued;
    }

    const tried: Channel[] = [];
    let lastError: string | undefined;

    for (const channel of channelChain(req)) {
        let msg: RenderedMessage;
        try {
            const rendered = renderTemplate(req.event, channel, req.payload);
            if (!rendered) continue;  // shouldn't happen — generator already filtered
            msg = rendered;
        } catch (err) {
            if (err instanceof MissingTemplateVarError) {
                lastError = err.message;
                tried.push(channel);
                continue;
            }
            throw err;
        }

        const result = await sendOnChannel(channel, req.recipient, msg);
        if (result.status === 'sent') {
            const ok = buildDeliveryResult(requestId, req.event, channel, 'sent', {
                sentAt: new Date(),
                fallbackTried: tried.length > 0 ? tried : undefined,
                messageId: result.messageId,
            });
            await recordAudit({
                requestId,
                correlationId: req.correlationId,
                event: req.event,
                channel,
                status: 'sent',
                fallbackTried: tried.length > 0 ? tried : undefined,
                messageId: result.messageId,
            });
            return ok;
        }
        // Channel failed — record the attempt and walk the chain. We do
        // NOT bail on channelOverride mid-chain (operator wants only that
        // channel) — return failure immediately.
        tried.push(channel);
        lastError = result.error;
        if (req.channelOverride) break;
    }

    const finalChannel = tried[tried.length - 1] ?? pickPrimary(req);
    const failed = buildDeliveryResult(requestId, req.event, finalChannel, 'failed', {
        error: lastError ?? 'no_channel_succeeded',
        fallbackTried: tried,
    });
    await recordAudit({
        requestId,
        correlationId: req.correlationId,
        event: req.event,
        channel: finalChannel,
        status: 'failed',
        fallbackTried: tried,
        error: lastError,
    });
    return failed;
}

/**
 * Fan-out helper — one event, many recipients. Returns one DeliveryResult per
 * recipient. Failures on individual recipients don't stop the others.
 */
export async function dispatchEvent(
    event: NotificationEvent,
    recipients: Recipient[],
    payload: Record<string, unknown>,
    opts: { urgent?: boolean; correlationId?: string } = {},
): Promise<DeliveryResult[]> {
    const results = await Promise.all(recipients.map((recipient) => sendNotification({
        event,
        recipient,
        payload,
        urgent: opts.urgent,
        correlationId: opts.correlationId,
    })));
    return results;
}

// ---------------------------------------------------------------------------
// State-machine integration helper.
// ---------------------------------------------------------------------------

/**
 * Map a state transition to a notification event. Returns the event to fire,
 * or null when the transition has no notification side-effect.
 *
 * This map is the source of truth for which notifications fire on which
 * state changes. Other modules call `notifyOnTransition` from inside their
 * state-change handlers; this layer decides what (if anything) is sent.
 *
 * Refs: docs/architecture/state-machine.md, docs/architecture/modules/10-notifications.md §5
 */
export function eventForTransition(fromState: string, toState: string): NotificationEvent | null {
    const t = `${fromState}→${toState}`;
    switch (t) {
        case 'draft→quoted':                                  return 'quote_sent';
        case 'quoted→booked_pending_routing':                 return 'payment_received';
        case 'booked_pending_routing→offer_round_1':          return 'routing_offer_round_1';
        case 'offer_round_1→offer_round_2':                   return 'routing_offer_round_2';
        case 'offer_round_2→offer_round_3':                   return 'routing_offer_broadcast';
        case 'offer_round_1→dispatched':
        case 'offer_round_2→dispatched':
        case 'offer_round_3→dispatched':                      return 'offer_accepted';
        case 'booked_pending_routing→reserved_for_pack':      return 'pack_offered';
        case 'reserved_for_pack→dispatched':                  return 'pack_accepted';
        case 'reserved_for_pack→offer_round_1':               return 'pack_released';
        case 'dispatched→in_progress':                        return 'pre_arrival_reminder';
        case 'in_progress→completed_pending_review':          return 'job_completed';
        case 'completed_pending_review→paid_out':             return 'payout_fired';
        case 'offer_round_3→reschedule_required':             return 'reschedule_required';
        default: return null;
    }
}

/**
 * Fire-and-forget notification on a state transition. Other modules call
 * this from inside their state-change handlers. Recipients are resolved
 * by the caller (we don't reach into quotes / dispatches from here).
 *
 * Returns the DeliveryResult array (empty when no event maps).
 */
export async function notifyOnTransition(
    quoteId: string,
    fromState: string,
    toState: string,
    ctx: {
        recipients: Recipient[];
        payload: Record<string, unknown>;
        urgent?: boolean;
    },
): Promise<DeliveryResult[]> {
    const event = eventForTransition(fromState, toState);
    if (!event) return [];
    return dispatchEvent(event, ctx.recipients, ctx.payload, {
        urgent: ctx.urgent,
        correlationId: quoteId,
    });
}

// Re-exports for ergonomic imports elsewhere.
export type { NotificationEvent, NotificationRequest, DeliveryResult, Recipient, Channel } from './types';
