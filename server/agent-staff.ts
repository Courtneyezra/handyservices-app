/**
 * The AI staff directory — /api/agents/staff.
 *
 * Each agent module exports its own STAFF card and SYSTEM prompt, so this endpoint only
 * assembles them and attaches live stats from the tables the agents actually write to.
 * Nothing here is hand-maintained copy about an agent — if the card is wrong, fix it in
 * the agent's own file.
 */
import { Router } from 'express';
import { db } from './db';
import { messageDrafts, agentQuestions, appSettings, conversations } from '@shared/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { queueDraft } from './message-drafts';
import { STAFF as opsBriefStaff, SYSTEM as opsBriefSystem } from './agents/ops-brief';
import { STAFF as recoveryStaff, SYSTEM as recoverySystem } from './agents/recovery';
import { STAFF as commsStaff, SYSTEM as commsSystem, getCommsAgentConfig } from './agents/comms';
import { STAFF as quotePrepStaff, SYSTEM as quotePrepSystem, runQuotePrep } from './agents/quote-prep';

export const agentStaffRouter = Router();

type Stat = { label: string; value: number | string; tone?: 'good' | 'warn' | 'bad' | 'plain' };

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

    return {
        stats: [
            { label: 'Drafts awaiting approval', value: pending.n, tone: pending.n > 0 ? 'warn' : 'plain' },
            { label: 'Approved & sent (7d)', value: sent7d.n, tone: 'good' },
            { label: 'Rejected (7d)', value: rejected7d.n, tone: rejected7d.n > 0 ? 'bad' : 'plain' },
            { label: 'Questions waiting on Ben', value: openQ.n, tone: openQ.n > 0 ? 'warn' : 'plain' },
            { label: 'Answers ready to consume', value: answeredQ.n, tone: 'plain' },
        ],
        statusChips: [
            { label: config.enabled ? 'SLA SWEEP ON' : 'SLA SWEEP OFF', on: config.enabled },
            { label: config.autosend.enabled ? `AUTO-SEND ON (${config.autosend.intents.join(', ')})` : 'AUTO-SEND OFF', on: config.autosend.enabled },
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

    return {
        stats: [
            { label: 'Nudges awaiting approval', value: r.proposed, tone: r.proposed > 0 ? 'warn' : 'plain' },
            { label: 'Approved (7d)', value: r.approved_7d, tone: 'good' },
            { label: 'Skipped with reason (7d)', value: r.skipped_7d, tone: 'plain' },
            { label: 'Nudges proposed all-time', value: r.total_nudges, tone: 'plain' },
        ],
        statusChips: [{ label: 'PROPOSE-ONLY', on: true }],
    };
}

// GET /api/agents/staff — the full directory with live stats.
agentStaffRouter.get('/staff', async (_req, res) => {
    try {
        const [comms, recovery] = await Promise.all([commsStats(), recoveryStats()]);
        res.json({
            staff: [
                {
                    ...commsStaff,
                    system: commsSystem,
                    accent: 'emerald',
                    ...comms,
                },
                {
                    ...recoveryStaff,
                    system: recoverySystem,
                    accent: 'amber',
                    ...recovery,
                },
                {
                    ...quotePrepStaff,
                    system: quotePrepSystem,
                    accent: 'sky',
                    stats: [],
                    statusChips: [{ label: 'ON-DEMAND', on: true }],
                },
                {
                    ...opsBriefStaff,
                    system: opsBriefSystem,
                    accent: 'sky',
                    stats: [],
                    statusChips: [{ label: 'READ-ONLY', on: true }],
                },
            ],
        });
    } catch (error: any) {
        console.error('[AgentStaff] Failed to build directory:', error);
        res.status(500).json({ error: 'Failed to load staff directory' });
    }
});

// POST /api/agents/quote-prep/:conversationId/request-details — queue the "what's the
// postcode / what name goes on the quote" ask into the comms draft queue. Deterministic
// copy (brand voice: whatsapp-comms.md — postcode only, never full address, no em dashes,
// short bursts split by '---'). Nothing sends here: the draft waits for Ben's approval.
agentStaffRouter.post('/quote-prep/:conversationId/request-details', async (req, res) => {
    try {
        const fields: string[] = Array.isArray(req.body?.fields) ? req.body.fields : [];
        const wantName = fields.includes('name');
        const wantPostcode = fields.includes('postcode');
        if (!wantName && !wantPostcode) {
            return res.status(400).json({ error: "fields must include 'name' and/or 'postcode'" });
        }

        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.id, req.params.conversationId));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) return res.status(422).json({ error: 'Conversation has no usable phone' });

        // One question max per reply: the postcode gets the question, the name rides
        // along as a statement. Never the full address — that's collected at booking.
        const body = wantPostcode && wantName
            ? 'Nearly ready to price this up for you.\n---\nWhat’s the postcode? Just so we can price it properly.\n---\nAnd a name to put on the quote would help too.'
            : wantPostcode
                ? 'Quick one so we can get your quote sorted.\n---\nWhat’s the postcode? Just so we can price it properly.'
                : 'Nearly ready to send your quote over.\n---\nWhat name should we put on it?';

        const missing = [wantName ? 'name' : null, wantPostcode ? 'postcode' : null].filter(Boolean).join(' + ');
        const draftId = await queueDraft({
            phone: `+${digits}`,
            body,
            source: 'comms_agent',
            reason: `Quote prep is waiting on the customer's ${missing}`,
        });

        // null = suppressed as a duplicate (an unsent comms_agent draft already exists
        // for this number) — tell the card so it shows "already queued", not an error.
        res.json({ queued: !!draftId, draftId });
    } catch (error: any) {
        console.error('[QuotePrep] request-details failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to queue the ask' });
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
