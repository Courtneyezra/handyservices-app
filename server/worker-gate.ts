/**
 * THE COMMS WORKER GATE — Phase 0 of the comms rebuild ("Close the doors").
 *
 * 31 Aug–2 Sep 2026: production's sweeps were dead (no OPENROUTER_API_KEY) and six `tsx watch`
 * dev processes on a laptop, all booted from the main checkout with the production DATABASE_URL
 * and the Twilio secrets, won the triage claims instead and sent 24 unguarded replies to five
 * real customers. Nothing alarmed. See docs/COMMS_AGENTS_V3_DESIGN.md §1.2 and §3.1.
 *
 * The structural fix: every loop that can reach a customer (tick, sweep, cron) is registered
 * ONLY in a process that explicitly says it is the worker (`COMMS_WORKER=1`, set on Railway and
 * nowhere else). A dev server pointed at production can still serve the admin UI; it can no
 * longer think or send on the customer's behalf on a timer.
 *
 * This module is deliberately pure — no db, no pushover at import time — so it is testable
 * without DATABASE_URL and safe to import from anywhere. The one side-effecting function,
 * assertCommsWorkerAtBoot, loads Pushover lazily and never throws.
 */
import { execSync } from 'child_process';
import os from 'os';

/** Substring of the production Neon host. Local .env files must NOT point here (use a Neon branch). */
export const PRODUCTION_DB_HOST_MARKER = 'ep-broad-king';

export const COMMS_WORKER_ENV = 'COMMS_WORKER';

type EnvLike = Record<string, string | undefined>;

/** True only when this process has been told, explicitly, that it runs the customer-facing loops. */
export function isCommsWorker(env: EnvLike = process.env): boolean {
    return env[COMMS_WORKER_ENV] === '1';
}

export function isProductionEnv(env: EnvLike = process.env): boolean {
    return env.NODE_ENV === 'production';
}

/** Does this DATABASE_URL reach the production Neon project? Never logs the URL itself. */
export function isProductionDatabaseUrl(url: string | undefined | null): boolean {
    return !!url && url.includes(PRODUCTION_DB_HOST_MARKER);
}

/** Host part of a Postgres URL for logs — never credentials, never the full URL. */
export function databaseHostOf(url: string | undefined | null): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname || null;
    } catch {
        const m = /@([^/:?]+)/.exec(url);
        return m ? m[1] : null;
    }
}

let cachedVersion: string | null | undefined;

/**
 * Best-effort build identity for the heartbeat: Railway's commit env first, then git if this is
 * a checkout, else null. Cached — it is called every 60s from the fast tick.
 */
export function resolveBuildVersion(env: EnvLike = process.env): string | null {
    if (cachedVersion !== undefined) return cachedVersion;
    const fromEnv = env.RAILWAY_GIT_COMMIT_SHA || env.SOURCE_COMMIT || env.GIT_SHA || env.COMMIT_SHA;
    if (fromEnv) {
        cachedVersion = fromEnv.slice(0, 12);
        return cachedVersion;
    }
    try {
        cachedVersion = execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
            .toString().trim() || null;
    } catch {
        cachedVersion = null;
    }
    return cachedVersion;
}

export interface WorkerState {
    isWorker: boolean;
    nodeEnv: string;
    production: boolean;
    /** DATABASE_URL points at the production Neon project. */
    pointedAtProductionDb: boolean;
    databaseHost: string | null;
    pid: number;
    host: string;
    version: string | null;
    /** One of: 'worker' (runs loops), 'passive' (serves HTTP only). */
    role: 'worker' | 'passive';
    /** Human-readable verdict for logs and /api/health/comms-worker. */
    summary: string;
}

export function describeWorkerState(env: EnvLike = process.env): WorkerState {
    const isWorker = isCommsWorker(env);
    const production = isProductionEnv(env);
    const pointedAtProductionDb = isProductionDatabaseUrl(env.DATABASE_URL);
    const base = {
        isWorker,
        nodeEnv: env.NODE_ENV || 'development',
        production,
        pointedAtProductionDb,
        databaseHost: databaseHostOf(env.DATABASE_URL),
        pid: process.pid,
        host: os.hostname(),
        version: resolveBuildVersion(env),
        role: (isWorker ? 'worker' : 'passive') as 'worker' | 'passive',
    };
    let summary: string;
    if (isWorker && production) summary = 'comms worker (production): customer-facing loops run here';
    else if (isWorker) summary = `comms worker (${base.nodeEnv}): customer-facing loops run here — make sure this is intended`;
    else if (production) summary = `${COMMS_WORKER_ENV} absent on production: NO sweeps, ticks or customer crons will run`;
    else if (pointedAtProductionDb) summary = 'dev process pointed at the PRODUCTION database: customer-facing loops disabled';
    else summary = 'passive process: customer-facing loops disabled (not the comms worker)';
    return { ...base, summary };
}

/**
 * Boot-time assertion. Never throws — a misconfigured worker must still serve HTTP so someone
 * can see the problem. Three outcomes:
 *   - production without the flag  → console.error + Pushover (this is the 31 Aug alarm)
 *   - non-production, prod DB URL  → loud console.warn (the six-laptops case)
 *   - otherwise                    → one info line
 */
export async function assertCommsWorkerAtBoot(
    env: EnvLike = process.env,
    notify?: (title: string, message: string) => Promise<void>,
): Promise<WorkerState> {
    const state = describeWorkerState(env);
    try {
        if (state.production && !state.isWorker) {
            const title = `${COMMS_WORKER_ENV} flag absent on production: no sweeps will run`;
            console.error(`[WorkerGate] ${title} (host=${state.host} pid=${state.pid} version=${state.version ?? 'unknown'})`);
            const send = notify ?? (async (t: string, m: string) => {
                const { notifyWorkerHealth } = await import('./pushover');
                await notifyWorkerHealth({ title: t, message: m });
            });
            await send(title, [
                `host ${state.host} · pid ${state.pid} · build ${state.version ?? 'unknown'}`,
                'Comms sweeps, on-inbound ticks, morning releases, day-before reminders and lead automations are all OFF in this process.',
                `Fix: set ${COMMS_WORKER_ENV}=1 on the Railway service and redeploy.`,
            ].join('\n'));
        } else if (!state.production && state.pointedAtProductionDb) {
            console.warn('\n' + [
                '!'.repeat(88),
                `[WorkerGate] DEV PROCESS POINTED AT THE PRODUCTION DATABASE (${state.databaseHost}).`,
                `[WorkerGate] Customer-facing loops are DISABLED here${state.isWorker ? ` — but ${COMMS_WORKER_ENV}=1 IS set, so they WILL run. Unset it unless you mean it.` : '.'}`,
                '[WorkerGate] Use a Neon dev branch: see docs/comms-build/PHASE0-OPS.md.',
                '!'.repeat(88),
            ].join('\n') + '\n');
        } else {
            console.log(`[WorkerGate] ${state.summary} (host=${state.host} pid=${state.pid} version=${state.version ?? 'unknown'})`);
        }
    } catch (error: any) {
        console.error('[WorkerGate] boot check could not alert (continuing):', error?.message ?? error);
    }
    return state;
}

const skipped: string[] = [];

/** Names of every loop this process declined to register (for the health payload). */
export function skippedLoops(): readonly string[] {
    return skipped;
}

/**
 * Register a customer-facing loop only in the worker. One log line per skipped loop at boot,
 * so a passive process's log answers "why is nothing sweeping?" without a debugger.
 * Returns true if the loop was registered.
 */
export function gateCustomerLoop(name: string, register: () => void, env: EnvLike = process.env): boolean {
    if (!isCommsWorker(env)) {
        skipped.push(name);
        console.log(`[WorkerGate] SKIPPED "${name}" — ${COMMS_WORKER_ENV} != 1 (this process does not run customer-facing loops).`);
        return false;
    }
    register();
    return true;
}
