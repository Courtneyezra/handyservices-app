/**
 * P7 vitest: the freshness rule every layer shares (exit guard, supersede on inbound, spine exit
 * re-check) and the two pure folds. No database.
 */
import { describe, it, expect } from 'vitest';
import { staleAgainst, selectSuperseded, countInboundSince, AGENT_DRAFT_SOURCES } from './draft-freshness';

const T = (s: string) => new Date(`2026-09-02T${s}:00Z`);

describe('staleAgainst (the guard)', () => {
    it('no inbound on the thread → fresh', () => {
        expect(staleAgainst({ createdAt: T('14:15') }, null).stale).toBe(false);
    });
    it('draft older than the latest inbound → stale (the Janet incident: 14:15 draft, 14:28 photo)', () => {
        const v = staleAgainst({ createdAt: T('14:15') }, { id: 'm_1428', at: T('14:28'), hasMedia: true });
        expect(v.stale).toBe(true);
        expect(v.reason).toMatch(/with media/);
    });
    it('draft newer than the latest inbound → sends', () => {
        expect(staleAgainst({ createdAt: T('14:30') }, { id: 'm_1428', at: T('14:28') }).stale).toBe(false);
    });
    it('a draft written against a named inbound is fresh only while that inbound is still the latest', () => {
        expect(staleAgainst({ createdAt: T('14:15'), basedOnInboundId: 'm_1414' }, { id: 'm_1414', at: T('14:14') }).stale).toBe(false);
        // The inbound landed between the agent reading the thread and queueing: same minute, different id.
        const v = staleAgainst({ createdAt: T('14:29'), basedOnInboundId: 'm_1414' }, { id: 'm_1428', at: T('14:28') });
        expect(v.stale).toBe(true);
        expect(v.reason).toMatch(/m_1428.*m_1414/);
    });
    it('an unparseable created_at falls back to the id test only', () => {
        expect(staleAgainst({ createdAt: 'nope', basedOnInboundId: 'a' }, { id: 'a', at: T('14:28') }).stale).toBe(false);
        expect(staleAgainst({ createdAt: 'nope', basedOnInboundId: 'a' }, { id: 'b', at: T('14:28') }).stale).toBe(true);
    });
});

describe('selectSuperseded (supersede on inbound)', () => {
    const rows = [
        { id: 'legacy', source: 'comms_agent', status: 'pending', createdAt: T('14:15') },
        { id: 'spine', source: 'spine', status: 'pending', createdAt: T('14:16'), basedOnInboundId: 'm_1414' },
        { id: 'rules', source: 'rules_layer', status: 'pending', createdAt: T('14:15') },
        { id: 'manual', source: 'manual', status: 'pending', createdAt: T('14:15') },
        { id: 'sent', source: 'comms_agent', status: 'sent', createdAt: T('14:15') },
        { id: 'after', source: 'spine', status: 'pending', createdAt: T('14:30'), basedOnInboundId: 'm_1428' },
    ];
    it('rejects pending legacy + spine drafts older than the inbound; rules_layer, manual, sent and newer are untouched', () => {
        expect(selectSuperseded(rows, T('14:28'), 'm_1428').map((r) => r.id)).toEqual(['legacy', 'spine']);
    });
    it('without an inbound id the time test alone decides', () => {
        expect(selectSuperseded(rows, T('14:28')).map((r) => r.id)).toEqual(['legacy', 'spine']);
        expect(selectSuperseded(rows, T('14:10')).map((r) => r.id)).toEqual([]);
    });
    it('a spine draft written against the very inbound that just landed is not superseded by it', () => {
        expect(selectSuperseded([{ id: 'x', source: 'spine', status: 'pending', createdAt: T('14:10'), basedOnInboundId: 'm_1428' }], T('14:28'), 'm_1428')).toEqual([]);
    });
    it('the agent source set is exactly comms_agent and spine', () => {
        expect(Array.from(AGENT_DRAFT_SOURCES).sort()).toEqual(['comms_agent', 'spine']);
    });
});

describe('countInboundSince', () => {
    it('counts messages and media and names the newest', () => {
        const s = countInboundSince([{ id: 'a', at: T('14:20') }, { id: 'b', at: T('14:28'), hasMedia: true }, { id: 'c', at: T('14:25') }]);
        expect(s).toEqual({ count: 3, media: 1, latestAt: T('14:28').toISOString(), latestId: 'b' });
        expect(countInboundSince([])).toEqual({ count: 0, media: 0, latestAt: null, latestId: null });
    });
});
