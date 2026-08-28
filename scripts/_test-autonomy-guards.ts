/**
 * AUTONOMY & FOLLOW-THROUGH GUARDS — the 27 Aug 2026 James failures, proven closed.
 *
 *   npx tsx scripts/_test-autonomy-guards.ts
 *
 * Conversation b57b6790401ff28a3db04d58ff1e366f (+447950552830, "James", £992 bathroom floor
 * quote) exposed three autonomy failures in one thread:
 *   1. trust_concern tagged at 11:34 — and the agent kept auto-sending afterwards.
 *   2. A holding reply ("I'll get this priced up... as soon as it's ready") answered ~18h later
 *      by the SAME holding reply when the customer chased — a stall loop, never escalated.
 *   3. Two open follow-up promises (11:38, 11:45) with no timer, so failure 2 was guaranteed
 *      to repeat.
 *
 * What is attacked here, and how:
 *   · maySendDirect (pure) — trust_concern forces send:false with its own distinct reason.
 *   · threadHasTrustConcern (DB) — a FRESH read, so a tag added mid-run binds the same run.
 *   · detectFollowUpPromise / detectHoldingReply (pure) — the shared detection family, both
 *     directions: every incident phrasing detected, substance-carrying drafts passed through.
 *   · addWorkingHours (pure) — the 4-working-hour timer arithmetic (08:00-20:00 UK, roll-over).
 *   · assessRepeatHolding (DB) — first holding reply allowed, second consecutive one is the
 *     stall loop; Ben speaking or a question/link in the burst resets it.
 *   · flagThreadForBen dedupe — one flag per conversation while needs_ben stands.
 *   · recordOutboundCommitment / flagOverdueCommitments (DB) — a sent promise becomes a timed
 *     debt, an overdue one flags Ben ONCE and clears, a fulfilled one clears silently.
 *
 * The queue_draft wiring itself (comms.ts) is three thin conditionals over exactly these
 * functions, in the same pattern as the guard chain: what is proven here is what runs there.
 *
 * SAFETY, absolute:
 *   · Ofcom reserved drama range only: +447700900970/71/72, unused by any other suite
 *     (9209xx, 9009xx, 900940, 900950, 900960, 900997 are taken; 90097x was free).
 *   · PUSHOVER_APP_TOKEN is deleted for this process before anything runs, so the flags this
 *     suite deliberately raises can never ping a real phone.
 *   · COMMS_CONFIG_OVERRIDE (process-local) supplies config — the shared app_settings row is
 *     never written.
 *   · Nothing here sends: only pure functions and direct DB staging. No LLM run, no Twilio call.
 *   · Cleanup deletes this suite's conversations and their rows only, in a finally block.
 */
import 'dotenv/config';

// The flags raised below are real flagThreadForBen calls: no token, no push, ever.
delete process.env.PUSHOVER_APP_TOKEN;
// Process-local config: autosend ON so the pure gate's happy path is reachable; agent OFF.
process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
    enabled: false,
    autosend: { enabled: true },
    firstContactAutoAck: { enabled: false },
    quotePrep: { enabled: false },
});

import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions } from '@shared/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
    getCommsAgentConfig, maySendDirect, threadHasTrustConcern, flagThreadForBen,
    TRUST_CONCERN_TAG, NEEDS_BEN_TAG, type CommsAgentConfig,
} from '../server/agents/comms';
import {
    detectFollowUpPromise, detectHoldingReply, addWorkingHours, promiseSummary,
    recordOutboundCommitment, assessRepeatHolding, flagOverdueCommitments,
    COMMITMENT_DUE_WORKING_HOURS, type OpenCommitment,
} from '../server/agents/promise-tracker';

// ---------------------------------------------------------------------------------- fixtures

const PHONE_A = '+447700900970'; const KEY_A = '447700900970@c.us'; const CONV_A = 'autonomy_g_conv_a';
const PHONE_B = '+447700900971'; const KEY_B = '447700900971@c.us'; const CONV_B = 'autonomy_g_conv_b';
const PHONE_C = '+447700900972'; const KEY_C = '447700900972@c.us'; const CONV_C = 'autonomy_g_conv_c';
const ALL_CONVS = [CONV_A, CONV_B, CONV_C];
const ALL_PHONES = [PHONE_A, PHONE_B, PHONE_C];

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): boolean {
    ok ? passed++ : failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${String(detail).slice(0, 300)}` : ''}`);
    return ok;
}
function section(title: string): void {
    console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

async function makeConv(id: string, key: string, name: string): Promise<void> {
    await db.insert(conversations).values({
        id, phoneNumber: key, contactName: name,
        status: 'active', stage: 'scoping', priority: 'normal', tags: [],
    });
}

let msgSeq = 0;
async function stageMsg(convId: string, direction: 'inbound' | 'outbound', text: string, at: Date): Promise<string> {
    const id = `autonomy_g_msg_${Date.now()}_${msgSeq++}`;
    await db.insert(messages).values({
        id, conversationId: convId, direction, channel: 'whatsapp',
        content: text, type: 'text', status: 'delivered', createdAt: at,
        ...(direction === 'inbound' ? { senderName: 'Autonomy suite (reserved number)' } : {}),
    });
    if (direction === 'inbound') {
        await db.update(conversations).set({
            lastInboundAt: at, lastCustomerContactAt: at, lastMessageAt: at,
            lastMessagePreview: text.slice(0, 50),
        }).where(eq(conversations.id, convId));
    } else {
        await db.update(conversations).set({ lastMessageAt: at, lastMessagePreview: text.slice(0, 50) })
            .where(eq(conversations.id, convId));
    }
    return id;
}

/** An AGENT outbound: the message plus the sent draft row get_thread-style matching relies on. */
async function agentOutbound(convId: string, phone: string, text: string, at: Date): Promise<void> {
    await stageMsg(convId, 'outbound', text, at);
    await db.insert(messageDrafts).values({
        id: `autonomy_g_draft_${Date.now()}_${msgSeq++}`,
        conversationId: convId, phone, body: text, channel: 'whatsapp',
        source: 'comms_agent', reason: 'autonomy guard suite fixture',
        status: 'sent', sentAt: at,
    });
}

/** A MANUAL outbound: message with no agent draft behind it — that is Ben typing. */
async function benOutbound(convId: string, text: string, at: Date): Promise<void> {
    await stageMsg(convId, 'outbound', text, at);
}

async function cleanup(): Promise<void> {
    await db.delete(agentQuestions).where(inArray(agentQuestions.conversationId, ALL_CONVS));
    await db.delete(messageDrafts).where(inArray(messageDrafts.phone, ALL_PHONES));
    await db.delete(messages).where(inArray(messages.conversationId, ALL_CONVS));
    await db.delete(conversations).where(inArray(conversations.id, ALL_CONVS));
}

// ---------------------------------------------------------------------------------- stages

function testDetectionFamily(): void {
    section('1. DETECTION FAMILY — follow-up promises and holding replies (pure)');

    // Every phrasing the James conversation actually auto-sent, verbatim.
    const incident = [
        "I'll get this priced up properly and sent over to you as soon as it's ready.",
        "I'll come straight back to you with both as soon as I've got them.",
        "I'll get a patch only version sorted for you.",
        'Let me check what we can set up and come back to you.',
    ];
    for (const body of incident) {
        check(`promise detected: "${body.slice(0, 55)}..."`, detectFollowUpPromise(body) !== null);
        check(`holding reply: "${body.slice(0, 55)}..."`, detectHoldingReply(body) !== null);
    }

    // The wider house family.
    for (const body of [
        'Sorry for the delay, still getting that sorted for you.',
        'Leave it with me.',
        "Bear with me, I'll update you shortly.",
        "On it now.\n---\nI'll let you know as soon as it's done.",
    ]) {
        check(`holding reply: "${body.replace(/\n/g, ' / ').slice(0, 55)}"`, detectHoldingReply(body) !== null);
    }

    // Substance passes through: a question, a link, or real new information is NOT a stall.
    const substantive: [string, string][] = [
        ['question', "I'll get this priced up for you. What's your postcode?"],
        ['quote link', "I'll come back to you properly, but here it is: https://handyservices.app/quote/abc123"],
        ['new information', "I'll get the fitting arranged, and just so you know, the D shape seat in your photo needs the soft close hinge kit replacing as well."],
        ['no promise at all', 'The quote covers both bedrooms and the hallway, all itemised on the page.'],
    ];
    for (const [why, body] of substantive) {
        check(`not a holding reply (${why})`, detectHoldingReply(body) === null);
    }
    // The link and question variants are still COMMITMENTS — the 4h clock starts anyway.
    check('promise with a link still starts the clock', detectFollowUpPromise(substantive[1][1]) !== null);
    check('promiseSummary returns the whole sentence', (promiseSummary(incident[0]) ?? '').includes('priced up properly'));
}

function testWorkingHours(): void {
    section('2. WORKING-HOURS ARITHMETIC — 08:00-20:00 UK, roll into next morning (pure)');
    const iso = (d: Date) => d.toISOString();
    // August = BST = UTC+1 throughout.
    check('mid-day + 4h stays same day (10:00 UK → 14:00 UK)',
        iso(addWorkingHours(new Date('2026-08-27T09:00:00.000Z'), 4)) === '2026-08-27T13:00:00.000Z',
        iso(addWorkingHours(new Date('2026-08-27T09:00:00.000Z'), 4)));
    check('evening promise rolls overnight (18:30 UK → 10:30 UK next day)',
        iso(addWorkingHours(new Date('2026-08-27T17:30:00.000Z'), 4)) === '2026-08-28T09:30:00.000Z',
        iso(addWorkingHours(new Date('2026-08-27T17:30:00.000Z'), 4)));
    check('landing exactly on close rolls to next open (16:00 UK + 4h → 08:00 UK next day)',
        iso(addWorkingHours(new Date('2026-08-27T15:00:00.000Z'), 4)) === '2026-08-28T07:00:00.000Z',
        iso(addWorkingHours(new Date('2026-08-27T15:00:00.000Z'), 4)));
    check('promise before open counts from 08:00 (06:00 UK → 12:00 UK)',
        iso(addWorkingHours(new Date('2026-08-27T05:00:00.000Z'), 4)) === '2026-08-27T11:00:00.000Z',
        iso(addWorkingHours(new Date('2026-08-27T05:00:00.000Z'), 4)));
    check('2am promise counts from 08:00 (02:00 UK → 12:00 UK)',
        iso(addWorkingHours(new Date('2026-08-27T01:00:00.000Z'), 4)) === '2026-08-27T11:00:00.000Z',
        iso(addWorkingHours(new Date('2026-08-27T01:00:00.000Z'), 4)));
}

function testTrustGate(config: CommsAgentConfig): void {
    section('3. TRUST-CONCERN GATE — maySendDirect (pure)');
    const base = {
        config, intent: 'ack_enquiry', body: "Thanks, that photo really helps.",
        ukHour: 12, postQuoteThread: false, reactive: true, guardsPassed: true,
    };
    check('clean draft, no trust concern → sends', maySendDirect({ ...base, trustConcern: false }).send);

    const held = maySendDirect({ ...base, trustConcern: true });
    check('trust_concern → held', !held.send, held.reason);
    check('reason is distinct and names the tag', /trust_concern/.test(held.reason));
    check('reason is not the hours gate (no [morning_release] auto-release)', !/outside 08-20/.test(held.reason));

    // 27 Aug was mid-morning, but the gate must also hold at 2am against the reactive 24/7 lane.
    check('trust_concern outranks the reactive-window 24/7 lane',
        !maySendDirect({ ...base, ukHour: 2, trustConcern: true }).send);
    check('trust_concern holds post-quote threads too',
        !maySendDirect({ ...base, postQuoteThread: true, trustConcern: true }).send);
    // Order of authority: a guard failure still reports as the guard failure.
    check('guard failure still reported as the guard failure',
        maySendDirect({ ...base, guardsPassed: false, trustConcern: true }).reason.includes('guard chain'));
}

async function testTrustFreshRead(): Promise<void> {
    section('4. TRUST-CONCERN FRESH READ — tag at run start AND tag added mid-run (DB)');
    // The wiring reads the DB at queue_draft time, so "present at run start" and "added by
    // add_tags mid-run" are the SAME read — what is proven is that the read sees the truth at
    // decision time, not the run-start snapshot the 27 Aug failure was working from.
    check('untagged thread → no trust concern', !(await threadHasTrustConcern(CONV_A)));

    // Simulate the model's own add_tags landing mid-run, after the snapshot was taken.
    const [snap] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, CONV_A));
    await db.update(conversations).set({ tags: [...((snap?.tags as string[]) ?? []), TRUST_CONCERN_TAG] })
        .where(eq(conversations.id, CONV_A));
    check('tag added mid-run is seen by the very next check', await threadHasTrustConcern(CONV_A));
    check('missing conversation → false, never a throw', !(await threadHasTrustConcern('autonomy_g_no_such_conv')));

    await db.update(conversations).set({ tags: (snap?.tags as string[]) ?? [] }).where(eq(conversations.id, CONV_A));
}

async function testRepeatHolding(): Promise<void> {
    section('5. STALL-LOOP LIMITER — first holding reply allowed, second refused (DB)');
    const h = (msAgo: number) => new Date(Date.now() - msAgo);
    const HOUR = 3_600_000;

    // 5a. Fresh thread, no outbound at all: a first holding reply is ALLOWED.
    await stageMsg(CONV_A, 'inbound', 'Can you price up my bathroom floor?', h(3 * HOUR));
    let a = await assessRepeatHolding({ conversationId: CONV_A, phone: PHONE_A, digits: '447700900970' });
    check('no previous outbound → first holding reply allowed', !a.repeat);

    // 5b. The incident shape: agent holding reply, customer chases, agent tries to re-stall.
    await agentOutbound(CONV_A, PHONE_A,
        "I'll get this priced up properly and sent over to you as soon as it's ready.", h(2 * HOUR));
    await stageMsg(CONV_A, 'inbound', 'How long does it usually take to price up', h(5 * 60_000));
    a = await assessRepeatHolding({ conversationId: CONV_A, phone: PHONE_A, digits: '447700900970' });
    check('second consecutive holding reply → repeat detected', a.repeat);
    check('waitingOn names the breached expectation', /priced up/.test(a.waitingOn ?? ''), a.waitingOn ?? 'null');
    check('since points at the first holding reply', !!a.since && Math.abs(a.since.getTime() - h(2 * HOUR).getTime()) < 60_000);

    // 5c. The flag the wiring raises, and its dedupe: ONE flag while needs_ben stands.
    const first = await flagThreadForBen({
        conversationId: CONV_A, phone: PHONE_A,
        note: `Second holding reply attempted; customer still waiting on "${a.waitingOn}" since ${a.since?.toISOString()}.`,
    });
    check('stall flag raised', first.flagged);
    const again = await flagThreadForBen({ conversationId: CONV_A, phone: PHONE_A, note: 'duplicate attempt' });
    check('second flag deduped while needs_ben stands', !again.flagged);
    const [flaggedConv] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, CONV_A));
    check('needs_ben tag set exactly once', ((flaggedConv?.tags as string[]) ?? []).filter((t) => t === NEEDS_BEN_TAG).length === 1);
    const audit = await db.select({ id: agentQuestions.id }).from(agentQuestions)
        .where(and(eq(agentQuestions.conversationId, CONV_A), eq(agentQuestions.status, 'flagged')));
    check('exactly one audit row for the conversation', audit.length === 1);

    // 5d. Ben speaking inside the burst is substance, whatever he says — even his own holding
    // reply is his call, never the agent's stall.
    await benOutbound(CONV_A, 'Bear with me', h(90 * 60_000));
    a = await assessRepeatHolding({ conversationId: CONV_A, phone: PHONE_A, digits: '447700900970' });
    check('a manual (Ben) message in the burst → not a repeat', !a.repeat);

    // 5e. A substantive last outbound resets the ladder entirely.
    await agentOutbound(CONV_A, PHONE_A,
        "That's the labour side of it, you'd supply the flooring yourself and we fit whatever you pick.", h(30 * 60_000));
    a = await assessRepeatHolding({ conversationId: CONV_A, phone: PHONE_A, digits: '447700900970' });
    check('substantive last outbound → next holding reply is a FIRST again', !a.repeat);
}

async function testCommitmentRecording(): Promise<void> {
    section('6. COMMITMENT RECORDING — a sent promise becomes a timed debt (DB)');

    const madeAt = new Date(Date.now() - 30 * 3_600_000); // 30h ago → dueAt guaranteed past
    const rec = await recordOutboundCommitment({
        conversationId: CONV_B,
        body: "I'll get a patch only version sorted and come straight back to you.",
        at: madeAt,
    });
    check('commitment recorded on a promise', !!rec);
    check('summary is the promise sentence', /patch only/.test(rec?.summary ?? ''), rec?.summary);
    check('dueAt is madeAt + 4 working hours',
        rec?.dueAt === addWorkingHours(madeAt, COMMITMENT_DUE_WORKING_HOURS).toISOString(),
        `dueAt=${rec?.dueAt}`);
    const [afterRec] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, CONV_B));
    const oc = (afterRec?.metadata as any)?.openCommitment as OpenCommitment | undefined;
    check('metadata.openCommitment written', oc?.madeAt === madeAt.toISOString());

    // Re-promising must NOT reset the clock: the first madeAt stands (the stall is the point).
    const rec2 = await recordOutboundCommitment({
        conversationId: CONV_B, body: "I'll come back to you with the survey details as well.",
    });
    check('re-promise keeps the ORIGINAL debt (no clock reset)', rec2?.madeAt === madeAt.toISOString());

    // A non-promise send records nothing.
    const none = await recordOutboundCommitment({ conversationId: CONV_C, body: 'Thanks, appreciated.' });
    const [cMeta] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, CONV_C));
    check('non-promise outbound records nothing', none === null && !(cMeta?.metadata as any)?.openCommitment);
}

async function testOverdueSweep(): Promise<void> {
    section('7. OVERDUE SWEEP — flags Ben once, clears, never re-pings (DB)');

    // CONV_C: an overdue commitment that WAS fulfilled — the quote link went out after it.
    const cMade = new Date(Date.now() - 30 * 3_600_000);
    await recordOutboundCommitment({
        conversationId: CONV_C, body: "I'll get the quote sorted and sent over to you.", at: cMade,
    });
    await stageMsg(CONV_C, 'outbound',
        'Here you go: https://handyservices.app/quote/autonomyg1', new Date(Date.now() - 3_600_000));

    const run1 = await flagOverdueCommitments();
    check('sweep scanned the staged commitments', run1.scanned >= 2, JSON.stringify(run1));

    // CONV_B (unfulfilled): flagged and cleared.
    const [b] = await db.select({ tags: conversations.tags, metadata: conversations.metadata })
        .from(conversations).where(eq(conversations.id, CONV_B));
    check('overdue commitment flags Ben (needs_ben set)', ((b?.tags as string[]) ?? []).includes(NEEDS_BEN_TAG));
    check('commitment cleared after flagging', !(b?.metadata as any)?.openCommitment);
    check('flag recorded on the side (lastCommitmentFlagged)', !!(b?.metadata as any)?.lastCommitmentFlagged);
    const bAudit = await db.select({ question: agentQuestions.question }).from(agentQuestions)
        .where(eq(agentQuestions.conversationId, CONV_B));
    check('flag note carries the promise in its own words',
        bAudit.length === 1 && /patch only/.test(bAudit[0].question ?? ''), bAudit[0]?.question);

    // CONV_C (fulfilled): cleared quietly, no flag.
    const [c] = await db.select({ tags: conversations.tags, metadata: conversations.metadata })
        .from(conversations).where(eq(conversations.id, CONV_C));
    check('fulfilled commitment cleared WITHOUT a flag',
        !((c?.tags as string[]) ?? []).includes(NEEDS_BEN_TAG) && !(c?.metadata as any)?.openCommitment);

    // Second pass: the debt is settled — nothing to re-flag, no second ping.
    await flagOverdueCommitments();
    const bAudit2 = await db.select({ id: agentQuestions.id }).from(agentQuestions)
        .where(eq(agentQuestions.conversationId, CONV_B));
    check('second sweep does not flag again', bAudit2.length === 1);
}

// ---------------------------------------------------------------------------------- main

async function main(): Promise<void> {
    console.log('AUTONOMY & FOLLOW-THROUGH GUARD SUITE — Ofcom reserved numbers, zero sends, zero pushes');
    await cleanup(); // a crashed previous run must not poison this one
    await makeConv(CONV_A, KEY_A, 'Autonomy Suite A');
    await makeConv(CONV_B, KEY_B, 'Autonomy Suite B');
    await makeConv(CONV_C, KEY_C, 'Autonomy Suite C');

    try {
        const config = await getCommsAgentConfig();
        testDetectionFamily();
        testWorkingHours();
        testTrustGate(config);
        await testTrustFreshRead();
        await testRepeatHolding();
        await testCommitmentRecording();
        await testOverdueSweep();
    } finally {
        await cleanup();
        delete process.env.COMMS_CONFIG_OVERRIDE;
    }

    console.log(`\n${'='.repeat(78)}\n${failed ? 'RED' : 'GREEN'}: ${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
