/**
 * The AI staff directory — /api/agents/staff.
 *
 * Each agent module exports its own STAFF card and SYSTEM prompt, so this endpoint only
 * assembles them and attaches live stats from the tables the agents actually write to.
 * Nothing here is hand-maintained copy about an agent — if the card is wrong, fix it in
 * the agent's own file.
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { db } from './db';
import {
    messageDrafts, agentQuestions, appSettings, conversations, messages,
    personalizedQuotes, quickReplies, firstContactAckLog,
} from '@shared/schema';
import { eq, and, gte, desc, isNotNull, isNull, sql } from 'drizzle-orm';
import { queueDraft } from './message-drafts';
import { canSendFreeform } from './meta-whatsapp';
import { sendCustomerMessage } from './outbound';
import { newRunId } from './approver';
import { renderQuickReply } from './quick-replies';
import { findApprovedTemplate, buildTemplateVariables, renderTemplateBody } from './whatsapp-template-sync';
import { claudeText } from './llm';
import {
    buildQuoteMessage, defaultStyleForCustomerType, MESSAGE_STYLES, type MessageStyleId,
} from './contextual-pricing/quote-message';
import { STAFF as opsBriefStaff, SYSTEM as opsBriefSystem } from './agents/ops-brief';
import { STAFF as recoveryStaff, SYSTEM as recoverySystem } from './agents/recovery';
import { STAFF as commsStaff, SYSTEM as commsSystem, getCommsAgentConfig, setCommsAgentConfig } from './agents/comms';
import { STAFF as quotePrepStaff, SYSTEM as quotePrepSystem, runQuotePrep } from './agents/quote-prep';
import { STAFF as opsManagerStaff, SYSTEM as opsManagerSystem } from './agents/ops-manager';
import { FIRST_CONTACT_CHANNELS, type FirstContactChannel } from './first-contact-ack';
import {
    outcomeMetrics, outcomePatterns, recentDecisions, reconcileOutcomes, refreshOutcomes,
    exportApprovedExamples, getOutcomeLoopConfig, setOutcomeLoopConfig,
} from './agent-outcomes';
import { getHeartbeatHealth } from './comms-worker-heartbeat';
import { verdictStats } from './verdicts';
import { bucketForSources, topReason, type VerdictBucket, type VerdictStats } from './verdict-stats';

export const agentStaffRouter = Router();

type Stat = { label: string; value: number | string; tone?: 'good' | 'warn' | 'bad' | 'plain' };

/**
 * The trust-ladder number, as a badge stat: of everything a human actually judged, how much of it
 * went out with not one word changed.
 *
 * Deliberately fails soft. If the ledger table is missing (migration not run on this environment)
 * the staff directory must still render — losing a metric is a gap, losing the page is an outage.
 * A capability with fewer than 3 human decisions shows the count instead of a percentage, because
 * "100% unedited" off one approval is the kind of number that gets a capability promoted for no
 * reason.
 */
async function trustStat(agent: string): Promise<Stat | null> {
    try {
        const { byAgent } = await outcomeMetrics({ days: 90, agent });
        const row = byAgent[0];
        if (!row) return null;
        if (row.humanDecided < 3 || row.uneditedRate === null) {
            return { label: 'Approved unedited (90d)', value: `${row.approvedUnedited}/${row.humanDecided}`, tone: 'plain' };
        }
        const pct = Math.round(row.uneditedRate * 100);
        return {
            label: `Approved unedited (${row.humanDecided} judged, 90d)`,
            value: `${pct}%`,
            tone: pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad',
        };
    } catch (error: any) {
        console.warn(`[AgentStaff] Trust stat unavailable for ${agent}:`, error?.message);
        return null;
    }
}

async function commsStats(): Promise<{ stats: Stat[]; statusChips: { label: string; on: boolean }[] }> {
    const week = new Date(Date.now() - 7 * 24 * 3600_000);
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'comms_agent'), eq(messageDrafts.status, 'pending')));
    const [sent7d] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'comms_agent'), eq(messageDrafts.status, 'sent'), gte(messageDrafts.sentAt, week)));
    const [rejected7d] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'comms_agent'), eq(messageDrafts.status, 'rejected'), gte(messageDrafts.createdAt, week)));
    const [openQ] = await db.select({ n: sql<number>`count(*)::int` }).from(agentQuestions)
        .where(eq(agentQuestions.status, 'open'));
    const [answeredQ] = await db.select({ n: sql<number>`count(*)::int` }).from(agentQuestions)
        .where(eq(agentQuestions.status, 'answered'));
    const config = await getCommsAgentConfig();
    const trust = await trustStat('comms');
    const heartbeat = await getHeartbeatHealth();

    return {
        stats: [
            // Still first, and still the honest number — but it no longer gates anything. Under
            // direct send it measures quality rather than deciding permission, so it is read as
            // "when Ben DOES look, how often does he change the words", off the replies the rail
            // held back for him.
            ...(trust ? [trust] : []),
            {
                label: config.autosend.enabled ? 'Held for Ben (money/date/out of hours)' : 'Drafts awaiting approval',
                value: pending.n,
                tone: pending.n > 0 ? 'warn' : 'plain',
            },
            { label: 'Sent (7d)', value: sent7d.n, tone: 'good' },
            { label: 'Rejected (7d)', value: rejected7d.n, tone: rejected7d.n > 0 ? 'bad' : 'plain' },
            { label: 'Questions waiting on Ben', value: openQ.n, tone: openQ.n > 0 ? 'warn' : 'plain' },
            { label: 'Answers ready to consume', value: answeredQ.n, tone: 'plain' },
        ],
        statusChips: [
            { label: config.enabled ? 'SLA SWEEP ON' : 'SLA SWEEP OFF', on: config.enabled },
            // Say what the mode actually is. "AUTO-SEND OFF" read as "safe" when it meant
            // "everything queues"; "DIRECT SEND ON" reads as what it is: replies are leaving.
            {
                label: config.autosend.enabled
                    ? 'DIRECT SEND ON · money + dates still go to Ben'
                    : 'DIRECT SEND OFF · every reply queues for approval',
                on: config.autosend.enabled,
            },
            {
                label: config.quotePrep.enabled ? 'AUTO QUOTE-PREP ON' : 'AUTO QUOTE-PREP OFF',
                on: config.quotePrep.enabled,
            },
            // Phase 0 (2 Sep 2026): the dead-man heartbeat. "SLA SWEEP ON" is a config bit; this
            // is whether the one process allowed to sweep has actually ticked in the last 10 min.
            {
                label: heartbeat.ageSeconds === null
                    ? 'WORKER HEARTBEAT NEVER SEEN · no process is sweeping'
                    : heartbeat.stale
                        ? `WORKER HEARTBEAT STALE · last seen ${Math.round(heartbeat.ageSeconds / 60)} min ago`
                        : `WORKER ALIVE · ${heartbeat.host ?? '?'} · ${heartbeat.ageSeconds}s ago`,
                on: !heartbeat.stale,
            },
        ],
    };
}

async function recoveryStats(): Promise<{ stats: Stat[]; statusChips: { label: string; on: boolean }[] }> {
    const r: any = await db.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'proposed') ::int AS proposed,
               count(*) FILTER (WHERE status = 'approved' AND created_at >= now() - interval '7 days')::int AS approved_7d,
               count(*) FILTER (WHERE status = 'skipped'  AND created_at >= now() - interval '7 days')::int AS skipped_7d,
               count(*) FILTER (WHERE lever IS NOT NULL) ::int AS total_nudges
        FROM nudge_queue
    `).then((x: any) => (x.rows ?? x)[0]);

    const trust = await trustStat('recovery');

    return {
        stats: [
            ...(trust ? [trust] : []),
            { label: 'Nudges awaiting approval', value: r.proposed, tone: r.proposed > 0 ? 'warn' : 'plain' },
            { label: 'Approved (7d)', value: r.approved_7d, tone: 'good' },
            { label: 'Skipped with reason (7d)', value: r.skipped_7d, tone: 'plain' },
            { label: 'Nudges proposed all-time', value: r.total_nudges, tone: 'plain' },
        ],
        statusChips: [{ label: 'PROPOSE-ONLY', on: true }],
    };
}

/**
 * Phase 1: which message_drafts.source values each agent answers for. Ben's verdicts are keyed
 * by draft, so an agent's 30-day approval record is the sum of its sources' buckets. Quote-prep's
 * outbound messages go through the comms rails as 'comms_agent' (see the quote-prep routes below),
 * so they count under the comms agent, not separately.
 */
const VERDICT_SOURCES: Record<string, readonly string[]> = {
    comms: ['comms_agent', 'first_contact_ack'],
    recovery: ['recovery'],
    'ops-manager': ['ops_manager'],
};

const VERDICT_WINDOW_DAYS = 30;

export interface StaffVerdictSummary extends VerdictBucket {
    days: number;
    topRejectReason: { reason: string; n: number } | null;
    topEditReason: { reason: string; n: number } | null;
}

/** The 30-day verdict slice for one agent, plus the badge stats it earns. Null-safe when the table is absent. */
function verdictSummaryFor(stats: VerdictStats | null, staffId: string): { verdicts: StaffVerdictSummary | null; stats: Stat[] } {
    const sources = VERDICT_SOURCES[staffId];
    if (!stats || !sources) return { verdicts: null, stats: [] };
    const b = bucketForSources(stats, sources);
    const verdicts: StaffVerdictSummary = {
        ...b, days: VERDICT_WINDOW_DAYS,
        topRejectReason: topReason(b.rejectReasons), topEditReason: topReason(b.editReasons),
    };
    const out: Stat[] = [];
    if (b.human === 0) {
        out.push({ label: `Ben's verdicts (${VERDICT_WINDOW_DAYS}d)`, value: 0, tone: 'plain' });
    } else if (b.human < 3 || b.uneditedApprovalRate === null) {
        out.push({ label: `Approved unedited (${VERDICT_WINDOW_DAYS}d)`, value: `${b.approve}/${b.human}`, tone: 'plain' });
    } else {
        // §4 promotion gate reads ≥ 90%; below 80% the sampler would demote.
        const tone: Stat['tone'] = b.uneditedApprovalRate >= 90 ? 'good' : b.uneditedApprovalRate >= 80 ? 'plain' : 'warn';
        out.push({ label: `Approved unedited (${VERDICT_WINDOW_DAYS}d)`, value: `${b.uneditedApprovalRate}% of ${b.human}`, tone });
    }
    if (b.unsafe > 0) out.push({ label: `Marked unsafe (${VERDICT_WINDOW_DAYS}d)`, value: b.unsafe, tone: 'bad' });
    return { verdicts, stats: out };
}

// GET /api/agents/staff — the full directory with live stats.
agentStaffRouter.get('/staff', async (_req, res) => {
    try {
        const [comms, recovery, workerHeartbeat, verdicts] = await Promise.all([
            commsStats(), recoveryStats(), getHeartbeatHealth(),
            // Missing table (migration not applied yet) must not take the whole directory down.
            verdictStats(VERDICT_WINDOW_DAYS).catch((e: any) => { console.warn('[AgentStaff] verdict stats unavailable:', e?.message); return null; }),
        ]);
        const v = (id: string) => verdictSummaryFor(verdicts, id);
        const commsV = v('comms');
        const recoveryV = v('recovery');
        const opsManagerV = v('ops-manager');
        res.json({
            // Phase 0: { ok, ageSeconds, stale, at, host, pid, version, thisProcess } — same shape
            // as GET /api/health/comms-worker, so the staff page can show it without a second call.
            workerHeartbeat,
            // Phase 1: fleet-wide verdict totals for the window (per-agent slices sit on each member).
            verdictWindow: verdicts ? { days: verdicts.days, human: verdicts.human, uneditedApprovalRate: verdicts.uneditedApprovalRate, unsafe: verdicts.unsafe } : null,
            staff: [
                {
                    ...commsStaff,
                    system: commsSystem,
                    accent: 'emerald',
                    ...comms,
                    stats: [...commsV.stats, ...comms.stats],
                    verdicts: commsV.verdicts,
                },
                {
                    ...recoveryStaff,
                    system: recoverySystem,
                    accent: 'amber',
                    ...recovery,
                    stats: [...recoveryV.stats, ...recovery.stats],
                    verdicts: recoveryV.verdicts,
                },
                {
                    ...quotePrepStaff,
                    system: quotePrepSystem,
                    accent: 'sky',
                    stats: [],
                    statusChips: [{ label: 'ON-DEMAND', on: true }],
                    verdicts: null,
                },
                {
                    ...opsBriefStaff,
                    system: opsBriefSystem,
                    accent: 'sky',
                    stats: [],
                    statusChips: [{ label: 'READ-ONLY', on: true }],
                    verdicts: null,
                },
                {
                    ...opsManagerStaff,
                    system: opsManagerSystem,
                    accent: 'violet',
                    stats: opsManagerV.stats,
                    statusChips: [{ label: 'PROPOSE-ONLY', on: true }],
                    verdicts: opsManagerV.verdicts,
                },
            ],
        });
    } catch (error: any) {
        console.error('[AgentStaff] Failed to build directory:', error);
        res.status(500).json({ error: 'Failed to load staff directory' });
    }
});

// ---------------------------------------------------------------------------
// THE OUTCOME LOOP — /api/agents/outcomes/*
//
// What each agent proposed, what the human did with it, and what the customer did next. The
// headline is the unedited-approval rate: the trust ladder says autonomy is earned per capability,
// and this is the evidence it is earned with. Everything here reads server/agent-outcomes.ts;
// nothing in this section sends anything or changes an agent's behaviour, with the single exception
// of the config PATCH, which is explicit and reversible.
// ---------------------------------------------------------------------------

/** Reconcile + attribute at most this often on a page load. The panel is polled; the joins are not free. */
const OUTCOME_REFRESH_MS = 5 * 60_000;
let lastOutcomeRefresh = 0;

/**
 * Keeps the ledger honest on read, cheaply.
 *
 * Reconcile catches proposals whose fate was decided outside the hooks; refresh attributes replies
 * and deposits. Both are throttled and both are best-effort: a stale number is better than a
 * dashboard that 500s, and neither is on any send path.
 */
async function refreshOutcomesIfStale(force = false): Promise<void> {
    if (!force && Date.now() - lastOutcomeRefresh < OUTCOME_REFRESH_MS) return;
    lastOutcomeRefresh = Date.now();
    try {
        await reconcileOutcomes({ limit: 300 });
        await refreshOutcomes({ limit: 300 });
    } catch (error: any) {
        console.warn('[Outcomes] Background refresh failed:', error?.message);
    }
}

// GET /api/agents/outcomes?days=90 — the aggregates, the patterns, and the feedback config.
agentStaffRouter.get('/outcomes', async (req, res) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 3650);
        await refreshOutcomesIfStale();
        const [metrics, patterns, loopConfig] = await Promise.all([
            outcomeMetrics({ days, includeTest: req.query.includeTest === '1' }),
            outcomePatterns({ days }),
            getOutcomeLoopConfig(),
        ]);
        res.json({ ...metrics, patterns, loopConfig });
    } catch (error: any) {
        console.error('[Outcomes] Metrics failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to load outcome metrics' });
    }
});

// GET /api/agents/outcomes/decisions — proposal, edit and outcome side by side, newest first.
// This is the one a human actually reads: an aggregate tells you a capability is being rewritten,
// only the diff tells you what it keeps getting wrong.
agentStaffRouter.get('/outcomes/decisions', async (req, res) => {
    try {
        const rows = await recentDecisions({
            limit: Number(req.query.limit) || 40,
            agent: req.query.agent ? String(req.query.agent) : undefined,
            verdict: req.query.verdict ? String(req.query.verdict) : undefined,
            // Test traffic (the Ofcom range) is hidden by default and only ever shown on request —
            // the feed is a reading list for a human, not a log of what the test suite did.
            includeTest: req.query.includeTest === '1',
        });
        res.json({ decisions: rows });
    } catch (error: any) {
        console.error('[Outcomes] Decisions failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to load decisions' });
    }
});

// GET /api/agents/outcomes/examples — a PREVIEW of the few-shot examples the agents would be
// handed if the flag were on. Previewing is not injecting: the alternative is switching a
// behaviour-changing flag on without ever seeing what it would feed the model.
agentStaffRouter.get('/outcomes/examples', async (req, res) => {
    try {
        const [examples, loopConfig] = await Promise.all([
            exportApprovedExamples({
                agent: req.query.agent ? String(req.query.agent) : undefined,
                capability: req.query.capability ? String(req.query.capability) : undefined,
                ignoreFlag: true,
            }),
            getOutcomeLoopConfig(),
        ]);
        res.json({ examples, loopConfig, live: loopConfig.fewShot.enabled });
    } catch (error: any) {
        console.error('[Outcomes] Examples failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to load examples' });
    }
});

// PATCH /api/agents/outcomes/config — the ONE switch here that changes agent behaviour.
//
// Turning `fewShot.enabled` on lets agents load approved-unedited drafts as examples. It ships OFF,
// it is fully reversible (nothing is written into a prompt), and it is validated here rather than
// trusted from the client because `limit` is the cap on how much history can be pushed into a
// model's context.
agentStaffRouter.patch('/outcomes/config', async (req, res) => {
    try {
        const patch: any = {};
        const fs = req.body?.fewShot;
        if (fs && typeof fs === 'object') {
            const next: any = {};
            if (fs.enabled !== undefined) {
                if (typeof fs.enabled !== 'boolean') return res.status(400).json({ error: "'fewShot.enabled' must be true or false" });
                next.enabled = fs.enabled;
            }
            if (fs.limit !== undefined) {
                const n = Number(fs.limit);
                if (!Number.isInteger(n) || n < 1 || n > 20) return res.status(400).json({ error: "'fewShot.limit' must be a whole number between 1 and 20" });
                next.limit = n;
            }
            if (fs.maxAgeDays !== undefined) {
                const n = Number(fs.maxAgeDays);
                if (!Number.isInteger(n) || n < 1 || n > 3650) return res.status(400).json({ error: "'fewShot.maxAgeDays' must be a whole number of days between 1 and 3650" });
                next.maxAgeDays = n;
            }
            if (Object.keys(next).length) patch.fewShot = next;
        }
        if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });

        const loopConfig = await setOutcomeLoopConfig(patch);
        console.log(`[Outcomes] Feedback config changed: ${JSON.stringify(loopConfig)}`);
        res.json({ loopConfig });
    } catch (error: any) {
        console.error('[Outcomes] Config write failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to save the config' });
    }
});

// POST /api/agents/outcomes/refresh — force the reconcile + attribution pass.
agentStaffRouter.post('/outcomes/refresh', async (_req, res) => {
    try {
        const reconciled = await reconcileOutcomes({ limit: 1000 });
        const refreshed = await refreshOutcomes({ limit: 1000 });
        lastOutcomeRefresh = Date.now();
        res.json({ reconciled, refreshed });
    } catch (error: any) {
        console.error('[Outcomes] Refresh failed:', error);
        res.status(500).json({ error: error?.message || 'Refresh failed' });
    }
});

// POST /api/agents/quote-prep/:conversationId/request-details — queue an ask into the comms
// draft queue: either the "what's the postcode / what name goes on the quote" fields, or one
// customer-audience gap from the readiness verdict (`question`). Deterministic
// copy (brand voice: whatsapp-comms.md — postcode only, never full address, no em dashes,
// short bursts split by '---'). Nothing sends here: the draft waits for Ben's approval.
agentStaffRouter.post('/quote-prep/:conversationId/request-details', async (req, res) => {
    try {
        const fields: string[] = Array.isArray(req.body?.fields) ? req.body.fields : [];
        const wantName = fields.includes('name');
        const wantPostcode = fields.includes('postcode');
        // A scoping gap from the intake's readiness verdict, asked in the agent's own
        // customer-friendly wording. Same queue, same approval gate as name/postcode.
        const gapQuestion = String(req.body?.question || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        if (!wantName && !wantPostcode && !gapQuestion) {
            return res.status(400).json({ error: "Send fields ('name'/'postcode') or a question to ask" });
        }

        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.id, req.params.conversationId));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) return res.status(422).json({ error: 'Conversation has no usable phone' });

        // One question max per reply: the postcode gets the question, the name rides
        // along as a statement. Never the full address — that's collected at booking.
        let body: string;
        let reason: string;
        if (gapQuestion) {
            // Voice rules apply to text the agent wrote: no dashes-as-punctuation, one
            // question, a short lead-in of its own so it lands as a burst not a form.
            const asked = stripChatDashes(gapQuestion).replace(/\?*$/, '?');
            if (/\b(full )?address\b/i.test(asked)) {
                return res.status(422).json({ error: 'That question asks for an address. Postcode only, address comes at booking.' });
            }
            body = `Quick one before we price this up.\n---\n${asked}`;
            reason = `Quote prep needs this answered before the quote can go out: ${asked}`;
        } else {
            body = wantPostcode && wantName
                ? 'Nearly ready to price this up for you.\n---\nWhat’s the postcode? Just so we can price it properly.\n---\nAnd a name to put on the quote would help too.'
                : wantPostcode
                    ? 'Quick one so we can get your quote sorted.\n---\nWhat’s the postcode? Just so we can price it properly.'
                    : 'Nearly ready to send your quote over.\n---\nWhat name should we put on it?';
            const missing = [wantName ? 'name' : null, wantPostcode ? 'postcode' : null].filter(Boolean).join(' + ');
            reason = `Quote prep is waiting on the customer's ${missing}`;
        }

        const draftId = await queueDraft({
            phone: `+${digits}`,
            body,
            source: 'comms_agent',
            reason,
        });

        // null = suppressed as a duplicate (an unsent comms_agent draft already exists
        // for this number) — tell the card so it shows "already queued", not an error.
        res.json({ queued: !!draftId, draftId });
    } catch (error: any) {
        console.error('[QuotePrep] request-details failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to queue the ask' });
    }
});

// ---------------------------------------------------------------------------
// First-contact auto-responder: control panel + audit log.
//
// This is the ONE feature in the system that messages a stranger without a human first, and until
// now its settings lived only in a CLI script and its refusals only in console output. Nobody
// should be asked to switch that on blind. These three endpoints are the whole reason the panel in
// /admin/comms can exist: read the true state, change it, and see every decision it has made.
//
// Auth: the router is mounted behind requireAdmin in server/index.ts (which also admits the 'va'
// role, so Ben can reach it).
// ---------------------------------------------------------------------------

// GET /api/agents/first-contact/config — the live config, read from the DB, never a cached guess.
agentStaffRouter.get('/first-contact/config', async (_req, res) => {
    try {
        const config = await getCommsAgentConfig();
        res.json({ config: config.firstContactAutoAck, channels: FIRST_CONTACT_CHANNELS });
    } catch (error: any) {
        console.error('[FirstContact] Config read failed:', error);
        res.status(500).json({ error: error?.message || 'Could not read the config' });
    }
});

// PATCH /api/agents/first-contact/config — { enabled?, channels?, returningAfterDays?, askForMedia? }.
//
// Validated here rather than trusted from the client: `channels` is the list of surfaces allowed
// to message a stranger, so an unknown string in it is a silent widening of that permission.
// Returns the config as it now stands, so the panel renders the truth rather than its own optimism.
agentStaffRouter.patch('/first-contact/config', async (req, res) => {
    try {
        const patch: Record<string, any> = {};

        if (req.body?.enabled !== undefined) {
            if (typeof req.body.enabled !== 'boolean') {
                return res.status(400).json({ error: "'enabled' must be true or false" });
            }
            patch.enabled = req.body.enabled;
        }

        if (req.body?.channels !== undefined) {
            const channels = req.body.channels;
            if (!Array.isArray(channels)) return res.status(400).json({ error: "'channels' must be an array" });
            const invalid = channels.filter((c: any) => !FIRST_CONTACT_CHANNELS.includes(c));
            if (invalid.length) {
                return res.status(400).json({ error: `Unknown channel(s): ${invalid.join(', ')}. Allowed: ${FIRST_CONTACT_CHANNELS.join(', ')}` });
            }
            // De-duplicated, so the stored list matches what the toggles show.
            patch.channels = Array.from(new Set(channels)) as FirstContactChannel[];
        }

        if (req.body?.returningAfterDays !== undefined) {
            const n = Number(req.body.returningAfterDays);
            if (!Number.isInteger(n) || n < 1 || n > 3650) {
                return res.status(400).json({ error: "'returningAfterDays' must be a whole number of days between 1 and 3650" });
            }
            patch.returningAfterDays = n;
        }

        // T1 media ask (29 Aug 2026): flag-gated photo/video ask in the ack. Ships false; this is
        // the switch the owner flips after inspecting real runs.
        if (req.body?.askForMedia !== undefined) {
            if (typeof req.body.askForMedia !== 'boolean') {
                return res.status(400).json({ error: "'askForMedia' must be true or false" });
            }
            patch.askForMedia = req.body.askForMedia;
        }

        if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });

        const next = await setCommsAgentConfig({ firstContactAutoAck: patch as any });
        console.log(`[FirstContact] Config changed via /admin/comms: ${JSON.stringify(next.firstContactAutoAck)}`);
        res.json({ config: next.firstContactAutoAck, channels: FIRST_CONTACT_CHANNELS });
    } catch (error: any) {
        console.error('[FirstContact] Config write failed:', error);
        res.status(500).json({ error: error?.message || 'Could not save the config' });
    }
});

// GET /api/agents/first-contact/log?limit=100 — every decision, newest first, refusals included.
// The refusals are the point: a log of successes alone cannot answer "why did nobody get a reply?".
agentStaffRouter.get('/first-contact/log', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const rows = await db.select().from(firstContactAckLog)
            .orderBy(desc(firstContactAckLog.createdAt)).limit(limit);

        // A one-line summary of the last 7 days, so the panel can lead with "23 refused, 4 sent"
        // rather than making someone count rows.
        const week = new Date(Date.now() - 7 * 24 * 3600_000);
        const summary = await db.select({
            reason: firstContactAckLog.reason,
            n: sql<number>`count(*)::int`,
        }).from(firstContactAckLog)
            .where(gte(firstContactAckLog.createdAt, week))
            .groupBy(firstContactAckLog.reason);

        res.json({ rows, summary });
    } catch (error: any) {
        // A missing table (migration not run) must read as "no log yet", not as a broken page.
        console.error('[FirstContact] Log read failed:', error);
        res.status(500).json({ error: error?.message || 'Could not read the log' });
    }
});

// ---------------------------------------------------------------------------
// Send-quote flow (in-chat quote card): draft the delivery message, then send.
// ---------------------------------------------------------------------------

/** Digits-only key for phone comparison — conversations store `447...@c.us`, quotes store E.164. */
const digitsOf = (phone: string) => phone.replace('@c.us', '').replace(/\D/g, '');

/**
 * Loads the conversation + quote pair and refuses a mismatch. The card sends a quote link INTO a
 * thread, so the quote's phone must be the thread's phone — otherwise a stale slug in the client
 * would deliver one customer's quote (name, address area, price) to another customer.
 */
async function loadConversationQuote(conversationId: string, slug: string): Promise<
    | { ok: true; conv: typeof conversations.$inferSelect; quote: typeof personalizedQuotes.$inferSelect; phone: string }
    | { ok: false; status: number; error: string }
> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) return { ok: false, status: 404, error: 'Conversation not found' };
    const convDigits = digitsOf(conv.phoneNumber);
    if (!convDigits) return { ok: false, status: 422, error: 'Conversation has no usable phone' };

    const [quote] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug));
    if (!quote) return { ok: false, status: 404, error: 'Quote not found' };
    if (digitsOf(quote.phone || '') !== convDigits) {
        return { ok: false, status: 422, error: 'That quote belongs to a different phone number than this thread' };
    }
    return { ok: true, conv, quote, phone: `+${convDigits}` };
}

/** Brand voice for 1:1 chat — same file the comms agent loads, so the two never diverge. */
function loadChatVoice(): string {
    try {
        return readFileSync(path.join(process.cwd(), 'brand-voice/whatsapp-comms.md'), 'utf8');
    } catch {
        return 'Voice: a friendly Nottingham tradesperson texting back. Short messages, plain UK English, no em dashes, one question max. A "Thanks / Ben" sign-off and one light emoji at the end are fine.';
    }
}

/** Voice hard rule: em/en dashes (and spaced hyphens) never reach a customer. URLs are safe —
 *  their hyphens have no surrounding spaces, and the link is re-verified after this runs. */
function stripChatDashes(text: string): string {
    return text.replace(/\s*[—–]\s*/g, ', ').replace(/\s+-\s+/g, ', ');
}

const quoteUrlFor = (slug: string) => `${process.env.BASE_URL || 'https://handyservices.app'}/quote/${slug}`;

/** The pre-quote workflow tags a sent quote retires. Left in place they keep the card on Ben's
 *  desk after his move is done — the desk must empty itself when the work is finished. */
export const RETIRED_ON_QUOTE_SENT = ['needs_ben', 'quote_ready', 'needs_quote', 'quote_gaps', 'clerk_gap_followup'];

/**
 * Revoke the quote this one superseded, if any. Called at SEND time (27 Aug 2026): the customer
 * now holds the replacement, so the old price must stop being the live one — exactly one live
 * price per customer is the invariant the quote-prep guard in server/agents/comms.ts relies on.
 * Deposit-paid predecessors are never touched (a booked price never moves), and a predecessor
 * already revoked stays as it is. Best-effort by contract: the replacement is already with the
 * customer, so bookkeeping here must never turn a successful send into an error.
 */
export async function revokeSupersededQuote(quoteId: string): Promise<void> {
    try {
        const [q] = await db.select({ regeneratedFromId: personalizedQuotes.regeneratedFromId })
            .from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
        if (!q?.regeneratedFromId) return;
        const [revoked] = await db.update(personalizedQuotes)
            .set({ revokedAt: new Date() })
            .where(and(
                eq(personalizedQuotes.id, q.regeneratedFromId),
                isNull(personalizedQuotes.revokedAt),
                isNull(personalizedQuotes.depositPaidAt),
            ))
            .returning({ id: personalizedQuotes.id, shortSlug: personalizedQuotes.shortSlug });
        if (revoked) {
            console.log(`[QuoteSend] Revoked superseded quote ${revoked.shortSlug} (${revoked.id}) — replaced by ${quoteId}`);
        }
    } catch (error: any) {
        console.warn('[QuoteSend] supersede revocation failed (non-blocking):', error?.message ?? error);
    }
}

/** Marks the quote as actually sent: out of draft, thread to funnel stage 'quote_sent', tagged,
 *  and the desk tags cleared — sending IS Ben's move, so nothing needs him afterwards. */
async function finalizeQuoteSent(quoteId: string, conversationId: string): Promise<void> {
    await db.update(personalizedQuotes).set({ isDraft: false }).where(eq(personalizedQuotes.id, quoteId));
    await revokeSupersededQuote(quoteId);
    const [conv] = await db.select({ tags: conversations.tags }).from(conversations)
        .where(eq(conversations.id, conversationId));
    const kept = (conv?.tags ?? []).filter((t) => !RETIRED_ON_QUOTE_SENT.includes(t));
    await db.update(conversations)
        .set({
            stage: 'quote_sent',
            tags: Array.from(new Set([...kept, 'quote_sent'])),
            updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
}

/**
 * The Meta template purpose-built to carry a quote link outside the 24h window.
 *
 * Looked up BY NAME against the live approval cache on every send, never by hardcoded SID: at the
 * time this was wired `quote_ready_link` was still pending with Meta, and a template's status
 * moves without warning in both directions. Null means "not approved (yet)" — the caller falls
 * back rather than attempting a send Meta would reject.
 */
const QUOTE_LINK_TEMPLATE = process.env.QUOTE_LINK_TEMPLATE_NAME || 'quote_ready_link';

/**
 * A shut-window send needs an approved Twilio template with somewhere to PUT the link — a
 * `{{quote_link}}` placeholder in its body or variable map. A template without one could be
 * delivered but could never carry the quote, so it doesn't count as suitable.
 *
 * This is the FALLBACK path, kept for quick replies an operator has wired up by hand; the
 * approved-template lookup above is tried first.
 */
async function findQuoteSendTemplate() {
    const rows = await db.select().from(quickReplies)
        .where(and(eq(quickReplies.isActive, true), isNotNull(quickReplies.contentSid)));
    return rows.find((r) => (r.body + JSON.stringify(r.contentVariables ?? {})).includes('{{quote_link}}')) ?? null;
}

// POST /api/agents/quote-prep/:conversationId/draft-send-message — assemble the WhatsApp
// message that delivers a finished quote link. This is the BUILDER'S OWN generator
// (buildQuoteMessage: style-varied greeting / price-range pre-anchor / link / closing), not a
// freestyle LLM draft, so what the card sends is what the builder would send — with two
// card-only additions: a one-line acknowledgement of what the customer actually sent in the
// thread (photos etc), and a closing that says the service is complete on the link but we're
// happy to answer any questions right here in the chat. Style defaults from the quote's
// customerType; `messageStyle` in the body overrides it (the card's dropdown re-drafts).
// Drafting only: nothing is sent here. Ben reviews/edits the text; his Send IS the approval.
agentStaffRouter.post('/quote-prep/:conversationId/draft-send-message', async (req, res) => {
    try {
        const slug = String(req.body?.slug || '').trim();
        if (!slug) return res.status(400).json({ error: "Missing 'slug'" });
        const loaded = await loadConversationQuote(req.params.conversationId, slug);
        if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });
        const { conv, quote, phone } = loaded;
        const quoteUrl = quoteUrlFor(slug);

        const styleParam = String(req.body?.messageStyle || '').trim();
        const styleId: MessageStyleId = MESSAGE_STYLES.some((s) => s.id === styleParam)
            ? (styleParam as MessageStyleId)
            : defaultStyleForCustomerType(quote.customerType);

        // The last few turns, so the context line can reference what they sent (photos included).
        const recent = await db.select().from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(desc(messages.createdAt)).limit(8);
        const turns = recent.reverse();
        const thread = turns.map((m) => {
            const media = m.mediaUrl
                ? ` [sent ${(m.mediaType ?? '').startsWith('video') ? 'a video' : 'a photo'}]`
                : '';
            return `${m.direction === 'inbound' ? 'CUSTOMER' : 'US'}: ${(m.content ?? '').slice(0, 200)}${media}`;
        }).join('\n');

        // One short thread-context line — the only LLM-written part. No stock fallback: when
        // the LLM can't produce a grounded line the message simply starts at the contextual
        // message (the card path has no greeting, so generic filler would be the opener).
        let threadContextLine: string | undefined;
        try {
            const drafted = await claudeText({
                system: `You write ONE short sentence that opens a WhatsApp quote-delivery message, acknowledging what the CUSTOMER sent us (their photos, video, or how they described the job), so it reads like the same person who was just talking to them.

${loadChatVoice()}

Hard rules: one sentence, maximum 15 words. Refer ONLY to things marked CUSTOMER in the thread, never to our own messages. Do not mention the quote, any link, booking, prices or dates. No questions, no em dashes or hyphens, no emoji, never mention an address. Return ONLY the sentence.`,
                user: `Conversation so far:\n${thread || '(no messages captured)'}\n\nJob quoted: ${(quote.jobDescription || '').slice(0, 400)}`,
                maxTokens: 60,
            });
            const line = stripChatDashes(drafted.trim().replace(/^["']|["']$/g, '')).split('\n')[0].trim();
            if (line && line.length <= 140 && !line.includes('?')) threadContextLine = line;
        } catch (draftError: any) {
            console.warn('[QuotePrep] Thread-context line fell back to stock copy:', draftError?.message);
        }

        const firstName = (quote.customerName || conv.contactName || '').split(' ')[0] || 'there';
        const lineCount = Array.isArray(quote.pricingLineItems) ? (quote.pricingLineItems as any[]).length : 0;
        const assembled = buildQuoteMessage({
            styleId,
            firstName,
            contextualMessage: quote.contextualMessage || '',
            whatsappClosing: quote.whatsappClosing || '',
            quoteUrl,
            finalPricePence: quote.basePrice || 0,
            batchNudge: lineCount === 1
                ? '\n\nAnything else needs doing while we\'re there? You can add extra small jobs right inside the link too.'
                : '',
            threadContextLine,
            chatClose: true,
            // Mid-thread continuation: no "Hi <name>" salutation. The body opens at the
            // thread-context line (or the contextual message when there isn't one).
            skipGreeting: true,
        });

        // Voice hard rule for chat: no em/en dashes reach the customer. The price range uses an
        // en dash (£80–£100) which stripChatDashes would mangle into "£80, £100", so rewrite
        // ranges to "to" FIRST, then strip whatever dashes the style copy carries.
        const body = stripChatDashes(assembled.replace(/£(\d+)–£(\d+)/g, '£$1 to £$2'));

        const windowOpen = await canSendFreeform(phone).catch(() => false);
        res.json({ body, quoteUrl, windowOpen, styleUsed: styleId, styles: MESSAGE_STYLES });
    } catch (error: any) {
        console.error('[QuotePrep] draft-send-message failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to draft the message' });
    }
});

// POST /api/agents/quote-prep/:conversationId/send-quote — the send itself. Ben has seen and
// (possibly) edited the exact text; clicking Send is the approval, so this delivers directly:
// freeform burst when the 24h window is open, an approved template when one can carry the link,
// otherwise the burst is queued as a pending draft for when the window reopens. Every outcome
// is reported — nothing fails silently.
agentStaffRouter.post('/quote-prep/:conversationId/send-quote', async (req, res) => {
    try {
        const slug = String(req.body?.slug || '').trim();
        const rawBody = String(req.body?.body || '').trim();
        if (!slug || !rawBody) return res.status(400).json({ error: "Missing 'slug' or 'body'" });

        const loaded = await loadConversationQuote(req.params.conversationId, slug);
        if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });
        const { conv, quote, phone } = loaded;
        const quoteUrl = quoteUrlFor(slug);
        const runId = newRunId('sys');   // one click, one run — every burst part carries it

        const body = stripChatDashes(rawBody);
        if (!body.includes(quoteUrl)) {
            return res.status(400).json({
                error: 'MISSING_LINK',
                message: `The message must contain the quote link (${quoteUrl}) or the customer gets words with no quote.`,
            });
        }

        const windowOpen = await canSendFreeform(phone).catch(() => false);

        if (windowOpen) {
            // Multi-part burst on '---', paced like a person texting — same splitting contract
            // as approveAndSendDraft. One approval (Ben's click) covers the whole burst.
            const parts = body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 4);
            const sids: string[] = [];
            let linkDelivered = false;
            try {
                for (let i = 0; i < parts.length; i++) {
                    if (i > 0) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
                    const sendResult = await sendCustomerMessage({
                        approver: 'system.staff', runId: runId,
                        to: phone,
                        body: parts[i],
                        purpose: 'service_reply',  // Human-approved quote send
                        context: 'quote_prep:freeform',
                        contactName: quote.customerName,
                    });
                    if (!sendResult.ok) {
                        throw new Error(sendResult.error || sendResult.reason || 'Send blocked');
                    }
                    sids.push('sent');
                    if (parts[i].includes(quoteUrl)) linkDelivered = true;
                }
            } catch (sendError: any) {
                if (!linkDelivered) {
                    // The quote never reached them — leave it a draft so nothing pretends it did.
                    return res.status(502).json({
                        error: 'SEND_FAILED',
                        message: sendError?.message || 'WhatsApp send failed before the quote link went out',
                        sentSids: sids,
                    });
                }
                // The link part landed: the customer HAS the quote, so it is sent — record that,
                // and surface the broken tail rather than hiding it.
                await finalizeQuoteSent(quote.id, conv.id);
                return res.json({
                    sent: true, mode: 'freeform', sids, partial: true,
                    message: `Quote link delivered, but a follow-up part failed: ${sendError?.message || 'send failed'}`,
                });
            }
            await finalizeQuoteSent(quote.id, conv.id);
            return res.json({ sent: true, mode: 'freeform', sids });
        }

        // Window shut — only an approved template can be delivered.
        //
        // First choice is the dedicated quote-link template, resolved by name against the
        // approval cache at send time. While it is pending this returns null and we fall
        // straight through; the hour it flips to approved, this path starts working with no
        // deploy and no config change.
        const firstName = renderQuickReply('{{first_name}}', quote.customerName || conv.contactName);
        const approved = await findApprovedTemplate(QUOTE_LINK_TEMPLATE).catch(() => null);
        if (approved) {
            const vars = buildTemplateVariables(approved, { firstName, quoteUrl });
            const rendered = renderTemplateBody(approved.body, vars);
            // Same contract as the freeform path: if the link cannot actually ride this template,
            // it is not a delivery route — better to queue than to send words with no quote.
            if (rendered.includes(quoteUrl)) {
                try {
                    const sendResult = await sendCustomerMessage({
                        approver: 'system.staff', runId: runId,
                        to: phone,
                        body: rendered,
                        purpose: 'service_reply',  // Human-approved quote send
                        context: 'quote_prep:template',
                        contactName: quote.customerName,
                        contentSid: approved.contentSid,
                        contentVariables: vars,
                    });
                    if (!sendResult.ok) {
                        throw new Error(sendResult.error || sendResult.reason || 'Send blocked');
                    }
                    await finalizeQuoteSent(quote.id, conv.id);
                    return res.json({
                        sent: true, mode: 'template', sids: ['sent'],
                        templateName: approved.name, rendered,
                    });
                } catch (templateError: any) {
                    console.warn(`[QuotePrep] ${approved.name} send failed, trying fallbacks:`, templateError?.message);
                }
            } else {
                console.warn(`[QuotePrep] ${approved.name} is approved but its body has nowhere to put the quote link — skipping it.`);
            }
        }

        const template = await findQuoteSendTemplate();
        if (template) {
            const renderWithLink = (text: string) =>
                renderQuickReply(text.replace(/\{\{\s*quote_link\s*\}\}/gi, quoteUrl), quote.customerName || conv.contactName);
            try {
                const vars = template.contentVariables
                    ? Object.fromEntries(Object.entries(template.contentVariables as Record<string, string>)
                        .map(([k, v]) => [k, renderWithLink(String(v))]))
                    : undefined;
                const sendResult = await sendCustomerMessage({
                    approver: 'system.staff', runId: runId,
                    to: phone,
                    body: renderWithLink(template.body),
                    purpose: 'service_reply',  // Human-approved quote send
                    context: 'quote_prep:quick_reply_template',
                    contactName: quote.customerName,
                    contentSid: template.contentSid!,
                    contentVariables: vars,
                });
                if (!sendResult.ok) {
                    throw new Error(sendResult.error || sendResult.reason || 'Send blocked');
                }
                await finalizeQuoteSent(quote.id, conv.id);
                return res.json({ sent: true, mode: 'template', sids: ['sent'], templateId: template.id });
            } catch (templateError: any) {
                // Template refused — fall through to the queue so the send is never just lost,
                // and tell the card what happened.
                console.warn('[QuotePrep] Template send failed, queueing instead:', templateError?.message);
            }
        }

        // No deliverable path right now: park the exact burst in the approval queue. When the
        // window reopens Ben approves it there; the quote-link hook in approveAndSendDraft then
        // flips this quote out of draft and stages the thread.
        const draftId = await queueDraft({
            phone,
            body,
            source: 'comms_agent',
            reason: `Quote ${slug} is ready to send but the WhatsApp window is shut. Approving sends it once the window reopens.`,
            dedupe: false,
        });
        return res.json({
            sent: false,
            queued: true,
            draftId,
            templatePending: !approved,
            message: approved
                ? 'Window shut and the template send did not go through, so it is queued for approval. The quote stays a draft until it actually sends.'
                : `Window shut and "${QUOTE_LINK_TEMPLATE}" is not approved by Meta yet, so it is queued for approval when the window reopens. The quote stays a draft until it actually sends.`,
        });
    } catch (error: any) {
        console.error('[QuotePrep] send-quote failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to send the quote' });
    }
});

// GET /api/agents/quote-prep/:conversationId/intake — the intake the AUTOMATIC handoff already
// prepped, if there is one.
//
// The manual "Prep quote" button runs the clerk synchronously and hands the result straight to the
// panel. Under direct send the clerk usually runs by itself (server/agents/comms.ts,
// maybeAutoQuotePrep) minutes before Ben ever opens the thread, so the intake is sitting in
// conversations.metadata with a Pushover alert already on his phone. Without this route the panel
// would have no way to reach it and he would pay for a second identical run to see it.
agentStaffRouter.get('/quote-prep/:conversationId/intake', async (req, res) => {
    try {
        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.id, req.params.conversationId));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        const meta = (conv.metadata ?? {}) as Record<string, any>;
        const intake = meta.quotePrepIntake ?? null;
        res.json({
            intake,
            preparedAt: meta.quotePrepAuto?.lastRunAt ?? null,
            readiness: intake?.readiness ?? meta.quotePrepAuto?.lastReadiness ?? null,
        });
    } catch (error: any) {
        console.error('[QuotePrep] Stored intake read failed:', error);
        res.status(500).json({ error: error?.message || 'Could not read the stored intake' });
    }
});

// POST /api/agents/quote-prep/:conversationId — run the intake clerk on one thread.
// Synchronous on purpose: the caller is a human who just clicked "Prep quote" and wants the
// prefill; a run takes ~20-40s and the button shows progress.
agentStaffRouter.post('/quote-prep/:conversationId', async (req, res) => {
    try {
        const { intake, summary, turns } = await runQuotePrep(req.params.conversationId);
        if (!intake) {
            return res.status(422).json({ error: 'NO_INTAKE', message: summary || 'The agent could not extract a usable intake from this thread.' });
        }
        res.json({ intake, summary, turns });
    } catch (error: any) {
        console.error('[QuotePrep] Run failed:', error);
        res.status(500).json({ error: error?.message || 'Quote prep failed' });
    }
});
