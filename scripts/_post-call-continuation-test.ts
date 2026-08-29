/**
 * Proves the post-call continuation (T3) against TEST NUMBERS ONLY.
 *
 *   npx tsx scripts/_post-call-continuation-test.ts
 *
 * Everything runs on the Ofcom reserved drama range (+4477009009xx, no real subscriber). Nothing
 * auto-sends: firstContactAutoAck is forced off via the process-local env override, so every
 * positive outcome is a PENDING draft in the approval queue, deleted at the end. The two
 * appSettings rows this touches ('post_call_video_request', 'post_call_continuation') are
 * snapshotted first and restored in the finally block whatever happens.
 *
 * The continuation is ALWAYS a template send (a phone call never opens the WhatsApp 24h window),
 * so the suite seeds two fake approved rows into the whatsapp_templates cache under the real
 * template names with sentinel SIDs, and refuses to run at all if rows with those names already
 * exist that it did not put there.
 *
 * Cases:
 *   1) flag off (shipped default)      → DISABLED, nothing queued
 *   2) agreed + jobPhrase              → one pending draft, slotted template, deterministic id
 *   3) idempotency                     → ALREADY_SENT / ALREADY_QUEUED, one draft ever (any status)
 *   4) re-ingest trigger               → ingestCallIntoThread({continuation:true}) twice, still one
 *                                        draft, and the WhatsApp window stays shut
 *   5) the consent matrix              → declined / not_discussed / complaint / callback / spam /
 *                                        unclassified all refuse with NOT_AGREED:*
 *   6) slot fallbacks (integration)    → missing jobPhrase and a guard-tripping phrase both land
 *                                        on the GENERIC wording, never a mangled slot
 *   7) the pure ladder                 → normalizeJobRef, pickContinuationTemplate, and checkDraft
 *                                        over both exact bodies (clean) and toxic slots (refused)
 *   8) no approved template            → NO_APPROVED_TEMPLATE, fail closed, no draft
 *   9) video-path deferral             → with both flags on, the video request stands down with
 *                                        CONTINUATION_OWNS_AGREED; continuation off hands it back
 *   10) freshness                      → a call 2h old refuses TOO_OLD (the wording says "just now")
 *   11) coordination                   → an outbound message on the thread since the call, or ANY
 *                                        pending draft for the number, stands the continuation down
 *   12) shape guards                   → outbound calls and un-finalized calls refuse
 */
import 'dotenv/config';
import { db } from '../server/db';
import { appSettings, calls, conversations, messages, messageDrafts, whatsappTemplates } from '@shared/schema';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import crypto from 'crypto';
import {
    maybeSendPostCallContinuation, maybeSendPostCallVideoRequest,
    getContinuationConfig, setContinuationConfig, setOutreachConfig,
    continuationDraftId, normalizeJobRef, pickContinuationTemplate,
    CONTINUATION_TEMPLATE, CONTINUATION_GENERIC_TEMPLATE,
} from '../server/post-call-outreach';
import { ingestCallIntoThread } from '../server/call-thread';
import { checkDraft } from '../server/agents/draft-guards';
import { renderTemplateBody } from '../server/whatsapp-template-sync';
import { getCommsAgentConfig } from '../server/agents/comms';
import { isWhatsAppSenderConfigured } from '../server/whatsapp-sender';

// Ofcom drama numbers, one per case — the cross-call dedupe rail matches on phoneNumber, so
// reusing a number would leak one case's bookkeeping into the next.
const P_DISABLED = '+447700900920';
const P_HAPPY = '+447700900921';
const P_DECLINED = '+447700900922';
const P_NOTDISC = '+447700900923';
const P_COMPLAINT = '+447700900924';
const P_CALLBACK = '+447700900925';
const P_SPAM = '+447700900926';
const P_NOVERDICT = '+447700900927';
const P_NOPHRASE = '+447700900928';
const P_GUARDSLOT = '+447700900929';
const P_NOTEMPLATE = '+447700900930';
const P_DEFER = '+447700900931';
const P_TOOOLD = '+447700900932';
const P_THREADMSG = '+447700900933';
const P_OTHERDRAFT = '+447700900934';
const P_NOTINBOUND = '+447700900935';
const P_NOTCOMPLETED = '+447700900936';

const ALL = [
    P_DISABLED, P_HAPPY, P_DECLINED, P_NOTDISC, P_COMPLAINT, P_CALLBACK, P_SPAM, P_NOVERDICT,
    P_NOPHRASE, P_GUARDSLOT, P_NOTEMPLATE, P_DEFER, P_TOOOLD, P_THREADMSG, P_OTHERDRAFT,
    P_NOTINBOUND, P_NOTCOMPLETED,
];

/** Marks every calls row this script creates, so cleanup can find them without guessing. */
const SIM = 'CA_simcont_';
/** Sentinel Content SIDs for the seeded template cache rows. Never real. */
const TEST_SLOTTED_SID = 'HXTESTCONT1';
const TEST_GENERIC_SID = 'HXTESTCONT2';
const TEST_SIDS = [TEST_SLOTTED_SID, TEST_GENERIC_SID];

const SLOTTED_BODY = "Hi {{1}}, good to speak just now about {{2}}. This is the number to send over any photos or videos of the job, and we'll get your quote moving.";
const GENERIC_BODY = "Hi {{1}}, good to speak just now. This is the number to send over any photos or videos of the job, and we'll get your quote moving.";

const SETTING_KEYS = ['post_call_video_request', 'post_call_continuation'];

function head(s: string) { console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`); }
function pass(ok: boolean, s: string) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) process.exitCode = 1; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stored classifier verdict, complete enough for parseClassification to accept it. */
function verdict(over: Record<string, unknown> = {}) {
    return {
        kind: 'job_enquiry',
        whatsappAgreed: 'agreed',
        messagingObjection: false,
        jobSummary: 'Leaking kitchen tap under the sink, customer to send a video.',
        jobPhrase: 'the leaking kitchen tap',
        urgency: 'normal',
        callbackPromised: false,
        callIncomplete: false,
        bullets: ['Leaking kitchen tap', 'Customer will send a video'],
        classifiedAt: new Date().toISOString(),
        ...over,
    };
}

async function makeCall(opts: {
    phone: string;
    minutesAgo?: number;
    duration?: number;
    name?: string;
    direction?: 'inbound' | 'outbound';
    status?: string;
    classification?: Record<string, unknown> | null;
}): Promise<{ id: string; callId: string }> {
    const id = crypto.randomBytes(16).toString('hex');
    const callId = `${SIM}${id.slice(0, 12)}`;
    const at = new Date(Date.now() - (opts.minutesAgo ?? 5) * 60_000);
    const duration = opts.duration ?? 143;
    await db.insert(calls).values({
        id,
        callId,
        phoneNumber: opts.phone,
        direction: opts.direction ?? 'inbound',
        status: opts.status ?? 'completed',
        customerName: opts.name ?? 'Ben Tester',
        handledBy: 'va',
        duration,
        ringSeconds: 9,
        startTime: at,
        endTime: new Date(at.getTime() + duration * 1000),
        classification: opts.classification ?? null,
    });
    return { id, callId };
}

async function draftsFor(phone: string) {
    return db.select().from(messageDrafts).where(eq(messageDrafts.phone, phone));
}

async function convFor(phone: string) {
    const digits = phone.replace(/\D/g, '');
    const [c] = await db.select().from(conversations)
        .where(sql`regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`).limit(1);
    return c ?? null;
}

async function callRow(id: string) {
    const [c] = await db.select().from(calls).where(eq(calls.id, id)).limit(1);
    return c ?? null;
}

/** Remove everything a previous run of this script left behind. Test numbers and sentinels only. */
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
    await db.delete(calls).where(like(calls.callId, `${SIM}%`));
    await db.delete(whatsappTemplates).where(inArray(whatsappTemplates.contentSid, TEST_SIDS));
}

async function seedTemplates() {
    await db.insert(whatsappTemplates).values([
        {
            contentSid: TEST_SLOTTED_SID, name: CONTINUATION_TEMPLATE, status: 'approved',
            category: 'UTILITY', language: 'en_GB', body: SLOTTED_BODY,
            variables: { '1': 'Ben', '2': 'the leaking kitchen tap' },
        },
        {
            contentSid: TEST_GENERIC_SID, name: CONTINUATION_GENERIC_TEMPLATE, status: 'approved',
            category: 'UTILITY', language: 'en_GB', body: GENERIC_BODY,
            variables: { '1': 'Ben' },
        },
    ]).onConflictDoUpdate({
        target: whatsappTemplates.contentSid,
        set: { status: 'approved', body: sql`excluded.body`, name: sql`excluded.name` },
    });
}

async function main() {
    head('SETUP');
    console.log('WhatsApp sender configured:', isWhatsAppSenderConfigured());
    if (!isWhatsAppSenderConfigured()) {
        console.error('ABORT  isWhatsAppSenderConfigured() is false — every case would refuse NO_SENDER_CONFIGURED.');
        process.exit(1);
    }

    // Neon scales to zero: the first query after a cold start can die on connection timeout.
    // Warm the pool with a trivial select before anything that matters runs.
    for (let attempt = 1; ; attempt++) {
        try { await db.execute(sql`select 1`); break; }
        catch (e: any) {
            if (attempt >= 5) throw e;
            console.log(`DB warm-up attempt ${attempt} failed (${e?.message ?? e}), retrying...`);
            await sleep(2000);
        }
    }

    // Refuse to run if the REAL continuation templates already exist in the cache: the suite
    // seeds fake rows under the same names, and mixing the two would prove nothing.
    const foreign = (await db.select().from(whatsappTemplates)
        .where(inArray(whatsappTemplates.name, [CONTINUATION_TEMPLATE, CONTINUATION_GENERIC_TEMPLATE])))
        .filter((t) => !TEST_SIDS.includes(t.contentSid));
    if (foreign.length) {
        console.error('ABORT  Real template rows already exist under the continuation names:',
            foreign.map((t) => `${t.name}=${t.contentSid}(${t.status})`).join(', '));
        console.error('Re-point the test SIDs or retire this seeding once the real templates are live.');
        process.exit(1);
    }

    // Nothing may auto-send during the suite: force the first-contact exception off for THIS
    // process only (the deployed agent reads the DB row, which is never written here).
    const commsOriginal = await getCommsAgentConfig();
    process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
        ...commsOriginal,
        firstContactAutoAck: { ...commsOriginal.firstContactAutoAck, enabled: false },
    });

    const settingSnapshots = await db.select().from(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
    console.log('appSettings snapshot:', JSON.stringify(settingSnapshots.map((r) => ({ key: r.key, value: r.value }))));

    try {
        await cleanup();
        await seedTemplates();

        // Neutralize quiet hours (0->0 is never quiet) and keep both flags OFF to start. The
        // video config supplies the mechanical rail VALUES the continuation reuses; its enabled
        // flag stays false except in case 9.
        await setOutreachConfig({ enabled: false, quietHoursStart: 0, quietHoursEnd: 0, classify: true, mobileOnly: true, minDurationSeconds: 30 });
        await setContinuationConfig({ enabled: false, maxAgeMinutes: 60 });

        // ------------------------------------------------------------- 1) flag off
        head('CASE 1  Flag off (the shipped default) → DISABLED, nothing queued.');
        const disabledCall = await makeCall({ phone: P_DISABLED, classification: verdict() });
        const d1 = await maybeSendPostCallContinuation(disabledCall.id);
        console.log('decision:', JSON.stringify(d1));
        pass(d1.sent === false && d1.reason === 'DISABLED', 'DISABLED, nothing sent');
        pass((await draftsFor(P_DISABLED)).length === 0, 'nothing queued either');

        await setContinuationConfig({ enabled: true });

        // ------------------------------------------------------------- 2) the happy path
        head('CASE 2  Agreed on the call, usable jobPhrase → ONE pending draft, slotted wording.');
        const happy = await makeCall({ phone: P_HAPPY, name: 'Ben Tester', classification: verdict() });
        const d2 = await maybeSendPostCallContinuation(happy.id);
        console.log('decision:', JSON.stringify(d2));
        pass(d2.sent === false && d2.reason === 'QUEUED_FOR_APPROVAL', 'queued for approval, not sent (auto-ack forced off)');
        pass(d2.sid === continuationDraftId(happy.id), `deterministic draft id ${d2.sid}`);

        const drafts2 = await draftsFor(P_HAPPY);
        console.log('draft:', JSON.stringify(drafts2.map((d) => ({ id: d.id, status: d.status, source: d.source, sid: d.contentSid, vars: d.contentVariables, body: d.body })), null, 2));
        pass(drafts2.length === 1, 'exactly one draft');
        const draft = drafts2[0];
        pass(draft?.status === 'pending', 'status pending — a human approves it');
        pass(draft?.source === 'post_call_continuation', "source 'post_call_continuation' (blocked by a plain STOP)");
        pass(draft?.contentSid === TEST_SLOTTED_SID, 'slotted template chosen');
        pass((draft?.contentVariables as any)?.['2'] === 'the leaking kitchen tap', '{{2}} carries the jobPhrase');
        pass(draft?.body === "Hi Ben, good to speak just now about the leaking kitchen tap. This is the number to send over any photos or videos of the job, and we'll get your quote moving.",
            'body reads as a continuation of the call, video ask INSIDE the same single message');

        const happyRow = await callRow(happy.id);
        pass(!!happyRow?.videoRequestSentAt, 'videoRequestSentAt set — the video path dedupe counts this ask');
        pass(happyRow?.outcome === 'VIDEO_QUOTE', 'call outcome recorded as VIDEO_QUOTE');
        pass((await convFor(P_HAPPY)) === null, 'no conversation conjured — queueing a draft is not a thread event');

        // ------------------------------------------------------------- 3) idempotency
        head('CASE 3  One continuation per call, EVER.');
        const d3a = await maybeSendPostCallContinuation(happy.id);
        console.log('replay:', JSON.stringify(d3a));
        pass(d3a.reason === 'ALREADY_SENT_FOR_THIS_CALL', 'replay refuses on the sent marker');

        await db.update(calls).set({ videoRequestSentAt: null, outcome: null }).where(eq(calls.id, happy.id));
        const d3b = await maybeSendPostCallContinuation(happy.id);
        console.log('replay with the marker wiped:', JSON.stringify(d3b));
        pass(d3b.reason === 'ALREADY_QUEUED_FOR_THIS_CALL', 'even with the marker wiped, the deterministic draft id blocks it');

        await db.update(messageDrafts).set({ status: 'rejected' }).where(eq(messageDrafts.id, continuationDraftId(happy.id)));
        const d3c = await maybeSendPostCallContinuation(happy.id);
        console.log('replay with the draft REJECTED:', JSON.stringify(d3c));
        pass(d3c.reason === 'ALREADY_QUEUED_FOR_THIS_CALL', 'a rejected draft still blocks — Ben saying no is not an invitation to re-ask');
        await db.update(messageDrafts).set({ status: 'pending' }).where(eq(messageDrafts.id, continuationDraftId(happy.id)));
        pass((await draftsFor(P_HAPPY)).length === 1, 'still exactly one draft after three replays');

        // ------------------------------------------------------------- 4) the re-ingest trigger
        head('CASE 4  Re-ingest with continuation:true twice → still one draft, window stays shut.');
        const r4a = await ingestCallIntoThread(happy.id, { markUnread: false, ack: false, continuation: true });
        const r4b = await ingestCallIntoThread(happy.id, { markUnread: false, ack: false, continuation: true });
        console.log('ingests:', JSON.stringify(r4a), JSON.stringify(r4b));
        await sleep(2000); // the trigger is fire-and-forget
        pass(r4a.status !== 'skipped' && r4b.status !== 'skipped', 'both ingests landed');
        pass((await draftsFor(P_HAPPY)).length === 1, 'the fire-and-forget trigger did not double the draft');
        const conv4 = await convFor(P_HAPPY);
        pass(!!conv4, 'the ingest opened the thread card');
        pass(conv4?.lastInboundAt === null, 'lastInboundAt untouched — a call never opens the WhatsApp 24h window');

        // ------------------------------------------------------------- 5) the consent matrix
        head('CASE 5  Only AGREED sends. Everything else refuses with NOT_AGREED:*.');
        const matrix: Array<[string, Record<string, unknown> | null, string]> = [
            [P_DECLINED, verdict({ whatsappAgreed: 'declined' }), 'NOT_AGREED:CUSTOMER_DECLINED_MESSAGING'],
            [P_NOTDISC, verdict({ whatsappAgreed: 'not_discussed' }), 'NOT_AGREED:NOT_DISCUSSED_ON_CALL'],
            [P_COMPLAINT, verdict({ kind: 'complaint' }), 'NOT_AGREED:COMPLAINT'],
            [P_CALLBACK, verdict({ callbackPromised: true }), 'NOT_AGREED:CALLBACK_DUE'],
            [P_SPAM, verdict({ kind: 'sales_spam' }), 'NOT_AGREED:NOT_A_JOB_ENQUIRY:sales_spam'],
            [P_NOVERDICT, null, 'NOT_AGREED:NO_CLASSIFICATION:NO_TRANSCRIPT'],
        ];
        for (const [phone, cls, expected] of matrix) {
            const c = await makeCall({ phone, classification: cls });
            const d = await maybeSendPostCallContinuation(c.id);
            console.log(`${phone} →`, JSON.stringify(d));
            pass(d.sent === false && d.reason === expected, `${expected}`);
            pass((await draftsFor(phone)).length === 0 && !(await callRow(c.id))?.videoRequestSentAt,
                'no draft, no sent marker');
        }

        // ------------------------------------------------------------- 6) slot fallbacks
        head('CASE 6  A missing or guard-tripping slot falls back to the GENERIC wording.');
        const noPhrase = await makeCall({ phone: P_NOPHRASE, name: 'Unknown Caller', classification: verdict({ jobPhrase: '' }) });
        const d6a = await maybeSendPostCallContinuation(noPhrase.id);
        const draft6a = (await draftsFor(P_NOPHRASE))[0];
        console.log('no jobPhrase:', JSON.stringify(d6a), '→', draft6a?.contentSid, JSON.stringify(draft6a?.body));
        pass(d6a.reason === 'QUEUED_FOR_APPROVAL' && draft6a?.contentSid === TEST_GENERIC_SID, 'no phrase → generic template');
        pass(draft6a?.body === "Hi there, good to speak just now. This is the number to send over any photos or videos of the job, and we'll get your quote moving.",
            'placeholder name degrades to "there", body carries no slot');

        const guardSlot = await makeCall({ phone: P_GUARDSLOT, classification: verdict({ jobPhrase: 'the quick fix on the tap' }) });
        const d6b = await maybeSendPostCallContinuation(guardSlot.id);
        const draft6b = (await draftsFor(P_GUARDSLOT))[0];
        console.log('guard-tripping phrase:', JSON.stringify(d6b), '→', draft6b?.contentSid);
        pass(d6b.reason === 'QUEUED_FOR_APPROVAL' && draft6b?.contentSid === TEST_GENERIC_SID,
            '"the quick fix" trips the duration guard → generic wording, slot never edited');

        // ------------------------------------------------------------- 7) the pure ladder
        head('CASE 7  normalizeJobRef, pickContinuationTemplate, checkDraft — no database needed.');
        pass(normalizeJobRef('the leaking kitchen tap') === 'the leaking kitchen tap', 'clean phrase passes through');
        pass(normalizeJobRef('the door.') === 'the door', 'trailing punctuation stripped');
        pass(normalizeJobRef('') === null && normalizeJobRef(null) === null && normalizeJobRef(undefined) === null, 'empty/missing → null');
        pass(normalizeJobRef('x'.repeat(61)) === null, 'over the 60-char cap → null, never truncated');
        pass(normalizeJobRef('the job we discussed') === null && normalizeJobRef('Unknown') === null && normalizeJobRef('N/A') === null,
            'classifier filler → null');
        pass(normalizeJobRef('the door — rear') === null && normalizeJobRef('the {{2}} door') === null && normalizeJobRef('a\nb') === null,
            'dashes, surviving placeholders and newlines → null');
        pass(pickContinuationTemplate(null).name === CONTINUATION_GENERIC_TEMPLATE, 'no verdict → generic');
        const picked = pickContinuationTemplate({ jobPhrase: 'the bathroom sealant' } as any);
        pass(picked.name === CONTINUATION_TEMPLATE && picked.variables['2'] === 'the bathroom sealant', 'good phrase → slotted with {{2}}');

        const render = (jobRef: string) => renderTemplateBody(SLOTTED_BODY, { '1': 'Ben', '2': jobRef });
        pass(checkDraft({ body: render('the leaking kitchen tap'), intent: 'post_call_continuation', quoteSeen: false, customerText: null }) === null,
            'slotted wording clears EVERY draft guard');
        pass(checkDraft({ body: renderTemplateBody(GENERIC_BODY, { '1': 'there' }), intent: 'post_call_continuation', quoteSeen: false, customerText: null }) === null,
            'generic wording clears every draft guard too');
        pass(checkDraft({ body: render('the door for 250'), intent: 'post_call_continuation', quoteSeen: false, customerText: null })?.code === 'money_figure',
            'a slot with a bare figure reads as money and is refused');
        pass(checkDraft({ body: render('the quick fix on the tap'), intent: 'post_call_continuation', quoteSeen: false, customerText: null })?.code === 'duration_claim',
            '"quick fix" reads as a duration promise and is refused');

        // ------------------------------------------------------------- 8) no approved template
        head('CASE 8  Neither wording approved → NO_APPROVED_TEMPLATE, fail closed.');
        await db.update(whatsappTemplates).set({ status: 'pending' }).where(inArray(whatsappTemplates.contentSid, TEST_SIDS));
        const noTpl = await makeCall({ phone: P_NOTEMPLATE, classification: verdict() });
        const d8 = await maybeSendPostCallContinuation(noTpl.id);
        console.log('decision:', JSON.stringify(d8));
        pass(d8.sent === false && d8.reason === 'NO_APPROVED_TEMPLATE', 'refused — the window is shut and there is no lawful wording');
        pass((await draftsFor(P_NOTEMPLATE)).length === 0 && !(await callRow(noTpl.id))?.videoRequestSentAt,
            'no draft queued, no sent marker — the call stays eligible for when Meta approves');
        await db.update(whatsappTemplates).set({ status: 'approved' }).where(inArray(whatsappTemplates.contentSid, TEST_SIDS));

        // ------------------------------------------------------------- 9) the video-path deferral
        head('CASE 9  Both flags on → the video request cedes AGREED to the continuation.');
        await setOutreachConfig({ enabled: true });
        const defer = await makeCall({ phone: P_DEFER, classification: verdict() });
        const d9a = await maybeSendPostCallVideoRequest({ callSid: defer.callId, callStatus: 'completed' });
        console.log('video path with continuation ON:', JSON.stringify(d9a));
        pass(d9a.sent === false && d9a.reason === 'CONTINUATION_OWNS_AGREED',
            'video request stands down — one call, one message');
        pass((await draftsFor(P_DEFER)).length === 0, 'and it queued nothing');

        await setContinuationConfig({ enabled: false });
        const d9b = await maybeSendPostCallVideoRequest({ callSid: defer.callId, callStatus: 'completed' });
        console.log('video path with continuation OFF:', JSON.stringify(d9b));
        pass(d9b.reason === 'QUEUED_FOR_APPROVAL' || d9b.reason === 'SENT_FIRST_CONTACT' || d9b.reason === 'DUPLICATE_DRAFT',
            `continuation off hands AGREED back to the video template (${d9b.reason})`);
        await setOutreachConfig({ enabled: false });
        await setContinuationConfig({ enabled: true });

        // ------------------------------------------------------------- 10) freshness
        head('CASE 10  "Good to speak just now" is only honest near the call.');
        const old = await makeCall({ phone: P_TOOOLD, minutesAgo: 120, classification: verdict() });
        const d10 = await maybeSendPostCallContinuation(old.id);
        console.log('decision:', JSON.stringify(d10));
        pass(d10.sent === false && d10.reason.startsWith('TOO_OLD:'), `a 2h-old call refuses (${d10.reason})`);

        // ------------------------------------------------------------- 11) coordination
        head('CASE 11  Someone already moved → the continuation stands down, never doubles up.');
        const threadMsg = await makeCall({ phone: P_THREADMSG, classification: verdict() });
        await ingestCallIntoThread(threadMsg.id, { markUnread: false, ack: false });
        const conv11 = await convFor(P_THREADMSG);
        pass(!!conv11, 'thread card exists for the coordination case');
        await db.insert(messages).values({
            id: `msg_cont_test_${crypto.randomBytes(6).toString('hex')}`,
            conversationId: conv11!.id,
            direction: 'outbound',
            channel: 'whatsapp',
            content: 'Hi, Ben here about the tap, will sort a quote today.',
            status: 'sent',
            senderName: 'Handy Services',
            createdAt: new Date(),
        });
        const d11a = await maybeSendPostCallContinuation(threadMsg.id);
        console.log('thread already messaged:', JSON.stringify(d11a));
        pass(d11a.sent === false && d11a.reason === 'THREAD_ALREADY_MESSAGED',
            'an outbound message on the thread since the call stands the continuation down');

        const otherDraft = await makeCall({ phone: P_OTHERDRAFT, classification: verdict() });
        await db.insert(messageDrafts).values({
            id: 'draft_cont_test_other_source',
            phone: P_OTHERDRAFT,
            body: 'A VA call task draft already waiting for approval.',
            source: 'manual',
            reason: 'continuation test: pre-existing pending draft',
        });
        const d11b = await maybeSendPostCallContinuation(otherDraft.id);
        console.log('other draft pending:', JSON.stringify(d11b));
        pass(d11b.sent === false && d11b.reason === 'OTHER_DRAFT_PENDING:manual',
            'ANY pending draft for the number, whatever queued it, stands the continuation down');
        await db.delete(messageDrafts).where(eq(messageDrafts.id, 'draft_cont_test_other_source'));

        // ------------------------------------------------------------- 12) shape guards
        head('CASE 12  Outbound calls and un-finalized calls refuse.');
        const outCall = await makeCall({ phone: P_NOTINBOUND, direction: 'outbound', classification: verdict() });
        const d12a = await maybeSendPostCallContinuation(outCall.id);
        console.log('outbound:', JSON.stringify(d12a));
        pass(d12a.reason === 'NOT_INBOUND:outbound', 'a call WE made never gets a "good to speak just now"');

        const ringing = await makeCall({ phone: P_NOTCOMPLETED, status: 'ringing', classification: verdict() });
        const d12b = await maybeSendPostCallContinuation(ringing.id);
        console.log('still ringing:', JSON.stringify(d12b));
        pass(d12b.reason === 'CALL_NOT_COMPLETED:ringing', 'the ring-time ingest cannot fire it early');

    } finally {
        delete process.env.COMMS_CONFIG_OVERRIDE;
        // Restore the two appSettings rows to exactly their pre-run state.
        for (const key of SETTING_KEYS) {
            const snap = settingSnapshots.find((r) => r.key === key);
            if (snap) {
                await db.update(appSettings).set({ value: snap.value, updatedAt: snap.updatedAt }).where(eq(appSettings.key, key));
            } else {
                await db.delete(appSettings).where(eq(appSettings.key, key));
            }
        }
        const live = await getContinuationConfig().catch(() => null);
        head(`LIVE CONFIG after restore: post_call_continuation = ${JSON.stringify(live)}`);
        pass(!!live && live.enabled === false, 'continuation flag is OFF in the live row — shipped disabled');
        if (!process.argv.includes('--keep')) {
            await cleanup();
            console.log('Test rows removed (Ofcom numbers and sentinel template SIDs only). Pass --keep to inspect.');
        }
    }
    process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
