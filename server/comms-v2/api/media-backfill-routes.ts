/**
 * The media backfill over the board's store (server/comms-v2/media-backfill.ts): the live desk's
 * while the new desk is live, the sandbox door's otherwise (api/store.ts). It has to run in this
 * process: the live store holds every case file in memory and writes each one whole
 * (desk/database-store.ts), so a case file edited in the table from outside would be written over
 * by the next put.
 *
 * POST /media-backfill/plan   - reads only: the lost items in scope, each one ready (with its
 *                               old-desk twin and the new url it would get), left for a person (with
 *                               its candidates, which a person looks at and names in `choices`) or
 *                               without a twin, and the plan's `digest`. Body, all optional:
 *                               `arrivedBefore` (ISO instant), `choices` ({ media id: message id })
 * POST /media-backfill/apply  - the same body plus `digest` (from the plan the person read) and
 *                               `expect` (how many lost items they expect in scope). Plans again and
 *                               writes nothing unless both still hold; then copies each ready twin to
 *                               its new name and re-links the item and its quote rows. Only a session
 *                               the `comms_v2_approvers` row lists for a slot may apply
 *
 * The router is mounted under /api/comms-v2, behind requireAdmin.
 */
import { Router, type Response } from 'express';
import { slotOf, type ReadApproverAssignments } from './approvers';
import type { BoardSource } from './store';
import { applyBackfill, planBackfill, restoredFileName, type BackfillIo, type BackfillOptions, type BackfillPlan } from '../media-backfill';
import type { DatabasePurpose } from '../live-database';

export interface MediaBackfillRouterDeps {
    source: () => Promise<BoardSource>;
    approvers: ReadApproverAssignments;
    io?: (purpose: DatabasePurpose) => BackfillIo;
    now?: () => Date;
}

async function liveIo(purpose: DatabasePurpose): Promise<BackfillIo> {
    return (await import('../media-backfill-io')).backfillIoFor(purpose);
}

function optionsOf(body: any): BackfillOptions | string {
    const arrivedBefore = body?.arrivedBefore == null ? null : String(body.arrivedBefore);
    if (arrivedBefore && Number.isNaN(Date.parse(arrivedBefore))) return 'arrivedBefore must be an ISO date and time';
    const raw = body?.choices ?? {};
    if (typeof raw !== 'object' || Array.isArray(raw)) return 'choices must be an object of media id to message id';
    const choices: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v !== 'string' || !v) return 'each choice must name a message id';
        choices[k] = v;
    }
    return { arrivedBefore, choices };
}

/** The plan as the person reads it: counts, then each item by its ids, never a customer's words or number. */
export function planView(plan: BackfillPlan) {
    const ready = plan.pairings.flatMap((p) => p.outcome === 'ready' ? [{ mediaId: p.item.mediaId, fileId: p.item.fileId, kind: p.item.kind, by: p.by, twinMessageId: p.twin.messageId, twinUrl: `/api/media/${p.twin.file}`, newUrl: `/api/media/${restoredFileName(p.item.mediaId, p.twin.file)}` }] : []);
    const needsPerson = plan.pairings.flatMap((p) => p.outcome === 'needs_person' ? [{
        mediaId: p.item.mediaId, fileId: p.item.fileId, kind: p.item.kind, at: p.item.at, why: p.why,
        candidates: p.candidates.map((c) => ({ messageId: c.messageId, url: `/api/media/${c.file}`, gapMs: Date.parse(p.item.at) - Date.parse(c.at) })),
    }] : []);
    const noTwin = plan.pairings.flatMap((p) => p.outcome === 'no_twin' ? [{ mediaId: p.item.mediaId, fileId: p.item.fileId, kind: p.item.kind, why: p.why }] : []);
    return {
        digest: plan.digest,
        counts: { lost: plan.lost, ready: ready.length, needsPerson: needsPerson.length, noTwin: noTwin.length, outOfScope: plan.outOfScope, alive: plan.alive, alreadyRestored: plan.alreadyRestored },
        ready, needsPerson, noTwin, refusedChoices: plan.refusedChoices,
    };
}

export function createMediaBackfillRouter(deps: MediaBackfillRouterDeps): Router {
    const router = Router();
    const ioFor = async (purpose: DatabasePurpose) => (deps.io ? deps.io(purpose) : liveIo(purpose));
    const source = async (res: Response): Promise<BoardSource | null> => {
        try {
            return await deps.source();
        } catch (error: any) {
            res.status(503).json({ error: `the new desk is the live desk but its store could not be opened: ${error?.message ?? error}` });
            return null;
        }
    };

    router.post('/plan', async (req, res) => {
        const opts = optionsOf(req.body);
        if (typeof opts === 'string') { res.status(400).json({ error: opts }); return; }
        const src = await source(res);
        if (!src) return;
        try {
            const plan = await planBackfill(src.store, await ioFor(src.live ? 'live' : 'sandbox'), opts);
            res.json({ ok: true, live: src.live, ...planView(plan) });
        } catch (error: any) {
            res.status(500).json({ error: `the plan could not be made: ${error?.message ?? error}` });
        }
    });

    router.post('/apply', async (req, res) => {
        const user = (req as any).user;
        if (!user) { res.status(401).json({ error: 'a signed-in user is required to apply the backfill' }); return; }
        if (!slotOf(user, await deps.approvers())) { res.status(403).json({ error: 'no approver slot is assigned to this user' }); return; }
        const opts = optionsOf(req.body);
        if (typeof opts === 'string') { res.status(400).json({ error: opts }); return; }
        const digest = typeof req.body?.digest === 'string' ? req.body.digest : '';
        const expect = Number(req.body?.expect);
        if (!digest || !Number.isInteger(expect) || expect < 0) { res.status(400).json({ error: 'digest (from the plan) and expect (how many lost items the plan showed) are required' }); return; }
        const src = await source(res);
        if (!src) return;
        try {
            const outcome = await applyBackfill(src.store, await ioFor(src.live ? 'live' : 'sandbox'), { ...opts, digest, expect }, deps.now);
            if (!outcome.ok) { res.status(outcome.status).json({ error: outcome.error, ...planView(outcome.plan) }); return; }
            res.json({ ok: true, live: src.live, result: outcome.result });
        } catch (error: any) {
            res.status(500).json({ error: `the backfill stopped: ${error?.message ?? error}` });
        }
    });

    return router;
}
