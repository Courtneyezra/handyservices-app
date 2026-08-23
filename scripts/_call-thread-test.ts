/**
 * Proves calls are first-class citizens of the comms board, against TEST NUMBERS ONLY.
 *
 *   npx tsx scripts/_call-thread-test.ts
 *
 * Everything runs on the Ofcom reserved range (+4477009009xx, no real subscriber). No customer is
 * ever messaged, and the firstContactAutoAck config is restored to its starting value at the end
 * whatever happens.
 *
 * Cases:
 *   1) missed call, no thread   → conversation created, channel='call' message, SLA clock running
 *   2) the WhatsApp window      → lastInboundAt UNTOUCHED (a call must never open it)
 *   3) board card               → preview + call channel + wait badge + counts as unanswered
 *   4) thread                   → the call appears ONCE, not twice
 *   5) idempotent               → re-ingest writes nothing new
 *   6) answered call            → preview carries the AI job summary; ack deferred to post-call
 *   7) ack OFF (shipped default) → nothing sends
 *   8) ack ON                   → a missed call acks with missed-call wording, not "thanks for
 *                                 your message"; the answered call still does not ack here
 *
 * Calls BEN MADE (the outbound card gate):
 *   9)  backfill safety         → without outboundOpensCard, an outbound call opens nothing
 *   10) outbound, unknown number → a card that reads "we called them", filed in scoping
 *   11) the four invariants     → no WhatsApp window, no SLA clock, no unread, no acknowledgement
 *   12) too short / unanswered  → a 4s misdial and a call nobody picked up open nothing
 *   13) not a customer          → contractor, staff and service numbers open nothing
 *   14) existing thread         → an outbound call still just appends, gate or no gate
 *   15) self-healing            → duration not yet known defers, and the re-run creates the card
 */
import 'dotenv/config';
process.env.FIRST_CONTACT_ACK_NO_HOLD = '1'; // suite asserts on sends, not the realism delay
import { db } from '../server/db';
import {
    calls, contractorJobLinks, contractorSessions, conversations, firstContactAckLog,
    jobDispatches, messages, messageDrafts, users,
} from '@shared/schema';
import { and, eq, like, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { ingestCallIntoThread, describeCall, callMessageId } from '../server/call-thread';
import { nonCustomerByShape } from '../server/internal-numbers';
import { composeFirstContactAck } from '../server/first-contact-ack';
import { loadActivity } from '../server/inbox-board';
import { computeWaitState } from '../server/comms-sla';
import { getCommsAgentConfig } from '../server/agents/comms';

const MISSED_PHONE = '+447700900901';
const ANSWERED_PHONE = '+447700900902';
const ACK_PHONE = '+447700900903';

// Outbound cases. Ofcom reserved ranges only, so nothing here can reach a real subscriber:
// 07700 900xxx is the drama mobile range and 0808 157 0xxx the drama freephone range.
const OUT_NEW_PHONE = '+447700900910';
const OUT_SHORT_PHONE = '+447700900911';
const OUT_NOANSWER_PHONE = '+447700900912';
const OUT_CONTRACTOR_PHONE = '+447700900913';
const OUT_STAFF_PHONE = '+447700900914';
const OUT_UNKNOWN_DURATION_PHONE = '+447700900915';
const OUT_SERVICE_PHONE = '+448081570001';
/**
 * The business's own second Twilio line. Asserted through the pure shape check ONLY, never through
 * a full ingest: cleanup deletes by phone number, and this is a live number that may carry real
 * rows. A test must not be able to delete production data if an assertion fails halfway.
 */
const OWN_BUSINESS_PHONE = '+447700100917';

const ALL = [
    MISSED_PHONE, ANSWERED_PHONE, ACK_PHONE,
    OUT_NEW_PHONE, OUT_SHORT_PHONE, OUT_NOANSWER_PHONE, OUT_CONTRACTOR_PHONE,
    OUT_STAFF_PHONE, OUT_UNKNOWN_DURATION_PHONE, OUT_SERVICE_PHONE,
];

function head(s: string) { console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`); }
function pass(ok: boolean, s: string) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) process.exitCode = 1; }

/** Marks every row this script creates, so cleanup can find them without guessing. */
const SIM = 'CA_simulated_';
const TEST_DISPATCH_ID = 'jd_call_thread_test';
const TEST_STAFF_USER_ID = 'usr_call_thread_test';

/** Remove everything a previous run of this script left behind. Test numbers only. */
async function cleanup() {
    for (const phone of ALL) {
        const digits = phone.replace(/\D/g, '');
        const convs = await db.select({ id: conversations.id }).from(conversations)
            .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`);
        for (const c of convs) {
            await db.delete(messages).where(eq(messages.conversationId, c.id));
            await db.delete(conversations).where(eq(conversations.id, c.id));
        }
        await db.delete(messageDrafts).where(eq(messageDrafts.phone, phone));
        await db.delete(firstContactAckLog).where(eq(firstContactAckLog.phone, phone));
        await db.delete(calls).where(eq(calls.phoneNumber, phone));
    }
    // Belt and braces: anything this script minted, whatever number it was against.
    await db.delete(calls).where(like(calls.callId, `${SIM}%`));

    // The stand-in contractor directory rows (case 13).
    await db.delete(contractorJobLinks).where(eq(contractorJobLinks.dispatchId, TEST_DISPATCH_ID));
    await db.delete(jobDispatches).where(eq(jobDispatches.id, TEST_DISPATCH_ID));
    await db.delete(users).where(eq(users.id, TEST_STAFF_USER_ID));
}

async function makeCall(opts: {
    phone: string; minutesAgo: number; missed: boolean; duration: number | null;
    jobSummary?: string; name?: string;
    /** Defaults to inbound. 'outbound' mirrors exactly what the SIP dial-status webhook writes. */
    direction?: 'inbound' | 'outbound';
}): Promise<string> {
    const id = crypto.randomBytes(16).toString('hex');
    const at = new Date(Date.now() - opts.minutesAgo * 60_000);
    const outbound = opts.direction === 'outbound';
    await db.insert(calls).values({
        id,
        callId: `${SIM}${id.slice(0, 12)}`,
        phoneNumber: opts.phone,
        direction: outbound ? 'outbound' : 'inbound',
        // Note the asymmetry, and that it is faithful: /api/twilio/sip-outbound-status always
        // records status 'completed' (the TwiML verb completed) and puts the real result in
        // `outcome`, whereas the inbound path encodes a miss in `handledBy`.
        status: 'completed',
        customerName: opts.name ?? 'Unknown Caller',
        outcome: outbound
            ? (opts.missed ? 'OUTBOUND_NO_ANSWER' : 'OUTBOUND_ANSWERED')
            : (opts.missed ? 'MISSED_CALL' : 'VIDEO_QUOTE'),
        handledBy: outbound ? 'va' : (opts.missed ? 'missed' : 'va'),
        duration: opts.duration,
        ringSeconds: outbound ? null : 18,
        jobSummary: opts.jobSummary ?? null,
        startTime: at,
        endTime: new Date(at.getTime() + (opts.duration ?? 0) * 1000),
    });
    return id;
}

/**
 * Registers OUT_CONTRACTOR_PHONE the way a real contractor is registered — through
 * contractor_job_links, which is the only one of the three directory sources with real data in it —
 * and OUT_STAFF_PHONE through users.phone.
 */
async function seedInternalDirectory() {
    await db.insert(jobDispatches).values({
        id: TEST_DISPATCH_ID,
        title: 'Call-thread test dispatch',
        customerFirstName: 'Test',
        postcode: 'NG1 1AA',
        tasks: [],
        totalHours: 10,
        totalContractorPayPence: 1000,
    }).onConflictDoNothing();
    await db.insert(contractorJobLinks).values({
        id: 'cjl_call_thread_test',
        dispatchId: TEST_DISPATCH_ID,
        contractorId: 'hp_call_thread_test',
        contractorName: 'Ofcom Contractor',
        contractorPhone: OUT_CONTRACTOR_PHONE,
        token: `call_thread_test_${crypto.randomBytes(8).toString('hex')}`,
    }).onConflictDoNothing();
    await db.insert(users).values({
        id: TEST_STAFF_USER_ID,
        email: `call-thread-test-${crypto.randomBytes(4).toString('hex')}@example.com`,
        firstName: 'Ofcom',
        lastName: 'Fitter',
        phone: OUT_STAFF_PHONE,
        role: 'contractor',
    }).onConflictDoNothing();
}

async function convFor(phone: string) {
    const digits = phone.replace(/\D/g, '');
    const [c] = await db.select().from(conversations)
        .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`).limit(1);
    return c ?? null;
}

async function callMessages(conversationId: string) {
    return db.select().from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.channel, 'call')));
}

async function main() {
    const original = await getCommsAgentConfig();
    console.log('firstContactAutoAck at start:', JSON.stringify(original.firstContactAutoAck));

    try {
        await cleanup();

        // ------------------------------------------------------------- 1) missed call, no thread
        head('CASE 1  A missed call from a number with no thread anywhere.');
        // Process-local override: the shared DB row the deployed agent reads is never written.
        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
            ...original,
            firstContactAutoAck: { ...original.firstContactAutoAck, enabled: false },
        });
        pass((await convFor(MISSED_PHONE)) === null, 'starting state: this caller has no conversation row');

        const missedId = await makeCall({ phone: MISSED_PHONE, minutesAgo: 90, missed: true, duration: 18 });
        const r1 = await ingestCallIntoThread(missedId, { markUnread: true, ack: true });
        console.log('ingest:', JSON.stringify(r1, null, 2));
        pass(r1.status === 'written' && !!r1.conversationCreated, 'conversation created for the caller');

        const conv1 = await convFor(MISSED_PHONE);
        pass(!!conv1 && conv1.stage === 'enquiry', 'lands in the enquiry column');
        pass(conv1?.lastMessagePreview === 'Missed call (18s)', `preview reads "${conv1?.lastMessagePreview}"`);

        const msgs1 = await callMessages(conv1!.id);
        console.log('call messages:', JSON.stringify(msgs1.map((m) => ({ id: m.id, ch: m.channel, dir: m.direction, st: m.status, body: m.content })), null, 2));
        pass(msgs1.length === 1, 'exactly one channel=call message row');
        pass(msgs1[0]?.direction === 'inbound' && msgs1[0]?.status === 'delivered', "direction 'inbound', status 'delivered'");
        pass(msgs1[0]?.id === callMessageId(missedId), 'deterministic id derived from the call record');
        pass(Math.abs((msgs1[0].createdAt as Date).getTime() - (Date.now() - 90 * 60_000)) < 60_000,
            'createdAt is the call start time, not now');

        // ------------------------------------------------------------- 2) the WhatsApp window
        head('CASE 2  A call must NOT open WhatsApp\'s 24h freeform window.');
        pass(conv1?.lastInboundAt === null, 'lastInboundAt untouched (null) — window stays shut');
        pass(conv1?.canSendFreeform !== true, 'canSendFreeform not set true');
        pass(!!conv1?.lastCustomerContactAt, 'lastCustomerContactAt IS set — ageing runs on the any-channel clock');

        // ------------------------------------------------------------- 3) the board card
        head('CASE 3  The board card: preview, phone channel, SLA clock, Unanswered count.');
        const act = (await loadActivity([conv1!.id])).get(conv1!.id);
        const wait = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);
        console.log('activity:', JSON.stringify(act), '\nwait:', JSON.stringify(wait));
        pass((act?.channels ?? []).includes('call'), "channels includes 'call' → the phone icon renders");
        pass(wait.awaitingReply, 'awaitingReply true → counts in the Unanswered headline');
        pass(wait.waitingWorkingHours >= 0 && wait.severity !== 'none', `SLA clock running (${wait.waitingWorkingHours} working hours, ${wait.severity})`);

        // ------------------------------------------------------------- 4) no duplicates
        head('CASE 4  The thread shows the call ONCE, not twice.');
        const thread = await fetchThread(conv1!.id);
        if (thread) {
            const callItems = thread.timeline.filter((t: any) => t.kind === 'call');
            const callMsgItems = thread.timeline.filter((t: any) => t.kind === 'message' && t.channel === 'call');
            console.log('timeline:', JSON.stringify(thread.timeline.map((t: any) => ({ kind: t.kind, id: t.id, ch: t.channel })), null, 2));
            pass(callItems.length === 1, 'one call event in the timeline');
            pass(callMsgItems.length === 0, 'the duplicate message copy is filtered out');
        } else {
            console.log('SKIP  thread endpoint not exercised over HTTP (set TEST_BASE_URL to a running dev server)');
            process.exitCode = 1; // a skipped proof is not a passed proof
        }

        // ------------------------------------------------------------- 5) idempotence
        head('CASE 5  Re-ingesting the same call changes nothing.');
        const r1b = await ingestCallIntoThread(missedId, { markUnread: true, ack: true });
        console.log('second ingest:', JSON.stringify(r1b));
        pass(r1b.status === 'updated', 'reported as an update, not a new write');
        pass((await callMessages(conv1!.id)).length === 1, 'still exactly one call message row');

        // ------------------------------------------------------------- 6) answered call
        head('CASE 6  An answered call carries its AI job summary into the preview.');
        const answeredId = await makeCall({
            phone: ANSWERED_PHONE, minutesAgo: 30, missed: false, duration: 143,
            jobSummary: 'Replacing the toilet seat cover.', name: 'Ofcom Tester',
        });
        const r2 = await ingestCallIntoThread(answeredId, { markUnread: true, ack: true });
        console.log('ingest:', JSON.stringify(r2, null, 2));
        const conv2 = await convFor(ANSWERED_PHONE);
        pass(conv2?.lastMessagePreview === 'Inbound call (2m 23s): Replacing the toilet seat cover.',
            `preview reads "${conv2?.lastMessagePreview}"`);
        pass(r2.ack?.reason === 'ANSWERED_HANDLED_BY_POST_CALL_OUTREACH',
            'an answered call is left to the post-call video request, so one call never sends two messages');
        pass(conv2?.lastInboundAt === null, 'still no WhatsApp window opened');

        // Filler summaries must not become previews.
        console.log('filler check:', JSON.stringify([
            describeCall({ direction: 'inbound', status: 'completed', outcome: null, handledBy: 'va', duration: 45, ringSeconds: 9, jobSummary: 'the job we discussed' }).preview,
            describeCall({ direction: 'inbound', status: 'completed', outcome: null, handledBy: 'va', duration: 45, ringSeconds: 9, jobSummary: 'Recovered from Twilio Logs' }).preview,
            describeCall({ direction: 'inbound', status: 'completed', outcome: null, handledBy: 'va', duration: 45, ringSeconds: 9, jobSummary: 'Unable to extract job description - none given.' }).preview,
        ]));
        pass(describeCall({ direction: 'inbound', status: 'completed', outcome: null, handledBy: 'va', duration: 45, ringSeconds: 9, jobSummary: 'the job we discussed' }).preview === 'Inbound call (45s)',
            'template filler "the job we discussed" never reaches a card');

        // ------------------------------------------------------------- 7) ack OFF
        head('CASE 7  firstContactAutoAck OFF (the shipped default) → a call sends nothing.');
        console.log('missed-call ack result with flag off:', JSON.stringify(r1.ack));
        pass(r1.ack?.reason === 'DISABLED' && r1.ack?.sent === false, 'DISABLED, nothing sent');
        pass((await db.select().from(messageDrafts).where(eq(messageDrafts.phone, MISSED_PHONE))).length === 0,
            'nothing queued either');

        // ------------------------------------------------------------- 8) ack ON, context-aware
        head('CASE 8  firstContactAutoAck ON → a missed call acks in MISSED wording.');
        const day = composeFirstContactAck({ intent: 'ack_missed_call', contactName: 'Marc', hour: 11 });
        const night = composeFirstContactAck({ intent: 'ack_missed_call', contactName: 'Marc', hour: 22 });
        const enquiry = composeFirstContactAck({ intent: 'ack_enquiry', contactName: 'Marc', hour: 11 });
        console.log(`\n--- ack_missed_call @11:00 ---\n${day.body}`);
        console.log(`\n--- ack_missed_call @22:00 ---\n${night.body}`);
        console.log(`\n--- ack_enquiry @11:00 (for contrast) ---\n${enquiry.body}`);
        pass(/missed your call/i.test(day.body), 'missed-call copy says we missed their call');
        pass(day.body !== enquiry.body, 'missed wording differs from the ordinary enquiry ack');
        pass(/ring you back/i.test(day.body) && /first thing/i.test(night.body), 'promises a call back, "first thing" out of hours');
        pass(!day.body.includes('—') && !night.body.includes('—'), 'no em dashes');
        pass(!/£|\d{1,2}:\d{2}/.test(day.body), 'no price and no promised time');

        process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
            ...original,
            firstContactAutoAck: { enabled: true, channels: ['whatsapp', 'sms', 'webform', 'post_call'] },
        });
        const ackCallId = await makeCall({ phone: ACK_PHONE, minutesAgo: 2, missed: true, duration: 6 });
        const r3 = await ingestCallIntoThread(ackCallId, { markUnread: true, ack: true });
        console.log('ingest with ack ON:', JSON.stringify(r3, null, 2));
        pass(r3.ack !== undefined && r3.ack.reason !== 'DISABLED', `the ack lane ran (${r3.ack?.reason})`);
        pass(['SENT', 'QUEUED_NO_TEMPLATE'].includes(String(r3.ack?.reason)) || String(r3.ack?.reason).startsWith('SEND_REFUSED'),
            'a call with the window shut either sends an approved template or queues for Ben, never silently drops');
        console.log('drafts for the ack number:', JSON.stringify(
            await db.select({ status: messageDrafts.status, source: messageDrafts.source, sid: messageDrafts.contentSid, body: messageDrafts.body })
                .from(messageDrafts).where(eq(messageDrafts.phone, ACK_PHONE)), null, 2));

        const conv3 = await convFor(ACK_PHONE);
        pass(conv3?.lastInboundAt === null, 'even with the ack on, the call did not open the WhatsApp window');

        // ============================================================= CALLS BEN MADE
        // The ack stays ON for all of these on purpose: "no acknowledgement fires" is only worth
        // proving against the configuration where one otherwise would.

        // ------------------------------------------------------------- 9) backfill safety
        head('CASE 9  Without outboundOpensCard, a call Ben made opens nothing (backfill safety).');
        const outNewId = await makeCall({
            phone: OUT_NEW_PHONE, minutesAgo: 20, missed: false, duration: 254,
            direction: 'outbound', jobSummary: 'Rang about the leaking stopcock under the sink.',
        });
        const r9 = await ingestCallIntoThread(outNewId, { markUnread: true, ack: true });
        console.log('ingest with the flag off:', JSON.stringify(r9));
        pass(r9.status === 'skipped' && r9.reason === 'OUTBOUND_CARDS_DISABLED',
            'skipped, and the reason says why — history is not rewritten by a backfill');
        pass((await convFor(OUT_NEW_PHONE)) === null, 'no conversation exists for the number Ben rang');

        // ------------------------------------------------------------- 10) the card that opens
        head('CASE 10  A real outbound call to an unknown number opens a card that reads "we called them".');
        const r10 = await ingestCallIntoThread(outNewId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('ingest with the flag on:', JSON.stringify(r10, null, 2));
        pass(r10.status === 'written' && !!r10.conversationCreated, 'conversation created for the number Ben rang');

        const convOut = await convFor(OUT_NEW_PHONE);
        pass(convOut?.stage === 'scoping',
            `lands in SCOPING, not enquiry (stage="${convOut?.stage}") — nobody enquired, we rang them`);
        pass(convOut?.lastMessagePreview === 'Outbound call (4m 14s)',
            `preview reads "${convOut?.lastMessagePreview}"`);

        const outMsgs = await callMessages(convOut!.id);
        console.log('call messages:', JSON.stringify(outMsgs.map((m) => ({ dir: m.direction, sender: m.senderName, body: m.content })), null, 2));
        pass(outMsgs.length === 1 && outMsgs[0]?.direction === 'outbound',
            "one call message, direction 'outbound' — it renders as us, not as an enquiry");
        pass(outMsgs[0]?.senderName === 'Handy Services', 'attributed to us, not to a caller');
        pass((outMsgs[0]?.content ?? '').includes('Rang about the leaking stopcock'),
            'the transcript summary is carried onto the card');

        // ------------------------------------------------------------- 11) the four invariants
        head('CASE 11  We called THEM: no window, no SLA clock, no unread badge, no acknowledgement.');
        pass(convOut?.lastInboundAt === null, 'lastInboundAt null — the WhatsApp 24h window stays shut');
        pass(convOut?.canSendFreeform !== true, 'canSendFreeform not set true');
        pass(convOut?.lastCustomerContactAt === null,
            'lastCustomerContactAt null — us ringing them is not them making contact');
        pass((convOut?.unreadCount ?? 0) === 0, 'no unread badge for a call we placed ourselves');

        const outAct = (await loadActivity([convOut!.id])).get(convOut!.id);
        const outWait = computeWaitState(outAct?.lastInbound ?? null, outAct?.lastOutbound ?? null);
        console.log('activity:', JSON.stringify(outAct), '\nwait:', JSON.stringify(outWait));
        pass(!outWait.awaitingReply && outWait.severity === 'none',
            'SLA clock NOT started — we are not waiting on ourselves');
        pass((outAct?.channels ?? []).includes('call'), "channels includes 'call' → the phone icon still renders");

        pass(r10.ack === undefined, 'the acknowledgement lane never even ran for an outbound call');
        pass((await db.select().from(messageDrafts).where(eq(messageDrafts.phone, OUT_NEW_PHONE))).length === 0,
            'nothing queued for Ben either');
        pass((await db.select().from(firstContactAckLog).where(eq(firstContactAckLog.phone, OUT_NEW_PHONE))).length === 0,
            'nothing written to the first-contact ack log — no "thanks for getting in touch" after we rang them');

        // The same claims again, but read off the endpoint Ben's browser actually calls, so this is
        // the card as it renders rather than a re-derivation of it from the row.
        const found = await fetchBoardCard(convOut!.id);
        if (found) {
            const { column, card } = found;
            console.log(`board column: ${column}\nboard card:`, JSON.stringify({
                preview: card.lastMessagePreview, unread: card.unreadCount,
                channels: card.channels, windowOpen: card.windowOpen, wait: card.wait,
                lastCustomerMessageAt: card.lastCustomerMessageAt,
            }, null, 2));
            pass(column === 'scoping' && card.lastMessagePreview === 'Outbound call (4m 14s)',
                `board card: rendered in the "${column}" column, "Outbound call (4m 14s)" on the face of it`);
            pass(card.unreadCount === 0 && card.windowOpen === false
                && card.wait?.awaitingReply === false && card.wait?.severity === 'none',
                'board card: no unread dot, window shut, no wait badge, not counted as unanswered');
        } else {
            console.log('SKIP  board endpoint not exercised over HTTP (set TEST_BASE_URL to a running dev server)');
            process.exitCode = 1; // a skipped proof is not a passed proof
        }

        // ------------------------------------------------------------- 12) substance
        head('CASE 12  A 4-second misdial and a call nobody answered open nothing.');
        const shortId = await makeCall({ phone: OUT_SHORT_PHONE, minutesAgo: 15, missed: false, duration: 4, direction: 'outbound' });
        const r12a = await ingestCallIntoThread(shortId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('4s outbound:', JSON.stringify(r12a));
        pass(r12a.reason === 'OUTBOUND_TOO_SHORT', 'a 4s call is below the 10s bar (41% of outbound calls are <=3s)');
        pass((await convFor(OUT_SHORT_PHONE)) === null, 'no card for the misdial');

        const noAnswerId = await makeCall({ phone: OUT_NOANSWER_PHONE, minutesAgo: 15, missed: true, duration: 0, direction: 'outbound' });
        const r12b = await ingestCallIntoThread(noAnswerId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('unanswered outbound:', JSON.stringify(r12b));
        pass(r12b.reason === 'OUTBOUND_UNANSWERED', 'a call nobody picked up is not the start of a relationship');
        pass((await convFor(OUT_NOANSWER_PHONE)) === null, 'no card for the unanswered call');
        pass(describeCall({
            direction: 'outbound', status: 'completed', outcome: 'OUTBOUND_NO_ANSWER',
            handledBy: 'va', duration: 0, ringSeconds: null, jobSummary: null,
        }).preview === 'Outbound call, no answer',
            'and when it lands on an EXISTING thread it reads honestly, not as "Outbound call (0s)"');

        // ------------------------------------------------------------- 13) not a customer
        head('CASE 13  Contractors, staff and service numbers never get a customer card.');
        await seedInternalDirectory();
        const contractorId = await makeCall({ phone: OUT_CONTRACTOR_PHONE, minutesAgo: 12, missed: false, duration: 300, direction: 'outbound' });
        const r13a = await ingestCallIntoThread(contractorId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('5-minute call to a contractor:', JSON.stringify(r13a));
        pass(r13a.reason === 'OUTBOUND_NON_CUSTOMER:INTERNAL_CONTRACTOR',
            'a five-minute call to a contractor_job_links number opens nothing');
        pass((await convFor(OUT_CONTRACTOR_PHONE)) === null, 'no card for the contractor');

        const staffId = await makeCall({ phone: OUT_STAFF_PHONE, minutesAgo: 12, missed: false, duration: 300, direction: 'outbound' });
        const r13b = await ingestCallIntoThread(staffId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('call to a users.role=contractor number:', JSON.stringify(r13b));
        pass(r13b.reason === 'OUTBOUND_NON_CUSTOMER:INTERNAL_CONTRACTOR', 'users.phone is checked too');

        const serviceId = await makeCall({ phone: OUT_SERVICE_PHONE, minutesAgo: 12, missed: false, duration: 553, direction: 'outbound' });
        const r13c = await ingestCallIntoThread(serviceId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('9-minute call to a freephone number:', JSON.stringify(r13c));
        pass(r13c.reason === 'OUTBOUND_NON_CUSTOMER:SERVICE_NUMBER',
            'an 0808 freephone line belongs to a company, never to a customer');

        console.log('shape checks:', JSON.stringify({
            own: nonCustomerByShape(OWN_BUSINESS_PHONE),
            sender: nonCustomerByShape('+447449501762'),
            nonGeo: nonCustomerByShape('03330112112'),
            nottinghamLandline: nonCustomerByShape('01159244006'),
            mobile: nonCustomerByShape('+447700900910'),
        }, null, 2));
        pass(nonCustomerByShape(OWN_BUSINESS_PHONE)?.code === 'OWN_NUMBER'
            && nonCustomerByShape('+447449501762')?.code === 'OWN_NUMBER',
            'both of the business\'s own numbers are refused');
        pass(nonCustomerByShape('03330112112')?.code === 'SERVICE_NUMBER', '03xx non-geographic refused');
        pass(nonCustomerByShape('01159244006') === null && nonCustomerByShape('+447700900910') === null,
            'a Nottingham landline and an ordinary mobile are NOT refused — no customer is excluded by shape');

        // ------------------------------------------------------------- 14) existing threads
        head('CASE 14  An outbound call to a thread that already exists still just appends.');
        const convBefore = await convFor(ANSWERED_PHONE);
        const stageBefore = convBefore?.stage;
        const msgsBefore = (await callMessages(convBefore!.id)).length;
        // Deliberately a SHORT one: the gate governs opening a card, never appending to a thread.
        const existingId = await makeCall({ phone: ANSWERED_PHONE, minutesAgo: 5, missed: false, duration: 4, direction: 'outbound' });
        const r14 = await ingestCallIntoThread(existingId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('outbound onto an existing thread:', JSON.stringify(r14));
        const convAfter = await convFor(ANSWERED_PHONE);
        pass(r14.status === 'written' && !r14.conversationCreated, 'appended to the existing thread, nothing created');
        pass((await callMessages(convAfter!.id)).length === msgsBefore + 1,
            'the short call IS recorded on a thread that already exists — the gate only blocks NEW cards');
        pass(convAfter?.stage === stageBefore, `stage unchanged ("${stageBefore}") — appending does not move the funnel`);
        pass(convAfter?.lastInboundAt === null, 'still no WhatsApp window');

        // ------------------------------------------------------------- 15) self-healing
        head('CASE 15  Duration not known yet defers the decision; the re-run makes it.');
        const pendingId = await makeCall({ phone: OUT_UNKNOWN_DURATION_PHONE, minutesAgo: 8, missed: false, duration: null, direction: 'outbound' });
        const r15a = await ingestCallIntoThread(pendingId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('duration still null:', JSON.stringify(r15a));
        pass(r15a.reason === 'OUTBOUND_DURATION_UNKNOWN', 'deferred rather than guessed');
        pass((await convFor(OUT_UNKNOWN_DURATION_PHONE)) === null, 'no card yet');

        await db.update(calls).set({ duration: 412 }).where(eq(calls.id, pendingId));
        const r15b = await ingestCallIntoThread(pendingId, { markUnread: true, ack: true, outboundOpensCard: true });
        console.log('after finalization fills the duration in:', JSON.stringify(r15b));
        pass(r15b.status === 'written' && !!r15b.conversationCreated,
            'ingest is idempotent, so the seven-minute call is not lost — it lands on the re-run');
        pass((await convFor(OUT_UNKNOWN_DURATION_PHONE))?.stage === 'scoping', 'and it lands in scoping too');

    } finally {
        delete process.env.COMMS_CONFIG_OVERRIDE;
        // With the override gone this reads the LIVE DB row — the proof is it was never touched.
        const live = await getCommsAgentConfig().catch(() => null);
        head(`LIVE CONFIG (untouched by this run): firstContactAutoAck = ${JSON.stringify(live?.firstContactAutoAck)}`);
        pass(!!live && live.firstContactAutoAck.enabled === original.firstContactAutoAck.enabled,
            'live config untouched by this run');
        if (!process.argv.includes('--keep')) {
            await cleanup();
            console.log('Test rows removed (Ofcom numbers only). Pass --keep to inspect them on the board.');
        }
    }
    process.exit(process.exitCode ?? 0);
}

/**
 * The real HTTP endpoint when a dev server is up, so the dedupe is proved through the code Ben's
 * browser actually calls rather than a reimplementation of it.
 *
 * /api/inbox is behind requireAdmin, so this mints a five-minute session for an existing admin and
 * deletes it straight after. Localhost only, and it grants nothing that is not already in the DB.
 */
async function apiGet(path: string): Promise<any | null> {
    const base = process.env.TEST_BASE_URL || 'http://localhost:5000';
    let token: string | null = null;
    try {
        const [admin] = await db.select({ id: users.id, email: users.email }).from(users)
            .where(eq(users.role, 'admin')).limit(1);
        if (!admin) { console.log('  (no admin user to borrow a session from)'); return null; }
        token = `test_call_thread_${crypto.randomBytes(16).toString('hex')}`;
        await db.insert(contractorSessions).values({
            sessionToken: token, userId: admin.id, expiresAt: new Date(Date.now() + 5 * 60_000),
        });

        const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { console.log(`  (${path} returned ${res.status})`); return null; }
        return await res.json();
    } catch (e: any) {
        console.log(`  (${path} unreachable: ${e?.message ?? e})`);
        return null;
    } finally {
        if (token) await db.delete(contractorSessions).where(eq(contractorSessions.sessionToken, token));
    }
}

const fetchThread = (conversationId: string) =>
    apiGet(`/api/inbox/conversations/${conversationId}/thread`);

/**
 * The card as Ben's browser receives it, straight off the board endpoint.
 *
 * The response is keyed by funnel column, so this also proves WHICH column the card is filed under
 * rather than trusting the stage field on the row.
 */
async function fetchBoardCard(conversationId: string): Promise<{ column: string; card: any } | null> {
    const board = await apiGet('/api/inbox/board?limit=1000');
    if (!board?.columns) return null;
    for (const [column, cards] of Object.entries(board.columns as Record<string, any[]>)) {
        const card = cards.find((c) => c.id === conversationId);
        if (card) return { column, card };
    }
    return null;
}

main().catch((e) => { console.error(e); process.exit(1); });
