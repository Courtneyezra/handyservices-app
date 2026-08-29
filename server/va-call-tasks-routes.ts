/**
 * /api/va-call-tasks — admin surface for the speed-to-lead call tasks
 * (server/agents/va-call-tasks.ts, 28 Aug 2026).
 *
 * Read the list, mark a task called, dismiss one with a reason. That is the whole API on
 * purpose: creation, expiry and auto-completion are the machinery's job (comms-lanes,
 * call-thread, comms-sweep) — a human can only settle a task, never mint one, so the admin
 * page can never become a second, unguarded entry point into the pipeline.
 *
 * Mounted behind requireAdmin in server/index.ts, like every other admin router.
 */
import { Router } from "express";
import { sendSuccess, sendError, sendBadRequest } from "./lib/api-response";
import {
    listVaCallTasks,
    completeVaCallTask,
    dismissVaCallTask,
} from "./agents/va-call-tasks";

export const vaCallTasksRouter = Router();

/** GET / — open tasks (soonest due first) + recently resolved ones. */
vaCallTasksRouter.get('/', async (_req, res) => {
    try {
        sendSuccess(res, await listVaCallTasks());
    } catch (err) {
        console.error('[va-call-tasks] list failed:', err);
        sendError(res, 'Failed to list call tasks', 500);
    }
});

/** POST /:id/complete — "Mark called". 404s if the task already resolved (the module's
 *  update is a CAS on the open state, so a double-tap or a race with the call-ingest
 *  auto-complete settles it exactly once). */
vaCallTasksRouter.post('/:id/complete', async (req, res) => {
    try {
        const task = await completeVaCallTask(req.params.id);
        if (!task) return sendError(res, 'Task not found or already resolved', 404);
        sendSuccess(res, { task });
    } catch (err) {
        console.error('[va-call-tasks] complete failed:', err);
        sendError(res, 'Failed to complete call task', 500);
    }
});

/** POST /:id/dismiss { reason } — a human takes the task off the list, on the record. */
vaCallTasksRouter.post('/:id/dismiss', async (req, res) => {
    try {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        if (!reason) return sendBadRequest(res, 'A dismiss reason is required');
        const task = await dismissVaCallTask(req.params.id, 'human:admin', reason);
        if (!task) return sendError(res, 'Task not found or already resolved', 404);
        sendSuccess(res, { task });
    } catch (err) {
        console.error('[va-call-tasks] dismiss failed:', err);
        sendError(res, 'Failed to dismiss call task', 500);
    }
});
