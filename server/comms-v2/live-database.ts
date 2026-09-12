/**
 * The one check every live WRITER in the new desk makes before it touches the database.
 *
 * The desk is sandbox-only until cutover, and its sandbox door is mounted on the ordinary server
 * (`/api/comms-v2/sandbox`, server/index.ts) so Ben's kanban board has threads to show. That mount
 * is on whatever database the process connected to, which on the deployed server is production:
 * without this check the sandbox drafts a real personalized_quotes row, prices it, and publishes a
 * readable quote page with real figures on it.
 *
 * So every live store and every path that writes under server/comms-v2 asks here first, and the
 * answer is the same one the door host gives (desk/door-host.ts): the database in use must be the
 * Neon branch named by COMMS_V2_DATABASE_URL. A refusal is loud and names that requirement;
 * nothing falls back to DATABASE_URL or to a memory store chosen behind the caller's back.
 *
 * Writing is the whole subject. A read of a reviewed knowledge-base row publishes nothing and
 * costs nothing on the wrong database, so the reviewed readers (desk/fixed-lines.ts,
 * desk/scoping-tools.ts) do not ask: they simply find nothing, and the desk falls back to its own
 * wording. Made to refuse instead, they would throw on exactly the turns the captain's fixed line
 * matters most on, and a gas, complaint or money turn would get no reply at all. Ben's board
 * reading its own `comms_v2_approvers` row (server/comms-v2/api/approvers.ts) is a read too, and
 * one that must work on the server the board runs on.
 *
 * At cutover the desk starts writing to the live database on purpose, and that goal replaces this
 * check with the desk switch. Until then the answer to "may I write here?" is no.
 *
 * No message here carries a connection string: variables are named, never printed.
 */
import { COMMS_V2_DATABASE_ENV, resolveCommsV2Database } from './desk/door-host';
import { isProductionDatabaseUrl } from '../worker-gate';

/** The variable the database module actually connected with (server/db.ts reads it at import). */
export const IN_USE_DATABASE_ENV = 'DATABASE_URL';

export class CommsV2DatabaseRefused extends Error {
    constructor(public readonly reader: string, message: string) {
        super(message);
        this.name = 'CommsV2DatabaseRefused';
    }
}

export type DatabaseCheck = { ok: true } | { ok: false; reason: 'missing' | 'production' | 'not_the_branch'; message: string };

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
 * May the desk open the database in this process? Only when COMMS_V2_DATABASE_URL is set, is not
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

/** The same check, thrown. `reader` names who asked, so the refusal says what was refused. */
export function assertCommsV2Database(reader: string, env: NodeJS.ProcessEnv = process.env): void {
    const check = commsV2DatabaseCheck(env);
    if (check.ok) return;
    throw new CommsV2DatabaseRefused(reader, `${reader} refused: ${check.message}`);
}

/** The database handle, for a live dependency of the desk. Refuses before it opens anything. */
export async function commsV2Db(reader: string): Promise<typeof import('../db').db> {
    assertCommsV2Database(reader);
    const { db } = await import('../db');
    return db;
}
