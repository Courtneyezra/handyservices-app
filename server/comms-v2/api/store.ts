/**
 * Where the board reads its case files from, for as long as the desk itself has no durable store
 * (server/comms-v2/desk/store.ts: "Goal 1 runs the desk in the sandbox, in process ... the
 * interface is what a durable store (Goal 2's kanban needs one) implements later"). Building that
 * durable store is bigger than this goal's brief, so the board reads a process-local instance of
 * the same sandbox door Goal 1 already built and proved against the judge - one Desk, one Gateway,
 * one in-memory CaseFileStore, all imported unmodified from server/comms-v2/desk.
 *
 * This is a second instance, not the judge's own module-private singleton (sandbox-door.ts's
 * `shared`, reached only through `commsV2SandboxRouter()`), because nothing exposes that instance's
 * store today and Goal 1 deliberately left it unmounted on the production server. The board mounts
 * this door's own router under /sandbox and its page posts start and message to it, which is how a
 * thread gets onto the board at all.
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
