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
import { calls, leads, appSettings, messages, conversations, messageDrafts } from '@shared/schema';
import { eq, and, gte, desc, sql, or, ne } from 'drizzle-orm';
import { isWhatsAppSenderConfigured } from './whatsapp-sender';
import { normalizePhoneNumber, isNonMobileUkNumber } from './phone-utils';
import { classifyCall, parseClassification, type CallClassification } from './call-classifier';
import { findApprovedTemplate, buildTemplateVariables, renderTemplateBody } from './whatsapp-template-sync';
import { checkDraft } from './agents/draft-guards';

const SETTING_KEY = 'post_call_video_request';

/** Approved Twilio template: "Hi {{1}}, thanks for getting in touch! ... send us a quick video ..." */
// Required env var (validated at startup via env-validation.ts)
const VIDEO_REQUEST_CONTENT_SID = process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID!;

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
    /**
     * How long a CALLBACK_DUE thread may sit unrung before the sweep falls back to the video
     * template anyway (server/agents/comms-sweep.ts, fallbackOverdueCallbacks). The human gets
     * first right of the warm move; this is the guarantee that nobody falls through when the
     * call never happens. 0 disables the fallback entirely — the tag then waits on Ben alone.
     */
    callbackFallbackMinutes: number;
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
    callbackFallbackMinutes: 120,
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
        | 'CALLBACK_DUE'
        | 'NOT_DISCUSSED_ON_CALL'
        | 'AGREED_ON_CALL'
        | 'NOT_DISCUSSED_ALLOWED';
    /** Caller said no to messaging — mark the thread so nothing automated ever fires at it. */
    tagNoAutoMessages: boolean;
    /** Complaint heard — thread goes urgent and a human gets paged. */
    complaintAlert: boolean;
    /** A promised or interrupted call is rung back, not texted — thread parks on Ben's desk. */
    callbackDue: boolean;
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
        return { send: false, reason: 'NO_CLASSIFICATION', tagNoAutoMessages: false, complaintAlert: false, callbackDue: false };
    }

    // An objection is an objection whatever kind of call it was — even a supplier
    // who said "don't message me" gets the tag, so no future automation forgets.
    const declined = classification.messagingObjection || classification.whatsappAgreed === 'declined';

    if (classification.kind === 'complaint') {
        return { send: false, reason: 'COMPLAINT', tagNoAutoMessages: declined, complaintAlert: true, callbackDue: false };
    }
    if (classification.kind !== 'job_enquiry') {
        return { send: false, reason: `NOT_A_JOB_ENQUIRY:${classification.kind}`, tagNoAutoMessages: declined, complaintAlert: false, callbackDue: false };
    }
    if (declined) {
        return { send: false, reason: 'CUSTOMER_DECLINED_MESSAGING', tagNoAutoMessages: true, complaintAlert: false, callbackDue: false };
    }
    // A promised or interrupted call is rung back, not texted. Takes precedence over
    // whatsappAgreed on purpose: "yes send me the WhatsApp" followed by "I'll ring you back
    // this afternoon" (or a line that died mid-sentence) means the conversation is not over,
    // and a template landing before the callback reads as the machine talking over the human.
    if (classification.callbackPromised || classification.callIncomplete) {
        return { send: false, reason: 'CALLBACK_DUE', tagNoAutoMessages: false, complaintAlert: false, callbackDue: true };
    }
    if (classification.whatsappAgreed === 'agreed') {
        return { send: true, reason: 'AGREED_ON_CALL', tagNoAutoMessages: false, complaintAlert: false, callbackDue: false };
    }
    // not_discussed: only the explicit opt-in flag makes this sendable.
    return cfg.allowUndiscussed
        ? { send: true, reason: 'NOT_DISCUSSED_ALLOWED', tagNoAutoMessages: false, complaintAlert: false, callbackDue: false }
        : { send: false, reason: 'NOT_DISCUSSED_ON_CALL', tagNoAutoMessages: false, complaintAlert: false, callbackDue: false };
}

/** Template NAMES — resolved against the approved cache at send time, never a hardcoded SID. */
export const AGREED_VIDEO_TEMPLATE = '1_contact_generic';   // "…as discussed, please send us a video of {{2}}"
export const GENERIC_VIDEO_TEMPLATE = 'video_request';      // generic ask, claims no prior agreement

export type VideoTemplateChoice = {
    name: string;
    /** Positional overrides beyond the {{1}} greeting name, e.g. {{2}} = the job. */
    variables: Record<string, string>;
};

/**
 * Which template the verdict earns. Pure, so the mapping is testable without the cache.
 *
 * The distinction is honesty, not copy taste: "as discussed" is a claim about the call, and it may
 * only be made when the customer actually agreed on the call. Everything else — not discussed
 * (behind the allowUndiscussed flag), an unclassified call with classify off, the callback
 * fallback where consent was never captured — gets the generic ask that promises nothing.
 *
 * {{2}} is filled from jobPhrase, the classifier's CUSTOMER-FACING field — never jobSummary.
 * jobSummary is internal third-person ops notes, and interpolating it here once sent a customer
 * "…a video of UPVC door repair - remote inch issue, customer to send pictures via WhatsApp"
 * (Aug 2026). Verdicts stored before jobPhrase existed parse it as '', so they fall back to the
 * generic "the job we discussed" rather than ever leaking the internal summary.
 */
export function pickVideoTemplate(
    classification: Pick<CallClassification, 'whatsappAgreed' | 'jobPhrase'> | null,
): VideoTemplateChoice {
    if (classification?.whatsappAgreed === 'agreed') {
        const job = (classification.jobPhrase || '').trim() || 'the job we discussed';
        return {
            name: AGREED_VIDEO_TEMPLATE,
            // {{2}} lands mid-sentence ("…a video of {{2}}"), so it must stay short enough to read
            // as a phrase. The classifier caps jobPhrase at 80 chars; the cut here is a backstop.
            variables: { '2': job.length > 120 ? `${job.slice(0, 119).trimEnd()}…` : job },
        };
    }
    return { name: GENERIC_VIDEO_TEMPLATE, variables: {} };
}

/**
 * May the sweep fall back to a text on this callback_due thread? Pure — the sweep resolves the
 * DB row and the clock, this answers only the rule, so the whole ladder is testable without
 * either. The hour window matches the morning-release rule (08:00–20:00 UK): a fallback text
 * at 2am would read as a machine, which is exactly what a warm thread must not hear.
 */
export function callbackFallbackEligible(input: {
    tags: string[] | null | undefined;
    /** conversations.metadata.callbackDueAt — ISO string written when the verdict landed. */
    callbackDueAt: string | null | undefined;
    cfg: Pick<PostCallOutreachConfig, 'enabled' | 'callbackFallbackMinutes'>;
    ukHour: number;
    now?: Date;
}): boolean {
    if (!input.cfg.enabled) return false;                       // the master flag gates the fallback too
    if (!(input.cfg.callbackFallbackMinutes > 0)) return false; // 0 (or garbage) disables it
    if (input.ukHour < 8 || input.ukHour >= 20) return false;
    const tags = input.tags ?? [];
    if (!tags.includes('callback_due')) return false;
    if (tags.includes('no_auto_messages')) return false;        // an objection outlives the callback promise
    if (!input.callbackDueAt) return false;                     // no clock, no verdict on "overdue" — fail closed
    const dueAt = Date.parse(input.callbackDueAt);
    if (isNaN(dueAt)) return false;
    return (input.now ?? new Date()).getTime() - dueAt >= input.cfg.callbackFallbackMinutes * 60_000;
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

        const rails = await evaluateSendRails(call, cfg, input.from);
        if (!rails.ok) return { sent: false, reason: rails.reason };
        const { phone, conv } = rails;

        // --- Classification gate: what WAS this call? ---
        // The cheap rails above say the call is mechanically eligible. None of them can say the
        // caller wanted a message — a 3-minute call can be a supplier, a complaint, or someone
        // who said "just ring me". So the transcript is read and judged, and every path where
        // that judgement is unavailable sends nothing.
        let classification: CallClassification | null = null;
        if (cfg.classify) {
            const verdict = await classifyCall(call.id);
            classification = verdict.ok ? verdict.classification : null;
            const route = decideOutreach(classification, cfg);

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
                        summary: classification?.jobSummary ?? null,
                    });
                } catch (e) {
                    console.warn('[PostCallOutreach] Complaint escalation failed:', e);
                }
            }
            if (route.callbackDue) {
                // The human gets first right of the warm move: the thread parks on Ben's desk
                // (tag → whoseMove 'ben' on the board), the clock starts (metadata.callbackDueAt
                // is what the sweep's fallback measures against), and his phone says ring them.
                // No message goes out here — an outbound call clears the tag (call-thread.ts),
                // and only the overdue fallback may text instead.
                try {
                    if (conv) {
                        const tags = Array.from(new Set([...(conv.tags || []), 'callback_due']));
                        await db.update(conversations).set({
                            tags,
                            priority: 'high',
                            metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('callbackDueAt', ${new Date().toISOString()}::text)`,
                            updatedAt: new Date(),
                        }).where(eq(conversations.id, conv.id));
                        console.log(`[PostCallOutreach] Tagged conversation ${conv.id} callback_due (call ${input.callSid})`);
                    }
                    const { notifyCallbackDue } = await import('./pushover');
                    await notifyCallbackDue({
                        callerName: call.customerName,
                        phoneNumber: phone,
                        jobSummary: classification?.jobSummary ?? null,
                    });
                } catch (e) {
                    console.warn('[PostCallOutreach] Callback-due escalation failed:', e);
                }
            }

            if (!route.send) {
                const detail = verdict.ok ? route.reason : `${route.reason}:${verdict.reason}`;
                console.log(`[PostCallOutreach] Not sending for ${input.callSid}: ${detail}`);
                return { sent: false, reason: detail };
            }

            // When the post-call CONTINUATION is live, it owns the caller who AGREED on the call:
            // its single message already contains the video ask, and two templates for one call is
            // exactly the double-send this queue exists to prevent. Only the agreed verdict is
            // ceded — allowUndiscussed sends, unclassified sends (classify off) and the callback
            // fallback keep the video template, because the continuation's "good to speak just
            // now" wording is only honest on a fresh, agreed call.
            if (route.reason === 'AGREED_ON_CALL') {
                const ccfg = await getContinuationConfig();
                if (ccfg.enabled) {
                    console.log(`[PostCallOutreach] Deferring ${input.callSid} to the post-call continuation.`);
                    return { sent: false, reason: 'CONTINUATION_OWNS_AGREED' };
                }
            }
        }

        // --- All guardrails passed ---
        return await queueVideoRequest({
            call, cfg, phone, conv, classification,
            reason: `Inbound call ${input.callSid} lasted ${duration}s. No video requested for this number in the last ${cfg.dedupeDays} days.`,
            logContext: `call ${input.callSid}`,
        });
    } catch (error) {
        // Never let outreach break call finalization.
        console.error('[PostCallOutreach] Failed:', error);
        return { sent: false, reason: 'ERROR' };
    }
}

type CallRow = typeof calls.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;

/**
 * The mechanical send rails, shared verbatim by the live post-call path and the sweep's callback
 * fallback: phone parseability, the suppression list, mobile-only, the cross-call dedupe window,
 * an already-live WhatsApp thread, and quiet hours. Says nothing about intent — that is the
 * classification gate's job — only about whether a template send at this number, now, is sane.
 */
async function evaluateSendRails(
    call: CallRow,
    cfg: PostCallOutreachConfig,
    fallbackFrom?: string | null,
): Promise<{ ok: true; phone: string; conv: ConversationRow | null } | { ok: false; reason: string }> {
    const rawPhone = call.phoneNumber || fallbackFrom || '';
    const phone = normalizePhoneNumber(rawPhone);
    if (!phone) return { ok: false, reason: `UNPARSEABLE_PHONE:${rawPhone}` };

    // Suppression list — staff, contractors, and anyone who asked us to stop.
    const suppressed = new Set(
        cfg.suppressedNumbers.map((n) => normalizePhoneNumber(n) || n)
    );
    if (suppressed.has(phone)) return { ok: false, reason: 'SUPPRESSED_NUMBER' };

    if (cfg.mobileOnly && isNonMobileUkNumber(phone)) {
        return { ok: false, reason: 'NOT_A_MOBILE' };
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
    if (recent) return { ok: false, reason: `ALREADY_ASKED_WITHIN_${cfg.dedupeDays}D` };

    // If the customer already replied on WhatsApp, a canned template is the wrong move —
    // there's a live human thread and Ben should answer it himself. Calls are excluded: since
    // call-thread.ts, every answered inbound call writes an inbound `messages` row with
    // channel='call', and counting those here would make this rail refuse every caller the
    // moment their own call reached the board. A phone call is not a WhatsApp reply.
    const convKey = `${phone.replace('+', '')}@c.us`;
    const [conv] = await db.select().from(conversations)
        .where(eq(conversations.phoneNumber, convKey));
    if (conv) {
        const [inbound] = await db.select({ id: messages.id })
            .from(messages)
            .where(and(
                eq(messages.conversationId, conv.id),
                eq(messages.direction, 'inbound'),
                sql`${messages.channel} <> 'call'`
            ))
            .limit(1);
        if (inbound) return { ok: false, reason: 'EXISTING_WHATSAPP_THREAD' };
    }

    // Timing is checked last: it's the only guardrail about *when* rather than *whether*, so
    // evaluating it after the eligibility rules keeps the reason codes meaningful (a
    // QUIET_HOURS result means "eligible, wrong time") and lets the verify harness exercise
    // every eligibility rule by holding this one open.
    if (inQuietHours(cfg)) {
        return { ok: false, reason: `QUIET_HOURS:${ukHourNow()}h` };
    }

    return { ok: true, phone, conv: conv ?? null };
}

/**
 * Queue the consent-mapped video request for a call whose guardrails have all passed.
 *
 * The template is chosen by what the caller actually said (pickVideoTemplate) and resolved BY NAME
 * against the approved cache at send time — a SID hardcoded today points at a template Meta can
 * reject tomorrow. When the named template is not (yet) approved, the generic one is tried; when
 * the cache has neither (fresh DB, sync never run), the legacy env-configured SID keeps the path
 * alive rather than going silent.
 */
async function queueVideoRequest(opts: {
    call: CallRow;
    cfg: PostCallOutreachConfig;
    phone: string;
    conv: ConversationRow | null;
    classification: CallClassification | null;
    reason: string;
    /** For log lines, e.g. "call CAxxxx" or "callback fallback". */
    logContext: string;
}): Promise<OutreachDecision> {
    const { call, cfg, phone, conv, classification } = opts;
    const name = (call.customerName || '').trim();
    const greetName = name && !/^(unknown|customer|caller)/i.test(name) ? name.split(/\s+/)[0] : 'there';

    const choice = pickVideoTemplate(classification);
    const template = await findApprovedTemplate(choice.name)
        ?? (choice.name !== GENERIC_VIDEO_TEMPLATE ? await findApprovedTemplate(GENERIC_VIDEO_TEMPLATE) : null);

    let contentSid: string;
    let contentVariables: Record<string, string>;
    let body: string;
    if (template) {
        // Hint-driven fill for the greeting/link slots, then the choice's own positional
        // overrides on top ({{2}} = the job summary on the as-discussed template).
        contentVariables = { ...buildTemplateVariables(template, { firstName: greetName }), ...choice.variables };
        contentSid = template.contentSid;
        body = renderTemplateBody(template.body, contentVariables);
    } else {
        console.warn(`[PostCallOutreach] No approved template named "${choice.name}" in the cache — falling back to the legacy video-request SID.`);
        contentSid = VIDEO_REQUEST_CONTENT_SID;
        contentVariables = { '1': greetName };
        body = `Hi ${greetName}, thanks for getting in touch! To give you an accurate quote, could you send us a quick video of the job? Just show us the area and tell us what needs doing. Thanks!`;
    }

    // Queue for approval rather than sending. Every guardrail above is about whether this
    // SHOULD be sent; the draft queue is about a human confirming it before it goes. Both
    // matter — the guardrails stop obvious mistakes, the human catches the rest.
    const { queueDraft } = await import('./message-drafts');
    const draftId = await queueDraft({
        phone,
        body,
        source: 'post_call_video',
        reason: opts.reason,
        contentSid,
        contentVariables,
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
    await recordVideoRequest({ callRecordId: call.id, phone, name: greetName, callSid: call.callId ?? call.id });

    if (auto.sent) {
        console.log(`[PostCallOutreach] Auto-sent first-contact video request ${draftId} ("${choice.name}") to ${phone} (${opts.logContext})`);
        return { sent: true, reason: 'SENT_FIRST_CONTACT', sid: draftId };
    }

    console.log(`[PostCallOutreach] Queued video request draft ${draftId} ("${choice.name}") for ${phone} (${opts.logContext}) — ${auto.reason}`);
    return { sent: false, reason: 'QUEUED_FOR_APPROVAL', sid: draftId };
}

/**
 * The overdue-callback fallback's send half, called by the sweep
 * (server/agents/comms-sweep.ts fallbackOverdueCallbacks) once eligibility has been decided.
 *
 * Reuses the SAME rails and the SAME queue path as the live post-call send — mobile only, the
 * suppression list, the dedupe window, quiet hours, the approval queue — so the fallback cannot
 * reach anyone the live path would have refused. The classification is re-read from the stored
 * verdict rather than re-modelled: the transcript has not changed, and the consent mapping must
 * match what was actually said on the call that parked the thread.
 */
export async function sendCallbackFallbackForCall(callRecordId: string): Promise<OutreachDecision> {
    try {
        const cfg = await getOutreachConfig();
        if (!cfg.enabled) return { sent: false, reason: 'DISABLED' };
        if (!isWhatsAppSenderConfigured()) return { sent: false, reason: 'NO_SENDER_CONFIGURED' };

        const [call] = await db.select().from(calls).where(eq(calls.id, callRecordId));
        if (!call) return { sent: false, reason: 'NO_CALL_RECORD' };
        if (call.videoRequestSentAt) return { sent: false, reason: 'ALREADY_SENT_FOR_THIS_CALL' };

        const rails = await evaluateSendRails(call, cfg);
        if (!rails.ok) return { sent: false, reason: rails.reason };

        const parsed = parseClassification(call.classification);
        const classifiedAt = (call.classification as Record<string, unknown> | null)?.classifiedAt;
        const classification: CallClassification | null =
            parsed && classifiedAt ? { ...parsed, classifiedAt: String(classifiedAt) } : null;

        return await queueVideoRequest({
            call, cfg, phone: rails.phone, conv: rails.conv, classification,
            reason: `Callback fallback: a callback was promised (or the call cut out) and nobody rang back within ${cfg.callbackFallbackMinutes} min.`,
            logContext: 'callback fallback',
        });
    } catch (error) {
        console.error('[PostCallOutreach] Callback fallback failed:', error);
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

// ================================================================ post-call continuation
//
// T3 (Aug 2026): when an inbound call ends and the caller AGREED to a WhatsApp follow-up, their
// first WhatsApp should read like a continuation of the phone call, not a cold template. One
// fixed wording with exactly ONE slot (a short job reference from the classifier), and the video
// ask lives INSIDE that same single message — never a second bubble.
//
// The 24h window finding, stated plainly: a phone call does NOT open WhatsApp's freeform window
// (see server/call-thread.ts rule 1), so this message is ALWAYS a template send and its wording
// is whatever Meta approved. Both template names below must be submitted to Meta and show
// 'approved' in the whatsapp_templates cache before anything sends; until then this path fails
// closed with NO_APPROVED_TEMPLATE. There is deliberately no legacy-SID fallback here — an
// unapproved wording has no lawful route out, and inventing one is how templates get the account
// flagged.
//
// The slot is filled from jobPhrase, NOT jobSummary. The brief says "derived from the
// classifier's jobSummary", but jobSummary is the internal third-person ops field that leaked to
// a customer in Aug 2026 (see pickVideoTemplate above) — jobPhrase is the customer-facing field
// the classifier writes for exactly this insertion, capped at 60 chars. A missing or unusable
// phrase falls back to the generic no-slot wording; raw transcript text never appears.
//
// Ships DISABLED, its own flag, same appSettings pattern as the video request.

const CONTINUATION_SETTING_KEY = 'post_call_continuation';

export type PostCallContinuationConfig = {
    enabled: boolean;
    /**
     * The wording says "good to speak just now", so it is only honest NEAR the call. A call that
     * ended longer ago than this sends nothing — which also makes a backfill or replayed webhook
     * inert even if every other guard were somehow passed.
     */
    maxAgeMinutes: number;
};

const CONTINUATION_DEFAULT_CONFIG: PostCallContinuationConfig = {
    enabled: false, // Opt-in on purpose, like every automated outreach path here.
    maxAgeMinutes: 60,
};

export async function getContinuationConfig(): Promise<PostCallContinuationConfig> {
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CONTINUATION_SETTING_KEY));
        if (!row) return CONTINUATION_DEFAULT_CONFIG;
        return { ...CONTINUATION_DEFAULT_CONFIG, ...(row.value as Partial<PostCallContinuationConfig>) };
    } catch (error) {
        console.error('[PostCallContinuation] Could not read config, treating as disabled:', error);
        return { ...CONTINUATION_DEFAULT_CONFIG, enabled: false }; // Fail closed.
    }
}

export async function setContinuationConfig(patch: Partial<PostCallContinuationConfig>): Promise<PostCallContinuationConfig> {
    const current = await getContinuationConfig();
    const next = { ...current, ...patch };
    await db.insert(appSettings)
        .values({
            id: CONTINUATION_SETTING_KEY,
            key: CONTINUATION_SETTING_KEY,
            value: next,
            description: 'Automated post-call continuation WhatsApp (see server/post-call-outreach.ts)',
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: next, updatedAt: new Date() },
        });
    return next;
}

/**
 * Template NAMES, resolved against the approved cache at send time like the video pair.
 *
 * Bodies as submitted to Meta (fixed wording, one content slot):
 *
 *   post_call_continuation:
 *     "Hi {{1}}, good to speak just now about {{2}}. This is the number to send over any photos
 *      or videos of the job, and we'll get your quote moving."
 *
 *   post_call_continuation_generic:
 *     "Hi {{1}}, good to speak just now. This is the number to send over any photos or videos of
 *      the job, and we'll get your quote moving."
 *
 * {{1}} is the greeting name (hint-driven, degrades to "there"); {{2}} is the job reference and
 * is the ONE slot the brief allows. The wording deliberately clears every draft guard: no dashes,
 * no figures, no dates, no duration words.
 */
export const CONTINUATION_TEMPLATE = 'post_call_continuation';
export const CONTINUATION_GENERIC_TEMPLATE = 'post_call_continuation_generic';

/** How long the slot may be. Matches the classifier's own jobPhrase cap. */
const MAX_JOB_REF_CHARS = 60;

/** Deterministic draft id — the "one continuation per call, EVER" guard, keyed on the call. */
export function continuationDraftId(callRecordId: string): string {
    return `draft_callcont_${callRecordId}`;
}

/**
 * The slot quality gate. Returns the cleaned job reference, or null for "use the generic
 * wording". Pure, so the whole ladder is testable without a database.
 *
 * Null rather than repair on anything doubtful: the slot lands mid-sentence in a customer
 * message, and a generic line reads better than a mangled one. The rendered body still passes
 * through checkDraft after this, so a phrase that is clean HERE but toxic in context (digits
 * that read as money, "quick fix") is caught there and falls back the same way.
 */
export function normalizeJobRef(jobPhrase: string | null | undefined): string | null {
    let s = (jobPhrase ?? '').trim();
    if (!s) return null;
    s = s.replace(/[\s.,;:!?]+$/, '').trim();          // trailing punctuation reads as a typo mid-sentence
    if (!s) return null;
    if (s.length > MAX_JOB_REF_CHARS) return null;     // over-cap: never truncate into a customer message
    if (/[\n\r]/.test(s)) return null;                 // multi-line means it is not a noun phrase
    if (/[—–]/.test(s)) return null;                   // house voice: no em/en dashes anywhere a customer reads
    if (/\{\{|\}\}/.test(s)) return null;              // a placeholder that survived is a bug, not a job
    // Filler the classifier or older writers emit instead of a real phrase.
    if (/^(the job we discussed|unknown|n\/?a|none|unclear)$/i.test(s)) return null;
    return s;
}

export type ContinuationTemplateChoice = {
    name: string;
    /** Positional overrides beyond the {{1}} greeting name: {{2}} = the job reference. */
    variables: Record<string, string>;
};

/** Which wording the verdict earns. Pure, mirror of pickVideoTemplate. */
export function pickContinuationTemplate(
    classification: Pick<CallClassification, 'jobPhrase'> | null,
): ContinuationTemplateChoice {
    const jobRef = normalizeJobRef(classification?.jobPhrase);
    return jobRef
        ? { name: CONTINUATION_TEMPLATE, variables: { '2': jobRef } }
        : { name: CONTINUATION_GENERIC_TEMPLATE, variables: {} };
}

/**
 * Decides whether an ended inbound call earns the continuation message, and queues it if so.
 *
 * Accepts either the call record id or the Twilio CallSid, like classifyCall. Safe to call
 * repeatedly from every trigger site (finalization ingest, the two post-transcript retries):
 * the deterministic draft id and videoRequestSentAt make replays no-ops. Never throws.
 */
export async function maybeSendPostCallContinuation(callId: string): Promise<OutreachDecision> {
    try {
        const ccfg = await getContinuationConfig();
        if (!ccfg.enabled) return { sent: false, reason: 'DISABLED' };

        if (!isWhatsAppSenderConfigured()) {
            console.warn('[PostCallContinuation] No WhatsApp sender configured — skipping.');
            return { sent: false, reason: 'NO_SENDER_CONFIGURED' };
        }

        const [call] = await db.select().from(calls)
            .where(or(eq(calls.id, callId), eq(calls.callId, callId)))
            .limit(1);
        if (!call) return { sent: false, reason: 'NO_CALL_RECORD' };

        if (call.direction !== 'inbound') return { sent: false, reason: `NOT_INBOUND:${call.direction}` };
        // The ring-time ingest fires while status is still 'ringing'; the continuation waits for
        // finalization, when duration, outcome and (soon) the classification are real.
        if (call.status !== 'completed') return { sent: false, reason: `CALL_NOT_COMPLETED:${call.status}` };

        // --- one continuation per call, EVER ---
        if (call.videoRequestSentAt) return { sent: false, reason: 'ALREADY_SENT_FOR_THIS_CALL' };
        const [priorDraft] = await db.select({ id: messageDrafts.id })
            .from(messageDrafts)
            .where(eq(messageDrafts.id, continuationDraftId(call.id)))
            .limit(1);
        if (priorDraft) return { sent: false, reason: 'ALREADY_QUEUED_FOR_THIS_CALL' };

        // --- freshness: "good to speak just now" must be true ---
        const endedAt = call.endTime ?? call.startTime;
        if (!endedAt) return { sent: false, reason: 'NO_CALL_TIMESTAMP' };
        const ageMinutes = (Date.now() - endedAt.getTime()) / 60_000;
        if (ageMinutes > ccfg.maxAgeMinutes) {
            return { sent: false, reason: `TOO_OLD:${Math.round(ageMinutes)}m>${ccfg.maxAgeMinutes}m` };
        }

        // --- the mechanical rails, shared verbatim with the video path ---
        // (phone parseability, suppression list, mobile-only, cross-call dedupe, an already-live
        // WhatsApp thread, quiet hours — rail VALUES come from the video config; evaluateSendRails
        // never reads cfg.enabled, so the video flag being off does not open or close this path.)
        const cfg = await getOutreachConfig();
        const rails = await evaluateSendRails(call, cfg);
        if (!rails.ok) return { sent: false, reason: rails.reason };
        const { phone, conv } = rails;

        // --- consent: only a job enquiry whose caller AGREED on the call ---
        // Same matrix as the video path, allowUndiscussed pinned OFF: a continuation claims the
        // customer expected this message, and only 'agreed' makes that claim true. Complaints,
        // spam, wrong numbers, declines and promised callbacks all refuse here. Side effects
        // (no_auto_messages tag, complaint page, callback_due) are NOT run from this path — the
        // video decision runs on the same call from its own trigger sites and owns them; firing
        // them twice would double-page a human.
        const verdict = await classifyCall(call.id);
        const classification = verdict.ok ? verdict.classification : null;
        const route = decideOutreach(classification, { allowUndiscussed: false });
        if (route.reason !== 'AGREED_ON_CALL') {
            const detail = verdict.ok ? route.reason : `${route.reason}:${verdict.reason}`;
            return { sent: false, reason: `NOT_AGREED:${detail}` };
        }

        // --- coordination: has anything else already messaged this thread since the call? ---
        // The VA call task, the first-contact ack or a human may have moved first. An outbound
        // non-call message on the thread since the call began means the conversation is already
        // being worked; a pending/approved draft for this number (ANY source) means a message is
        // one click away. Either way the continuation stands down — never double up.
        if (conv) {
            const [recentOutbound] = await db.select({ id: messages.id })
                .from(messages)
                .where(and(
                    eq(messages.conversationId, conv.id),
                    eq(messages.direction, 'outbound'),
                    ne(messages.channel, 'call'),
                    gte(messages.createdAt, call.startTime ?? endedAt),
                ))
                .limit(1);
            if (recentOutbound) return { sent: false, reason: 'THREAD_ALREADY_MESSAGED' };
        }
        const [pendingDraft] = await db.select({ id: messageDrafts.id, source: messageDrafts.source })
            .from(messageDrafts)
            .where(and(
                eq(messageDrafts.phone, phone),
                inArrayDraftStatuses(),
            ))
            .limit(1);
        if (pendingDraft) return { sent: false, reason: `OTHER_DRAFT_PENDING:${pendingDraft.source}` };

        // --- wording: fixed template, one slot, guard-checked, generic fallback ---
        const name = (call.customerName || '').trim();
        const greetName = name && !/^(unknown|customer|caller)/i.test(name) ? name.split(/\s+/)[0] : 'there';

        const resolve = async (choice: ContinuationTemplateChoice) => {
            const template = await findApprovedTemplate(choice.name);
            if (!template) return null;
            const contentVariables = { ...buildTemplateVariables(template, { firstName: greetName }), ...choice.variables };
            return { template, contentVariables, body: renderTemplateBody(template.body, contentVariables) };
        };

        let choice = pickContinuationTemplate(classification);
        let resolved = await resolve(choice);

        // The rendered SLOTTED body must clear the draft guards — a job reference carrying digits
        // reads as money, "the quick fix" reads as a duration claim. Any violation drops to the
        // generic wording rather than editing the slot: fixed template, no improvisation.
        if (resolved && choice.name === CONTINUATION_TEMPLATE) {
            const violation = checkDraft({ body: resolved.body, intent: 'post_call_continuation', quoteSeen: false, customerText: null });
            if (violation) {
                console.log(`[PostCallContinuation] Slot refused by draft guard (${violation.code}) for ${call.id} — using generic wording.`);
                choice = { name: CONTINUATION_GENERIC_TEMPLATE, variables: {} };
                resolved = null;
            }
        }
        if (!resolved && choice.name !== CONTINUATION_GENERIC_TEMPLATE) {
            // Slotted template not approved (or guard-refused above): try the generic one.
            choice = { name: CONTINUATION_GENERIC_TEMPLATE, variables: {} };
        }
        if (!resolved) resolved = await resolve(choice);
        if (!resolved) {
            // Neither wording is Meta-approved yet. The window is shut (a call never opens it),
            // so there is NO lawful way to deliver this — fail closed, per the brief.
            console.warn('[PostCallContinuation] No approved continuation template in the cache — nothing can send.');
            return { sent: false, reason: 'NO_APPROVED_TEMPLATE' };
        }
        {
            // Belt and braces: the generic body is fixed and proven guard-clean in the test
            // suite, but the cache body is editable at Twilio — re-check what will actually send.
            const violation = checkDraft({ body: resolved.body, intent: 'post_call_continuation', quoteSeen: false, customerText: null });
            if (violation) {
                console.warn(`[PostCallContinuation] Cached template body refused by draft guard (${violation.code}) — nothing can send.`);
                return { sent: false, reason: `GUARD_REFUSED:${violation.code}` };
            }
        }

        // --- queue (draft-and-approve), with the first-contact auto-send exception ---
        const { queueDraft } = await import('./message-drafts');
        const draftId = await queueDraft({
            id: continuationDraftId(call.id),
            phone,
            body: resolved.body,
            source: 'post_call_continuation',
            reason: `Post-call continuation: caller agreed to WhatsApp on inbound call ${call.callId ?? call.id} (${Math.round(ageMinutes)}m ago).`,
            contentSid: resolved.template.contentSid,
            contentVariables: resolved.contentVariables,
        });
        if (!draftId) return { sent: false, reason: 'DUPLICATE_DRAFT' };

        const { maybeAutoSendFirstContactDraft } = await import('./first-contact-ack');
        const auto = await maybeAutoSendFirstContactDraft(draftId, {
            conversationId: conv?.id ?? null,
            phone,
            channel: 'post_call',
        });

        // Same bookkeeping as a video request, because the continuation IS the video ask for this
        // call: videoRequestSentAt makes both paths' dedupe count it, the lead goes awaiting_video.
        await recordVideoRequest({ callRecordId: call.id, phone, name: greetName, callSid: call.callId ?? call.id });

        if (auto.sent) {
            console.log(`[PostCallContinuation] Auto-sent first-contact continuation ${draftId} ("${choice.name}") to ${phone}`);
            return { sent: true, reason: 'SENT_FIRST_CONTACT', sid: draftId };
        }
        console.log(`[PostCallContinuation] Queued continuation draft ${draftId} ("${choice.name}") for ${phone} — ${auto.reason}`);
        return { sent: false, reason: 'QUEUED_FOR_APPROVAL', sid: draftId };
    } catch (error) {
        // Never let outreach break call finalization or thread ingest.
        console.error('[PostCallContinuation] Failed:', error);
        return { sent: false, reason: 'ERROR' };
    }
}

/** The unsent statuses, in one place. */
function inArrayDraftStatuses() {
    return sql`${messageDrafts.status} in ('pending', 'approved')`;
}
