/**
 * Automated post-call WhatsApp outreach.
 *
 * When an inbound call ends, send the caller the approved "send us a video" WhatsApp template so
 * the job can be quoted without a site visit.
 *
 * Two things constrain the design:
 *
 * 1. A phone call does NOT open WhatsApp's 24-hour freeform window — only an inbound WhatsApp
 *    message does. So post-call outreach is always a template send, and the wording is whatever
 *    Meta approved on the template. Editing copy in the app cannot change what goes out here.
 *
 * 2. This codebase has been burned by automated outreach before (invoice dunning chased a customer
 *    on an invoice that was never sent, and had to be switched off). So this ships DISABLED by
 *    default and every suppression rule fails closed: if a check cannot be evaluated, no message
 *    is sent.
 *
 * Since Aug 2026 the decision is no longer duration-as-proxy: the call is CLASSIFIED from its
 * transcript first (server/call-classifier.ts), and the template only goes to a job enquiry whose
 * caller actually agreed to a WhatsApp follow-up (or, behind the allowUndiscussed flag, one where
 * messaging never came up). Declines tag the thread no_auto_messages; complaints page a human and
 * never get automation. The routing table is decideOutreach() below — pure, total, tested.
 *
 * Enable with:  npx tsx scripts/_post-call-outreach-toggle.ts on
 *
 * One exception to the approval queue: when the caller is a genuine FIRST contact (a number we
 * have never messaged), the queued draft may auto-send — the owner's sanctioned first-touch rule,
 * enforced server-side in first-contact-ack.ts and off by default. The quiet-hours guard below
 * still applies here: unlike a freeform acknowledgement, this template's wording is fixed by Meta
 * and cannot say "we'll come back to you first thing", so a 2am send would read as a live human.
 */
import { db } from './db';
import { calls, leads, appSettings, messages, conversations } from '@shared/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { sendWhatsAppMessage } from './meta-whatsapp';
import { isWhatsAppSenderConfigured } from './whatsapp-sender';
import { normalizePhoneNumber, isNonMobileUkNumber } from './phone-utils';
import { classifyCall, type CallClassification } from './call-classifier';

const SETTING_KEY = 'post_call_video_request';

/** Approved Twilio template: "Hi {{1}}, thanks for getting in touch! ... send us a quick video ..." */
const VIDEO_REQUEST_CONTENT_SID =
    process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID || 'HX3ecffe34fcde66b5a64a964a306026f2';

export type PostCallOutreachConfig = {
    enabled: boolean;
    /** Calls shorter than this are misdials/wrong numbers, not enquiries. */
    minDurationSeconds: number;
    /** Don't re-ask the same number within this many days. */
    dedupeDays: number;
    /** Skip sending outside these local hours (inclusive start, exclusive end). */
    quietHoursStart: number; // e.g. 21 -> from 21:00
    quietHoursEnd: number;   // e.g. 8  -> until 08:00
    /** Skip UK landlines — they cannot receive WhatsApp, so a send is guaranteed waste. */
    mobileOnly: boolean;
    /** E.164 numbers that must never receive automated outreach (staff, contractors, opt-outs). */
    suppressedNumbers: string[];
    /**
     * Classify the call from its transcript before deciding (server/call-classifier.ts).
     * When on, duration stops being the intent test — the transcript is. A call that cannot
     * be classified (no transcript, model failure) sends NOTHING: fail closed.
     */
    classify: boolean;
    /**
     * Send even when WhatsApp was never mentioned on the call ('not_discussed').
     * Off by default: the owner's rule is that a message the customer did not
     * hear about is presumed unwelcome until proven otherwise.
     */
    allowUndiscussed: boolean;
};

const DEFAULT_CONFIG: PostCallOutreachConfig = {
    enabled: false, // Opt-in on purpose — see file header.
    // With classification on, duration is only a sanity floor (sub-5s calls have no usable
    // transcript anyway) — the transcript verdict is the real gate, not this proxy.
    minDurationSeconds: 5,
    dedupeDays: 30,
    quietHoursStart: 21,
    quietHoursEnd: 8,
    mobileOnly: true,
    suppressedNumbers: [],
    classify: true,
    allowUndiscussed: false,
};

/**
 * Moved to phone-utils.ts once the outbound router needed the same rule (a landline must skip
 * WhatsApp entirely, not just skip post-call outreach). Re-exported so existing imports and the
 * verify scripts keep working against their original module.
 */
export { isNonMobileUkNumber } from './phone-utils';

export async function getOutreachConfig(): Promise<PostCallOutreachConfig> {
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY));
        if (!row) return DEFAULT_CONFIG;
        return { ...DEFAULT_CONFIG, ...(row.value as Partial<PostCallOutreachConfig>) };
    } catch (error) {
        console.error('[PostCallOutreach] Could not read config, treating as disabled:', error);
        return { ...DEFAULT_CONFIG, enabled: false }; // Fail closed.
    }
}

export async function setOutreachConfig(patch: Partial<PostCallOutreachConfig>): Promise<PostCallOutreachConfig> {
    const current = await getOutreachConfig();
    const next = { ...current, ...patch };
    await db.insert(appSettings)
        .values({
            id: SETTING_KEY,
            key: SETTING_KEY,
            value: next,
            description: 'Automated post-call WhatsApp video request (see server/post-call-outreach.ts)',
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: next, updatedAt: new Date() },
        });
    return next;
}

/** Current hour in UK local time, which is what "quiet hours" means to a Nottingham customer. */
function ukHourNow(): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: 'numeric',
        hour12: false,
    }).formatToParts(new Date());
    return Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
}

function inQuietHours(cfg: PostCallOutreachConfig): boolean {
    const h = ukHourNow();
    // Window wraps midnight (e.g. 21 -> 8), so it's a union, not a range.
    return cfg.quietHoursStart > cfg.quietHoursEnd
        ? h >= cfg.quietHoursStart || h < cfg.quietHoursEnd
        : h >= cfg.quietHoursStart && h < cfg.quietHoursEnd;
}

export type OutreachDecision = {
    sent: boolean;
    /** Machine-readable reason, always present — this is the audit trail for "why no message?". */
    reason: string;
    sid?: string;
};

/**
 * What the classification verdict means for outreach. Pure and total — every
 * verdict shape maps to exactly one row of this matrix, so the whole table is
 * testable without a database or a model (scripts/_call-classifier-test.ts).
 */
export type OutreachRoute = {
    send: boolean;
    reason:
        | 'NO_CLASSIFICATION'
        | 'COMPLAINT'
        | `NOT_A_JOB_ENQUIRY:${CallClassification['kind']}`
        | 'CUSTOMER_DECLINED_MESSAGING'
        | 'NOT_DISCUSSED_ON_CALL'
        | 'AGREED_ON_CALL'
        | 'NOT_DISCUSSED_ALLOWED';
    /** Caller said no to messaging — mark the thread so nothing automated ever fires at it. */
    tagNoAutoMessages: boolean;
    /** Complaint heard — thread goes urgent and a human gets paged. */
    complaintAlert: boolean;
};

/**
 * The decision matrix. `classification` is null when the call could not be
 * classified (no transcript, model failure, parse failure) — and null sends
 * nothing, because a call we could not read authorises nothing.
 */
export function decideOutreach(
    classification: CallClassification | null,
    cfg: Pick<PostCallOutreachConfig, 'allowUndiscussed'>,
): OutreachRoute {
    if (!classification) {
        return { send: false, reason: 'NO_CLASSIFICATION', tagNoAutoMessages: false, complaintAlert: false };
    }

    // An objection is an objection whatever kind of call it was — even a supplier
    // who said "don't message me" gets the tag, so no future automation forgets.
    const declined = classification.messagingObjection || classification.whatsappAgreed === 'declined';

    if (classification.kind === 'complaint') {
        return { send: false, reason: 'COMPLAINT', tagNoAutoMessages: declined, complaintAlert: true };
    }
    if (classification.kind !== 'job_enquiry') {
        return { send: false, reason: `NOT_A_JOB_ENQUIRY:${classification.kind}`, tagNoAutoMessages: declined, complaintAlert: false };
    }
    if (declined) {
        return { send: false, reason: 'CUSTOMER_DECLINED_MESSAGING', tagNoAutoMessages: true, complaintAlert: false };
    }
    if (classification.whatsappAgreed === 'agreed') {
        return { send: true, reason: 'AGREED_ON_CALL', tagNoAutoMessages: false, complaintAlert: false };
    }
    // not_discussed: only the explicit opt-in flag makes this sendable.
    return cfg.allowUndiscussed
        ? { send: true, reason: 'NOT_DISCUSSED_ALLOWED', tagNoAutoMessages: false, complaintAlert: false }
        : { send: false, reason: 'NOT_DISCUSSED_ON_CALL', tagNoAutoMessages: false, complaintAlert: false };
}

/**
 * Decides whether an ended call earns a video request, and sends it if so.
 *
 * Safe to call on every terminal call status: it is a no-op unless every guardrail passes.
 * Never throws — outreach must not be able to break call finalization.
 */
export async function maybeSendPostCallVideoRequest(input: {
    callSid: string;
    callStatus: string;
    from?: string | null;
    durationSeconds?: number | null;
}): Promise<OutreachDecision> {
    try {
        const cfg = await getOutreachConfig();
        if (!cfg.enabled) return { sent: false, reason: 'DISABLED' };

        if (input.callStatus !== 'completed') {
            return { sent: false, reason: `CALL_NOT_COMPLETED:${input.callStatus}` };
        }

        if (!isWhatsAppSenderConfigured()) {
            console.warn('[PostCallOutreach] No WhatsApp sender configured — skipping.');
            return { sent: false, reason: 'NO_SENDER_CONFIGURED' };
        }

        // Look the call up so we can trust `direction` and `duration` from our own record rather
        // than whatever the webhook happened to include.
        const [call] = await db.select().from(calls).where(eq(calls.callId, input.callSid));
        if (!call) return { sent: false, reason: 'NO_CALL_RECORD' };

        if (call.direction !== 'inbound') {
            return { sent: false, reason: `NOT_INBOUND:${call.direction}` };
        }

        const duration = call.duration ?? input.durationSeconds ?? 0;
        if (duration < cfg.minDurationSeconds) {
            return { sent: false, reason: `TOO_SHORT:${duration}s<${cfg.minDurationSeconds}s` };
        }

        if (call.videoRequestSentAt) {
            return { sent: false, reason: 'ALREADY_SENT_FOR_THIS_CALL' };
        }

        const rawPhone = call.phoneNumber || input.from || '';
        const phone = normalizePhoneNumber(rawPhone);
        if (!phone) return { sent: false, reason: `UNPARSEABLE_PHONE:${rawPhone}` };

        // Suppression list — staff, contractors, and anyone who asked us to stop.
        const suppressed = new Set(
            cfg.suppressedNumbers.map((n) => normalizePhoneNumber(n) || n)
        );
        if (suppressed.has(phone)) return { sent: false, reason: 'SUPPRESSED_NUMBER' };

        if (cfg.mobileOnly && isNonMobileUkNumber(phone)) {
            return { sent: false, reason: 'NOT_A_MOBILE' };
        }

        // Dedupe across calls: has this number already been asked recently?
        const since = new Date(Date.now() - cfg.dedupeDays * 24 * 60 * 60 * 1000);
        const [recent] = await db.select({ id: calls.id })
            .from(calls)
            .where(and(
                eq(calls.phoneNumber, call.phoneNumber),
                gte(calls.videoRequestSentAt, since)
            ))
            .orderBy(desc(calls.videoRequestSentAt))
            .limit(1);
        if (recent) return { sent: false, reason: `ALREADY_ASKED_WITHIN_${cfg.dedupeDays}D` };

        // If the customer already replied on WhatsApp, a canned template is the wrong move —
        // there's a live human thread and Ben should answer it himself.
        const convKey = `${phone.replace('+', '')}@c.us`;
        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.phoneNumber, convKey));
        if (conv) {
            const [inbound] = await db.select({ id: messages.id })
                .from(messages)
                .where(and(
                    eq(messages.conversationId, conv.id),
                    eq(messages.direction, 'inbound')
                ))
                .limit(1);
            if (inbound) return { sent: false, reason: 'EXISTING_WHATSAPP_THREAD' };
        }

        // Timing is checked last: it's the only guardrail about *when* rather than *whether*, so
        // evaluating it after the eligibility rules keeps the reason codes meaningful (a
        // QUIET_HOURS result means "eligible, wrong time") and lets the verify harness exercise
        // every eligibility rule by holding this one open.
        if (inQuietHours(cfg)) {
            return { sent: false, reason: `QUIET_HOURS:${ukHourNow()}h` };
        }

        // --- Classification gate: what WAS this call? ---
        // The cheap rails above say the call is mechanically eligible. None of them can say the
        // caller wanted a message — a 3-minute call can be a supplier, a complaint, or someone
        // who said "just ring me". So the transcript is read and judged, and every path where
        // that judgement is unavailable sends nothing.
        if (cfg.classify) {
            const verdict = await classifyCall(call.id);
            const route = decideOutreach(verdict.ok ? verdict.classification : null, cfg);

            // Side effects fire regardless of the send outcome — an objection or a complaint is
            // real information about this customer even though no message goes out.
            if (route.tagNoAutoMessages && conv) {
                try {
                    const tags = Array.from(new Set([...(conv.tags || []), 'no_auto_messages']));
                    await db.update(conversations)
                        .set({ tags, updatedAt: new Date() })
                        .where(eq(conversations.id, conv.id));
                    console.log(`[PostCallOutreach] Tagged conversation ${conv.id} no_auto_messages (call ${input.callSid})`);
                } catch (e) {
                    console.warn('[PostCallOutreach] Failed to tag conversation no_auto_messages:', e);
                }
            }
            if (route.complaintAlert) {
                try {
                    if (conv) {
                        await db.update(conversations)
                            .set({ priority: 'urgent', updatedAt: new Date() })
                            .where(eq(conversations.id, conv.id));
                    }
                    const { notifyComplaintCall } = await import('./pushover');
                    await notifyComplaintCall({
                        callerName: call.customerName,
                        phoneNumber: phone,
                        summary: verdict.ok ? verdict.classification.jobSummary : null,
                    });
                } catch (e) {
                    console.warn('[PostCallOutreach] Complaint escalation failed:', e);
                }
            }

            if (!route.send) {
                const detail = verdict.ok ? route.reason : `${route.reason}:${verdict.reason}`;
                console.log(`[PostCallOutreach] Not sending for ${input.callSid}: ${detail}`);
                return { sent: false, reason: detail };
            }
        }

        // --- All guardrails passed ---
        const name = (call.customerName || '').trim();
        const greetName = name && !/^(unknown|customer|caller)/i.test(name) ? name.split(/\s+/)[0] : 'there';

        // Queue for approval rather than sending. Every guardrail above is about whether this
        // SHOULD be sent; the draft queue is about a human confirming it before it goes. Both
        // matter — the guardrails stop obvious mistakes, the human catches the rest.
        const { queueDraft } = await import('./message-drafts');
        const draftId = await queueDraft({
            phone,
            body: `Hi ${greetName}, thanks for getting in touch! To give you an accurate quote, could you send us a quick video of the job? Just show us the area and tell us what needs doing. Thanks!`,
            source: 'post_call_video',
            reason: `Inbound call ${input.callSid} lasted ${duration}s. No video requested for this number in the last ${cfg.dedupeDays} days.`,
            contentSid: VIDEO_REQUEST_CONTENT_SID,
            contentVariables: { '1': greetName },
        });

        if (!draftId) return { sent: false, reason: 'DUPLICATE_DRAFT' };

        // The first-contact exception: a caller we have never messaged is exactly the case the
        // owner sanctioned for auto-acknowledgement, and a video request is worth most while the
        // call is still fresh. The guard is server-side and lives in first-contact-ack.ts — every
        // guardrail above still had to pass first, and anything it refuses stays a pending draft.
        const { maybeAutoSendFirstContactDraft } = await import('./first-contact-ack');
        const auto = await maybeAutoSendFirstContactDraft(draftId, {
            conversationId: conv?.id ?? null,
            phone,
            channel: 'post_call',
        });
        // Mark the call so the dedupe guard counts this attempt, whether or not it is approved —
        // otherwise every subsequent call would re-queue the same draft.
        await recordVideoRequest({ callRecordId: call.id, phone, name: greetName, callSid: input.callSid });

        if (auto.sent) {
            console.log(`[PostCallOutreach] Auto-sent first-contact video request ${draftId} to ${phone} (call ${input.callSid})`);
            return { sent: true, reason: 'SENT_FIRST_CONTACT', sid: draftId };
        }

        console.log(`[PostCallOutreach] Queued video request draft ${draftId} for ${phone} (call ${input.callSid}) — ${auto.reason}`);
        return { sent: false, reason: 'QUEUED_FOR_APPROVAL', sid: draftId };
    } catch (error) {
        // Never let outreach break call finalization.
        console.error('[PostCallOutreach] Failed:', error);
        return { sent: false, reason: 'ERROR' };
    }
}

/**
 * Mirrors the bookkeeping the manual /api/whatsapp/send-template path does, so an automated ask
 * and a hand-sent one leave the same trail: call marked, lead created/flagged awaiting video.
 */
async function recordVideoRequest(opts: {
    callRecordId: string;
    phone: string;
    name: string;
    callSid: string;
}) {
    const now = new Date();
    let linkedLeadId: string | null = null;

    try {
        const { findDuplicateLead } = await import('./lead-deduplication');
        const dup = await findDuplicateLead(opts.phone, { customerName: opts.name });

        if (dup.isDuplicate && dup.existingLead) {
            linkedLeadId = dup.existingLead.id;
            await db.update(leads)
                .set({ status: 'awaiting_video', awaitingVideo: true })
                .where(eq(leads.id, linkedLeadId));
        } else {
            linkedLeadId = `lead_autovideo_${Date.now()}`;
            await db.insert(leads).values({
                id: linkedLeadId,
                customerName: opts.name === 'there' ? null : opts.name,
                phone: opts.phone,
                source: 'post_call_auto_video',
                jobDescription: 'Video requested automatically after inbound call',
                status: 'awaiting_video',
                awaitingVideo: true,
            });
        }
    } catch (e) {
        // A lead bookkeeping failure must not lose the fact that we messaged the customer.
        console.warn('[PostCallOutreach] Lead linking failed (message already sent):', e);
    }

    await db.update(calls)
        .set({
            outcome: 'VIDEO_QUOTE',
            actionTakenAt: now,
            videoRequestSentAt: now,
            ...(linkedLeadId ? { leadId: linkedLeadId } : {}),
        })
        .where(eq(calls.id, opts.callRecordId));
}
