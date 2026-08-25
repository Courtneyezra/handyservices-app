/**
 * Proves that an auto-acknowledgement does not stop the SLA clock, and that it still counts as
 * prior contact so nobody is acknowledged twice.
 *
 *   npx tsx scripts/_auto-ack-sla-test.ts
 *
 * Everything runs on two numbers in the Ofcom reserved drama range (+447700900xxx, no subscriber)
 * and touches nothing else. Nothing is sent: the fixtures are written straight into the tables in
 * exactly the shape server/first-contact-ack.ts + server/message-drafts.ts produce, because the
 * question under test is what the READ path concludes from those rows. Every row this script
 * creates is deleted at the end, whatever happens.
 *
 * Cases:
 *   1. inbound only              → awaitingReply, and a first contact
 *   2. + a MACHINE ack           → STILL awaitingReply, still on the board's unanswered count,
 *                                  but no longer a first contact (or we ack them twice)
 *   3. + a real human reply      → NOT awaitingReply
 *   4. + a quote send            → NOT awaitingReply (an ordinary outbound always answers)
 *   5. an ack BEN approved       → NOT awaitingReply (a human read the thread and decided)
 *   6. the ack draft row removed → still not a first contact; the `messages` rows carry it alone
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messages, messageDrafts } from '@shared/schema';
import { eq, inArray, ne, desc } from 'drizzle-orm';
import { loadActivity, toCard, BOARD_STAGES } from '../server/inbox-board';
import { computeWaitState } from '../server/comms-sla';
import { isFirstContact } from '../server/first-contact-ack';
import { AUTO_ACK_SOURCE, AUTO_ACK_APPROVER_PREFIX } from '../server/auto-ack-window';

/** Ofcom reserved test range. No real subscriber, and nothing here ever sends. */
const MACHINE_PHONE = '+447700900901';
const HUMAN_PHONE = '+447700900902';
const CONV_MACHINE = 'test_ack_conv_machine';
const CONV_HUMAN = 'test_ack_conv_human';

const key = (e164: string) => `${e164.replace('+', '')}@c.us`;

let failures = 0;
function pass(ok: boolean, label: string, detail?: string) {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
}
function head(s: string) { console.log(`\n=== ${s} ===`); }

const MIN = 60_000;
const T0 = new Date(Date.now() - 30 * MIN);              // customer messages
const ACK_APPROVED = new Date(T0.getTime() + 5_000);     // draft claimed
const ACK_BURST_1 = new Date(T0.getTime() + 6_000);
const ACK_BURST_2 = new Date(T0.getTime() + 8_000);
const ACK_SENT = new Date(T0.getTime() + 9_000);         // draft marked sent
const HUMAN_REPLY = new Date(T0.getTime() + 10 * MIN);

async function seedConversation(id: string, e164: string) {
    await db.insert(conversations).values({
        id,
        phoneNumber: key(e164),
        contactName: 'Auto-ack SLA test (reserved number)',
        status: 'active',
        stage: 'enquiry',
        priority: 'normal',
        lastMessageAt: T0,
        lastInboundAt: T0,
        lastCustomerContactAt: T0,
        lastMessagePreview: 'need a shelf putting up',
    });
    await db.insert(messages).values({
        id: `test_ack_in_${id}`,
        conversationId: id,
        direction: 'inbound',
        content: 'need a shelf putting up',
        channel: 'whatsapp',
        status: 'received',
        createdAt: T0,
    });
}

/** The two `messages` rows an ack's two bursts produce, plus the draft row that sent them. */
async function seedAckSend(convId: string, e164: string, approvedBy: string) {
    await db.insert(messageDrafts).values({
        id: `test_ack_draft_${convId}`,
        conversationId: convId,
        phone: e164,
        body: 'Hi, thanks for getting in touch.\n---\nIs it OK if we give you a quick call to run through it? Or just reply here with the details.',
        channel: 'whatsapp',
        source: AUTO_ACK_SOURCE,
        reason: '[ack_enquiry] First contact on whatsapp. Auto-acknowledged.',
        status: 'sent',
        createdAt: ACK_APPROVED,
        approvedAt: ACK_APPROVED,
        approvedBy,
        sentAt: ACK_SENT,
        sentMessageId: `SMtest${convId}`,
    });
    await db.insert(messages).values([
        {
            id: `test_ack_burst1_${convId}`, conversationId: convId, direction: 'outbound',
            content: 'Hi, thanks for getting in touch.', channel: 'whatsapp', status: 'sent',
            senderName: 'Agent', createdAt: ACK_BURST_1,
        },
        {
            id: `test_ack_burst2_${convId}`, conversationId: convId, direction: 'outbound',
            content: 'Is it OK if we give you a quick call to run through it?', channel: 'whatsapp',
            status: 'sent', senderName: 'Agent', createdAt: ACK_BURST_2,
        },
    ]);
}

/**
 * Compare two DB-READ timestamps, never a DB-read one against a JS Date.
 *
 * `loadActivity` reads its timestamps as raw strings out of `timestamp` (no time zone) columns, so
 * `new Date(str)` parses them in the SERVER's local zone. On Render (UTC) that is exact; on a
 * developer machine it shifts every read by the local offset. It shifts them all identically, which
 * is why the SLA and this feature are both correct either way, but it means an assertion that pins
 * a read value to a JS Date fails on any non-UTC machine for a reason that has nothing to do with
 * what is being tested. So the assertions below measure the GAP from lastInbound instead.
 */
function gapFromInbound(act: { lastInbound: Date | null; lastOutbound: Date | null } | undefined): number | null {
    if (!act?.lastInbound || !act?.lastOutbound) return null;
    return act.lastOutbound.getTime() - act.lastInbound.getTime();
}

async function waitFor(convId: string) {
    const activity = await loadActivity([convId]);
    const act = activity.get(convId);
    return {
        act,
        wait: computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null),
    };
}

/** The board's own Unanswered headline, built from the same rows and the same card shape. */
async function boardUnanswered(): Promise<{ total: number; ids: Set<string> }> {
    const rows = await db.select().from(conversations)
        .where(ne(conversations.status, 'archived'))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(300);
    const activity = await loadActivity(rows.map((r) => r.id));
    const cards = rows.map((r) => toCard(r, activity.get(r.id)));
    const unanswered = cards.filter((c) => c.wait.awaitingReply);
    return { total: unanswered.length, ids: new Set(unanswered.map((c) => c.id)) };
}

async function cleanup() {
    const ids = [CONV_MACHINE, CONV_HUMAN];
    await db.delete(messages).where(inArray(messages.conversationId, ids)).catch(() => { });
    await db.delete(messageDrafts).where(inArray(messageDrafts.phone, [MACHINE_PHONE, HUMAN_PHONE])).catch(() => { });
    await db.delete(conversations).where(inArray(conversations.id, ids)).catch(() => { });
}

async function main() {
    console.log(`Board stages: ${BOARD_STAGES.join(' | ')}`);
    await cleanup(); // in case a previous run died mid-way

    try {
        // ------------------------------------------------------------------ 1. inbound only
        head('1. the customer has written and nobody has answered');
        await seedConversation(CONV_MACHINE, MACHINE_PHONE);

        let state = await waitFor(CONV_MACHINE);
        pass(state.wait.awaitingReply, 'awaitingReply is true with only an inbound on the thread',
            `lastInbound=${state.act?.lastInbound?.toISOString()} lastOutbound=${state.act?.lastOutbound ?? 'null'}`);
        pass(await isFirstContact({ conversationId: CONV_MACHINE, phone: MACHINE_PHONE }),
            'and they are a first contact, so the ack lane may answer them');

        const beforeAck = await boardUnanswered();
        pass(beforeAck.ids.has(CONV_MACHINE), 'the thread is in the board\'s unanswered count',
            `board unanswered total = ${beforeAck.total}`);

        // ------------------------------------------------------------------ 2. the machine acks
        head('2. the MACHINE sends the acknowledgement (this is the bug)');
        await seedAckSend(CONV_MACHINE, MACHINE_PHONE, `${AUTO_ACK_APPROVER_PREFIX}whatsapp`);

        const outboundRows = await db.select({ id: messages.id, at: messages.createdAt })
            .from(messages)
            .where(eq(messages.conversationId, CONV_MACHINE));
        pass(outboundRows.length === 3, 'the ack really is on the thread as two outbound message rows',
            `${outboundRows.length} message rows total (1 inbound + 2 ack bursts)`);

        state = await waitFor(CONV_MACHINE);
        pass(state.act?.lastOutbound === null,
            'loadActivity reports NO lastOutbound: neither burst counts as a reply',
            `lastOutbound=${state.act?.lastOutbound ?? 'null'}`);
        pass(state.wait.awaitingReply,
            'the customer is STILL awaiting a reply after a machine receipt',
            `severity=${state.wait.severity} waited=${state.wait.waitingWorkingHours}h`);

        const afterAck = await boardUnanswered();
        pass(afterAck.ids.has(CONV_MACHINE),
            'and they are STILL in the board\'s unanswered count',
            `board unanswered total = ${afterAck.total} (was ${beforeAck.total})`);
        pass(afterAck.total === beforeAck.total,
            'the headline number did not drop when the ack sent');

        pass(!(await isFirstContact({ conversationId: CONV_MACHINE, phone: MACHINE_PHONE })),
            'FOR FIRST-CONTACT PURPOSES the ack DOES count, so nobody gets acked twice');

        // ------------------------------------------------------------------ 3. a human replies
        head('3. a human actually replies');
        await db.insert(messages).values({
            id: 'test_ack_human_reply', conversationId: CONV_MACHINE, direction: 'outbound',
            content: 'Hi, happy to sort that. Could you send me a picture of the wall?',
            channel: 'whatsapp', status: 'sent', senderName: 'Ben', createdAt: HUMAN_REPLY,
        });

        state = await waitFor(CONV_MACHINE);
        pass(!state.wait.awaitingReply, 'the clock stops on a real reply',
            `lastOutbound=${state.act?.lastOutbound?.toISOString()}`);
        pass(gapFromInbound(state.act) === HUMAN_REPLY.getTime() - T0.getTime(),
            'and lastOutbound is the human message, not the ack burst',
            `${gapFromInbound(state.act)}ms after the inbound, expected ${HUMAN_REPLY.getTime() - T0.getTime()}ms`);

        const afterHuman = await boardUnanswered();
        pass(!afterHuman.ids.has(CONV_MACHINE), 'the thread leaves the board\'s unanswered count',
            `board unanswered total = ${afterHuman.total}`);

        // ------------------------------------------------------------------ 4. a quote send
        head('4. a quote send answers the thread too');
        await db.delete(messages).where(eq(messages.id, 'test_ack_human_reply'));
        await db.insert(messages).values({
            id: 'test_ack_quote_send', conversationId: CONV_MACHINE, direction: 'outbound',
            content: 'Here is your quote: https://handyservices.app/quote/ab12cd',
            channel: 'whatsapp', status: 'sent', senderName: 'Agent', createdAt: HUMAN_REPLY,
        });
        state = await waitFor(CONV_MACHINE);
        pass(!state.wait.awaitingReply, 'a quote send stops the clock',
            `lastOutbound=${state.act?.lastOutbound?.toISOString()}`);

        // ------------------------------------------------------------------ 5. Ben approved it
        head('5. the SAME ack, approved by Ben instead of by the machine');
        await seedConversation(CONV_HUMAN, HUMAN_PHONE);
        await seedAckSend(CONV_HUMAN, HUMAN_PHONE, 'ben@handyservices.app');

        state = await waitFor(CONV_HUMAN);
        pass(!state.wait.awaitingReply,
            'a draft a HUMAN approved stops the clock, even from the first_contact_ack lane',
            `lastOutbound=${state.act?.lastOutbound?.toISOString()}`);
        pass(gapFromInbound(state.act) === ACK_BURST_2.getTime() - T0.getTime(),
            'and the ack bursts are counted as the reply they are in that case',
            `${gapFromInbound(state.act)}ms after the inbound, expected ${ACK_BURST_2.getTime() - T0.getTime()}ms`);

        // ------------------------------------------------------------------ 6. drafts row gone
        head('6. the messages rows carry first-contact on their own');
        await db.delete(messageDrafts).where(eq(messageDrafts.id, `test_ack_draft_${CONV_HUMAN}`));
        pass(!(await isFirstContact({ conversationId: CONV_HUMAN, phone: HUMAN_PHONE })),
            'still not a first contact with the draft row removed: the outbound rows alone prove it');

    } finally {
        await cleanup();
        head(`FIXTURES REMOVED (${MACHINE_PHONE}, ${HUMAN_PHONE})`);
    }

    console.log(failures === 0 ? '\nAll auto-ack SLA cases passed.' : `\n${failures} case(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await cleanup().catch(() => { }); process.exit(1); });
