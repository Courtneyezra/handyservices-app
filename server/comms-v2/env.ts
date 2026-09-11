/**
 * The machine-local environment for the new desk.
 *
 * The branch database string and the model keys may live in one more place on this machine so the
 * pipeline's end-to-end test step can drive the desk's sandbox door live: a file at
 * $HOME/.config/handyservices/comms-v2.env (mode 600). This loader reads it when it exists, fills
 * in only the variables the process does not already have, and never prints, logs or writes a
 * value. A variable set by the shell, a .env, or a pipeline always wins.
 *
 * Three keys are never taken from the file, whatever it holds: DATABASE_URL, because the desk
 * connects only to the branch named by COMMS_V2_DATABASE_URL (the door host puts it there itself,
 * after the production check); COMMS_WORKER and NODE_ENV, because the machine file must not turn a
 * test process into a worker or a production server.
 *
 * The desk's one database variable is COMMS_V2_DATABASE_URL. It was COMMS_V2_JUDGE_DATABASE_URL
 * while the judge existed; the old name is still read for one release, so a machine file that
 * carries it keeps working, and the new name wins when both are set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { isProductionDatabaseUrl } from '../worker-gate';

/** The one database variable the desk reads. */
export const COMMS_V2_DATABASE_ENV = 'COMMS_V2_DATABASE_URL';
/** Accepted for one release; the renamed variable wins when both are set. */
export const COMMS_V2_DATABASE_ENV_LEGACY = 'COMMS_V2_JUDGE_DATABASE_URL';

export const COMMS_V2_ENV_RELATIVE = path.join('.config', 'handyservices', 'comms-v2.env');

/** Never taken from the machine file. */
export const NEVER_FROM_FILE: readonly string[] = ['DATABASE_URL', 'COMMS_WORKER', 'NODE_ENV'];

export interface LoadResult {
    /** The path looked at, so a log can say where without saying what. */
    path: string;
    /** Whether the file was there. */
    found: boolean;
    /** Names set from the file (they were unset before). Names only, never values. */
    loaded: string[];
    /** Names in the file that were left alone because the process already had them. */
    kept: string[];
    /** Names in the file that are never taken from it. */
    refused: string[];
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
 * Load the machine-local file into `env` when it exists. Idempotent: a second call finds every
 * name already set and loads nothing. Returns names only.
 */
export function loadCommsV2Env(opts: LoadOptions = {}): LoadResult {
    const env = opts.env ?? process.env;
    const file = commsV2EnvPath(opts.home);
    const result: LoadResult = { path: file, found: false, loaded: [], kept: [], refused: [] };
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return result;
    }
    result.found = true;
    const parsed = dotenv.parse(text);
    for (const name of Object.keys(parsed)) {
        if (NEVER_FROM_FILE.includes(name)) { result.refused.push(name); continue; }
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
 * The branch database string the desk may connect to: COMMS_V2_DATABASE_URL, else the legacy
 * name for one release. Refuses a missing value and a value that names the production database
 * (the existing pure check in server/worker-gate.ts). Never reads DATABASE_URL. The message never
 * carries a value.
 */
export function resolveCommsV2Database(env: NodeJS.ProcessEnv = process.env): DatabaseResolution {
    const from = env[COMMS_V2_DATABASE_ENV] ? COMMS_V2_DATABASE_ENV : env[COMMS_V2_DATABASE_ENV_LEGACY] ? COMMS_V2_DATABASE_ENV_LEGACY : null;
    if (!from) {
        return { ok: false, reason: 'missing', message: `${COMMS_V2_DATABASE_ENV} is not set. The desk connects only to the Neon branch it names, never to DATABASE_URL.` };
    }
    const url = env[from]!;
    if (isProductionDatabaseUrl(url)) {
        return { ok: false, reason: 'production', message: `${from} points at the production database. The desk runs only against a Neon branch; put the branch's connection string there.` };
    }
    return { ok: true, url, from };
}
