/**
 * VA CALL TASKS — speed-to-lead calling on text-channel enquiries (28 Aug 2026), proven.
 *
 *   npx tsx scripts/_test-va-call-tasks.ts
 *
 * What is attacked here, and how:
 *   · computeVaCallDueAt (pure-ish) — 15 working minutes on the 08:00–20:00 Europe/London clock,
 *     including the out-of-hours deferral (22:30 tonight → 08:15 tomorrow, 06:00 → 08:15 today).
 *   · maybeCreateVaCallTask (DB) — every trigger gate, both directions: flag off, exempt channel,
 *     foreign number, opted out (scope 'all'), ongoing thread, prior call in thread, and the
 *     genuine first contact / returning-after-60d that DO create. Plus ALREADY_OPEN via the
 *     partial unique index (the DB-enforced no-double-task gate, not an advisory check).
 *   · The triage hold — creation pushes conversations.metadata.nextTriageAt to the task's dueAt;
 *     EVERY resolution path (manual complete, call ingest, prefers-text, opt-out dismiss, sweep
 *     expiry) pulls it back to now-ish. Asserted on each path separately.
 *   · completeVaCallTasksForCall via the real ingest (ingestCallRow) — a call landing on the
 *     thread settles the task; a call dated BEFORE the task's creation (the backfill) does not.
 *   · runVaCallTaskLane — re-asserts the hold on a neutral mid-window message; dismisses with
 *     'customer_prefers_text' on a clear "don't call me" using the SAME classifier tagAckReply
 *     trusts.
 *   · expireOverdueVaCallTasks — dismissedBy 'system:expired', triage released, NO message and
 *     NO draft written for the customer, and the one-ping rule: a second sweep pass finds
 *     nothing to expire.
 *   · The admin API (/api/va-call-tasks) happy path — list, mark-called, dismiss-with-reason,
 *     dismiss-without-reason rejected — against the real router on a loopback express server.
 *   · QUIET HOURS (T2, 29 Aug 2026) — a 22:30 enquiry creates the task but DEFERS the creation
 *     ping (notifiedAt null: no 2am wake-up); releaseDeferredVaCallTaskPings is gated shut at
 *     02:00, sends exactly once at 08:01 (the CAS on notifiedAt is the claim), and leaves an
 *     already-lapsed deferred task to the expiry pass. Fixed injected instants, so this proves
 *     the same thing at any real run time. Fixture instants sit in the REAL future so the global
 *     release query can only ever match this suite's rows.
 *   · buildVaCallTaskAlert (pure) — the exact ping payload asserted WITHOUT a send: supplementary
 *     URL is the /admin/va-tasks portal, thread deep-link stays in the body, ring-by wording,
 *     and the overdue variant.
 *   · listVaCallTasks portal context — latest 3 inbound messages per open task, chronological,
 *     media fields intact for the phone-card thumbnails, older messages trimmed.
 *
 * SAFETY, absolute:
 *   · Ofcom reserved range only: +44770090098x, a sub-range no other suite uses
 *     (checked against _test-send-path-guards / _test-autonomy-guards / _test-content-guards).
 *   · PUSHOVER_APP_TOKEN is deleted for this process before anything runs — the pings this suite
 *     deliberately triggers can never reach a real phone (dispatch no-ops without the token).
 *   · COMMS_CONFIG_OVERRIDE (process-local) supplies config — the shared app_settings row is
 *     never written. The comms agent itself stays disabled throughout.
 *   · Nothing here sends: no LLM run, no Twilio call, and the suite ASSERTS the no-send property
 *     on the expiry path rather than assuming it.
 *   · Schema: the va_call_tasks DDL (idempotent, additive, identical to
 *     migrations/20260828_va_call_tasks.sql) is applied here as a targeted run — this is NOT
 *     db:push and touches nothing but the new table.
 *   · Cleanup deletes this suite's rows only, in a finally block, and a crashed previous run is
 *     cleaned before the suite stages anything.
 */
import 'dotenv/config';

// No token, no push, ever — must happen before any module that could import pushover.
delete process.env.PUSHOVER_APP_TOKEN;

// Process-local config. vaCallTask starts DISABLED so the kill switch is the first thing proven;
// the suite flips this env var to enable it for the rest (getCommsAgentConfig re-reads per call).
const CONFIG_OFF = JSON.stringify({
    enabled: false,
    onInbound: false,
    autosend: { enabled: false },
    firstContactAutoAck: { enabled: false, returningAfterDays: 60 },
    quotePrep: { enabled: false },
    vaCallTask: { enabled: false },
});
const CONFIG_ON = JSON.stringify({
    ...JSON.parse(CONFIG_OFF),
    vaCallTask: { enabled: true },
});
process.env.COMMS_CONFIG_OVERRIDE = CONFIG_OFF;

import express from 'express';
import type { Server } from 'http';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, systemEvents, vaCallTasks } from '@shared/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
    computeVaCallDueAt, maybeCreateVaCallTask, runVaCallTaskLane,
    completeVaCallTask, completeVaCallTasksForCall, dismissOpenVaCallTasksForPhone,
    expireOverdueVaCallTasks, findOpenVaCallTask, listVaCallTasks,
    releaseDeferredVaCallTaskPings,
} from '../server/agents/va-call-tasks';
import { buildVaCallTaskAlert } from '../server/pushover';
import { ingestCallRow } from '../server/call-thread';
import { recordOptOut } from '../server/opt-out';
import { vaCallTasksRouter } from '../server/va-call-tasks-routes';

// ---------------------------------------------------------------------------------- fixtures

// +44770090098x — reserved drama range, sub-range unused by any other suite.
const P = (n: number) => `+4477009009${n}`;
const K = (n: number) => `4477009009${n}@c.us`;
const PHONE_A = P(80), CONV_A = 'vacall_t_conv_a';   // creation / already-open / re-assert / prefers-text
const PHONE_B = P(81), CONV_B = 'vacall_t_conv_b';   // ongoing thread — no task
const PHONE_C = P(82), CONV_C = 'vacall_t_conv_c';   // call already in thread — no task
const PHONE_D = P(83), CONV_D = 'vacall_t_conv_d';   // opted out (scope 'all') — no task
const PHONE_E = P(84), CONV_E = 'vacall_t_conv_e';   // auto-complete on call ingest + backfill + opt-out dismiss
const PHONE_F = P(85), CONV_F = 'vacall_t_conv_f';   // sweep expiry + one-ping
const PHONE_G = P(86), CONV_G = 'vacall_t_conv_g';   // API happy path
const PHONE_H = P(87), CONV_H = 'vacall_t_conv_h';   // returning-after-60d — creates
const PHONE_I = P(88), CONV_I = 'vacall_t_conv_i';   // quiet-hours deferral + morning release
const PHONE_J = P(89), CONV_J = 'vacall_t_conv_j';   // lapsed-deferral + portal context
const ALL_CONVS = [CONV_A, CONV_B, CONV_C, CONV_D, CONV_E, CONV_F, CONV_G, CONV_H, CONV_I, CONV_J];
const ALL_PHONES = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89].map(P);
const ENQUIRY = 'Hi, could you quote for fitting a new bathroom door please?';

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
        status: 'active', stage: 'enquiry', priority: 'normal', tags: [],
    });
}

let msgSeq = 0;
async function stageMsg(
    convId: string, direction: 'inbound' | 'outbound', text: string, at: Date,
    channel = 'whatsapp', media?: { url: string; type: string },
): Promise<void> {
    await db.insert(messages).values({
        id: `vacall_t_msg_${Date.now()}_${msgSeq++}`,
        conversationId: convId, direction, channel,
        content: text, type: media ? media.type : 'text', status: 'delivered', createdAt: at,
        mediaUrl: media?.url ?? null, mediaType: media?.type ?? null,
    });
}

/** Real London wall-clock hour — some creation-path assertions branch on it, because the suite
 *  must be green at 22:00 as well as at 10:00 and the deferral changes what "correct" looks like. */
function ukHourNow(): number {
    return Number(new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric', hour12: false, timeZone: 'Europe/London',
    }).format(new Date()));
}

async function nextTriageAt(convId: string): Promise<string | null> {
    const [row] = await db.select({ metadata: conversations.metadata })
        .from(conversations).where(eq(conversations.id, convId));
    return ((row?.metadata as any)?.nextTriageAt as string | undefined) ?? null;
}

/** |t - expected| within tolerance ms. */
function near(iso: string | null, expected: Date, tolMs: number): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return !isNaN(t) && Math.abs(t - expected.getTime()) <= tolMs;
}

/** London wall-clock "HH:MM" plus day-of-month, for the working-hours assertions. */
function ukClock(d: Date): { hm: string; day: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', day: 'numeric', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { hm: `${get('hour')}:${get('minute')}`, day: Number(get('day')) };
}

async function cleanup(): Promise<void> {
    await db.execute(sql`DELETE FROM va_call_tasks WHERE conversation_id LIKE 'vacall_t_conv_%'`);
    await db.delete(systemEvents).where(inArray(systemEvents.conversationId, ALL_CONVS));
    await db.delete(systemEvents).where(inArray(systemEvents.phone, ALL_PHONES));
    await db.execute(sql`DELETE FROM comms_opt_outs WHERE phone_key LIKE '4477009009%'`);
    await db.delete(messageDrafts).where(inArray(messageDrafts.conversationId, ALL_CONVS));
    await db.delete(messages).where(inArray(messages.conversationId, ALL_CONVS)); // incl. call_… rows from the ingest test
    await db.delete(conversations).where(inArray(conversations.id, ALL_CONVS));
}

/** The migration's DDL, applied as an idempotent targeted run (never db:push — shared prod DB). */
async function ensureTable(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS va_call_tasks (
            id              varchar PRIMARY KEY NOT NULL,
            conversation_id varchar NOT NULL,
            phone           varchar NOT NULL,
            contact_name    varchar,
            channel         varchar(16) NOT NULL,
            reason          text,
            created_at      timestamp NOT NULL DEFAULT now(),
            due_at          timestamp NOT NULL,
            completed_at    timestamp,
            dismissed_at    timestamp,
            dismissed_by    varchar(60),
            dismiss_reason  varchar(80),
            notified_at     timestamp
        )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_va_call_tasks_conversation ON va_call_tasks (conversation_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_va_call_tasks_due ON va_call_tasks (due_at)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_va_call_tasks_open ON va_call_tasks (conversation_id)
        WHERE completed_at IS NULL AND dismissed_at IS NULL`);
}

// ---------------------------------------------------------------------------------- stages

function testDueAtArithmetic(): void {
    section('1. WORKING-HOURS dueAt — 15 min inside 08:00–20:00 UK, deferred out of hours');

    // Mid-morning, BST: 10:00 + 15 working minutes = 10:15, same day.
    const midMorning = new Date('2026-08-25T10:00:00+01:00'); // Tue 25 Aug, 10:00 London
    const due1 = ukClock(computeVaCallDueAt(midMorning));
    check('10:00 enquiry due 10:15 same day', due1.hm === '10:15' && due1.day === 25, JSON.stringify(due1));

    // Late evening: 22:30 has no working minutes left — dueAt = next day 08:15, never skipped.
    const lateNight = new Date('2026-08-25T22:30:00+01:00');
    const due2 = ukClock(computeVaCallDueAt(lateNight));
    check('22:30 enquiry deferred to 08:15 next day', due2.hm === '08:15' && due2.day === 26, JSON.stringify(due2));

    // Early morning: 06:00 waits for opening — dueAt = 08:15 the SAME day.
    const earlyMorning = new Date('2026-08-25T06:00:00+01:00');
    const due3 = ukClock(computeVaCallDueAt(earlyMorning));
    check('06:00 enquiry due 08:15 same day', due3.hm === '08:15' && due3.day === 25, JSON.stringify(due3));

    // Window edge: 19:55 gets 5 minutes today and 10 tomorrow — 08:10 next day.
    const edge = new Date('2026-08-25T19:55:00+01:00');
    const due4 = ukClock(computeVaCallDueAt(edge));
    check('19:55 enquiry spills to 08:10 next day', due4.hm === '08:10' && due4.day === 26, JSON.stringify(due4));
}

async function testTriggerGates(): Promise<void> {
    section('2. TRIGGER GATES — every refusal, then the genuine creations');

    // Kill switch: config still has vaCallTask disabled at this point.
    const off = await maybeCreateVaCallTask({ conversationId: CONV_A, phone: PHONE_A, channel: 'whatsapp', text: ENQUIRY });
    check('flag off → DISABLED, nothing created', !off.created && off.reason === 'DISABLED', off.reason);

    process.env.COMMS_CONFIG_OVERRIDE = CONFIG_ON; // the rest of the suite runs with the feature on

    // Voice-adjacent channel is exempt by construction.
    const exempt = await maybeCreateVaCallTask({ conversationId: CONV_A, phone: PHONE_A, channel: 'post_call', text: ENQUIRY });
    check("channel 'post_call' → CHANNEL_EXEMPT", !exempt.created && exempt.reason === 'CHANNEL_EXEMPT', exempt.reason);

    // Same geo + spam screen as the ack: a foreign number never makes the call list.
    const foreign = await maybeCreateVaCallTask({ conversationId: CONV_A, phone: '+15551234567', channel: 'sms', text: ENQUIRY });
    check('non-UK number → SCREENED_OUT', !foreign.created && foreign.reason === 'SCREENED_OUT', foreign.reason);

    // Opted out, scope 'all' (blocks even service replies — and certainly a call).
    await recordOptOut({ phone: PHONE_D, scope: 'all', source: 'manual', note: 'va-call-task suite fixture' });
    const opted = await maybeCreateVaCallTask({ conversationId: CONV_D, phone: PHONE_D, channel: 'whatsapp', text: ENQUIRY });
    check("opt-out scope 'all' → OPTED_OUT", !opted.created && opted.reason === 'OPTED_OUT', opted.reason);

    // Mid-thread: we messaged them yesterday, so this is an ongoing conversation, not a lead.
    await stageMsg(CONV_B, 'outbound', 'Thanks, we will take a look.', new Date(Date.now() - 24 * 3_600_000));
    const ongoing = await maybeCreateVaCallTask({ conversationId: CONV_B, phone: PHONE_B, channel: 'whatsapp', text: 'Any update?' });
    check('recent outbound in thread → NOT_FIRST_OR_RETURNING', !ongoing.created && ongoing.reason === 'NOT_FIRST_OR_RETURNING', ongoing.reason);

    // A call anywhere in the thread, any direction: voice contact already happened.
    await stageMsg(CONV_C, 'inbound', 'Inbound call (2m 10s)', new Date(Date.now() - 3_600_000), 'call');
    const called = await maybeCreateVaCallTask({ conversationId: CONV_C, phone: PHONE_C, channel: 'sms', text: ENQUIRY });
    check('call already in thread → CALL_ALREADY_HAPPENED', !called.created && called.reason === 'CALL_ALREADY_HAPPENED', called.reason);

    // The genuine article: first contact on WhatsApp.
    const before = new Date();
    const created = await maybeCreateVaCallTask({ conversationId: CONV_A, phone: PHONE_A, channel: 'whatsapp', contactName: 'VA Suite A', text: ENQUIRY });
    check('first contact → CREATED', created.created && created.reason === 'CREATED', created.reason);
    const task = created.task!;
    check('dueAt ≈ createdAt + 15 working minutes',
        near(task.dueAt.toISOString(), computeVaCallDueAt(before), 5_000), task.dueAt?.toISOString());
    const oo = ukHourNow() < 8 || ukHourNow() >= 20; // suite running out of hours right now?
    check(oo
        ? 'notifiedAt null (suite running out of hours — ping deferred to the morning release)'
        : 'notifiedAt set (ping path ran; dispatch no-ops without a token)',
        oo ? !task.notifiedAt : !!task.notifiedAt, task.notifiedAt?.toISOString() ?? 'null');
    check('reason names the channel and the window', /whatsapp/.test(task.reason ?? '') && /15 working minutes/.test(task.reason ?? ''), task.reason ?? '');

    // The hold: nextTriageAt pushed out to the task's dueAt.
    check('triage held to dueAt on creation', near(await nextTriageAt(CONV_A), task.dueAt, 2_000), String(await nextTriageAt(CONV_A)));

    // One open task per conversation, enforced by the DB, not by a SELECT.
    const dup = await maybeCreateVaCallTask({ conversationId: CONV_A, phone: PHONE_A, channel: 'whatsapp', text: 'hello again' });
    check('second create → ALREADY_OPEN (partial unique index)', !dup.created && dup.reason === 'ALREADY_OPEN', dup.reason);

    // Returning after 60+ days quiet is a lead again — the SAME gate the ack uses.
    await stageMsg(CONV_H, 'outbound', 'Job all done, thanks!', new Date(Date.now() - 90 * 24 * 3_600_000));
    const returning = await maybeCreateVaCallTask({ conversationId: CONV_H, phone: PHONE_H, channel: 'webform', text: ENQUIRY });
    check('returning after 90d quiet → CREATED', returning.created && returning.reason === 'CREATED', returning.reason);
    check("returning task says 'Returning customer'", /Returning customer/.test(returning.task?.reason ?? ''), returning.task?.reason ?? '');
    await completeVaCallTask(returning.task!.id); // settle it; H's job here is done
}

async function testLaneBehaviour(): Promise<void> {
    section('3. THE LANE MID-WINDOW — hold re-asserted, prefers-text dismisses');

    const open = await findOpenVaCallTask(CONV_A);
    check('CONV_A task still open going in', !!open);
    if (!open) return;

    // A neutral message mid-window: arm() would have shortened nextTriageAt; the lane must put
    // the hold back to dueAt or the second message of a burst quietly un-holds the thread.
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${new Date(Date.now() + 60_000).toISOString()}::text)`,
    }).where(eq(conversations.id, CONV_A)); // simulate arm()'s short debounce write
    await runVaCallTaskLane({ conversationId: CONV_A, phone: PHONE_A, channel: 'whatsapp', text: 'Here are some photos of the door' });
    check('neutral message → task still open', !!(await findOpenVaCallTask(CONV_A)));
    check('neutral message → hold re-asserted to dueAt', near(await nextTriageAt(CONV_A), open.dueAt, 2_000), String(await nextTriageAt(CONV_A)));

    // "Don't call me": the task dies and triage resumes — ringing them now would be worse than
    // never ringing at all.
    await runVaCallTaskLane({ conversationId: CONV_A, phone: PHONE_A, channel: 'whatsapp', text: "Please don't call me, text is easier" });
    const [dismissed] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, open.id));
    check("prefers-text → dismissed by 'system:prefers_text'", dismissed?.dismissedBy === 'system:prefers_text', dismissed?.dismissedBy ?? 'null');
    check("prefers-text → dismissReason 'customer_prefers_text'", dismissed?.dismissReason === 'customer_prefers_text', dismissed?.dismissReason ?? 'null');
    check('prefers-text → triage released to now-ish', near(await nextTriageAt(CONV_A), new Date(), 10_000), String(await nextTriageAt(CONV_A)));
    check('prefers-text → no open task remains', !(await findOpenVaCallTask(CONV_A)));
}

async function testCallIngestCompletion(): Promise<void> {
    section('4. FULFILMENT — a call landing on the thread completes the task');

    const created = await maybeCreateVaCallTask({ conversationId: CONV_E, phone: PHONE_E, channel: 'sms', contactName: 'VA Suite E', text: ENQUIRY });
    check('CONV_E task created', created.created, created.reason);
    if (!created.task) return;

    // The real ingest path: an answered inbound call, through ingestCallRow (which calls the
    // completion hook exactly as the live status callback would).
    const callAt = new Date();
    const result = await ingestCallRow({
        id: 'vacall_t_call_1', phoneNumber: PHONE_E, direction: 'inbound', status: 'completed',
        startTime: callAt, endTime: new Date(callAt.getTime() + 60_000), duration: 60, ringSeconds: 4,
        customerName: 'VA Suite E', jobSummary: null, outcome: null, handledBy: null,
    } as any);
    check('call ingested into the thread', result.status === 'written', JSON.stringify(result));
    const [done] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, created.task.id));
    check('task auto-completed at the call time', !!done?.completedAt && near(done.completedAt.toISOString(), callAt, 2_000), done?.completedAt?.toISOString() ?? 'null');
    check('completion released triage to now-ish', near(await nextTriageAt(CONV_E), new Date(), 10_000), String(await nextTriageAt(CONV_E)));

    // Backfill protection: a task minted now is NOT settled by a call dated before it existed.
    const [stale] = await db.insert(vaCallTasks).values({
        conversationId: CONV_E, phone: PHONE_E, channel: 'sms',
        reason: 'backfill-protection fixture', dueAt: computeVaCallDueAt(new Date()),
    }).returning();
    const settledByOldCall = await completeVaCallTasksForCall(CONV_E, new Date(Date.now() - 3_600_000));
    check('hour-old call does not settle a fresh task (backfill protection)', settledByOldCall === 0, String(settledByOldCall));
    check('fresh task still open after the replay', !!(await findOpenVaCallTask(CONV_E)));

    // Opt-out dismissal: STOP takes the number off the call list across every open task.
    const dismissedCount = await dismissOpenVaCallTasksForPhone(PHONE_E, 'system:opt_out', 'opted_out');
    check('opt-out dismisses the open task for the number', dismissedCount === 1, String(dismissedCount));
    const [optedOutTask] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, stale.id));
    check("opt-out dismissal recorded as 'system:opt_out' / 'opted_out'",
        optedOutTask?.dismissedBy === 'system:opt_out' && optedOutTask?.dismissReason === 'opted_out',
        `${optedOutTask?.dismissedBy}/${optedOutTask?.dismissReason}`);
    check('opt-out dismissal released triage', near(await nextTriageAt(CONV_E), new Date(), 10_000), String(await nextTriageAt(CONV_E)));
}

async function testSweepExpiry(): Promise<void> {
    section('5. SWEEP EXPIRY — system:expired, triage released, NOTHING sent, one ping only');

    // Stage a task whose window lapsed 20 minutes ago (direct insert to control the clock), with
    // the conversation held exactly as creation would have left it.
    const past = new Date(Date.now() - 35 * 60_000);
    const dueAt = new Date(Date.now() - 20 * 60_000);
    const [task] = await db.insert(vaCallTasks).values({
        conversationId: CONV_F, phone: PHONE_F, contactName: 'VA Suite F', channel: 'webform',
        reason: 'expiry fixture', createdAt: past, dueAt, notifiedAt: past,
    }).returning();
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${dueAt.toISOString()}::text)`,
    }).where(eq(conversations.id, CONV_F));
    const msgsBefore = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, CONV_F));
    const draftsBefore = await db.select({ id: messageDrafts.id }).from(messageDrafts).where(eq(messageDrafts.conversationId, CONV_F));

    const pass1 = await expireOverdueVaCallTasks();
    check('sweep saw and expired the overdue task', pass1.expired >= 1, JSON.stringify(pass1));

    const [expired] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, task.id));
    check("expiry is a dismissal by 'system:expired'", expired?.dismissedBy === 'system:expired' && !!expired?.dismissedAt, expired?.dismissedBy ?? 'null');
    check("expiry dismissReason 'call window lapsed'", expired?.dismissReason === 'call window lapsed', expired?.dismissReason ?? 'null');
    check('expiry released triage to now-ish', near(await nextTriageAt(CONV_F), new Date(), 10_000), String(await nextTriageAt(CONV_F)));

    // THE no-send property, asserted rather than assumed: expiry wrote no customer message and
    // queued no draft. The comms agent resumes with context and decides — that is the whole deal.
    const msgsAfter = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, CONV_F));
    const draftsAfter = await db.select({ id: messageDrafts.id }).from(messageDrafts).where(eq(messageDrafts.conversationId, CONV_F));
    check('expiry sent NO message to the customer', msgsAfter.length === msgsBefore.length, `${msgsBefore.length} → ${msgsAfter.length}`);
    check('expiry queued NO draft', draftsAfter.length === draftsBefore.length, `${draftsBefore.length} → ${draftsAfter.length}`);

    // A system event landed for the audit trail.
    const events = await db.select({ id: systemEvents.id }).from(systemEvents)
        .where(and(eq(systemEvents.conversationId, CONV_F), eq(systemEvents.kind, 'va_call_task')));
    check('expiry logged a system event', events.length >= 1, String(events.length));

    // One ping, ever: the expiry CAS can only be won once, so a second pass leaves OUR row
    // untouched. Asserted fixture-scoped (row unchanged, still exactly one, still expired) rather
    // than as a global "scanned === 0" — the shared table may hold real rows once this ships,
    // and this suite must never depend on the rest of the table being empty.
    const dismissedAtAfterPass1 = expired?.dismissedAt?.toISOString();
    await expireOverdueVaCallTasks();
    const ours = await db.select().from(vaCallTasks).where(eq(vaCallTasks.conversationId, CONV_F));
    const [still] = ours;
    check('second sweep pass leaves our expired task untouched (one-ping rule)',
        ours.length === 1
            && still?.dismissedBy === 'system:expired'
            && still?.dismissedAt?.toISOString() === dismissedAtAfterPass1,
        JSON.stringify({ rows: ours.length, dismissedBy: still?.dismissedBy, before: dismissedAtAfterPass1, after: still?.dismissedAt?.toISOString() }));
}

async function testApiRoutes(): Promise<void> {
    section('6. ADMIN API — list, mark-called, dismiss (real router on loopback)');

    // The real router, minus requireAdmin (auth middleware is the mount's concern, not the
    // router's — same split every admin router in server/index.ts uses).
    const app = express();
    app.use(express.json());
    app.use('/api/va-call-tasks', vaCallTasksRouter);
    const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}/api/va-call-tasks`;

    try {
        const created = await maybeCreateVaCallTask({ conversationId: CONV_G, phone: PHONE_G, channel: 'webform', contactName: 'VA Suite G', text: ENQUIRY });
        check('CONV_G task created for the API test', created.created, created.reason);
        const id = created.task!.id;

        const list = await (await fetch(base)).json();
        check('GET / returns the open task', list.success === true && list.data.open.some((t: any) => t.id === id), JSON.stringify(list).slice(0, 200));

        const complete = await fetch(`${base}/${id}/complete`, { method: 'POST' });
        const completeBody = await complete.json();
        check('POST /:id/complete succeeds', complete.status === 200 && !!completeBody.data.task.completedAt, JSON.stringify(completeBody).slice(0, 200));
        check('complete released triage', near(await nextTriageAt(CONV_G), new Date(), 10_000), String(await nextTriageAt(CONV_G)));

        const again = await fetch(`${base}/${id}/complete`, { method: 'POST' });
        check('completing twice → 404 (CAS on the open state)', again.status === 404, String(again.status));

        // A second task on the same conversation (the first resolved, so the partial index allows it).
        const created2 = await maybeCreateVaCallTask({ conversationId: CONV_G, phone: PHONE_G, channel: 'webform', text: 'Following up!' });
        check('second task creatable once the first resolved', created2.created, created2.reason);
        const id2 = created2.task!.id;

        const noReason = await fetch(`${base}/${id2}/dismiss`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        });
        check('dismiss without a reason → 400', noReason.status === 400, String(noReason.status));

        const dismissed = await fetch(`${base}/${id2}/dismiss`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'spoke to them at the depot' }),
        });
        const dismissedBody = await dismissed.json();
        check("dismiss with reason → recorded as 'human:admin'",
            dismissed.status === 200 && dismissedBody.data.task.dismissedBy === 'human:admin'
            && dismissedBody.data.task.dismissReason === 'spoke to them at the depot',
            JSON.stringify(dismissedBody).slice(0, 200));

        const listAfter = await listVaCallTasks();
        check('resolved tasks show in the recent list', listAfter.recent.some((t) => t.id === id) && listAfter.recent.some((t) => t.id === id2));
        check('no open task remains on CONV_G', !(await findOpenVaCallTask(CONV_G)));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function testQuietHoursDeferral(): Promise<void> {
    section('7. QUIET HOURS — creation ping deferred overnight, morning release sends it ONCE');

    // Fixed injected instants, far enough in the REAL future that the release's global
    // "notifiedAt null AND dueAt > now" query can only ever match this suite's fixtures — a real
    // open task's dueAt is at most real-now + 15 working minutes, always before these dates.
    const nightBefore = new Date('2026-09-01T22:30:00+01:00'); // Tue, 22:30 London
    const smallHours  = new Date('2026-09-02T02:00:00+01:00'); // Wed, 02:00
    const morning     = new Date('2026-09-02T08:01:00+01:00'); // Wed, 08:01 — before the 08:15 dueAt

    // A 22:30 enquiry: the task and the triage hold land exactly as in hours — but NO ping.
    const created = await maybeCreateVaCallTask({
        conversationId: CONV_I, phone: PHONE_I, channel: 'whatsapp',
        contactName: 'VA Suite I', text: ENQUIRY, at: nightBefore,
    });
    check('22:30 enquiry → task created', created.created && created.reason === 'CREATED', created.reason);
    if (!created.task) return;
    const task = created.task;
    const due = ukClock(task.dueAt);
    check('22:30 enquiry → dueAt 08:15 next day', due.hm === '08:15' && due.day === 2, JSON.stringify(due));
    check('22:30 enquiry → creation ping DEFERRED (notifiedAt null — no 2am wake-up)',
        !task.notifiedAt, task.notifiedAt?.toISOString() ?? '');
    check('22:30 enquiry → triage still held to dueAt', near(await nextTriageAt(CONV_I), task.dueAt, 2_000), String(await nextTriageAt(CONV_I)));

    // 02:00 sweep tick: still out of hours — the release is gated shut before it touches the DB.
    const at2am = await releaseDeferredVaCallTaskPings(smallHours);
    check('02:00 release pass → gated shut (released 0)', at2am.released === 0, String(at2am.released));
    const [still2am] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, task.id));
    check('02:00 → notifiedAt still null', !still2am?.notifiedAt, still2am?.notifiedAt?.toISOString() ?? '');

    // A deferred task whose window ALREADY lapsed belongs to the expiry pass, not the release —
    // a cheery "ring them by" arriving after the lapse would contradict the overdue ping.
    const [lapsed] = await db.insert(vaCallTasks).values({
        conversationId: CONV_J, phone: PHONE_J, contactName: 'VA Suite J', channel: 'sms',
        reason: 'lapsed-deferral fixture',
        createdAt: new Date('2026-08-20T10:00:00+01:00'), dueAt: new Date('2026-08-20T10:15:00+01:00'),
    }).returning();

    // 08:01 sweep tick: our deferred task is claimed and pinged (dispatch no-ops without a
    // token); the lapsed one is skipped.
    const atMorning = await releaseDeferredVaCallTaskPings(morning);
    check('08:01 release pass → exactly our deferred task released', atMorning.released === 1, String(atMorning.released));
    const [pinged] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, task.id));
    check('morning release set notifiedAt (the claim)', !!pinged?.notifiedAt, 'null');
    const [lapsedAfter] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, lapsed.id));
    check('already-lapsed deferred task NOT released (expiry pass owns it)',
        !lapsedAfter?.notifiedAt, lapsedAfter?.notifiedAt?.toISOString() ?? '');

    // One ping, ever: the CAS on notifiedAt can only be won once.
    const again = await releaseDeferredVaCallTaskPings(morning);
    check('second release pass → released 0 (CAS one-ping rule)', again.released === 0, String(again.released));
    const [samePing] = await db.select().from(vaCallTasks).where(eq(vaCallTasks.id, task.id));
    check('second pass leaves notifiedAt unchanged',
        samePing?.notifiedAt?.toISOString() === pinged?.notifiedAt?.toISOString(),
        `${pinged?.notifiedAt?.toISOString()} → ${samePing?.notifiedAt?.toISOString()}`);

    // Close both promptly — open fixture rows must not linger for the LIVE sweep to act on.
    await db.update(vaCallTasks)
        .set({ dismissedAt: new Date(), dismissedBy: 'system:test', dismissReason: 'suite fixture' })
        .where(inArray(vaCallTasks.id, [task.id, lapsed.id]));
}

async function testAlertPayloadAndContext(): Promise<void> {
    section('8. ALERT PAYLOAD + PORTAL CONTEXT — asserted, never sent');

    // The pure builder — the exact payload dispatch would carry, checked without a token in sight.
    const payload = buildVaCallTaskAlert({
        customerName: 'Payload Pat', phoneNumber: PHONE_I, channel: 'sms',
        conversationId: CONV_I, enquiryPreview: 'Can you fix my gate?',
        dueAt: new Date('2026-09-02T08:15:00+01:00'),
    });
    check('alert supplementary URL is the VA tasks portal', payload.url.endsWith('/admin/va-tasks'), payload.url);
    check("alert URL title invites the tap ('Open the call list')", /Open the call list/.test(payload.urlTitle), payload.urlTitle);
    check('alert first line: who — number (channel)', payload.message.includes(`Payload Pat — ${PHONE_I} (sms)`), payload.message);
    check('alert carries the enquiry preview', payload.message.includes('Can you fix my gate?'), payload.message);
    check('alert names the ring-by time on the London clock', /Ring them by 08:15/.test(payload.message), payload.message);
    check('alert body keeps the thread deep-link', payload.message.includes(`/admin/comms?conversation=${CONV_I}`), payload.message);
    check("fresh-task title is 'Ring this enquiry'", /Ring this enquiry/.test(payload.title), payload.title);

    const overdue = buildVaCallTaskAlert({
        customerName: 'Payload Pat', phoneNumber: PHONE_I, channel: 'sms',
        conversationId: CONV_I, overdue: true,
    });
    check("overdue variant title is 'Call task overdue'", /Call task overdue/.test(overdue.title), overdue.title);
    check('overdue variant says the window lapsed', /window has lapsed/.test(overdue.message), overdue.message);
    check('overdue variant still deep-links the portal', overdue.url.endsWith('/admin/va-tasks'), overdue.url);

    // Portal context: 4 inbound messages staged, task open → the list returns the LATEST 3 in
    // chronological order with media fields intact — everything the phone card renders cold.
    const t0 = Date.now() - 40 * 60_000;
    await stageMsg(CONV_J, 'inbound', 'Oldest — must be trimmed', new Date(t0));
    await stageMsg(CONV_J, 'inbound', 'Second message', new Date(t0 + 60_000));
    await stageMsg(CONV_J, 'inbound', 'Photo of the gate', new Date(t0 + 120_000), 'whatsapp', { url: '/api/media/vacall-test.jpg', type: 'image' });
    await stageMsg(CONV_J, 'inbound', 'Latest — when can you come?', new Date(t0 + 180_000));
    const [ctxTask] = await db.insert(vaCallTasks).values({
        conversationId: CONV_J, phone: PHONE_J, contactName: 'VA Suite J', channel: 'whatsapp',
        reason: 'context fixture', dueAt: computeVaCallDueAt(new Date()), notifiedAt: new Date(),
    }).returning();

    const list = await listVaCallTasks();
    const row = list.open.find((t) => t.id === ctxTask.id);
    check('open list carries the context task', !!row);
    check('context capped at the latest 3 inbound messages', row?.context.length === 3, String(row?.context.length));
    check('context is chronological (oldest of the 3 first)', row?.context[0]?.content === 'Second message', row?.context[0]?.content ?? 'null');
    check('context ends on the latest message', row?.context[2]?.content === 'Latest — when can you come?', row?.context[2]?.content ?? 'null');
    const media = row?.context.find((m) => m.mediaUrl);
    check('media message keeps mediaUrl + mediaType for the thumbnail',
        media?.mediaUrl === '/api/media/vacall-test.jpg' && media?.mediaType === 'image',
        JSON.stringify(media ?? null));

    await db.update(vaCallTasks)
        .set({ dismissedAt: new Date(), dismissedBy: 'system:test', dismissReason: 'suite fixture' })
        .where(eq(vaCallTasks.id, ctxTask.id));
}

// ---------------------------------------------------------------------------------- main

async function main(): Promise<void> {
    console.log('VA CALL TASK SUITE — Ofcom reserved numbers (90098x), zero sends, zero pushes');
    await ensureTable();
    await cleanup(); // a crashed previous run must not poison this one
    await makeConv(CONV_A, K(80), 'VA Suite A');
    await makeConv(CONV_B, K(81), 'VA Suite B');
    await makeConv(CONV_C, K(82), 'VA Suite C');
    await makeConv(CONV_D, K(83), 'VA Suite D');
    await makeConv(CONV_E, K(84), 'VA Suite E');
    await makeConv(CONV_F, K(85), 'VA Suite F');
    await makeConv(CONV_G, K(86), 'VA Suite G');
    await makeConv(CONV_H, K(87), 'VA Suite H');
    await makeConv(CONV_I, K(88), 'VA Suite I');
    await makeConv(CONV_J, K(89), 'VA Suite J');

    try {
        testDueAtArithmetic();
        await testTriggerGates();
        await testLaneBehaviour();
        await testCallIngestCompletion();
        await testSweepExpiry();
        await testApiRoutes();
        await testQuietHoursDeferral();
        await testAlertPayloadAndContext();
    } finally {
        await cleanup();
        delete process.env.COMMS_CONFIG_OVERRIDE;
    }

    console.log(`\n${'='.repeat(78)}\n${failed ? 'RED' : 'GREEN'}: ${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
