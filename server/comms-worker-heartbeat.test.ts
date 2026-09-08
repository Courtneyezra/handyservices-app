import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    parseHeartbeat, assessHeartbeat, ukHour, isUkAlertWindow, shouldAlertStale,
    maybeWriteHeartbeat, checkHeartbeatStaleOnce, _resetHeartbeatStateForTests,
    HEARTBEAT_STALE_AFTER_SECONDS, STALE_ALERT_EVERY_MS,
    shouldWatchdogAlert, checkHeartbeatFromOutsideOnce, startHeartbeatWatchdog, getHeartbeatHealth,
    type HeartbeatHealth,
} from './comms-worker-heartbeat';

const T0 = Date.parse('2026-09-02T12:00:00.000Z'); // 13:00 BST — inside the alert window

describe('parseHeartbeat', () => {
    it('accepts the stored shape and rejects junk', () => {
        expect(parseHeartbeat({ at: '2026-09-02T12:00:00.000Z', pid: 42, host: 'railway', version: 'abc123' }))
            .toEqual({ at: '2026-09-02T12:00:00.000Z', pid: 42, host: 'railway', version: 'abc123' });
        expect(parseHeartbeat(null)).toBeNull();
        expect(parseHeartbeat('yesterday')).toBeNull();
        expect(parseHeartbeat({ at: 'not a date' })).toBeNull();
        expect(parseHeartbeat({ at: '2026-09-02T12:00:00.000Z' })).toMatchObject({ pid: 0, host: '', version: null });
    });
});

describe('assessHeartbeat', () => {
    const rec = (secondsAgo: number) => ({ at: new Date(T0 - secondsAgo * 1000).toISOString(), pid: 1, host: 'h', version: null });

    it('is fresh under the threshold and stale over it', () => {
        expect(assessHeartbeat(rec(30), T0)).toMatchObject({ ok: true, stale: false, ageSeconds: 30 });
        expect(assessHeartbeat(rec(HEARTBEAT_STALE_AFTER_SECONDS), T0)).toMatchObject({ ok: true, stale: false });
        expect(assessHeartbeat(rec(HEARTBEAT_STALE_AFTER_SECONDS + 1), T0)).toMatchObject({ ok: false, stale: true, ageSeconds: 601 });
    });

    it('treats a missing heartbeat as stale with a null age', () => {
        expect(assessHeartbeat(null, T0)).toMatchObject({ ok: false, stale: true, ageSeconds: null, at: null });
    });

    it('never reports a negative age for a clock-skewed future stamp', () => {
        expect(assessHeartbeat(rec(-90), T0).ageSeconds).toBe(0);
    });
});

describe('UK alert window', () => {
    it('converts to Europe/London regardless of process TZ', () => {
        expect(ukHour(new Date('2026-09-02T12:00:00.000Z'))).toBe(13); // BST
        expect(ukHour(new Date('2026-01-15T12:00:00.000Z'))).toBe(12); // GMT
    });
    it('is [08:00, 20:00) UK', () => {
        expect(isUkAlertWindow(new Date('2026-09-02T06:59:00.000Z'))).toBe(false); // 07:59 BST
        expect(isUkAlertWindow(new Date('2026-09-02T07:00:00.000Z'))).toBe(true);  // 08:00 BST
        expect(isUkAlertWindow(new Date('2026-09-02T18:59:00.000Z'))).toBe(true);  // 19:59 BST
        expect(isUkAlertWindow(new Date('2026-09-02T19:00:00.000Z'))).toBe(false); // 20:00 BST
    });
});

describe('shouldAlertStale', () => {
    const base = { stale: true, isWorker: true, inWindow: true, lastAlertAt: null, now: T0 };
    it('pages a stale worker in hours with no recent page', () => {
        expect(shouldAlertStale(base)).toBe(true);
    });
    it('stays quiet when fresh, not the worker, or out of hours', () => {
        expect(shouldAlertStale({ ...base, stale: false })).toBe(false);
        expect(shouldAlertStale({ ...base, isWorker: false })).toBe(false);
        expect(shouldAlertStale({ ...base, inWindow: false })).toBe(false);
    });
    it('throttles to one page an hour', () => {
        expect(shouldAlertStale({ ...base, lastAlertAt: T0 - STALE_ALERT_EVERY_MS + 1 })).toBe(false);
        expect(shouldAlertStale({ ...base, lastAlertAt: T0 - STALE_ALERT_EVERY_MS })).toBe(true);
    });
});

describe('maybeWriteHeartbeat / checkHeartbeatStaleOnce (no DB)', () => {
    const envBackup = { ...process.env };
    beforeEach(() => {
        _resetHeartbeatStateForTests();
        delete process.env.COMMS_WORKER;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        process.env = { ...envBackup };
        vi.restoreAllMocks();
    });

    it('a passive process never writes a heartbeat and never pages', async () => {
        // No DATABASE_URL in this test env: if either function touched the db it would throw.
        expect(await maybeWriteHeartbeat(T0)).toBe(false);
        expect(await checkHeartbeatStaleOnce(T0, vi.fn(async (_title: string, _message: string) => {}))).toBe('not-worker');
    });

    it('the worker pages once when the heartbeat cannot be read, then throttles', async () => {
        process.env.COMMS_WORKER = '1';
        delete process.env.DATABASE_URL; // db import throws → read fails → counts as stale
        const notify = vi.fn(async (_title: string, _message: string) => {});
        expect(await checkHeartbeatStaleOnce(T0, notify)).toBe('stale-alerted');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toBe('comms worker heartbeat stale');
        expect(await checkHeartbeatStaleOnce(T0 + 5 * 60_000, notify)).toBe('stale-quiet');
        expect(notify).toHaveBeenCalledTimes(1);
        // Out of hours: still stale, still quiet.
        expect(await checkHeartbeatStaleOnce(Date.parse('2026-09-02T22:00:00.000Z'), notify)).toBe('stale-quiet');
    });
});

// ------------------------------------------------------------------ 0.6: the watchdog outside the worker

describe('shouldWatchdogAlert', () => {
    const base = { stale: true, isWorker: false, inWindow: true, lastAlertAt: null, now: T0 };
    it('pages when a NON-worker process sees a stale heartbeat in hours', () => {
        expect(shouldWatchdogAlert(base)).toBe(true);
    });
    it('is the mirror image of shouldAlertStale on the role, so the two can never both fire', () => {
        expect(shouldWatchdogAlert({ ...base, isWorker: true })).toBe(false);
        expect(shouldAlertStale({ ...base, isWorker: true })).toBe(true);
        expect(shouldAlertStale(base)).toBe(false);
    });
    it('stays quiet when fresh or out of hours', () => {
        expect(shouldWatchdogAlert({ ...base, stale: false })).toBe(false);
        expect(shouldWatchdogAlert({ ...base, inWindow: false })).toBe(false);
    });
    it('throttles to one page an hour', () => {
        expect(shouldWatchdogAlert({ ...base, lastAlertAt: T0 - STALE_ALERT_EVERY_MS + 1 })).toBe(false);
        expect(shouldWatchdogAlert({ ...base, lastAlertAt: T0 - STALE_ALERT_EVERY_MS })).toBe(true);
    });
});

describe('checkHeartbeatFromOutsideOnce / startHeartbeatWatchdog', () => {
    const envBackup = { ...process.env };

    const health = (ageSeconds: number | null): HeartbeatHealth => ({
        ok: ageSeconds !== null && ageSeconds <= HEARTBEAT_STALE_AFTER_SECONDS,
        ageSeconds,
        stale: ageSeconds === null || ageSeconds > HEARTBEAT_STALE_AFTER_SECONDS,
        at: ageSeconds === null ? null : new Date(T0 - ageSeconds * 1000).toISOString(),
        pid: ageSeconds === null ? null : 77,
        host: ageSeconds === null ? null : 'railway-worker',
        version: null,
        status: ageSeconds === null || ageSeconds > HEARTBEAT_STALE_AFTER_SECONDS ? 'stale' : 'ok',
        thisProcess: { role: 'passive', pid: 12, host: 'railway-web', version: null },
        staleAfterSeconds: HEARTBEAT_STALE_AFTER_SECONDS,
    });
    const fresh = () => health(30);
    const dead = () => health(null);
    const reader = (h: HeartbeatHealth) => async () => h;

    beforeEach(() => {
        _resetHeartbeatStateForTests();
        delete process.env.COMMS_WORKER;
        process.env.NODE_ENV = 'production'; // a passive PRODUCTION process: the web service
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        _resetHeartbeatStateForTests();
        process.env = { ...envBackup };
        vi.restoreAllMocks();
    });

    it('pages once when the worker has gone silent, then stays quiet inside the hour', async () => {
        const notify = vi.fn(async (_t: string, _m: string) => {});
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(dead()))).toBe('stale-alerted');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toBe('comms worker is not running');
        expect(notify.mock.calls[0][1]).toContain('not the worker');

        // A second poll five minutes later is the same episode, not a second fact.
        expect(await checkHeartbeatFromOutsideOnce(T0 + 5 * 60_000, notify, reader(dead()))).toBe('stale-quiet');
        expect(await checkHeartbeatFromOutsideOnce(T0 + STALE_ALERT_EVERY_MS - 1, notify, reader(dead()))).toBe('stale-quiet');
        expect(notify).toHaveBeenCalledTimes(1);

        // An hour on, still dead: page again.
        expect(await checkHeartbeatFromOutsideOnce(T0 + STALE_ALERT_EVERY_MS, notify, reader(dead()))).toBe('stale-alerted');
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('a stale heartbeat older than the threshold pages; a fresh one is silent', async () => {
        const notify = vi.fn(async (_t: string, _m: string) => {});
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(fresh()))).toBe('fresh');
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(health(HEARTBEAT_STALE_AFTER_SECONDS)))).toBe('fresh');
        expect(notify).not.toHaveBeenCalled();
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(health(HEARTBEAT_STALE_AFTER_SECONDS + 1)))).toBe('stale-alerted');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][1]).toContain('Last heartbeat 10 min ago');
    });

    it('says so once when the worker comes back, and only if it had paged', async () => {
        const notify = vi.fn(async (_t: string, _m: string) => {});
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(dead()))).toBe('stale-alerted');
        expect(await checkHeartbeatFromOutsideOnce(T0 + 20 * 60_000, notify, reader(fresh()))).toBe('recovered');
        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify.mock.calls[1][0]).toBe('comms worker is back');
        expect(notify.mock.calls[1][1]).toContain('silent for about 20 min');
        // Recovery is one message, not one per poll.
        expect(await checkHeartbeatFromOutsideOnce(T0 + 25 * 60_000, notify, reader(fresh()))).toBe('fresh');
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('never announces a recovery it never alarmed about (a blip out of hours)', async () => {
        const notify = vi.fn(async (_t: string, _m: string) => {});
        const night = Date.parse('2026-09-02T23:00:00.000Z'); // 00:00 BST — outside the window
        expect(await checkHeartbeatFromOutsideOnce(night, notify, reader(dead()))).toBe('stale-quiet');
        expect(await checkHeartbeatFromOutsideOnce(night + 60_000, notify, reader(fresh()))).toBe('fresh');
        expect(notify).not.toHaveBeenCalled();
    });

    it('is inert in the worker — that process has its own check, so the two never double-page', async () => {
        process.env.COMMS_WORKER = '1';
        const notify = vi.fn(async (_t: string, _m: string) => {});
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(dead()))).toBe('is-worker');
        expect(notify).not.toHaveBeenCalled();
        expect(startHeartbeatWatchdog()).toBe(false);
    });

    it('is inert on a laptop: a passive process that is not production never pages', async () => {
        process.env.NODE_ENV = 'development';
        const notify = vi.fn(async (_t: string, _m: string) => {});
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(dead()))).toBe('not-production');
        expect(notify).not.toHaveBeenCalled();
        expect(startHeartbeatWatchdog()).toBe(false);
    });

    it('registers exactly one timer in the web process', () => {
        expect(startHeartbeatWatchdog()).toBe(true);
        expect(startHeartbeatWatchdog()).toBe(false); // idempotent
    });

    it('does not fall over when the push itself throws', async () => {
        const notify = vi.fn(async () => { throw new Error('pushover down'); });
        expect(await checkHeartbeatFromOutsideOnce(T0, notify, reader(dead()))).toBe('stale-alerted');
        expect(notify).toHaveBeenCalledTimes(1);
    });
});

describe('getHeartbeatHealth status (what a platform healthcheck reads)', () => {
    const envBackup = { ...process.env };
    afterEach(() => { process.env = { ...envBackup }; });

    it('reports status "stale" with the reason when the heartbeat cannot be read at all', async () => {
        delete process.env.DATABASE_URL; // the db import throws → unreadable → stale
        const h = await getHeartbeatHealth(T0);
        expect(h.status).toBe('stale');
        expect(h.stale).toBe(true);
        expect(h.ok).toBe(false);
        expect(h.error).toMatch(/heartbeat unreadable/);
        expect(h.staleAfterSeconds).toBe(HEARTBEAT_STALE_AFTER_SECONDS);
    });
});
