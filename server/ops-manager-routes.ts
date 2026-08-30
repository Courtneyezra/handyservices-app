/**
 * server/ops-manager-routes.ts — Ops Manager sessions + messages HTTP layer.
 *
 * B-Phase0 stub: mounted at /api/ops (requireAdmin) so the path is reserved
 * and the client can build against it. B-WP2 replaces the 501 with the real
 * session/message/run endpoints (contracts in shared/ops-types.ts).
 */
import { Router } from 'express';

export const opsManagerRouter = Router();

opsManagerRouter.all(/.*/, (_req, res) => {
    res.status(501).json({ error: 'not_implemented', detail: 'Ops Manager API lands with B-WP2' });
});
