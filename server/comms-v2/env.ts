/**
 * The machine-local environment for the new desk.
 *
 * The branch database string and the model keys may live in one more place on this machine so the
 * pipeline's end-to-end test step can drive the desk's sandbox door live: a file at
 * $HOME/.config/handyservices/comms-v2.env (mode 600). This loader reads it when it exists, takes
 * only the three names the desk is allowed to have from it, fills in only the variables the
 * process does not already have, and never prints, logs or writes a value. A variable set by the
 * shell, a .env, or a pipeline always wins.
 *
 * Every other name in the file is ignored and reported by name only, so a file that still carries
 * a payment, messaging or storage credential cannot hand it to the door process or a test worker,
 * and DATABASE_URL, COMMS_WORKER and NODE_ENV can never be set from it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { isProductionDatabaseUrl } from '../worker-gate';

/** The one database variable the desk reads. */
export const COMMS_V2_DATABASE_ENV = 'COMMS_V2_DATABASE_URL';

/** The only names the machine-local file may set. */
export const ALLOWED_FROM_FILE: readonly string[] = [COMMS_V2_DATABASE_ENV, 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'];

export const COMMS_V2_ENV_RELATIVE = path.join('.config', 'handyservices', 'comms-v2.env');

export interface LoadResult {
    /** The path looked at, so a log can say where without saying what. */
    path: string;
    /** Whether the file was there. */
    found: boolean;
    /** Names set from the file (they were unset before). Names only, never values. */
    loaded: string[];
    /** Allowed names in the file that were left alone because the process already had them. */
    kept: string[];
    /** Names in the file that are not on the allowlist; never read into the environment. */
    ignored: string[];
}

export interface LoadOptions {
    /** The home directory to look under; defaults to os.homedir(). */
    home?: string;
    /** The environment to fill; defaults to process.env. */
    env?: NodeJS.ProcessEnv;
}

/** Where the machine-local file lives for a given home. Pure. */
export function commsV2EnvPath(home: string = os.homedir()): string {
    return path.join(home, COMMS_V2_ENV_RELATIVE);
}

/**
 * Load the allowed names from the machine-local file into `env` when it exists. Idempotent: a
 * second call finds every name already set and loads nothing. Returns names only.
 */
export function loadCommsV2Env(opts: LoadOptions = {}): LoadResult {
    const env = opts.env ?? process.env;
    const file = commsV2EnvPath(opts.home);
    const result: LoadResult = { path: file, found: false, loaded: [], kept: [], ignored: [] };
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return result;
    }
    result.found = true;
    const parsed = dotenv.parse(text);
    for (const name of Object.keys(parsed)) {
        if (!ALLOWED_FROM_FILE.includes(name)) { result.ignored.push(name); continue; }
        if (env[name] !== undefined && env[name] !== '') { result.kept.push(name); continue; }
        env[name] = parsed[name];
        result.loaded.push(name);
    }
    return result;
}

export type DatabaseResolution =
    | { ok: true; url: string; from: string }
    | { ok: false; reason: 'missing' | 'production'; message: string };

/**
 * The branch database string the desk may connect to: COMMS_V2_DATABASE_URL. Refuses a missing
 * value and a value that names the production database (the existing pure check in
 * server/worker-gate.ts). Never reads DATABASE_URL. The message never carries a value.
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
