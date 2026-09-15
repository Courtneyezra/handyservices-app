/**
 * Goal 2 - a thin read-and-act API over Contract 2's case file, for Ben's kanban board.
 *
 * GET  /old-comms                 - is the old comms page retired for customers, because the new desk
 *                                    is live (server/comms-v2/old-comms.ts)? The sidebar and
 *                                    /admin/comms read it
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
 * POST /case-files/:id/send-held-draft - one tap: send the reply the desk held back exactly as it
 *                                    stands, through desk/human-reply.ts sendHeldDraft, the same
 *                                    pipeline as /answer with the held draft as the words
 * POST /case-files/:id/send-template   - a template send on a shut window, through
 *                                    desk/human-reply.ts sendReopenTemplate: always the registry's
 *                                    service_reply row (answer_ready_reopen_v1)
 *
 * /sandbox/* mounts the Goal 1 sandbox door unmodified (server/comms-v2/desk/sandbox-door.ts),
 * so the board has sandbox threads to show without duplicating that door's logic here.
 *
 * Which case files the other routes read and act on is decided per request (api/store.ts): the live
 * intake's durable store while the new desk is the live desk (server/comms-v2/switch.ts), the
 * sandbox door's otherwise. A release or an answer is put back to that store, so a durable one
 * writes it.
 *
 * Mounted behind requireAdmin (server/index.ts), which sets req.user; the approver is the slot the
 * `comms_v2_approvers` row assigns that session (approvers.ts), never the request body. A session
 * no slot lists cannot release.
 */
import { Router, type Response } from 'express';
import { readApproverAssignments, slotOf, type ReadApproverAssignments } from './approvers';
import { boardOf, cardOf, detailOf, type BoardMode } from './board';
import { boardSourceFor, commsV2BoardDoor, type BoardSource, type BoardSourceFor } from './store';
import { release } from '../desk/case-file';
import { humanReply, sendHeldDraft, sendReopenTemplate } from '../desk/human-reply';
import type { SandboxDoor } from '../desk/sandbox-door';
import { oldCommsRetired } from '../old-comms';

export function createCommsV2ApiRouter(door: SandboxDoor = commsV2BoardDoor(), approvers: ReadApproverAssignments = readApproverAssignments, sourceFor: BoardSourceFor = boardSourceFor, retired: () => Promise<boolean> = () => oldCommsRetired()): Router {
    const router = Router();
    /** The store this request reads (api/store.ts): the live desk's while it is live, else the sandbox door's. Null once a 503 has been sent. */
    const source = async (res: Response): Promise<BoardSource | null> => {
        try {
            return await sourceFor(door);
        } catch (error: any) {
            res.status(503).json({ error: `the new desk is the live desk but its store could not be opened: ${error?.message ?? error}` });
            return null;
        }
    };

    router.use('/sandbox', door.router);

    router.get('/old-comms', async (_req, res) => {
        res.json({ retired: await retired() });
    });

    router.get('/board', async (req, res) => {
        const held = req.query.held === 'true' ? true : undefined;
        const mode = req.query.mode === 'sandbox' || req.query.mode === 'live' ? (req.query.mode as BoardMode) : undefined;
        const src = await source(res);
        if (!src) return;
        res.json(boardOf(src.store.all(), { held, mode }, await approvers()));
    });

    router.get('/case-files/:id', async (req, res) => {
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        res.json(detailOf(file, await approvers()));
    });

    router.post('/case-files/:id/release', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to release' }); return; }
        const assignments = await approvers();
        const approver = slotOf(user, assignments);
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const words = String(req.body?.words ?? '').trim();
        const outcome = release(file, approver, words);
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        // The case file changes in place; a durable store writes it once it is put.
        src.store.put(file);
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
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const words = String(req.body?.words ?? '').trim();
        if (!words) { res.status(400).json({ error: 'an answer needs words' }); return; }
        const outcome = await humanReply({ file, approver, person: user.email ?? user.id, words, mode: src.mode });
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        src.store.put(file);
        res.json({ ok: true, card: cardOf(file, assignments), sent: { approver: outcome.result.approver, runId: outcome.result.runId, bubbles: outcome.result.bubbles.map((b) => b.text), turnId: outcome.result.turnId }, release: outcome.release });
    });

    /**
     * One tap: send the reply the desk held back exactly as it stands, through desk/human-reply.ts
     * sendHeldDraft. Same approver-slot check as release and answer above (Firstmate decision
     * hsa-comms-v2-board-conversation-view): only the slot this file's hold answers to may send it.
     */
    router.post('/case-files/:id/send-held-draft', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to send' }); return; }
        const assignments = await approvers();
        const approver = slotOf(user, assignments);
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const outcome = await sendHeldDraft({ file, approver, person: user.email ?? user.id, mode: src.mode });
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        src.store.put(file);
        res.json({ ok: true, card: cardOf(file, assignments), sent: { approver: outcome.result.approver, runId: outcome.result.runId, bubbles: outcome.result.bubbles.map((b) => b.text), turnId: outcome.result.turnId }, release: outcome.release });
    });

    /**
     * A template send on a shut window, through desk/human-reply.ts sendReopenTemplate: always the
     * registry's service_reply row (answer_ready_reopen_v1), per the same Firstmate decision. Same
     * approver-slot check as every other board action.
     */
    router.post('/case-files/:id/send-template', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to send' }); return; }
        const assignments = await approvers();
        const approver = slotOf(user, assignments);
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const outcome = await sendReopenTemplate({ file, approver, person: user.email ?? user.id, mode: src.mode });
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        src.store.put(file);
        res.json({ ok: true, card: cardOf(file, assignments), sent: { approver: outcome.result.approver, runId: outcome.result.runId, bubbles: outcome.result.bubbles.map((b) => b.text), turnId: outcome.result.turnId }, release: outcome.release });
    });

    return router;
}
