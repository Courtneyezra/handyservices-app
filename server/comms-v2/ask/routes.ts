/**
 * Handy Desk - the ask agent's HTTP layer, mounted at /api/comms-v2/ask inside the comms-v2 router
 * (api/routes.ts), so it sits behind requireAdmin like every board route.
 *
 * POST /sessions/today            - the signed-in person's session for today (London), created on first use
 * POST /sessions {title?}         - a fresh session
 * GET  /sessions?limit=           - the person's active sessions, newest first
 * GET  /sessions/:id              - { session, messages } (messages oldest first, AskMessageDTO)
 * POST /sessions/:id/archive
 * POST /sessions/:id/messages {text|content, via?, context?} -> 202 { runId }
 *
 * A message starts a run and returns at once; the run streams over the comms event bus
 * (server/comms-events.ts, GET /api/comms/events) with the ops_* events of shared/ops-types.ts:
 * ops_message (the ask) -> ops_run_started -> ops_run_event* -> ops_message (the answer, carrying
 * `answer: OpsAnswer`) -> ops_run_finished, which always fires. The bus reaches every admin
 * listener; clients filter by sessionId. One run per session at a time.
 *
 * A session belongs to the person who opened it: another person's session is a 404. There is no
 * send route here. The agent's one write is a draft on a case file's hold, sent by a person
 * through POST /api/comms-v2/case-files/:id/send-held-draft.
 */
import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { AskContext, AskMessageDTO, AskVia, LeanRunStep } from '@shared/ops-types';
import { readApproverAssignments, slotOf, type ReadApproverAssignments } from '../api/approvers';
import type { BoardSource } from '../api/store';
import { runAskTurn, type AskTurnDeps, type RunAskTurnOptions, type RunAskTurnResult } from './agent';
import { databaseAskSessionStore, dayTitle, londonDay, type AskSessionStore } from './sessions';

export interface AskRouterDeps {
    source: () => Promise<BoardSource>;
    approvers?: ReadApproverAssignments;
    sessions?: AskSessionStore;
    /** The turn itself; tests pass a scripted one. */
    runTurn?: (opts: RunAskTurnOptions, deps: AskTurnDeps) => Promise<RunAskTurnResult>;
    turnDeps?: Partial<AskTurnDeps>;
    emit?: (evt: import('../../comms-events').CommsEvent) => void;
    now?: () => Date;
}

const VIAS: readonly AskVia[] = ['typed', 'voice', 'tap'];
const MAX_ASK_CHARS = 2000;

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
        const raw = typeof req.body?.text === 'string' ? req.body.text : typeof req.body?.content === 'string' ? req.body.content : '';
        const content = raw.trim();
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
        // Set before any await below, so a second request on this tick is refused.
        if (activeRuns.has(sessionId)) { res.status(409).json({ error: 'run_active', runId: activeRuns.get(sessionId) }); return; }
        const runId = `ask_${randomUUID()}`;
        activeRuns.set(sessionId, runId);
        res.status(202).json({ runId });

        const stamp = () => now().toISOString();
        void (async () => {
            let ok = false;
            try {
                const ask = await sessions.append({ sessionId, role: 'user', content, via, context });
                emit({ type: 'ops_message', sessionId, message: ask, at: stamp() });
                const history = [...found.messages, ask].map((m) => ({ role: m.role, content: m.content }));
                emit({ type: 'ops_run_started', sessionId, runId, at: stamp() });

                const assignments = await approvers();
                const result = await runTurn({
                    sessionId, userMessage: content, via, context, history, person,
                    approver: slotOf((req as any).user, assignments),
                    onEvent: (step: LeanRunStep) => emit({ type: 'ops_run_event', sessionId, runId, step, at: stamp() }),
                }, { source: deps.source, assignments: async () => assignments, ...deps.turnDeps });

                const reply: AskMessageDTO = await sessions.append({
                    sessionId, role: 'assistant', content: result.answer.finalText, runId,
                    transcript: result.leanTranscript, answer: result.answer, usage: result.usage,
                });
                await sessions.touch(sessionId);
                emit({ type: 'ops_message', sessionId, message: reply, at: stamp() });
                ok = true;
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
    });

    return router;
}
