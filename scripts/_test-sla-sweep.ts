/**
 * PER-LANE SLA ESCALATION SWEEP (T6b, 29 Aug 2026), proven.
 *
 *   npx tsx scripts/_test-sla-sweep.ts
 *
 * What is attacked here, and how:
 *   · addWorkingHours day-boundary (pure) — a verdict at 16:55 is due 08:55 NEXT day on the
 *     4-working-hour SLA, not 20:55 tonight (the clock pauses 20:00–08:00).
 *   · quote_ready — non-breach inside the SLA (including the overnight pause: 3h55m of working
 *     time elapsed across two calendar days is still not 4h), breach past it, and the exact
 *     alert wording ("unpriced").
 *   · needs_ben — non-breach at 1.5 working hours, breach at 2.5, with the flagged question's
 *     own words in the note.
 *   · needs_info (24 CLOCK hours) — non-breach at 23h, breach at 25h; a customer who REPLIED
 *     is never in the lane; chase flag OFF → Ben gets the ping and NO draft/customer message
 *     exists; chase flag ON → the injected chase runs INSTEAD of the Ben ping.
 *   · visit_first (12 working hours = 1 working day) — non-breach at 11 working hours, breach
 *     the next morning.
 *   · IDEMPOTENCY — the same breached pass run twice produces exactly one alert (the sla_alerts
 *     row is the claim), and the daily reminder fires only after reminderEveryClockHours.
 *   · RESET ON LANE CHANGE — an open quote_ready episode resolves ('lane_changed') when the
 *     verdict moves on, and no ghost alert follows.
 *   · QUIET HOURS — a breach standing at 02:00 UK defers the whole pass (no ping), then fires
 *     at 08:05: surface in the morning, never at 2am.
 *
 * SAFETY, absolute:
 *   · Ofcom reserved drama range only: +44770090011x — a sub-range no other suite uses
 *     (checked against every 447700900xxx literal and template in scripts/, server/, shared/).
 *   · PUSHOVER_APP_TOKEN is deleted for this process before anything runs, AND every sweep call
 *     injects a collector notify — a ping can never reach a real phone by two independent locks.
 *   · SLA_CONFIG_OVERRIDE (process-local) supplies config — the shared app_settings row is
 *     never written.
 *   · Every sweep call is scoped to this suite's conversation ids (scopeConversationIds), so a
 *     run against the shared DB can neither alert on nor CONSUME a real thread's first-breach
 *     episode.
 *   · Nothing here sends: the chase path is exercised through an injected collector; the suite
 *     ASSERTS zero message_drafts rows for its numbers at the end.
 *   · Schema: the sla_alerts DDL (idempotent, additive, identical to
 *     migrations/20260829_sla_alerts.sql) is applied here as a targeted run — NOT db:push.
 *   · Cleanup deletes this suite's rows only, in a finally block, and a crashed previous run is
 *     cleaned before the suite stages anything.
 */
import 'dotenv/config';

// No token, no push, ever — belt on top of the injected notify braces.
delete process.env.PUSHOVER_APP_TOKEN;

// Process-local config: defaults (4wh / 2wh / 24h / 12wh, reminder 24h), chase OFF to start.
const CONFIG_CHASE_OFF = JSON.stringify({ enabled: true, customerChase: { enabled: false } });
const CONFIG_CHASE_ON = JSON.stringify({ enabled: true, customerChase: { enabled: true } });
process.env.SLA_CONFIG_OVERRIDE = CONFIG_CHASE_OFF;

import { db } from '../server/db';
import {
    conversations, messages, agentQuestions, messageDrafts, personalizedQuotes, slaAlerts,
} from '@shared/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { sweepSlaBreaches, type SlaBreachAlertArgs } from '../server/agents/sla-sweep';
import { addWorkingHours } from '../server/agents/promise-tracker';

// ---------------------------------------------------------------------------------- fixtures

// +44770090011x — reserved drama range, sub-range unused by any other suite.
const P = (n: number) => `+44770090011${n}`;
const K = (n: number) => `44770090011${n}@c.us`;
const CONV_A = 'sla_t_conv_a'; // quote_ready: day boundary, idempotency, reminder
const CONV_B = 'sla_t_conv_b'; // needs_ben: flagged question
const CONV_C = 'sla_t_conv_c'; // needs_info: chase OFF → Ben ping, no draft
const CONV_D = 'sla_t_conv_d'; // needs_info: chase ON → injected chase, no Ben ping
const CONV_E = 'sla_t_conv_e'; // visit_first
const CONV_F = 'sla_t_conv_f'; // reset on lane change
const CONV_G = 'sla_t_conv_g'; // quiet hours deferral → morning surface
const CONV_H = 'sla_t_conv_h'; // needs_info but the customer REPLIED → no lane
const ALL_CONVS = [CONV_A, CONV_B, CONV_C, CONV_D, CONV_E, CONV_F, CONV_G, CONV_H];
const ALL_PHONES = [0, 1, 2, 3, 4, 5, 6, 7].map(P);
const ALL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `44770090011${n}`);

// Fixed instants, late Aug 2026 (BST: UK = UTC+1). Comments give the UK wall clock.
const MON_0800 = new Date('2026-08-24T07:00:00Z'); // Mon 08:00 UK
const MON_0900 = new Date('2026-08-24T08:00:00Z'); // Mon 09:00 UK
const MON_1000 = new Date('2026-08-24T09:00:00Z'); // Mon 10:00 UK
const MON_1130 = new Date('2026-08-24T10:30:00Z'); // Mon 11:30 UK
const MON_1230 = new Date('2026-08-24T11:30:00Z'); // Mon 12:30 UK
const MON_1400 = new Date('2026-08-24T13:00:00Z'); // Mon 14:00 UK
const MON_1430 = new Date('2026-08-24T13:30:00Z'); // Mon 14:30 UK
const MON_1655 = new Date('2026-08-24T15:55:00Z'); // Mon 16:55 UK — the brief's day-boundary case
const MON_1900 = new Date('2026-08-24T18:00:00Z'); // Mon 19:00 UK
const MON_1950 = new Date('2026-08-24T18:50:00Z'); // Mon 19:50 UK
const TUE_0850 = new Date('2026-08-25T07:50:00Z'); // Tue 08:50 UK
const TUE_0900 = new Date('2026-08-25T08:00:00Z'); // Tue 09:00 UK
const WED_1000 = new Date('2026-08-26T09:00:00Z'); // Wed 10:00 UK (25h after TUE_0900)
const SUN_1200 = new Date('2026-08-23T11:00:00Z'); // Sun 12:00 UK
const MON_1100 = new Date('2026-08-24T10:00:00Z'); // Mon 11:00 UK (23h after SUN_1200)
const MON_1300 = new Date('2026-08-24T12:00:00Z'); // Mon 13:00 UK (25h after SUN_1200)
const SUN_2000 = new Date('2026-08-23T19:00:00Z'); // Sun 20:00 UK
const TUE_0200 = new Date('2026-08-25T01:00:00Z'); // Tue 02:00 UK — quiet hours
const TUE_0805 = new Date('2026-08-25T07:05:00Z'); // Tue 08:05 UK — the morning after

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

// Injected collectors: every ping and every chase lands HERE, never on a phone.
let notifications: SlaBreachAlertArgs[] = [];
const notify = async (a: SlaBreachAlertArgs) => { notifications.push(a); };
let chases: { conversationId: string; phone: string; body: string }[] = [];
const chase = async (a: { conversationId: string; phone: string; body: string }) => {
    chases.push(a);
    return 'sent' as const;
};

/** One sweep, scoped to the given fixtures, with the collectors and a fixed instant. */
function sweep(now: Date, convIds: string[]) {
    return sweepSlaBreaches({ now, notify, chase, scopeConversationIds: convIds });
}

async function makeConv(id: string, n: number, name: string, opts?: {
    tags?: string[]; metadata?: Record<string, unknown>; stage?: string;
}): Promise<void> {
    await db.insert(conversations).values({
        id, phoneNumber: K(n), contactName: name,
        status: 'active', stage: opts?.stage ?? 'active', priority: 'normal',
        tags: opts?.tags ?? [], metadata: opts?.metadata ?? {},
    });
}

let msgSeq = 0;
async function stageMsg(
    convId: string, direction: 'inbound' | 'outbound', text: string, at: Date, channel = 'whatsapp',
): Promise<void> {
    await db.insert(messages).values({
        id: `sla_t_msg_${Date.now()}_${msgSeq++}`,
        conversationId: convId, direction, channel,
        content: text, type: 'text', status: 'delivered', createdAt: at,
    });
}

/** Verdict metadata exactly as maybeAutoQuotePrep writes it. */
function verdictMeta(readiness: string, lastRunAt: Date): Record<string, unknown> {
    return {
        quotePrepIntake: { readiness, lines: [], gaps: [] },
        quotePrepAuto: { lastRunAt: lastRunAt.toISOString(), lastReadiness: readiness },
    };
}

async function openAlerts(convId: string) {
    return db.select().from(slaAlerts)
        .where(and(eq(slaAlerts.conversationId, convId), isNull(slaAlerts.resolvedAt)));
}

async function cleanup(): Promise<void> {
    await db.delete(slaAlerts).where(inArray(slaAlerts.conversationId, ALL_CONVS));
    await db.delete(messages).where(inArray(messages.conversationId, ALL_CONVS));
    await db.delete(agentQuestions).where(inArray(agentQuestions.conversationId, ALL_CONVS));
    await db.delete(messageDrafts).where(inArray(messageDrafts.phone, ALL_PHONES));
    await db.delete(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') IN (${sql.join(ALL_DIGITS.map((d) => sql`${d}`), sql`, `)})`);
    await db.delete(conversations).where(inArray(conversations.id, ALL_CONVS));
}

/** Idempotent, additive, identical to migrations/20260829_sla_alerts.sql — NOT db:push. */
async function ensureTable(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sla_alerts (
            id              varchar PRIMARY KEY NOT NULL,
            conversation_id varchar NOT NULL,
            lane            varchar(24) NOT NULL,
            lane_entered_at timestamp NOT NULL,
            first_alert_at  timestamp NOT NULL DEFAULT now(),
            last_alert_at   timestamp NOT NULL DEFAULT now(),
            alert_count     integer NOT NULL DEFAULT 1,
            resolved_at     timestamp,
            resolve_reason  varchar(80)
        )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sla_alerts_conversation ON sla_alerts (conversation_id)`);
    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_alerts_open ON sla_alerts (conversation_id, lane)
        WHERE resolved_at IS NULL`);
}

// ---------------------------------------------------------------------------------- the suite

async function main(): Promise<void> {
    await ensureTable();
    await cleanup(); // a crashed previous run must not poison this one

    // ---------------------------------------------------------------- 1. day boundary + quote_ready
    section('1. Working-hours day boundary + quote_ready lane (verdict Mon 16:55, SLA 4wh)');

    const dueA = addWorkingHours(MON_1655, 4);
    check('16:55 + 4 working hours = 08:55 NEXT day (pauses 20:00→08:00)',
        dueA.getTime() === new Date('2026-08-25T07:55:00Z').getTime(), `got ${dueA.toISOString()}`);

    await makeConv(CONV_A, 0, 'Sla Alice', { metadata: verdictMeta('quote_ready', MON_1655) });
    await stageMsg(CONV_A, 'inbound', 'Here are the photos you asked for', new Date(MON_1655.getTime() - 3_600_000));

    notifications = [];
    let r = await sweep(MON_1950, [CONV_A]); // 2h55m of working time elapsed
    check('Mon 19:50 (2h55m working): no breach', r.alerted === 0 && notifications.length === 0, JSON.stringify(r));
    r = await sweep(TUE_0850, [CONV_A]);     // 3h55m across the overnight pause
    check('Tue 08:50 (3h55m working, across the day boundary): still no breach',
        r.alerted === 0 && notifications.length === 0, JSON.stringify(r));
    check('no alert row exists yet', (await openAlerts(CONV_A)).length === 0);

    r = await sweep(TUE_0900, [CONV_A]);     // 4h05m working
    check('Tue 09:00 (4h05m working): BREACH — one alert', r.alerted === 1 && notifications.length === 1, JSON.stringify(r));
    check('alert names the thread and reads as quote-ready-unpriced',
        notifications[0]?.conversationId === CONV_A && /unpriced/i.test(notifications[0]?.note ?? ''),
        notifications[0]?.note);

    r = await sweep(TUE_0900, [CONV_A]);     // the same pass again
    check('IDEMPOTENT: second identical pass alerts nothing more',
        r.alerted === 0 && r.reminded === 0 && notifications.length === 1, JSON.stringify(r));
    let rowsA = await openAlerts(CONV_A);
    check('exactly one open episode row, alert_count 1', rowsA.length === 1 && rowsA[0].alertCount === 1);

    r = await sweep(WED_1000, [CONV_A]);     // 25h after the first alert
    check('25h later, still breached: exactly one DAILY reminder',
        r.reminded === 1 && notifications.length === 2 && /reminder/i.test(notifications[1]?.note ?? ''),
        JSON.stringify({ r, note: notifications[1]?.note }));
    rowsA = await openAlerts(CONV_A);
    check('episode row updated in place: alert_count 2, still one open row',
        rowsA.length === 1 && rowsA[0].alertCount === 2);
    r = await sweep(WED_1000, [CONV_A]);
    check('reminder is also idempotent within the day', r.reminded === 0 && notifications.length === 2, JSON.stringify(r));

    // ---------------------------------------------------------------- 2. needs_ben
    section('2. needs_ben lane (flagged question Mon 10:00, SLA 2wh)');

    await makeConv(CONV_B, 1, 'Sla Bert', { tags: ['needs_ben'] });
    await db.insert(agentQuestions).values({
        id: 'sla_t_q_b', conversationId: CONV_B, phone: P(1),
        question: 'Customer wants a Saturday slot — can you do the 5th?',
        status: 'flagged', createdAt: MON_1000,
    });

    notifications = [];
    r = await sweep(MON_1130, [CONV_B]);
    check('1.5 working hours: no breach', r.alerted === 0 && notifications.length === 0, JSON.stringify(r));
    r = await sweep(MON_1230, [CONV_B]);
    check('2.5 working hours: BREACH — one alert', r.alerted === 1 && notifications.length === 1, JSON.stringify(r));
    check('note carries the flagged question itself',
        (notifications[0]?.note ?? '').includes('Saturday slot'), notifications[0]?.note);

    // ---------------------------------------------------------------- 3. needs_info, chase OFF
    section('3. needs_info lane, chase flag OFF (our questions Sun 12:00, SLA 24 CLOCK hours)');

    await makeConv(CONV_C, 2, 'Sla Cara', { metadata: verdictMeta('needs_info', SUN_1200) });
    await stageMsg(CONV_C, 'inbound', 'Can you quote for painting the hall?', new Date(SUN_1200.getTime() - 3_600_000));
    await stageMsg(CONV_C, 'outbound', 'Which rooms exactly, and do you have paint already?', SUN_1200);

    notifications = []; chases = [];
    r = await sweep(MON_1100, [CONV_C]);
    check('23 clock hours of silence: no breach', r.alerted === 0 && notifications.length === 0, JSON.stringify(r));
    r = await sweep(MON_1300, [CONV_C]);
    check('25 clock hours of silence: BREACH — Ben pinged INSTEAD of the customer (flag off)',
        r.alerted === 1 && notifications.length === 1 && r.chased === 0 && chases.length === 0,
        JSON.stringify(r));
    check('note says the chase is switched off', /chase is switched off/i.test(notifications[0]?.note ?? ''), notifications[0]?.note);
    const draftsC = await db.select({ id: messageDrafts.id }).from(messageDrafts).where(eq(messageDrafts.phone, P(2)));
    check('NO draft, NO customer message exists', draftsC.length === 0);

    // A customer who replied is never in the lane at all.
    await makeConv(CONV_H, 7, 'Sla Hana', { metadata: verdictMeta('needs_info', SUN_1200) });
    await stageMsg(CONV_H, 'outbound', 'Which rooms exactly?', SUN_1200);
    await stageMsg(CONV_H, 'inbound', 'Just the hall and landing please', MON_1000);
    notifications = [];
    r = await sweep(MON_1300, [CONV_H]);
    check('customer REPLIED since our questions: no lane, no alert',
        r.alerted === 0 && notifications.length === 0, JSON.stringify(r));

    // ---------------------------------------------------------------- 4. needs_info, chase ON
    section('4. needs_info lane, chase flag ON (canned chase through the injected rails)');

    await makeConv(CONV_D, 3, 'Sla Dina', { metadata: verdictMeta('needs_info', SUN_1200) });
    await stageMsg(CONV_D, 'outbound', 'Could you send a photo of the fence panel?', SUN_1200);

    process.env.SLA_CONFIG_OVERRIDE = CONFIG_CHASE_ON;
    notifications = []; chases = [];
    r = await sweep(MON_1300, [CONV_D]);
    process.env.SLA_CONFIG_OVERRIDE = CONFIG_CHASE_OFF;
    check('flag ON: the canned chase runs instead of a Ben ping',
        r.alerted === 1 && r.chased === 1 && chases.length === 1 && notifications.length === 0,
        JSON.stringify({ r, notes: notifications.map((n) => n.note) }));
    check('chase targets the right customer with the canned template (never LLM output)',
        chases[0]?.phone === P(3) && /just checking in/i.test(chases[0]?.body ?? ''),
        JSON.stringify(chases[0]));

    // ---------------------------------------------------------------- 5. visit_first
    section('5. visit_first lane (verdict Mon 08:00, SLA 12wh = one working day)');

    await makeConv(CONV_E, 4, 'Sla Ewan', { metadata: verdictMeta('visit_first', MON_0800) });

    notifications = [];
    r = await sweep(MON_1900, [CONV_E]);
    check('11 working hours: no breach', r.alerted === 0 && notifications.length === 0, JSON.stringify(r));
    r = await sweep(TUE_0900, [CONV_E]); // 12wh lands at 20:00 → due rolls to Tue 08:00
    check('the next working morning: BREACH — one alert',
        r.alerted === 1 && notifications.length === 1 && /visit/i.test(notifications[0]?.note ?? ''),
        JSON.stringify(r));

    // ---------------------------------------------------------------- 6. reset on lane change
    section('6. Reset on lane change (open quote_ready episode resolves, no ghost alert)');

    await makeConv(CONV_F, 5, 'Sla Faye', { metadata: verdictMeta('quote_ready', MON_0900) });
    notifications = [];
    r = await sweep(MON_1400, [CONV_F]); // 5 working hours — breached
    check('setup: quote_ready breach alerted', r.alerted === 1 && notifications.length === 1, JSON.stringify(r));

    // The verdict moves on: a re-run concludes needs_info, and the customer has since replied
    // (so the thread is in NO lane at all).
    await db.update(conversations)
        .set({ metadata: verdictMeta('needs_info', MON_1400) })
        .where(eq(conversations.id, CONV_F));
    await stageMsg(CONV_F, 'outbound', 'Quick one — is the loft boarded?', MON_1400);
    await stageMsg(CONV_F, 'inbound', 'Yes, fully boarded', MON_1430);

    r = await sweep(MON_1430, [CONV_F]);
    check('lane changed: old episode RESOLVED, nothing new alerted',
        r.resolved === 1 && r.alerted === 0 && r.reminded === 0 && notifications.length === 1,
        JSON.stringify(r));
    const [closedF] = await db.select().from(slaAlerts).where(eq(slaAlerts.conversationId, CONV_F));
    check("episode row closed with resolve_reason 'lane_changed'",
        !!closedF?.resolvedAt && closedF?.resolveReason === 'lane_changed',
        JSON.stringify(closedF));
    r = await sweep(WED_1000, [CONV_F]);
    check('no ghost alert on later passes', r.alerted === 0 && r.reminded === 0 && notifications.length === 1, JSON.stringify(r));

    // ---------------------------------------------------------------- 7. quiet hours
    section('7. Quiet hours (breach standing at 02:00 defers; surfaces at 08:05)');

    await makeConv(CONV_G, 6, 'Sla Gwen', { metadata: verdictMeta('needs_info', SUN_2000) });
    await stageMsg(CONV_G, 'outbound', 'What size is the shed roughly?', SUN_2000);

    notifications = [];
    r = await sweep(TUE_0200, [CONV_G]); // 30h of silence — breached, but it is 2am
    check('02:00 UK: the pass DEFERS — no ping, no claim',
        r.deferred === true && r.alerted === 0 && notifications.length === 0
        && (await openAlerts(CONV_G)).length === 0,
        JSON.stringify(r));
    r = await sweep(TUE_0805, [CONV_G]);
    check('08:05 UK: the breach surfaces in the morning — one alert',
        r.alerted === 1 && notifications.length === 1, JSON.stringify(r));

    // ---------------------------------------------------------------- footer safety assertions
    section('Footer: nothing reached a customer');

    const anyDrafts = await db.select({ id: messageDrafts.id })
        .from(messageDrafts).where(inArray(messageDrafts.phone, ALL_PHONES));
    check('zero message_drafts rows across every fixture number', anyDrafts.length === 0);
    const anyMsgs = await db.select({ id: messages.id })
        .from(messages).where(inArray(messages.conversationId, ALL_CONVS));
    check('the only messages are the 9 this suite staged (sweep wrote none)',
        anyMsgs.length === 9, `found ${anyMsgs.length}`);
}

main()
    .then(async () => {
        await cleanup();
        console.log(`\n${'='.repeat(78)}\n${failed === 0 ? 'SUITE GREEN' : 'SUITE RED'} — ${passed} passed, ${failed} failed\n${'='.repeat(78)}`);
        process.exit(failed === 0 ? 0 : 1);
    })
    .catch(async (e) => {
        console.error('\nSUITE CRASHED:', e);
        try { await cleanup(); } catch { /* leave evidence if cleanup itself fails */ }
        process.exit(1);
    });
