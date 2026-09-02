/**
 * P6 / A2 vitest: template status shaping for /admin/staff and the go-live check. Pure.
 */
import { describe, it, expect } from 'vitest';
import { shapeTemplateStatus, EXPECTED_TEMPLATES, type CachedTemplateRow } from './template-status';

const row = (name: string, status: string, over: Partial<CachedTemplateRow> = {}): CachedTemplateRow =>
    ({ contentSid: `HX_${name}`, name, status, category: 'UTILITY', language: 'en_GB', lastCheckedAt: '2026-09-03T10:00:00Z', ...over });

describe('shapeTemplateStatus', () => {
    it('marks each expected purpose approved / present / missing and picks the first approved name', () => {
        const s = shapeTemplateStatus([
            row('holding_line', 'approved'), row('holding_line_v1', 'pending'),
            row('missed_call_ack', 'approved'), row('video_request', 'rejected', { rejectionReason: 'dup' }), row('postcode_request', 'approved'),
        ]);
        const by = Object.fromEntries(s.expected.map((e) => [e.names[0], e]));
        expect(by.holding_line_v1).toMatchObject({ state: 'approved', resolvedName: 'holding_line', byName: { holding_line_v1: 'pending', holding_line: 'approved' } });
        expect(by.missed_call_ack.state).toBe('approved');
        expect(by.video_request).toMatchObject({ state: 'present', resolvedName: 'video_request', byName: { video_request: 'rejected', job_video_request: 'missing' } });
        expect(by.call_request).toMatchObject({ state: 'missing', resolvedName: null });
        expect(s.requiredApproved).toBe(false);
        expect(s.counts).toEqual({ approved: 3, pending: 1, rejected: 1 });
        expect(s.lastSyncedAt).toBe('2026-09-03T10:00:00.000Z');
    });
    it('requiredApproved is true when every required purpose has an approved name; optional ones do not count', () => {
        const s = shapeTemplateStatus([
            row('holding_line_v1', 'approved'), row('missed_call_ack', 'approved'), row('job_video_request', 'approved'),
            row('postcode_request', 'approved'), row('call_request', 'approved'),
        ]);
        expect(s.requiredApproved).toBe(true);
        expect(s.expected.find((e) => e.names[0] === 'web_enquiry_ack_context')?.state).toBe('missing');
    });
    it('sorts the cached list approved first and prefers an approved duplicate', () => {
        const s = shapeTemplateStatus([row('zeta', 'pending'), row('alpha', 'approved'), row('holding_line_v1', 'rejected', { contentSid: 'old' }), row('holding_line_v1', 'approved', { contentSid: 'new' })]);
        expect(s.templates.map((t) => t.name)).toEqual(['alpha', 'holding_line_v1', 'zeta', 'holding_line_v1']); // approved, pending, rejected
        expect(s.expected[0].state).toBe('approved');
    });
    it('an empty cache is all missing with no sync time', () => {
        const s = shapeTemplateStatus([]);
        expect(s.lastSyncedAt).toBeNull();
        expect(s.expected.every((e) => e.state === 'missing')).toBe(true);
        expect(s.expected).toHaveLength(EXPECTED_TEMPLATES.length);
    });
});
