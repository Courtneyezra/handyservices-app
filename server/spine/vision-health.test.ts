/**
 * T14 vitest: the describer's health verdict (server/spine/vision-health.ts assessVisionRows), pure.
 * The rule the sidebar badge, the staff card and the sandbox banner all rest on.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../db', () => ({ db: {}, pool: {} }));
import { assessVisionRows, isConfigFailure, type VisionRow } from './vision-health';

const t = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 7, 12, 0) - minutesAgo * 60_000);
const ok = (m: number): VisionRow => ({ startedAt: t(m), decision: 'described', error: null });
const retired = (m: number): VisionRow => ({ startedAt: t(m), decision: 'failed', error: 'config: gemini 404: This model models/gemini-2.5-flash is no longer available to new users.' });
const timeout = (m: number): VisionRow => ({ startedAt: t(m), decision: 'failed', error: 'transient: timed out after 60000 ms' });
const legacy = (m: number): VisionRow => ({ startedAt: t(m), decision: 'failed', error: 'no description (see describe_video log)' });

describe('T14: assessVisionRows', () => {
    it('no rows is idle; a newest success is ok with the window counted', () => {
        expect(assessVisionRows([])).toMatchObject({ status: 'idle', failing: false, window: { runs: 0, failed: 0, described: 0 } });
        const h = assessVisionRows([ok(1), timeout(5), ok(9)]);
        expect(h).toMatchObject({ status: 'ok', failing: false, permanent: false, reason: null, since: null, window: { runs: 3, failed: 1, described: 2 } });
        expect(h.lastAt).toBe(t(1).toISOString());
    });
    it('the owner\'s 30 hours: every row a config 404 → failing, permanent, the reason verbatim, since the oldest of the streak', () => {
        const rows = [retired(1), retired(30), retired(60), retired(1800)];
        const h = assessVisionRows(rows);
        expect(h).toMatchObject({ status: 'failing', failing: true, permanent: true, window: { runs: 4, failed: 4, described: 0 } });
        expect(h.reason).toMatch(/^config: gemini 404: This model models\/gemini-2\.5-flash/);
        expect(h.since).toBe(t(1800).toISOString());
    });
    it('ONE config failure, newest, is enough: it will not clear on its own', () => {
        const h = assessVisionRows([retired(1), ok(5), ok(9)]);
        expect(h).toMatchObject({ failing: true, permanent: true, since: t(1).toISOString() });
    });
    it('one or two transient failures on a working describer are not failing; three of three are', () => {
        expect(assessVisionRows([timeout(1), ok(5)]).failing).toBe(false);
        expect(assessVisionRows([timeout(1), timeout(3), ok(5)]).failing).toBe(false);
        expect(assessVisionRows([timeout(1), timeout(3)]).failing).toBe(false); // two rows is too few to say
        const h = assessVisionRows([timeout(1), timeout(3), timeout(4)]);
        expect(h).toMatchObject({ failing: true, permanent: false, reason: 'transient: timed out after 60000 ms', since: t(4).toISOString() });
    });
    it('rows written before T14 (the generic error, no class) still count as failures and, all together, as failing', () => {
        const h = assessVisionRows(Array.from({ length: 20 }, (_, i) => legacy(i + 1)));
        expect(h).toMatchObject({ failing: true, permanent: false, reason: 'no description (see describe_video log)', window: { runs: 20, failed: 20 } });
        expect(isConfigFailure(h.reason)).toBe(false);
        expect(isConfigFailure('config: gemini 401: API key not valid')).toBe(true);
    });
    it('a success after the fix clears it, even with the old failures still in the window', () => {
        const h = assessVisionRows([ok(1), ...Array.from({ length: 19 }, (_, i) => retired(i + 2))]);
        expect(h).toMatchObject({ status: 'ok', failing: false, window: { runs: 20, failed: 19, described: 1 } });
    });
});
