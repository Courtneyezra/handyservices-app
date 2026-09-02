/**
 * Agent runs — the per-thread "what did it do and why" view (COMMS_AGENTS_V3_DESIGN §3.7, §8).
 *
 * Reads the `agent_runs` table that Phase 1 / A (the ledger pane) creates and the runner writes.
 * Queried with raw SQL on purpose: the table is owned by another branch, so this module must not
 * carry its own Drizzle definition (two definitions would collide at merge) and must degrade
 * cleanly when the table is not there yet — `available: false`, an empty list, never a 500.
 *
 * `conversation_id` is compared as text: the ledger brief types it uuid while conversations.id is
 * a dashless 32-hex varchar; casting both sides to text works whichever type lands.
 */
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from './db';

export const agentRunsRouter = Router();

export interface AgentRunRow {
    id: string;
    agent: string;
    trigger: string | null;
    decision: string | null;
    lane: string | null;
    guardsHit: string[];
    proposal: unknown;
    usage: unknown;
    costPence: number | null;
    durationMs: number | null;
    model: string | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    /** P6: the spine run this row is a child of (triage model call, vision, wrapped legacy runner); null on top-level runs. */
    parentRunId: string | null;
}

const MISSING_TABLE = '42P01';

export async function listAgentRuns(conversationId: string, limit = 50): Promise<{ runs: AgentRunRow[]; available: boolean }> {
    try {
        const result: any = await db.execute(sql`
            SELECT id, agent, trigger, decision, lane, guards_hit, proposal, usage, cost_pence, duration_ms,
                   model, error, started_at, finished_at,
                   -- P6: read through jsonb so a server ahead of migration 20260904 (no column yet) still answers.
                   to_jsonb(agent_runs)->>'parent_run_id' AS parent_run_id
            FROM agent_runs
            WHERE conversation_id::text = ${conversationId}
            ORDER BY started_at DESC NULLS LAST
            LIMIT ${limit}
        `);
        const rows: any[] = result.rows ?? result;
        return {
            available: true,
            runs: rows.map((r) => ({
                id: String(r.id),
                agent: String(r.agent ?? 'unknown'),
                trigger: r.trigger ?? null,
                decision: r.decision ?? null,
                lane: r.lane ?? null,
                guardsHit: Array.isArray(r.guards_hit) ? r.guards_hit.map(String) : [],
                proposal: r.proposal ?? null,
                usage: r.usage ?? null,
                costPence: r.cost_pence == null ? null : Number(r.cost_pence),
                durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
                model: r.model ?? null,
                error: r.error ?? null,
                startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
                finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
                parentRunId: r.parent_run_id ? String(r.parent_run_id) : null,
            })),
        };
    } catch (error: any) {
        if (error?.code === MISSING_TABLE || /relation "agent_runs" does not exist/i.test(String(error?.message))) {
            return { runs: [], available: false };
        }
        throw error;
    }
}

// GET /api/agent-runs?conversationId=…&limit=50
agentRunsRouter.get('/', async (req, res) => {
    const conversationId = String(req.query.conversationId ?? '').trim();
    if (!conversationId) return res.status(400).json({ error: "Missing 'conversationId'" });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    try {
        res.json(await listAgentRuns(conversationId, limit));
    } catch (error: any) {
        console.error('[AgentRuns] list failed:', error);
        res.status(500).json({ error: 'Failed to load agent runs' });
    }
});
