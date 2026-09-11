/**
 * Goal 2 - a thin read-and-act API over Contract 2's case file, for Ben's kanban board.
 *
 * GET  /board                     - every case file, grouped into the seven Contract 2 columns
 * GET  /case-files/:id            - one file's turns and facts, read-only
 * POST /case-files/:id/release    - releases a hold; the case file's own `release` enforces the
 *                                    approver-and-words invariant, this route only carries the words
 *
 * /sandbox/* re-mounts the Goal 1 sandbox door unmodified (server/comms-v2/desk/sandbox-door.ts),
 * so the board has sandbox threads to show without duplicating that door's logic here.
 */
import { Router } from 'express';
import { boardOf, cardOf, detailOf, releaseHold, type BoardMode } from './board';
import { commsV2BoardDoor, commsV2BoardStore } from './store';

export const commsV2ApiRouter = Router();

commsV2ApiRouter.use('/sandbox', commsV2BoardDoor().router);

commsV2ApiRouter.get('/board', (req, res) => {
    const held = req.query.held === 'true' ? true : undefined;
    const mode = req.query.mode === 'sandbox' || req.query.mode === 'live' ? (req.query.mode as BoardMode) : undefined;
    res.json(boardOf(commsV2BoardStore().all(), { held, mode }));
});

commsV2ApiRouter.get('/case-files/:id', (req, res) => {
    const file = commsV2BoardStore().get(req.params.id);
    if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
    res.json(detailOf(file));
});

commsV2ApiRouter.post('/case-files/:id/release', (req, res) => {
    const file = commsV2BoardStore().get(req.params.id);
    if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
    const approverId = String(req.body?.approver ?? '').trim();
    const words = String(req.body?.words ?? '').trim();
    if (!approverId) { res.status(400).json({ error: 'an approver id is required' }); return; }
    const outcome = releaseHold(file, { kind: 'human', id: approverId }, words);
    if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
    res.json({ ok: true, card: cardOf(file), release: outcome.value });
});
