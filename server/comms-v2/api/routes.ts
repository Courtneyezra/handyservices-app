/**
 * Goal 2 - a thin read-and-act API over Contract 2's case file, for Ben's kanban board.
 *
 * GET  /board                     - every case file, grouped into the seven Contract 2 columns
 * GET  /case-files/:id            - one file's turns and facts, read-only
 * POST /case-files/:id/release    - releases a hold as the signed-in user; the case file's own
 *                                    `release` enforces the approver-and-words invariant, this
 *                                    route only carries the words and names who is asking
 * POST /case-files/:id/answer     - Ben answers the customer in his own words through the desk's
 *                                    one sender (desk/human-reply.ts): his words go as typed with
 *                                    the signed-in person as approver and clear the hold; the
 *                                    guards never run over a person's own words (behaviour.md
 *                                    answer 43), and whatever the sender refuses comes back for
 *                                    the board to show him
 *
 * /sandbox/* mounts the Goal 1 sandbox door unmodified (server/comms-v2/desk/sandbox-door.ts),
 * so the board has sandbox threads to show without duplicating that door's logic here.
 *
 * Mounted behind requireAdmin (server/index.ts), which sets req.user; the approver is the slot the
 * `comms_v2_approvers` row assigns that session (approvers.ts), never the request body. A session
 * no slot lists cannot release.
 */
import { Router } from 'express';
import { readApproverAssignments, slotOf, type ReadApproverAssignments } from './approvers';
import { boardOf, cardOf, detailOf, type BoardMode } from './board';
import { commsV2BoardDoor } from './store';
import { release } from '../desk/case-file';
import { humanReply } from '../desk/human-reply';
import type { SandboxDoor } from '../desk/sandbox-door';

export function createCommsV2ApiRouter(door: SandboxDoor = commsV2BoardDoor(), approvers: ReadApproverAssignments = readApproverAssignments): Router {
    const router = Router();
    const store = () => door.gateway.store;

    router.use('/sandbox', door.router);

    router.get('/board', async (req, res) => {
        const held = req.query.held === 'true' ? true : undefined;
        const mode = req.query.mode === 'sandbox' || req.query.mode === 'live' ? (req.query.mode as BoardMode) : undefined;
        res.json(boardOf(store().all(), { held, mode }, await approvers()));
    });

    router.get('/case-files/:id', async (req, res) => {
        const file = store().get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        res.json(detailOf(file, await approvers()));
    });

    router.post('/case-files/:id/release', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to release' }); return; }
        const assignments = await approvers();
        const approver = slotOf(user, assignments);
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const file = store().get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const words = String(req.body?.words ?? '').trim();
        const outcome = release(file, approver, words);
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        res.json({ ok: true, card: cardOf(file, assignments), release: outcome.value });
    });

    /**
     * Ben answers the customer from the card. His words go out through the one sender under his own
     * `human:<email or user id>` approver, with the guards not run over them; a refusal from the
     * sender is returned for the board to show, never held silently (checklist 7.3, 7.4).
     */
    router.post('/case-files/:id/answer', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to answer' }); return; }
        const assignments = await approvers();
        const approver = slotOf(user, assignments);
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const file = store().get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const words = String(req.body?.words ?? '').trim();
        if (!words) { res.status(400).json({ error: 'an answer needs words' }); return; }
        const outcome = await humanReply({ file, approver, person: user.email ?? user.id, words });
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        res.json({ ok: true, card: cardOf(file, assignments), sent: { approver: outcome.result.approver, runId: outcome.result.runId, bubbles: outcome.result.bubbles.map((b) => b.text), turnId: outcome.result.landedTurnId }, release: outcome.release });
    });

    return router;
}
