import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    parseHeartbeat, assessHeartbeat, ukHour, isUkAlertWindow, shouldAlertStale,
    maybeWriteHeartbeat, checkHeartbeatStaleOnce, _resetHeartbeatStateForTests,
    HEARTBEAT_STALE_AFTER_SECONDS, STALE_ALERT_EVERY_MS,
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
