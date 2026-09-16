/**
 * The live desk's clock: a clock pass over every file that can have something due, once a minute,
 * in the comms worker, while the new desk is the live desk.
 *
 * A clock pass never messages a customer (desk/desk.ts `clockPass`): it chases Ben on an unpriced
 * draft (4.5, recorded on the file) and on a standing hold, then the owner (7.5, desk-started
 * template sends under their own purpose, service/chase.ts). Without this caller no chase would
 * ever fire on a live thread: the sandbox door's `/run` is the only other one.
 *
 * Registered by server/cron.ts behind `gateCustomerLoop`, so only a `COMMS_WORKER=1` process runs
 * it, and every tick asks `commsV2Live()` first (which also requires the worker), so with any switch
 * off a tick does nothing at all. Ticks never overlap: one still running when the next is due is
 * skipped. A pass that throws on one file is logged and the rest still run.
 */
import type { CaseFile } from '../desk/case-file';
import type { DeskResult } from '../desk/desk-types';
import { draftToRecover } from '../quoting/background-draft';

export const LIVE_CLOCK_CRON = '* * * * *';

/** What the tick needs from the intake's gateway. */
export interface ClockableGateway {
    store: { all(): CaseFile[] };
    clock(fileId: string): Promise<DeskResult | null>;
}

export interface LiveClockDeps {
    liveState?: () => Promise<{ live: boolean; off: string[] }>;
    gateway?: () => Promise<ClockableGateway>;
    log?: (line: string) => void;
}

export interface LiveClockTick { ran: boolean; off: string[]; files: number; chased: number; refused: number; errors: number }

/**
 * A file a clock pass can do something for: held (Ben's chase), carrying a quote (the unpriced
 * draft's chase), holding a chase record to clear, or holding a burst of customer messages for the
 * desk (the file's `waits`) - ordinarily one a live process is still timing or answering, which the
 * pass leaves alone, but one a restart left behind is how that burst reaches the desk
 * (gateway.ts `clock`), or a quote draft a restart lost, which the pass starts again or holds for Ben
 * (quoting/background-draft.ts). Never a finished job.
 */
export function clockDue(file: CaseFile): boolean {
    return file.stage !== 'done' && (!!file.hold || !!file.job.quoteRef || !!file.chase || !!file.waits?.length || !!draftToRecover(file));
}

export async function liveClockTick(deps: LiveClockDeps = {}): Promise<LiveClockTick> {
    const log = deps.log ?? ((line: string) => console.log(`[comms-v2 clock] ${line}`));
    const readState = deps.liveState ?? (async () => (await import('../switch')).commsV2LiveState());
    const state = await readState();
    if (!state.live) return { ran: false, off: state.off, files: 0, chased: 0, refused: 0, errors: 0 };
    const gateway = await (deps.gateway ?? (async () => (await import('./intake')).liveChannelGateway()))();
    const due = gateway.store.all().filter(clockDue);
    let chased = 0;
    let refused = 0;
    let errors = 0;
    for (const file of due) {
        try {
            const r = await gateway.clock(file.id);
            if (r?.chase?.action === 'chased' || r?.chase?.action === 'escalated') chased++;
            else if (r?.chase?.action === 'refused') refused++;
        } catch (err: any) {
            errors++;
            log(`clock pass on case ${file.id} failed: ${err?.message ?? err}`);
        }
    }
    if (chased || refused || errors) log(`${due.length} file(s) passed: ${chased} chase(s) sent, ${refused} refused, ${errors} failed`);
    return { ran: true, off: [], files: due.length, chased, refused, errors };
}

let ticking = false;

/** One tick, unless the last one is still running. */
export async function runLiveClockTick(deps: LiveClockDeps = {}): Promise<LiveClockTick | null> {
    if (ticking) return null;
    ticking = true;
    try {
        return await liveClockTick(deps);
    } finally {
        ticking = false;
    }
}
