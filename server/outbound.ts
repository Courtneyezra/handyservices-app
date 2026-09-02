/**
 * The outbound router: one call site decides WHICH pipe a customer message leaves by, and
 * guarantees that a message either reaches the customer or reaches a human.
 *
 * Before this, every system-composed message went out as WhatsApp. That is wrong for three whole
 * populations of customer, and each failed in a different silent way:
 *
 *   - SMS-first, webform and phone-call contacts got a WhatsApp reply to a number that may never
 *     have used WhatsApp.
 *   - UK landlines (01/02/03) cannot have WhatsApp at all, so the send was guaranteed to fail —
 *     and if it was a template, it cost money to fail.
 *   - When it did fail, approveAndSendDraft marked the draft 'failed' and that was the end of it.
 *     Nobody was told. A first contact could be dropped in silence.
 *
 * The rules here are deliberately boring and deterministic:
 *
 *   1. An explicit channel is obeyed. If the caller says SMS, it is SMS.
 *   2. A UK landline never attempts WhatsApp. We know the answer, so we do not pay to ask.
 *   3. A WhatsApp send that fails BECAUSE THE RECIPIENT IS NOT ON WHATSAPP is retried as SMS with
 *      the same words. SMS has no 24-hour window and no template requirement, so "the same words"
 *      is always deliverable — that is the whole reason the fallback can exist.
 *   4. If neither pipe delivers, that is an alert, not a log line. Pushover fires and the caller
 *      gets ok:false, so no draft is ever left as a quiet 'failed' row nobody reads.
 *
 * Sender misconfiguration (63007, 21910) also falls back — the customer should not pay for our
 * config error — but ALWAYS alerts even when the SMS succeeds, because a silent fallback is
 * exactly how the WhatsApp sender stayed broken for four months in the first place.
 */
import { sendWhatsAppMessage } from './meta-whatsapp';
import { sendSmsMessage, toE164Recipient, TwilioSendError } from './sms';
import { isNonMobileUkNumber } from './phone-utils';
import { notifyOutboundSendFailure } from './pushover';
import { blockedByOptOut, optOutRefusalMessage, type OutboundPurpose } from './opt-out';
import { logSystemEvent } from './system-events';
import { type Approver, isApprover } from './approver';

export type OutboundChannel = 'whatsapp' | 'sms';

/**
 * Twilio codes meaning "this recipient is not reachable on WhatsApp". Falling back to SMS is the
 * right answer for every one of them.
 *
 *   63003  Channel could not find the To address — the canonical "not a WhatsApp user".
 *   63005  The To address is not a valid WhatsApp recipient.
 *   63024  Invalid message recipient. Seen live on this account: Twilio returned 200 and then
 *          failed delivery, which is what makes this class of failure so easy to miss.
 *   63013  Message failed a WhatsApp policy check for this recipient.
 */
export const NOT_A_WHATSAPP_RECIPIENT_CODES = new Set([63003, 63005, 63013, 63024]);

/**
 * Codes meaning OUR sender is wrong, not their number. Fall back so the customer still hears from
 * us, but alert unconditionally: these must never be absorbed silently.
 *
 *   63007  Twilio could not find a WhatsApp Channel for the From address (the 4-month outage).
 *   63015  Sandbox sender used against a real recipient.
 *   21910  From/To channel mismatch (a bare +44 From against a whatsapp: To).
 */
export const SENDER_MISCONFIGURED_CODES = new Set([63007, 63015, 21910]);

/**
 * The window is shut and this was freeform. SMS has no window, so it is a clean fallback rather
 * than a failure — but it is not a recipient problem, so it does not imply "not on WhatsApp".
 */
export const WINDOW_SHUT_CODES = new Set([63016]);

export type SendAttempt = {
    channel: OutboundChannel;
    ok: boolean;
    sid?: string | null;
    error?: string;
    code?: number | null;
};

export interface SendCustomerMessageResult {
    ok: boolean;
    /** The channel that actually delivered, when one did. */
    channel?: OutboundChannel;
    sid?: string | null;
    /** Every attempt in order — the audit trail for "how did this reach them?". */
    attempts: SendAttempt[];
    /** True when WhatsApp was tried, failed, and SMS carried it instead. */
    fellBack: boolean;
    /** Why WhatsApp was skipped or abandoned, in machine-readable form. */
    reason?: 'UK_LANDLINE' | 'NOT_ON_WHATSAPP' | 'SENDER_MISCONFIGURED' | 'WINDOW_SHUT' | 'EXPLICIT_CHANNEL' | 'OPTED_OUT';
    error?: string;
    /** Present only on an OPTED_OUT refusal: when they opted out and how far it reaches. */
    optedOut?: { scope: 'marketing' | 'all'; at: string; source: string };
}

export interface SendCustomerMessageInput {
    /**
     * Who licensed this send. REQUIRED — the Phase 0 exit gate (COMMS_AGENTS_V3_DESIGN §3.6).
     * `system.*` for a direct caller whose job needs the message, `rules.*` for a deterministic
     * policy, `agent.*` for an agent releasing its own draft, `human:<id>` for a person. Never a
     * bare string: the type does not admit one and the gate below refuses anything it cannot name.
     */
    approver: Approver;
    /**
     * The run this send belongs to — the agent run id where one exists, else `newRunId('sys')`
     * from ./approver. REQUIRED. Every send must be traceable to the run that produced it.
     */
    runId: string;
    /** E.164 or the `...@c.us` conversation key. */
    to: string;
    /** The words. For a template send this is the RENDERED text, which is what SMS falls back to. */
    body: string;
    /**
     * 'whatsapp' (default) attempts WhatsApp with SMS fallback; 'sms' goes straight to SMS and
     * never touches WhatsApp.
     */
    channel?: OutboundChannel;
    /** Twilio Content template, for a WhatsApp send outside the 24h window. */
    contentSid?: string;
    contentVariables?: Record<string, string>;
    /** WhatsApp transport: the Twilio sender, or an onboarded coexistence number. */
    via?: 'twilio' | 'meta';
    mediaUrl?: string;
    mediaType?: string;
    /**
     * Turn the fallback off for callers that genuinely mean WhatsApp-or-nothing (a voice note has
     * no SMS equivalent). Default is on — silence is the failure mode we are fixing.
     */
    allowSmsFallback?: boolean;
    /** Free text for the alert and the logs, e.g. 'first_contact_ack:whatsapp'. */
    context?: string;
    /** Shown in the alert so the human knows who was dropped. */
    contactName?: string | null;
    /**
     * Why this is being sent, which decides whether an opt-out blocks it.
     *
     * OMITTED MEANS 'marketing' — the suppressible kind. That default is the whole design: a new
     * call site that never thought about opt-outs fails closed rather than quietly messaging
     * someone who asked us to stop.
     *
     * 'service_reply' is the deliberate exception and is meant to be hard to trigger by accident.
     * It has to be typed here, it is greppable, it NEVER gets past a 'do not contact' suppression,
     * and every use of it against a suppressed number is logged loudly. Use it for exactly two
     * things: a human's own typed reply from the comms composer, and a message the job requires
     * (booking confirmation, contractor on the way, invoice for work done). Never for a campaign,
     * a revival, a nudge or anything the system decided to start on its own.
     */
    purpose?: OutboundPurpose;
}

function codeOf(error: any): number | null {
    if (error instanceof TwilioSendError) return error.twilioCode;
    return typeof error?.code === 'number' ? error.code : null;
}

/**
 * Media cannot ride an SMS in this setup (MMS is not enabled on a UK number), and a template's
 * approved wording is a WhatsApp artefact — but its RENDERED text is just words, so it falls back
 * fine. This decides whether a fallback would still be honest.
 */
function fallbackIsPossible(input: SendCustomerMessageInput): boolean {
    if (input.allowSmsFallback === false) return false;
    if (input.mediaUrl) return false;          // nothing to send: SMS carries no media here
    return !!input.body?.trim();               // a template with no rendered text has no words to resend
}

/**
 * Send a message to a customer, choosing the pipe and falling back when the first one cannot
 * deliver. Never throws for a delivery problem — the outcome is the return value, because every
 * caller needs to record it rather than crash.
 */
export async function sendCustomerMessage(input: SendCustomerMessageInput): Promise<SendCustomerMessageResult> {
    const attempts: SendAttempt[] = [];

    // Rule -1, ahead of everything — even the opt-out check: no run id, no approver, no send.
    //
    // Phase 0 of the comms rebuild (2 Sep 2026). On 31 Aug–1 Sep six local dev processes sent 24
    // unguarded replies to real customers and nothing on the send path could say which code had
    // licensed them. Guarding approveAndSendDraft alone leaves every direct caller as an open door,
    // so the guard lives HERE, at the one exit. The type makes a missing field a compile error; this
    // runtime check catches the JS-shaped caller the type cannot see. Refused loudly, never thrown:
    // a caller that forgot its papers must still get a result it can record.
    const { approver, runId } = input as Partial<SendCustomerMessageInput>;
    if (!isApprover(approver) || typeof runId !== 'string' || !runId.trim()) {
        const summary = `Send refused: missing run id or approver (${input.context ?? 'no context'})`;
        console.error(
            `[Outbound] REFUSED send to ${input.to} — ${summary}; ` +
            `approver=${JSON.stringify(approver ?? null)} runId=${JSON.stringify(runId ?? null)}`,
        );
        void logSystemEvent({
            kind: 'send_refused',
            phone: e164Quietly(input.to),
            summary,
            detail: { approver: approver ?? null, runId: runId ?? null, context: input.context ?? null, purpose: input.purpose ?? null, channel: input.channel ?? 'whatsapp' },
            source: 'outbound',
        });
        return { ok: false, error: 'MISSING_RUN_ID_OR_APPROVER', attempts: [], fellBack: false };
    }

    let e164: string;
    try {
        e164 = toE164Recipient(input.to);
    } catch (error: any) {
        return { ok: false, attempts, fellBack: false, error: error?.message ?? 'unusable phone number' };
    }

    // Rule 0, ahead of every other rule: has this person told us to stop?
    //
    // This is the choke point precisely so the answer only has to be enforced once. It runs before
    // the channel decision, before any Twilio call and before a penny is spent, because the correct
    // handling of a suppressed recipient is that nothing leaves the building at all.
    //
    // A failure to READ the list is not a licence to send. If the query throws we refuse, because
    // "the database was slow" is not a defence for a message someone asked not to receive.
    const purpose: OutboundPurpose = input.purpose ?? 'marketing';
    let suppression;
    try {
        suppression = await blockedByOptOut(e164, purpose);
    } catch (error: any) {
        console.error(`[Outbound] Opt-out lookup failed for ${e164} — refusing the send:`, error?.message);
        return {
            ok: false, attempts, fellBack: false, reason: 'OPTED_OUT',
            error: 'Could not verify the opt-out list, so the send was refused. Retry once the database is reachable.',
        };
    }
    if (suppression) {
        console.warn(
            `[Outbound] REFUSED ${purpose} send to ${e164} (${input.context ?? 'no context'}): ` +
            `opted out ${suppression.scope} on ${suppression.at.toISOString()} via "${suppression.matchedKeyword ?? 'manual'}"`,
        );
        return {
            ok: false, attempts, fellBack: false, reason: 'OPTED_OUT',
            error: optOutRefusalMessage(suppression),
            optedOut: { scope: suppression.scope, at: suppression.at.toISOString(), source: suppression.source },
        };
    }
    if (purpose === 'service_reply') {
        // Not a refusal, but worth a line: the exception was exercised. If this appears against a
        // number that later complains, the log says which call site claimed the exemption.
        const record = await getOptOutQuietly(e164);
        if (record) {
            console.warn(
                `[Outbound] SERVICE REPLY allowed to ${e164} despite a ${record.scope} opt-out ` +
                `(${input.context ?? 'no context'}). Marketing to this number remains blocked.`,
            );
        }
    }

    const requested: OutboundChannel = input.channel ?? 'whatsapp';

    // Rule 1 + 2: decide, before spending anything, whether WhatsApp is even worth attempting.
    const landline = isNonMobileUkNumber(e164);
    if (requested === 'sms' || landline) {
        const reason = requested === 'sms' ? 'EXPLICIT_CHANNEL' : 'UK_LANDLINE';
        if (landline && requested !== 'sms') {
            console.log(`[Outbound] ${e164} is a UK non-mobile — skipping WhatsApp entirely, sending SMS`);
        }
        const sms = await trySms(e164, input, attempts);
        if (sms.ok) return { ok: true, channel: 'sms', sid: sms.sid, attempts, fellBack: false, reason };
        await raiseDroppedMessageAlert(e164, input, attempts);
        return { ok: false, attempts, fellBack: false, reason, error: sms.error };
    }

    // WhatsApp first.
    try {
        const result: any = await sendWhatsAppMessage(input.to, input.body, {
            contentSid: input.contentSid,
            contentVariables: input.contentVariables,
            via: input.via,
            mediaUrl: input.mediaUrl,
            mediaType: input.mediaType,
        });
        attempts.push({ channel: 'whatsapp', ok: true, sid: result?.sid ?? null });
        return { ok: true, channel: 'whatsapp', sid: result?.sid ?? null, attempts, fellBack: false };
    } catch (error: any) {
        const code = codeOf(error);
        attempts.push({ channel: 'whatsapp', ok: false, error: error?.message, code });

        const notOnWhatsApp = code != null && NOT_A_WHATSAPP_RECIPIENT_CODES.has(code);
        const senderBroken = code != null && SENDER_MISCONFIGURED_CODES.has(code);
        const windowShut = code != null && WINDOW_SHUT_CODES.has(code);
        const reason = notOnWhatsApp ? 'NOT_ON_WHATSAPP'
            : senderBroken ? 'SENDER_MISCONFIGURED'
                : windowShut ? 'WINDOW_SHUT'
                    : undefined;

        // An unrecognised code could be anything (rate limit, malformed content). Retrying it as
        // SMS is still better than dropping the customer, so we do — the alert below is what keeps
        // it honest.
        if (!fallbackIsPossible(input)) {
            await raiseDroppedMessageAlert(e164, input, attempts);
            return { ok: false, attempts, fellBack: false, reason, error: error?.message };
        }

        console.warn(`[Outbound] WhatsApp to ${e164} failed (code ${code ?? 'none'}: ${error?.message}) — retrying as SMS`);
        const sms = await trySms(e164, input, attempts);

        if (sms.ok) {
            // A recipient who simply is not on WhatsApp is normal business, not an incident. A
            // broken sender is an incident even though this particular customer got their message.
            if (senderBroken || reason === undefined) {
                await notifyOutboundSendFailure({
                    phone: e164,
                    contactName: input.contactName,
                    context: input.context,
                    attempts,
                    recovered: true,
                    body: input.body,
                }).catch(() => { });
            }
            // The customer HAS the message, but not by the pipe we intended — worth a row even
            // when it is not worth an alert, because a pattern of these is a broken sender.
            void logSystemEvent({
                kind: 'other',
                phone: e164,
                summary: `WhatsApp failed (code ${code ?? 'none'}), SMS carried it — ${input.context ?? 'no context'}`,
                detail: { code, reason, attempts, approver: input.approver, runId: input.runId },
                source: 'outbound',
            });
            return { ok: true, channel: 'sms', sid: sms.sid, attempts, fellBack: true, reason };
        }

        await raiseDroppedMessageAlert(e164, input, attempts);
        return { ok: false, attempts, fellBack: false, reason, error: sms.error ?? error?.message };
    }
}

/** For the refusal log only: a number that cannot even be parsed is still worth a row. */
function e164Quietly(to: string): string | null {
    try { return toE164Recipient(to); } catch { return null; }
}

/** Logging only — a lookup failure here must never turn an allowed service reply into a failure. */
async function getOptOutQuietly(e164: string) {
    try {
        const { getOptOut } = await import('./opt-out');
        return await getOptOut(e164);
    } catch {
        return null;
    }
}

async function trySms(e164: string, input: SendCustomerMessageInput, attempts: SendAttempt[]): Promise<SendAttempt> {
    try {
        const result = await sendSmsMessage(e164, smsBody(input.body));
        const attempt: SendAttempt = { channel: 'sms', ok: true, sid: result.sid };
        attempts.push(attempt);
        return attempt;
    } catch (error: any) {
        const attempt: SendAttempt = { channel: 'sms', ok: false, error: error?.message, code: codeOf(error) };
        attempts.push(attempt);
        return attempt;
    }
}

/**
 * WhatsApp copy is written as two or three short bursts split on a lone '---' line, because that is
 * how a person texts. On SMS each burst would be a separately billed message arriving out of order
 * on some handsets, so the bursts are joined into one message with a blank line between them. Same
 * words, one send.
 */
export function smsBody(body: string): string {
    return body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean).join('\n\n');
}

async function raiseDroppedMessageAlert(
    e164: string,
    input: SendCustomerMessageInput,
    attempts: SendAttempt[],
): Promise<void> {
    // Loud in the logs AND on a phone. The whole point of this module is that a message nobody
    // received is never something you have to go looking for.
    console.error(
        `[Outbound] MESSAGE NOT DELIVERED to ${e164} by any channel (${input.context ?? 'no context'}): ` +
        attempts.map((a) => `${a.channel}=${a.ok ? 'ok' : `${a.code ?? 'err'} ${a.error}`}`).join(' | '),
    );
    void logSystemEvent({
        kind: 'delivery_fail',
        phone: e164,
        summary: `NOT delivered by any channel (${input.context ?? 'no context'}): `
            + attempts.map((a) => `${a.channel}=${a.ok ? 'ok' : (a.code ?? 'err')}`).join(' | '),
        detail: { attempts, context: input.context ?? null },
        source: 'outbound',
    });
    await notifyOutboundSendFailure({
        phone: e164,
        contactName: input.contactName,
        context: input.context,
        attempts,
        recovered: false,
        body: input.body,
    }).catch((e) => console.warn('[Outbound] Failure alert could not be sent:', e?.message));
}
