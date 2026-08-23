/**
 * System event log — live-beta observability.
 *
 * One append-only stream of everything the machine DID: messages sent, drafts held for
 * approval, delivery failures, Pushover alerts, call verdicts. The console logs already
 * say all of this, but a console on a server nobody tails is where observability goes to
 * die — this table is the same story on a page (/admin/activity) that can be watched
 * while the system is new and being tested.
 *
 * logSystemEvent is fire-safe by contract: it NEVER throws and never awaits anything the
 * caller cares about, because a bookkeeping failure must never break the send, hold or
 * alert it describes. Callers may fire-and-forget (`void logSystemEvent(...)`).
 */
import { Router } from 'express';
import { db } from './db';
import { systemEvents } from '@shared/schema';
import { desc, eq, and, gt, type SQL } from 'drizzle-orm';

export type SystemEventKind =
    | 'send'            // a message actually left the building
    | 'hold'            // something was composed but parked for human approval
    | 'delivery_fail'   // a send that reached nobody (or only by fallback)
    | 'pushover'        // a phone alert was dispatched (or skipped, and why)
    | 'classification'  // the post-call classifier stored a verdict
    | 'sweep'           // a background sweep ran
    | 'release'         // something held was released
    | 'config_change'   // a switch was flipped
    | 'escalation'      // a human was pulled in
    | 'other';

const MAX_SUMMARY_CHARS = 300;

export interface LogSystemEventInput {
    kind: SystemEventKind;
    /** E.164 when the event concerns a customer. */
    phone?: string | null;
    /** Links the row to its thread on /admin/comms when known. */
    conversationId?: string | null;
    /** One human-readable line. Capped at 300 chars here so callers never think about it. */
    summary: string;
    /** Machine payload for drill-down. Must be JSON-serialisable. */
    detail?: Record<string, unknown> | null;
    /** Which module wrote it, e.g. 'outbound', 'message-drafts', 'pushover'. */
    source: string;
}

/**
 * Append one event. Never throws — failures are a console.warn and nothing else,
 * because the log must never be able to break the thing it is logging.
 */
export async function logSystemEvent(input: LogSystemEventInput): Promise<void> {
    try {
        const summary = (input.summary ?? '').trim();
        await db.insert(systemEvents).values({
            id: `sev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            kind: input.kind,
            phone: input.phone ? input.phone.slice(0, 32) : null,
            conversationId: input.conversationId ?? null,
            summary: summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` : summary,
            detail: input.detail ?? null,
            source: input.source.slice(0, 48),
        });
    } catch (e: any) {
        console.warn('[SystemEvents] log failed (event dropped, action unaffected):', e?.message);
    }
}

export const systemEventsRouter = Router();

// GET /api/system-events/summary — the scoreboard: per-day counts by kind over the last 7 UK
// days, plus draft-queue outcomes and the current pending depth. This is the "is the machine
// healthy today" read; the event stream below it is the "what exactly happened" read.
systemEventsRouter.get('/summary', async (_req, res) => {
    try {
        const { sql: rawSql } = await import('drizzle-orm');
        // Ofcom reserved test ranges (the suites' fixtures) are excluded — a morning of
        // suite runs must not read as 10 delivery failures on the ops scoreboard.
        const eventRows: any = await db.execute(rawSql`
            SELECT to_char(at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, kind, count(*)::int AS n
            FROM system_events
            WHERE at > now() - interval '7 days'
              AND (phone IS NULL OR (phone NOT LIKE '%7700900%' AND phone NOT LIKE '%1632960%'))
            GROUP BY 1, 2
        `);
        const draftRows: any = await db.execute(rawSql`
            SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, status, count(*)::int AS n
            FROM message_drafts
            WHERE created_at > now() - interval '7 days'
              AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%1632960%'
            GROUP BY 1, 2
        `);
        const pendingNow: any = await db.execute(rawSql`
            SELECT count(*)::int AS n FROM message_drafts
            WHERE status = 'pending' AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%1632960%'
        `);

        const days: Record<string, Record<string, number>> = {};
        for (const r of eventRows.rows) {
            (days[r.day] ??= {})[r.kind] = Number(r.n);
        }
        for (const r of draftRows.rows) {
            (days[r.day] ??= {})[`draft_${r.status}`] = Number(r.n);
        }
        res.json({
            days: Object.entries(days)
                .map(([day, counts]) => ({ day, ...counts }))
                .sort((a, b) => (a.day < b.day ? 1 : -1)),
            pendingDrafts: Number(pendingNow.rows[0]?.n ?? 0),
        });
    } catch (error: any) {
        console.error('[SystemEvents] Summary failed:', error);
        res.status(500).json({ error: 'Failed to load summary' });
    }
});

// GET /api/system-events?kind=&limit=&since= — newest first, for the /admin/activity page.
// `since` is an ISO timestamp; rows strictly after it. Limit defaults 100, caps at 500.
systemEventsRouter.get('/', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? req.query.kind.trim() : null;
        const sinceRaw = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
        const since = sinceRaw && !isNaN(sinceRaw.getTime()) ? sinceRaw : null;

        const conditions: SQL[] = [];
        if (kind) conditions.push(eq(systemEvents.kind, kind));
        if (since) conditions.push(gt(systemEvents.at, since));

        const rows = await db.select().from(systemEvents)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(systemEvents.at))
            .limit(limit);

        res.json({ events: rows, count: rows.length });
    } catch (error: any) {
        console.error('[SystemEvents] List failed:', error);
        res.status(500).json({ error: 'Failed to load system events' });
    }
});
