/**
 * Worker lifecycle (P11): Railway restarts the worker on every deploy and sends SIGTERM first.
 *
 *   beginShutdown()   flip the flag: the due-run loops (runDue, the legacy fast tick) stop claiming
 *   isShuttingDown()  what they check
 *   track(promise)    every spine pass registers itself so the shutdown can wait for it
 *   drain(timeoutMs)  wait for in-flight passes, up to the grace budget; returns what is still running
 *
 * Pure bookkeeping, no db, so it is safe to import from anywhere and to unit-test.
 */

let shuttingDown = false;
const inFlight = new Map<string, { startedAt: number; label: string }>();
let seq = 0;

export function beginShutdown(): void {
    shuttingDown = true;
}

export function isShuttingDown(): boolean {
    return shuttingDown;
}

/** Register a pass; the returned release function is called when it settles (track() does it for you). */
export function track<T>(label: string, work: Promise<T>): Promise<T> {
    const id = `${Date.now()}_${++seq}`;
    inFlight.set(id, { startedAt: Date.now(), label });
    return work.finally(() => { inFlight.delete(id); });
}

export function inFlightRuns(): Array<{ label: string; ageMs: number }> {
    const now = Date.now();
    return Array.from(inFlight.values()).map((r) => ({ label: r.label, ageMs: now - r.startedAt }));
}

/** Wait until nothing is in flight or the budget is spent. Never throws. */
export async function drain(timeoutMs: number, pollMs = 250): Promise<{ drained: boolean; remaining: Array<{ label: string; ageMs: number }> }> {
    const until = Date.now() + Math.max(0, timeoutMs);
    while (inFlight.size > 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, pollMs));
    }
    return { drained: inFlight.size === 0, remaining: inFlightRuns() };
}

/** Tests only. */
export function _resetLifecycleForTests(): void {
    shuttingDown = false;
    inFlight.clear();
}
