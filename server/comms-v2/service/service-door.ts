/**
 * Goal 6's actions on the desk's sandbox door (desk/sandbox-door.ts mounts this): the fixture,
 * "Ben replies" (return to automation, checklist 7.4), the chase intervals (7.5), and the chase
 * ledger. Everything here goes through the same case file and desk the customer's turns do.
 *
 *   POST /fixture           write the knowledge-base rows and chase template approvals on the branch
 *   POST /ben-replies       { text } Ben's reply goes out through desk/human-reply.ts and releases the hold
 *   POST /chase-intervals   { chaseAfterMinutes, escalateAfterMinutes } test values; then /age and /run
 *   GET  /chase             the chase ledger for the current thread
 */
import { Router, type Request } from 'express';
import type { ApproverSlot, CaseFile, CaseFileDeps } from '../desk/case-file';
import type { ChaseState } from './chase';
import { humanReply } from '../desk/human-reply';
import { applySandboxFixture } from './fixture';
import { automationState } from './return-to-automation';

/**
 * Who a request may reply and release as. On a router the app mounts this is the slot the
 * signed-in session occupies (api/approvers.ts sessionApprover), never the request body; the
 * standalone door host, which has no session, is the only caller that names a slot itself.
 */
export type ApproverForRequest = (req: Request) => ApproverSlot | null | Promise<ApproverSlot | null>;

export interface ServiceDoorDeps extends CaseFileDeps {
    currentFile: () => CaseFile | null;
    chase: ChaseState;
    /** The door's state, so every response here carries it like the desk's own do. */
    stateOf: () => unknown;
    approver: ApproverForRequest;
}

export function serviceDoorRouter(deps: ServiceDoorDeps): Router {
    const router = Router();

    router.post('/fixture', async (_req, res) => {
        try {
            const out = await applySandboxFixture();
            res.json({ ok: true, fixture: out });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'fixture failed' });
        }
    });

    router.post('/ben-replies', async (req, res) => {
        const approver = await deps.approver(req);
        if (!approver || approver.kind !== 'human') { res.status(403).json({ error: 'no approver slot is assigned to this session' }); return; }
        const file = deps.currentFile();
        if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const user = (req as any).user;
        const out = await humanReply({ file, approver, person: user?.email ?? user?.id ?? approver.id, words: String(req.body?.text ?? '') }, { now: deps.now, newId: deps.newId });
        if (!out.ok) { res.status(400).json({ error: out.reason }); return; }
        if (out.release) deps.chase.ledger.clear(file.id);
        res.json({ ok: true, event: 'return_to_automation', turnId: out.result.turnId, approver: out.result.approver, channel: out.result.channel, released: out.release, automation: automationState(file), state: deps.stateOf() });
    });

    router.post('/chase-intervals', (req, res) => {
        const chase = Number(req.body?.chaseAfterMinutes);
        const escalate = Number(req.body?.escalateAfterMinutes);
        if (!Number.isFinite(chase) || chase <= 0 || !Number.isFinite(escalate) || escalate <= 0) { res.status(400).json({ error: 'chaseAfterMinutes and escalateAfterMinutes must be numbers above 0' }); return; }
        deps.chase.config.chaseAfterMs = Math.round(chase * 60_000);
        deps.chase.config.escalateAfterMs = Math.round(escalate * 60_000);
        res.json({ ok: true, intervals: { chaseAfterMinutes: chase, escalateAfterMinutes: escalate }, recipients: { ben: deps.chase.config.ben, owner: deps.chase.config.owner } });
    });

    router.get('/chase', (_req, res) => {
        const file = deps.currentFile();
        res.json({ ok: true, intervals: { chaseAfterMinutes: deps.chase.config.chaseAfterMs / 60_000, escalateAfterMinutes: deps.chase.config.escalateAfterMs / 60_000 }, recipients: { ben: deps.chase.config.ben, owner: deps.chase.config.owner }, record: file ? deps.chase.ledger.get(file.id) : null, automation: file ? automationState(file) : null });
    });

    return router;
}
