/**
 * Bridge to pane A's spine runner (Phase 2 / C). Only `requestRun` is imported, by name, from
 * server/spine/request-run.ts — the single entry point (§3.1: nothing else may run an agent).
 *
 * TODO(P2 merge): replace the dynamic import below with
 *     import { requestRun } from './request-run';
 * once pane A's module is on the branch. It is dynamic here because that file does not exist
 * in this worktree yet; the specifier is a variable so esbuild leaves it alone at bundle time.
 * Until then (and if the module is absent at runtime) callers fall back to the legacy path.
 */
import type { SpineApi, Trigger } from './types';

const REQUEST_RUN_MODULE = './request-run';

export async function requestRunOrNull(
    conversationId: string,
    trigger: Trigger,
    opts?: { delayMs?: number; runId?: string },
): Promise<{ queued: boolean; reason?: string } | null> {
    try {
        const mod = (await import(/* @vite-ignore */ REQUEST_RUN_MODULE)) as Partial<Pick<SpineApi, 'requestRun'>>;
        if (typeof mod?.requestRun !== 'function') return null;
        return await mod.requestRun(conversationId, trigger, opts);
    } catch (error: any) {
        console.warn('[Spine] request-run unavailable, legacy path stays in charge:', error?.message ?? error);
        return null;
    }
}
