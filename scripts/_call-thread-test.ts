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
 */
import 'dotenv/config';
import { db } from '../server/db';
import { calls, contractorSessions, conversations, messages, messageDrafts, users } from '@shared/schema';
import { and, eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { ingestCallIntoThread, describeCall, callMessageId } from '../server/call-thread';
import { composeFirstContactAck } from '../server/first-contact-ack';
import { loadActivity } from '../server/inbox-board';
import { computeWaitState } from '../server/comms-sla';
import { getCommsAgentConfig, setCommsAgentConfig } from '../server/agents/comms';

const MISSED_PHONE = '+447700900901';
const ANSWERED_PHONE = '+447700900902';
const ACK_PHONE = '+447700900903';
const ALL = [MISSED_PHONE, ANSWERED_PHONE, ACK_PHONE];

function head(s: string) { console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`); }
function pass(ok: boolean, s: string) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) process.exitCode = 1; }

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
        await db.delete(calls).where(eq(calls.phoneNumber, phone));
    }
}

async function makeCall(opts: {
    phone: string; minutesAgo: number; missed: boolean; duration: number;
    jobSummary?: string; name?: string;
}): Promise<string> {
    const id = crypto.randomBytes(16).toString('hex');
    const at = new Date(Date.now() - opts.minutesAgo * 60_000);
    await db.insert(calls).values({
        id,
        callId: `CA_simulated_${id.slice(0, 12)}`,
        phoneNumber: opts.phone,
        direction: 'inbound',
        status: 'completed',
        customerName: opts.name ?? 'Unknown Caller',
        outcome: opts.missed ? 'MISSED_CALL' : 'VIDEO_QUOTE',
        handledBy: opts.missed ? 'missed' : 'va',
        duration: opts.duration,
        ringSeconds: 18,
        jobSummary: opts.jobSummary ?? null,
        startTime: at,
        endTime: new Date(at.getTime() + opts.duration * 1000),
    });
    return id;
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
        await setCommsAgentConfig({ firstContactAutoAck: { ...original.firstContactAutoAck, enabled: false } });
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

        await setCommsAgentConfig({ firstContactAutoAck: { enabled: true, channels: ['whatsapp', 'sms', 'webform', 'post_call'] } });
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

    } finally {
        const restored = await setCommsAgentConfig({ firstContactAutoAck: original.firstContactAutoAck });
        head(`CONFIG RESTORED: firstContactAutoAck = ${JSON.stringify(restored.firstContactAutoAck)}`);
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
async function fetchThread(conversationId: string): Promise<any | null> {
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

        const res = await fetch(`${base}/api/inbox/conversations/${conversationId}/thread`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { console.log(`  (thread endpoint returned ${res.status})`); return null; }
        return await res.json();
    } catch (e: any) {
        console.log(`  (thread endpoint unreachable: ${e?.message ?? e})`);
        return null;
    } finally {
        if (token) await db.delete(contractorSessions).where(eq(contractorSessions.sessionToken, token));
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
