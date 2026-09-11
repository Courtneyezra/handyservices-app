/**
 * Goal 2 - a thin read-and-act API over Contract 2's case file, for Ben's kanban board.
 *
 * GET  /board                     - every case file, grouped into the seven Contract 2 columns
 * GET  /case-files/:id            - one file's turns and facts, read-only
 * POST /case-files/:id/release    - releases a hold as the signed-in user; the case file's own
 *                                    `release` enforces the approver-and-words invariant, this
 *                                    route only carries the words and names who is asking
 *
 * /sandbox/* mounts the Goal 1 sandbox door unmodified (server/comms-v2/desk/sandbox-door.ts),
 * so the board has sandbox threads to show without duplicating that door's logic here.
 *
 * Mounted behind requireAdmin (server/index.ts), which sets req.user; the approver is derived from
 * that session, never from the request body.
 */
import { Router } from 'express';
import { boardOf, cardOf, detailOf, releaseHold, sessionApprover, type BoardMode } from './board';
import { commsV2BoardDoor } from './store';
import type { SandboxDoor } from '../desk/sandbox-door';

export function createCommsV2ApiRouter(door: SandboxDoor = commsV2BoardDoor()): Router {
    const router = Router();
    const store = () => door.gateway.store;

    router.use('/sandbox', door.router);

    router.get('/board', (req, res) => {
        const held = req.query.held === 'true' ? true : undefined;
        const mode = req.query.mode === 'sandbox' || req.query.mode === 'live' ? (req.query.mode as BoardMode) : undefined;
        res.json(boardOf(store().all(), { held, mode }));
    });

    router.get('/case-files/:id', (req, res) => {
        const file = store().get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        res.json(detailOf(file));
    });

    router.post('/case-files/:id/release', (req, res) => {
        const approver = sessionApprover((req as any).user);
        if (!approver) { res.status(401).json({ error: 'a signed-in user is required to release' }); return; }
        const file = store().get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const words = String(req.body?.words ?? '').trim();
        const outcome = releaseHold(file, approver, words);
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        res.json({ ok: true, card: cardOf(file), release: outcome.value });
    });

    return router;
}
