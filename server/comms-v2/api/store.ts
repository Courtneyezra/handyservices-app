/**
 * Where the board reads its case files from, for as long as the desk itself has no durable store
 * (server/comms-v2/desk/store.ts is an in-process Map behind the interface a durable store
 * implements later). Building that durable store is bigger than this goal's brief, so the board
 * reads a process-local instance of the same sandbox door Goal 1 already built and the pipeline's
 * test step drives - one Desk, one Gateway, one in-memory CaseFileStore, all imported unmodified
 * from server/comms-v2/desk.
 *
 * This is a second instance, not the door host's module-private singleton (sandbox-door.ts's
 * `shared`, reached only through `commsV2SandboxRouter()` from door-host.ts), because nothing
 * exposes that instance's store today and Goal 1 deliberately left it unmounted on the production
 * server. The board mounts this door's own router under /sandbox and its page posts start and
 * message to it, which is how a thread gets onto the board at all.
 *
 * The door replaces its gateway on every /start and /reset, so the store is read through the door
 * each time and never captured.
 */
import { createSandboxDoor, type DoorDeps, type SandboxDoor } from '../desk/sandbox-door';

let door: SandboxDoor | null = null;

export function commsV2BoardDoor(deps: DoorDeps = {}): SandboxDoor {
    if (!door) door = createSandboxDoor(deps);
    return door;
}
