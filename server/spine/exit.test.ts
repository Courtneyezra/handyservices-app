/**
 * Phase 2 vitest: exit() routing with injected dependencies. No database, no Pushover.
 */
import { describe, it, expect, vi } from 'vitest';
import { exit, type ExitDeps } from './exit';
import type { CaseFile, SpineRun, Decision } from './types';

vi.mock('../ledger', () => ({
    ledgerFlagRaised: vi.fn(async () => ({ inserted: true, id: 'e' })),
    ledgerRunDecided: vi.fn(async () => ({ inserted: true, id: 'e' })),
}));
import { ledgerRunDecided } from '../ledger';

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Sam',
        timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: new Date().toISOString(),
        ...over,
    };
}
function run(decision: Decision, over: Partial<SpineRun> = {}): SpineRun {
    return {
        runId: 'run_1', agent: 'scoper', trigger: 'inbound_message', pack: { id: 'customer.default', version: 1 }, caseFile: cf(),
        triage: { audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: ['r'], source: 'rules' },
        proposal: { intent: 'ask_gap', body: ['Which room?', 'And is it a mixer tap?'], reasons: ['gap'] },
        guards: { ok: true, guardsHit: [], escalate: false, notes: [] }, decision, ...over,
    };
}
function fakeDeps(): ExitDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        queueDraft: vi.fn(async (i) => { calls.push(`queue:${i.source}:${i.dueAt ? 'due' : 'nodue'}`); return 'draft_1'; }),
        approveAndSendDraft: vi.fn(async (id, approver, runId) => { calls.push(`send:${id}:${approver}:${runId}`); return { ok: true, mode: 'freeform' }; }),
        insertFlag: vi.fn(async (row, o) => { calls.push(`flag:${row.status}:${o.urgent ? 'urgent' : 'normal'}`); return row.id; }),
        notify: vi.fn(async () => { calls.push('notify'); }),
        now: () => new Date('2026-09-02T10:00:00Z'),
        ask: vi.fn(async () => null),
        resolveTemplate: vi.fn(async () => { calls.push('template'); return null; }),
    };
}
const SHUT = { canFreeform: false, templateRequired: true, lastInboundAt: '2026-09-01T08:00:00Z', channelLastUsed: 'whatsapp' as const };

describe('exit', () => {
    it('send → queueDraft(source spine) then approveAndSendDraft with the approver and run id', async () => {
        const d = fakeDeps();
        const out = await exit(run({ kind: 'send', approver: 'agent.scoper' }), d);
        expect(d.calls).toEqual(['queue:spine:nodue', 'send:draft_1:agent.scoper:run_1']);
        expect(out).toMatchObject({ kind: 'send', draftId: 'draft_1', sent: true, mode: 'freeform' });
        expect((d.queueDraft as any).mock.calls[0][0].body).toBe('Which room?\n---\nAnd is it a mixer tap?');
        expect((d.queueDraft as any).mock.calls[0][0].runId).toBe('run_1');
    });
    it('pending → queueDraft with due_at and run id, never approves', async () => {
        const d = fakeDeps();
        const out = await exit(run({ kind: 'pending', dueAt: '2026-09-02T14:00:00Z', reason: 'tier DRAFT' }), d);
        expect(d.calls).toEqual(['queue:spine:due']);
        expect((d.queueDraft as any).mock.calls[0][0].dueAt).toEqual(new Date('2026-09-02T14:00:00Z'));
        expect(out).toMatchObject({ kind: 'pending', draftId: 'draft_1' });
    });
    it('flag → agent_questions row (flagged, due_at, run_id) + one Pushover; callback is urgent', async () => {
        const d = fakeDeps();
        const out = await exit(run({ kind: 'flag', exception: 'callback_requested', dueAt: '2026-09-02T10:20:00Z', note: 'wants a call' }), d);
        expect(d.calls).toEqual(['flag:flagged:urgent', 'notify']);
        const row = (d.insertFlag as any).mock.calls[0][0];
        expect(row).toMatchObject({ status: 'flagged', runId: 'run_1', conversationId: 'c1', source: 'spine:scoper' });
        expect(row.question).toMatch(/^\[callback_requested\] wants a call/);
        expect(row.dueAt).toEqual(new Date('2026-09-02T10:20:00Z'));
        expect(out).toMatchObject({ kind: 'flag', questionId: row.id });
    });
    it('flag on a thread already flagged → deduped, no row, no ping', async () => {
        const d = fakeDeps();
        const out = await exit(run({ kind: 'flag', exception: 'money_question', dueAt: '2026-09-02T14:00:00Z', note: 'money' }, { caseFile: cf({ tags: ['needs_ben'] }) }), d);
        expect(d.calls).toEqual([]);
        expect(out).toMatchObject({ kind: 'flag', deduped: true });
    });
    it('drop and none → ledger event only', async () => {
        const d = fakeDeps();
        (ledgerRunDecided as any).mockClear();
        await exit(run({ kind: 'drop', reason: 'spam' }), d);
        await exit(run({ kind: 'none', reason: 'no proposal' }, { proposal: null }), d);
        expect(d.calls).toEqual([]);
        expect((ledgerRunDecided as any).mock.calls.map((c: any[]) => c[0].decision)).toEqual(['drop', 'none']);
        expect((ledgerRunDecided as any).mock.calls[0][0].runId).toBe('run_1');
    });
    // P6: template-first exit.
    it('send with the window open never looks up a template', async () => {
        const d = fakeDeps();
        await exit(run({ kind: 'send', approver: 'agent.scoper' }), d);
        expect(d.resolveTemplate).not.toHaveBeenCalled();
        expect((d.queueDraft as any).mock.calls[0][0].contentSid).toBeUndefined();
    });
    it('send with the window shut and an approved template queues the draft with contentSid + variables and sends it', async () => {
        const d = fakeDeps();
        d.resolveTemplate = vi.fn(async (i) => { d.calls.push(`template:${i.packId}/${i.intent}`); return { name: 'holding_line_v1', contentSid: 'HX123', variables: { '1': 'Sam' }, body: 'Hi Sam, thanks for your message.' }; });
        d.approveAndSendDraft = vi.fn(async (id, approver, runId) => { d.calls.push(`send:${id}:${approver}:${runId}`); return { ok: true, mode: 'template' }; });
        const out = await exit(run({ kind: 'send', approver: 'agent.scoper' }, { caseFile: cf({ window: SHUT, contactName: 'Sam' }) }), d);
        expect(d.calls).toEqual(['template:customer.default/ask_gap', 'queue:spine:nodue', 'send:draft_1:agent.scoper:run_1']);
        const queued = (d.queueDraft as any).mock.calls[0][0];
        expect(queued).toMatchObject({ contentSid: 'HX123', contentVariables: { '1': 'Sam' }, body: 'Hi Sam, thanks for your message.', source: 'spine', runId: 'run_1' });
        expect(queued.reason).toMatch(/Template holding_line_v1/);
        expect((d.resolveTemplate as any).mock.calls[0][0]).toMatchObject({ packId: 'customer.default', intent: 'ask_gap', contactName: 'Sam' });
        expect(out).toMatchObject({ kind: 'send', draftId: 'draft_1', sent: true, mode: 'template', template: 'holding_line_v1' });
    });
    it('send with the window shut and NO approved template falls to the freeform path, which is refused OUTSIDE_WINDOW and left pending (never silent, never freeform outside the window)', async () => {
        const d = fakeDeps();
        d.approveAndSendDraft = vi.fn(async () => ({ ok: false, code: 'OUTSIDE_WINDOW', message: 'window shut' }));
        const out = await exit(run({ kind: 'send', approver: 'agent.scoper' }, { caseFile: cf({ window: SHUT }) }), d);
        expect(d.resolveTemplate).toHaveBeenCalledTimes(1);
        const queued = (d.queueDraft as any).mock.calls[0][0];
        expect(queued.contentSid).toBeUndefined();
        expect(queued.body).toBe('Which room?\n---\nAnd is it a mixer tap?');
        expect(out).toMatchObject({ kind: 'send', draftId: 'draft_1', sent: false, detail: expect.stringMatching(/OUTSIDE_WINDOW.*no approved template/) });
    });
    it('an SMS thread with no window is sent freeform without a template lookup', async () => {
        const d = fakeDeps();
        await exit(run({ kind: 'send', approver: 'agent.scoper' }, { caseFile: cf({ window: { ...SHUT, channelLastUsed: 'sms' } }) }), d);
        expect(d.resolveTemplate).not.toHaveBeenCalled();
    });
    it('a throwing template lookup falls to the pending path instead of losing the draft', async () => {
        const d = fakeDeps();
        d.resolveTemplate = vi.fn(async () => { throw new Error('twilio down'); });
        d.approveAndSendDraft = vi.fn(async () => ({ ok: false, code: 'OUTSIDE_WINDOW', message: 'window shut' }));
        const out = await exit(run({ kind: 'send', approver: 'agent.scoper' }, { caseFile: cf({ window: SHUT }) }), d);
        expect(d.queueDraft).toHaveBeenCalledTimes(1);
        expect((d.queueDraft as any).mock.calls[0][0].contentSid).toBeUndefined();
        expect(out).toMatchObject({ kind: 'send', draftId: 'draft_1', sent: false });
    });
    it('a refused send is reported, not thrown', async () => {
        const d = fakeDeps();
        d.approveAndSendDraft = vi.fn(async () => ({ ok: false, code: 'NEAR_DUPLICATE', message: 'held' }));
        const out = await exit(run({ kind: 'send', approver: 'agent.scoper' }), d);
        expect(out).toMatchObject({ kind: 'send', sent: false, detail: expect.stringMatching(/NEAR_DUPLICATE/) });
    });
});
