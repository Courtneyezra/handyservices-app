/**
 * THE RULES LAYER — content-free customer sends (Phase 1 of the comms rebuild, 2 Sep 2026).
 *
 * Design §2 principle 8: "Silence is a failure. Every inbound burst ends in a send, a pending
 * draft with a due time, or a flag with a due time that expires into a holding send. Never
 * nothing." Design §3.5: the rules layer is rung 3 on the elimination ladder — a template
 * ladder, no model, no judgement about the job. It owns two kinds of message:
 *
 *   sendHoldingLine  "we've got it, we're on it" — after 10 minutes of silence on an inbound,
 *                    when a flag for Ben passes its due time unanswered, or when a pending draft
 *                    passes its due time.
 *   sendAsk          the two content-free asks: a photo/video, or a postcode.
 *
 * What this module deliberately cannot say: a price, a date, a name of a person, "I". Copy is
 * fixed here, runs through the chat-voice guard, and is tested for all of that.
 *
 * Delivery reuses the first-contact ladder rather than re-implementing it: WhatsApp freeform when
 * the 24h window is open, else an approved Meta template by NAME, else SMS, else — and only then —
 * a pending draft for Ben. Every send passes through queueDraft → approveAndSendDraft →
 * sendCustomerMessage with the `rules.*` approver and the caller's run id, so the opt-out gate,
 * the near-duplicate hold, the ledger row and the WhatsApp→SMS fallback are the same ones a
 * human's approval gets.
 *
 * Suppression (checked before anything is queued, and pure so it is tested with fakes):
 *   · any outbound landed on the thread after the triggering inbound   → the customer is not waiting
 *   · the customer opted out (any scope)                                → we do not message them
 *   · a rules-layer holding line went out in the last 2 hours           → one holding line per wait
 */
import { db } from './db';
import { conversations, messages, messageDrafts } from '@shared/schema';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { queueDraft, approveAndSendDraft } from './message-drafts';
import { canSendFreeform } from './meta-whatsapp';
import { findApprovedTemplateWithValues } from './whatsapp-template-sync';
import { isNonMobileUkNumber, isTestNumber } from './phone-utils';
import { isSmsSenderConfigured } from './whatsapp-sender';
import { notQuarantined } from './message-quarantine';
import { getOptOut } from './opt-out';
import { isLikelyRealName } from '@shared/contact-name';
import { toChatVoice, chatVoiceViolations } from '@shared/chat-voice';
import { logSystemEvent } from './system-events';
import type { Approver } from './approver';

export type HoldingKind = 'silence' | 'flag_expiry' | 'draft_expiry';
export type AskKind = 'ask_media' | 'ask_postcode' | 'ask_name';
export type RulesKind = HoldingKind | AskKind;

/** One holding line per wait: nothing from this module twice inside this window. */
export const HOLDING_SUPPRESS_WINDOW_MS = 2 * 60 * 60_000;

// ---------------------------------------------------------------- copy
//
// Handy voice (brand-voice/whatsapp-comms.md): short bursts, plain English, "we" not "I", no em
// dashes, no prices, no dates, no names of people, one ask per message, never "let me know when
// suits". "Handy Services" rather than "Ben" — the rules layer is not a person (design §4, bot
// disclosure). Bursts are separated by the '---' convention approveAndSendDraft already splits on.

export const HOLDING_COPY: Record<HoldingKind, string> = {
    silence: [
        'Thanks for your message, we\'ve got it.',
        'Just looking at it now, we\'ll come back to you shortly.',
    ].join('\n---\n'),
    flag_expiry: [
        'Sorry for the wait on this one.',
        'It is with the team now and we will come straight back to you once we have an answer.',
    ].join('\n---\n'),
    draft_expiry: [
        'Just so you know, we have not forgotten you.',
        'Your reply is being checked and we will send it over shortly.',
    ].join('\n---\n'),
};

export const ASK_COPY: Record<AskKind, string> = {
    ask_media: [
        'Could you send a quick photo or video of the job?',
        'A clip of where the problem is helps us get it right first time.',
    ].join('\n---\n'),
    ask_postcode: 'Could you send us your postcode please? Just the postcode is fine for now.',
    ask_name: 'Nearly ready to send your quote over. What name should we put on it?',
};

/**
 * Approved Meta templates to try, by NAME, when the 24h window is shut. Best first. Names not yet
 * approved are skipped by findApprovedTemplateWithValues, so listing one that does not exist yet
 * is a plan, not a bug: 'holding_line' is the honest wording and belongs in the next template
 * submission (one template per purpose, see docs/WHATSAPP-TEMPLATES.md). Until it is approved the
 * ladder falls to SMS, which needs no template — the customer is never left silent either way.
 * Variables are positional: {{1}} first name (or "there").
 */
/**
 * Meta template names, most preferred first. `holding_line_v1` is the Phase 3 submission
 * (scripts/_submit-holding-template.ts): "Hi {{1}}, thanks for your message, we've got it. Just
 * looking at it now, we'll come back to you shortly." — the same words as HOLDING_COPY.silence, so
 * a customer outside the 24h window reads what one inside it reads. `holding_line` is the older
 * name, kept as a fallback until the new one is approved.
 */
export const HOLDING_TEMPLATE_NAME = 'holding_line_v1';
export const HOLDING_TEMPLATE_BODY = "Hi {{1}}, thanks for your message, we've got it. Just looking at it now, we'll come back to you shortly.";
export const HOLDING_TEMPLATE_PREFERENCE: Record<HoldingKind, string[]> = {
    silence: [HOLDING_TEMPLATE_NAME, 'holding_line'],
    flag_expiry: [HOLDING_TEMPLATE_NAME, 'holding_line'],
    draft_expiry: [HOLDING_TEMPLATE_NAME, 'holding_line'],
};
export const ASK_TEMPLATE_PREFERENCE: Record<AskKind, string[]> = {
    ask_media: ['video_request', 'job_video_request'],
    ask_postcode: ['postcode_request'],
    ask_name: [],
};

export const RULES_APPROVER: Record<RulesKind, Approver> = {
    silence: 'rules.holding',
    flag_expiry: 'rules.holding',
    draft_expiry: 'rules.holding',
    ask_media: 'rules.ask',
    ask_postcode: 'rules.ask',
    ask_name: 'rules.ask',
};

/** Guard every fixed line at module load: a dash or a banned closer here is a build bug. */
for (const [k, body] of [...Object.entries(HOLDING_COPY), ...Object.entries(ASK_COPY)]) {
    const v = chatVoiceViolations(body);
    if (v.length) throw new Error(`[RulesLayer] copy for ${k} violates chat voice: ${v.join(', ')}`);
}

// ---------------------------------------------------------------- suppression (pure)

export interface SuppressionState {
    /** The inbound this send answers. */
    triggeringInboundAt: Date | null;
    /** Newest customer-visible outbound on the thread, if any. */
    lastOutboundAt: Date | null;
    /** Newest rules-layer send on this thread, if any. */
    lastRulesSendAt: Date | null;
    optedOut: boolean;
    testNumber: boolean;
    archived: boolean;
    now: Date;
}

export type SuppressReason = 'answered' | 'opted_out' | 'recent_holding' | 'test_number' | 'archived' | null;

/** The whole decision in one pure function so it can be attacked with fakes. */
export function suppressReason(s: SuppressionState): SuppressReason {
    if (s.archived) return 'archived';
    if (s.testNumber) return 'test_number';
    if (s.optedOut) return 'opted_out';
    if (s.triggeringInboundAt && s.lastOutboundAt && s.lastOutboundAt.getTime() > s.triggeringInboundAt.getTime()) return 'answered';
    if (s.lastRulesSendAt && s.now.getTime() - s.lastRulesSendAt.getTime() < HOLDING_SUPPRESS_WINDOW_MS) return 'recent_holding';
    return null;
}

export { isTestNumber } from './phone-utils';

/** First name for a template slot, or "there" — never a system-stamped label. */
export function templateNameSlot(contactName?: string | null): string {
    const name = (contactName ?? '').trim();
    if (!name || /^(unknown|customer|caller|test|website|web\b|visitor|lead|enquiry)/i.test(name) || !isLikelyRealName(name)) return 'there';
    return name.split(/\s+/)[0];
}

// ---------------------------------------------------------------- delivery

export interface RulesSendResult {
    sent: boolean;
    kind: RulesKind;
    reason:
        | 'SENT' | 'SUPPRESSED' | 'NO_CONVERSATION' | 'NO_PHONE'
        | 'QUEUED_NO_CHANNEL' | 'SEND_REFUSED' | 'DUPLICATE_DRAFT' | 'ERROR';
    suppressedBy?: SuppressReason;
    draftId?: string | null;
    mode?: 'freeform' | 'template' | 'sms';
    detail?: string;
}

interface ThreadState {
    id: string;
    e164: string;
    contactName: string | null;
    archived: boolean;
    metadata: Record<string, any>;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    lastRulesSendAt: Date | null;
}

async function loadThread(conversationId: string): Promise<ThreadState | null> {
    const [conv] = await db.select({
        id: conversations.id,
        phoneNumber: conversations.phoneNumber,
        contactName: conversations.contactName,
        archivedAt: conversations.archivedAt,
        metadata: conversations.metadata,
    }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) return null;
    const digits = (conv.phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
    const [lastIn] = await db.select({ at: messages.createdAt }).from(messages)
        .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'inbound'), notQuarantined))
        .orderBy(desc(messages.createdAt)).limit(1);
    const [lastOut] = await db.select({ at: messages.createdAt }).from(messages)
        .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'outbound'), notQuarantined))
        .orderBy(desc(messages.createdAt)).limit(1);
    const meta = (conv.metadata ?? {}) as Record<string, any>;
    const stamped = meta.rulesLayer?.lastSentAt ? new Date(meta.rulesLayer.lastSentAt) : null;
    // Belt and braces: the metadata stamp is the fast path; the draft table is the truth.
    const [lastRulesDraft] = await db.select({ at: messageDrafts.sentAt }).from(messageDrafts)
        .where(and(
            eq(messageDrafts.source, 'rules_layer'),
            eq(messageDrafts.status, 'sent'),
            sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`,
            gte(messageDrafts.sentAt, new Date(Date.now() - HOLDING_SUPPRESS_WINDOW_MS)),
        )).orderBy(desc(messageDrafts.sentAt)).limit(1);
    const fromDrafts = lastRulesDraft?.at ? new Date(lastRulesDraft.at) : null;
    const lastRulesSendAt = [stamped, fromDrafts].filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
        id: conv.id,
        e164: digits ? `+${digits}` : '',
        contactName: conv.contactName ?? null,
        archived: !!conv.archivedAt,
        metadata: meta,
        lastInboundAt: lastIn?.at ? new Date(lastIn.at) : null,
        lastOutboundAt: lastOut?.at ? new Date(lastOut.at) : null,
        lastRulesSendAt,
    };
}

async function stampRulesSend(conversationId: string, kind: RulesKind, draftId: string, at: Date): Promise<void> {
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('rulesLayer', jsonb_build_object('lastSentAt', ${at.toISOString()}::text, 'kind', ${kind}::text, 'draftId', ${draftId}::text))`,
        updatedAt: at,
    }).where(eq(conversations.id, conversationId));
}

async function deliver(input: {
    conversationId: string;
    kind: RulesKind;
    runId: string;
    body: string;
    templateNames: string[];
    /** For the reason column and the ledger line. */
    why: string;
    /** Phase 4: a human's own tap from the quote card is approved by that human, not by the rule. */
    approver?: Approver;
}): Promise<RulesSendResult> {
    const { kind } = input;
    try {
        const thread = await loadThread(input.conversationId);
        if (!thread) return { sent: false, kind, reason: 'NO_CONVERSATION' };
        if (!thread.e164) return { sent: false, kind, reason: 'NO_PHONE' };

        const optedOut = !!(await getOptOut(thread.e164).catch(() => null));
        const suppressed = suppressReason({
            triggeringInboundAt: thread.lastInboundAt,
            lastOutboundAt: thread.lastOutboundAt,
            lastRulesSendAt: thread.lastRulesSendAt,
            optedOut,
            testNumber: isTestNumber(thread.e164),
            archived: thread.archived,
            now: new Date(),
        });
        if (suppressed) {
            console.log(`[RulesLayer] ${kind} suppressed on ${thread.id}: ${suppressed}`);
            return { sent: false, kind, reason: 'SUPPRESSED', suppressedBy: suppressed };
        }

        // The pipe, exactly as first-contact-ack.ts decides it.
        const smsOnly = isNonMobileUkNumber(thread.e164);
        const windowOpen = smsOnly ? false : await canSendFreeform(thread.e164).catch(() => false);
        let body = toChatVoice(input.body);
        let contentSid: string | undefined;
        let contentVariables: Record<string, string> | undefined;
        let templateName: string | undefined;
        if (!smsOnly && !windowOpen) {
            const picked = await findApprovedTemplateWithValues(input.templateNames, [templateNameSlot(thread.contactName)]);
            if (picked) {
                body = picked.body;
                contentSid = picked.template.sid;
                contentVariables = picked.variables;
                templateName = picked.template.name;
            } else if (!isSmsSenderConfigured()) {
                // No window, no template, no SMS: the one case we cannot speak. Queue for Ben so the
                // wait is at least visible, and say why in the reason.
                const draftId = await queueDraft({
                    phone: thread.e164, body, source: 'rules_layer',
                    reason: `[${kind}] ${input.why} Window shut, no approved template and no SMS sender. Needs a human.`,
                    dedupe: true,
                });
                void logSystemEvent({
                    kind: 'hold', phone: thread.e164, conversationId: thread.id, source: 'rules-layer',
                    summary: `${kind}: could not send (no channel) — queued ${draftId ?? 'nothing (duplicate)'} for Ben`,
                    detail: { kind, runId: input.runId, draftId },
                });
                return { sent: false, kind, reason: 'QUEUED_NO_CHANNEL', draftId };
            }
        }
        const channel: 'whatsapp' | 'sms' = smsOnly || (!windowOpen && !contentSid) ? 'sms' : 'whatsapp';

        const draftId = await queueDraft({
            phone: thread.e164, body, channel, source: 'rules_layer',
            reason: `[${kind}] ${input.why}${templateName ? ` Template ${templateName}.` : ''}${channel === 'sms' ? ' By SMS.' : ''} Rules layer, run ${input.runId}.`,
            contentSid, contentVariables,
            dedupe: false,
            purpose: 'service_reply',
        });
        if (!draftId) return { sent: false, kind, reason: 'DUPLICATE_DRAFT' };

        const result = await approveAndSendDraft(draftId, input.approver ?? RULES_APPROVER[kind], input.runId);
        if (!result.ok) {
            console.warn(`[RulesLayer] ${kind} on ${thread.id} refused (${result.code}): ${result.message}`);
            void logSystemEvent({
                kind: 'hold', phone: thread.e164, conversationId: thread.id, source: 'rules-layer',
                summary: `${kind}: send refused (${result.code}) — draft ${draftId} left pending`,
                detail: { kind, runId: input.runId, draftId, code: result.code },
            });
            return { sent: false, kind, reason: 'SEND_REFUSED', draftId, detail: result.code };
        }
        const at = new Date();
        await stampRulesSend(thread.id, kind, draftId, at).catch((e: any) => console.warn('[RulesLayer] stamp failed:', e?.message));
        void logSystemEvent({
            kind: 'send', phone: thread.e164, conversationId: thread.id, source: 'rules-layer',
            summary: `${kind}: ${input.why} (${result.mode})`,
            detail: { kind, runId: input.runId, draftId, mode: result.mode, channel: result.channel, fellBack: result.fellBack, approver: RULES_APPROVER[kind] },
        });
        console.log(`[RulesLayer] ${kind} sent on ${thread.id} via ${result.mode} (run ${input.runId})`);
        return { sent: true, kind, reason: 'SENT', draftId, mode: result.mode };
    } catch (error: any) {
        console.error(`[RulesLayer] ${kind} failed on ${input.conversationId}:`, error?.message ?? error);
        return { sent: false, kind, reason: 'ERROR', detail: error?.message };
    }
}

const HOLDING_WHY: Record<HoldingKind, string> = {
    silence: 'No outbound 10 min after the customer wrote.',
    flag_expiry: 'A flag for Ben passed its due time unanswered.',
    draft_expiry: 'A pending draft passed its due time.',
};
const ASK_WHY: Record<AskKind, string> = {
    ask_media: 'Content-free media ask.',
    ask_postcode: 'Content-free postcode ask.',
    ask_name: 'Content-free name ask.',
};

/** "We have got it" — the send that means a customer can never be waiting in silence. */
/** Newest rules-layer ASK on a thread within `withinMs` (default 24h), for the one-ask-per-day rule. */
export async function lastRulesAsk(conversationId: string, withinMs: number = 24 * 3600_000): Promise<{ kind: AskKind; at: Date } | null> {
    const since = new Date(Date.now() - withinMs);
    const [conv] = await db.select({ metadata: conversations.metadata, phoneNumber: conversations.phoneNumber })
        .from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) return null;
    const meta = (conv.metadata ?? {}) as Record<string, any>;
    const candidates: { kind: AskKind; at: Date }[] = [];
    const stampedKind = meta.rulesLayer?.kind;
    const stampedAt = meta.rulesLayer?.lastSentAt ? new Date(meta.rulesLayer.lastSentAt) : null;
    if ((stampedKind === 'ask_media' || stampedKind === 'ask_postcode') && stampedAt && stampedAt.getTime() >= since.getTime()) {
        candidates.push({ kind: stampedKind, at: stampedAt });
    }
    const digits = (conv.phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
    if (digits) {
        const rows = await db.select({ reason: messageDrafts.reason, at: messageDrafts.sentAt }).from(messageDrafts)
            .where(and(
                eq(messageDrafts.source, 'rules_layer'), eq(messageDrafts.status, 'sent'),
                sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`,
                gte(messageDrafts.sentAt, since),
            )).orderBy(desc(messageDrafts.sentAt)).limit(5);
        for (const r of rows) {
            const m = /^\[(ask_media|ask_postcode)\]/.exec(r.reason ?? '');
            if (m && r.at) candidates.push({ kind: m[1] as AskKind, at: new Date(r.at) });
        }
    }
    return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
}

export async function sendHoldingLine(conversationId: string, kind: HoldingKind, runId: string): Promise<RulesSendResult> {
    return deliver({
        conversationId, kind, runId,
        body: HOLDING_COPY[kind],
        templateNames: HOLDING_TEMPLATE_PREFERENCE[kind],
        why: HOLDING_WHY[kind],
    });
}

/** The two content-free asks. Same ladder, same suppression, `rules.ask` approver. */
export async function sendAsk(conversationId: string, kind: AskKind, runId: string, opts: { approver?: Approver } = {}): Promise<RulesSendResult> {
    return deliver({
        conversationId, kind, runId,
        body: ASK_COPY[kind],
        templateNames: ASK_TEMPLATE_PREFERENCE[kind],
        why: ASK_WHY[kind],
        approver: opts.approver,
    });
}
