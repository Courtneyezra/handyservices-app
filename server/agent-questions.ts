/**
 * Ask-Ben questions — the comms agent's structured escalation channel.
 *
 * When the agent cannot safely draft a reply (a date we may not do, money not covered by a quote,
 * a judgement call), it writes a question here with tappable answer options instead of guessing
 * or going silent. Ben answers in the thread; the agent's next run consumes the answer and turns
 * it into a draft — which still goes through the normal approval gate before sending.
 *
 * Lifecycle: open → answered → resolved. 'dismissed' means Ben will handle it himself.
 */
import { Router } from 'express';
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
        const rows = await db.select().from(agentQuestions)
            .where(status === 'all'
                ? inArray(agentQuestions.status, ['open', 'answered', 'resolved', 'dismissed'])
                : eq(agentQuestions.status, status))
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
