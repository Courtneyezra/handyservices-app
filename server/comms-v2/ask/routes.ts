/**
 * Handy Desk - the ask agent's HTTP layer, mounted at /api/comms-v2/ask inside the comms-v2 router
 * (api/routes.ts), so it sits behind requireAdmin like every board route.
 *
 * POST /sessions/today            - the signed-in person's session for today (London), created on first use
 * POST /sessions {title?}         - a fresh session
 * GET  /sessions?limit=           - the person's active sessions, newest first
 * GET  /sessions/:id              - { session, messages } (messages oldest first, AskMessageDTO)
 * POST /sessions/:id/archive
 * POST /sessions/:id/messages {text, via?, context?} -> 202 { runId }
 * GET  /actions/:id                - one of the person's proposals (AskActionDTO)
 * POST /actions/:id/confirm        - run it (actions.ts `confirmAction`): 200 { action, repeat, continuedRunId },
 *                                    or 403 (no slot, or not the slot the file answers to), 404 (not one
 *                                    of this person's), 409 (refused, cancelled, already running),
 *                                    410 (expired), each with { error, action }
 * POST /actions/:id/cancel         - it will never run: 200 { action, repeat }
 *
 * A message starts a run and returns at once; the run streams over the comms event bus
 * (server/comms-events.ts, GET /api/comms/events) with the ops_* events of shared/ops-types.ts:
 * ops_message (the ask) -> ops_run_started -> ops_run_event* -> ops_message (the answer, carrying
 * `answer: OpsAnswer`) -> ops_run_finished, which always fires. The bus reaches every admin
 * listener; clients filter by sessionId. One run per session at a time.
 *
 * A session belongs to the person who opened it: another person's session, and its proposals, are
 * a 404. The agent writes nothing a customer sees: a draft on a case file's hold, and proposals.
 * A proposal runs only on its confirm here, as the signed-in person (`human:<email or user id>`)
 * with the approver slot their session occupies, both read from the session, never the body; the
 * body is ignored. A confirm or cancel moves the plan strip on the answer that offered it and
 * re-emits that message; a confirmed step with steps after it starts the next run of the chain
 * (via `tap`), so the next step is proposed on a fresh read.
 */
import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { AskContext, AskMessageDTO, AskVia, LeanRunStep } from '@shared/ops-types';
import { readApproverAssignments, slotOf, type ReadApproverAssignments } from '../api/approvers';
import type { BoardSource } from '../api/store';
import { runAskTurn, type AskTurnDeps, type RunAskTurnOptions, type RunAskTurnResult } from './agent';
import { databaseAskSessionStore, dayTitle, londonDay, type AskSessionStore } from './sessions';
import { actionDTO, cancelAction, confirmAction, databaseAskActionStore, type AskAction, type AskActionStore, type SettleCode, type SettleOutcome } from './actions';
import type { ActionKinds } from './action-kinds';
import { planAfter, remainingAfter } from './plan';

export interface AskRouterDeps {
    source: () => Promise<BoardSource>;
    approvers?: ReadApproverAssignments;
    sessions?: AskSessionStore;
    actions?: AskActionStore;
    kinds?: ActionKinds;
    /** The turn itself; tests pass a scripted one. */
    runTurn?: (opts: RunAskTurnOptions, deps: AskTurnDeps) => Promise<RunAskTurnResult>;
    turnDeps?: Partial<AskTurnDeps>;
    emit?: (evt: import('../../comms-events').CommsEvent) => void;
    /** The clock for session days and titles. */
    now?: () => Date;
    /** The clock proposals are made, expired and confirmed on; the wall clock by default. */
    actionClock?: () => Date;
}

const VIAS: readonly AskVia[] = ['typed', 'voice', 'tap'];
const MAX_ASK_CHARS = 2000;

const SETTLE_STATUS: Record<SettleCode, number> = { not_found: 404, no_slot: 403, wrong_slot: 403, expired: 410, closed: 409, in_progress: 409, refused: 409 };

function personOf(req: Request): string | null {
    const user = (req as any).user;
    const who = user?.email ?? user?.id;
    return who ? String(who) : null;
}

function contextOf(body: any): AskContext | null {
    const raw = body?.context;
    if (!raw || typeof raw !== 'object') return null;
    const caseFileId = typeof raw.caseFileId === 'string' && raw.caseFileId.trim() ? raw.caseFileId.trim().slice(0, 200) : null;
    const phone = typeof raw.phone === 'string' && raw.phone.trim() ? raw.phone.trim().slice(0, 200) : null;
    return caseFileId || phone ? { caseFileId, phone } : null;
}

const defaultEmit: NonNullable<AskRouterDeps['emit']> = (evt) => {
    void import('../../comms-events').then(({ emitCommsEvent }) => emitCommsEvent(evt)).catch((error) => {
        console.warn('[AskAgent] comms event emit failed (continuing):', error?.message ?? error);
    });
};

export function createAskRouter(deps: AskRouterDeps): Router {
    const router = Router();
    const sessions = deps.sessions ?? databaseAskSessionStore;
    const actions = deps.actions ?? databaseAskActionStore;
    const actionClock = deps.actionClock ?? (() => new Date());
    const approvers = deps.approvers ?? readApproverAssignments;
    const runTurn = deps.runTurn ?? runAskTurn;
    const now = deps.now ?? (() => new Date());
    const emit = (evt: Parameters<NonNullable<AskRouterDeps['emit']>>[0]) => {
        try { (deps.emit ?? defaultEmit)(evt); } catch (error: any) {
            console.warn('[AskAgent] comms event emit failed (continuing):', error?.message ?? error);
        }
    };
    /** sessionId -> runId. One process holds the runs; a restart ends them, and the lock with them. */
    const activeRuns = new Map<string, string>();

    router.use((req, res, next) => {
        if (!personOf(req)) { res.status(401).json({ error: 'a signed-in user is required to ask the desk' }); return; }
        next();
    });

    const owned = async (req: Request) => {
        const found = await sessions.get(req.params.id);
        return found && found.session.createdBy === personOf(req) ? found : null;
    };

    router.post('/sessions/today', async (req, res) => {
        try {
            const at = now();
            res.json(await sessions.forDay(personOf(req)!, londonDay(at), dayTitle(at)));
        } catch (error: any) {
            console.error('[AskAgent] today session failed:', error);
            res.status(500).json({ error: error?.message ?? 'session_failed' });
        }
    });

    router.post('/sessions', async (req, res) => {
        try {
            const at = now();
            const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 200) : dayTitle(at);
            res.status(201).json(await sessions.create(personOf(req)!, londonDay(at), title));
        } catch (error: any) {
            console.error('[AskAgent] create session failed:', error);
            res.status(500).json({ error: error?.message ?? 'create_failed' });
        }
    });

    router.get('/sessions', async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
            res.json(await sessions.list(personOf(req)!, limit));
        } catch (error: any) {
            console.error('[AskAgent] list sessions failed:', error);
            res.status(500).json({ error: error?.message ?? 'list_failed' });
        }
    });

    router.get('/sessions/:id', async (req, res) => {
        try {
            const found = await owned(req);
            if (!found) { res.status(404).json({ error: 'not_found' }); return; }
            res.json(found);
        } catch (error: any) {
            console.error('[AskAgent] get session failed:', error);
            res.status(500).json({ error: error?.message ?? 'get_failed' });
        }
    });

    router.post('/sessions/:id/archive', async (req, res) => {
        try {
            if (!(await owned(req))) { res.status(404).json({ error: 'not_found' }); return; }
            res.json(await sessions.archive(req.params.id));
        } catch (error: any) {
            console.error('[AskAgent] archive session failed:', error);
            res.status(500).json({ error: error?.message ?? 'archive_failed' });
        }
    });

    router.post('/sessions/:id/messages', async (req, res) => {
        const sessionId = req.params.id;
        const person = personOf(req)!;
        const content = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!content) { res.status(400).json({ error: 'an ask needs text' }); return; }
        if (content.length > MAX_ASK_CHARS) { res.status(400).json({ error: `an ask is at most ${MAX_ASK_CHARS} characters` }); return; }
        const via: AskVia = VIAS.includes(req.body?.via) ? req.body.via : 'typed';
        const context = contextOf(req.body);

        let found;
        try {
            found = await owned(req);
        } catch (error: any) {
            console.error('[AskAgent] read session failed:', error);
            res.status(500).json({ error: error?.message ?? 'message_failed' });
            return;
        }
        if (!found) { res.status(404).json({ error: 'not_found' }); return; }
        if (found.session.status === 'archived') { res.status(409).json({ error: 'session_archived' }); return; }
        const started = startRun({ req, sessionId, person, content, via, context, prior: found.messages });
        if ('busy' in started) { res.status(409).json({ error: 'run_active', runId: started.busy }); return; }
        res.status(202).json({ runId: started.runId });
    });

    /**
     * Starts a run on the session and returns at once, or names the run already going. The lock is
     * taken before any await, so a second request on this tick is refused.
     */
    function startRun(input: { req: Request; sessionId: string; person: string; content: string; via: AskVia; context: AskContext | null; prior: AskMessageDTO[] }): { runId: string } | { busy: string } {
        const { req, sessionId, person, content, via, context } = input;
        const busy = activeRuns.get(sessionId);
        if (busy) return { busy };
        const runId = `ask_${randomUUID()}`;
        activeRuns.set(sessionId, runId);

        const stamp = () => now().toISOString();
        void (async () => {
            let ok = false;
            try {
                const ask = await sessions.append({ sessionId, role: 'user', content, via, context });
                emit({ type: 'ops_message', sessionId, message: ask, at: stamp() });
                const history = [...input.prior, ask].map((m) => ({ role: m.role, content: m.content }));
                emit({ type: 'ops_run_started', sessionId, runId, at: stamp() });

                const assignments = await approvers();
                // What a message may cite as the person's instruction: their own asks, never a chain's taps.
                const instructions = [...input.prior, ask].filter((m) => m.role === 'user' && m.via !== 'tap').map((m) => ({ id: m.id, text: m.content }));
                const result = await runTurn({
                    sessionId, userMessage: content, via, context, history, person, askRunId: runId, instructions,
                    approver: slotOf((req as any).user, assignments),
                    onEvent: (step: LeanRunStep) => emit({ type: 'ops_run_event', sessionId, runId, step, at: stamp() }),
                }, { source: deps.source, assignments: async () => assignments, actions, kinds: deps.kinds, now: actionClock, ...deps.turnDeps });

                const reply: AskMessageDTO = await sessions.append({
                    sessionId, role: 'assistant', content: result.answer.finalText, runId,
                    transcript: result.leanTranscript, answer: result.answer, usage: result.usage,
                });
                emit({ type: 'ops_message', sessionId, message: reply, at: stamp() });
                ok = true;
                if (result.answer.confirm) {
                    // Without the message named, a confirm still runs; only the plan strip would not move.
                    await actions.attachMessage(runId, reply.id).catch((error) => console.error(`[AskAgent] could not name message ${reply.id} on run ${runId}'s proposals:`, error));
                }
                await sessions.touch(sessionId).catch((error) => console.error(`[AskAgent] touch session ${sessionId} failed after run ${runId}:`, error));
            } catch (error: any) {
                console.error(`[AskAgent] run ${runId} failed for session ${sessionId}:`, error);
                try {
                    const text = `That ask failed: ${String(error?.message ?? error).slice(0, 300)}`;
                    const failed = await sessions.append({ sessionId, role: 'assistant', content: text, runId, answer: { finalText: text, surface: { type: 'words' }, note: 'The run stopped part way. Check the card before acting: a draft held before the failure still stands.' } });
                    emit({ type: 'ops_message', sessionId, message: failed, at: stamp() });
                } catch (persistError) {
                    console.error('[AskAgent] could not record the failure:', persistError);
                }
            } finally {
                activeRuns.delete(sessionId);
                emit({ type: 'ops_run_finished', sessionId, runId, ok, at: stamp() });
            }
        })();
        return { runId };
    }

    /** Moves the plan strip on the answer that offered the proposal, and re-emits that message. Returns the plan as it now stands. */
    async function movePlan(action: AskAction) {
        if (!action.messageId) return null;
        const message = await sessions.message(action.messageId);
        const plan = message?.answer?.plan;
        if (!message?.answer || !plan) return null;
        const next = planAfter(plan, action);
        if (JSON.stringify(next) === JSON.stringify(plan)) return next;
        const updated = await sessions.setAnswer(message.id, { ...message.answer, plan: next });
        if (updated) emit({ type: 'ops_message', sessionId: action.sessionId, message: updated, at: now().toISOString() });
        return next;
    }

    const settle = (run: typeof confirmAction, what: string) => async (req: Request, res: import('express').Response) => {
        const person = personOf(req)!;
        try {
            const assignments = await approvers();
            const out: SettleOutcome = await run({
                id: req.params.id,
                person,
                approver: slotOf((req as any).user, assignments),
                ownsSession: async (sessionId) => (await sessions.get(sessionId))?.session.createdBy === person,
            }, { store: actions, source: deps.source, kinds: deps.kinds, now: actionClock });
            let continuedRunId: string | null = null;
            if (out.action && !(out.ok && out.repeat)) {
                const plan = await movePlan(out.action).catch((error) => {
                    console.error(`[AskAgent] could not move the plan for ${out.action?.id}:`, error);
                    return null;
                });
                const remaining = plan && out.ok && out.action.status === 'executed' ? remainingAfter(plan, out.action.id) : [];
                if (remaining.length) continuedRunId = await continueChain(req, out.action, remaining.map((s) => s.label));
            }
            if (out.ok) { res.json({ ok: true, repeat: out.repeat, action: actionDTO(out.action), continuedRunId }); return; }
            res.status(SETTLE_STATUS[out.code]).json({ error: out.reason, action: out.action ? actionDTO(out.action) : null });
        } catch (error: any) {
            console.error(`[AskAgent] ${what} ${req.params.id} failed:`, error);
            res.status(500).json({ error: error?.message ?? `${what}_failed` });
        }
    };

    /** The next run of a chain, after a confirmed step: the plan's remaining steps, asked as a tap. */
    async function continueChain(req: Request, action: AskAction, remaining: string[]): Promise<string | null> {
        const found = await sessions.get(action.sessionId);
        if (!found || found.session.status === 'archived') return null;
        const content = `Carry on with the plan: ${remaining.join(' · ')}`.slice(0, MAX_ASK_CHARS);
        const context: AskContext | null = action.caseFileId ? { caseFileId: action.caseFileId, phone: null } : null;
        const started = startRun({ req, sessionId: action.sessionId, person: personOf(req)!, content, via: 'tap', context, prior: found.messages });
        return 'runId' in started ? started.runId : null;
    }

    router.get('/actions/:id', async (req, res) => {
        try {
            const person = personOf(req)!;
            const action = await actions.get(req.params.id);
            if (!action || (await sessions.get(action.sessionId))?.session.createdBy !== person) { res.status(404).json({ error: 'no such proposal' }); return; }
            res.json(actionDTO(action));
        } catch (error: any) {
            console.error('[AskAgent] read proposal failed:', error);
            res.status(500).json({ error: error?.message ?? 'read_failed' });
        }
    });
    router.post('/actions/:id/confirm', settle(confirmAction, 'confirm'));
    router.post('/actions/:id/cancel', settle(cancelAction, 'cancel'));

    return router;
}
