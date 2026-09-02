/**
 * DEAD-MAN HEARTBEAT for the comms worker — the alarm 31 Aug 2026 did not have.
 *
 * The worker (the one process with COMMS_WORKER=1, see server/worker-gate.ts) stamps
 * app_settings.comms_worker_heartbeat every 60s from its fast tick. Anything can read it:
 *   - GET /api/health/comms-worker for Railway/uptime checks;
 *   - /api/agents/staff for the /admin/staff page;
 *   - the in-process stale check below, which pages once an hour in UK daytime if the
 *     heartbeat is older than 10 minutes while THIS process believes it is the worker
 *     (its own writes are failing, or its tick has wedged).
 *
 * The db is imported lazily so this module — and its tests — load without DATABASE_URL.
 */
import { appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { describeWorkerState, isCommsWorker } from './worker-gate';

export const HEARTBEAT_KEY = 'comms_worker_heartbeat';
/** How often the worker stamps the row (the fast tick is 15s; this throttles it). */
export const HEARTBEAT_WRITE_EVERY_MS = 60_000;
/** Older than this = the worker is presumed dead. */
export const HEARTBEAT_STALE_AFTER_SECONDS = 600;
export const STALE_CHECK_EVERY_MS = 5 * 60_000;
/** Page at most once an hour — a dead worker is one fact, not twelve. */
export const STALE_ALERT_EVERY_MS = 60 * 60_000;
/** Alert only in UK daytime [08:00, 20:00). Overnight a stale worker waits for the morning. */
export const ALERT_WINDOW_UK = { startHour: 8, endHour: 20 } as const;

export interface HeartbeatRecord {
    at: string;
    pid: number;
    host: string;
    version: string | null;
}

export interface HeartbeatAssessment {
    /** Fresh heartbeat exists. */
    ok: boolean;
    /** Seconds since the last stamp, null if there has never been one (or it is unreadable). */
    ageSeconds: number | null;
    /** No usable heartbeat, or older than HEARTBEAT_STALE_AFTER_SECONDS. */
    stale: boolean;
    at: string | null;
    pid: number | null;
    host: string | null;
    version: string | null;
}

// ------------------------------------------------------------------ pure helpers (tested)

export function parseHeartbeat(value: unknown): HeartbeatRecord | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
    return {
        at: v.at,
        pid: typeof v.pid === 'number' ? v.pid : Number(v.pid) || 0,
        host: typeof v.host === 'string' ? v.host : '',
        version: typeof v.version === 'string' ? v.version : null,
    };
}

export function assessHeartbeat(record: HeartbeatRecord | null | undefined, now: number = Date.now()): HeartbeatAssessment {
    if (!record) return { ok: false, ageSeconds: null, stale: true, at: null, pid: null, host: null, version: null };
    const atMs = Date.parse(record.at);
    if (!Number.isFinite(atMs)) return { ok: false, ageSeconds: null, stale: true, at: null, pid: null, host: null, version: null };
    const ageSeconds = Math.max(0, Math.round((now - atMs) / 1000));
    const stale = ageSeconds > HEARTBEAT_STALE_AFTER_SECONDS;
    return { ok: !stale, ageSeconds, stale, at: record.at, pid: record.pid, host: record.host, version: record.version };
}

/** UK local hour, 0–23, regardless of the process TZ. */
export function ukHour(date: Date = new Date()): number {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(date)) % 24;
}

export function isUkAlertWindow(date: Date = new Date()): boolean {
    const h = ukHour(date);
    return h >= ALERT_WINDOW_UK.startHour && h < ALERT_WINDOW_UK.endHour;
}

export interface StaleAlertInput {
    stale: boolean;
    isWorker: boolean;
    inWindow: boolean;
    lastAlertAt: number | null;
    now: number;
}

/** The one decision the stale check makes: page now, or not. */
export function shouldAlertStale(i: StaleAlertInput): boolean {
    if (!i.stale || !i.isWorker || !i.inWindow) return false;
    if (i.lastAlertAt !== null && i.now - i.lastAlertAt < STALE_ALERT_EVERY_MS) return false;
    return true;
}

// ------------------------------------------------------------------ db-backed

async function getDb() {
    const { db } = await import('./db');
    return db;
}

export async function writeHeartbeat(now: Date = new Date()): Promise<HeartbeatRecord> {
    const state = describeWorkerState();
    const record: HeartbeatRecord = { at: now.toISOString(), pid: state.pid, host: state.host, version: state.version };
    const db = await getDb();
    await db.insert(appSettings)
        .values({
            id: HEARTBEAT_KEY, key: HEARTBEAT_KEY, value: record,
            description: 'Comms worker dead-man heartbeat (see server/comms-worker-heartbeat.ts)',
            updatedAt: now,
        })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: record, updatedAt: now } });
    return record;
}

let lastWriteAt = 0;

/**
 * Called from the worker's fast tick (every 15s). Writes at most once per HEARTBEAT_WRITE_EVERY_MS
 * and only when this process is the worker — a passive process must never claim to be alive.
 * Returns true when a write happened.
 */
export async function maybeWriteHeartbeat(now: number = Date.now()): Promise<boolean> {
    if (!isCommsWorker()) return false;
    if (now - lastWriteAt < HEARTBEAT_WRITE_EVERY_MS) return false;
    lastWriteAt = now;
    try {
        await writeHeartbeat(new Date(now));
        return true;
    } catch (error: any) {
        // Let the next tick retry rather than wait a full minute: a failed write is exactly
        // the condition the stale check exists to surface.
        lastWriteAt = 0;
        console.error('[Heartbeat] write failed:', error?.message ?? error);
        return false;
    }
}

export async function readHeartbeat(): Promise<HeartbeatRecord | null> {
    const db = await getDb();
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, HEARTBEAT_KEY)).limit(1);
    return row ? parseHeartbeat(row.value) : null;
}

export interface HeartbeatHealth extends HeartbeatAssessment {
    /** What the process answering this request is — the worker or a passive HTTP process. */
    thisProcess: { role: 'worker' | 'passive'; pid: number; host: string; version: string | null };
    staleAfterSeconds: number;
    error?: string;
}

/** For GET /api/health/comms-worker and the staff page. Never throws. */
export async function getHeartbeatHealth(now: number = Date.now()): Promise<HeartbeatHealth> {
    const state = describeWorkerState();
    const thisProcess = { role: state.role, pid: state.pid, host: state.host, version: state.version };
    try {
        const record = await readHeartbeat();
        return { ...assessHeartbeat(record, now), thisProcess, staleAfterSeconds: HEARTBEAT_STALE_AFTER_SECONDS };
    } catch (error: any) {
        return {
            ...assessHeartbeat(null, now), thisProcess, staleAfterSeconds: HEARTBEAT_STALE_AFTER_SECONDS,
            error: `heartbeat unreadable: ${error?.message ?? error}`,
        };
    }
}

// ------------------------------------------------------------------ in-process stale check

let lastStaleAlertAt: number | null = null;
let staleCheckStarted = false;

export type StaleCheckResult = 'not-worker' | 'fresh' | 'stale-quiet' | 'stale-alerted';

/**
 * One pass of the stale check. Only the worker pages: a passive process seeing a stale
 * heartbeat is a fact for /api/health, not an alarm it can act on. A failed READ counts as
 * stale — we cannot prove we are alive, which is the same thing from Ben's side.
 */
export async function checkHeartbeatStaleOnce(now: number = Date.now(), notify?: (title: string, message: string) => Promise<void>): Promise<StaleCheckResult> {
    if (!isCommsWorker()) return 'not-worker';
    const health = await getHeartbeatHealth(now);
    if (!health.stale) return 'fresh';
    const alert = shouldAlertStale({ stale: true, isWorker: true, inWindow: isUkAlertWindow(new Date(now)), lastAlertAt: lastStaleAlertAt, now });
    if (!alert) return 'stale-quiet';
    lastStaleAlertAt = now;
    const title = 'comms worker heartbeat stale';
    const message = [
        health.ageSeconds === null
            ? `No readable heartbeat${health.error ? ` (${health.error})` : ''}.`
            : `Last heartbeat ${Math.round(health.ageSeconds / 60)} min ago (${health.at}) from ${health.host ?? '?'} pid ${health.pid ?? '?'}.`,
        `This process (${health.thisProcess.host} pid ${health.thisProcess.pid}) is the worker and cannot prove it is alive: its fast tick or its DB writes have stopped.`,
        'Customer replies may be silently queueing. Check Railway logs / restart the service.',
    ].join('\n');
    try {
        const send = notify ?? (async (t: string, m: string) => {
            const { notifyWorkerHealth } = await import('./pushover');
            await notifyWorkerHealth({ title: t, message: m });
        });
        await send(title, message);
    } catch (error: any) {
        console.error('[Heartbeat] stale alert failed:', error?.message ?? error);
    }
    console.error(`[Heartbeat] ${title}: ${message.split('\n')[0]}`);
    return 'stale-alerted';
}

/** Idempotent. Only meaningful in the worker; a passive process registers nothing. */
export function startHeartbeatStaleCheck(): void {
    if (staleCheckStarted) return;
    if (!isCommsWorker()) return;
    staleCheckStarted = true;
    const run = () => checkHeartbeatStaleOnce().catch((e) => console.error('[Heartbeat] stale check failed:', e?.message ?? e));
    setInterval(run, STALE_CHECK_EVERY_MS).unref?.();
    console.log(`[Heartbeat] Stale check every ${STALE_CHECK_EVERY_MS / 60_000} min (stale > ${HEARTBEAT_STALE_AFTER_SECONDS / 60} min, UK ${ALERT_WINDOW_UK.startHour}–${ALERT_WINDOW_UK.endHour}, one page/hour).`);
}

/** Test hook. */
export function _resetHeartbeatStateForTests(): void {
    lastWriteAt = 0;
    lastStaleAlertAt = null;
    staleCheckStarted = false;
}
