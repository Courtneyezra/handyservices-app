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
 * store today and Goal 1 deliberately left it unmounted on the production server. Re-mounting the
 * door's own router here - imported, not edited - is what lets Ben actually drive a sandbox thread
 * from the admin app rather than the board always reading empty.
 */
import { createSandboxDoor, type DoorDeps } from '../desk/sandbox-door';
import type { CaseFileStore } from '../desk/store';

let door: ReturnType<typeof createSandboxDoor> | null = null;

export function commsV2BoardDoor(deps: DoorDeps = {}): ReturnType<typeof createSandboxDoor> {
    if (!door) door = createSandboxDoor(deps);
    return door;
}

export function commsV2BoardStore(): CaseFileStore {
    return commsV2BoardDoor().gateway.store;
}
