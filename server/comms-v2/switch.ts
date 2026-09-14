/**
 * The switch-over's one question: is the new desk the live desk in this process?
 *
 * Three switches, every one of them off by default, and the answer is yes only while all three are
 * on (behaviour.md answer 37: the addresses stay, the old inputs forward, the desk switch decides
 * which desk a turn reaches):
 *
 *   intake    `COMMS_V2_INTAKE=1` (channels/intake.ts): the old inputs forward to the new gateway
 *   desk      `spine.commsDesk = 'comms_v2'` (server/spine/config.ts `isCommsV2Desk`): the new desk
 *             is the one that answers
 *   delivery  `spine.senders.comms_v2.enabled = true` (desk/sender.ts): the new desk's own sends may
 *             leave the building
 *
 * And one condition of the process: it must be the comms worker (`COMMS_WORKER=1`,
 * server/worker-gate.ts). Production is one service that is both the web process and the worker
 * (docs/RUNBOOK.md), and the desk's clock runs only in the worker, so a process that is not the
 * worker never becomes the live desk: were the service ever split, the webhooks would reach a desk
 * no clock serves, and the answer here stays no rather than running one silently.
 *
 * Every live re-point asks here and nowhere else: the database the desk's store and tools open
 * (live-database.ts), and the store Ben's board reads (api/store.ts). With any one switch off the
 * answer is no and today's behaviour stands, so flipping one of them back is the roll-back.
 *
 * Fail closed: the spine row that cannot be read is read as its defaults (server/spine/config.ts),
 * which is the old desk, so an unreadable row is never a live desk.
 */
import { getSpineConfig, isCommsV2Desk, type SpineConfig } from '../spine/config';
import { intakeEnabled, INTAKE_ENV } from './channels/intake';
import { COMMS_WORKER_ENV, isCommsWorker } from '../worker-gate';

export type SwitchName = 'intake' | 'desk' | 'delivery' | 'worker';

export interface LiveState {
    live: boolean;
    /** The switches that are off, each named the way it is flipped. Empty exactly when `live`. */
    off: string[];
}

const NAMES: Record<SwitchName, string> = {
    intake: `${INTAKE_ENV}=1`,
    desk: "spine.commsDesk = 'comms_v2'",
    delivery: 'spine.senders.comms_v2.enabled = true',
    worker: `${COMMS_WORKER_ENV}=1 (this process is not the comms worker, where the desk's clock runs)`,
};

/** Pure: the live state from a config snapshot and an environment. */
export function commsV2LiveFrom(cfg: Pick<SpineConfig, 'commsDesk' | 'senders'> | null | undefined, env: NodeJS.ProcessEnv): LiveState {
    const on: Record<SwitchName, boolean> = {
        intake: intakeEnabled(env),
        desk: isCommsV2Desk(cfg),
        delivery: cfg?.senders?.comms_v2?.enabled === true,
        worker: isCommsWorker(env),
    };
    const off = (Object.keys(on) as SwitchName[]).filter((k) => !on[k]).map((k) => NAMES[k]);
    return { live: off.length === 0, off };
}

/** The live state now, read from the spine row and the environment. Never throws. */
export async function commsV2LiveState(env: NodeJS.ProcessEnv = process.env): Promise<LiveState> {
    let cfg: SpineConfig | null = null;
    try { cfg = await getSpineConfig(); } catch { cfg = null; }
    return commsV2LiveFrom(cfg, env);
}

export async function commsV2Live(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    return (await commsV2LiveState(env)).live;
}
