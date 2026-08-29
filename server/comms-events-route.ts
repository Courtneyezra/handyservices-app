/**
 * GET /api/comms/events — the SSE view over the in-process comms event bus.
 *
 * Replaces CommsPage's aggressive polling (board every 30s, drafts every 15s) with server
 * push. The stream is a VIEW, never the source of truth: the client refetches a snapshot on
 * connect/reconnect and treats each event purely as a cache-invalidation hint, so a dropped
 * event costs freshness, not correctness.
 *
 * Auth is the SAME requireAdmin session check as /api/drafts. One accommodation: the browser
 * EventSource API cannot set request headers, so this route also accepts the session token as
 * `?token=` and copies it into the Authorization header BEFORE requireAdmin runs — the
 * verification itself is unchanged and header auth (curl) still works.
 *
 * Registered in server/index.ts ABOVE the `/api/comms` mount (whose mount-level requireAdmin
 * would otherwise 401 the query-token request before it ever reached this shim) and therefore
 * well before the SPA catch-all.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAdmin } from './auth';
import { onCommsEvent } from './comms-events';

export const commsEventsRouter = Router();

/** EventSource cannot set headers — lift `?token=` into the header requireAdmin reads. */
function tokenFromQuery(req: Request, _res: Response, next: NextFunction): void {
    if (!req.headers.authorization && typeof req.query.token === 'string' && req.query.token) {
        req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
}

const HEARTBEAT_MS = 25_000;

commsEventsRouter.get('/api/comms/events', tokenFromQuery, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // A first comment so the client's `open` fires with bytes on the wire immediately.
    res.write(': connected\n\n');

    const unsubscribe = onCommsEvent((evt) => {
        try {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
        } catch (error: any) {
            // A broken pipe mid-write must never reach the emitter's caller.
            console.warn('[CommsEvents] SSE write failed:', error?.message);
        }
    });

    const heartbeat = setInterval(() => {
        try {
            res.write(': ping\n\n');
        } catch { /* close handler below does the cleanup */ }
    }, HEARTBEAT_MS);

    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});
