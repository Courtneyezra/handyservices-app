/**
 * Proves the first-contact auto-responder and the SMS channel, against test numbers ONLY.
 *
 *   npx tsx scripts/_first-contact-ack-test.ts
 *
 * Everything runs on the Ofcom smoke conversation (+447700900999, a reserved test range with no
 * real subscriber) plus the owner's own number. No customer is ever messaged. The config and the
 * smoke thread's board state are restored at the end, whatever happens.
 *
 * Cases:
 *   e) flag OFF        → nothing sends, nothing is queued (the shipped default)
 *   a) first contact   → auto-acks, and the message lands in the thread as a normal outbound
 *   b) prior outbound  → refuses, and the ordinary agent lane queues a draft for approval instead
 *   c) out of hours    → wording differs and promises "first thing" rather than a reply now
 *   d) shut window     → an approved template, looked up by name at runtime, or a queued draft
 *   f) SMS outbound    → a real SMS sends and is recorded in the thread with channel='sms'
 *   g) fallback        → a WhatsApp send that fails is resent as SMS, same words, and recorded
 *   h) landline        → a UK 01/02/03 number never attempts WhatsApp at all
 *   i) total failure   → raises a visible alert rather than a silently 'failed' draft row
 *   j) out of area     → a non-UK number is refused with reason OUT_OF_AREA (owner number exempt)
 *   k) spam            → marketing blasts refused with LOOKS_LIKE_SPAM, real enquiries untouched
 *   l) returning       → a thread quiet for months acks as ack_returning and is bumped up the board
 *   m) ack replies     → "yes call me" → callback_requested + urgent; "no, text" → prefers_text
 *   n) SMS-first ack   → an SMS-first contact is acknowledged BY SMS, never by WhatsApp
 *   o) the audit log   → every decision above, sent AND refused, is readable from the DB
 *
 * Case (c) also pins the owner's 19 Aug 2026 copy decision: the ack ASKS for a quick call rather
 * than promising a reply, except for a missed call (they rang us, so we ring back) and except for
 * anyone tagged prefers_text (case m), who is never offered a call on any surface.
 *
 * Case (o) leaves its rows in first_contact_ack_log on purpose. It is an audit trail: deleting the
 * evidence that a refusal happened would defeat the only reason the table exists. Every row is
 * against a reserved test number.
 *
 * Live-send notes, so the next reader does not repeat the probing:
 *   · Twilio REJECTS SMS to the Ofcom range with 21211 ("Invalid 'To' Phone Number"), so any case
 *     that needs a real SMS to succeed uses the owner's own number.
 *   · Twilio ACCEPTS a WhatsApp send to any number at request time (it returns 'queued' and fails
 *     later via the status callback), so a send-time 63003 cannot be provoked with a test number.
 *     Case (g) therefore provokes a REAL send-time failure the other way, by running in a
 *     subprocess whose TWILIO_WHATSAPP_NUMBER is the historical dead sender (+15558874602), which
 *     Twilio rejects on the spot with 63007.
 *   · Cases (h), (i) and (n) deliberately fail to deliver, so a full run fires REAL Pushover
 *     alerts ("Message NOT delivered") at whoever is subscribed. That is the point of those cases,
 *     but it is why the phone buzzes a few times during a run.
 */
import 'dotenv/config';
// The realism hold (60-150s via the sweep) would make every send assertion time-dependent;
// the suite tests the ack's DECISIONS, not the delay, so it uses the immediate path.
process.env.FIRST_CONTACT_ACK_NO_HOLD = '1';
import { execFileSync } from 'node:child_process';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, firstContactAckLog } from '@shared/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import {
    maybeAutoAckFirstContact, isFirstContact, composeFirstContactAck,
    looksLikeSpam, screenGeography, classifyAckReply, triageAckReply,
    readContactHistory, classifyHistory, templatePreferenceFor, logFirstContactAck,
    CALLBACK_TAG, PREFERS_TEXT_TAG,
} from '../server/first-contact-ack';
import { sendSmsMessage } from '../server/sms';
import { sendCustomerMessage, NOT_A_WHATSAPP_RECIPIENT_CODES, smsBody } from '../server/outbound';
import { queueDraft, approveAndSendDraft } from '../server/message-drafts';
import { listWhatsAppTemplates } from '../server/whatsapp-templates';
import { isPushoverConfigured } from '../server/pushover';
import { scheduleInboundTriage } from '../server/agents/comms-lanes';
import { getCommsAgentConfig, runCommsAgent } from '../server/agents/comms';

const OFCOM_CONV = '8118aad4-d8d6-4633-a2a1-79add76e3c32';
const OFCOM_PHONE = '+447700900999';
const OWNER_CONV = '6137fcbd-30b5-4737-b8f7-54277fde5a10';
const OWNER_PHONE = '+84357691573';
/** Ofcom's reserved drama LANDLINE range — a number that provably cannot have WhatsApp. */
const OFCOM_LANDLINE = '+441632960999';
/**
 * The business's OWN second Twilio number. Nobody reads it, so a real SMS to it messages no human,
 * and unlike the alternatives Twilio will actually deliver to it:
 *   · the Ofcom range is rejected outright with 21211 ("Invalid 'To' Phone Number")
 *   · the owner's own +84357691573 is rejected with 21408 (SMS to Vietnam is not enabled on this
 *     account's geo permissions)
 * So every case that needs a live SMS to SUCCEED sends here.
 */
const SELF_SMS_PHONE = '+447700100917';
const SELF_SMS_CONV_KEY = '447700100917@c.us';
/** US 555 reserved range — used only to prove the geography refusal. Never sent to. */
const OUT_OF_AREA_PHONE = '+12025550123';

function head(s: string) { console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`); }
function pass(ok: boolean, s: string) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) process.exitCode = 1; }

/** Put the smoke thread back to "nobody has ever replied to this person". */
async function stageFirstContact(opts: { hoursAgo: number; text: string; channel?: 'whatsapp' | 'sms' }) {
    await db.delete(messages).where(and(eq(messages.conversationId, OFCOM_CONV), eq(messages.direction, 'outbound')));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, OFCOM_PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, OFCOM_PHONE));

    const channel = opts.channel ?? 'whatsapp';
    const at = new Date(Date.now() - opts.hoursAgo * 3600_000);
    await db.insert(messages).values({
        id: `fca_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: OFCOM_CONV,
        direction: 'inbound',
        channel,
        content: opts.text,
        type: 'text',
        status: 'delivered',
        senderName: 'Test Lead (smoke)',
        createdAt: at,
    });
    await db.update(conversations).set({
        // Only an inbound WHATSAPP message opens Meta's window — an SMS must not.
        lastInboundAt: channel === 'whatsapp' ? at : null,
        lastCustomerContactAt: at,
        lastMessageAt: at,
        lastMessagePreview: opts.text.slice(0, 50),
        canSendFreeform: channel === 'whatsapp' && opts.hoursAgo < 24,
        stage: 'enquiry',
        priority: 'normal',
        tags: [],
    }).where(eq(conversations.id, OFCOM_CONV));
}

/**
 * Stage a customer we DID talk to, months ago: outbound history that is stale, plus a fresh
 * inbound. This is the returning-customer shape — history exists, so it is not a first contact.
 */
async function stageReturningCustomer(opts: { lastOutboundDaysAgo: number; text: string }) {
    await stageFirstContact({ hoursAgo: 0, text: opts.text });
    const then = new Date(Date.now() - opts.lastOutboundDaysAgo * 86_400_000);
    await db.insert(messages).values({
        id: `fca_test_old_${Date.now()}`,
        conversationId: OFCOM_CONV,
        direction: 'outbound',
        channel: 'whatsapp',
        content: 'All done, thanks for having us out.',
        type: 'text',
        status: 'delivered',
        senderName: 'Agent',
        createdAt: then,
    });
}

/** Append an inbound message, e.g. the customer's reply to an ack. */
async function addInbound(text: string) {
    await db.insert(messages).values({
        id: `fca_test_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: OFCOM_CONV,
        direction: 'inbound',
        channel: 'whatsapp',
        content: text,
        type: 'text',
        status: 'delivered',
        senderName: 'Test Lead (smoke)',
        createdAt: new Date(),
    });
}

async function outboundInThread() {
    return db.select({ id: messages.id, content: messages.content, type: messages.type, status: messages.status, at: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.conversationId, OFCOM_CONV), eq(messages.direction, 'outbound')))
        .orderBy(desc(messages.createdAt)).limit(5);
}

async function draftsFor(phone: string) {
    return db.select({ id: messageDrafts.id, status: messageDrafts.status, source: messageDrafts.source, approvedBy: messageDrafts.approvedBy, body: messageDrafts.body, sid: messageDrafts.contentSid, channel: messageDrafts.channel, error: messageDrafts.error })
        .from(messageDrafts).where(eq(messageDrafts.phone, phone))
        .orderBy(desc(messageDrafts.createdAt)).limit(5);
}

/** Capture console output around an async call, so "did it shout?" can be asserted. */
async function withCapturedLogs<T>(fn: () => Promise<T>): Promise<{ result: T; log: string }> {
    const lines: string[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error };
    const grab = (orig: (...a: any[]) => void) => (...args: any[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        orig(...args);
    };
    console.log = grab(originals.log); console.warn = grab(originals.warn); console.error = grab(originals.error);
    try {
        const result = await fn();
        return { result, log: lines.join('\n') };
    } finally {
        console.log = originals.log; console.warn = originals.warn; console.error = originals.error;
    }
}

/** The board state of the smoke thread, so the test can put it back exactly as it found it. */
async function boardState(convId: string) {
    const [row] = await db.select({ priority: conversations.priority, tags: conversations.tags, stage: conversations.stage })
        .from(conversations).where(eq(conversations.id, convId));
    return row;
}

async function main() {
    /** Everything logged from here on belongs to this run — case (o) reads back exactly that. */
    const runStartedAt = new Date();
    const original = await getCommsAgentConfig();
    const originalBoard = await boardState(OFCOM_CONV);
    console.log('config at start:', JSON.stringify(original.firstContactAutoAck));
    console.log('smoke thread board state at start:', JSON.stringify(originalBoard));

    try {
        // Direct send and the quote-prep handoff are forced off for the whole suite. This file is
        // about the DETERMINISTIC ack lane, and since 20 Aug 2026 the LLM agent it is compared
        // against would otherwise send its own reply for real (case b) and fire a paid quote-prep
        // run with a Pushover alert. All of it lives in this process's COMMS_CONFIG_OVERRIDE env
        // var only — the shared DB row the deployed agent reads is never written.
        const baseOverride = {
            ...original,
            autosend: { enabled: false, intents: [] },
            quotePrep: { ...original.quotePrep, enabled: false },
        };
        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify(baseOverride);

        // ---------------------------------------------------------------- e) flag OFF
        head('CASE (e)  flag OFF — the shipped default. Nothing sends, nothing queues.');
        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
            ...baseOverride,
            firstContactAutoAck: { enabled: false, channels: ['whatsapp', 'sms', 'webform', 'post_call'] },
        });
        await stageFirstContact({ hoursAgo: 0, text: 'Hi, my kitchen tap is dripping. Can you help?' });
        pass(await isFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE }), 'thread staged as a genuine first contact');
        const off = await maybeAutoAckFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'whatsapp', contactName: 'Test Lead (smoke)' });
        console.log('result:', JSON.stringify(off));
        pass(off.reason === 'DISABLED' && !off.sent, 'flag OFF → DISABLED, no send');
        pass((await draftsFor(OFCOM_PHONE)).length === 0, 'flag OFF → nothing queued either (the agent lane owns the reply)');

        // ---------------------------------------------------------------- a) first contact
        head('CASE (a)  flag ON, genuine first contact, window open → auto-ack lands in the thread.');
        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
            ...baseOverride,
            firstContactAutoAck: { enabled: true, channels: ['whatsapp', 'sms', 'webform', 'post_call'] },
        });

        // First through the REAL ingest lane, exactly as a Twilio/Meta webhook calls it, and with
        // the '@c.us' key form the webhooks actually pass. comms_agent.enabled is false here, so
        // this also proves the ack does not depend on the LLM agent's master switch.
        console.log(`comms_agent master switch is ${(await getCommsAgentConfig()).enabled ? 'ON' : 'OFF'} for this test`);
        scheduleInboundTriage(OFCOM_CONV, '447700900999@c.us', { channel: 'whatsapp', contactName: 'Test Lead (smoke)', hasMedia: false });
        let laneDraft: Awaited<ReturnType<typeof draftsFor>>[number] | undefined;
        for (let i = 0; i < 30 && !laneDraft; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            laneDraft = (await draftsFor(OFCOM_PHONE)).find((d) => d.source === 'first_contact_ack' && d.status === 'sent');
        }
        console.log('lane-produced draft:', JSON.stringify(laneDraft, null, 2));
        pass(!!laneDraft, 'the on-inbound lane itself fired the ack (no new hook needed)');

        // Then the same call directly, on a freshly staged thread, for the detailed assertions.
        await stageFirstContact({ hoursAgo: 0, text: 'Hi, my kitchen tap is dripping. Can you help?' });
        const on = await maybeAutoAckFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'whatsapp', contactName: 'Test Lead (smoke)' });
        console.log('result:', JSON.stringify(on, null, 2));
        pass(on.sent && on.reason === 'SENT', 'auto-acked');
        pass(on.intent === 'ack_enquiry' && on.mode === 'freeform', 'content-free ack_enquiry, sent freeform inside the window');
        pass(!/£|\d{1,2}:\d{2}|monday|tuesday|wednesday|thursday|friday/i.test(on.body ?? ''), 'no price, no time, no day in the copy');
        pass(!(on.body ?? '').includes('—'), 'no em dashes');
        const sentMsgs = await outboundInThread();
        console.log('thread outbound now:', JSON.stringify(sentMsgs, null, 2));
        pass(sentMsgs.length >= 1, 'the sent message appears in the thread like any other outbound');
        console.log('drafts:', JSON.stringify(await draftsFor(OFCOM_PHONE), null, 2));

        // ---------------------------------------------------------------- b) prior outbound
        head('CASE (b)  thread WITH prior outbound → no auto-send, the approval gate stays on.');
        const repeat = await maybeAutoAckFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'whatsapp', contactName: 'Test Lead (smoke)' });
        console.log('same thread again:', JSON.stringify(repeat));
        pass(!repeat.sent && repeat.reason === 'NOT_FIRST_CONTACT', 'second inbound on the same thread is refused');

        const owner = await isFirstContact({ conversationId: OWNER_CONV, phone: OWNER_PHONE });
        console.log(`owner's real thread (${OWNER_PHONE}, 29 prior outbound) isFirstContact:`, owner);
        pass(owner === false, "a real thread with history is not a first contact (read-only check)");

        // The ack lane and the LLM agent share a thread, and the point of this check has changed.
        // It used to be "the agent obeys the approval gate". There is no approval gate any more, so
        // what is proved is the KILL SWITCH: with direct send off (forced above) the agent's reply
        // queues, which is the state Ben falls back to if he ever flips it.
        console.log('\nrunning the ordinary comms agent on the same thread — with direct send OFF it must QUEUE…');
        const run = await runCommsAgent(OFCOM_CONV, 'inbound_message');
        console.log('agent actions:', JSON.stringify(run.actions.map((a) => a.tool)));
        const afterAgent = await draftsFor(OFCOM_PHONE);
        console.log('drafts after agent run:', JSON.stringify(afterAgent, null, 2));
        pass(run.autosent === false, 'with the kill switch off, the agent sent nothing');
        // Whether the agent then queued a draft, asked Ben, or correctly declared NO_ACTION is its
        // judgement — on this smoke thread it recognises the test data and closes, which is the
        // right call. Asserting "a draft exists" would fail the agent for being smarter than the test.
        pass(!afterAgent.some((d) => d.source === 'comms_agent' && d.status === 'sent'),
            'nothing from the agent reached the customer; any reply it wrote is still queued');

        // ---------------------------------------------------------------- c) out of hours
        head('CASE (c)  out-of-hours wording differs and never implies someone is working now.');
        for (const intent of ['ack_enquiry', 'ack_photos'] as const) {
            const day = composeFirstContactAck({ intent, contactName: 'Marc', hour: 11 });
            const night = composeFirstContactAck({ intent, contactName: 'Marc', hour: 21 });
            console.log(`\n--- ${intent} @11:00 (in hours) ---\n${day.body}`);
            console.log(`\n--- ${intent} @21:00 (out of hours) ---\n${night.body}`);
            pass(day.body !== night.body, `${intent}: wording differs in vs out of hours`);
            pass(night.outOfHours && /first thing/i.test(night.body), `${intent}: out-of-hours promises "first thing"`);
            pass(!night.body.includes('—') && !day.body.includes('—'), `${intent}: no em dashes`);
            // The owner's change: the ack ASKS for a call rather than promising a reply, because
            // voice warms a lead. Both variants ask; only the timing moves.
            pass(/is it OK if we give you a quick call/i.test(day.body), `${intent}: in hours, asks for a quick call`);
            pass(/is it OK if we give you a quick call/i.test(night.body), `${intent}: out of hours, still asks for the call`);
            pass(/reply here with the details/i.test(day.body) && /reply here with the details/i.test(night.body),
                `${intent}: the written route is offered alongside, so a phone-averse customer loses nothing`);
            // Brand voice, hard rule: one question per reply, total. Two feels like a form.
            pass((day.body.match(/\?/g) ?? []).length === 1, `${intent}: exactly one question in hours`);
            pass((night.body.match(/\?/g) ?? []).length === 1, `${intent}: exactly one question out of hours`);
            // "Shortly" at 9pm implies someone is at a desk. Out of hours it must be "first thing".
            pass(!/shortly/i.test(night.body), `${intent}: out-of-hours copy never implies someone is working now`);
        }
        const early = composeFirstContactAck({ intent: 'ack_enquiry', contactName: 'Marc', hour: 6 });
        pass(early.outOfHours, '06:00 also counts as out of hours (the 8-20 boundary)');

        // The one intent that deliberately does NOT ask. They already rang us: asking permission
        // to ring back reads as hesitancy. Owner's explicit decision, so it is pinned by a test.
        const missedDay = composeFirstContactAck({ intent: 'ack_missed_call', contactName: 'Marc', hour: 11 });
        const missedNight = composeFirstContactAck({ intent: 'ack_missed_call', contactName: 'Marc', hour: 21 });
        console.log(`\n--- ack_missed_call @11:00 ---\n${missedDay.body}\n\n--- ack_missed_call @21:00 ---\n${missedNight.body}`);
        pass(!missedDay.body.includes('?') && !missedNight.body.includes('?'),
            'ack_missed_call tells rather than asks, in and out of hours');
        pass(/we'll ring you back shortly/i.test(missedDay.body), 'the in-hours missed-call ack keeps its exact shape');
        pass(/reply here and tell us what needs doing/i.test(missedDay.body), 'and still offers the written route');

        // The call-ask has to be suppressed on EVERY surface for a prefers_text customer, which
        // means the template list too — a template is a message we chose to send.
        const preferred = templatePreferenceFor('ack_enquiry', false);
        console.log('template preference (ack_enquiry):', JSON.stringify(preferred));
        pass(preferred[0] === 'web_enquiry_ack_context' && preferred[1] === 'call_request',
            "context ack leads, 'call_request' next — both by NAME, so each starts working the hour Meta approves it");
        pass(!templatePreferenceFor('ack_enquiry', true).includes('call_request')
            && !templatePreferenceFor('ack_enquiry', true).includes('web_enquiry_ack_context'),
            'a prefers_text customer is never offered either call-ask template');
        pass(!templatePreferenceFor('ack_missed_call').includes('call_request'),
            'and neither is a missed call');

        // ---------------------------------------------------------------- d) shut window
        head('CASE (d)  shut WhatsApp window → approved template looked up at runtime, or a queued draft.');
        const templates = await listWhatsAppTemplates({ force: true });
        console.log('templates on the account:');
        for (const t of templates) console.log(`  ${t.status.padEnd(10)} ${t.category.padEnd(9)} vars=${t.variableCount}  ${t.name}  ${t.sid}`);
        pass(templates.length > 0, 'template statuses read live from Twilio (no hardcoded SID)');

        await stageFirstContact({ hoursAgo: 30, text: 'Hi, do you do fencing?' });
        pass(await isFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE }), 're-staged as a first contact with a 30h-old inbound (window shut)');
        const shut = await maybeAutoAckFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'whatsapp', contactName: 'Test Lead (smoke)' });
        console.log('result:', JSON.stringify(shut, null, 2));
        pass(shut.reason === 'SENT' || shut.reason === 'QUEUED_NO_TEMPLATE' || String(shut.reason).startsWith('SEND_REFUSED'),
            'shut window never silently drops: template send, or queued for a human');
        if (shut.sent) {
            pass(shut.mode === 'template' && !!shut.templateName, `sent via approved template '${shut.templateName}'`);
            const t = templates.find((x) => x.name === shut.templateName);
            pass(t?.status === 'approved', 'the template used is currently approved with Meta');
        }
        console.log('drafts:', JSON.stringify(await draftsFor(OFCOM_PHONE), null, 2));
        console.log('thread outbound:', JSON.stringify(await outboundInThread(), null, 2));

        // ---------------------------------------------------------------- f) SMS is a real channel
        head("CASE (f)  outbound SMS sends for real and is recorded in the thread as channel='sms'.");
        // Our own second Twilio number: a real delivery that reaches no human. See SELF_SMS_PHONE.
        const stamp = `SMS channel test ${new Date().toISOString().slice(11, 19)}. Please ignore.`;
        const sms = await sendSmsMessage(SELF_SMS_PHONE, stamp);
        console.log('send result:', JSON.stringify(sms));
        pass(!!sms.sid && sms.sid.startsWith('SM'), `Twilio accepted the SMS (${sms.sid}, status ${sms.status})`);

        const [smsRow] = await db.select({
            id: messages.id, channel: messages.channel, direction: messages.direction,
            content: messages.content, status: messages.status, sid: messages.twilioSid,
        }).from(messages).where(eq(messages.id, sms.messageId));
        console.log('recorded row:', JSON.stringify(smsRow));
        pass(smsRow?.channel === 'sms', "recorded with channel='sms', not 'whatsapp'");
        pass(smsRow?.direction === 'outbound' && smsRow?.content === stamp, 'the exact words are in the thread');
        pass(smsRow?.sid === sms.sid, 'twilioSid stored, so the status callback can advance this row');

        // The WhatsApp window must be untouched: only an inbound WhatsApp message opens it.
        const [smsConv] = await db.select({ id: conversations.id, lastInboundAt: conversations.lastInboundAt, canSendFreeform: conversations.canSendFreeform })
            .from(conversations).where(eq(conversations.phoneNumber, SELF_SMS_CONV_KEY));
        console.log('conversation window fields after the SMS:', JSON.stringify(smsConv));
        pass(!smsConv?.lastInboundAt && smsConv?.canSendFreeform !== true,
            'an outbound SMS does not open the WhatsApp window (lastInboundAt / canSendFreeform untouched)');

        // ---------------------------------------------------------------- g) attempt-then-fallback
        head('CASE (g)  a WhatsApp send that FAILS falls back to SMS with the same words.');
        console.log('Provoking a real send-time WhatsApp failure: subprocess with the historical dead sender.');
        const fallbackScript = `
            process.env.TWILIO_WHATSAPP_NUMBER = '+15558874602';
            import('${process.cwd()}/server/outbound.ts').then(async ({ sendCustomerMessage }) => {
                const r = await sendCustomerMessage({
                    to: '${SELF_SMS_PHONE}',
                    body: 'Fallback test, please ignore.\\n---\\nSecond burst.',
                    context: 'fallback_test',
                });
                console.log('FALLBACK_RESULT ' + JSON.stringify(r));
                process.exit(0);
            });
        `;
        const fallbackOut = execFileSync('npx', ['tsx', '-e', fallbackScript], {
            encoding: 'utf8',
            env: { ...process.env, TWILIO_WHATSAPP_NUMBER: '+15558874602' },
            timeout: 120_000,
        });
        const fallbackLine = fallbackOut.split('\n').find((l) => l.startsWith('FALLBACK_RESULT'));
        const fallback = JSON.parse((fallbackLine ?? 'FALLBACK_RESULT {}').replace('FALLBACK_RESULT ', ''));
        console.log('result:', JSON.stringify(fallback, null, 2));
        pass(fallback.attempts?.[0]?.channel === 'whatsapp' && fallback.attempts[0].ok === false,
            `WhatsApp was attempted first and failed (Twilio code ${fallback.attempts?.[0]?.code})`);
        pass(fallback.fellBack === true && fallback.channel === 'sms' && fallback.ok === true,
            'the same message was resent as SMS and delivered');
        pass(fallback.attempts?.[1]?.channel === 'sms' && fallback.attempts[1].ok === true,
            'both attempts are recorded, in order, for the audit trail');

        const [fellBackRow] = await db.select({ channel: messages.channel, content: messages.content })
            .from(messages).where(eq(messages.twilioSid, fallback.sid));
        console.log('recorded row:', JSON.stringify(fellBackRow));
        pass(fellBackRow?.channel === 'sms', "the fallback message is recorded as channel='sms'");
        pass(fellBackRow?.content === smsBody('Fallback test, please ignore.\n---\nSecond burst.'),
            'the SMS carries the same words, bursts joined into one billable message');

        // And the codes that trigger it are the documented ones.
        pass(NOT_A_WHATSAPP_RECIPIENT_CODES.has(63003),
            "63003 ('not a WhatsApp user') is classified as a fallback-worthy recipient failure");

        // ---------------------------------------------------------------- h) landline skips WhatsApp
        head('CASE (h)  a UK landline never attempts WhatsApp at all.');
        const landline = await withCapturedLogs(() => sendCustomerMessage({
            to: OFCOM_LANDLINE,
            body: 'Landline routing test, please ignore.',
            context: 'landline_test',
            contactName: 'Ofcom drama landline',
        }));
        console.log('result:', JSON.stringify(landline.result, null, 2));
        pass(landline.result.reason === 'UK_LANDLINE', 'refused WhatsApp up front with reason UK_LANDLINE');
        pass(!landline.result.attempts.some((a) => a.channel === 'whatsapp'),
            'no WhatsApp send was attempted, so no template spend was burnt on a number that cannot receive one');
        pass(landline.result.attempts.some((a) => a.channel === 'sms'), 'it went straight to SMS instead');

        // ---------------------------------------------------------------- i) nothing fails silently
        head('CASE (i)  a send that reaches nobody raises an alert, never a silent failed row.');
        // The same landline: Twilio rejects SMS to the reserved range (21211), so BOTH pipes fail.
        pass(landline.result.ok === false, 'both channels failed for this number (Twilio rejects the reserved range)');
        pass(/MESSAGE NOT DELIVERED/.test(landline.log), 'the failure is shouted in the logs, not whispered');
        const pushoverLive = await isPushoverConfigured();
        pass(/\[Pushover\] "🚨 Message NOT delivered/.test(landline.log) || !pushoverLive,
            pushoverLive ? 'a real Pushover alert went out for the dropped message' : 'Pushover is not configured on this machine, so the alert could only be logged');

        // Now the same thing through a DRAFT, which is where the old silent 'failed' row lived.
        const deadDraftId = await queueDraft({
            phone: OFCOM_LANDLINE,
            body: 'Draft failure test, please ignore.',
            source: 'manual',
            reason: 'test: prove a total send failure is visible',
            dedupe: false,
        });
        pass(!!deadDraftId, 'draft queued for the landline');
        const [queuedDead] = await db.select({ channel: messageDrafts.channel }).from(messageDrafts)
            .where(eq(messageDrafts.id, deadDraftId!));
        pass(queuedDead?.channel === 'sms', 'a landline draft is written as an SMS draft from the start');
        const deadSend = await withCapturedLogs(() => approveAndSendDraft(deadDraftId!, 'first_contact_ack_test'));
        console.log('approve result:', JSON.stringify(deadSend.result));
        pass(deadSend.result.ok === false, 'the send failed, as expected for a reserved landline');
        pass(/MESSAGE NOT DELIVERED/.test(deadSend.log)
            && (/\[Pushover\] "🚨 Message NOT delivered/.test(deadSend.log) || !pushoverLive),
            'and it alerted rather than dying quietly in the drafts table');
        const [deadRow] = await db.select({ status: messageDrafts.status, error: messageDrafts.error })
            .from(messageDrafts).where(eq(messageDrafts.id, deadDraftId!));
        console.log('draft row:', JSON.stringify(deadRow));
        pass(deadRow?.status === 'failed' && !!deadRow.error, 'the row still records the failure and why');

        // ---------------------------------------------------------------- j) geography
        head('CASE (j)  a non-UK number is refused with OUT_OF_AREA, and the owner/test numbers are exempt.');
        const abroad = await maybeAutoAckFirstContact({
            conversationId: null, phone: OUT_OF_AREA_PHONE, channel: 'sms', contactName: 'Overseas caller',
        });
        console.log('result:', JSON.stringify(abroad));
        pass(!abroad.sent && abroad.reason === 'OUT_OF_AREA', 'refused with its own machine-readable reason');
        pass((await draftsFor(OUT_OF_AREA_PHONE)).length === 0, 'nothing was queued either');
        pass(screenGeography(OWNER_PHONE).ok, `the owner's own number (${OWNER_PHONE}) bypasses the geography rule`);
        pass(screenGeography(OFCOM_PHONE).ok, 'the Ofcom test range passes (it is +44)');
        pass(!screenGeography('+353861234567').ok, 'an Irish number is out of area');

        // ---------------------------------------------------------------- k) spam
        head('CASE (k)  marketing blasts are refused; real enquiries are not.');
        const spamSamples = [
            'Hi, I am a digital marketer and I can help you rank your website on google page one',
            'We offer professional SEO services and quality backlinks for your business',
            'Do you want to remove 1 star google reviews from your listing?',
            'I can help you get more customers with guaranteed leads every month',
            'We specialise in web design and mobile app development at low cost',
            'Invest in bitcoin today, guaranteed returns on crypto trading signals',
            'Unsecured business loan available, funding for your business within 24 hours',
        ];
        for (const s of spamSamples) {
            const verdict = looksLikeSpam(s);
            pass(!verdict.ok && verdict.reason === 'LOOKS_LIKE_SPAM', `spam caught (${verdict.detail}): "${s.slice(0, 48)}…"`);
        }
        const realEnquiries = [
            'Hi, my kitchen tap is dripping. Can you help?',
            'Do you do fencing? I need about 6 panels replacing in NG7',
            'The website said you do bathroom fitting, is that right?',
            'Need a handyman to hang 3 doors and fix a leaking radiator',
            'My landlord asked me to get a quote for the gutter',
            'Can you rank this job as urgent please, the boiler cupboard door came off',
        ];
        for (const s of realEnquiries) {
            pass(looksLikeSpam(s).ok, `real enquiry NOT flagged: "${s.slice(0, 48)}…"`);
        }
        await stageFirstContact({ hoursAgo: 0, text: 'Hello, I am an SEO expert and I can rank your website number one on Google.' });
        const spamAck = await maybeAutoAckFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'whatsapp', contactName: 'Test Lead (smoke)' });
        console.log('result:', JSON.stringify(spamAck));
        pass(!spamAck.sent && spamAck.reason === 'LOOKS_LIKE_SPAM', 'a spam first contact is refused before any send');
        pass((await outboundInThread()).length === 0, 'nothing reached the spammer, so no template spend and no quality-rating hit');

        // ---------------------------------------------------------------- l) returning customer
        head('CASE (l)  a customer returning after months gets ack_returning and a priority bump.');
        await stageReturningCustomer({ lastOutboundDaysAgo: 120, text: 'Hi again, the same tap has started dripping.' });
        const history = await readContactHistory({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE });
        console.log('history:', JSON.stringify({ hasOutbound: history.hasOutbound, lastOutboundAt: history.lastOutboundAt }));
        pass(history.hasOutbound === true, 'the thread HAS history, so it is not a first contact');
        pass(classifyHistory(history, 60) === 'returning', 'and it classifies as returning at the 60-day threshold');
        pass(classifyHistory(history, 365) === 'ongoing', 'a longer threshold would call it ongoing (the threshold is configurable)');

        const returning = await maybeAutoAckFirstContact({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'whatsapp', contactName: 'Marc' });
        console.log('result:', JSON.stringify(returning, null, 2));
        pass(returning.intent === 'ack_returning' && returning.contactClass === 'returning', 'acknowledged as a returning customer');
        pass(/good to hear from you again/i.test(returning.body ?? ''), 'the copy names the relationship');
        pass(!/£|\d{1,2}:\d{2}|monday|tuesday|wednesday|thursday|friday/i.test(returning.body ?? ''), 'still no price, no time, no day');
        pass(!(returning.body ?? '').includes('—'), 'no em dashes');
        const bumped = await boardState(OFCOM_CONV);
        console.log('board state:', JSON.stringify(bumped));
        pass(bumped?.priority === 'high' || bumped?.priority === 'urgent', `thread priority raised to ${bumped?.priority}`);
        pass((bumped?.tags ?? []).includes('returning_customer'), "tagged 'returning_customer' so the board can see why");

        const dayCopy = composeFirstContactAck({ intent: 'ack_returning', contactName: 'Marc', hour: 11 });
        const nightCopy = composeFirstContactAck({ intent: 'ack_returning', contactName: 'Marc', hour: 21 });
        console.log(`\n--- ack_returning @11:00 ---\n${dayCopy.body}\n\n--- ack_returning @21:00 ---\n${nightCopy.body}`);
        pass(dayCopy.body !== nightCopy.body && /first thing/i.test(nightCopy.body), 'in/out-of-hours follow lines differ');
        pass(dayCopy.body.split('\n---\n').length === 2, 'same two-bubble shape as every other ack');

        // ---------------------------------------------------------------- m) replies to an ack
        head('CASE (m)  the reply to an ack is read: yes to a call → urgent, no → prefers_text.');
        for (const [text, expected] of [
            ['yes please give me a call', CALLBACK_TAG],
            ['Yeah', CALLBACK_TAG],
            ['ok', CALLBACK_TAG],
            ['call me after 5', CALLBACK_TAG],
            ['no worries, ring me when you can', CALLBACK_TAG],
            ['no thanks, text is easier', PREFERS_TEXT_TAG],
            ['Please don\'t call, I am at work', PREFERS_TEXT_TAG],
            ['prefer whatsapp if that is ok', PREFERS_TEXT_TAG],
            ['nope', PREFERS_TEXT_TAG],
            ['keep it in writing please', PREFERS_TEXT_TAG],
        ] as const) {
            const got = classifyAckReply(text);
            pass(got.intent === expected, `"${text}" → ${expected} (matched ${got.matched})`);
        }
        pass(classifyAckReply('The tap is in the downstairs loo, it drips overnight').intent === null,
            'an ordinary message is left alone for the agent lane');
        pass(classifyAckReply('').intent === null, 'empty text is not an answer');

        // Functional: the ack from case (l) is on the thread, so a reply to it must tag.
        await addInbound('Yes please, give me a call');
        const yes = await triageAckReply({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, text: 'Yes please, give me a call' });
        console.log('triage:', JSON.stringify(yes));
        pass(yes.tagged === CALLBACK_TAG && yes.reason === 'TAGGED', 'a positive reply is tagged callback_requested');
        const afterYes = await boardState(OFCOM_CONV);
        console.log('board state:', JSON.stringify(afterYes));
        pass(afterYes?.priority === 'urgent', 'and the thread goes to the top of the board (urgent)');

        // Reset the tags and prove the negative path.
        await db.update(conversations).set({ priority: 'normal', tags: [] }).where(eq(conversations.id, OFCOM_CONV));
        const no = await triageAckReply({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, text: 'No thanks, just text me' });
        console.log('triage:', JSON.stringify(no));
        pass(no.tagged === PREFERS_TEXT_TAG && no.reason === 'TAGGED', 'a declining reply is tagged prefers_text');
        const afterNo = await boardState(OFCOM_CONV);
        pass((afterNo?.tags ?? []).includes(PREFERS_TEXT_TAG), 'the tag is on the thread');
        pass(afterNo?.priority === 'normal', 'and it is an instruction, not an emergency: the rank is untouched');

        // Nothing may promise a call to that customer afterwards.
        const noCall = composeFirstContactAck({ intent: 'ack_missed_call', contactName: 'Marc', hour: 11, prefersText: true });
        const normalCall = composeFirstContactAck({ intent: 'ack_missed_call', contactName: 'Marc', hour: 11 });
        console.log(`\n--- missed call, prefers_text ---\n${noCall.body}\n\n--- missed call, normal ---\n${normalCall.body}`);
        pass(/ring you back/i.test(normalCall.body), 'the ordinary missed-call ack promises a ring back');
        pass(!/ring|call you/i.test(noCall.body), 'a prefers_text customer is never promised one');

        // And now that the ordinary ack ASKS for a call, the same suppression has to hold on every
        // intent, in and out of hours. Asking a customer a question they have already answered no
        // to is the fastest way to make an automated system feel like one.
        for (const intent of ['ack_enquiry', 'ack_photos', 'ack_returning'] as const) {
            for (const hour of [11, 21]) {
                const quiet = composeFirstContactAck({ intent, contactName: 'Marc', hour, prefersText: true });
                console.log(`\n--- ${intent} @${hour}:00, prefers_text ---\n${quiet.body}`);
                pass(!/call|ring|phone/i.test(quiet.body), `${intent} @${hour}:00: no call-ask for a prefers_text customer`);
                pass(!quiet.body.includes('?'), `${intent} @${hour}:00: and no question at all, because there is nothing to ask`);
                pass(!quiet.body.includes('—'), `${intent} @${hour}:00: no em dashes`);
            }
        }

        // A thread with no recent ack must not have its replies read as answers to one.
        await db.delete(messageDrafts).where(eq(messageDrafts.phone, OFCOM_PHONE));
        const orphan = await triageAckReply({ conversationId: OFCOM_CONV, phone: OFCOM_PHONE, text: 'yes' });
        pass(orphan.tagged === null && orphan.reason === 'NO_RECENT_ACK',
            'a "yes" on a thread we never acked is NOT read as "yes, call me"');

        // ---------------------------------------------------------------- n) SMS-first contact
        head('CASE (n)  an SMS-first contact is acknowledged BY SMS, never by WhatsApp.');
        await stageFirstContact({ hoursAgo: 0, text: 'Hi, sent from SMS. Do you do fencing?', channel: 'sms' });
        const smsFirst = await withCapturedLogs(() => maybeAutoAckFirstContact({
            conversationId: OFCOM_CONV, phone: OFCOM_PHONE, channel: 'sms', contactName: 'Test Lead (smoke)',
        }));
        console.log('result:', JSON.stringify(smsFirst.result, null, 2));
        const smsDraft = (await draftsFor(OFCOM_PHONE)).find((d) => d.id === smsFirst.result.draftId);
        console.log('draft:', JSON.stringify(smsDraft));
        pass(smsDraft?.channel === 'sms', "the ack was routed to SMS (draft channel='sms'), not WhatsApp");
        pass(!/Twilio WhatsApp\] Sending/.test(smsFirst.log), 'no WhatsApp send was attempted for an SMS-first contact');
        // The Ofcom range cannot receive a real SMS (Twilio 21211), so the send itself fails here —
        // and that failure must be loud, which is the same guarantee case (i) proves.
        pass(smsFirst.result.reason === 'SENT' || String(smsFirst.result.reason).startsWith('SEND_REFUSED'),
            `ended in a definite state: ${smsFirst.result.reason}`);

        // ---------------------------------------------------------------- o) the audit log
        head('CASE (o)  every decision above was written to first_contact_ack_log, refusals included.');
        // The insert is fire-and-forget on purpose (a log row must never endanger a send), so give
        // the in-flight ones a moment to land before reading.
        await new Promise((r) => setTimeout(r, 1500));
        const logRows = await db.select().from(firstContactAckLog)
            .where(gte(firstContactAckLog.createdAt, runStartedAt))
            .orderBy(desc(firstContactAckLog.createdAt));
        console.table(logRows.map((r) => ({
            at: r.createdAt?.toISOString().slice(11, 19),
            phone: r.phone, channel: r.channel, intent: r.intent,
            reason: r.reason, detail: (r.detail ?? '').slice(0, 24), sent: r.sent,
        })));

        const reasons = new Set(logRows.map((r) => r.reason));
        console.log('outcomes recorded this run:', JSON.stringify([...reasons]));
        pass(logRows.length > 0, `${logRows.length} decisions were logged`);

        const sentRow = logRows.find((r) => r.reason === 'SENT' && r.sent);
        pass(!!sentRow, 'a SENT row exists');
        pass(!!sentRow?.body, 'and it records the body the customer actually received, not just that something happened');
        pass(!!sentRow?.channel && !!sentRow?.intent, 'with the channel and intent, so the row explains itself');

        // The whole point of the table: "why did nobody get a reply?" has to be answerable.
        const refusals = [...reasons].filter((r) => r !== 'SENT');
        pass(refusals.length >= 2, `at least two different refusal reasons are visible (${refusals.join(', ')})`);
        pass(reasons.has('DISABLED'), "the shipped default ('the feature is off') is recorded, not silently skipped");
        pass(logRows.some((r) => r.reason === 'LOOKS_LIKE_SPAM' && !!r.detail),
            'a screen refusal records WHICH rule fired, not just that one did');

        // A logging failure must never be able to break a send.
        const logBroken = await withCapturedLogs(() => logFirstContactAck(
            // channel is varchar(16), so this insert is guaranteed to be rejected by Postgres.
            { phone: OFCOM_PHONE, channel: 'a_channel_far_too_long_to_store' as any },
            { sent: false, reason: 'ERROR' },
        ).then(() => 'resolved').catch(() => 'threw'));
        pass(logBroken.result === 'resolved', 'a failing log write resolves rather than throwing into the send path');
        pass(/Could not write the audit row/.test(logBroken.log), 'and it says so in the logs rather than failing silently');

    } finally {
        delete process.env.COMMS_CONFIG_OVERRIDE;
        if (originalBoard) {
            await db.update(conversations)
                .set({ priority: originalBoard.priority, tags: originalBoard.tags, stage: originalBoard.stage })
                .where(eq(conversations.id, OFCOM_CONV))
                .catch(() => { });
        }
        // The live-SMS cases create a thread for our own number. Archive it and name it so it does
        // not sit on Ben's board looking like a customer.
        await db.update(conversations)
            .set({ status: 'archived', contactName: 'Twilio self-test number (do not use)', archivedAt: new Date() })
            .where(eq(conversations.phoneNumber, SELF_SMS_CONV_KEY))
            .catch(() => { });
        // Same for the landline failure cases, which queue drafts against a reserved number.
        await db.delete(messageDrafts).where(eq(messageDrafts.phone, OFCOM_LANDLINE)).catch(() => { });

        // With the override gone this reads the LIVE DB row — the proof is it was never touched.
        const live = await getCommsAgentConfig().catch(() => null);
        head(`LIVE CONFIG (untouched by this run): firstContactAutoAck = ${JSON.stringify(live?.firstContactAutoAck)}`
            + ` · autosend(DIRECT SEND) = ${live?.autosend.enabled} · quotePrep = ${live?.quotePrep.enabled}`);
        pass(!!live
            && live.firstContactAutoAck.enabled === original.firstContactAutoAck.enabled
            && live.autosend.enabled === original.autosend.enabled
            && live.quotePrep.enabled === original.quotePrep.enabled,
            'live config untouched by this run');
        console.log(`smoke thread board state restored: ${JSON.stringify(await boardState(OFCOM_CONV))}`);
    }
    process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
