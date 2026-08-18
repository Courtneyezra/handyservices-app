/**
 * First-contact auto-responder — the ONE sanctioned exception to draft-and-approve.
 *
 * The owner's rule, verbatim: anything coming in for the FIRST time (a post-call follow-up, a
 * first webform submission, a first SMS or WhatsApp message from a number we have never replied
 * to) may be acknowledged automatically. Everything else keeps the approval gate.
 *
 * Four hard limits make that safe, and all four live here as server-side checks rather than as
 * instructions to a model:
 *
 *   1. FIRST CONTACT ONLY. `isFirstContact()` is a query, not a judgement: if this number has
 *      EVER received an outbound message from us, the gate stays on. There is no prompt to
 *      misread and no flag a caller can pass to skip it.
 *   2. ACKNOWLEDGEMENTS ONLY. The copy is composed here, from fixed variants — it can never
 *      contain a price, a date, a promise or an answer, because there is no code path that puts
 *      one in. The agent's own drafts stay on the approval queue.
 *   3. 24/7, BUT HONEST. A 9pm enquiry deserves an instant acknowledgement, so the UK 8-20
 *      quiet-hours guard that governs ordinary auto-send does not apply here. Instead the
 *      out-of-hours variant says we will come back first thing, rather than implying someone is
 *      at a desk. (The 8-20 guard is untouched for every non-first-contact auto-send.)
 *   4. SHUT WINDOW FALLS BACK, NEVER DROPS. Outside WhatsApp's 24h window only an approved
 *      template may go out, so we look one up by name at runtime; if nothing suitable is
 *      approved, the acknowledgement is queued for Ben instead of vanishing.
 *
 * Ships disabled (`comms_agent.firstContactAutoAck.enabled = false`).
 */
import { db } from './db';
import { conversations, messages, messageDrafts } from '@shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { queueDraft, approveAndSendDraft, type DraftSource } from './message-drafts';
import { canSendFreeform } from './meta-whatsapp';
import { findApprovedTemplate } from './whatsapp-templates';

// ---------------------------------------------------------------- config shape

export const FIRST_CONTACT_CHANNELS = ['whatsapp', 'sms', 'webform', 'post_call'] as const;
export type FirstContactChannel = (typeof FIRST_CONTACT_CHANNELS)[number];

export interface FirstContactAckConfig {
    /** Master switch for the exception itself. Ships false. */
    enabled: boolean;
    /** Which first-touch surfaces may auto-acknowledge. */
    channels: FirstContactChannel[];
}

export const DEFAULT_FIRST_CONTACT_ACK: FirstContactAckConfig = {
    enabled: false,
    channels: [...FIRST_CONTACT_CHANNELS],
};

/**
 * The only intents that may ever auto-send. Both are content-free by construction: they say we
 * have the message and will come back, and nothing else. Deliberately a subset of DRAFT_INTENTS
 * so the comms agent's whitelist vocabulary and this one cannot drift apart.
 */
export const FIRST_CONTACT_ACK_INTENTS = ['ack_enquiry', 'ack_photos'] as const;
export type FirstContactAckIntent = (typeof FIRST_CONTACT_ACK_INTENTS)[number];

/**
 * Templates we would accept for a first-contact acknowledgement when the freeform window is shut,
 * best first. Names, not SIDs: approval status is Meta's to change, and a template that is pending
 * today may be approved tomorrow without a deploy. Anything not currently approved is skipped.
 */
export const FIRST_CONTACT_TEMPLATE_PREFERENCE = [
    'first_contact_ack',   // a dedicated ack, if one is ever approved
    'video_request',       // UTILITY: "thanks for getting in touch, send a quick video"
    'postcode_request',    // UTILITY: acknowledges and asks the one thing we need to price
    '1_contact_generic',   // MARKETING fallback, reads as post-call ("as discussed")
];

async function readConfig(): Promise<FirstContactAckConfig> {
    // Lazy: this module is imported by hot ingest paths, and the comms agent module pulls in the
    // whole agent runner. Fail closed if the config cannot be read.
    try {
        const { getCommsAgentConfig } = await import('./agents/comms');
        return (await getCommsAgentConfig()).firstContactAutoAck;
    } catch (error: any) {
        console.error('[FirstContact] Could not read config, treating as disabled:', error?.message);
        return { ...DEFAULT_FIRST_CONTACT_ACK, enabled: false };
    }
}

// ---------------------------------------------------------------- the hard guard

/**
 * True only when we have NEVER sent this person anything.
 *
 * Checked against stored messages across every conversation row for the number (a customer can
 * have both an SMS and a WhatsApp thread) plus any draft that reached approved/sent. Errors and
 * unparseable numbers return false: "we could not prove this is a first contact" must mean the
 * approval gate stays on.
 */
export async function isFirstContact(input: { conversationId?: string | null; phone: string }): Promise<boolean> {
    try {
        const digits = input.phone.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) return false;

        const convRows = await db.select({ id: conversations.id }).from(conversations)
            .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`);

        const convIds = Array.from(new Set([
            ...convRows.map((c) => c.id),
            ...(input.conversationId ? [input.conversationId] : []),
        ]));

        if (convIds.length) {
            const [outbound] = await db.select({ id: messages.id }).from(messages)
                .where(and(inArray(messages.conversationId, convIds), eq(messages.direction, 'outbound')))
                .limit(1);
            if (outbound) return false;
        }

        // A draft that was approved or sent counts as a reply even if the message row is missing
        // (a failed send still means a human decided to talk to this person).
        const [priorDraft] = await db.select({ id: messageDrafts.id }).from(messageDrafts)
            .where(and(
                sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`,
                inArray(messageDrafts.status, ['approved', 'sent']),
            ))
            .limit(1);
        if (priorDraft) return false;

        return true;
    } catch (error: any) {
        console.error('[FirstContact] Guard query failed, assuming NOT first contact:', error?.message);
        return false; // Fail closed.
    }
}

// ---------------------------------------------------------------- the copy

/** UK local hour — "out of hours" means out of hours in Nottingham, not in UTC. */
export function ukHourNow(): number {
    return Number(new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric', hour12: false, timeZone: 'Europe/London',
    }).format(new Date()));
}

/** Same 8-20 boundary the ordinary auto-send guard uses — here it picks wording, not permission. */
export function isOutOfHours(hour = ukHourNow()): boolean {
    return hour < 8 || hour >= 20;
}

function greetingFor(contactName?: string | null): string {
    const name = (contactName ?? '').trim();
    if (!name || /^\+?\d/.test(name) || /^(unknown|customer|caller|test)/i.test(name)) return '';
    return ` ${name.split(/\s+/)[0]}`;
}

/**
 * The acknowledgement itself. Brand voice (brand-voice/whatsapp-comms.md): two short bursts split
 * on "---", no em dashes, no sign-off, no question. Nothing here states a price, a date, an
 * availability promise or an answer, and there is no branch that could add one.
 */
export function composeFirstContactAck(input: {
    intent: FirstContactAckIntent;
    contactName?: string | null;
    hour?: number;
}): { body: string; outOfHours: boolean; intent: FirstContactAckIntent } {
    const hour = input.hour ?? ukHourNow();
    const outOfHours = isOutOfHours(hour);
    const hi = `Hi${greetingFor(input.contactName)}`;

    const opener = input.intent === 'ack_photos'
        ? `${hi}, thanks for sending those over.`
        : `${hi}, thanks for getting in touch.`;

    const follow = outOfHours
        ? (input.intent === 'ack_photos'
            ? "Got them. You've caught us out of hours, so we'll have a proper look and come back to you first thing."
            : "You've caught us out of hours, so we'll come back to you first thing.")
        : (input.intent === 'ack_photos'
            ? "Got them. We'll have a look and come back to you shortly."
            : "We've got your message and we'll come back to you shortly.");

    return { body: `${opener}\n---\n${follow}`, outOfHours, intent: input.intent };
}

// ---------------------------------------------------------------- the lane entry point

export interface FirstContactAckResult {
    /** True only when a message actually went out. */
    sent: boolean;
    /** Machine-readable, always present — this is the audit trail for "why no ack?". */
    reason:
        | 'SENT'
        | 'DISABLED'
        | 'CHANNEL_NOT_ENABLED'
        | 'NOT_FIRST_CONTACT'
        | 'NO_PHONE'
        | 'QUEUED_NO_TEMPLATE'
        | 'DUPLICATE_DRAFT'
        | `SEND_REFUSED:${string}`
        | 'ERROR';
    draftId?: string;
    mode?: 'freeform' | 'template';
    intent?: FirstContactAckIntent;
    outOfHours?: boolean;
    body?: string;
    templateName?: string;
}

/**
 * Acknowledge a genuinely-first inbound, or explain why not. Never throws: a lane must not be able
 * to break ingest.
 *
 * Always ends in one of three states — sent, queued for Ben, or a logged reason for doing nothing.
 * It never queues when the feature is off or the thread is not a first contact, because in those
 * cases the ordinary comms-agent lane is already going to draft a better reply, and two competing
 * drafts on one thread is worse than none.
 */
export async function maybeAutoAckFirstContact(input: {
    conversationId?: string | null;
    phone: string;
    channel: FirstContactChannel;
    contactName?: string | null;
    /** Media on the first message makes it an ack_photos rather than an ack_enquiry. */
    hasMedia?: boolean;
}): Promise<FirstContactAckResult> {
    try {
        if (!input.phone || !input.phone.replace(/\D/g, '')) return { sent: false, reason: 'NO_PHONE' };

        const config = await readConfig();
        if (!config.enabled) return { sent: false, reason: 'DISABLED' };
        if (!config.channels.includes(input.channel)) return { sent: false, reason: 'CHANNEL_NOT_ENABLED' };

        // The gate. Everything after this line only runs for a number we have never messaged.
        if (!(await isFirstContact({ conversationId: input.conversationId, phone: input.phone }))) {
            return { sent: false, reason: 'NOT_FIRST_CONTACT' };
        }

        const intent: FirstContactAckIntent = input.hasMedia ? 'ack_photos' : 'ack_enquiry';
        const composed = composeFirstContactAck({ intent, contactName: input.contactName });

        const e164 = input.phone.includes('@c.us')
            ? `+${input.phone.replace('@c.us', '').replace(/\D/g, '')}`
            : input.phone;

        // Freeform needs an open WhatsApp window. An SMS-first contact never opens one, and
        // neither does a first message on a thread whose 24h has already elapsed.
        const windowOpen = await canSendFreeform(e164).catch(() => false);

        let body = composed.body;
        let contentSid: string | undefined;
        let contentVariables: Record<string, string> | undefined;
        let templateName: string | undefined;

        if (!windowOpen) {
            const picked = await findApprovedTemplate(
                FIRST_CONTACT_TEMPLATE_PREFERENCE,
                [greetingFor(input.contactName).trim() || 'there', 'the job'],
            );
            if (!picked) {
                // Nothing approved we can honestly send. Queue it so a human still sees it.
                const draftId = await queueDraft({
                    phone: e164,
                    body: composed.body,
                    source: 'first_contact_ack',
                    reason: `[${intent}] First contact on ${input.channel}, window shut and no approved template available. Needs a human.`,
                });
                console.log(`[FirstContact] ${e164}: window shut, no approved template — queued ${draftId ?? 'nothing (duplicate)'}`);
                return {
                    sent: false,
                    reason: draftId ? 'QUEUED_NO_TEMPLATE' : 'DUPLICATE_DRAFT',
                    draftId: draftId ?? undefined,
                    intent,
                    outOfHours: composed.outOfHours,
                    body: composed.body,
                };
            }
            body = picked.body;              // the approved wording, so the thread records what they saw
            contentSid = picked.template.sid;
            contentVariables = picked.variables;
            templateName = picked.template.name;
        }

        const draftId = await queueDraft({
            phone: e164,
            body,
            source: 'first_contact_ack',
            reason: `[${intent}] First contact on ${input.channel}${composed.outOfHours ? ', out of hours' : ''}${templateName ? `, template ${templateName}` : ''}. Auto-acknowledged.`,
            contentSid,
            contentVariables,
        });
        if (!draftId) return { sent: false, reason: 'DUPLICATE_DRAFT', intent };

        // Same claimed-row send path a human approval uses — so it is logged, deduped against
        // double-sends, and lands in the thread like any other outbound message.
        const result = await approveAndSendDraft(draftId, `first_contact_ack:${input.channel}`);
        if (!result.ok) {
            console.warn(`[FirstContact] ${e164}: send refused (${result.code}) — draft ${draftId} left for Ben`);
            return { sent: false, reason: `SEND_REFUSED:${result.code}`, draftId, intent, body };
        }

        console.log(`[FirstContact] ${e164}: auto-acked (${intent}, ${result.mode}${composed.outOfHours ? ', out of hours' : ''}) via draft ${draftId}`);
        return {
            sent: true, reason: 'SENT', draftId, mode: result.mode,
            intent, outOfHours: composed.outOfHours, body, templateName,
        };
    } catch (error: any) {
        console.error('[FirstContact] Auto-ack failed:', error?.message);
        return { sent: false, reason: 'ERROR' };
    }
}

/**
 * For callers that compose their own first-touch message and have already queued it (the post-call
 * video request, the webform acknowledgement): decide whether that specific draft may skip the
 * approval queue under the same first-contact rule.
 *
 * Leaves the draft pending on every refusal, so the worst case is the behaviour we had before.
 */
export async function maybeAutoSendFirstContactDraft(draftId: string, input: {
    conversationId?: string | null;
    phone: string;
    channel: FirstContactChannel;
}): Promise<FirstContactAckResult> {
    try {
        const config = await readConfig();
        if (!config.enabled) return { sent: false, reason: 'DISABLED', draftId };
        if (!config.channels.includes(input.channel)) return { sent: false, reason: 'CHANNEL_NOT_ENABLED', draftId };
        if (!(await isFirstContact({ conversationId: input.conversationId, phone: input.phone }))) {
            return { sent: false, reason: 'NOT_FIRST_CONTACT', draftId };
        }

        const result = await approveAndSendDraft(draftId, `first_contact_ack:${input.channel}`);
        if (!result.ok) {
            console.warn(`[FirstContact] ${input.phone}: ${input.channel} send refused (${result.code}) — draft ${draftId} left for Ben`);
            return { sent: false, reason: `SEND_REFUSED:${result.code}`, draftId };
        }
        console.log(`[FirstContact] ${input.phone}: ${input.channel} first-touch auto-sent via draft ${draftId} (${result.mode})`);
        return { sent: true, reason: 'SENT', draftId, mode: result.mode };
    } catch (error: any) {
        console.error('[FirstContact] Auto-send of queued draft failed:', error?.message);
        return { sent: false, reason: 'ERROR', draftId };
    }
}
