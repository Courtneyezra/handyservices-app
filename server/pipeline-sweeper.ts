/**
 * Pipeline stage/SLA sweeper — the pipeline-hygiene half of the cron pair
 * (dispatch-cron handles the dispatch pool; this handles the lead funnel).
 *
 * Every 15 minutes it:
 *   1. Recomputes + persists the funnel stage for non-terminal leads
 *      (lead-stage-engine is the source of truth; persist only on change).
 *   2. Alerts on stage-SLA breaches (STAGE_SLA_HOURS), deduped via
 *      leads.lastSlaAlertAt (max one alert per lead per 24h).
 *   3. Alerts on stuck states: deposit paid but no contractor assigned >24h;
 *      package selected but deposit unpaid >48h.
 *   4. Marks clearly-dead leads as 'expired' (all quotes unbooked and 30+ days
 *      old — mirrors the checkLostLeadAutoMark force-update pattern) and
 *      alerts on freshly-expired quotes.
 *
 * It ALERTS, it never auto-acts: no customer messaging, no auto-assignment,
 * no bookings. The only writes are stage persistence (the engine's own
 * computed stage), the 'expired' terminal marking, and alert-dedup stamps.
 * All failures are swallowed so the interval never dies.
 */

import { db } from './db';
import { leads, personalizedQuotes, contractorBookingRequests, contractorJobs, LeadStage } from '@shared/schema';
import { and, eq, gt, inArray, isNull, isNotNull, lt, notIlike, notInArray, notLike, or } from 'drizzle-orm';
import {
    computeLeadStage,
    updateLeadStage,
    getSLAStatus,
    getStageDisplayName,
    getNextAction,
} from './lead-stage-engine';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;       // every 15 minutes
const BOOT_DELAY_MS = 20 * 1000;                // let the server settle (dispatch cron uses 10s — stagger)
const SLA_REALERT_MS = 24 * 60 * 60 * 1000;     // one SLA alert per lead per 24h (leads.lastSlaAlertAt)
const DEPOSIT_UNASSIGNED_MS = 24 * 60 * 60 * 1000; // deposit paid but no contractor after this ⇒ stuck
const SELECTED_UNPAID_MS = 48 * 60 * 60 * 1000;    // package selected but unpaid after this ⇒ stuck
const QUOTE_ABANDON_MS = 30 * 24 * 60 * 60 * 1000; // unbooked quote older than this ⇒ dead
const STUCK_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000; // ignore ancient rows — not actionable stuck states
const ALERT_CAP = 5;                             // more than this per category ⇒ ONE summary alert
const MAX_RECOMPUTE_PER_SWEEP = 200;             // computeLeadStage is ~4 queries/lead — bound the work
const MAX_EXPIRE_MARKS_PER_SWEEP = 25;           // drain historical backlog gradually

const TERMINAL_STAGES: LeadStage[] = ['completed', 'lost', 'expired', 'declined'];
// Only these stages may be force-marked 'expired' — never anything at/after booked.
const PRE_BOOKING_STAGES: LeadStage[] = [
    'new_lead', 'contacted', 'awaiting_video', 'video_received',
    'visit_scheduled', 'visit_done', 'quote_sent', 'quote_viewed', 'awaiting_payment',
];

interface SweeperAlert {
    id: string;
    type: 'sla_breach' | 'customer_reply' | 'payment_issue';
    severity: 'high' | 'medium' | 'low';
    leadId: string;
    customerName: string;
    message: string;
    data?: Record<string, any>;
}

// Alert emission is lazily imported because pipeline-events pulls in ./index
// (the full server bootstrap). Test scripts swap the emitter so they can run
// runPipelineSweep standalone without booting the server.
let emitAlert: (alert: SweeperAlert) => void | Promise<void> = async (alert) => {
    const { broadcastPipelineAlert } = await import('./pipeline-events');
    broadcastPipelineAlert(alert);
};
export function __setAlertEmitterForTest(fn: (alert: SweeperAlert) => void | Promise<void>) {
    emitAlert = fn;
}

let running = false;   // a sweep is in flight — skip overlapping runs
let started = false;   // interval already scheduled — keep start idempotent

// Per-episode dedupe (dispatch-cron pattern): a stuck/expired id alerts once,
// then only again after it leaves and re-enters the stuck set.
let alertedStuckDeposit = new Set<string>();
let alertedStuckUnpaid = new Set<string>();
let alertedExpiredQuotes = new Set<string>();

export interface PipelineSweepSummary {
    leadsScanned: number;
    stageUpdates: number;
    slaBreaches: number;
    slaAlertsSent: number;
    stuckDepositAlerts: number;
    stuckUnpaidAlerts: number;
    expiredLeadsMarked: number;
    expiredQuoteAlerts: number;
}

export interface PipelineSweepOptions {
    /** Test hook: restrict every sub-sweep to these lead ids (quotes filtered by leadId). */
    onlyLeadIds?: string[];
}

/** Emit a category of alerts, collapsing a bulk backlog into ONE summary. */
async function emitBatched(alerts: SweeperAlert[], batch: Omit<SweeperAlert, 'severity'> & { severity?: SweeperAlert['severity'] }) {
    if (alerts.length === 0) return;
    if (alerts.length > ALERT_CAP) {
        await emitAlert({ severity: 'high', ...batch, data: { ...batch.data, count: alerts.length } });
    } else {
        for (const a of alerts) await emitAlert(a);
    }
}

export async function runPipelineSweep(reason: string, opts?: PipelineSweepOptions): Promise<PipelineSweepSummary | null> {
    if (running) return null;
    running = true;
    try {
        const now = Date.now();
        const scope = opts?.onlyLeadIds;
        const summary: PipelineSweepSummary = {
            leadsScanned: 0, stageUpdates: 0, slaBreaches: 0, slaAlertsSent: 0,
            stuckDepositAlerts: 0, stuckUnpaidAlerts: 0, expiredLeadsMarked: 0, expiredQuoteAlerts: 0,
        };

        // ---------------------------------------------------------------
        // 1) Stage recompute + persist (non-terminal leads only)
        // ---------------------------------------------------------------
        const rows = await db
            .select({
                id: leads.id,
                customerName: leads.customerName,
                stage: leads.stage,
                stageUpdatedAt: leads.stageUpdatedAt,
                lastSlaAlertAt: leads.lastSlaAlertAt,
                updatedAt: leads.updatedAt,
            })
            .from(leads)
            .where(and(
                or(isNull(leads.stage), notInArray(leads.stage, TERMINAL_STAGES)),
                scope ? inArray(leads.id, scope) : undefined,
            ));
        summary.leadsScanned = rows.length;

        // Recompute the most recently active leads first (likeliest to have new
        // data); dormant leads' stages don't move, and SLA below covers everyone.
        const recomputeRows = [...rows]
            .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
            .slice(0, MAX_RECOMPUTE_PER_SWEEP);

        for (const row of recomputeRows) {
            try {
                const computed = await computeLeadStage(row.id);
                const current = (row.stage as LeadStage) || 'new_lead';
                if (computed.stage !== current) {
                    const res = await updateLeadStage(row.id, computed.stage, {
                        force: true,
                        reason: `Pipeline sweep: ${computed.reason}`,
                    });
                    if (res.success) {
                        summary.stageUpdates++;
                        row.stage = computed.stage;          // keep local view in sync for SLA step
                        row.stageUpdatedAt = new Date();
                    }
                }
            } catch (e) {
                console.error(`[PipelineSweeper] recompute failed for lead ${row.id} (non-fatal):`, e);
            }
        }

        // ---------------------------------------------------------------
        // 2) SLA breach alerts (deduped via leads.lastSlaAlertAt, 24h window)
        // ---------------------------------------------------------------
        const breaches: Array<{ leadId: string; customerName: string; stage: LeadStage; hoursOverdue: number; slaHours: number }> = [];
        for (const row of rows) {
            const stage = (row.stage as LeadStage) || 'new_lead';
            if (TERMINAL_STAGES.includes(stage)) continue; // may have just been recomputed terminal
            const sla = getSLAStatus(stage, row.stageUpdatedAt);
            if (sla.status !== 'overdue' || sla.hoursRemaining === null || sla.slaHours === null) continue;
            if (row.lastSlaAlertAt && now - row.lastSlaAlertAt.getTime() < SLA_REALERT_MS) continue; // alerted <24h ago
            breaches.push({
                leadId: row.id,
                customerName: row.customerName,
                stage,
                hoursOverdue: -sla.hoursRemaining,
                slaHours: sla.slaHours,
            });
        }
        summary.slaBreaches = breaches.length;

        if (breaches.length > 0) {
            // Stamp BEFORE emitting so a broadcast hiccup can't cause a re-alert storm.
            await db.update(leads)
                .set({ lastSlaAlertAt: new Date() })
                .where(inArray(leads.id, breaches.map((b) => b.leadId)));

            await emitBatched(
                breaches.map((b) => ({
                    id: `sla_${b.leadId}`,
                    type: 'sla_breach' as const,
                    severity: (b.hoursOverdue >= 24 ? 'high' : 'medium') as 'high' | 'medium',
                    leadId: b.leadId,
                    customerName: b.customerName,
                    message: `Stuck in ${getStageDisplayName(b.stage)} — ${b.slaHours}h SLA exceeded by ${b.hoursOverdue.toFixed(1)}h. Next: ${getNextAction(b.stage)}`,
                    data: { stage: b.stage, hoursOverdue: Math.round(b.hoursOverdue * 10) / 10, slaHours: b.slaHours },
                })),
                {
                    id: 'pipeline_sla_batch',
                    type: 'sla_breach',
                    leadId: '',
                    customerName: `${breaches.length} leads`,
                    message: `${breaches.length} leads are past their stage SLA — open the pipeline board`,
                },
            );
            summary.slaAlertsSent = breaches.length;
        }

        // Shared test-quote exclusions (same convention as quote-followup-alerts).
        const notTestQuote = [
            notLike(personalizedQuotes.id, 'test_q_%'),
            notLike(personalizedQuotes.phone, '%7700900%'),
            notIlike(personalizedQuotes.customerName, 'test%'),
        ];
        const quoteScope = scope ? [inArray(personalizedQuotes.leadId, scope)] : [];

        // ---------------------------------------------------------------
        // 3a) Stuck: deposit paid but no contractor assigned for >24h
        // ---------------------------------------------------------------
        const paidUnfinished = await db
            .select({
                id: personalizedQuotes.id,
                customerName: personalizedQuotes.customerName,
                leadId: personalizedQuotes.leadId,
                depositPaidAt: personalizedQuotes.depositPaidAt,
            })
            .from(personalizedQuotes)
            .where(and(
                isNotNull(personalizedQuotes.depositPaidAt),
                lt(personalizedQuotes.depositPaidAt, new Date(now - DEPOSIT_UNASSIGNED_MS)),
                gt(personalizedQuotes.depositPaidAt, new Date(now - STUCK_LOOKBACK_MS)),
                isNull(personalizedQuotes.completedAt),
                isNull(personalizedQuotes.revokedAt),
                ...notTestQuote,
                ...quoteScope,
            ));

        let stuckDeposit: typeof paidUnfinished = [];
        if (paidUnfinished.length > 0) {
            const quoteIds = paidUnfinished.map((q) => q.id);
            const [reqs, jobs] = await Promise.all([
                db.select({ quoteId: contractorBookingRequests.quoteId })
                    .from(contractorBookingRequests)
                    .where(inArray(contractorBookingRequests.quoteId, quoteIds)),
                db.select({ quoteId: contractorJobs.quoteId })
                    .from(contractorJobs)
                    .where(inArray(contractorJobs.quoteId, quoteIds)),
            ]);
            const assigned = new Set([...reqs, ...jobs].map((r) => r.quoteId).filter(Boolean) as string[]);
            stuckDeposit = paidUnfinished.filter((q) => !assigned.has(q.id));

            const fresh = stuckDeposit.filter((q) => !alertedStuckDeposit.has(q.id));
            await emitBatched(
                fresh.map((q) => ({
                    id: `stuck_deposit_${q.id}`,
                    type: 'sla_breach' as const,
                    severity: 'high' as const,
                    leadId: q.leadId || '',
                    customerName: q.customerName,
                    message: `Deposit paid ${Math.round((now - q.depositPaidAt!.getTime()) / 3_600_000)}h ago but NO contractor assigned — assign now`,
                    data: { quoteId: q.id, depositPaidAt: q.depositPaidAt?.toISOString() },
                })),
                {
                    id: 'stuck_deposit_batch',
                    type: 'sla_breach',
                    leadId: '',
                    customerName: `${fresh.length} paid jobs`,
                    message: `${fresh.length} deposit-paid jobs have no contractor assigned for 24h+ — assign them`,
                },
            );
            summary.stuckDepositAlerts = fresh.length;
        }
        alertedStuckDeposit = new Set(stuckDeposit.map((q) => q.id));

        // ---------------------------------------------------------------
        // 3b) Stuck: package selected but deposit unpaid for >48h
        // ---------------------------------------------------------------
        const stuckUnpaid = await db
            .select({
                id: personalizedQuotes.id,
                customerName: personalizedQuotes.customerName,
                leadId: personalizedQuotes.leadId,
                selectedAt: personalizedQuotes.selectedAt,
            })
            .from(personalizedQuotes)
            .where(and(
                isNotNull(personalizedQuotes.selectedAt),
                lt(personalizedQuotes.selectedAt, new Date(now - SELECTED_UNPAID_MS)),
                gt(personalizedQuotes.selectedAt, new Date(now - QUOTE_ABANDON_MS)), // older ⇒ expiry handles it
                isNull(personalizedQuotes.depositPaidAt),
                isNull(personalizedQuotes.bookedAt),
                isNull(personalizedQuotes.revokedAt),
                isNull(personalizedQuotes.rejectionReason),
                ...notTestQuote,
                ...quoteScope,
            ));

        {
            const fresh = stuckUnpaid.filter((q) => !alertedStuckUnpaid.has(q.id));
            await emitBatched(
                fresh.map((q) => ({
                    id: `stuck_unpaid_${q.id}`,
                    type: 'payment_issue' as const,
                    severity: 'medium' as const,
                    leadId: q.leadId || '',
                    customerName: q.customerName,
                    message: `Selected a package ${Math.round((now - q.selectedAt!.getTime()) / 3_600_000)}h ago but hasn't paid the deposit — chase payment`,
                    data: { quoteId: q.id, selectedAt: q.selectedAt?.toISOString() },
                })),
                {
                    id: 'stuck_unpaid_batch',
                    type: 'payment_issue',
                    leadId: '',
                    customerName: `${fresh.length} customers`,
                    message: `${fresh.length} customers selected a package 48h+ ago without paying — chase payments`,
                },
            );
            summary.stuckUnpaidAlerts = fresh.length;
        }
        alertedStuckUnpaid = new Set(stuckUnpaid.map((q) => q.id));

        // ---------------------------------------------------------------
        // 4) Expired quotes/leads
        // ---------------------------------------------------------------
        // Dead = unbooked/unpaid and past expiresAt OR 30+ days old.
        const deadQuotes = await db
            .select({
                id: personalizedQuotes.id,
                customerName: personalizedQuotes.customerName,
                leadId: personalizedQuotes.leadId,
                createdAt: personalizedQuotes.createdAt,
                expiresAt: personalizedQuotes.expiresAt,
            })
            .from(personalizedQuotes)
            .where(and(
                isNull(personalizedQuotes.bookedAt),
                isNull(personalizedQuotes.depositPaidAt),
                isNull(personalizedQuotes.revokedAt),
                isNull(personalizedQuotes.rejectionReason),
                or(
                    lt(personalizedQuotes.expiresAt, new Date(now)),
                    lt(personalizedQuotes.createdAt, new Date(now - QUOTE_ABANDON_MS)),
                ),
                ...notTestQuote,
                ...quoteScope,
            ));

        // 4a) Leads whose EVERY quote is dead and oldest is 30+ days old get the
        // existing terminal marking (checkLostLeadAutoMark pattern: force update).
        const hardDead = deadQuotes.filter((q) => q.createdAt && now - q.createdAt.getTime() > QUOTE_ABANDON_MS);
        const candidateLeadIds = Array.from(new Set(hardDead.map((q) => q.leadId).filter(Boolean))) as string[];
        if (candidateLeadIds.length > 0) {
            const [candidateLeads, allQuotesForLeads] = await Promise.all([
                db.select({ id: leads.id, stage: leads.stage })
                    .from(leads)
                    .where(inArray(leads.id, candidateLeadIds)),
                db.select({
                    leadId: personalizedQuotes.leadId,
                    bookedAt: personalizedQuotes.bookedAt,
                    depositPaidAt: personalizedQuotes.depositPaidAt,
                    createdAt: personalizedQuotes.createdAt,
                    expiresAt: personalizedQuotes.expiresAt,
                })
                    .from(personalizedQuotes)
                    .where(inArray(personalizedQuotes.leadId, candidateLeadIds)),
            ]);
            const stageById = new Map(candidateLeads.map((l) => [l.id, (l.stage as LeadStage) || 'new_lead']));
            // A lead is only expirable when NO quote of theirs is alive (booked,
            // paid, unexpired, or created within the abandon window) — protects
            // regenerated-quote chains from a stale sibling.
            const hasLiveQuote = new Set<string>();
            for (const q of allQuotesForLeads) {
                if (!q.leadId) continue;
                const alive = Boolean(q.bookedAt) || Boolean(q.depositPaidAt)
                    || (q.expiresAt ? q.expiresAt.getTime() > now : false)
                    || (q.createdAt ? now - q.createdAt.getTime() < QUOTE_ABANDON_MS : true);
                if (alive) hasLiveQuote.add(q.leadId);
            }

            let marked = 0;
            for (const leadId of candidateLeadIds) {
                if (marked >= MAX_EXPIRE_MARKS_PER_SWEEP) break;
                const stage = stageById.get(leadId);
                if (!stage || !PRE_BOOKING_STAGES.includes(stage)) continue;
                if (hasLiveQuote.has(leadId)) continue;
                try {
                    const res = await updateLeadStage(leadId, 'expired', {
                        force: true,
                        reason: 'Quote unbooked for 30+ days (pipeline sweep auto-mark)',
                    });
                    if (res.success) marked++;
                } catch (e) {
                    console.error(`[PipelineSweeper] expire-mark failed for lead ${leadId} (non-fatal):`, e);
                }
            }
            summary.expiredLeadsMarked = marked;
        }

        // 4b) Freshly-expired quotes (past expiresAt, <30d, still unbooked, no
        // package selected — selected ones are the 3b stuck case). No quote-level
        // "expired" column exists, so this is alert-only.
        const softExpired = deadQuotes.filter((q) =>
            q.expiresAt && q.expiresAt.getTime() < now
            && q.createdAt && now - q.createdAt.getTime() <= QUOTE_ABANDON_MS,
        );
        {
            const fresh = softExpired.filter((q) => !alertedExpiredQuotes.has(q.id));
            await emitBatched(
                fresh.map((q) => ({
                    id: `quote_expired_${q.id}`,
                    type: 'sla_breach' as const,
                    severity: 'low' as const,
                    leadId: q.leadId || '',
                    customerName: q.customerName,
                    message: `Quote expired unbooked (sent ${q.createdAt ? Math.round((now - q.createdAt.getTime()) / 86_400_000) : '?'}d ago) — regenerate or close it out`,
                    data: { quoteId: q.id, expiresAt: q.expiresAt?.toISOString() },
                })),
                {
                    id: 'quote_expired_batch',
                    type: 'sla_breach',
                    severity: 'low',
                    leadId: '',
                    customerName: `${fresh.length} quotes`,
                    message: `${fresh.length} quotes expired unbooked — review, regenerate or close them out`,
                },
            );
            summary.expiredQuoteAlerts = fresh.length;
        }
        alertedExpiredQuotes = new Set(softExpired.map((q) => q.id));

        console.log(
            `[PipelineSweeper] sweep(${reason}): scanned=${summary.leadsScanned} stageUpdates=${summary.stageUpdates} ` +
            `slaAlerts=${summary.slaAlertsSent} stuckDeposit=${summary.stuckDepositAlerts} stuckUnpaid=${summary.stuckUnpaidAlerts} ` +
            `expiredMarked=${summary.expiredLeadsMarked} expiredQuoteAlerts=${summary.expiredQuoteAlerts}`,
        );
        return summary;
    } catch (err) {
        console.error('[PipelineSweeper] sweep failed (non-fatal):', err);
        return null;
    } finally {
        running = false;
    }
}

export function startPipelineSweeper() {
    if (started) return;
    started = true;
    setTimeout(() => { void runPipelineSweep('boot'); }, BOOT_DELAY_MS);
    setInterval(() => { void runPipelineSweep('cron'); }, SWEEP_INTERVAL_MS);
    console.log(`[PipelineSweeper] started — stage/SLA sweep every ${SWEEP_INTERVAL_MS / 60000}m (alert-only; never messages or assigns)`);
}
