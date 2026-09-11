/**
 * The door host: the one way to reach the desk's sandbox door from outside the process.
 *
 * The desk's sandbox door (sandbox-door.ts) is an express router that is never on the production
 * server's routes in Goal 1. This mounts it on a loopback port for the length of a run, so the
 * pipeline's end-to-end test step, a script, or Ben's sandbox can drive it over HTTP: POST /start,
 * /message, /run, /age, /reset, GET /.
 *
 * It connects only to the Neon branch named by COMMS_V2_DATABASE_URL, read from the ordinary
 * environment (the pipeline's run copies inherit it through direnv): it refuses to open without
 * it, refuses a value that names the production database, and never reads DATABASE_URL, so a
 * production .env cannot be driven by mistake.
 *
 * Nothing here reports a variable's value: a host carries its address only.
 */
import { isProductionDatabaseUrl } from '../../worker-gate';

export const DOOR_MOUNT = '/api/comms-v2-sandbox';

/** The one database variable the desk reads. */
export const COMMS_V2_DATABASE_ENV = 'COMMS_V2_DATABASE_URL';

export type DatabaseResolution =
    | { ok: true; url: string; from: string }
    | { ok: false; reason: 'missing' | 'production'; message: string };

/**
 * The branch database string the desk may connect to: COMMS_V2_DATABASE_URL. Refuses a missing
 * value and a value that names the production database (the pure check in server/worker-gate.ts).
 * Never reads DATABASE_URL. The message never carries a value.
 */
export function resolveCommsV2Database(env: NodeJS.ProcessEnv = process.env): DatabaseResolution {
    const url = env[COMMS_V2_DATABASE_ENV];
    if (!url) {
        return { ok: false, reason: 'missing', message: `${COMMS_V2_DATABASE_ENV} is not set. The desk connects only to the Neon branch it names, never to DATABASE_URL.` };
    }
    if (isProductionDatabaseUrl(url)) {
        return { ok: false, reason: 'production', message: `${COMMS_V2_DATABASE_ENV} points at the production database. The desk runs only against a Neon branch; put the branch's connection string there.` };
    }
    return { ok: true, url, from: COMMS_V2_DATABASE_ENV };
}

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
}

/**
 * Check the environment and put the branch string where the database module reads it. Split out
 * so the refusal rules are testable without opening a port; `openDoorHost` calls it first.
 */
export function prepareDoorEnv(env: NodeJS.ProcessEnv = process.env): { databaseFrom: string } {
    const db = resolveCommsV2Database(env);
    if (!db.ok) throw new DoorHostError('refused', db.message);
    // The database module reads DATABASE_URL at import, so the branch is put there first; whatever
    // a .env held is never consulted.
    env.DATABASE_URL = db.url;
    return { databaseFrom: db.from };
}

/** Open the door: the desk's sandbox router in-process, on the desk's own branch database. */
export async function openDoorHost(opts: DoorHostOptions = {}): Promise<DoorHost> {
    const { databaseFrom } = prepareDoorEnv(process.env);
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
