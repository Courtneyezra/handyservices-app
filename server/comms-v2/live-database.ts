/**
 * The one check every live WRITER in the new desk makes before it touches the database.
 *
 * It asks for a purpose, and the two purposes answer differently:
 *
 *   sandbox  the default, and everything the sandbox door does. The door is mounted on the ordinary
 *            server (`/api/comms-v2/sandbox`, server/index.ts) so Ben's board has threads to show,
 *            and that mount is on whatever database the process connected to, which on the
 *            deployed server is production: without this check the sandbox drafts a real
 *            personalized_quotes row, prices it, and publishes a readable quote page with real
 *            figures on it. So the database in use must be the Neon branch named by
 *            COMMS_V2_DATABASE_URL, the same answer the door host gives (desk/door-host.ts). This
 *            holds whatever the switches say: the sandbox door never writes production.
 *
 *   live     the live intake's store and tools only (channels/intake.ts builds them). They open the
 *            database the process is connected to, production included, and only while the new
 *            desk is the live desk (switch.ts `commsV2Live`: the intake, the desk switch and the new
 *            desk's sender switch all on). Asked again at every call, so flipping a switch back
 *            refuses the very next write.
 *
 * A refusal is loud and names the requirement; nothing falls back to another database or to a
 * memory store chosen behind the caller's back.
 *
 * Writing is the whole subject. A read of a reviewed knowledge-base row publishes nothing and
 * costs nothing on the wrong database, so the reviewed readers (desk/fixed-lines.ts,
 * desk/scoping-tools.ts) do not ask: they simply find nothing, and the desk falls back to its own
 * wording. Made to refuse instead, they would throw on exactly the turns the captain's fixed line
 * matters most on, and a gas, complaint or money turn would get no reply at all. Ben's board
 * reading its own `comms_v2_approvers` row (server/comms-v2/api/approvers.ts) is a read too, and
 * one that must work on the server the board runs on.
 *
 * No message here carries a connection string: variables are named, never printed.
 */
import { COMMS_V2_DATABASE_ENV, resolveCommsV2Database } from './desk/door-host';
import { isProductionDatabaseUrl } from '../worker-gate';

/** The variable the database module actually connected with (server/db.ts reads it at import). */
export const IN_USE_DATABASE_ENV = 'DATABASE_URL';

/** Who is asking: the sandbox door and its tests, or the live intake while the new desk is live. */
export type DatabasePurpose = 'sandbox' | 'live';

export class CommsV2DatabaseRefused extends Error {
    constructor(public readonly reader: string, message: string) {
        super(message);
        this.name = 'CommsV2DatabaseRefused';
    }
}

export type DatabaseCheck = { ok: true } | { ok: false; reason: 'missing' | 'production' | 'not_the_branch' | 'not_live'; message: string };

/**
 * The connection's target, for comparing two strings that may differ only in credentials, pooler
 * suffix or query parameters: host, port, database name and user. `null` when it cannot be parsed,
 * which never compares equal to anything.
 */
function connectionTarget(url: string): string | null {
    const direct = url.replace('-pooler', '');
    try {
        const u = new URL(direct);
        if (!u.hostname || !u.pathname || u.pathname === '/') return null;
        return [u.hostname.toLowerCase(), u.port, u.pathname.replace(/\/+$/, '').toLowerCase(), decodeURIComponent(u.username)].join('|');
    } catch {
        return null;
    }
}

/**
 * May the sandbox open the database in this process? Only when COMMS_V2_DATABASE_URL is set, is not
 * the production database, and names the same database the process actually connected to.
 */
export function commsV2DatabaseCheck(env: NodeJS.ProcessEnv = process.env): DatabaseCheck {
    const branch = resolveCommsV2Database(env);
    if (!branch.ok) return { ok: false, reason: branch.reason, message: branch.message };
    const inUse = env[IN_USE_DATABASE_ENV];
    if (!inUse) {
        return { ok: false, reason: 'not_the_branch', message: `${IN_USE_DATABASE_ENV} is not set, so there is no database in use to check against ${COMMS_V2_DATABASE_ENV}.` };
    }
    if (isProductionDatabaseUrl(inUse)) {
        return { ok: false, reason: 'production', message: `the database in use (${IN_USE_DATABASE_ENV}) is the production database. The new desk writes only to the Neon branch named by ${COMMS_V2_DATABASE_ENV}.` };
    }
    const want = connectionTarget(branch.url);
    const have = connectionTarget(inUse);
    if (!want || !have || want !== have) {
        return { ok: false, reason: 'not_the_branch', message: `the database in use (${IN_USE_DATABASE_ENV}) is not the one ${COMMS_V2_DATABASE_ENV} names. The new desk reads and writes only that branch; point both at it, or drive the desk through its own door (npm run comms-v2:door).` };
    }
    return { ok: true };
}

export interface LiveCheckDeps {
    env?: NodeJS.ProcessEnv;
    /** The switches, read now. Injected by tests; the default reads the spine row and the environment. */
    liveState?: (env: NodeJS.ProcessEnv) => Promise<{ live: boolean; off: string[] }>;
}

/**
 * May the live intake open the database in use? Only while the new desk is the live desk. The
 * database is whichever the process connected to: at the switch-over that is production, on purpose.
 */
export async function commsV2LiveDatabaseCheck(deps: LiveCheckDeps = {}): Promise<DatabaseCheck> {
    const env = deps.env ?? process.env;
    if (!env[IN_USE_DATABASE_ENV]) return { ok: false, reason: 'missing', message: `${IN_USE_DATABASE_ENV} is not set, so there is no database in use for the live desk.` };
    const read = deps.liveState ?? (async (e: NodeJS.ProcessEnv) => (await import('./switch')).commsV2LiveState(e));
    const state = await read(env).catch(() => ({ live: false, off: ['the switches could not be read'] }));
    if (!state.live) return { ok: false, reason: 'not_live', message: `the new desk is not the live desk (off: ${state.off.join('; ')}), so its live store and tools open no database. The sandbox door writes only the branch ${COMMS_V2_DATABASE_ENV} names.` };
    return { ok: true };
}

/** The sandbox check, thrown. `reader` names who asked, so the refusal says what was refused. */
export function assertCommsV2Database(reader: string, env: NodeJS.ProcessEnv = process.env): void {
    const check = commsV2DatabaseCheck(env);
    if (check.ok) return;
    throw new CommsV2DatabaseRefused(reader, `${reader} refused: ${check.message}`);
}

/** The check for a purpose, thrown. */
export async function assertCommsV2DatabaseFor(reader: string, purpose: DatabasePurpose, deps: LiveCheckDeps = {}): Promise<void> {
    if (purpose === 'sandbox') return assertCommsV2Database(reader, deps.env);
    const check = await commsV2LiveDatabaseCheck(deps);
    if (check.ok) return;
    throw new CommsV2DatabaseRefused(reader, `${reader} refused: ${check.message}`);
}

/** The database handle, for a live dependency of the desk. Refuses before it opens anything. */
export async function commsV2Db(reader: string, purpose: DatabasePurpose = 'sandbox'): Promise<typeof import('../db').db> {
    await assertCommsV2DatabaseFor(reader, purpose);
    const { db } = await import('../db');
    return db;
}
