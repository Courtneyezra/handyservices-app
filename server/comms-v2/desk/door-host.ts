/**
 * The door host: the one way to reach the desk's sandbox door from outside the process.
 *
 * The desk's sandbox door (sandbox-door.ts) is an express router that is never on the production
 * server's routes in Goal 1. This mounts it on a loopback port for the length of a run, so the
 * pipeline's end-to-end test step, a script, or Ben's sandbox can drive it over HTTP: POST /start,
 * /message, /run, /age, /reset, GET /.
 *
 * It connects only to the Neon branch named by COMMS_V2_DATABASE_URL: it refuses to open without
 * it, refuses a value that names the production database, and never reads DATABASE_URL, so a
 * production .env cannot be driven by mistake. The machine-local env is loaded first, without
 * overriding anything.
 *
 * Nothing here reports a variable's value: a host carries its address only.
 */
import { loadCommsV2Env, resolveCommsV2Database } from '../env';

export const DOOR_MOUNT = '/api/comms-v2-sandbox';

export class DoorHostError extends Error {
    constructor(public readonly kind: 'refused' | 'unreachable', message: string) {
        super(message);
        this.name = 'DoorHostError';
    }
}

export interface DoorHost {
    /** The door's base URL on the loopback interface, mount included. */
    readonly url: string;
    /** Host and port, the only thing about the address a log carries. */
    readonly host: string;
    /** Which variable the database string came from, so a log can say so without the value. */
    readonly databaseFrom: string;
    close(): Promise<void>;
}

export interface DoorHostOptions {
    /** A fixed port; 0 (the default) takes any free one. */
    port?: number;
    /** Skip the machine-local file (tests). */
    loadMachineEnv?: boolean;
}

/**
 * Check the environment and put the branch string where the database module reads it. Split out
 * so the refusal rules are testable without opening a port; `openDoorHost` calls it first.
 */
export function prepareDoorEnv(env: NodeJS.ProcessEnv = process.env, loadMachineEnv = true): { databaseFrom: string } {
    if (loadMachineEnv) loadCommsV2Env({ env });
    const db = resolveCommsV2Database(env);
    if (!db.ok) throw new DoorHostError('refused', db.message);
    // The database module reads DATABASE_URL at import, so the branch is put there first; whatever
    // a .env held is never consulted.
    env.DATABASE_URL = db.url;
    return { databaseFrom: db.from };
}

/** Open the door: the desk's sandbox router in-process, on the desk's own branch database. */
export async function openDoorHost(opts: DoorHostOptions = {}): Promise<DoorHost> {
    const { databaseFrom } = prepareDoorEnv(process.env, opts.loadMachineEnv ?? true);
    let router: unknown;
    try {
        const { commsV2SandboxRouter } = await import('./sandbox-door');
        router = commsV2SandboxRouter();
    } catch (err: any) {
        throw new DoorHostError('unreachable', `the desk's sandbox router could not be loaded in-process: ${err?.message ?? err}. This process needs the branch database string and the model keys.`);
    }
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(DOOR_MOUNT, router as any);
    const server = await new Promise<import('node:http').Server>((resolve, reject) => {
        const s = app.listen(opts.port ?? 0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}${DOOR_MOUNT}`;
    return {
        url,
        host: `127.0.0.1:${port}`,
        databaseFrom,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
