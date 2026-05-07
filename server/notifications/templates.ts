// server/notifications/templates.ts
//
// Module 10 — Notifications Layer: per (event × channel) message templates.
//
// A template renderer is a pure function: payload → { subject?, body }.
// Missing required vars throw — caught by the orchestrator, recorded as a
// failed delivery rather than crashing the worker.
//
// User-supplied substrings are escaped where they hit Twilio Content
// templates upstream. Inline string-template renderers below are plain
// concatenation — only operators control these payloads (they originate
// from internal modules), but the renderer still rejects undefined values
// to surface bugs early.
//
// Refs: docs/architecture/modules/10-notifications.md §7

import type { Channel, NotificationEvent, RenderedMessage } from './types';

type Renderer = (payload: Record<string, any>) => RenderedMessage;

export class MissingTemplateVarError extends Error {
    constructor(event: NotificationEvent, channel: Channel, key: string) {
        super(`notifications: template ${event}/${channel} missing required var '${key}'`);
        this.name = 'MissingTemplateVarError';
    }
}

/** Required-var helper. Returns the string; throws if missing/blank. */
function req(payload: Record<string, any>, key: string, event: NotificationEvent, channel: Channel): string {
    const v = payload[key];
    if (v === undefined || v === null || v === '') {
        throw new MissingTemplateVarError(event, channel, key);
    }
    return String(v);
}

/** Optional-var helper. */
function opt(payload: Record<string, any>, key: string, fallback = ''): string {
    const v = payload[key];
    return v === undefined || v === null ? fallback : String(v);
}

/** Currency formatter (pence → £x.xx) tolerant of either pence or pounds. */
function money(payload: Record<string, any>, payKey = 'payAmount'): string {
    const raw = payload[payKey];
    if (typeof raw === 'number') {
        // Heuristic: > 1000 assumed pence; else assumed pounds.
        return raw > 1000 ? `£${(raw / 100).toFixed(2)}` : `£${raw.toFixed(2)}`;
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return raw.startsWith('£') ? raw : `£${raw}`;
    }
    return '£—';
}

// ---------------------------------------------------------------------------
// Registry — Partial<Record<Channel, Renderer>>; missing channel triggers
// fallback per the orchestrator's chain rules.
// ---------------------------------------------------------------------------

export const TEMPLATES: Record<NotificationEvent, Partial<Record<Channel, Renderer>>> = {
    // -----------------------------------------------------------------
    // Customer-facing — quote lifecycle
    // -----------------------------------------------------------------
    quote_sent: {
        whatsapp: (p) => ({
            body: `Hi ${req(p, 'customerName', 'quote_sent', 'whatsapp')}, your Handy quote is ready: ${req(p, 'url', 'quote_sent', 'whatsapp')}`,
        }),
        sms: (p) => ({
            body: `Hi ${req(p, 'customerName', 'quote_sent', 'sms')}, your Handy quote: ${req(p, 'url', 'quote_sent', 'sms')}`,
        }),
        email: (p) => ({
            subject: 'Your Handy Services quote',
            body: `Hi ${req(p, 'customerName', 'quote_sent', 'email')},\n\nYour quote is ready to view here: ${req(p, 'url', 'quote_sent', 'email')}\n\nThe Handy Services team`,
        }),
    },

    payment_received: {
        email: (p) => ({
            subject: 'Booking confirmed — payment received',
            body: `Hi ${req(p, 'customerName', 'payment_received', 'email')},\n\nWe've received your payment for ${opt(p, 'jobDescription', 'your job')}. We'll be in touch shortly with your scheduled slot.\n\nReference: ${opt(p, 'jobId', '—')}`,
        }),
        sms: (p) => ({
            body: `Handy: payment received for ${opt(p, 'jobDescription', 'your job')}. We'll confirm your slot shortly. Ref ${opt(p, 'jobId', '—')}`,
        }),
        whatsapp: (p) => ({
            body: `Hi ${req(p, 'customerName', 'payment_received', 'whatsapp')}, payment received — booking confirmed. We'll text the slot when locked.`,
        }),
    },

    // -----------------------------------------------------------------
    // Contractor-facing — single-job offers
    // -----------------------------------------------------------------
    routing_offer_round_1: {
        whatsapp: (p) => ({
            body: `${req(p, 'contractorFirstName', 'routing_offer_round_1', 'whatsapp')}, new job: ${req(p, 'title', 'routing_offer_round_1', 'whatsapp')} in ${req(p, 'postcode', 'routing_offer_round_1', 'whatsapp')}, ${money(p)}. Tap: ${req(p, 'offerUrl', 'routing_offer_round_1', 'whatsapp')}`,
        }),
        sms: (p) => ({
            body: `Handy: new job ${money(p)} in ${req(p, 'postcode', 'routing_offer_round_1', 'sms')} — ${req(p, 'offerUrl', 'routing_offer_round_1', 'sms')}`,
        }),
    },

    routing_offer_round_2: {
        whatsapp: (p) => ({
            body: `${req(p, 'contractorFirstName', 'routing_offer_round_2', 'whatsapp')}, job offer (round 2): ${req(p, 'title', 'routing_offer_round_2', 'whatsapp')}, ${req(p, 'postcode', 'routing_offer_round_2', 'whatsapp')}, ${money(p)}. ${req(p, 'offerUrl', 'routing_offer_round_2', 'whatsapp')}`,
        }),
        sms: (p) => ({
            body: `Handy: still open ${money(p)} ${req(p, 'postcode', 'routing_offer_round_2', 'sms')} — ${req(p, 'offerUrl', 'routing_offer_round_2', 'sms')}`,
        }),
    },

    routing_offer_broadcast: {
        whatsapp: (p) => ({
            body: `Open job: ${req(p, 'title', 'routing_offer_broadcast', 'whatsapp')} in ${req(p, 'postcode', 'routing_offer_broadcast', 'whatsapp')}, ${money(p)}. First to accept wins: ${req(p, 'offerUrl', 'routing_offer_broadcast', 'whatsapp')}`,
        }),
        sms: (p) => ({
            body: `Handy open job ${money(p)} ${req(p, 'postcode', 'routing_offer_broadcast', 'sms')} — first to grab: ${req(p, 'offerUrl', 'routing_offer_broadcast', 'sms')}`,
        }),
    },

    offer_accepted: {
        whatsapp: (p) => ({
            body: `Booked. ${req(p, 'title', 'offer_accepted', 'whatsapp')} on ${req(p, 'startTime', 'offer_accepted', 'whatsapp')}. Address: ${req(p, 'address', 'offer_accepted', 'whatsapp')}.`,
        }),
        sms: (p) => ({
            body: `Booked: ${req(p, 'title', 'offer_accepted', 'sms')} ${req(p, 'startTime', 'offer_accepted', 'sms')} — ${req(p, 'address', 'offer_accepted', 'sms')}`,
        }),
        email: (p) => ({
            subject: 'Booking locked',
            body: `Job booked: ${req(p, 'title', 'offer_accepted', 'email')}\nWhen: ${req(p, 'startTime', 'offer_accepted', 'email')}\nWhere: ${req(p, 'address', 'offer_accepted', 'email')}`,
        }),
    },

    // -----------------------------------------------------------------
    // Day-Pack lifecycle
    // -----------------------------------------------------------------
    pack_offered: {
        whatsapp: (p) => ({
            body: `${req(p, 'contractorFirstName', 'pack_offered', 'whatsapp')}, ${req(p, 'date', 'pack_offered', 'whatsapp')} day-pack ready: ${req(p, 'stopCount', 'pack_offered', 'whatsapp')} stops in ${req(p, 'area', 'pack_offered', 'whatsapp')}, ${money(p, 'dayRate')} guaranteed. ${req(p, 'offerUrl', 'pack_offered', 'whatsapp')}`,
        }),
        sms: (p) => ({
            body: `Handy day-pack ${req(p, 'date', 'pack_offered', 'sms')}: ${req(p, 'stopCount', 'pack_offered', 'sms')} stops, ${money(p, 'dayRate')} — ${req(p, 'offerUrl', 'pack_offered', 'sms')}`,
        }),
    },

    pack_accepted: {
        email: (p) => ({
            subject: `Day-pack accepted — ${opt(p, 'date', 'TBD')}`,
            body: `Pack ${opt(p, 'packId', '')} accepted by ${opt(p, 'contractorName', 'contractor')}. ${opt(p, 'stopCount', 0)} stops, ${money(p, 'dayRate')}.`,
        }),
        in_app: (p) => ({
            body: `Day-pack accepted by ${opt(p, 'contractorName', 'contractor')} — ${opt(p, 'stopCount', 0)} stops`,
        }),
        sms: (p) => ({
            body: `Your booked job is on a day-pack — ETA window confirmed for ${opt(p, 'date', 'the agreed day')}.`,
        }),
    },

    pack_released: {
        email: (p) => ({
            subject: `Day-pack released — ${opt(p, 'date', '')}`,
            body: `Pack ${req(p, 'packId', 'pack_released', 'email')} expired/cancelled. ${opt(p, 'stopCount', 0)} stops spilled back to single-offer round 1.`,
        }),
        in_app: (p) => ({
            body: `Pack released — ${opt(p, 'stopCount', 0)} stops spilled to round 1`,
        }),
    },

    // -----------------------------------------------------------------
    // Day-of-job
    // -----------------------------------------------------------------
    pre_arrival_reminder: {
        sms: (p) => ({
            body: `Handy: contractor en-route, arriving ~${req(p, 'etaMinutes', 'pre_arrival_reminder', 'sms')} min for ${opt(p, 'jobDescription', 'your job')}.`,
        }),
        whatsapp: (p) => ({
            body: `Handy: ${opt(p, 'contractorFirstName', 'your contractor')} is en-route, ETA ~${req(p, 'etaMinutes', 'pre_arrival_reminder', 'whatsapp')} min.`,
        }),
        push: (p) => ({
            body: `En-route — ETA ${req(p, 'etaMinutes', 'pre_arrival_reminder', 'push')} min`,
        }),
    },

    check_in_no_show: {
        email: (p) => ({
            subject: `[ALERT] No check-in — ${opt(p, 'jobId', '')}`,
            body: `Job ${req(p, 'jobId', 'check_in_no_show', 'email')} (contractor ${opt(p, 'contractorName', '?')}) has not checked in. Slot was ${opt(p, 'slotStart', '?')}.`,
        }),
        sms: (p) => ({
            body: `[ALERT] no check-in for job ${req(p, 'jobId', 'check_in_no_show', 'sms')}`,
        }),
        in_app: (p) => ({
            body: `No check-in: job ${req(p, 'jobId', 'check_in_no_show', 'in_app')}`,
        }),
    },

    job_completed: {
        sms: (p) => ({
            body: `Handy: job complete. We'd love a quick review — ${req(p, 'reviewUrl', 'job_completed', 'sms')}`,
        }),
        email: (p) => ({
            subject: 'Your Handy job is complete',
            body: `Hi ${opt(p, 'customerName', 'there')},\n\nThank you — ${opt(p, 'contractorName', 'your contractor')} has finished the work. Could you spare 30 seconds to leave a review? ${req(p, 'reviewUrl', 'job_completed', 'email')}`,
        }),
    },

    review_window_close: {
        whatsapp: (p) => ({
            body: `${opt(p, 'contractorFirstName', 'Hi')}, payout for ${opt(p, 'jobDescription', 'job')} is queued — review window closes shortly.`,
        }),
        sms: (p) => ({
            body: `Handy: payout for ${opt(p, 'jobId', 'job')} is being released.`,
        }),
    },

    // -----------------------------------------------------------------
    // Payouts + adjustments
    // -----------------------------------------------------------------
    payout_fired: {
        whatsapp: (p) => ({
            body: `${opt(p, 'contractorFirstName', 'Hi')}, payout ${money(p, 'amount')} sent for ${opt(p, 'jobDescription', 'your job')}. Ref ${opt(p, 'payoutId', '—')}.`,
        }),
        email: (p) => ({
            subject: `Handy payout ${money(p, 'amount')} sent`,
            body: `Payout ${money(p, 'amount')} fired for job ${opt(p, 'jobId', '—')}. Reference ${opt(p, 'payoutId', '—')}.`,
        }),
        sms: (p) => ({
            body: `Handy payout ${money(p, 'amount')} sent — ref ${opt(p, 'payoutId', '—')}`,
        }),
    },

    pay_adjustment_filed: {
        email: (p) => ({
            subject: `Pay adjustment filed — ${opt(p, 'type', '?')}`,
            body: `Contractor ${opt(p, 'contractorName', '?')} filed a ${req(p, 'type', 'pay_adjustment_filed', 'email')} adjustment for job ${opt(p, 'jobId', '?')}, ${money(p, 'amount')}.`,
        }),
        in_app: (p) => ({
            body: `New pay adjustment: ${opt(p, 'type', '?')} ${money(p, 'amount')} on job ${opt(p, 'jobId', '?')}`,
        }),
    },

    pay_adjustment_approved: {
        whatsapp: (p) => ({
            body: `${opt(p, 'contractorFirstName', 'Hi')}, your pay adjustment ${money(p, 'amount')} on ${opt(p, 'jobDescription', 'job')} has been approved.`,
        }),
        sms: (p) => ({
            body: `Handy: pay adjustment ${money(p, 'amount')} approved for ${opt(p, 'jobId', 'your job')}.`,
        }),
        email: (p) => ({
            subject: 'Pay adjustment approved',
            body: `Your ${opt(p, 'type', '')} adjustment of ${money(p, 'amount')} has been approved on job ${opt(p, 'jobId', '')}.`,
        }),
    },

    reschedule_required: {
        whatsapp: (p) => ({
            body: `Hi ${opt(p, 'customerName', 'there')}, we couldn't lock a contractor for ${opt(p, 'date', 'your slot')}. Pick a new slot: ${req(p, 'rescheduleUrl', 'reschedule_required', 'whatsapp')}`,
        }),
        sms: (p) => ({
            body: `Handy: please pick a new slot for your job — ${req(p, 'rescheduleUrl', 'reschedule_required', 'sms')}`,
        }),
        email: (p) => ({
            subject: 'Please reschedule your Handy job',
            body: `Hi ${opt(p, 'customerName', 'there')},\n\nWe weren't able to lock a contractor for ${opt(p, 'date', 'your slot')}. Pick a fresh slot here: ${req(p, 'rescheduleUrl', 'reschedule_required', 'email')}`,
        }),
    },
};

/**
 * Render a template for a given event/channel. Throws
 * MissingTemplateVarError when a required payload var is missing.
 * Returns null when no template exists for that channel — orchestrator
 * uses this to walk the fallback chain.
 */
export function renderTemplate(event: NotificationEvent, channel: Channel, payload: Record<string, unknown>): RenderedMessage | null {
    const renderer = TEMPLATES[event]?.[channel];
    if (!renderer) return null;
    return renderer(payload as Record<string, any>);
}

/** True if (event × channel) has a renderer. */
export function hasTemplate(event: NotificationEvent, channel: Channel): boolean {
    return TEMPLATES[event]?.[channel] !== undefined;
}

/** All events that have at least one channel template. Used in startup sanity. */
export function listEvents(): NotificationEvent[] {
    return Object.keys(TEMPLATES) as NotificationEvent[];
}
