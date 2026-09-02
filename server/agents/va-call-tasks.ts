/**
 * VA call tasks — speed-to-lead calling on text-channel enquiries (28 Aug 2026).
 *
 * A WhatsApp/SMS/webform enquiry from someone new (or returning after months) converts best when
 * a HUMAN rings them within minutes. The first-contact ack already asks "is it OK if we give you
 * a quick call?" and the ack-reply classifier already hears the answer — but until this module,
 * nothing ever told a human to pick up the phone, and nothing tracked whether they did. Inbound
 * VOICE enquiries are exempt by construction: voice contact already happened.
 *
 * What this module does, and pointedly does NOT do:
 *   - It creates a TASK (a va_call_tasks row), pings Ben (Pushover event 'va_call_task' — held
 *     back to the 08:00 morning release for an out-of-hours enquiry, never a 2am wake-up), and
 *     HOLDS the LLM triage lane until the task resolves or its 15-working-minute window lapses.
 *   - It never sends anything to a customer. Not on creation, not on expiry, not ever. The one
 *     customer-visible thing that still happens is the existing first-contact ack, which goes out
 *     exactly as before — it SETS UP the call ("is it OK if we ring you?"), so holding it would
 *     defeat the feature it serves.
 *
 * The triage hold rides the existing machinery rather than adding a new gate: the debounced lane
 * already runs off conversations.metadata.nextTriageAt (comms-lanes.arm() writes it, comms-sweep's
 * tickDueTriage acts on it). We push nextTriageAt to the task's dueAt — the same jsonb-merge write
 * arm() uses, so the 27-28 Aug claimTriageTurn/CAS semantics are untouched: every actual agent run
 * still goes through the shared atomic claim; this module only moves the DUE TIME. A useful
 * property falls out for free: if releasing the hold ever fails, nextTriageAt is already sitting
 * at a past-due dueAt, so the fast tick resumes triage by itself — the hold cannot wedge a thread.
 *
 * Recipient is Ben for now (owner decision); a VA later is a Pushover-recipient swap, not code.
 */
import { db } from '../db';
import { conversations, messages, vaCallTasks, type VaCallTask } from '@shared/schema';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
    classifyAckReply,
    classifyHistory,
    isOutOfHours,
    PREFERS_TEXT_TAG,
    readContactHistory,
    screenInbound,
    type FirstContactChannel,
} from '../first-contact-ack';
import { addWorkingHours } from './promise-tracker';

/** London wall-clock hour of an arbitrary instant — isOutOfHours() alone reads the real clock,
 *  and the deferral decision must be testable at a fixed fixture time. */
import { ukHour as ukHourOf } from '../working-hours';

/** The owner's window: a human rings within 15 WORKING minutes (08:00–20:00 UK) or the text lane
 *  takes the thread back. Out-of-hours enquiries are deferred (dueAt = next 08:15), never skipped. */
export const VA_CALL_DUE_WORKING_MINUTES = 15;

/** The channels that create a call task. 'post_call' is deliberately absent — a task to ring
 *  someone we just spoke to on the phone is the feature disproving itself. */
const TASK_CHANNELS: FirstContactChannel[] = ['whatsapp', 'sms', 'webform'];

/** dueAt = from + 15 working minutes, on the SAME clock as promise-tracker's commitments — one
 *  working-hours implementation in the codebase, per the brief. 22:30 tonight → 08:15 tomorrow. */
export function computeVaCallDueAt(from: Date): Date {
    return addWorkingHours(from, VA_CALL_DUE_WORKING_MINUTES / 60);
}

async function vaCallTaskEnabled(): Promise<boolean> {
    // Lazy import, same reason as first-contact-ack's readConfig: this module is reached from hot
    // ingest paths via comms-lanes, and ./comms pulls in the whole agent runner. Fail closed.
    try {
        const { getCommsAgentConfig } = await import('./comms');
        return (await getCommsAgentConfig()).vaCallTask.enabled;
    } catch (error: any) {
        console.error('[VaCallTasks] Could not read config, treating as disabled:', error?.message);
        return false;
    }
}

const openTask = and(isNull(vaCallTasks.completedAt), isNull(vaCallTasks.dismissedAt));

export async function findOpenVaCallTask(conversationId: string): Promise<VaCallTask | null> {
    const [task] = await db.select().from(vaCallTasks)
        .where(and(eq(vaCallTasks.conversationId, conversationId), openTask))
        .orderBy(desc(vaCallTasks.createdAt))
        .limit(1);
    return task ?? null;
}

// ---------------------------------------------------------------- the triage hold

/**
 * Push the debounced LLM triage out to the task's dueAt: while a human call is imminent, the
 * agent must not run a full text intake in parallel (a customer being rung AND texted a list of
 * intake questions at once reads as a call centre, not a tradesman).
 *
 * Same latest-writer-wins jsonb merge as comms-lanes.arm() — this is a due-time move, not a run
 * claim. Runs still serialize on claimTriageTurn. Called on creation AND on every later inbound
 * while the task stays open (arm() re-arms a short debounce on each message; this re-asserts the
 * hold after it, or the second message of a burst would quietly undo the hold).
 */
export async function holdTriageForVaCallTask(conversationId: string, dueAt: Date): Promise<void> {
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${dueAt.toISOString()}::text)`,
    }).where(eq(conversations.id, conversationId));
}

/**
 * Resolution (completed / dismissed / expired) pulls nextTriageAt back to NOW, so the fast tick
 * picks the thread up within ~15s and the agent triages with whatever resolved the task in-thread
 * (a call transcript, a "text only please"). Unconditional overwrite is the house precedent —
 * releaseMorningHolds does exactly this — and claimTriageTurn still floors the actual run rate.
 */
export async function releaseVaCallTriage(conversationId: string): Promise<void> {
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${new Date().toISOString()}::text)`,
    }).where(eq(conversations.id, conversationId));
}

// ---------------------------------------------------------------- creation

export interface VaCallTaskCreateResult {
    created: boolean;
    /** Why not, when not — every refusal is loggable, in first-contact-ack's tradition. */
    reason: 'CREATED' | 'DISABLED' | 'CHANNEL_EXEMPT' | 'SCREENED_OUT' | 'OPTED_OUT'
        | 'NOT_FIRST_OR_RETURNING' | 'CALL_ALREADY_HAPPENED' | 'ALREADY_OPEN' | 'ERROR';
    detail?: string;
    task?: VaCallTask;
}

/**
 * The trigger gate. Reuses the first-contact ack's exported helpers wholesale — screenInbound
 * (geo + spam), readContactHistory + classifyHistory (first / returning-after-60d) — because two
 * copies of "who deserves an instant response" WILL drift, and the ack and the call task must
 * agree about the same person or one of them is lying.
 */
export async function maybeCreateVaCallTask(input: {
    conversationId: string;
    phone: string;                 // E.164
    channel: FirstContactChannel;
    contactName?: string | null;
    text?: string | null;
    /** Test seam: the creation instant. Production callers omit it (defaults to now); the suite
     *  injects fixed instants so the out-of-hours ping deferral is provable at any run time. */
    at?: Date;
}): Promise<VaCallTaskCreateResult> {
    try {
        if (!(await vaCallTaskEnabled())) return { created: false, reason: 'DISABLED' };
        if (!TASK_CHANNELS.includes(input.channel)) return { created: false, reason: 'CHANNEL_EXEMPT', detail: input.channel };

        const screen = screenInbound({ e164: input.phone, text: input.text });
        if (!screen.ok) return { created: false, reason: 'SCREENED_OUT', detail: screen.reason };

        const { blockedByOptOut } = await import('../opt-out');
        if (await blockedByOptOut(input.phone, 'service_reply')) {
            return { created: false, reason: 'OPTED_OUT' };
        }

        const history = await readContactHistory({ conversationId: input.conversationId, phone: input.phone });
        const { getCommsAgentConfig } = await import('./comms');
        const returningAfterDays = (await getCommsAgentConfig()).firstContactAutoAck.returningAfterDays;
        const cls = classifyHistory(history, returningAfterDays);
        if (cls === 'ongoing') return { created: false, reason: 'NOT_FIRST_OR_RETURNING' };

        // Any call, any direction, anywhere in this person's threads = voice contact exists and
        // the whole premise ("nobody has spoken to them") is gone. Checked across every
        // conversation row the number owns, same as the history read — a webform thread and a
        // WhatsApp thread are one person.
        const convIds = Array.from(new Set([...history.conversationIds, input.conversationId]));
        const [priorCall] = await db.select({ id: messages.id }).from(messages)
            .where(and(inArray(messages.conversationId, convIds), eq(messages.channel, 'call')))
            .limit(1);
        if (priorCall) return { created: false, reason: 'CALL_ALREADY_HAPPENED' };

        const now = input.at ?? new Date();
        const dueAt = computeVaCallDueAt(now);
        // The uq_va_call_tasks_open partial index is the real "no open task already" gate: two
        // concurrent inbounds both reach this insert, one wins, the other conflicts and returns
        // no row. An advisory SELECT-then-INSERT here would be the exact check-then-act shape the
        // 27 Aug triple-send was made of.
        const [task] = await db.insert(vaCallTasks).values({
            conversationId: input.conversationId,
            phone: input.phone,
            contactName: input.contactName ?? null,
            channel: input.channel,
            reason: `${cls === 'first' ? 'First contact' : 'Returning customer'} via ${input.channel} — call within 15 working minutes`,
            createdAt: now,
            dueAt,
        }).onConflictDoNothing().returning();
        if (!task) return { created: false, reason: 'ALREADY_OPEN' };

        // Hold triage BEFORE the ping: the order matters only in the failure cases, and a held
        // thread with a missed ping degrades to "expiry releases it in 15 minutes", while a
        // pinged Ben racing a full agent intake is the exact double-act this feature exists to
        // prevent.
        await holdTriageForVaCallTask(input.conversationId, dueAt)
            .catch((e: any) => console.warn('[VaCallTasks] triage hold failed (task stands):', e?.message));

        // T2 quiet-hours fix (29 Aug 2026): a 2am enquiry gets its dueAt correctly deferred to
        // 08:15, but the creation ping used to fire IMMEDIATELY at priority 1, which bypasses the
        // phone's quiet mode — the exact 2am wake-up the working-hours clock exists to prevent.
        // Worse, Pushover quiet hours in 'mute' mode dropped the ping forever, with nothing
        // re-surfacing it in the morning. So out of hours (same 08:00–20:00 Europe/London boundary
        // the dueAt arithmetic uses) the ping is DEFERRED, not sent: notifiedAt stays null and
        // releaseDeferredVaCallTaskPings — the morning release, run from the same sweep tick as
        // expiry, the releaseMorningHolds pattern — sends it from 08:00, comfortably before the
        // 08:15 dueAt. The task row, the triage hold and the expiry clock are untouched either way.
        if (isOutOfHours(ukHourOf(now))) {
            console.log(`[VaCallTasks] ${task.id}: out of hours — ping deferred to the morning release (due ${dueAt.toISOString()}).`);
        } else {
            try {
                const { notifyVaCallTask } = await import('../pushover');
                await notifyVaCallTask({
                    customerName: input.contactName,
                    phoneNumber: input.phone,
                    channel: input.channel,
                    conversationId: input.conversationId,
                    enquiryPreview: input.text,
                    dueAt,
                });
                await db.update(vaCallTasks).set({ notifiedAt: new Date() }).where(eq(vaCallTasks.id, task.id));
                task.notifiedAt = new Date();
            } catch (e: any) {
                // notifiedAt stays null — visible on /admin/va-tasks, the morning-release pass
                // retries it on the next tick, and the task itself still expires on schedule.
                console.warn('[VaCallTasks] creation ping failed (task stands, sweep retries):', e?.message);
            }
        }

        void logVaEvent(`VA call task created (${task.reason}) — due ${dueAt.toISOString()}`, input.phone, input.conversationId);
        console.log(`[VaCallTasks] Created ${task.id} for ${input.conversationId} (${input.channel}, due ${dueAt.toISOString()}).`);
        return { created: true, reason: 'CREATED', task };
    } catch (error: any) {
        console.error('[VaCallTasks] create failed:', error?.message ?? error);
        return { created: false, reason: 'ERROR', detail: error?.message };
    }
}

// ---------------------------------------------------------------- resolution

/** Fire-safe system-event line; the activity page answers "did the task machinery act?". */
async function logVaEvent(summary: string, phone: string | null, conversationId: string | null): Promise<void> {
    try {
        const { logSystemEvent } = await import('../system-events');
        void logSystemEvent({ kind: 'va_call_task', summary, phone, conversationId, source: 'va-call-tasks' });
    } catch { /* bookkeeping must never break the action it describes */ }
}

/**
 * Fulfilment: a call landed on the thread (server/call-thread.ts calls this from the ingest).
 * ANY direction counts — Ben ringing them is the task done; them ringing us makes it moot the
 * same way. Only calls AFTER the task was created settle it: the backfill replays months-old
 * calls through the same ingest, and an old call must not quietly retire a live task.
 * The WHERE is the claim — open rows only — so the finalization re-ingest of the same call
 * (written at ringing time, rewritten with the duration) completes once, not twice.
 */
export async function completeVaCallTasksForCall(conversationId: string, callAt: Date): Promise<number> {
    const rows = await db.update(vaCallTasks)
        .set({ completedAt: callAt })
        .where(and(
            eq(vaCallTasks.conversationId, conversationId),
            openTask,
            sql`${vaCallTasks.createdAt} < ${callAt.toISOString()}::timestamp`,
        ))
        .returning({ id: vaCallTasks.id, phone: vaCallTasks.phone });
    if (rows.length) {
        await releaseVaCallTriage(conversationId)
            .catch((e: any) => console.warn('[VaCallTasks] release after call failed:', e?.message));
        void logVaEvent('VA call task completed — a call landed on the thread', rows[0].phone, conversationId);
        console.log(`[VaCallTasks] ${conversationId}: call landed, task ${rows[0].id} completed, triage released.`);
    }
    return rows.length;
}

/** Manual "Mark called" from /admin/va-tasks. CAS on the open state; null = already resolved. */
export async function completeVaCallTask(taskId: string): Promise<VaCallTask | null> {
    const [task] = await db.update(vaCallTasks)
        .set({ completedAt: new Date() })
        .where(and(eq(vaCallTasks.id, taskId), openTask))
        .returning();
    if (task) {
        await releaseVaCallTriage(task.conversationId)
            .catch((e: any) => console.warn('[VaCallTasks] release after manual complete failed:', e?.message));
        void logVaEvent('VA call task marked called (manual)', task.phone, task.conversationId);
    }
    return task ?? null;
}

/** Dismiss one task by id (admin route). CAS on the open state; null = already resolved. */
export async function dismissVaCallTask(taskId: string, by: string, reason: string): Promise<VaCallTask | null> {
    const [task] = await db.update(vaCallTasks)
        .set({ dismissedAt: new Date(), dismissedBy: by, dismissReason: reason.slice(0, 80) })
        .where(and(eq(vaCallTasks.id, taskId), openTask))
        .returning();
    if (task) {
        await releaseVaCallTriage(task.conversationId)
            .catch((e: any) => console.warn('[VaCallTasks] release after dismiss failed:', e?.message));
        void logVaEvent(`VA call task dismissed by ${by} (${reason})`, task.phone, task.conversationId);
    }
    return task ?? null;
}

/**
 * Dismiss every open task for a phone number — the opt-out path. An opt-out is recorded against
 * the NUMBER (server/opt-out.ts), and a person who just wrote STOP must not stay on anyone's
 * call list under a different conversation row.
 */
export async function dismissOpenVaCallTasksForPhone(phone: string, by: string, reason: string): Promise<number> {
    const digits = phone.replace('@c.us', '').replace(/\D/g, '');
    if (!digits) return 0;
    const rows = await db.update(vaCallTasks)
        .set({ dismissedAt: new Date(), dismissedBy: by, dismissReason: reason.slice(0, 80) })
        .where(and(sql`regexp_replace(${vaCallTasks.phone}, '[^0-9]', '', 'g') = ${digits}`, openTask))
        .returning({ conversationId: vaCallTasks.conversationId, phone: vaCallTasks.phone });
    for (const r of rows) {
        await releaseVaCallTriage(r.conversationId)
            .catch((e: any) => console.warn('[VaCallTasks] release after phone dismiss failed:', e?.message));
        void logVaEvent(`VA call task dismissed (${reason})`, r.phone, r.conversationId);
    }
    return rows.length;
}

// ---------------------------------------------------------------- the inbound lane

/**
 * The single entry comms-lanes calls on every inbound (after GATE 0, after arm()). Two jobs:
 *
 *   1. No open task → try to create one (the full gate lives in maybeCreateVaCallTask).
 *   2. Open task → the thread is in the held window. If this message is a clear "text only
 *      please" (the SAME classifier tagAckReply trusts — one vocabulary for the customer's
 *      answer, never two), the task dies with 'customer_prefers_text' and triage resumes:
 *      ringing someone who has just asked us not to is worse than never ringing at all.
 *      Anything else re-asserts the hold, because arm() just pushed nextTriageAt to a short
 *      debounce and would otherwise quietly undo it mid-window.
 *
 * MUST be called AFTER arm() and awaited by the caller's lane runner — the hold write has to
 * land after arm's write, latest-writer-wins.
 */
export async function runVaCallTaskLane(input: {
    conversationId: string;
    phone: string;
    channel: FirstContactChannel;
    contactName?: string | null;
    text?: string | null;
}): Promise<void> {
    const open = await findOpenVaCallTask(input.conversationId);
    if (!open) {
        const result = await maybeCreateVaCallTask(input);
        if (result.reason !== 'DISABLED' && result.reason !== 'NOT_FIRST_OR_RETURNING') {
            console.log(`[VaCallTasks] ${input.conversationId}: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
        }
        return;
    }

    const { intent } = classifyAckReply(input.text);
    if (intent === PREFERS_TEXT_TAG) {
        const [task] = await db.update(vaCallTasks)
            .set({ dismissedAt: new Date(), dismissedBy: 'system:prefers_text', dismissReason: 'customer_prefers_text' })
            .where(and(eq(vaCallTasks.id, open.id), openTask))
            .returning();
        if (task) {
            await releaseVaCallTriage(input.conversationId)
                .catch((e: any) => console.warn('[VaCallTasks] release after prefers_text failed:', e?.message));
            void logVaEvent('VA call task dismissed — customer asked to keep it in writing', task.phone, task.conversationId);
            console.log(`[VaCallTasks] ${input.conversationId}: customer prefers text — task dismissed, triage released.`);
        }
        return;
    }

    await holdTriageForVaCallTask(input.conversationId, open.dueAt);
}

// ---------------------------------------------------------------- the sweep

/**
 * MORNING RELEASE for deferred pings (T2, 29 Aug 2026) — the va-call-task twin of comms-sweep's
 * releaseMorningHolds: gated on the same 08:00–20:00 UK clock, driven off DB state (open task,
 * notifiedAt null), no timers, so a deploy mid-night costs seconds, never the ping.
 *
 * Covers two cases with one query: the overnight enquiry whose creation ping was deliberately
 * deferred, and the rare in-hours task whose ping failed — both get exactly one send, because the
 * CAS on notifiedAt IS the claim (two sweeping processes release a ping once). Tasks already past
 * dueAt are deliberately excluded: the expiry pass below owns those and its one overdue ping
 * ("window lapsed") is the honest message — a cheery "ring them by 08:15" arriving at 09:40 would
 * be two pings saying two different things.
 *
 * `now` is a test seam; production callers omit it.
 */
export async function releaseDeferredVaCallTaskPings(now: Date = new Date()): Promise<{ released: number }> {
    if (isOutOfHours(ukHourOf(now))) return { released: 0 };

    const waiting = await db.select().from(vaCallTasks)
        .where(and(openTask, isNull(vaCallTasks.notifiedAt), sql`${vaCallTasks.dueAt} > ${now.toISOString()}::timestamp`))
        .orderBy(vaCallTasks.dueAt)
        .limit(5);

    let released = 0;
    for (const task of waiting) {
        // The claim: notifiedAt goes from null → now exactly once, before the send. A crash
        // between claim and send loses one courtesy ping, never duplicates one — the same
        // trade every claimed-send in this codebase makes.
        const [claimed] = await db.update(vaCallTasks)
            .set({ notifiedAt: new Date() })
            .where(and(eq(vaCallTasks.id, task.id), isNull(vaCallTasks.notifiedAt), openTask))
            .returning({ id: vaCallTasks.id });
        if (!claimed) continue;
        released++;

        // The enquiry text lives on the thread, not the task row — one small read so the morning
        // ping carries "what am I ringing about", same as the immediate ping would have.
        const [latest] = await db.select({ content: messages.content }).from(messages)
            .where(and(eq(messages.conversationId, task.conversationId), eq(messages.direction, 'inbound')))
            .orderBy(desc(messages.createdAt))
            .limit(1);

        try {
            const { notifyVaCallTask } = await import('../pushover');
            await notifyVaCallTask({
                customerName: task.contactName,
                phoneNumber: task.phone,
                channel: task.channel,
                conversationId: task.conversationId,
                enquiryPreview: latest?.content ?? null,
                dueAt: task.dueAt,
            });
        } catch (e: any) {
            console.warn('[VaCallTasks] morning-release ping failed (claim stands, no retry):', e?.message);
        }
        void logVaEvent(`VA call task ping released (morning release) — due ${task.dueAt.toISOString()}`, task.phone, task.conversationId);
        console.log(`[VaCallTasks] Morning release: pinged ${task.id} (${task.conversationId}, due ${task.dueAt.toISOString()}).`);
    }
    return { released };
}

/**
 * Expiry pass, wired once into comms-sweep's fast tick (the promise-tracker pattern). A task
 * whose 15-working-minute window has lapsed is dismissed with dismissedBy 'system:expired' —
 * expiry is a dismissal, not a third state — triage is released, ONE overdue ping goes out
 * ("window lapsed, texting resumed, still worth a call"), and a system event lands on
 * /admin/activity. Nothing is ever sent to the customer from here: the comms agent resumes with
 * full context and decides for itself.
 *
 * Same discipline as fallbackOverdueCallbacks / flagOverdueCommitments: the CAS update IS the
 * claim (open rows only, so two sweeping processes expire a task once), cap 3 per pass so the
 * queue drains across passes, and a thrown error leaves the row open for the next pass.
 *
 * The morning release for deferred pings runs FIRST, inside this same entry point — comms-sweep
 * already calls this every fast tick, so the deferral fix ships without touching the sweep's
 * wiring (comms-sweep.ts belongs to another pane right now).
 */
export async function expireOverdueVaCallTasks(): Promise<{ scanned: number; expired: number }> {
    const now = new Date();
    await releaseDeferredVaCallTaskPings(now)
        .catch((e: any) => console.error('[VaCallTasks] morning release failed (expiry continues):', e?.message));
    const overdue = await db.select().from(vaCallTasks)
        .where(and(openTask, lte(vaCallTasks.dueAt, now)))
        .orderBy(vaCallTasks.dueAt)
        .limit(10);

    let expired = 0;
    for (const task of overdue) {
        if (expired >= 3) break;
        try {
            const [claimed] = await db.update(vaCallTasks)
                .set({ dismissedAt: new Date(), dismissedBy: 'system:expired', dismissReason: 'call window lapsed' })
                .where(and(eq(vaCallTasks.id, task.id), openTask))
                .returning();
            if (!claimed) continue; // resolved between the select and the claim — someone rang them
            expired++;

            await releaseVaCallTriage(task.conversationId)
                .catch((e: any) => console.warn('[VaCallTasks] release after expiry failed (tick self-heals):', e?.message));
            void logVaEvent(
                `VA call task expired unactioned (due ${task.dueAt.toISOString()}) — triage resumed, no message sent`,
                task.phone, task.conversationId,
            );
            // The one overdue re-ping, ever, per task: the claim above can only be won once, so
            // this cannot become the endless re-ping the brief forbids.
            try {
                const { notifyVaCallTask } = await import('../pushover');
                await notifyVaCallTask({
                    customerName: task.contactName,
                    phoneNumber: task.phone,
                    channel: task.channel,
                    conversationId: task.conversationId,
                    dueAt: task.dueAt,
                    overdue: true,
                });
            } catch (e: any) {
                console.warn('[VaCallTasks] overdue ping failed (expiry stands):', e?.message);
            }
            console.log(`[VaCallTasks] Expired ${task.id} (${task.conversationId}) — window lapsed, triage released.`);
        } catch (error: any) {
            console.error(`[VaCallTasks] expiry failed for ${task.id} (left open, will retry):`, error?.message);
        }
    }
    return { scanned: overdue.length, expired };
}

// ---------------------------------------------------------------- admin reads

/** The last few inbound messages behind an open task — what the portal shows so a VA can make
 *  the call COLD: the enquiry in the customer's own words plus any photos they sent. */
export interface VaCallTaskContextMessage {
    id: string;
    content: string | null;
    type: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: Date;
}

export type VaCallTaskWithContext = VaCallTask & { context: VaCallTaskContextMessage[] };

const CONTEXT_MESSAGES_PER_TASK = 3;

/**
 * Open tasks (dueAt ascending — the next call to make is on top) with per-task thread context,
 * and recently resolved ones (no context: the resolved list is an audit trail, not a call sheet).
 * One query fetches every open task's context via a per-conversation row_number window — the
 * open list is capped at 50, so this stays a single bounded read however busy the morning is.
 */
export async function listVaCallTasks(): Promise<{ open: VaCallTaskWithContext[]; recent: VaCallTask[] }> {
    const openRows = await db.select().from(vaCallTasks)
        .where(openTask)
        .orderBy(vaCallTasks.dueAt)
        .limit(50);
    const recent = await db.select().from(vaCallTasks)
        .where(or(sql`${vaCallTasks.completedAt} IS NOT NULL`, sql`${vaCallTasks.dismissedAt} IS NOT NULL`))
        .orderBy(desc(sql`coalesce(${vaCallTasks.completedAt}, ${vaCallTasks.dismissedAt})`))
        .limit(20);

    const convIds = Array.from(new Set(openRows.map((t) => t.conversationId)));
    const byConv = new Map<string, VaCallTaskContextMessage[]>();
    if (convIds.length) {
        const rows = await db.select({
            id: messages.id,
            conversationId: messages.conversationId,
            content: messages.content,
            type: messages.type,
            mediaUrl: messages.mediaUrl,
            mediaType: messages.mediaType,
            createdAt: messages.createdAt,
            rank: sql<number>`row_number() over (partition by ${messages.conversationId} order by ${messages.createdAt} desc)`.as('rank'),
        }).from(messages)
            .where(and(inArray(messages.conversationId, convIds), eq(messages.direction, 'inbound')));
        for (const r of rows) {
            if (Number(r.rank) > CONTEXT_MESSAGES_PER_TASK) continue;
            const list = byConv.get(r.conversationId) ?? [];
            list.push({ id: r.id, content: r.content, type: r.type, mediaUrl: r.mediaUrl, mediaType: r.mediaType, createdAt: r.createdAt });
            byConv.set(r.conversationId, list);
        }
        // Chronological within each thread — the portal reads top-to-bottom like the thread does.
        for (const list of byConv.values()) list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    const open = openRows.map((t) => ({ ...t, context: byConv.get(t.conversationId) ?? [] }));
    return { open, recent };
}
