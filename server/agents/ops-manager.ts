/**
 * The Ops Manager — Ben's chat-dock chief of staff (Track B, B-WP1).
 *
 * A conversational agent that reads the whole operation (board, pipeline, SLA state, contractor
 * availability, the agent roster) and DELEGATES: it fires the specialist agents (comms, quote
 * prep, recovery, the pipeline sweeper) rather than doing their jobs itself.
 *
 * THE RAILS (non-negotiable, mirrored in the system prompt AND enforced in code):
 *   1. It NEVER sends a message to a customer. There is no send tool. queue_draft is a PROPOSAL —
 *      a message_drafts row in status 'pending' that a human approves. The approve-and-send
 *      helper from message-drafts is deliberately never imported here; grep this file to prove it.
 *   2. Anything involving money amounts, discounts, or date commitments is Ben's alone. The
 *      queue_draft tool runs the full deterministic guard chain (checkDraft) BEFORE any write,
 *      and a violation comes back as a refusal steering the model to flag_for_ben. One carve-out
 *      (Ben-approved 30 Aug 2026): generate_invoice on a COMPLETED job — amounts are computed
 *      from the quote record by generateBalanceInvoice, never chosen by the model, and no
 *      customer is messaged.
 *   3. Prefer delegation. run_comms_agent / run_quote_prep / run_recovery_sweep / run_sla_sweep
 *      exist so the manager coordinates specialists instead of freelancing their work.
 *
 * Entry point: runOpsManagerTurn, conforming to RunOpsManagerTurn in shared/ops-types.ts (the
 * FROZEN Track B contract). The HTTP/session layer (server/ops-manager-routes.ts, B-WP2) owns
 * persistence and SSE relay; this module owns nothing but the run itself.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { conversations, messages, leads, contractorBookingRequests, invoices, type LeadStage } from '@shared/schema';
import { and, desc, eq, notInArray, or, isNull } from 'drizzle-orm';
import type {
    LeanRunStep, QueueDraftToolResult, RunOpsManagerTurn,
} from '@shared/ops-types';
import { runAgent, type AgentTool } from './runner';
import { newRunId } from '../approver';
import { leanTranscriptEvent } from './transcript-lean';
import { runCommsAgent, flagThreadForBen, STAFF as commsStaff } from './comms';
import { isSpineEnabled } from '../spine/config';
import { requestRunOrNull } from '../spine/bridge';
import { runQuotePrep, STAFF as quotePrepStaff } from './quote-prep';
import { runRecovery, STAFF as recoveryStaff } from './recovery';
import { STAFF as opsBriefStaff } from './ops-brief';
import { runPipelineSweep } from '../pipeline-sweeper';
import { listVaCallTasks, maybeCreateVaCallTask, completeVaCallTask, dismissVaCallTask } from './va-call-tasks';
import type { FirstContactChannel } from '../first-contact-ack';
import { loadBoardCards } from '../inbox-board';
import { checkDraft } from './draft-guards';
import { queueDraft } from '../message-drafts';
import { STAGE_SLA_HOURS, getSLAStatus } from '../lead-stage-engine';
import { findBestContractors, checkNetworkAvailability } from '../availability-engine';
import { getCapacityForDates, resolveContractorDay } from '../availability-capacity';
import { generateInvoiceForJob } from '../pipeline/actions';
import {
    listTodaysJobs, listUnassignedJobs, getContractorSchedule, listContractors,
    listOverdueInvoices, listUnbilledCompletedJobs, getMoneySummary,
} from '../pipeline/queries';
import { getCustomerDossier } from '../customer-dossier';
import { createAssignmentProposal } from '../assignment-proposals';

// ---------------------------------------------------------------- constants

/** Most recent session messages fed to the model as prior turns. */
const HISTORY_CAP = 20;
/** Board cards across all columns after trimming — keeps a snapshot inside one tool result. */
const BOARD_CARD_CAP = 60;
const PIPELINE_ROW_CAP = 40;
const THREAD_MESSAGE_CAP = 40;
const TERMINAL_STAGES: LeadStage[] = ['completed', 'lost', 'expired', 'declined'];

// ---------------------------------------------------------------- queue_draft (the ONLY exit)

export interface OpsQueueDraftDeps {
    check: typeof checkDraft;
    queue: typeof queueDraft;
}

/**
 * The ops manager's one path toward a customer, and it is a PROPOSAL: a pending draft a human
 * approves. MANDATORY ORDER — checkDraft runs first, before anything can touch the database;
 * only a clean body reaches queueDraft, with source 'ops_manager'.
 *
 * Deps are injectable so the vitest can prove the ordering with spies rather than trusting the
 * prose. Production callers never pass deps.
 */
export async function opsQueueDraft(
    input: { phone: string; body: string; reason: string },
    deps: OpsQueueDraftDeps = { check: checkDraft, queue: queueDraft },
): Promise<QueueDraftToolResult> {
    const preview = (input.body ?? '').slice(0, 140);

    // 1. THE GUARD CHAIN, FIRST. A violation means no write of any kind happened.
    const violation = deps.check({ body: input.body, intent: 'other', quoteSeen: false });
    if (violation) {
        return {
            draftId: null,
            status: 'refused',
            preview,
            refusal: `${violation.message} Do not retry a reworded version of the same thing. Anything involving money amounts, discounts or date commitments is Ben's decision, not yours: use flag_for_ben with a note explaining what needs deciding.`,
        };
    }

    // 2. Only now may the draft be queued — status 'pending', awaiting a human.
    const draftId = await deps.queue({
        phone: input.phone,
        body: input.body,
        source: 'ops_manager',
        reason: input.reason,
    });
    if (!draftId) {
        return {
            draftId: null,
            status: 'suppressed',
            preview,
            refusal: 'The suppression rails stopped this draft (opted-out number, unparseable phone, or an unsent ops_manager draft already pending for this customer). Nothing was queued.',
        };
    }
    return { draftId, status: 'pending', preview };
}

// ---------------------------------------------------------------- read helpers

/** SLA scan over non-terminal leads: counts per status plus the worst overdue offenders. */
async function slaState() {
    const rows = await db.select({
        id: leads.id,
        customerName: leads.customerName,
        phone: leads.phone,
        stage: leads.stage,
        stageUpdatedAt: leads.stageUpdatedAt,
    }).from(leads).where(or(isNull(leads.stage), notInArray(leads.stage, TERMINAL_STAGES)));

    const counts = { ok: 0, warning: 0, overdue: 0, noSla: 0 };
    const overdue: Array<{ id: string; customerName: string; stage: string; hoursOverdue: number }> = [];
    for (const r of rows) {
        const stage = (r.stage as LeadStage) || 'new_lead';
        const sla = getSLAStatus(stage, r.stageUpdatedAt);
        if (sla.slaHours === null) { counts.noSla++; continue; }
        counts[sla.status === 'overdue' ? 'overdue' : sla.status === 'warning' ? 'warning' : 'ok']++;
        if (sla.status === 'overdue') {
            overdue.push({
                id: r.id,
                customerName: r.customerName,
                stage,
                hoursOverdue: Math.round(-(sla.hoursRemaining ?? 0) * 10) / 10,
            });
        }
    }
    overdue.sort((a, b) => b.hoursOverdue - a.hoursOverdue);
    return {
        slaHoursByStage: STAGE_SLA_HOURS,
        leadsScanned: rows.length,
        counts,
        worstOverdue: overdue.slice(0, 15),
    };
}

// ---------------------------------------------------------------- tools

export function buildTools(ctx: { runId?: string } = {}): AgentTool[] {
    return [
        // ---------- reads ----------
        {
            name: 'get_board_snapshot',
            description: 'The comms Kanban board, trimmed: every column with its cards reduced to essentials (who, stage, priority, whose move, SLA wait, last message). Start here for "what needs attention".',
            input_schema: {
                type: 'object' as const,
                properties: {
                    lane: { type: 'string', enum: ['customer', 'contractor'], description: 'Which lane. Default customer.' },
                },
            },
            run: async (input: { lane?: 'customer' | 'contractor' }) => {
                const board: any = await loadBoardCards({ limit: 300, lane: input.lane ?? 'customer' });
                let remaining = BOARD_CARD_CAP;
                const columns: Record<string, unknown[]> = {};
                for (const stage of board.stages as string[]) {
                    const cards = (board.columns[stage] ?? []) as any[];
                    columns[stage] = cards.slice(0, Math.max(0, remaining)).map((c) => ({
                        conversationId: c.id,
                        contactName: c.contactName,
                        phone: c.displayPhone ?? c.phoneNumber,
                        stage: c.stage,
                        priority: c.priority,
                        tags: c.tags,
                        whoseMove: c.whoseMove,
                        waiting: c.wait ? { severity: c.wait.severity, workingHours: c.wait.waitingWorkingHours, awaitingReply: c.wait.awaitingReply } : null,
                        lastMessagePreview: (c.lastMessagePreview ?? '').slice(0, 120),
                        lastMessageAt: c.lastMessageAt,
                        unreadCount: c.unreadCount,
                        intakeReadiness: c.intakeReadiness ?? null,
                        quoteValueGBP: c.quoteValueGBP ?? null,
                        totalInColumn: cards.length,
                    }));
                    remaining -= (columns[stage] as unknown[]).length;
                }
                return { totals: board.totals, columns, note: `Cards capped at ${BOARD_CARD_CAP} across all columns; totalInColumn on each card gives the real column size.` };
            },
        },
        {
            name: 'get_pipeline_snapshot',
            description: 'The lead pipeline (the funnel behind /admin/pipeline): recent leads for one stage tab, or every non-terminal lead when tab is "all". Each row carries its SLA state.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    tab: { type: 'string', description: `A funnel stage (${Object.keys(STAGE_SLA_HOURS).join(', ')}) or "all" for every non-terminal lead.` },
                },
            },
            run: async (input: { tab?: string }) => {
                const tab = (input.tab ?? 'all').trim();
                const where = tab === 'all'
                    ? or(isNull(leads.stage), notInArray(leads.stage, TERMINAL_STAGES))
                    : eq(leads.stage, tab);
                const rows = await db.select({
                    id: leads.id,
                    customerName: leads.customerName,
                    phone: leads.phone,
                    stage: leads.stage,
                    stageUpdatedAt: leads.stageUpdatedAt,
                    createdAt: leads.createdAt,
                    jobDescription: leads.jobDescription,
                }).from(leads).where(where).orderBy(desc(leads.createdAt)).limit(PIPELINE_ROW_CAP);
                return {
                    tab,
                    count: rows.length,
                    capped: rows.length === PIPELINE_ROW_CAP,
                    leads: rows.map((r) => {
                        const stage = (r.stage as LeadStage) || 'new_lead';
                        const sla = getSLAStatus(stage, r.stageUpdatedAt);
                        return {
                            id: r.id,
                            customerName: r.customerName,
                            phone: r.phone,
                            stage,
                            stageUpdatedAt: r.stageUpdatedAt,
                            createdAt: r.createdAt,
                            job: (r.jobDescription ?? '').slice(0, 120),
                            sla: { status: sla.status, hoursRemaining: sla.hoursRemaining === null ? null : Math.round(sla.hoursRemaining * 10) / 10 },
                        };
                    }),
                };
            },
        },
        {
            name: 'get_thread',
            description: 'One conversation, compact: header (name, phone, stage, priority, tags) plus the most recent messages as text only — no media payloads, just a hasMedia marker.',
            input_schema: {
                type: 'object' as const,
                properties: { conversationId: { type: 'string' } },
                required: ['conversationId'],
            },
            run: async (input: { conversationId: string }) => {
                const [conv] = await db.select().from(conversations).where(eq(conversations.id, input.conversationId));
                if (!conv) throw new Error(`Conversation ${input.conversationId} not found`);
                const rows = await db.select({
                    direction: messages.direction,
                    channel: messages.channel,
                    content: messages.content,
                    mediaType: messages.mediaType,
                    mediaUrl: messages.mediaUrl,
                    createdAt: messages.createdAt,
                }).from(messages)
                    .where(eq(messages.conversationId, conv.id))
                    .orderBy(desc(messages.createdAt))
                    .limit(THREAD_MESSAGE_CAP);
                return {
                    conversationId: conv.id,
                    contactName: conv.contactName,
                    phone: conv.phoneNumber,
                    stage: conv.stage,
                    priority: conv.priority,
                    tags: conv.tags ?? [],
                    lastInboundAt: conv.lastInboundAt,
                    messages: rows.reverse().map((m) => ({
                        direction: m.direction,
                        channel: m.channel,
                        text: (m.content ?? '').slice(0, 300),
                        hasMedia: !!m.mediaUrl,
                        mediaType: m.mediaType ?? null,
                        at: m.createdAt,
                    })),
                };
            },
        },
        {
            name: 'get_contractor_availability',
            description: 'Network capacity for a set of dates (free contractors per day after bookings), optionally one contractor\'s resolved day-by-day availability, and optionally location-ranked contractors when lat/lng are given. READ-ONLY: books nothing, promises nothing.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    dates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD dates (max 14).' },
                    contractorId: { type: 'string', description: 'Optional handyman_profiles.id for a per-contractor day resolution.' },
                    lat: { type: 'number' }, lng: { type: 'number' },
                },
                required: ['dates'],
            },
            run: async (input: { dates: string[]; contractorId?: string; lat?: number; lng?: number }) => {
                const dates = (input.dates ?? []).slice(0, 14);
                if (dates.length === 0) throw new Error('Give at least one YYYY-MM-DD date.');
                const capacity = await getCapacityForDates(dates);
                const out: any = {
                    capacity: dates.map((d) => {
                        const c = capacity.get(d);
                        return c
                            ? { date: d, masterBlocked: c.masterBlocked, available: c.availableContractorIds.length, booked: c.bookedContractorIds.length, free: c.capacity }
                            : { date: d, free: 0 };
                    }),
                };
                if (input.contractorId) {
                    out.contractorDays = await Promise.all(dates.map(async (d) => {
                        const day = await resolveContractorDay(input.contractorId!, d);
                        return { date: d, ...day };
                    }));
                }
                if (typeof input.lat === 'number' && typeof input.lng === 'number') {
                    const ranked = await findBestContractors({ lat: input.lat, lng: input.lng });
                    out.nearestContractors = ranked.slice(0, 5).map((r) => ({
                        contractorId: r.profile.id,
                        name: r.profile.businessName ?? (r.profile as any).name ?? r.profile.id,
                        distanceMiles: Math.round(r.distanceMiles * 10) / 10,
                    }));
                    out.networkAvailability = await checkNetworkAvailability(ranked, dates.map((d) => new Date(`${d}T00:00:00Z`)));
                }
                return out;
            },
        },
        {
            name: 'get_agent_roster',
            description: 'The AI staff directory: every specialist agent, what it does, and its cadence — so you delegate to the right one instead of doing its job yourself.',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => ({
                agents: [commsStaff, quotePrepStaff, recoveryStaff, opsBriefStaff, STAFF].map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    roleTitle: s.roleTitle,
                    cadence: s.cadence,
                    mission: String(s.mission).slice(0, 300),
                })),
            }),
        },
        {
            name: 'get_sla_state',
            description: 'Stage SLA thresholds plus a live breach summary over every non-terminal lead: counts per status and the worst overdue offenders.',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => slaState(),
        },
        {
            name: 'get_call_tasks',
            description: 'The VA call sheet: open "call this customer" tasks (due soonest first, each with the customer\'s last few inbound messages) plus recently resolved ones. Check here before creating a task — an open one may already cover the customer.',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => {
                const { open, recent } = await listVaCallTasks();
                return {
                    open: open.map((t) => ({
                        taskId: t.id,
                        conversationId: t.conversationId,
                        phone: t.phone,
                        contactName: t.contactName,
                        channel: t.channel,
                        reason: t.reason,
                        dueAt: t.dueAt,
                        createdAt: t.createdAt,
                        context: t.context.map((m) => ({ text: (m.content ?? '').slice(0, 200), hasMedia: !!m.mediaUrl, at: m.createdAt })),
                    })),
                    recentlyResolved: recent.slice(0, 10).map((t) => ({
                        taskId: t.id,
                        contactName: t.contactName,
                        phone: t.phone,
                        outcome: t.completedAt ? 'called' : 'dismissed',
                        at: t.completedAt ?? t.dismissedAt,
                        dismissReason: t.dismissReason ?? null,
                    })),
                };
            },
        },
        {
            name: 'get_contractors',
            description: 'The contractor roster: every contractor\'s handyman_profiles id and name. Call this FIRST to resolve a name like \'Craig\' to the id the other tools need. Two similar names → ask the operator which one (quick replies).',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => ({
                contractors: await listContractors(),
                note: 'These ids are what get_jobs (contractor_schedule), get_contractor_availability (contractorId) and propose_job_assignment (contractorId) expect.',
            }),
        },
        {
            name: 'get_jobs',
            description: 'Jobs, read-only, three views: "today" (who is working where today — occupancy from the authoritative scheduledDates), "unassigned" (the dispatch pool with age), or "contractor_schedule" (one contractor\'s jobs over a date window; needs contractorId). Dates YYYY-MM-DD, money in pence.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    view: { type: 'string', enum: ['today', 'unassigned', 'contractor_schedule'] },
                    contractorId: { type: 'string', description: 'handyman_profiles.id — required for contractor_schedule.' },
                    fromDate: { type: 'string', description: 'contractor_schedule window start, YYYY-MM-DD. Default today.' },
                    days: { type: 'number', description: 'contractor_schedule window length. Default 7.' },
                },
                required: ['view'],
            },
            run: async (input: { view: string; contractorId?: string; fromDate?: string; days?: number }) => {
                if (input.view === 'today') return { jobs: await listTodaysJobs() };
                if (input.view === 'unassigned') return { jobs: await listUnassignedJobs() };
                if (input.view === 'contractor_schedule') {
                    if (!input.contractorId) throw new Error('contractor_schedule needs a contractorId');
                    return { jobs: await getContractorSchedule(input.contractorId, input.fromDate, input.days ?? 7) };
                }
                throw new Error(`Unknown view "${input.view}" — use today, unassigned, or contractor_schedule.`);
            },
        },
        {
            name: 'get_money_state',
            description: 'The money picture, read-only, in one call: summary totals plus overdue invoices (worst first) and completed-but-never-billed jobs. CRITICAL: most "overdue" invoices were never actually sent — check everSent before saying anyone is ignoring an invoice, and never chase a customer over an invoice they never received.',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => {
                const [summary, overdue, unbilled] = await Promise.all([
                    getMoneySummary(), listOverdueInvoices(), listUnbilledCompletedJobs(),
                ]);
                return {
                    summary,
                    overdueInvoices: overdue,
                    unbilledCompletedJobs: unbilled,
                    note: 'Amounts in pence. overdueInvoices capped at 40 (summary counts the full set). everSent=false means the customer never received it.',
                };
            },
        },
        {
            name: 'get_customer_dossier',
            description: 'Everything about one customer by phone number, read-only: leads, quotes (with expiry status), jobs, invoices, conversations and calls, each capped at 10 newest, plus a summary head (jobs count, open balance pence, live quotes). Matches +44 / 0-prefix / @c.us storage forms. Unknown numbers return an empty dossier, not an error. Phone-keyed only — email-only customers will not appear.',
            input_schema: {
                type: 'object' as const,
                properties: { phone: { type: 'string', description: 'Any form: +447700900123, 07700 900123, 447700900123@c.us.' } },
                required: ['phone'],
            },
            run: async (input: { phone: string }) => getCustomerDossier(input.phone),
        },
        // ---------- actions (delegation + the two gated exits) ----------
        {
            name: 'run_comms_agent',
            description: 'DELEGATE a conversation to the comms specialist: it reads the thread and handles the reply/triage itself under its own guard rails. Prefer this over drafting customer replies yourself.',
            input_schema: {
                type: 'object' as const,
                properties: { conversationId: { type: 'string' } },
                required: ['conversationId'],
            },
            run: async (input: { conversationId: string }) => {
                // Phase 2 (§3.1, §3.5): with the spine on, the Ops Manager loses its direct comms
                // bypass and asks the spine like everyone else — requestRun owns the debounce and
                // the claim, and it cannot write a draft itself. Spine off (the default) = legacy.
                if (await isSpineEnabled().catch(() => false)) {
                    const queued = await requestRunOrNull(input.conversationId, 'manual');
                    if (queued) {
                        return { conversationId: input.conversationId, delegated: 'spine', queued: queued.queued, reason: queued.reason ?? null };
                    }
                }
                const outcome = await runCommsAgent(input.conversationId, 'ops_manager');
                return {
                    conversationId: outcome.conversationId,
                    actions: outcome.actions.map((a) => a.tool),
                    autosent: outcome.autosent,
                    escalated: outcome.escalated,
                    quotePrepHandoff: !!outcome.handoff,
                    summary: outcome.result.finalText.slice(0, 500),
                };
            },
        },
        {
            name: 'run_quote_prep',
            description: 'DELEGATE a thread to the quote-prep clerk: it turns the conversation into a quote-ready intake on Ben\'s desk. Use when a thread looks priceable.',
            input_schema: {
                type: 'object' as const,
                properties: { conversationId: { type: 'string' } },
                required: ['conversationId'],
            },
            run: async (input: { conversationId: string }) => {
                const { intake, summary, turns } = await runQuotePrep(input.conversationId);
                return { readiness: (intake as any)?.readiness ?? null, summary: (summary ?? '').slice(0, 500), turns };
            },
        },
        {
            name: 'run_recovery_sweep',
            description: 'DELEGATE to the recovery specialist: it reviews quotes that went quiet and PROPOSES follow-up nudges into its approval queue. Sends nothing.',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => {
                const result = await runRecovery();
                return { summary: result.finalText.slice(0, 500), turns: result.turns };
            },
        },
        {
            name: 'run_sla_sweep',
            description: 'Run the pipeline stage/SLA sweeper now: recomputes funnel stages and raises SLA/stuck-state alerts. It alerts, it never messages customers.',
            input_schema: { type: 'object' as const, properties: {} },
            run: async () => {
                const summary = await runPipelineSweep('ops_manager');
                return summary ?? { note: 'A sweep is already in flight; nothing was started.' };
            },
        },
        {
            name: 'create_va_call_task',
            description: 'Put a customer on the VA call sheet: a "call within 15 working minutes" task that pings the on-call phone. The trigger gates are STRICT and may refuse — only first-contact or long-returning customers, whatsapp/sms/webform only, no prior call anywhere in their threads, not opted out, no open task already. A refusal comes back with its reason: report it, do not retry or work around it.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    conversationId: { type: 'string' },
                    phone: { type: 'string', description: 'E.164 destination, e.g. +447700900123.' },
                    channel: { type: 'string', enum: ['whatsapp', 'sms', 'webform'], description: 'How the customer got in touch.' },
                    contactName: { type: 'string' },
                    text: { type: 'string', description: 'Optional enquiry preview shown in the VA\'s ping.' },
                },
                required: ['conversationId', 'phone', 'channel'],
            },
            run: async (input: { conversationId: string; phone: string; channel: string; contactName?: string; text?: string }) => {
                const result = await maybeCreateVaCallTask({
                    conversationId: input.conversationId,
                    phone: input.phone,
                    channel: input.channel as FirstContactChannel,
                    contactName: input.contactName ?? null,
                    text: input.text ?? null,
                });
                if (result.created && result.task) {
                    return {
                        created: true,
                        taskId: result.task.id,
                        dueAt: result.task.dueAt,
                        note: 'On the VA call sheet. In working hours the phone was pinged; out of hours the ping is deferred to the 08:00 release.',
                    };
                }
                return { created: false, reason: result.reason, detail: result.detail ?? null };
            },
        },
        {
            name: 'complete_call_task',
            description: 'Mark an open VA call task as called — use when the call has actually happened. Already-resolved tasks come back unchanged.',
            input_schema: {
                type: 'object' as const,
                properties: { taskId: { type: 'string' } },
                required: ['taskId'],
            },
            run: async (input: { taskId: string }) => {
                const task = await completeVaCallTask(input.taskId);
                return task
                    ? { completed: true, taskId: task.id, contactName: task.contactName, phone: task.phone }
                    : { completed: false, note: 'That task was already resolved (or the id is wrong) — nothing changed.' };
            },
        },
        {
            name: 'dismiss_call_task',
            description: 'Dismiss an open VA call task with a short reason (call not needed, handled another way, duplicate). Already-resolved tasks come back unchanged.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    taskId: { type: 'string' },
                    reason: { type: 'string', description: 'Why the call is not needed — shows on the audit trail.' },
                },
                required: ['taskId', 'reason'],
            },
            run: async (input: { taskId: string; reason: string }) => {
                const task = await dismissVaCallTask(input.taskId, 'ops_manager', input.reason);
                return task
                    ? { dismissed: true, taskId: task.id, contactName: task.contactName, phone: task.phone }
                    : { dismissed: false, note: 'That task was already resolved (or the id is wrong) — nothing changed.' };
            },
        },
        {
            name: 'propose_job_assignment',
            description: 'PROPOSE assigning an unassigned job to a contractor. This NEVER assigns: it writes a pending proposal that lands on Ben\'s Desk with Approve & assign / Reject buttons — the approval runs the real assignment with its own availability checks. One pending proposal per job; a duplicate returns the existing one. Check get_jobs (unassigned) and get_contractor_availability first, and say in the note why this contractor, these dates.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    jobId: { type: 'string', description: 'The contractor_booking_requests id of an unassigned job.' },
                    contractorId: { type: 'string', description: 'handyman_profiles.id of the proposed contractor.' },
                    scheduledDates: { type: 'array', items: { type: 'string' }, description: 'Proposed YYYY-MM-DD dates, first = start day. Optional — omitted means the job\'s own date.' },
                    note: { type: 'string', description: 'One line for Ben: why this contractor, these dates.' },
                },
                required: ['jobId', 'contractorId', 'note'],
            },
            run: async (input: { jobId: string; contractorId: string; scheduledDates?: string[]; note: string }) => {
                const result = await createAssignmentProposal({
                    jobId: input.jobId,
                    contractorId: input.contractorId,
                    scheduledDates: input.scheduledDates ?? null,
                    note: input.note,
                    createdBy: 'ops_manager',
                });
                if (!result.ok) return { proposed: false, refusal: result.error };
                return {
                    proposed: true,
                    proposalId: result.proposal.id,
                    alreadyPending: result.alreadyPending,
                    note: result.alreadyPending
                        ? 'A pending proposal for this job already exists — returning it; nothing new was created.'
                        : 'Pending proposal created. Nothing is assigned until Ben approves it on the Desk.',
                };
            },
        },
        {
            name: 'generate_invoice',
            description: 'Generate the balance invoice for a COMPLETED job (a contractor_booking_requests id). Every figure comes from the job\'s quote record — you never choose, adjust, or state amounts. Refused outright for jobs that are not completed; if the job already has a linked invoice it returns that instead of creating a duplicate. This creates an internal document only: it does NOT message the customer, and telling the customer about it still goes through the normal draft/flag rails.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    jobId: { type: 'string', description: 'The contractor_booking_requests id of the completed job.' },
                },
                required: ['jobId'],
            },
            run: async (input: { jobId: string }) => {
                const [job] = await db.select({
                    id: contractorBookingRequests.id,
                    status: contractorBookingRequests.status,
                    dayOfStatus: contractorBookingRequests.dayOfStatus,
                    invoiceId: contractorBookingRequests.invoiceId,
                    customerName: contractorBookingRequests.customerName,
                }).from(contractorBookingRequests)
                    .where(eq(contractorBookingRequests.id, input.jobId))
                    .limit(1);
                if (!job) throw new Error(`Job ${input.jobId} not found`);

                // Gate 1: completed jobs only — this is the whole deal Ben approved.
                const completed = job.status === 'completed' || job.dayOfStatus === 'completed';
                if (!completed) {
                    return {
                        generated: false,
                        refusal: `Job ${job.id} (${job.customerName}) is not completed (status: ${job.status}${job.dayOfStatus ? `, day-of: ${job.dayOfStatus}` : ''}). Invoices are only generated for completed jobs. If Ben needs one anyway, flag_for_ben.`,
                    };
                }

                // Gate 2: generateBalanceInvoice does not dedupe — surface the
                // existing invoice rather than minting a second one.
                if (job.invoiceId) {
                    const [existing] = await db.select({
                        id: invoices.id,
                        invoiceNumber: invoices.invoiceNumber,
                        balanceDue: invoices.balanceDue,
                        status: invoices.status,
                    }).from(invoices).where(eq(invoices.id, job.invoiceId)).limit(1);
                    return {
                        generated: false,
                        alreadyInvoiced: true,
                        invoiceId: job.invoiceId,
                        invoiceNumber: existing?.invoiceNumber ?? null,
                        balanceDuePence: existing?.balanceDue ?? null,
                        invoiceStatus: existing?.status ?? null,
                        note: 'This job already has an invoice — returning it instead of creating a duplicate.',
                    };
                }

                const result = await generateInvoiceForJob(input.jobId);
                if (!result) {
                    return {
                        generated: false,
                        note: 'Nothing to invoice: the job has no linked quote, no deposit was paid, or the balance is already settled (see server logs for which).',
                    };
                }
                return {
                    generated: true,
                    invoiceId: result.invoiceId,
                    invoiceNumber: result.invoiceNumber,
                    balanceDuePence: result.balanceDuePence,
                    note: 'Balance invoice created from the quote record. The customer has NOT been notified — that needs a draft or Ben.',
                };
            },
        },
        {
            name: 'queue_draft',
            description: 'PROPOSE a customer message. This NEVER sends: it writes a pending draft that a human reviews and approves in the drafts queue. The full guard chain runs first — any money figure, discount, date commitment, liability admission or voice breach is refused outright, and the answer to those is flag_for_ben, not a reworded draft. Prefer run_comms_agent for replies on live threads; use this only for a message the specialists cannot produce.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    phone: { type: 'string', description: 'E.164 destination, e.g. +447700900123.' },
                    body: { type: 'string', description: 'The proposed message. No £ figures, no discounts, no date commitments — ever.' },
                    reason: { type: 'string', description: 'One line for the approver: why this message, why now.' },
                },
                required: ['phone', 'body', 'reason'],
            },
            run: async (input: { phone: string; body: string; reason: string }) => opsQueueDraft(input),
        },
        {
            name: 'flag_for_ben',
            description: 'ESCALATE a thread to Ben: tags it needs_ben, pings his phone, and he replies in the thread himself. This is THE route for anything involving money amounts, discounts, price changes, or date commitments — those decisions are his, never yours.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    conversationId: { type: 'string' },
                    note: { type: 'string', description: 'What needs deciding, with the specifics Ben needs to act.' },
                },
                required: ['conversationId', 'note'],
            },
            run: async (input: { conversationId: string; note: string }) => {
                const [conv] = await db.select({ phoneNumber: conversations.phoneNumber })
                    .from(conversations).where(eq(conversations.id, input.conversationId));
                if (!conv) throw new Error(`Conversation ${input.conversationId} not found`);
                const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
                return flagThreadForBen({
                    conversationId: input.conversationId,
                    phone: digits ? `+${digits}` : conv.phoneNumber,
                    note: input.note,
                    runId: ctx.runId ?? null,
                    source: 'ops_manager',
                });
            },
        },
    ];
}

// ---------------------------------------------------------------- system prompt

export const SYSTEM = `You are the Ops Manager for Handy Services, a Nottingham handyman company — the owner's chief of staff in a chat dock. You read the whole operation (comms board, lead pipeline, SLA state, contractor availability) and you coordinate the specialist agents. You answer the human you are chatting with directly, tersely, with numbers and names, and you take the actions they ask for within your rails.

THE RAILS — absolute, not preferences:
1. YOU NEVER SEND A MESSAGE TO A CUSTOMER. You have no send tool. queue_draft is a PROPOSAL: it writes a pending draft that a human reviews and approves before anything leaves. Say so if asked to "send" something — you can propose it, a human releases it.
2. MONEY, DISCOUNTS AND DATES ARE BEN'S ALONE. Anything involving a money amount, a discount or price change, or a commitment to a date or arrival time must NOT be drafted at all — not even as a pending proposal. Use flag_for_ben with a note instead. The guard chain will refuse such drafts anyway; do not retry reworded versions, escalate. ONE carve-out: generate_invoice for a COMPLETED job is allowed, because every figure is computed from the quote record — you never pick or alter an amount, and the customer is not messaged. Announcing or chasing that invoice with the customer still falls under rails 1 and 2.
3. DELEGATE FIRST. Replies on live customer threads belong to run_comms_agent. Priceable threads go to run_quote_prep. Quiet quotes go to run_recovery_sweep. Pipeline hygiene goes to run_sla_sweep. Phone work goes on the VA call sheet — create_va_call_task puts a human on the call; you never phone anyone. Its trigger gates are strict and a refusal (wrong channel, ongoing customer, call already happened) is an answer, not an obstacle. Job assignment is the same shape as drafting: propose_job_assignment only writes a pending proposal that Ben approves or rejects on the Desk — you never assign anyone directly. Do a specialist's job yourself only when no specialist covers it, and say why.

MONEY FACTS: get_money_state and get_customer_dossier give you real figures from the ledger — you may STATE those facts to the operator in the dock (that is reporting, not drafting). The rails bite the moment a figure would reach a customer: no draft may carry an amount, and most "overdue" invoices were never sent (everSent=false) — never chase a customer over an invoice they never received; flag Ben instead.

WORKING STYLE: gather only the context the question needs (the board snapshot is usually enough), act, then report what you did and what is now waiting on a human. Never invent data — every number you state must come from a tool result this turn or earlier in this session. UK English. Be brief.

FORMAT: your replies render as markdown in the chat dock. Use a short bold lead, compact bullet lists, and a small table when comparing rows. Deep-link entities as markdown links so the operator can click straight through without leaving the page: a conversation → [Contact Name](/admin/comms?conversation=CONVERSATION_ID), the desk → [Desk](/admin/desk), the pipeline → [Pipeline](/admin/work). Only link ids that came from a tool result — never construct or guess an id.

When you need the operator to pick from a small set (disambiguation like two contractors named Craig, or a confirm/cancel), end your reply with a fenced block: three backticks + the word options on the opening fence (\`\`\`options), then a JSON array of 2–6 short strings, then a closing fence. It must be the LAST thing in the message. The dock renders these as tappable quick replies that send the string back verbatim — so each option must read as a complete user message ("Craig Smith", "Cancel"), not a fragment.`;

// ---------------------------------------------------------------- staff card

/** Staff-directory card — lives beside the agent so /admin/staff can't drift from reality. */
export const STAFF = {
    id: 'ops-manager',
    name: 'Ops Manager',
    roleTitle: 'Chief of Staff — Coordination & Delegation',
    mission: 'Ben\'s chat-dock manager: reads the board, pipeline, SLA state and contractor availability, answers questions with real numbers, and delegates work to the specialist agents. It never messages a customer — its only outward path is a pending draft a human approves — and anything touching money, discounts or dates goes to Ben as a flag, never a draft.',
    model: 'claude-opus-5',
    cadence: 'On demand, from the ops chat dock',
    autonomy: {
        freely: [
            'Read the board, pipeline, threads (text only), SLA state, availability and the agent roster',
            'Read jobs and money: today\'s jobs, the dispatch pool, contractor schedules, overdue invoices, unbilled work, and a full per-customer dossier by phone',
            'Fire the specialist agents: comms on a thread, quote prep, the recovery sweep, the SLA sweep',
            'Generate the balance invoice for a COMPLETED job — every figure comes from the quote record, never the model',
            'Work the VA call sheet: list tasks, put a customer on it (strict trigger gates), mark called, dismiss with a reason',
            'Flag threads for Ben with a note',
        ],
        approval: [
            'Every customer-facing message — queue_draft only ever writes a pending draft for human approval',
            'Every job assignment — propose_job_assignment only ever writes a pending proposal Ben decides on the Desk',
        ],
        never: [
            'Send a message to a customer — there is no send tool and the approve-and-send helper is never imported',
            'Draft anything carrying a money amount, discount, or date commitment — those flag Ben instead',
            'Book, assign, or promise availability directly — assignment is proposal-only and its availability tools are read-only',
        ],
    },
    tools: [
        { name: 'get_board_snapshot', blurb: 'The comms Kanban, trimmed to essentials', kind: 'read' },
        { name: 'get_pipeline_snapshot', blurb: 'Lead funnel by stage tab, with SLA per row', kind: 'read' },
        { name: 'get_thread', blurb: 'One conversation, compact, no media payloads', kind: 'read' },
        { name: 'get_contractor_availability', blurb: 'Per-date network capacity + per-contractor days, read-only', kind: 'read' },
        { name: 'get_agent_roster', blurb: 'The specialist agents and what to delegate to whom', kind: 'read' },
        { name: 'get_sla_state', blurb: 'SLA thresholds + live breach summary', kind: 'read' },
        { name: 'get_call_tasks', blurb: 'The VA call sheet: open tasks with thread context + recent resolutions', kind: 'read' },
        { name: 'get_contractors', blurb: 'Roster: contractor ids + names for the id-taking tools', kind: 'read' },
        { name: 'get_jobs', blurb: 'Today\'s jobs, the dispatch pool, or one contractor\'s schedule', kind: 'read' },
        { name: 'get_money_state', blurb: 'Overdue invoices (with everSent), unbilled completed jobs, totals', kind: 'read' },
        { name: 'get_customer_dossier', blurb: 'One customer\'s full history by phone — quotes, jobs, invoices, threads', kind: 'read' },
        { name: 'run_comms_agent', blurb: 'Delegate a thread to the comms specialist', kind: 'write' },
        { name: 'run_quote_prep', blurb: 'Delegate a thread to the quote-prep clerk', kind: 'write' },
        { name: 'run_recovery_sweep', blurb: 'Delegate to recovery — proposes nudges, sends nothing', kind: 'write' },
        { name: 'run_sla_sweep', blurb: 'Run the pipeline sweeper — alerts, never messages', kind: 'write' },
        { name: 'create_va_call_task', blurb: 'Put a customer on the VA call sheet — strict trigger gates, refusals explained', kind: 'write' },
        { name: 'complete_call_task', blurb: 'Mark a VA call task as called', kind: 'write' },
        { name: 'dismiss_call_task', blurb: 'Dismiss a VA call task with an audited reason', kind: 'write' },
        { name: 'propose_job_assignment', blurb: 'PROPOSAL ONLY: a pending assignment Ben approves on the Desk', kind: 'gated' },
        { name: 'generate_invoice', blurb: 'Balance invoice for a completed job — figures from the quote record, duplicates refused', kind: 'gated' },
        { name: 'queue_draft', blurb: 'PROPOSAL ONLY: a pending draft a human approves; guard chain runs first', kind: 'gated' },
        { name: 'flag_for_ben', blurb: 'Escalation: money/discount/date decisions land on Ben\'s phone', kind: 'write' },
    ],
} as const;

// ---------------------------------------------------------------- the turn

/**
 * Map the session history into runner priorMessages: most recent HISTORY_CAP turns, empty
 * bodies dropped, consecutive same-role turns coalesced (the Messages API requires strict
 * user/assistant alternation), and any leading assistant turn dropped (the API requires the
 * first message to be a user turn).
 */
function historyToPriorMessages(history: { role: 'user' | 'assistant'; content: string }[]): Anthropic.MessageParam[] {
    const recent = history.slice(-HISTORY_CAP).filter((m) => (m.content ?? '').trim().length > 0);
    const merged: Anthropic.MessageParam[] = [];
    for (const m of recent) {
        const last = merged[merged.length - 1];
        if (last && last.role === m.role && typeof last.content === 'string') {
            last.content = `${last.content}\n\n${m.content}`;
        } else {
            merged.push({ role: m.role, content: m.content });
        }
    }
    while (merged.length && merged[0].role === 'assistant') merged.shift();
    // The current user turn follows immediately; a trailing user turn here would break alternation.
    while (merged.length && merged[merged.length - 1].role === 'user') merged.pop();
    return merged;
}

export const runOpsManagerTurn: RunOpsManagerTurn = async ({ sessionId, userMessage, history, onEvent }) => {
    const leanTranscript: LeanRunStep[] = [];
    // Phase 1: one run id per turn, minted first so the belt's flag writes carry it.
    const runId = newRunId('run');
    const result = await runAgent({
        name: `ops-manager:${sessionId.slice(0, 8)}`,
        runId, trigger: 'ops_manager_turn',
        system: SYSTEM,
        goal: userMessage,
        tools: buildTools({ runId }),
        maxTurns: 12,
        priorMessages: historyToPriorMessages(history),
        onEvent: (evt) => {
            const step = leanTranscriptEvent(evt);
            leanTranscript.push(step);
            if (onEvent) {
                try { onEvent(step); } catch (err) {
                    console.warn('[OpsManager] onEvent listener failed (run continues):', err instanceof Error ? err.message : err);
                }
            }
        },
    });
    return { finalText: result.finalText, leanTranscript, usage: result.usage };
};
