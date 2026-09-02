import { describe, it, expect } from 'vitest';
import { parseSpineMode, spineModeFrom, SPINE_MODES } from './switch';

describe('parseSpineMode', () => {
    it('accepts the three modes, with or without the CLI dashes, any case', () => {
        expect(parseSpineMode('--live')).toBe('live');
        expect(parseSpineMode('SHADOW')).toBe('shadow');
        expect(parseSpineMode(' off ')).toBe('off');
    });
    it('never defaults', () => {
        expect(parseSpineMode('on')).toBeNull();
        expect(parseSpineMode('')).toBeNull();
        expect(parseSpineMode(undefined)).toBeNull();
        expect(parseSpineMode(1)).toBeNull();
        expect(SPINE_MODES).toEqual(['off', 'shadow', 'live']);
    });
});

describe('spineModeFrom (the derivation from the row)', () => {
    it('fails closed: no row, unreadable row, or master off = off', () => {
        expect(spineModeFrom(null)).toBe('off');
        expect(spineModeFrom(undefined)).toBe('off');
        expect(spineModeFrom({})).toBe('off');
        expect(spineModeFrom({ enabled: false, shadow: true })).toBe('off');
        expect(spineModeFrom({ enabled: false, mode: 'live' })).toBe('off'); // explicit mode never overrides enabled:false
        expect(spineModeFrom({ mode: 'shadow' })).toBe('off');
    });
    it('derives from the Phase 2 fields when there is no mode field', () => {
        expect(spineModeFrom({ enabled: true })).toBe('live');
        expect(spineModeFrom({ enabled: true, shadow: false })).toBe('live');
        expect(spineModeFrom({ enabled: true, shadow: true })).toBe('shadow');
    });
    it('the explicit mode wins over the shadow flag once the master is on', () => {
        expect(spineModeFrom({ enabled: true, shadow: true, mode: 'live' })).toBe('live');
        expect(spineModeFrom({ enabled: true, shadow: false, mode: 'shadow' })).toBe('shadow');
        expect(spineModeFrom({ enabled: true, mode: 'off' })).toBe('off');
    });
    it('ignores junk in the mode field', () => {
        expect(spineModeFrom({ enabled: true, mode: 'on' as any })).toBe('live');
    });
});
