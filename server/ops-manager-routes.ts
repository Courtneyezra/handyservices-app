/**
 * server/ops-manager-routes.ts — Ops Manager sessions + messages HTTP layer (B-WP2).
 *
 * Mounted at /api/ops behind requireAdmin in server/index.ts, so every handler
 * here already has (req as any).user set. Wire contracts (DTO shapes, ops_*
 * event variants) are FROZEN in shared/ops-types.ts — conform, don't reinvent.
 *
 * SSE limitation, by design: the comms event bus (server/comms-events.ts →
 * GET /api/comms/events) broadcasts every event to ALL connected admin/VA
 * listeners. There is no per-session stream — clients filter ops_* events by
 * sessionId themselves. A dropped event costs freshness, not correctness:
 * messages are DB rows and the client re-GETs the session on reconnect.
 *
 * The agent itself (server/agents/ops-manager.ts) is B-WP1's file and may not
 * exist yet in this tree — it is loaded via a typeof-guarded dynamic import.
 * When unavailable, a run still completes properly: the turn finishes with an
 * assistant row explaining the agent isn't deployed, and ops_run_finished
 * still fires (the try/finally mirrors server/agents/comms.ts:1245-1269).
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { opsSessions, opsMessages, type OpsSession, type OpsMessage } from '@shared/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { emitCommsEvent } from './comms-events';
import type {
    LeanRunStep,
    OpsMessageDTO,
    OpsSessionDTO,
    RunOpsManagerTurn,
} from '@shared/ops-types';

export const opsManagerRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// DTO shaping — dates are ISO strings on the wire (shared/ops-types.ts)
// ─────────────────────────────────────────────────────────────────────────────

function toSessionDTO(row: OpsSession): OpsSessionDTO {
    return {
        id: row.id,
        title: row.title,
        createdBy: row.createdBy,
        status: (row.status === 'archived' ? 'archived' : 'active'),
        createdAt: (row.createdAt ?? new Date()).toISOString(),
        updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    };
}

function toMessageDTO(row: OpsMessage): OpsMessageDTO {
    return {
        id: row.id,
        sessionId: row.sessionId,
        role: (row.role === 'assistant' ? 'assistant' : 'user'),
        content: row.content,
        runId: row.runId ?? null,
        transcript: (row.transcript as LeanRunStep[] | null) ?? null,
        usage: row.usage ?? null,
        createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
}

/** requireAdmin attaches the users row; prefer the stable id, fall back to email. */
function actorFrom(req: any): string {
    return String(req.user?.id ?? req.user?.email ?? 'admin');
}

/** Bus emits are observability, never allowed to fail a request or a run. */
function emit(evt: Parameters<typeof emitCommsEvent>[0]): void {
    try { emitCommsEvent(evt); } catch (error: any) {
        console.warn('[OpsManager] comms event emit failed (continuing):', error?.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run lock — ONE active run per session, held in memory. Good enough for a
// single-process dev/prod server; a restart clears it, which is correct
// because the run died with the process.
// ─────────────────────────────────────────────────────────────────────────────

const activeRuns = new Map<string, string>(); // sessionId → runId

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/ops/sessions {title?} → OpsSessionDTO
opsManagerRouter.post('/sessions', async (req, res) => {
    try {
        const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const title = rawTitle.slice(0, 200) || `Ops session — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
        const [row] = await db.insert(opsSessions).values({
            id: randomUUID(),
            title,
            createdBy: actorFrom(req),
            status: 'active',
        }).returning();
        res.status(201).json(toSessionDTO(row));
    } catch (error: any) {
        console.error('[OpsManager] create session failed:', error);
        res.status(500).json({ error: error?.message ?? 'create_failed' });
    }
});

// GET /api/ops/sessions?limit= → active sessions, newest first
opsManagerRouter.get('/sessions', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
        const rows = await db.select().from(opsSessions)
            .where(eq(opsSessions.status, 'active'))
            .orderBy(desc(opsSessions.createdAt))
            .limit(limit);
        res.json(rows.map(toSessionDTO));
    } catch (error: any) {
        console.error('[OpsManager] list sessions failed:', error);
        res.status(500).json({ error: error?.message ?? 'list_failed' });
    }
});

// GET /api/ops/sessions/:id → {session, messages} (messages oldest first)
opsManagerRouter.get('/sessions/:id', async (req, res) => {
    try {
        const [session] = await db.select().from(opsSessions).where(eq(opsSessions.id, req.params.id));
        if (!session) { res.status(404).json({ error: 'not_found' }); return; }
        const messages = await db.select().from(opsMessages)
            .where(eq(opsMessages.sessionId, session.id))
            .orderBy(asc(opsMessages.createdAt));
        res.json({ session: toSessionDTO(session), messages: messages.map(toMessageDTO) });
    } catch (error: any) {
        console.error('[OpsManager] get session failed:', error);
        res.status(500).json({ error: error?.message ?? 'get_failed' });
    }
});

// POST /api/ops/sessions/:id/archive
opsManagerRouter.post('/sessions/:id/archive', async (req, res) => {
    try {
        const [row] = await db.update(opsSessions)
            .set({ status: 'archived', updatedAt: new Date() })
            .where(eq(opsSessions.id, req.params.id))
            .returning();
        if (!row) { res.status(404).json({ error: 'not_found' }); return; }
        res.json(toSessionDTO(row));
    } catch (error: any) {
        console.error('[OpsManager] archive session failed:', error);
        res.status(500).json({ error: error?.message ?? 'archive_failed' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Messages → runs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * B-WP1 owns server/agents/ops-manager.ts and it may not exist yet. Load it
 * lazily and guardedly so these routes work either way.
 */
async function loadRunOpsManagerTurn(): Promise<RunOpsManagerTurn | null> {
    try {
        const mod: any = await import('./agents/ops-manager');
        if (typeof mod?.runOpsManagerTurn === 'function') return mod.runOpsManagerTurn as RunOpsManagerTurn;
    } catch { /* module not deployed yet */ }
    return null;
}

const AGENT_UNAVAILABLE_TEXT =
    "The Ops Manager agent isn't deployed on this server yet (server/agents/ops-manager.ts lands with B-WP1). " +
    'Your message has been saved to the session — re-send it once the agent is live.';

// POST /api/ops/sessions/:id/messages {content} → 202 {runId}
//
// The HTTP response is immediate; the run continues async and streams over the
// comms bus (ops_run_started → ops_run_event* → ops_message → ops_run_finished).
opsManagerRouter.post('/sessions/:id/messages', async (req, res) => {
    const sessionId = req.params.id;
    try {
        const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
        if (!content) { res.status(400).json({ error: 'content required' }); return; }

        const [session] = await db.select().from(opsSessions).where(eq(opsSessions.id, sessionId));
        if (!session) { res.status(404).json({ error: 'not_found' }); return; }
        if (session.status === 'archived') { res.status(409).json({ error: 'session_archived' }); return; }

        // ONE run per session. In-memory check-then-set is fine single-process:
        // Express handlers up to here run on one tick per request, and the Map
        // is set synchronously before any await below can interleave another
        // request past this same guard.
        if (activeRuns.has(sessionId)) { res.status(409).json({ error: 'run_active', runId: activeRuns.get(sessionId) }); return; }
        const runId = randomUUID();
        activeRuns.set(sessionId, runId);

        res.status(202).json({ runId });

        // ── async continuation — never touches `res` again ──────────────────
        void (async () => {
            let runOk = false;
            try {
                // 1. Persist + announce the user turn.
                const [userRow] = await db.insert(opsMessages).values({
                    id: randomUUID(),
                    sessionId,
                    role: 'user',
                    content,
                }).returning();
                emit({ type: 'ops_message', sessionId, message: toMessageDTO(userRow), at: new Date().toISOString() });

                // 2. History for the agent (oldest first, includes the new user row).
                const historyRows = await db.select().from(opsMessages)
                    .where(eq(opsMessages.sessionId, sessionId))
                    .orderBy(asc(opsMessages.createdAt));
                const history = historyRows.map(toMessageDTO);

                emit({ type: 'ops_run_started', sessionId, runId, at: new Date().toISOString() });

                // 3. Run the agent (or the honest fallback when B-WP1 hasn't landed).
                let finalText = AGENT_UNAVAILABLE_TEXT;
                let leanTranscript: LeanRunStep[] | null = null;
                let usage: unknown = null;

                const runTurn = await loadRunOpsManagerTurn();
                if (runTurn) {
                    const result = await runTurn({
                        sessionId,
                        userMessage: content,
                        history,
                        onEvent: (step) => emit({ type: 'ops_run_event', sessionId, runId, step, at: new Date().toISOString() }),
                    });
                    finalText = result.finalText || '(no response)';
                    leanTranscript = result.leanTranscript ?? null;
                    usage = result.usage ?? null;
                }

                // 4. Persist + announce the assistant turn.
                const [assistantRow] = await db.insert(opsMessages).values({
                    id: randomUUID(),
                    sessionId,
                    role: 'assistant',
                    content: finalText,
                    runId,
                    transcript: leanTranscript,
                    usage,
                }).returning();
                await db.update(opsSessions).set({ updatedAt: new Date() }).where(eq(opsSessions.id, sessionId));
                emit({ type: 'ops_message', sessionId, message: toMessageDTO(assistantRow), at: new Date().toISOString() });

                runOk = true;
            } catch (error: any) {
                console.error(`[OpsManager] run ${runId} failed for session ${sessionId}:`, error);
                // Best-effort failure row so the thread shows WHY it went quiet.
                try {
                    const [failRow] = await db.insert(opsMessages).values({
                        id: randomUUID(),
                        sessionId,
                        role: 'assistant',
                        content: `The run failed: ${String(error?.message ?? error).slice(0, 500)}`,
                        runId,
                    }).returning();
                    emit({ type: 'ops_message', sessionId, message: toMessageDTO(failRow), at: new Date().toISOString() });
                } catch (persistErr) {
                    console.error('[OpsManager] failed to persist failure row:', persistErr);
                }
            } finally {
                // Mirrors server/agents/comms.ts:1245-1269 — the finished event
                // ALWAYS fires and the lock ALWAYS releases, success or not.
                activeRuns.delete(sessionId);
                emit({ type: 'ops_run_finished', sessionId, runId, ok: runOk, at: new Date().toISOString() });
            }
        })();
    } catch (error: any) {
        activeRuns.delete(sessionId);
        console.error('[OpsManager] post message failed:', error);
        if (!res.headersSent) res.status(500).json({ error: error?.message ?? 'message_failed' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dev replay — canned run over the bus so B-WP3 can build the chat dock UI
// without burning model runs. View-only: persists NOTHING. Same pattern as
// /api/comms/events/dev-replay-run (server/comms-events-route.ts).
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
    opsManagerRouter.post('/dev-replay', (req, res) => {
        const sessionId = String(req.query.session ?? req.body?.sessionId ?? '');
        if (!sessionId) { res.status(400).json({ error: 'session query param (or body.sessionId) required' }); return; }
        const runId = `demo-${Date.now()}`;
        const at = () => new Date().toISOString();
        const step = (s: Omit<LeanRunStep, 'at'>): LeanRunStep => ({ at: at(), ...s });
        const demoMessage = (): OpsMessageDTO => ({
            id: `demo-msg-${Date.now()}`,
            sessionId,
            role: 'assistant',
            content: 'Demo reply: 3 quotes are waiting on Ben, 1 SLA breach on the Rectory thread. I queued a chase draft for approval — nothing was sent.',
            runId,
            transcript: null,
            usage: null,
            createdAt: at(),
        });
        const steps: Array<[number, () => void]> = [
            [0, () => emit({ type: 'ops_run_started', sessionId, runId, at: at() })],
            [700, () => emit({ type: 'ops_run_event', sessionId, runId, at: at(), step: step({ type: 'tool_call', tool: 'get_desk', input: {} }) })],
            [1900, () => emit({ type: 'ops_run_event', sessionId, runId, at: at(), step: step({ type: 'tool_result', tool: 'get_desk', result: 'ok' }) })],
            [2500, () => emit({ type: 'ops_run_event', sessionId, runId, at: at(), step: step({ type: 'assistant', detail: { text: 'Three items need attention — drafting a chase for the oldest.' } }) })],
            [3200, () => emit({ type: 'ops_run_event', sessionId, runId, at: at(), step: step({ type: 'tool_call', tool: 'queue_draft', input: {} }) })],
            [5000, () => emit({ type: 'ops_run_event', sessionId, runId, at: at(), step: step({ type: 'tool_result', tool: 'queue_draft', result: 'ok' }) })],
            [5600, () => emit({ type: 'ops_message', sessionId, message: demoMessage(), at: at() })],
            [6000, () => emit({ type: 'ops_run_finished', sessionId, runId, ok: true, at: at() })],
        ];
        for (const [delay, fire] of steps) setTimeout(fire, delay);
        res.json({ ok: true, runId, durationMs: 6000 });
    });
}
