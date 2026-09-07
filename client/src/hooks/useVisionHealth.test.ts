/**
 * T14 vitest: the sidebar's VISION FAILING badge rule and the fetch behind it. No server.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { visionBadge, fetchVisionHealth, VISION_HEALTH_URL, type VisionHealthPayload } from './useVisionHealth';

const base: VisionHealthPayload = { status: 'ok', failing: false, permanent: false, reason: null, since: null, lastAt: null, window: { runs: 5, failed: 0, described: 5 }, checkedAt: '2026-09-07T22:00:00.000Z' };

describe('T14: visionBadge', () => {
    it('is the red badge only when the describer is failing; quiet otherwise, including unknown and idle', () => {
        expect(visionBadge({ ...base, status: 'failing', failing: true, permanent: true, reason: 'config: gemini 404: retired' })).toBe('VISION FAILING');
        expect(visionBadge({ ...base, status: 'failing', failing: true, permanent: false, reason: 'transient: timed out after 60000 ms' })).toBe('VISION FAILING');
        expect(visionBadge(base)).toBeNull();
        expect(visionBadge({ ...base, status: 'idle', window: { runs: 0, failed: 0, described: 0 } })).toBeNull();
        expect(visionBadge({ ...base, status: 'unknown' })).toBeNull();
        expect(visionBadge(undefined)).toBeNull();
        expect(visionBadge(null)).toBeNull();
    });
});

describe('T14: fetchVisionHealth', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    it('reads GET /api/spine/vision-health with the admin token and surfaces 401 as AUTH', async () => {
        localStorage.setItem('adminToken', 'tok');
        const f = vi.fn(async (url: string, init: any) => {
            expect(url).toBe(VISION_HEALTH_URL);
            expect(init.headers.Authorization).toBe('Bearer tok');
            return { ok: true, status: 200, json: async () => ({ ...base, failing: true }) } as any;
        });
        vi.stubGlobal('fetch', f);
        expect((await fetchVisionHealth()).failing).toBe(true);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as any));
        await expect(fetchVisionHealth()).rejects.toThrow('AUTH');
        localStorage.removeItem('adminToken');
    });
});
