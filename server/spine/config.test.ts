/**
 * B6: the 07:30 autonomy job's mode, derived from the spine row with no flag of its own
 * (server/spine/config.ts autonomyJobMode). Pure; no database.
 */
import { describe, it, expect } from 'vitest';
import { autonomyJobMode, DEFAULT_SPINE_CONFIG, spineMode, VIDEO_MAX_PER_RUN, useProcessLocalSpineConfig, _resetSpineConfigForTests } from './config';

describe('autonomyJobMode', () => {
    it('master switch off → off, whatever autonomy says (fail closed)', () => {
        expect(autonomyJobMode({ enabled: false, autonomy: { enabled: false } })).toBe('off');
        expect(autonomyJobMode({ enabled: false, autonomy: { enabled: true } })).toBe('off');
        expect(autonomyJobMode(DEFAULT_SPINE_CONFIG)).toBe('off');
        expect(autonomyJobMode({ enabled: undefined as any, autonomy: { enabled: true } })).toBe('off');
    });
    it('master on + autonomy on → full (today\'s behaviour)', () => {
        expect(autonomyJobMode({ enabled: true, autonomy: { enabled: true } })).toBe('full');
        expect(autonomyJobMode({ ...DEFAULT_SPINE_CONFIG, enabled: true, autonomy: { enabled: true } })).toBe('full');
    });
    it('master on + autonomy off → demote_only (no new field to forget)', () => {
        expect(autonomyJobMode({ enabled: true, autonomy: { enabled: false } })).toBe('demote_only');
        expect(autonomyJobMode({ ...DEFAULT_SPINE_CONFIG, enabled: true })).toBe('demote_only');
        expect(autonomyJobMode({ enabled: true, autonomy: undefined })).toBe('demote_only');
        expect(autonomyJobMode({ enabled: true, autonomy: null })).toBe('demote_only');
        expect(autonomyJobMode({ enabled: true, autonomy: { enabled: 'yes' as any } })).toBe('demote_only');
    });
    it('follows the master switch exactly as spineMode does', () => {
        for (const enabled of [true, false]) {
            const c = { ...DEFAULT_SPINE_CONFIG, enabled };
            expect(autonomyJobMode(c) === 'off').toBe(spineMode(c) === 'off');
        }
    });
});

describe('T7: the compiled-in media default', () => {
    it('is 6 per pass (up from 3), inside the settable bound, and only applies where no row is stored', () => {
        expect(DEFAULT_SPINE_CONFIG.video).toEqual({ enabled: false, images: false, maxPerRun: 6 });
        expect(VIDEO_MAX_PER_RUN.min).toBeLessThanOrEqual(6);
        expect(VIDEO_MAX_PER_RUN.max).toBeGreaterThanOrEqual(6);
        // A stored row keeps its own value: the default never overrides what is already there.
        const stored = useProcessLocalSpineConfig({ video: { enabled: true, images: false, maxPerRun: 3 } });
        expect(stored.video.maxPerRun).toBe(3);
        _resetSpineConfigForTests();
    });
});
