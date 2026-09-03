/**
 * The comms ledger — WRITE-AT-SOURCE (Phase 1 of the comms rebuild, 2 Sep 2026).
 *
 * COMMS_AGENTS_V3_DESIGN §3.7 and principle 6: "every send is a ledger event with a run id; if it
 * is not in the ledger it did not happen." Until Phase 1 the ledger was only ever DERIVED — a sync
 * (server/comms-ledger.ts) re-read messages, calls and drafts and wrote events after the fact. Now
 * the exit (`sendCustomerMessage`), the draft functions, the flag function and the agent runner
 * append their own events the moment the thing happens, and the sync is demoted to backfill plus
 * a drift check (`ledgerDriftCheck`) that proves the two agree.
 *
 * Contract:
 *   - `appendEvent` NEVER throws. A bookkeeping failure must not cost a customer their reply, so
 *     every helper here catches, logs, and returns `{ inserted:false }`.
 *   - Idempotent on (ref_table, ref_id, event_type) — the existing unique index. Writing the same
 *     event twice (a retry, the backfill running over a live row) is a no-op, which is exactly why
 *     the write-at-source and the derive-from-source paths can coexist on one table: whichever
 *     lands first wins, and the other converges silently.
 *   - The db is injectable so the idempotency contract is unit-testable without Postgres.
 */
import { db as liveDb } from './db';
import { commsEvents, agentQuestions, users } from '@shared/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const LEDGER_EVENT_TYPES = [
    'message_in', 'message_out', 'call_in', 'call_out',
    'draft_created', 'draft_approved', 'draft_edited', 'draft_sent', 'draft_rejected', 'draft_failed',
    'flag_raised', 'flag_closed', 'flag_expired',
    'run_started', 'run_finished',
    'run_decided',       // Phase 2: the spine's decision for a run (send | pending | flag | drop | none)
    'sample_reviewed',
    'quote_held',        // P12: Ben held a priced draft (asked her first / offered a visit) from the price screen
    'call_requested',    // P12: Ben tapped "Call her" on the price screen; the phone does the call
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export type LedgerChannel = 'whatsapp' | 'sms' | 'call' | 'webform' | 'email' | 'note' | 'system';

export interface LedgerEventInput {
    eventType: LedgerEventType;
    /** When it happened. Defaults to now. */
    occurredAt?: Date | null;
    channel?: LedgerChannel | string | null;
    /** E.164 when known. '' is the ledger's "no counterparty" value (a fleet-wide run, say). */
    phone?: string | null;
    roleProfile?: string | null;
    conversationId?: string | null;
    jobRef?: string | null;
    /** Who caused it: counterparty | agent:<name> | human:<id> | system:<name>. */
    actor: string;
    draftedBy?: string | null;
    editedBy?: string | null;
    sentBy?: string | null;
    body?: string | null;
    refTable: string;
    refId: string;
    runId?: string | null;
    meta?: Record<string, unknown> | null;
}

export interface AppendResult {
    inserted: boolean;
    id: string | null;
    /** Present only when the insert threw; the event was NOT recorded. */
    error?: string;
}

/** The one db capability the ledger needs — injectable for tests. */
export interface LedgerDb {
    insert: typeof liveDb.insert;
}

// ---------------------------------------------------------------- attribution vocabulary

/** Numbers that are "us": events on them are internal plumbing, not counterparty traffic. */
export const INTERNAL_DIGITS = new Set([
    '447449501762', // business WhatsApp sender
    '447508744402', // Ben's personal number (dark-channel capture pending)
]);

export function digitsOf(phone: string | null | undefined): string {
    return (phone ?? '').replace('@c.us', '').replace(/\D/g, '');
}

export function e164Of(phone: string | null | undefined): string {
    const d = digitsOf(phone);
    return d ? `+${d}` : '';
}

/** Actor for a draft's author, from message_drafts.source. */
export function actorFromDraftSource(source: string | null | undefined): string {
    if (!source) return 'system:unknown';
    if (source === 'comms_agent') return 'agent:comms';
    if (source === 'spine') return 'agent:spine';
    if (source.startsWith('spine:')) return `agent:${source.slice('spine:'.length)}`;
    return `system:${source}`;
}

/**
 * Actor for whoever released a draft, from the stored approver (Phase 0 enum values first, then
 * the prefixes older rows still carry).
 */
export function actorFromApprovedBy(approvedBy: string | null | undefined): string | null {
    if (!approvedBy) return null;
    if (approvedBy.startsWith('human:')) return approvedBy;
    if (approvedBy.startsWith('agent.comms')) return 'agent:comms';
    if (approvedBy.startsWith('agent.')) return `agent:${approvedBy.slice('agent.'.length)}`;
    if (approvedBy === 'rules.first_contact') return 'system:first_contact_ack';
    if (approvedBy.startsWith('rules.') || approvedBy.startsWith('system.')) return `system:${approvedBy.replace(/^(rules|system)\./, '')}`;
    if (approvedBy.startsWith('comms_agent')) return 'agent:comms';
    if (approvedBy.startsWith('first_contact_ack')) return 'system:first_contact_ack';
    if (approvedBy === 'stale_sweep') return 'system:stale_sweep';
    return `human:${approvedBy}`;
}

let contractorCache: { at: number; digits: Set<string> } | null = null;
const CONTRACTOR_CACHE_MS = 60_000;

/** customer | contractor | internal for a phone. Cached a minute; a miss defaults to customer. */
export async function roleProfileFor(phone: string | null | undefined, dbc: { select: typeof liveDb.select } = liveDb): Promise<string> {
    const d = digitsOf(phone);
    if (!d) return 'internal';
    if (INTERNAL_DIGITS.has(d)) return 'internal';
    try {
        if (!contractorCache || Date.now() - contractorCache.at > CONTRACTOR_CACHE_MS) {
            const rows = await dbc.select({ phone: users.phone }).from(users).where(eq(users.role, 'contractor'));
            contractorCache = { at: Date.now(), digits: new Set(rows.map((r) => digitsOf(r.phone)).filter(Boolean)) };
        }
        return contractorCache.digits.has(d) ? 'contractor' : 'customer';
    } catch {
        return 'customer';
    }
}

// ---------------------------------------------------------------- the one write

/**
 * Append one event. Idempotent on (ref_table, ref_id, event_type); never throws.
 */
export async function appendEvent(e: LedgerEventInput, deps: { db?: LedgerDb } = {}): Promise<AppendResult> {
    const dbc = deps.db ?? liveDb;
    const id = randomUUID();
    try {
        const rows = await dbc.insert(commsEvents).values({
            id,
            occurredAt: e.occurredAt ?? new Date(),
            eventType: e.eventType,
            channel: e.channel ?? 'system',
            phone: e164Of(e.phone),
            roleProfile: e.roleProfile ?? 'customer',
            conversationId: e.conversationId ?? null,
            jobRef: e.jobRef ?? null,
            actor: e.actor,
            draftedBy: e.draftedBy ?? null,
            editedBy: e.editedBy ?? null,
            sentBy: e.sentBy ?? null,
            body: e.body ?? null,
            refTable: e.refTable,
            refId: e.refId,
            runId: e.runId ?? null,
            meta: e.meta ?? null,
        }).onConflictDoNothing().returning({ id: commsEvents.id });
        return { inserted: rows.length > 0, id: rows[0]?.id ?? null };
    } catch (error: any) {
        console.warn(`[Ledger] ${e.eventType} on ${e.refTable}/${e.refId} not recorded:`, error?.message ?? error);
        return { inserted: false, id: null, error: error?.message ?? String(error) };
    }
}

// ---------------------------------------------------------------- typed helpers

export interface DraftLike {
    id: string;
    phone: string;
    conversationId?: string | null;
    channel?: string | null;
    body: string;
    source: string;
    reason?: string | null;
    runId?: string | null;
    createdAt?: Date | null;
}

export async function ledgerDraftCreated(d: DraftLike & { runId?: string | null }): Promise<AppendResult> {
    return appendEvent({
        eventType: 'draft_created', occurredAt: d.createdAt ?? new Date(), channel: d.channel ?? 'whatsapp',
        phone: d.phone, roleProfile: await roleProfileFor(d.phone), conversationId: d.conversationId ?? null,
        actor: actorFromDraftSource(d.source), draftedBy: actorFromDraftSource(d.source), body: d.body,
        refTable: 'message_drafts', refId: d.id, runId: d.runId ?? null,
        meta: { source: d.source, reason: d.reason ?? undefined },
    });
}

export async function ledgerDraftApproved(a: { draft: DraftLike; approver: string; runId?: string | null }): Promise<AppendResult> {
    const { draft } = a;
    const actor = actorFromApprovedBy(a.approver) ?? 'system:unknown';
    return appendEvent({
        eventType: 'draft_approved', channel: draft.channel ?? 'whatsapp', phone: draft.phone,
        roleProfile: await roleProfileFor(draft.phone), conversationId: draft.conversationId ?? null,
        actor, draftedBy: actorFromDraftSource(draft.source), sentBy: actor, body: draft.body,
        refTable: 'message_drafts', refId: draft.id, runId: a.runId ?? draft.runId ?? null,
        meta: { source: draft.source, approver: a.approver },
    });
}

/** Recorded once per draft (the first edit); `meta.previousBody` is what the author wrote. */
export async function ledgerDraftEdited(a: { draft: DraftLike; editedBy: string; previousBody: string | null; runId?: string | null }): Promise<AppendResult> {
    const { draft } = a;
    return appendEvent({
        eventType: 'draft_edited', channel: draft.channel ?? 'whatsapp', phone: draft.phone,
        roleProfile: await roleProfileFor(draft.phone), conversationId: draft.conversationId ?? null,
        actor: a.editedBy, draftedBy: actorFromDraftSource(draft.source), editedBy: a.editedBy, body: draft.body,
        refTable: 'message_drafts', refId: draft.id, runId: a.runId ?? draft.runId ?? null,
        meta: { source: draft.source, previousBody: a.previousBody ?? undefined },
    });
}

export async function ledgerDraftSent(a: {
    draftId: string; phone: string; conversationId?: string | null; channel?: string | null; body?: string | null;
    source?: string | null; approver?: string | null; sentMessageId?: string | null; runId?: string | null; occurredAt?: Date;
}): Promise<AppendResult> {
    const sentBy = actorFromApprovedBy(a.approver);
    const draftedBy = a.source ? actorFromDraftSource(a.source) : null;
    return appendEvent({
        eventType: 'draft_sent', occurredAt: a.occurredAt ?? new Date(), channel: a.channel ?? 'whatsapp',
        phone: a.phone, roleProfile: await roleProfileFor(a.phone), conversationId: a.conversationId ?? null,
        actor: sentBy ?? draftedBy ?? 'system:unknown', draftedBy, sentBy, body: a.body ?? null,
        refTable: 'message_drafts', refId: a.draftId, runId: a.runId ?? null,
        meta: { source: a.source ?? undefined, sentMessageId: a.sentMessageId ?? undefined },
    });
}

export async function ledgerDraftRejected(a: { draft: DraftLike; decidedBy: string; reason?: string | null; runId?: string | null }): Promise<AppendResult> {
    const { draft } = a;
    return appendEvent({
        eventType: 'draft_rejected', channel: draft.channel ?? 'whatsapp', phone: draft.phone,
        roleProfile: await roleProfileFor(draft.phone), conversationId: draft.conversationId ?? null,
        actor: a.decidedBy, draftedBy: actorFromDraftSource(draft.source), body: draft.body,
        refTable: 'message_drafts', refId: draft.id, runId: a.runId ?? draft.runId ?? null,
        meta: { source: draft.source, reason: a.reason ?? undefined },
    });
}

export async function ledgerDraftFailed(a: { draft: DraftLike; approver?: string | null; error?: string | null; runId?: string | null }): Promise<AppendResult> {
    const { draft } = a;
    return appendEvent({
        eventType: 'draft_failed', channel: draft.channel ?? 'whatsapp', phone: draft.phone,
        roleProfile: await roleProfileFor(draft.phone), conversationId: draft.conversationId ?? null,
        actor: actorFromApprovedBy(a.approver) ?? actorFromDraftSource(draft.source), draftedBy: actorFromDraftSource(draft.source), body: draft.body,
        refTable: 'message_drafts', refId: draft.id, runId: a.runId ?? draft.runId ?? null,
        meta: { source: draft.source, error: a.error ?? undefined },
    });
}

/** An outbound message that actually left. `messageId` is the messages row id (= Twilio SID on both pipes). */
export async function ledgerMessageOut(a: {
    messageId: string; phone: string; conversationId?: string | null; channel: string; body?: string | null;
    approver: string; runId: string; draftId?: string | null; draftSource?: string | null; occurredAt?: Date; context?: string | null;
}): Promise<AppendResult> {
    const sentBy = actorFromApprovedBy(a.approver) ?? 'system:unknown';
    const draftedBy = a.draftSource ? actorFromDraftSource(a.draftSource) : null;
    return appendEvent({
        eventType: 'message_out', occurredAt: a.occurredAt ?? new Date(), channel: a.channel,
        phone: a.phone, roleProfile: await roleProfileFor(a.phone), conversationId: a.conversationId ?? null,
        actor: sentBy, draftedBy, sentBy, body: a.body ?? null,
        refTable: 'messages', refId: a.messageId, runId: a.runId,
        meta: { approver: a.approver, draftId: a.draftId ?? undefined, context: a.context ?? undefined },
    });
}

export async function ledgerFlagRaised(a: {
    questionId: string; phone: string; conversationId: string; note: string; source?: string | null; runId?: string | null; actor?: string | null;
}): Promise<AppendResult> {
    return appendEvent({
        eventType: 'flag_raised', channel: 'system', phone: a.phone, roleProfile: await roleProfileFor(a.phone),
        conversationId: a.conversationId, actor: a.actor ?? actorFromDraftSource(a.source ?? 'comms_agent'), body: a.note,
        refTable: 'agent_questions', refId: a.questionId, runId: a.runId ?? null,
        meta: { source: a.source ?? undefined },
    });
}

export async function ledgerFlagClosed(a: {
    questionId: string; phone: string; conversationId: string; closedBy: string; reason?: string | null; runId?: string | null;
}): Promise<AppendResult> {
    return appendEvent({
        eventType: 'flag_closed', channel: 'system', phone: a.phone, roleProfile: await roleProfileFor(a.phone),
        conversationId: a.conversationId, actor: a.closedBy, body: a.reason ?? null,
        refTable: 'agent_questions', refId: a.questionId, runId: a.runId ?? null,
    });
}

export async function ledgerFlagExpired(a: {
    questionId: string; phone: string; conversationId: string; reason?: string | null; runId?: string | null;
}): Promise<AppendResult> {
    return appendEvent({
        eventType: 'flag_expired', channel: 'system', phone: a.phone, roleProfile: await roleProfileFor(a.phone),
        conversationId: a.conversationId, actor: 'system:flag_expiry', body: a.reason ?? null,
        refTable: 'agent_questions', refId: a.questionId, runId: a.runId ?? null,
    });
}

/**
 * Close the newest open flag on a conversation (the audit row flagThreadForBen wrote). The live
 * "Ben is needed" state is the needs_ben tag; call this wherever that tag is cleared.
 */
export async function ledgerFlagClosedForConversation(a: {
    conversationId: string; phone: string; closedBy: string; reason?: string | null; runId?: string | null;
}): Promise<AppendResult> {
    try {
        const [flag] = await liveDb.select({ id: agentQuestions.id })
            .from(agentQuestions)
            .where(and(eq(agentQuestions.conversationId, a.conversationId), eq(agentQuestions.status, 'flagged')))
            .orderBy(desc(agentQuestions.createdAt)).limit(1);
        if (!flag) return { inserted: false, id: null };
        return ledgerFlagClosed({ questionId: flag.id, ...a });
    } catch (error: any) {
        console.warn('[Ledger] flag_closed lookup failed:', error?.message ?? error);
        return { inserted: false, id: null, error: error?.message ?? String(error) };
    }
}

export async function ledgerRunStarted(a: { runId: string; agent: string; trigger?: string | null; conversationId?: string | null; phone?: string | null; model?: string | null }): Promise<AppendResult> {
    return appendEvent({
        eventType: 'run_started', channel: 'system', phone: a.phone ?? '', roleProfile: a.phone ? await roleProfileFor(a.phone) : 'internal',
        conversationId: a.conversationId ?? null, actor: `agent:${a.agent}`,
        refTable: 'agent_runs', refId: a.runId, runId: a.runId,
        meta: { trigger: a.trigger ?? undefined, model: a.model ?? undefined },
    });
}

export async function ledgerRunFinished(a: {
    runId: string; agent: string; conversationId?: string | null; phone?: string | null;
    ok: boolean; error?: string | null; durationMs?: number | null; costPence?: number | null; turns?: number | null;
}): Promise<AppendResult> {
    return appendEvent({
        eventType: 'run_finished', channel: 'system', phone: a.phone ?? '', roleProfile: a.phone ? await roleProfileFor(a.phone) : 'internal',
        conversationId: a.conversationId ?? null, actor: `agent:${a.agent}`, body: a.error ?? null,
        refTable: 'agent_runs', refId: a.runId, runId: a.runId,
        meta: { ok: a.ok, durationMs: a.durationMs ?? undefined, costPence: a.costPence ?? undefined, turns: a.turns ?? undefined },
    });
}

/** Phase 2: one event per spine run naming the decision. Keyed on the run id. */
export async function ledgerRunDecided(a: {
    runId: string; agent: string; conversationId?: string | null; phone?: string | null;
    decision: string; lane?: string | null; intent?: string | null; detail?: Record<string, unknown> | null;
}): Promise<AppendResult> {
    return appendEvent({
        eventType: 'run_decided', channel: 'system', phone: a.phone ?? '', roleProfile: a.phone ? await roleProfileFor(a.phone) : 'internal',
        conversationId: a.conversationId ?? null, actor: `agent:${a.agent}`, body: a.decision,
        refTable: 'agent_runs', refId: a.runId, runId: a.runId,
        meta: { decision: a.decision, lane: a.lane ?? undefined, intent: a.intent ?? undefined, ...(a.detail ?? {}) },
    });
}

// ---------------------------------------------------------------- drift check

export interface LedgerDriftRow {
    source: string;
    /** Rows in the source table inside the window. */
    expected: number;
    /** Matching events in the ledger inside the window. */
    ledger: number;
    delta: number;
}

export interface LedgerDriftReport {
    windowDays: number;
    since: string;
    rows: LedgerDriftRow[];
    totalAbsDelta: number;
    clean: boolean;
}

/**
 * Compare source-table counts with ledger event counts over the last N days. Zero drift is the
 * nightly assertion; a non-zero delta means either a write-at-source site is missing or the
 * backfill has not run. Read-only. Cron wiring is elsewhere (pane B).
 */
export async function ledgerDriftCheck(windowDays = 7): Promise<LedgerDriftReport> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const one = async (q: ReturnType<typeof sql>): Promise<number> => {
        const res: any = await liveDb.execute(q);
        const row = (res.rows ?? res)[0];
        return Number(row?.n ?? 0);
    };
    const ledgerCount = (types: string[]) => one(sql`
        select count(*)::int n from comms_events
        where event_type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)}) and occurred_at >= ${since}`);

    const pairs: [string, Promise<number>, Promise<number>][] = [
        ['messages.inbound',
            one(sql`select count(*)::int n from messages m join conversations c on c.id = m.conversation_id where m.direction = 'inbound' and m.created_at >= ${since}`),
            ledgerCount(['message_in'])],
        ['messages.outbound',
            one(sql`select count(*)::int n from messages m join conversations c on c.id = m.conversation_id where m.direction = 'outbound' and m.created_at >= ${since}`),
            ledgerCount(['message_out'])],
        ['calls',
            one(sql`select count(*)::int n from calls where start_time >= ${since}`),
            ledgerCount(['call_in', 'call_out'])],
        ['message_drafts.created',
            one(sql`select count(*)::int n from message_drafts where created_at >= ${since}`),
            ledgerCount(['draft_created'])],
        ['message_drafts.sent',
            one(sql`select count(*)::int n from message_drafts where status = 'sent' and sent_at >= ${since}`),
            ledgerCount(['draft_sent'])],
        ['message_drafts.rejected',
            one(sql`select count(*)::int n from message_drafts where status = 'rejected' and approved_at >= ${since}`),
            ledgerCount(['draft_rejected'])],
        ['agent_questions.flagged',
            one(sql`select count(*)::int n from agent_questions where status = 'flagged' and created_at >= ${since}`),
            ledgerCount(['flag_raised'])],
        ['agent_runs.started',
            one(sql`select count(*)::int n from agent_runs where started_at >= ${since}`),
            ledgerCount(['run_started'])],
    ];
    const rows: LedgerDriftRow[] = [];
    for (const [source, expectedP, ledgerP] of pairs) {
        const [expected, ledger] = await Promise.all([expectedP, ledgerP]);
        rows.push({ source, expected, ledger, delta: ledger - expected });
    }
    const totalAbsDelta = rows.reduce((s, r) => s + Math.abs(r.delta), 0);
    return { windowDays, since: since.toISOString(), rows, totalAbsDelta, clean: totalAbsDelta === 0 };
}
