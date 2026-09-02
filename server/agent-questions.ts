/**
 * Ask-Ben questions — MOSTLY RETIRED (21 Aug 2026).
 *
 * The tap-question relay (agent raises a question with options, Ben taps, the agent rephrases his
 * answer) was replaced by the flag mechanism: escalation now tags the thread needs_ben, pings Ben,
 * and BEN REPLIES IN THE THREAD HIMSELF (server/agents/comms.ts, flagThreadForBen). The table
 * lives on with two jobs:
 *
 *   1. status 'flagged' — the audit log a flag writes: why Ben was needed, what the customer
 *      wanted, what the agent had already said. A log, not a queue; nothing consumes it, and the
 *      live "Ben is needed here" state is the needs_ben tag on the conversation.
 *   2. the legacy lifecycle open → answered → resolved / dismissed — kept so questions in flight
 *      when the relay retired still drain: the agent still reads 'answered' rows and resolves
 *      them, and the answer/dismiss routes below still work.
 */
import { Router } from 'express';
import { dueAtFor } from './working-hours';
import { db } from './db';
import { agentQuestions } from '@shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { recordQuestionProposal, recordQuestionVerdict, safely } from './agent-outcomes';

export const agentQuestionsRouter = Router();

/**
 * Raises a question for Ben. Returns the question id, or null when an open question already
 * exists for the conversation — one blocking question at a time keeps the thread readable and
 * stops an agent loop from spamming the queue.
 */
export async function askBen(input: {
    conversationId: string;
    phone: string;
    question: string;
    context?: string;
    options?: string[];
    source?: string;
    /** Override the default clock (4 office hours; 20 office minutes when `urgent`). */
    dueAt?: Date;
    /** callback_requested / priority urgent: the 20-minute clock. */
    urgent?: boolean;
}): Promise<string | null> {
    const [existing] = await db.select({ id: agentQuestions.id })
        .from(agentQuestions)
        .where(and(
            eq(agentQuestions.conversationId, input.conversationId),
            inArray(agentQuestions.status, ['open', 'answered']),
        ))
        .limit(1);
    if (existing) {
        console.log(`[AgentQuestions] Conversation ${input.conversationId} already has an open question`);
        return null;
    }

    const id = `aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(agentQuestions).values({
        id,
        conversationId: input.conversationId,
        phone: input.phone,
        question: input.question,
        context: input.context ?? null,
        options: input.options && input.options.length ? input.options : null,
        source: input.source ?? 'comms_agent',
        status: 'open',
        dueAt: input.dueAt ?? dueAtFor(input.urgent ? 'flag_urgent' : 'flag'),
    });
    // OUTCOME LEDGER — an escalation is a proposal too. Its fate (answered / dismissed / never
    // touched) is how you find out whether an agent is asking useful questions or hiding behind
    // them, and whether the options it offers are ever the ones Ben picks.
    safely('recordQuestionProposal', () => recordQuestionProposal({
        questionId: id,
        conversationId: input.conversationId,
        phone: input.phone,
        question: input.question,
        context: input.context ?? null,
        options: input.options ?? null,
        source: input.source ?? 'comms_agent',
    }));

    console.log(`[AgentQuestions] Asked: ${input.question.slice(0, 80)}`);
    return id;
}

/** Answered-but-unconsumed questions for one conversation — what the agent reads on its next run. */
export async function getAnsweredQuestions(conversationId: string) {
    return db.select().from(agentQuestions)
        .where(and(
            eq(agentQuestions.conversationId, conversationId),
            eq(agentQuestions.status, 'answered'),
        ))
        .orderBy(desc(agentQuestions.createdAt));
}

export async function markQuestionResolved(id: string): Promise<void> {
    await db.update(agentQuestions)
        .set({ status: 'resolved' })
        .where(eq(agentQuestions.id, id));
}

// GET /api/agent-questions — the open queue, oldest first (it's a worklist, not a feed).
agentQuestionsRouter.get('/', async (req, res) => {
    try {
        const status = String(req.query.status || 'open');
        // Phase 3: ?source=sampler gives the morning strip its own list without touching the queue.
        const source = typeof req.query.source === 'string' && req.query.source ? String(req.query.source) : null;
        const statusWhere = status === 'all'
            ? inArray(agentQuestions.status, ['open', 'answered', 'resolved', 'dismissed'])
            : eq(agentQuestions.status, status);
        const rows = await db.select().from(agentQuestions)
            .where(source ? and(statusWhere, eq(agentQuestions.source, source)) : statusWhere)
            .orderBy(desc(agentQuestions.createdAt))
            .limit(100);
        res.json({ questions: rows, openCount: rows.filter((q) => q.status === 'open').length });
    } catch (error: any) {
        console.error('[AgentQuestions] List failed:', error);
        res.status(500).json({ error: 'Failed to load questions' });
    }
});

// POST /api/agent-questions/:id/answer — Ben taps an option or types his own.
agentQuestionsRouter.post('/:id/answer', async (req, res) => {
    try {
        const { answer } = req.body || {};
        if (typeof answer !== 'string' || !answer.trim()) {
            return res.status(400).json({ error: "Missing 'answer'" });
        }
        const answeredBy = (req as any).user?.email || (req as any).user?.id || 'admin';
        const [updated] = await db.update(agentQuestions)
            .set({
                answer: answer.trim(),
                answeredBy,
                answeredAt: new Date(),
                status: 'answered',
            })
            .where(and(eq(agentQuestions.id, req.params.id), eq(agentQuestions.status, 'open')))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Question not found or no longer open' });
        safely('recordQuestionVerdict:answered', () => recordQuestionVerdict({
            questionId: updated.id, outcome: 'answered', answer: updated.answer, decidedBy: answeredBy,
        }));
        // Phase 3: a sampler row is Ben's verdict on an automatic send. His tap outranks the judge:
        // a second draft_verdicts row by human:<id> (the judge's row by agent.verifier stays for the
        // agreement stat). Reason chip is optional in the body.
        if (updated.source === 'sampler') {
            safely('sampler:humanVerdict', async () => {
                const { draftIdFromQuestionId, verdictFromAnswer } = await import('./spine/sampler');
                const { recordVerdict, isVerdictReason } = await import('./verdicts');
                const { humanApprover } = await import('./approver');
                const { messageDrafts } = await import('@shared/schema');
                const draftId = draftIdFromQuestionId(updated.id);
                if (!draftId) return;
                const [draft] = await db.select({ body: messageDrafts.body, runId: messageDrafts.runId }).from(messageDrafts).where(eq(messageDrafts.id, draftId)).limit(1);
                if (!draft) return;
                const verdict = verdictFromAnswer(updated.answer ?? '');
                const rawReason = (req.body || {}).reason;
                const reason = isVerdictReason(rawReason) ? rawReason : verdict === 'sample_fine' ? 'fine' : null;
                await recordVerdict({ draftId, runId: draft.runId ?? null, verdict, reason, originalBody: draft.body, finalBody: draft.body, by: humanApprover(answeredBy) });
            });
        }
        res.json({ question: updated });
    } catch (error: any) {
        console.error('[AgentQuestions] Answer failed:', error);
        res.status(500).json({ error: 'Failed to record answer' });
    }
});

// POST /api/agent-questions/:id/dismiss — Ben will deal with the thread himself.
agentQuestionsRouter.post('/:id/dismiss', async (req, res) => {
    try {
        const dismissedBy = (req as any).user?.email ?? 'admin';
        const [updated] = await db.update(agentQuestions)
            .set({ status: 'dismissed', answeredBy: dismissedBy, answeredAt: new Date() })
            .where(and(eq(agentQuestions.id, req.params.id), inArray(agentQuestions.status, ['open', 'answered'])))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Question not found or already closed' });
        safely('recordQuestionVerdict:dismissed', () => recordQuestionVerdict({
            questionId: updated.id, outcome: 'dismissed', decidedBy: dismissedBy,
        }));
        res.json({ question: updated });
    } catch (error: any) {
        console.error('[AgentQuestions] Dismiss failed:', error);
        res.status(500).json({ error: 'Failed to dismiss question' });
    }
});
