/**
 * The gateway: one file per person across turns, a second person gets a second file, candidates
 * mean no reply, an internal number is never a customer, the seed lands as facts and ledger rows,
 * ageing shuts the window.
 */
import { describe, expect, it } from 'vitest';
import { Gateway } from './gateway';
import type { DeskLike, DeskResult } from './desk-types';
import type { CaseFile, Turn } from './case-file';
import type { InboundTurn } from './whatsapp-adapter';

const calls: Array<{ fileId: string; turnId: string | null }> = [];
const fakeDesk: DeskLike = {
    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> { calls.push({ fileId: file.id, turnId: turn.id }); return result(file); },
    async clockPass(file: CaseFile): Promise<DeskResult> { calls.push({ fileId: file.id, turnId: null }); return result(file); },
};
function result(file: CaseFile): DeskResult {
    return { runId: 'run_x', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
}
function turn(text: string, address = '+447700900942', at = '2026-09-11T10:00:00.000Z', via: InboundTurn['via'] = 'door'): InboundTurn {
    return { channel: 'whatsapp', address, name: 'Sam', text, media: [], at, providerMessageId: null, via, mediaFailures: [] };
}

describe('Gateway.inbound', () => {
    it('opens one file for a person and appends later turns to it; another person gets another file', async () => {
        const g = new Gateway({ desk: fakeDesk });
        const a = await g.inbound(turn('hi'));
        const b = await g.inbound(turn('more', '07700 900942', '2026-09-11T10:01:00.000Z'));
        const c = await g.inbound(turn('other', '+447700900111', '2026-09-11T10:02:00.000Z'));
        expect(a.kind === 'handled' && b.kind === 'handled' && c.kind === 'handled').toBe(true);
        if (a.kind !== 'handled' || b.kind !== 'handled' || c.kind !== 'handled') return;
        expect(a.file.id).toBe(b.file.id);
        expect(b.file.turns).toHaveLength(2);
        expect(c.file.id).not.toBe(a.file.id);
        expect(g.store.all()).toHaveLength(2);
    });
    it('remembers which WhatsApp sender the customer wrote to on the party\'s channel; the sandbox door leaves it unknown', async () => {
        const g = new Gateway({ desk: fakeDesk });
        const a = await g.inbound(turn('hi'));
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.file.parties[0].channels[0].transport ?? null).toBeNull();
        const b = await g.inbound(turn('more', '+447700900942', '2026-09-11T10:01:00.000Z', 'meta'));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.file.parties[0].channels[0].transport).toBe('meta');
        const c = await g.inbound(turn('again', '+447700900942', '2026-09-11T10:02:00.000Z', 'twilio'));
        if (c.kind !== 'handled') throw new Error(c.kind);
        expect(c.file.parties[0].channels[0].transport).toBe('twilio');
    });
    it('sends nothing when identity returns candidates, and refuses an internal number', async () => {
        const g = new Gateway({ desk: fakeDesk });
        g.identity.directory.upsert({ id: 'p1', role: 'homeowner', customerId: null, name: null, keys: ['phone:07700900942'], propertyId: null, landlordId: null });
        g.identity.directory.upsert({ id: 'p2', role: 'homeowner', customerId: null, name: null, keys: ['phone:07700900942'], propertyId: null, landlordId: null });
        const before = calls.length;
        const r = await g.inbound(turn('hi'));
        expect(r.kind).toBe('candidates');
        expect(calls.length).toBe(before);
        g.identity.registerInternal('phone:07700900001', 'Ben');
        const i = await g.inbound(turn('hi', '+447700900001'));
        expect(i.kind).toBe('refused');
    });
    it('honours the seed as facts and ledger rows, and ageing shuts the window', async () => {
        const g = new Gateway({ desk: fakeDesk, now: () => new Date('2026-09-11T10:00:00.000Z') });
        const r = await g.inbound(turn('hi'), { prefersText: true, alreadyRung: true, facts: [{ key: 'location', value: 'NG9 2AB', source: 'seed' }], ledger: [{ subject: 'media', state: 'asked' }] });
        if (r.kind !== 'handled') throw new Error(r.kind);
        expect(r.file.parties[0].prefersText).toBe(true);
        expect(r.file.parties[0].alreadyRung).toBe(true);
        expect(r.file.job.location).toBe('NG9 2AB');
        expect(r.file.ledger[0]).toMatchObject({ subject: 'media', answeredAt: null });
        expect(r.file.ledger[0].askedAt).not.toBeNull();
        const aged = g.age(r.file.id, 25)!;
        expect(Date.parse(aged.parties[0].channels[0].lastInboundAt!)).toBe(Date.parse('2026-09-11T10:00:00.000Z') - 25 * 3_600_000);
        expect(await g.clock(r.file.id)).not.toBeNull();
        expect(await g.clock('nope')).toBeNull();
    });
    it('a seeded fact may name a quote line, the one source a figure comes from', async () => {
        const g = new Gateway({ desk: fakeDesk, now: () => new Date('2026-09-11T10:00:00.000Z') });
        const r = await g.inbound(turn('hi'), { facts: [{ key: 'quote_line_tap', value: '£120', source: 'quote_line:Q-1:Supply and fit a mixer tap' }] });
        if (r.kind !== 'handled') throw new Error(r.kind);
        expect(r.file.facts[0]).toMatchObject({ value: '£120', source: { kind: 'quote_line', quoteRef: 'Q-1', line: 'Supply and fit a mixer tap' } });
    });
});
