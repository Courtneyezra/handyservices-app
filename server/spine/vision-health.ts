/**
 * T14: is the describer working? (docs/comms-build/BRIEF-T14-gemini-model.md)
 *
 * describe_video fails closed by design: a failed description is a missing description and the pass
 * goes on. That is right for one photo and wrong for every photo — a retired model failed 445 times
 * in 30 hours and nothing said so. This is the one read that turns the newest vision rows into a
 * verdict, and the three places that show it (the sidebar badge on AI Staff, the Vision card on
 * /admin/staff, the sandbox's banner) all call it. No table, no push, no email.
 *
 * `failing` is true when the newest row failed for a configuration reason (the row's error starts
 * `config:` — the model, the key, the request; it will not clear on its own), or when every row in
 * the window failed (three or more). One timeout on an otherwise working describer is not failing.
 *
 * Sandbox rows count: the sandbox runs the same describer with the same key, and a working sandbox
 * pass after a fix is exactly the evidence that clears the badge.
 */
import { db } from '../db';
import { agentRuns } from '@shared/schema';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

export const VISION_HEALTH_WINDOW = 20;
/** Fewer failed rows than this, with no `config:` failure among them, is "not enough to say". */
export const VISION_HEALTH_MIN_STREAK = 3;

export interface VisionRow { startedAt: string | Date | null; decision: string | null; error: string | null }

export interface VisionHealth {
    status: 'ok' | 'failing' | 'idle' | 'unknown';
    failing: boolean;
    /** The newest failure is a configuration one: it will not clear until a person changes something. */
    permanent: boolean;
    /** The newest failed row's error column, verbatim (describe-video.ts failureLabel). */
    reason: string | null;
    /** Start of the unbroken run of failures that ends at the newest row. */
    since: string | null;
    lastAt: string | null;
    window: { runs: number; failed: number; described: number };
    checkedAt: string;
}

function iso(d: string | Date | null | undefined): string | null {
    if (!d) return null;
    const t = d instanceof Date ? d : new Date(d);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function failed(r: VisionRow): boolean {
    return r.decision === 'failed' || (!!r.error && r.decision !== 'described');
}

export function isConfigFailure(error: string | null | undefined): boolean {
    return typeof error === 'string' && /^config:/.test(error);
}

/** Pure: newest row first. */
export function assessVisionRows(rows: readonly VisionRow[], now: Date = new Date()): VisionHealth {
    const checkedAt = now.toISOString();
    const runs = rows.length;
    const failedCount = rows.filter(failed).length;
    const window = { runs, failed: failedCount, described: runs - failedCount };
    if (!runs) return { status: 'idle', failing: false, permanent: false, reason: null, since: null, lastAt: null, window, checkedAt };
    const newest = rows[0];
    const lastAt = iso(newest.startedAt);
    if (!failed(newest)) return { status: 'ok', failing: false, permanent: false, reason: null, since: null, lastAt, window, checkedAt };

    let streak = 0;
    while (streak < runs && failed(rows[streak])) streak++;
    const permanent = isConfigFailure(newest.error);
    const failing = permanent || streak >= Math.min(VISION_HEALTH_MIN_STREAK, VISION_HEALTH_WINDOW) && streak === runs;
    return {
        status: failing ? 'failing' : 'ok',
        failing,
        permanent,
        reason: newest.error ?? 'failed with no error recorded',
        since: iso(rows[streak - 1]?.startedAt),
        lastAt,
        window,
        checkedAt,
    };
}

/** The newest finished vision rows → a verdict. Never throws: a database fault reads as `unknown`. */
export async function visionHealth(): Promise<VisionHealth> {
    try {
        const rows = await db.select({ startedAt: agentRuns.startedAt, decision: agentRuns.decision, error: agentRuns.error })
            .from(agentRuns)
            .where(and(eq(agentRuns.agent, 'vision'), isNotNull(agentRuns.finishedAt)))
            .orderBy(desc(agentRuns.startedAt))
            .limit(VISION_HEALTH_WINDOW);
        return assessVisionRows(rows);
    } catch (error: any) {
        console.warn('[VisionHealth] could not read vision rows:', error?.message ?? error);
        return { status: 'unknown', failing: false, permanent: false, reason: null, since: null, lastAt: null, window: { runs: 0, failed: 0, described: 0 }, checkedAt: new Date().toISOString() };
    }
}
