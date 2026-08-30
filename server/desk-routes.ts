/**
 * server/desk-routes.ts — Ben's Desk: one ranked list of everything waiting
 * on a human (replies, pending drafts, call tasks, SLA breaches).
 *
 * B-Phase0 stub: mounted at /api/desk (requireAdmin) so the path is reserved
 * and the client can build against it. B-WP4 replaces the 501 with the real
 * DeskItem[] merge (contract in shared/ops-types.ts).
 */
import { Router } from 'express';

export const deskRouter = Router();

deskRouter.all(/.*/, (_req, res) => {
    res.status(501).json({ error: 'not_implemented', detail: 'Desk API lands with B-WP4' });
});
