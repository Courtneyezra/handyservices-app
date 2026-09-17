/**
 * Goal 2 - a thin read-and-act API over Contract 2's case file, for Ben's kanban board.
 *
 * GET  /old-comms                 - is the old comms page retired for customers, because the new desk
 *                                    is live (server/comms-v2/old-comms.ts)? The sidebar and
 *                                    /admin/comms read it
 * GET  /board                     - every case file, grouped into the seven Contract 2 columns, plus
 *                                    `viewer` (viewerOf: the approver slot this session occupies and
 *                                    whether it can act at all, from the same lookup the write
 *                                    routes use), and `sandboxAvailable`: whether the sandbox door could write on
 *                                    this process's database (live-database.ts's
 *                                    commsV2DatabaseCheck) - false on production, so the board page
 *                                    hides its sandbox-only controls and mode badges there without a
 *                                    hostname check, failing towards hidden on any refusal reason
 * GET  /queue                     - Handy Desk's "Needs you" list (queue.ts): every held file, with
 *                                    its held draft and its office working-hours wait, longest first,
 *                                    with the same `viewer` as /board
 * GET  /case-files/:id            - one file's turns and facts, read-only, with the channel and
 *                                    window a reply from the thread would use
 * GET  /case-files/:id/template-offer - a dry run of send-template (desk/human-reply.ts
 *                                    previewWindowTemplate): the template it would send and its
 *                                    filled wording, or its exact refusal; sends nothing
 * POST /case-files/:id/release    - releases a hold as the signed-in user; the case file's own
 *                                    `release` enforces the approver-and-words invariant, this
 *                                    route only carries the words and names who is asking
 * POST /case-files/:id/close      - Ben closes the file by hand (file-close.ts `closeByHand`): it
 *                                    goes to done with `human:<email or user id>` on the stage
 *                                    change and his optional words; a standing hold is released
 *                                    first by the same rule as /release, else nothing changes. A
 *                                    closed file takes no more turns; the customer's next message
 *                                    opens a new one
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
 *                                    desk/human-reply.ts sendWindowTemplate: offers a template only
 *                                    when its wording is true for the thread (quote_ready_link with
 *                                    the quote link the file shows was sent, or
 *                                    answer_ready_reopen_v1 only over an unanswered question),
 *                                    never quote_accepted_ack_v1, enquiry_followup_optin_v1 or a
 *                                    marketing row
 *
 * /ask/* mounts the Handy Desk ask agent (server/comms-v2/ask/routes.ts) over the same store this
 * router reads; its one write is a draft on a hold, which goes out only through send-held-draft here.
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
import { Router, type Request, type Response } from 'express';
import { readApproverAssignments, readStaffNames, slotOf, type ApproverAssignments, type ReadApproverAssignments, type ReadStaffNames } from './approvers';
import { boardOf, cardOf, detailOf, type BoardMode } from './board';
import { queueOf } from './queue';
import { boardSourceFor, commsV2BoardDoor, type BoardSource, type BoardSourceFor } from './store';
import { release } from '../desk/case-file';
import { humanReply, previewWindowTemplate, sendHeldDraft, sendWindowTemplate } from '../desk/human-reply';
import type { TemplateStatusSource } from '../desk/sender';
import type { SandboxDoor } from '../desk/sandbox-door';
import { oldCommsRetired } from '../old-comms';
import { closeByHand } from '../file-close';
import { commsV2DatabaseCheck } from '../live-database';
import { createAskRouter, type AskRouterDeps } from '../ask/routes';

/**
 * Who is looking at the board, so it can show a read-only state before a write fails: the slot the
 * signed-in session occupies, through the same `slotOf` lookup every write route refuses on (403),
 * and whether it holds one. Holding a slot is necessary, not sufficient: a file answers only to its
 * own slot, which each write still checks.
 */
export interface BoardViewer {
    approver: string | null;
    canAct: boolean;
}

export function viewerOf(req: Request, assignments: ApproverAssignments): BoardViewer {
    const slot = slotOf((req as any).user, assignments);
    return { approver: slot?.id ?? null, canAct: !!slot };
}

export function createCommsV2ApiRouter(door: SandboxDoor = commsV2BoardDoor(), approvers: ReadApproverAssignments = readApproverAssignments, sourceFor: BoardSourceFor = boardSourceFor, retired: () => Promise<boolean> = () => oldCommsRetired(), names: ReadStaffNames = readStaffNames, sandboxAvailable: () => boolean = () => commsV2DatabaseCheck(process.env).ok, ask: Omit<AskRouterDeps, 'source' | 'approvers'> = {}, templates?: TemplateStatusSource): Router {
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
    router.use('/ask', createAskRouter({ ...ask, source: () => sourceFor(door), approvers }));

    router.get('/old-comms', async (_req, res) => {
        res.json({ retired: await retired() });
    });

    router.get('/board', async (req, res) => {
        const held = req.query.held === 'true' ? true : undefined;
        const mode = req.query.mode === 'sandbox' || req.query.mode === 'live' ? (req.query.mode as BoardMode) : undefined;
        const src = await source(res);
        if (!src) return;
        const assignments = await approvers();
        res.json({ ...boardOf(src.store.all(), { held, mode }, assignments), sandboxAvailable: sandboxAvailable(), viewer: viewerOf(req, assignments) });
    });

    router.get('/queue', async (req, res) => {
        const mode = req.query.mode === 'sandbox' || req.query.mode === 'live' ? (req.query.mode as BoardMode) : undefined;
        const src = await source(res);
        if (!src) return;
        const assignments = await approvers();
        res.json({ ...queueOf(src.store.all(), { mode }, assignments), sandboxAvailable: sandboxAvailable(), viewer: viewerOf(req, assignments) });
    });

    router.get('/case-files/:id', async (req, res) => {
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const detail = detailOf(file, await approvers());
        const humanEmails = detail.turns
            .map((t) => t.approver)
            .filter((a): a is string => !!a && a.startsWith('human:'))
            .map((a) => a.slice('human:'.length));
        const speakerNames = await names(humanEmails);
        res.json({ ...detail, speakerNames });
    });

    /**
     * What send-template would do on this file, without doing it: the template and its filled
     * wording, or the refusal the send would return. The same slot check as the send (401/403/404);
     * the plan itself is the send's own (desk/human-reply.ts planWindowTemplate), so the preview
     * cannot disagree with it. A refusal is a 200 with `ok: false`, because nothing was attempted.
     */
    router.get('/case-files/:id/template-offer', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to send' }); return; }
        const approver = slotOf(user, await approvers());
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        res.json(await previewWindowTemplate({ file, approver, person: user.email ?? user.id, mode: src.mode }, {}, templates));
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

    router.post('/case-files/:id/close', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to close a file' }); return; }
        const assignments = await approvers();
        const approver = slotOf(user, assignments);
        if (!approver) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const src = await source(res);
        if (!src) return;
        const file = src.store.get(req.params.id);
        if (!file) { res.status(404).json({ error: 'no such case file' }); return; }
        const words = typeof req.body?.words === 'string' ? req.body.words : '';
        const outcome = closeByHand(file, { approver, person: String(user.email ?? user.id ?? ''), words });
        if (!outcome.ok) { res.status(outcome.status).json({ error: outcome.reason }); return; }
        src.store.put(file);
        res.json({ ok: true, card: cardOf(file, assignments), change: outcome.change, release: outcome.release });
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
     * A template send on a shut window, through desk/human-reply.ts sendWindowTemplate: offers a
     * template only when its wording is true for the thread, per the captain's ruling. Same
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
        const outcome = await sendWindowTemplate({ file, approver, person: user.email ?? user.id, mode: src.mode }, {}, templates);
        if (!outcome.ok) { res.status(409).json({ error: outcome.reason }); return; }
        src.store.put(file);
        res.json({ ok: true, card: cardOf(file, assignments), sent: { approver: outcome.result.approver, runId: outcome.result.runId, bubbles: outcome.result.bubbles.map((b) => b.text), turnId: outcome.result.turnId }, release: outcome.release });
    });

    return router;
}
