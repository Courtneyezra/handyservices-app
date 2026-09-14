/**
 * Where the board reads its case files from.
 *
 * While the new desk is the live desk (server/comms-v2/switch.ts `commsV2Live`: the intake, the
 * desk switch and the new desk's sender switch all on, in the comms worker) the board reads the live
 * intake's durable store (channels/intake.ts, desk/database-store.ts) on the database in use, and a
 * person's answer from a card goes out in the delivery mode that intake's desk runs in. Otherwise,
 * which is today and every run of the pipeline, it reads a process-local instance of the same sandbox
 * door Goal 1 already built and the pipeline's test step drives - one Desk, one Gateway, one
 * in-memory CaseFileStore, all imported unmodified from server/comms-v2/desk - and answers in dry run.
 *
 * The door is a second instance, not the door host's module-private singleton (sandbox-door.ts's
 * `shared`, reached only through `commsV2SandboxRouter()` from door-host.ts), because nothing
 * exposes that instance's store today and Goal 1 deliberately left it unmounted on the production
 * server. The board mounts this door's own router under /sandbox whatever the switches say, which is
 * how a sandbox thread gets onto the board for a test; that door writes only the branch.
 *
 * The door replaces its gateway on every /start and /reset, and the intake's gateway is rebuilt
 * when a switch moves, so the store is looked up on every request and never captured.
 */
import { createSandboxDoor, type DoorDeps, type SandboxDoor } from '../desk/sandbox-door';
import type { CaseFileStore } from '../desk/store';

let door: SandboxDoor | null = null;

export function commsV2BoardDoor(deps: DoorDeps = {}): SandboxDoor {
    if (!door) door = createSandboxDoor(deps);
    return door;
}

/** The door only where one is already open, for a reader with nothing to find otherwise (`quoting/ben-to-request.ts`). */
export function commsV2BoardDoorIfOpen(): SandboxDoor | null {
    return door;
}

/** The store a board request reads and acts on, whether it is the live desk's, and how an answer from a card is delivered. */
export interface BoardSource {
    store: CaseFileStore;
    live: boolean;
    mode: 'dry_run' | 'live';
}

export type BoardSourceFor = (door: SandboxDoor) => Promise<BoardSource>;

/** The live intake's store while the new desk is live, else the sandbox door's. Throws when the new desk is live and its gateway cannot be built, with the reason. */
export const boardSourceFor: BoardSourceFor = async (sandbox) => {
    const { commsV2Live } = await import('../switch');
    if (!(await commsV2Live())) return { store: sandbox.gateway.store, live: false, mode: 'dry_run' };
    const { INTAKE_DESK_MODE, liveChannelGateway } = await import('../channels/intake');
    const gateway = await liveChannelGateway();
    return { store: gateway.store, live: true, mode: INTAKE_DESK_MODE.live };
};
