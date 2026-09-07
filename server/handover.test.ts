/**
 * T17: the way back from Ben (server/handover.ts), with injected deps. No database, no Pushover.
 */
import { describe, it, expect, vi } from 'vitest';
import { releaseFromBen, noteHumanSend, isHumanApprover, NEEDS_BEN_TAG, type ReleaseDeps } from './handover';

vi.mock('./db', () => ({ db: {} }));

function fakeDeps(over: { tags?: string[]; flags?: string[]; conv?: boolean } = {}) {
    const calls: string[] = [];
    const tags = over.tags ?? [NEEDS_BEN_TAG, 'needs_quote'];
    const deps: ReleaseDeps & { calls: string[] } = {
        calls,
        loadConversation: vi.fn(async (t) => {
            calls.push(`load:${t.conversationId ?? ''}:${t.phone ?? ''}`);
            return over.conv === false ? null : { id: 'c1', phoneNumber: '447700900111@c.us', tags };
        }),
        clearTag: vi.fn(async (id, without) => { calls.push(`clear:${id}:${without.join(',')}`); }),
        dismissFlags: vi.fn(async (id, by) => { calls.push(`dismiss:${id}:${by}`); return over.flags ?? ['aq_1']; }),
        ledgerFlagClosed: vi.fn(async (a) => { calls.push(`ledger:${a.questionId}:${a.closedBy}`); return { inserted: true }; }),
        emitBoardDelta: vi.fn((id) => { calls.push(`emit:${id}`); }),
        log: vi.fn((summary) => { calls.push(`log:${summary.split(' — ')[0]}`); }),
    };
    return deps;
}

describe('isHumanApprover', () => {
    it('a person is human:<id>; contractors and every automated approver are not', () => {
        expect(isHumanApprover('human:ben@handyservices.app')).toBe(true);
        expect(isHumanApprover('human:')).toBe(false);
        expect(isHumanApprover('contractor:hp_1')).toBe(false);
        expect(isHumanApprover('agent.scoper')).toBe(false);
        expect(isHumanApprover('rules.holding')).toBe(false);
        expect(isHumanApprover('system.quick_reply')).toBe(false);
        expect(isHumanApprover(undefined)).toBe(false);
    });
});

describe('releaseFromBen', () => {
    it('a Ben-owned thread: flags dismissed and ledgered first, then the tag comes off (other tags kept), the board told', async () => {
        const d = fakeDeps();
        const out = await releaseFromBen({ conversationId: 'c1' }, { by: 'human:ben@x', reason: 'human reply sent', now: new Date('2026-09-07T10:00:00Z') }, d);
        expect(out).toEqual({ conversationId: 'c1', tagCleared: true, flagsDismissed: 1, released: true });
        expect(d.calls).toEqual([
            'load:c1:', 'dismiss:c1:human:ben@x', 'ledger:aq_1:human:ben@x', 'clear:c1:needs_quote', 'emit:c1', 'log:handover: thread released from Ben by human:ben@x',
        ]);
        expect((d.dismissFlags as any).mock.calls[0][2]).toEqual(new Date('2026-09-07T10:00:00Z'));
    });

    it('resolves the thread by phone in any spelling when no id is given', async () => {
        const d = fakeDeps();
        await releaseFromBen({ phone: '+44 7700 900111' }, { by: 'human:ben@x', reason: 'r' }, d);
        expect(d.calls[0]).toBe('load::+44 7700 900111');
    });

    it('is idempotent: no tag and no open flag → nothing written, nothing emitted, released false', async () => {
        const d = fakeDeps({ tags: ['needs_quote'], flags: [] });
        const out = await releaseFromBen({ conversationId: 'c1' }, { by: 'human:ben@x', reason: 'r' }, d);
        expect(out).toEqual({ conversationId: 'c1', tagCleared: false, flagsDismissed: 0, released: false });
        expect(d.calls).toEqual(['load:c1:', 'dismiss:c1:human:ben@x']);
    });

    it('an open flag row with the tag already gone is still dismissed (the row alone holds later replies)', async () => {
        const d = fakeDeps({ tags: [], flags: ['aq_9'] });
        const out = await releaseFromBen({ conversationId: 'c1' }, { by: 'system:human_reply_seen', reason: 'r' }, d);
        expect(out).toMatchObject({ tagCleared: false, flagsDismissed: 1, released: true });
        expect(d.calls).toContain('ledger:aq_9:system:human_reply_seen');
        expect(d.calls.some((c) => c.startsWith('clear:'))).toBe(false);
    });

    it('an unknown thread → a quiet no-op', async () => {
        const d = fakeDeps({ conv: false });
        const out = await releaseFromBen({ phone: '+447700900999' }, { by: 'human:ben@x', reason: 'r' }, d);
        expect(out.released).toBe(false);
        expect(out.conversationId).toBeNull();
    });

    it('never throws: a failing write is logged and the outcome is a no-op (the send stands)', async () => {
        const d = fakeDeps();
        d.dismissFlags = vi.fn(async () => { throw new Error('db down'); });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const out = await releaseFromBen({ conversationId: 'c1' }, { by: 'human:ben@x', reason: 'r' }, d);
        expect(out.released).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('noteHumanSend (the hook on the send gate)', () => {
    it('an automated or contractor approver does nothing at all — not even a read', async () => {
        expect(await noteHumanSend({ to: '+447700900111', approver: 'agent.scoper' })).toBeNull();
        expect(await noteHumanSend({ to: '+447700900111', approver: 'rules.holding' })).toBeNull();
        expect(await noteHumanSend({ to: '+447700900111', approver: 'contractor:hp_1' })).toBeNull();
    });
});
