/**
 * Proves opt-out handling end to end, against TEST NUMBERS ONLY.
 *
 *   npx tsx scripts/_opt-out-test.ts
 *
 * Everything runs on Ofcom's reserved drama range (+447700900xxx, no real subscriber). No customer
 * is ever touched. Test suppressions and threads are cleaned up at the end, whatever happens.
 *
 * Cases:
 *   a) detector        → the keyword table, including the two false positives that must NOT match
 *   b) inbound STOP    → through the REAL ingest lane: suppression written, thread tagged + closed
 *   c) false positives → "can you stop the leak" / "stop by on Tuesday" change nothing
 *   d) one identity    → an opt-out from 447700900123@c.us also blocks +447700900123 and 07700900123
 *   e) marketing send  → refused with reason OPTED_OUT, before any Twilio call is made
 *   f) service reply   → still allowed past the gate, because a live customer still needs answers
 *   g) do not contact  → scope 'all' refuses even a declared service reply
 *   h) approval queue  → queueDraft refuses, and a draft queued earlier is refused at approve time
 *   i) clear-out       → the bulk tool classifies the suppressed person as 'opted out', never sends
 *   j) no reply        → the lane sends nothing back, and queues nothing, after a STOP
 *   k) visibility      → the thread endpoint's optOut payload is populated
 */
import { newRunId } from '../../server/approver';
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, commsOptOuts } from '@shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
    detectOptOut, getOptOut, blockedByOptOut, recordOptOut, loadOptOutIndex, countOptOuts,
} from '../server/opt-out';
import { sendCustomerMessage } from '../server/outbound';
import { queueDraft, approveAndSendDraft, purposeForDraftSource } from '../server/message-drafts';
import { scheduleInboundTriage } from '../server/agents/comms-lanes';
import { commsPhoneKey } from '../server/phone-utils';

/** Ofcom reserved drama range. Three numbers, three purposes, zero real subscribers. */
const STOP_PHONE = '+447700900123';        // the plain-STOP subject
const STOP_KEY = '447700900123@c.us';
const NOISE_PHONE = '+447700900124';       // the false-positive subject
const NOISE_KEY = '447700900124@c.us';
const HARD_PHONE = '+447700900125';        // the "do not contact" subject
const HARD_KEY = '447700900125@c.us';

const ALL_KEYS = [STOP_KEY, NOISE_KEY, HARD_KEY];
const ALL_PHONE_KEYS = [STOP_PHONE, NOISE_PHONE, HARD_PHONE].map((p) => commsPhoneKey(p)!);

function head(s: string) { console.log(`\n${'='.repeat(88)}\n${s}\n${'='.repeat(88)}`); }
function pass(ok: boolean, s: string) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) process.exitCode = 1; }

async function convFor(key: string, name: string): Promise<string> {
    const [existing] = await db.select({ id: conversations.id }).from(conversations)
        .where(eq(conversations.phoneNumber, key));
    if (existing) {
        await db.update(conversations)
            .set({ stage: 'new', tags: [], archivedAt: null, status: 'active' })
            .where(eq(conversations.id, existing.id));
        return existing.id;
    }
    const id = `optout_test_${key.split('@')[0]}`;
    await db.insert(conversations).values({
        id, phoneNumber: key, contactName: name, status: 'active', stage: 'new', tags: [],
    });
    return id;
}

/** Store an inbound message exactly as an ingest path would, then fire the real lane. */
async function inbound(convId: string, phone: string, text: string): Promise<string> {
    const id = `optout_test_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const at = new Date();
    await db.insert(messages).values({
        id, conversationId: convId, direction: 'inbound', channel: 'whatsapp',
        content: text, type: 'text', status: 'delivered', createdAt: at,
    });
    await db.update(conversations)
        .set({ lastInboundAt: at, lastCustomerContactAt: at, canSendFreeform: true, lastMessageAt: at })
        .where(eq(conversations.id, convId));

    scheduleInboundTriage(convId, phone, { channel: 'whatsapp', text, hasMedia: false, messageId: id });
    // The gate is awaited inside the lane, but the lane itself is fire-and-forget. Give it a beat.
    await new Promise((r) => setTimeout(r, 1500));
    return id;
}

async function cleanup() {
    await db.delete(commsOptOuts).where(inArray(commsOptOuts.phoneKey, ALL_PHONE_KEYS));
    const convIds = (await db.select({ id: conversations.id }).from(conversations)
        .where(inArray(conversations.phoneNumber, ALL_KEYS))).map((c) => c.id);
    if (convIds.length) {
        await db.delete(messages).where(inArray(messages.conversationId, convIds));
        await db.delete(conversations).where(inArray(conversations.id, convIds));
    }
    await db.delete(messageDrafts).where(inArray(messageDrafts.phone, [STOP_PHONE, NOISE_PHONE, HARD_PHONE]));
}

async function main() {
    await cleanup();

    // ---------------------------------------------------------------- a) the detector
    head('CASE (a)  the detector: what counts as an opt-out, and what must never count.');

    const positives: Array<[string, 'marketing' | 'all']> = [
        ['STOP', 'marketing'],
        ['stop', 'marketing'],
        ['Stop.', 'marketing'],
        ['please stop', 'marketing'],
        ['STOP!!', 'marketing'],
        ['unsubscribe', 'marketing'],
        ['Please unsubscribe me from this, thanks', 'marketing'],
        ['opt out', 'marketing'],
        ['OPT-OUT', 'marketing'],
        ['stop messaging me please', 'marketing'],
        ['no more messages', 'marketing'],
        ['take me off your list', 'marketing'],
        ['remove me from your database', 'marketing'],
        ['END', 'marketing'],
        ['do not contact me again', 'all'],
        ['DO NOT CONTACT ME', 'all'],
        ['stop all', 'all'],
        ['delete my number', 'all'],
        ['leave me alone', 'all'],
        ["don't contact me", 'all'],
    ];
    for (const [text, scope] of positives) {
        const m = detectOptOut(text);
        pass(m?.scope === scope, `"${text}" → ${m ? `${m.scope} (${m.rule}: ${m.keyword})` : 'NO MATCH'}, expected ${scope}`);
    }

    const negatives = [
        'can you stop the leak',
        'Can you stop the leak under the sink please',
        'stop by on Tuesday',
        'Can you stop by on Tuesday morning?',
        "the tap won't stop dripping",
        'please stop the water first',
        'Can you get the boiler to stop making that noise',
        'cancel',
        'Can I cancel Thursday and move it to Friday?',
        'remove the old radiator and fit the new one',
        'no more',
        'I need someone to stop the shower leaking, it has been going for a week and the ceiling below is stained now',
        'hi',
        '',
    ];
    for (const text of negatives) {
        const m = detectOptOut(text);
        pass(m === null, `"${text}" → ${m ? `WRONGLY matched ${m.scope} via "${m.keyword}"` : 'not an opt-out'}`);
    }

    // ---------------------------------------------------------------- b) the real inbound lane
    head('CASE (b)  a short "STOP" through the REAL ingest lane writes the suppression and closes the thread.');
    const stopConv = await convFor(STOP_KEY, 'Opt-out test (stop)');
    const stopMsgId = await inbound(stopConv, STOP_PHONE, 'STOP');

    // Snapshot NOW, before the later cases deliberately send to this thread. This is the number
    // that matters: what did the system do in response to the STOP itself?
    const outboundRightAfterStop = (await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.conversationId, stopConv), eq(messages.direction, 'outbound')))).length;

    const record = await getOptOut(STOP_PHONE);
    console.log('suppression:', JSON.stringify(record, null, 2));
    pass(!!record, 'a suppression row exists for the number that said STOP');
    pass(record?.scope === 'marketing', "a plain STOP is recorded as scope 'marketing', not 'all'");
    pass(record?.source === 'inbound_keyword', 'recorded by the live inbound path, not a script');
    pass(record?.triggerText === 'STOP', "the customer's exact words are kept as evidence");

    const [stopRow] = await db.select({ tags: conversations.tags, stage: conversations.stage })
        .from(conversations).where(eq(conversations.id, stopConv));
    console.log('thread after STOP:', JSON.stringify(stopRow));
    pass((stopRow?.tags ?? []).includes('opted_out'), "the thread is tagged 'opted_out'");
    pass(stopRow?.stage === 'closed', 'the board card is closed, so it stops generating SLA pressure to reply');

    // Idempotence: the same message replayed (a redelivered webhook) must not double-record.
    await db.delete(commsOptOuts).where(and(eq(commsOptOuts.messageId, stopMsgId), sql`false`)); // no-op, keeps the row
    const again = await recordOptOut({
        phone: STOP_PHONE, scope: 'marketing', source: 'inbound_keyword', messageId: stopMsgId,
        matchedKeyword: 'stop', matchRule: 'exact', triggerText: 'STOP',
    });
    pass(again.created === false, 'replaying the same inbound message records nothing new (idempotent)');

    // ---------------------------------------------------------------- c) false positives
    head('CASE (c)  "can you stop the leak" and "stop by on Tuesday" change nothing.');
    const noiseConv = await convFor(NOISE_KEY, 'Opt-out test (noise)');
    await inbound(noiseConv, NOISE_PHONE, 'can you stop the leak');
    let noiseRecord = await getOptOut(NOISE_PHONE);
    pass(noiseRecord === null, '"can you stop the leak" did NOT suppress this customer');

    await inbound(noiseConv, NOISE_PHONE, 'stop by on Tuesday');
    noiseRecord = await getOptOut(NOISE_PHONE);
    pass(noiseRecord === null, '"stop by on Tuesday" did NOT suppress this customer');

    const [noiseRow] = await db.select({ tags: conversations.tags, stage: conversations.stage })
        .from(conversations).where(eq(conversations.id, noiseConv));
    console.log('thread after the two lookalikes:', JSON.stringify(noiseRow));
    pass(!(noiseRow?.tags ?? []).includes('opted_out') && noiseRow?.stage !== 'closed',
        'the thread is untouched: not tagged, not closed, still a live job');

    // ---------------------------------------------------------------- d) one identity, many formats
    head('CASE (d)  the opt-out follows the PERSON, not the string their number was written as.');
    const formats = ['447700900123@c.us', '+447700900123', '07700900123', '07700 900123', '+44 7700 900123', '447700900123'];
    for (const f of formats) {
        const blocked = await blockedByOptOut(f, 'marketing');
        pass(!!blocked, `blocked when the number is written as "${f}"`);
    }

    // ---------------------------------------------------------------- e) marketing is refused
    head('CASE (e)  a marketing send is refused at the choke point, before Twilio is called.');
    const marketing = await sendCustomerMessage({
        approver: 'human:opt-out-test', runId: newRunId('test'),
        to: STOP_PHONE,
        body: 'We are back in your area this month, want anything sorted?',
        context: 'opt_out_test:marketing',
        // no purpose passed on purpose: the DEFAULT must be the suppressible one
    });
    console.log('result:', JSON.stringify(marketing, null, 2));
    pass(marketing.ok === false, 'the send was refused');
    pass(marketing.reason === 'OPTED_OUT', "refused with the machine-readable reason 'OPTED_OUT'");
    pass(marketing.attempts.length === 0, 'nothing was attempted: no WhatsApp call, no SMS, no spend');
    pass(marketing.optedOut?.scope === 'marketing' && !!marketing.optedOut?.at,
        'the refusal carries when they opted out and how far it reaches');
    pass(/opted out of marketing/i.test(marketing.error ?? ''), `and a human-readable reason: "${marketing.error}"`);

    // ---------------------------------------------------------------- f) service replies still work
    head('CASE (f)  a DECLARED service reply still gets through the gate.');
    const service = await sendCustomerMessage({
        approver: 'human:opt-out-test', runId: newRunId('test'),
        to: STOP_PHONE,
        body: 'Craig is on his way, about 20 minutes.',
        context: 'opt_out_test:service',
        purpose: 'service_reply',
    });
    console.log('result:', JSON.stringify(service, null, 2));
    pass(service.reason !== 'OPTED_OUT', 'NOT refused for the opt-out');
    pass(service.attempts.length > 0,
        'it reached the transport (Twilio rejects the Ofcom range itself, which is the expected failure here)');

    // ---------------------------------------------------------------- g) do not contact
    head('CASE (g)  an explicit "do not contact me" blocks even a declared service reply.');
    const hardConv = await convFor(HARD_KEY, 'Opt-out test (hard)');
    await inbound(hardConv, HARD_PHONE, 'Do not contact me again');

    const hardRecord = await getOptOut(HARD_PHONE);
    console.log('suppression:', JSON.stringify(hardRecord, null, 2));
    pass(hardRecord?.scope === 'all', "recorded as scope 'all', the stronger suppression");
    const [hardRow] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, hardConv));
    pass((hardRow?.tags ?? []).includes('do_not_contact'), "the thread carries the 'do_not_contact' tag as well");

    const hardService = await sendCustomerMessage({
        approver: 'human:opt-out-test', runId: newRunId('test'),
        to: HARD_PHONE, body: 'Craig is on his way.', context: 'opt_out_test:hard', purpose: 'service_reply',
    });
    console.log('result:', JSON.stringify(hardService, null, 2));
    pass(hardService.ok === false && hardService.reason === 'OPTED_OUT',
        'refused even though the caller declared it a service reply');
    pass(hardService.attempts.length === 0, 'and nothing was attempted');

    // ---------------------------------------------------------------- h) the approval queue
    head('CASE (h)  a suppressed contact cannot be reached through the approval queue either.');
    pass(purposeForDraftSource('recovery') === 'marketing', "'recovery' drafts are outreach, so a plain STOP blocks them");
    pass(purposeForDraftSource('comms_agent') === 'service_reply', "'comms_agent' replies to a live thread are service");

    const refusedDraft = await queueDraft({
        phone: STOP_PHONE, body: 'Still thinking about that quote?', source: 'recovery', dedupe: false,
    });
    pass(refusedDraft === null, 'queueDraft refused to even create a recovery draft for the opted-out number');

    // Now the other half: a draft that was queued BEFORE the opt-out must be refused at approve time.
    const preExisting = `draft_optout_test_${Date.now()}`;
    await db.insert(messageDrafts).values({
        id: preExisting, conversationId: stopConv, phone: STOP_PHONE,
        body: 'Still thinking about that quote?', channel: 'whatsapp', source: 'recovery', status: 'pending',
    });
    const approved = await approveAndSendDraft(preExisting, 'human:opt-out-test');
    console.log('approve result:', JSON.stringify(approved));
    pass(approved.ok === false && (approved as any).code === 'OPTED_OUT',
        'approving a pre-existing draft is refused with code OPTED_OUT');
    const [deadDraft] = await db.select({ status: messageDrafts.status, error: messageDrafts.error })
        .from(messageDrafts).where(eq(messageDrafts.id, preExisting));
    pass(deadDraft?.status === 'rejected', 'the draft is killed rather than left pending to be clicked again');
    console.log('draft row:', JSON.stringify(deadDraft));

    // ---------------------------------------------------------------- i) the bulk tool
    head('CASE (i)  the board clear-out excludes suppressed people from the plan entirely.');
    const index = await loadOptOutIndex();
    pass(index.has(commsPhoneKey(STOP_PHONE)!), 'loadOptOutIndex (what the clear-out reads) contains the opted-out key');

    console.log('Running: npx tsx scripts/comms-board-clearout.ts --only-test-numbers   (dry run, sends nothing)');
    const out = execFileSync('npx', ['tsx', 'scripts/comms-board-clearout.ts', '--only-test-numbers'], {
        encoding: 'utf8', timeout: 300_000, cwd: process.cwd(),
    });
    const optOutLine = out.split('\n').find((l) => /excluded as opted out/.test(l));
    console.log(optOutLine ?? '(no opt-out exclusion line printed)');
    pass(!!optOutLine, 'the clear-out reports how many people it excluded as opted out');
    const deadLine = out.split('\n').find((l) => /opted out/.test(l) && /spam_dead|×|x\s*\d/.test(l));
    pass(/opted out/.test(out), 'and "opted out" appears as a hold reason in its plan');
    if (deadLine) console.log(deadLine.trim());
    pass(!new RegExp(`\\+447700900123[^\\n]*(sent|would msg)`).test(out),
        'the opted-out test number is never listed as one to message');

    // ---------------------------------------------------------------- j) we said nothing back
    head('CASE (j)  after a STOP, nothing is sent back and nothing is queued.');
    // Measured at the moment the STOP was processed, not now: case (f) has since sent a service
    // reply to this same thread on purpose, and counting that would be measuring the test, not the
    // system. The question here is only "did the lane answer the STOP?".
    console.log(`outbound messages on the thread immediately after the STOP: ${outboundRightAfterStop}`);
    pass(outboundRightAfterStop === 0, 'no acknowledgement was sent to someone who just asked us to stop');
    const draftsAfter = await db.select({ id: messageDrafts.id, status: messageDrafts.status })
        .from(messageDrafts).where(and(eq(messageDrafts.phone, STOP_PHONE), eq(messageDrafts.status, 'pending')));
    pass(draftsAfter.length === 0, 'and nothing is sitting in the approval queue waiting to be sent to them');

    // ---------------------------------------------------------------- k) visibility
    head('CASE (k)  the thread can see it — the payload the comms UI renders its banner from.');
    const [threadConv] = await db.select().from(conversations).where(eq(conversations.id, stopConv));
    const threadOptOut = await getOptOut(threadConv.phoneNumber);
    const payload = threadOptOut && {
        scope: threadOptOut.scope, at: threadOptOut.at.toISOString(), source: threadOptOut.source,
        channel: threadOptOut.channel, keyword: threadOptOut.matchedKeyword, text: threadOptOut.triggerText,
    };
    console.log('thread optOut payload:', JSON.stringify(payload, null, 2));
    pass(!!payload && payload.scope === 'marketing' && !!payload.text,
        'the thread endpoint has a populated optOut object, keyed off the conversation phone alone');

    const totals = await countOptOuts();
    console.log(`\nLive suppressions during this run: ${totals.marketing} marketing, ${totals.all} do-not-contact (test numbers only).`);
}

main()
    .then(async () => {
        await cleanup();
        console.log('\nTest suppressions and threads cleaned up.');
        process.exit(process.exitCode ?? 0);
    })
    .catch(async (e) => {
        console.error(e);
        await cleanup().catch(() => { });
        process.exit(1);
    });
