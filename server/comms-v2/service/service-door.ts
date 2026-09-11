/**
 * Goal 6's actions on the desk's sandbox door (desk/sandbox-door.ts mounts this): the fixture,
 * "Ben replies" (return to automation, checklist 7.4), the chase intervals (7.5), and the chase
 * ledger. Everything here goes through the same case file and desk the customer's turns do.
 *
 *   POST /fixture           write the knowledge-base rows and chase template approvals on the branch
 *   POST /ben-replies       { text, by?, surface? } Ben's reply lands on the thread and releases the hold
 *   POST /chase-intervals   { chaseAfterMinutes, escalateAfterMinutes } test values; then /age and /run
 *   GET  /chase             the chase ledger for the current thread
 */
import { Router } from 'express';
import type { CaseFile, CaseFileDeps } from '../desk/case-file';
import type { ChaseState } from './chase';
import { applySandboxFixture } from './fixture';
import { automationState, humanReply, type HumanSurface } from './return-to-automation';

export interface ServiceDoorDeps extends CaseFileDeps {
    currentFile: () => CaseFile | null;
    chase: ChaseState;
    /** The door's state, so every response here carries it like the desk's own do. */
    stateOf: () => unknown;
}

const SURFACES: readonly HumanSurface[] = ['kanban', 'admin', 'handset', 'email', 'sandbox'];

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

    router.post('/ben-replies', (req, res) => {
        const file = deps.currentFile();
        if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const text = String(req.body?.text ?? '').trim();
        if (!text) { res.status(400).json({ error: 'text is required: a human reply needs words' }); return; }
        const surface = SURFACES.includes(req.body?.surface) ? (req.body.surface as HumanSurface) : 'sandbox';
        const by = String(req.body?.by ?? 'ben').trim() || 'ben';
        const out = humanReply(file, { by, surface, text }, { now: deps.now, newId: deps.newId });
        if (!out.ok) { res.status(400).json({ error: out.reason }); return; }
        if (out.released) deps.chase.ledger.clear(file.id);
        res.json({ ok: true, event: 'return_to_automation', turnId: out.turn.id, approver: out.approver, surface, released: out.released, stillHeldBy: out.stillHeldBy, automation: automationState(file), state: deps.stateOf() });
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
