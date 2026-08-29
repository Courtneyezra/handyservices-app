/**
 * PER-LANE SLA ESCALATION SWEEP (T6b, 29 Aug 2026) — nothing rots silently.
 *
 * Quote-prep's readiness verdicts and flagThreadForBen's needs_ben flags park work on Ben's
 * desk, and until this file nothing noticed a parked thread going stale: the verdict landed,
 * the first ping fired, and if Ben missed it the thread could sit in its lane forever (the
 * "stale-tag aging" gap from the loud-lanes audit). This sweep gives every lane a working-hours
 * SLA and re-pings Ben when a thread sits past it with no movement.
 *
 * Lanes and starting SLAs (config-driven — see DEFAULT_SLA_SWEEP_CONFIG / app_settings
 * 'sla_sweep'):
 *
 *   quote_ready   4 working hours   verdict says price it; no quote sent → ping Ben
 *   needs_ben     2 working hours   flagged question unanswered → ping Ben
 *   needs_info   24 CLOCK hours     customer silent since our questions → canned chase
 *                                   (flag-gated, ships OFF; while off, ping Ben instead)
 *   visit_first  12 working hours   (= 1 working day on the 08:00–20:00 clock) no visit
 *                                   arranged → ping Ben
 *
 * Design rules, each load-bearing:
 *   · IDEMPOTENT AND NON-SPAMMY. The sla_alerts row is the claim: one open episode per
 *     (conversation, lane), enforced by a partial unique index, insert-with-onConflictDoNothing
 *     as the claim (the va_call_tasks pattern — no advisory check-then-act). While a breach
 *     stands, at most one reminder per reminderEveryClockHours, claimed by a CAS on
 *     last_alert_at. The 15-second tick can run this all day without a double ping.
 *   · RESET ON MOVEMENT. A lane change, a quote going out, Ben replying, the conversation
 *     closing — the episode is resolved (Pass A) and can never ghost-alert. Re-entering the
 *     same lane later is a NEW episode pinned by lane_entered_at.
 *   · WORKING-HOURS MATH IS IMPORTED, NOT REWRITTEN. addWorkingHours (promise-tracker, the
 *     same helper behind the VA call task 15-working-minute hold) is the single source of
 *     08:00–20:00 Europe/London arithmetic, day boundaries and DST included.
 *   · QUIET HOURS. The whole sweep defers outside 08:00–20:00 UK (isOutOfHours, the same
 *     boundary every other Ben alert uses) — a breach at 02:00 surfaces at 08:00, and
 *     pushover's own quiet-hours dispatch rules still apply on top.
 *   · THE CUSTOMER CHASE IS CANNED AND GATED. No LLM composition — a fixed template through
 *     queueDraft (GATE 0 opt-out, dedupe) and approveAndSendDraft (the 27 Aug autosend guards,
 *     WhatsApp 24h window / SMS fallback). approvedBy 'comms_agent:sla_chase' deliberately
 *     matches AUTOMATED_APPROVER so the near-duplicate and malformed-reason holds apply.
 *     Ships with customerChase.enabled: false — while off, Ben gets the ping instead.
 *
 * T6a SEAM: quote-prep will grow a 'decline' verdict. To give it an SLA: add a lane branch in
 * detectSlaLane where marked, and a `decline: { workingHours: n }` entry to config.lanes —
 * the alert/reminder machinery is lane-generic and needs no rework.
 *
 * Wired into comms-sweep.ts's fast tick (dynamic import, same as promise-tracker); throttled
 * internally to one pass per 5 minutes because the finest SLA is measured in hours.
 */
import { db } from '../db';
import {
    conversations, messages, messageDrafts, personalizedQuotes, agentQuestions,
    appSettings, slaAlerts,
} from '@shared/schema';
import { and, eq, desc, inArray, isNull, sql } from 'drizzle-orm';
import { addWorkingHours } from './promise-tracker';
import { isOutOfHours } from '../first-contact-ack';
import { emitCommsEvent } from '../comms-events';

/** Live-board push for an SLA breach/reminder — fire-and-forget, never breaks the sweep. */
function emitSlaBoardDelta(conversationId: string): void {
    try {
        emitCommsEvent({ type: 'board_delta', conversationId, reason: 'sla', at: new Date().toISOString() });
    } catch (error: any) {
        console.warn('[SlaSweep] board_delta emit failed (sweep stands):', error?.message);
    }
}

// ---------------------------------------------------------------- config

export type SlaLane = 'quote_ready' | 'needs_ben' | 'needs_info' | 'visit_first' | 'decline';

export interface SlaSweepConfig {
    /** Master switch for the whole sweep (internal pings included). */
    enabled: boolean;
    lanes: {
        quote_ready: { workingHours: number };
        needs_ben: { workingHours: number };
        needs_info: { clockHours: number };   // clock hours, not working — silence is silence
        visit_first: { workingHours: number };
        /** T6a seam — becomes real when quote-prep grows the decline verdict. */
        decline?: { workingHours: number };
    };
    customerChase: {
        /** SHIPS OFF. While off, a needs_info breach pings Ben instead of messaging anyone. */
        enabled: boolean;
        /** The canned chase — fixed wording, never LLM-composed. */
        template: string;
    };
    /** While a breach stands, at most one reminder per this many clock hours. */
    reminderEveryClockHours: number;
    /** A lane entry older than this is a pre-deploy fossil, not a live breach — never alert.
     *  Also bounds the first-deploy alert storm and any stale flagged rows. */
    maxLaneAgeDays: number;
}

const SETTING_KEY = 'sla_sweep';

export const DEFAULT_SLA_SWEEP_CONFIG: SlaSweepConfig = {
    // Enabled by default, unlike customer-facing config: this sweep's default action is an
    // INTERNAL ping (promise-tracker's overdue flag has no switch at all). The one
    // customer-facing behaviour has its own flag below, shipped OFF.
    enabled: true,
    lanes: {
        quote_ready: { workingHours: 4 },
        needs_ben: { workingHours: 2 },
        needs_info: { clockHours: 24 },
        visit_first: { workingHours: 12 }, // one working day on the 08:00–20:00 clock
    },
    customerChase: {
        enabled: false,
        template: 'Hi — just checking in. We asked a couple of questions about your job and '
            + "haven't heard back, so wanted to make sure the messages reached you. No rush at "
            + 'all — a quick reply whenever suits and we can get your price over to you.',
    },
    reminderEveryClockHours: 24,
    maxLaneAgeDays: 14,
};

function mergeConfig(base: SlaSweepConfig, patch: Partial<SlaSweepConfig>): SlaSweepConfig {
    return {
        ...base, ...patch,
        lanes: { ...base.lanes, ...(patch.lanes ?? {}) },
        customerChase: { ...base.customerChase, ...(patch.customerChase ?? {}) },
    };
}

export async function getSlaSweepConfig(): Promise<SlaSweepConfig> {
    // Test isolation: a suite process sets SLA_CONFIG_OVERRIDE (JSON) instead of writing the
    // shared app_settings row — same seam as COMMS_CONFIG_OVERRIDE in comms.ts.
    const override = process.env.SLA_CONFIG_OVERRIDE;
    if (override) {
        try {
            return mergeConfig(DEFAULT_SLA_SWEEP_CONFIG, JSON.parse(override) as Partial<SlaSweepConfig>);
        } catch {
            console.error('[SlaSweep] Bad SLA_CONFIG_OVERRIDE JSON, falling through to DB config');
        }
    }
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY));
        if (!row) return DEFAULT_SLA_SWEEP_CONFIG;
        return mergeConfig(DEFAULT_SLA_SWEEP_CONFIG, row.value as Partial<SlaSweepConfig>);
    } catch (error) {
        console.error('[SlaSweep] Could not read config, treating as disabled:', error);
        return { ...DEFAULT_SLA_SWEEP_CONFIG, enabled: false }; // fail closed
    }
}

export async function setSlaSweepConfig(patch: Partial<SlaSweepConfig>): Promise<SlaSweepConfig> {
    const next = mergeConfig(await getSlaSweepConfig(), patch);
    await db.insert(appSettings)
        .values({
            id: SETTING_KEY, key: SETTING_KEY, value: next,
            description: 'Per-lane SLA escalation sweep (see server/agents/sla-sweep.ts)',
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
    return next;
}

// ---------------------------------------------------------------- movement detection
//
// "Movement" mirrors promise-tracker's fulfilmentSince (private there, so re-stated here with
// the same semantics): an outbound carrying a quote link, a quote ROW created for the number
// (belt for links sent out-of-thread), or a HUMAN outbound — an outbound whose text none of
// the agent's sent drafts carried is Ben typing. Quarantined rows and 'call'/'note' channel
// rows never count as customer-visible messages.

function digitsOf(waKey: string): string {
    return waKey.replace('@c.us', '').replace(/\D/g, '');
}

async function agentSentParts(phone: string): Promise<Set<string>> {
    const rows = await db.select({ body: messageDrafts.body }).from(messageDrafts)
        .where(and(
            eq(messageDrafts.phone, phone),
            eq(messageDrafts.source, 'comms_agent'),
            inArray(messageDrafts.status, ['sent', 'approved']),
        ));
    return new Set(
        rows.flatMap((d) => d.body.split(/\n\s*---\s*\n/)).map((p) => p.trim()).filter(Boolean),
    );
}

async function realOutboundSince(conversationId: string, since: Date) {
    const rows = await db.select({
        content: messages.content, channel: messages.channel, quarantinedAt: messages.quarantinedAt,
    }).from(messages)
        .where(and(
            eq(messages.conversationId, conversationId),
            eq(messages.direction, 'outbound'),
            sql`${messages.createdAt} > ${since.toISOString()}::timestamptz`,
        ))
        .orderBy(desc(messages.createdAt)).limit(20);
    return rows.filter((m) => !m.quarantinedAt && m.channel !== 'call' && m.channel !== 'note');
}

async function quoteWentOutSince(conversationId: string, digits: string, since: Date): Promise<boolean> {
    const out = await realOutboundSince(conversationId, since);
    if (out.some((m) => /\/quote\//i.test(m.content ?? ''))) return true;
    const [q] = await db.select({ id: personalizedQuotes.id }).from(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digits}
            AND ${personalizedQuotes.createdAt} > ${since.toISOString()}::timestamptz`)
        .limit(1);
    return !!q;
}

async function humanOutboundSince(conversationId: string, phone: string, since: Date): Promise<boolean> {
    const out = await realOutboundSince(conversationId, since);
    if (!out.length) return false;
    const parts = await agentSentParts(phone);
    return out.some((m) => {
        const t = (m.content ?? '').trim();
        return !!t && !parts.has(t);
    });
}

async function callSince(conversationId: string, since: Date): Promise<boolean> {
    const [row] = await db.select({ id: messages.id }).from(messages)
        .where(and(
            eq(messages.conversationId, conversationId),
            eq(messages.channel, 'call'),
            sql`${messages.createdAt} > ${since.toISOString()}::timestamptz`,
        )).limit(1);
    return !!row;
}

// ---------------------------------------------------------------- lane detection

export interface DetectedLane {
    lane: Exclude<SlaLane, 'decline'>;
    /** When the thread ENTERED the lane — the SLA clock's zero. */
    enteredAt: Date;
    /** One line of context for the alert note. */
    detail: string;
}

interface ConvRow {
    id: string;
    phoneNumber: string;
    contactName: string | null;
    tags: string[] | null;
    metadata: unknown;
}

/**
 * Which SLA lane (if any) this conversation is sitting in RIGHT NOW, and since when.
 * One lane per thread, checked in precedence order: a flagged needs_ben question is the most
 * specific "waiting on Ben" state, then the quote-prep verdict lanes. Returns null when the
 * thread is in no lane or the lane already saw movement (which is also how Pass A learns an
 * open episode should resolve).
 */
export async function detectSlaLane(conv: ConvRow): Promise<DetectedLane | null> {
    const digits = digitsOf(conv.phoneNumber);
    const phone = `+${digits}`;
    const tags = conv.tags ?? [];
    const meta = (conv.metadata ?? {}) as Record<string, any>;

    // 1) needs_ben — a flagged question is waiting on him. flagThreadForBen writes the
    // agent_questions row status 'flagged' and nothing ever consumes it, so movement is judged
    // from the THREAD: Ben replying or a quote going out since the flag means he acted, and the
    // stale flag must not breach — fall through to the verdict lanes instead.
    if (tags.includes('needs_ben')) {
        const [flag] = await db.select({ createdAt: agentQuestions.createdAt, question: agentQuestions.question })
            .from(agentQuestions)
            .where(and(eq(agentQuestions.conversationId, conv.id), eq(agentQuestions.status, 'flagged')))
            .orderBy(desc(agentQuestions.createdAt)).limit(1);
        if (flag?.createdAt) {
            const enteredAt = new Date(flag.createdAt);
            const moved = await humanOutboundSince(conv.id, phone, enteredAt)
                || await quoteWentOutSince(conv.id, digits, enteredAt);
            if (!moved) {
                return { lane: 'needs_ben', enteredAt, detail: (flag.question ?? '').slice(0, 160) };
            }
        }
    }

    const readiness = meta.quotePrepIntake?.readiness as string | undefined;
    const lastRunAtRaw = meta.quotePrepAuto?.lastRunAt as string | undefined;
    const lastRunAt = lastRunAtRaw ? new Date(lastRunAtRaw) : null;
    if (!readiness || !lastRunAt || Number.isNaN(lastRunAt.getTime())) return null;

    // 2) quote_ready — ready to price, resolved only by a quote actually going out.
    if (readiness === 'quote_ready') {
        if (await quoteWentOutSince(conv.id, digits, lastRunAt)) return null;
        return {
            lane: 'quote_ready', enteredAt: lastRunAt,
            detail: 'quote-prep marked this ready to price and no quote has gone out',
        };
    }

    // 3) visit_first — resolved by a quote, a human reply (Ben arranging), or a call happening.
    if (readiness === 'visit_first') {
        if (await quoteWentOutSince(conv.id, digits, lastRunAt)) return null;
        if (await humanOutboundSince(conv.id, phone, lastRunAt)) return null;
        if (await callSince(conv.id, lastRunAt)) return null;
        return {
            lane: 'visit_first', enteredAt: lastRunAt,
            detail: 'verdict was visit-first and no visit has been arranged',
        };
    }

    // 4) needs_info — only while the customer is SILENT: the newest real message must be ours
    // (our questions). An inbound since means they answered and quote-prep owes a re-run — no
    // SLA lane. Clock zero is when the questions actually reached them (the newest outbound),
    // or the verdict if that is newer (re-run without a new send).
    if (readiness === 'needs_info') {
        const recent = await db.select({
            direction: messages.direction, channel: messages.channel,
            quarantinedAt: messages.quarantinedAt, createdAt: messages.createdAt,
        }).from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(desc(messages.createdAt)).limit(15);
        const real = recent.filter((m) => !m.quarantinedAt && m.channel !== 'call' && m.channel !== 'note');
        const last = real[0];
        if (!last?.createdAt || last.direction !== 'outbound') return null;
        const outAt = new Date(last.createdAt);
        const enteredAt = outAt.getTime() > lastRunAt.getTime() ? outAt : lastRunAt;
        return { lane: 'needs_info', enteredAt, detail: 'customer silent since our questions' };
    }

    // T6a SEAM: `if (readiness === 'decline') { ... }` goes here, with cfg.lanes.decline.
    return null;
}

// ---------------------------------------------------------------- alerts

export interface SlaBreachAlertArgs {
    customerName?: string | null;
    phoneNumber?: string | null;
    note: string;
    conversationId: string;
}

/** Default Ben ping — the existing escalation event (deep-links the thread; pushover's own
 *  quiet-hours dispatch rules apply). Dynamic import: pushover is T2's file, reuse only. */
async function defaultNotify(alert: SlaBreachAlertArgs): Promise<void> {
    const { notifyEscalation } = await import('../pushover');
    await notifyEscalation(alert);
}

export type ChaseOutcome = 'sent' | 'queued' | 'suppressed';

/**
 * The canned customer chase, through the SAME rails as every other automated send: queueDraft
 * (GATE 0 opt-out, source dedupe) then approveAndSendDraft with an AUTOMATED_APPROVER-matching
 * approver, so the 27 Aug guards (near-duplicate, malformed-reason, 24h window / SMS fallback)
 * all apply. 'queued' means a guard held it for a human — that is the guard working, not a
 * failure. 'suppressed' means it never became a draft (opt-out / duplicate pending).
 */
async function defaultChase(args: { conversationId: string; phone: string; body: string }): Promise<ChaseOutcome> {
    const { queueDraft, approveAndSendDraft } = await import('../message-drafts');
    const draftId = await queueDraft({
        phone: args.phone,
        body: args.body,
        source: 'comms_agent',
        reason: '[sla_chase] needs_info: customer silent past the SLA, sending the canned no-reply chase',
        dedupe: true,
    });
    if (!draftId) return 'suppressed';
    const sent = await approveAndSendDraft(draftId, 'comms_agent:sla_chase');
    return sent.ok ? 'sent' : 'queued';
}

function laneNote(det: DetectedLane, cfg: SlaSweepConfig): string {
    const when = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
    }).format(det.enteredAt);
    switch (det.lane) {
        case 'quote_ready':
            return `Quote ready and still unpriced: the verdict landed ${when} (UK) and no quote has `
                + `gone out — past the ${cfg.lanes.quote_ready.workingHours}-working-hour SLA. Price it up and send.`;
        case 'needs_ben':
            return `Still waiting on you since ${when} (UK) — past the ${cfg.lanes.needs_ben.workingHours}-working-hour `
                + `SLA. The open flag: "${det.detail}"`;
        case 'needs_info':
            return `We asked the customer questions and they have been silent since ${when} (UK) — past the `
                + `${cfg.lanes.needs_info.clockHours}-hour SLA.`;
        case 'visit_first':
            return `Visit-first verdict at ${when} (UK) and no visit has been arranged — past the `
                + `${cfg.lanes.visit_first.workingHours}-working-hour SLA. Get a survey visit in the diary.`;
    }
}

// ---------------------------------------------------------------- the sweep

/** Same tolerance problem as any timestamp round-trip: metadata ISO strings carry millis, DB
 *  timestamps carry micros — treat entries within 1.5s as the same lane entry. */
const ENTERED_AT_TOLERANCE_MS = 1500;

function ukHourOf(d: Date): number {
    return Number(new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric', hour12: false, timeZone: 'Europe/London',
    }).format(d));
}

export interface SlaSweepResult {
    /** True when the pass ran outside working hours and deferred entirely. */
    deferred: boolean;
    /** True when the internal 5-minute throttle skipped this tick (production only). */
    throttled: boolean;
    scanned: number;
    alerted: number;   // first alerts (new episodes)
    reminded: number;  // daily reminders on standing breaches
    resolved: number;  // episodes closed (lane changed / re-entered / conversation closed)
    chased: number;    // customer chases attempted (flag ON only)
}

// The fast tick fires every 15s; the finest SLA is measured in hours. One pass per 5 minutes
// is plenty and keeps the candidate scan off the hot path. Bypassed whenever `now` is injected
// (tests), so fixed-instant suites are never at the mercy of module state.
const PASS_MIN_INTERVAL_MS = 5 * 60_000;
let lastPassAt = 0;

/**
 * THE SWEEP. Pass A resolves open alert episodes whose lane no longer holds (movement, lane
 * change, conversation closed) so nothing ghost-alerts; Pass B detects lanes on candidate
 * conversations, computes dueAt with the shared working-hours clock, and claims + fires at
 * most 3 alert actions per pass (the queue drains across passes, never in one burst).
 *
 * `notify`, `chase`, `now` and `scopeConversationIds` are test seams: the suite injects a
 * collector, fixed instants, and its own fixture conversations so a run against the shared DB
 * can neither ping a real phone nor consume a real thread's first-breach alert.
 */
export async function sweepSlaBreaches(opts?: {
    now?: Date;
    notify?: (alert: SlaBreachAlertArgs) => Promise<void>;
    chase?: (args: { conversationId: string; phone: string; body: string }) => Promise<ChaseOutcome>;
    scopeConversationIds?: string[];
}): Promise<SlaSweepResult> {
    const res: SlaSweepResult = {
        deferred: false, throttled: false, scanned: 0, alerted: 0, reminded: 0, resolved: 0, chased: 0,
    };
    if (!opts?.now) {
        if (Date.now() - lastPassAt < PASS_MIN_INTERVAL_MS) {
            res.throttled = true;
            return res;
        }
        lastPassAt = Date.now();
    }

    const cfg = await getSlaSweepConfig();
    if (!cfg.enabled) return res;

    const now = opts?.now ?? new Date();
    // No 2am re-pings: breaches accrued overnight surface at 08:00. (Working-hour SLAs cannot
    // breach overnight anyway — the clock is paused — but the needs_info clock-hour lane can.)
    if (isOutOfHours(ukHourOf(now))) {
        res.deferred = true;
        return res;
    }

    const notify = opts?.notify ?? defaultNotify;
    const chase = opts?.chase ?? defaultChase;
    const scope = opts?.scopeConversationIds;

    // ---- Pass A: resolve episodes that no longer hold, so nothing ghost-alerts.
    const open = await db.select().from(slaAlerts)
        .where(and(
            isNull(slaAlerts.resolvedAt),
            ...(scope ? [inArray(slaAlerts.conversationId, scope)] : []),
        ))
        .limit(50);
    for (const row of open) {
        try {
            const [conv] = await db.select({
                id: conversations.id, phoneNumber: conversations.phoneNumber,
                contactName: conversations.contactName, tags: conversations.tags,
                metadata: conversations.metadata, archivedAt: conversations.archivedAt,
                stage: conversations.stage,
            }).from(conversations).where(eq(conversations.id, row.conversationId));

            let reason: string | null = null;
            if (!conv) reason = 'conversation_gone';
            else if (conv.archivedAt || conv.stage === 'closed' || conv.stage === 'won') reason = 'conversation_closed';
            else {
                const det = await detectSlaLane(conv);
                if (!det || det.lane !== row.lane) reason = 'lane_changed';
                else if (Math.abs(det.enteredAt.getTime() - new Date(row.laneEnteredAt).getTime()) > ENTERED_AT_TOLERANCE_MS) {
                    reason = 'lane_reentered';
                }
            }
            if (reason) {
                await db.update(slaAlerts)
                    .set({ resolvedAt: now, resolveReason: reason })
                    .where(and(eq(slaAlerts.id, row.id), isNull(slaAlerts.resolvedAt)));
                res.resolved++;
                console.log(`[SlaSweep] Resolved ${row.lane} episode on ${row.conversationId}: ${reason}`);
            }
        } catch (error: any) {
            console.error(`[SlaSweep] Resolution pass failed for alert ${row.id} (stands, will retry):`, error?.message);
        }
    }

    // ---- Pass B: detect lanes, compute dueAt, claim + alert (3 actions per pass, max).
    const candidates = await db.select({
        id: conversations.id, phoneNumber: conversations.phoneNumber,
        contactName: conversations.contactName, tags: conversations.tags,
        metadata: conversations.metadata,
    }).from(conversations)
        .where(and(
            isNull(conversations.archivedAt),
            sql`(${conversations.stage} IS NULL OR ${conversations.stage} NOT IN ('closed', 'won'))`,
            sql`(${conversations.metadata}->'quotePrepIntake'->>'readiness' IS NOT NULL OR 'needs_ben' = ANY(${conversations.tags}))`,
            ...(scope ? [inArray(conversations.id, scope)] : []),
        ))
        .limit(100);
    res.scanned = candidates.length;

    let acted = 0;
    for (const conv of candidates) {
        if (acted >= 3) break;
        try {
            const det = await detectSlaLane(conv);
            if (!det) continue;
            if (now.getTime() - det.enteredAt.getTime() > cfg.maxLaneAgeDays * 86_400_000) continue; // fossil, not a live breach

            const dueAt = det.lane === 'needs_info'
                ? new Date(det.enteredAt.getTime() + cfg.lanes.needs_info.clockHours * 3_600_000)
                : addWorkingHours(det.enteredAt, cfg.lanes[det.lane].workingHours);
            if (now.getTime() < dueAt.getTime()) continue;

            const digits = digitsOf(conv.phoneNumber);
            const phone = `+${digits}`;

            const [openRow] = await db.select().from(slaAlerts)
                .where(and(
                    eq(slaAlerts.conversationId, conv.id),
                    eq(slaAlerts.lane, det.lane),
                    isNull(slaAlerts.resolvedAt),
                )).limit(1);

            if (openRow && Math.abs(new Date(openRow.laneEnteredAt).getTime() - det.enteredAt.getTime()) <= ENTERED_AT_TOLERANCE_MS) {
                // Already alerted this episode → at most one reminder per reminderEveryClockHours,
                // claimed by CAS on last_alert_at so two racing passes cannot both remind.
                if (now.getTime() - new Date(openRow.lastAlertAt).getTime() < cfg.reminderEveryClockHours * 3_600_000) continue;
                const [claimed] = await db.update(slaAlerts)
                    .set({ lastAlertAt: now, alertCount: openRow.alertCount + 1 })
                    .where(and(
                        eq(slaAlerts.id, openRow.id),
                        eq(slaAlerts.lastAlertAt, openRow.lastAlertAt),
                        isNull(slaAlerts.resolvedAt),
                    ))
                    .returning();
                if (!claimed) continue;
                acted++;
                res.reminded++;
                emitSlaBoardDelta(conv.id);
                await notify({
                    customerName: conv.contactName,
                    phoneNumber: phone,
                    note: `Daily SLA reminder #${openRow.alertCount + 1}: ${laneNote(det, cfg)}`,
                    conversationId: conv.id,
                });
                continue;
            }

            if (openRow) {
                // Same lane, NEW entry — close the old episode, a fresh claim follows below.
                await db.update(slaAlerts)
                    .set({ resolvedAt: now, resolveReason: 'lane_reentered' })
                    .where(and(eq(slaAlerts.id, openRow.id), isNull(slaAlerts.resolvedAt)));
                res.resolved++;
            }

            // The claim IS the insert: the partial unique index makes a racing pass lose
            // quietly (no row back → someone else owns the alert). No check-then-act.
            const [claim] = await db.insert(slaAlerts).values({
                conversationId: conv.id,
                lane: det.lane,
                laneEnteredAt: det.enteredAt,
                firstAlertAt: now,
                lastAlertAt: now,
                alertCount: 1,
            }).onConflictDoNothing().returning();
            if (!claim) continue;
            acted++;
            res.alerted++;
            emitSlaBoardDelta(conv.id);

            if (det.lane === 'needs_info' && cfg.customerChase.enabled) {
                const outcome = await chase({ conversationId: conv.id, phone, body: cfg.customerChase.template });
                res.chased++;
                console.log(`[SlaSweep] needs_info breach on ${conv.id}: customer chase ${outcome}.`);
                if (outcome === 'suppressed') {
                    // Never silently swallowed: if the chase could not even become a draft,
                    // Ben gets the ping this episode would otherwise have been.
                    await notify({
                        customerName: conv.contactName,
                        phoneNumber: phone,
                        note: `SLA breach: ${laneNote(det, cfg)} The automatic chase was suppressed (opt-out or a `
                            + 'pending draft already exists), so this ping is instead.',
                        conversationId: conv.id,
                    });
                }
            } else {
                const offNote = det.lane === 'needs_info'
                    ? ' The automatic chase is switched off, so nudge them yourself or park the thread.'
                    : '';
                await notify({
                    customerName: conv.contactName,
                    phoneNumber: phone,
                    note: `SLA breach: ${laneNote(det, cfg)}${offNote}`,
                    conversationId: conv.id,
                });
            }
            console.log(`[SlaSweep] ${det.lane} breach alerted on ${conv.id} (entered ${det.enteredAt.toISOString()}, due ${dueAt.toISOString()}).`);
        } catch (error: any) {
            console.error(`[SlaSweep] Breach pass failed for ${conv.id} (will retry next pass):`, error?.message);
        }
    }

    return res;
}
