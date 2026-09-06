/**
 * T5 vitest: the spine's live run feed, pure parts. No database, no bus listeners.
 */
import { describe, it, expect, vi } from 'vitest';
import { leanTranscriptEvent, stageEvent, truncateForWire, wouldHaveHappened, runEmitter } from './run-events';
import type { CaseFile } from './types';

vi.mock('../comms-events', () => ({ emitCommsEvent: vi.fn() }));

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700900942', audience: 'customer', stage: 'quote_sent', contactName: 'Sandbox',
        timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: new Date().toISOString(),
        ...over,
    };
}

describe('leanTranscriptEvent (moved from the legacy agent)', () => {
    it('keeps the tool name and truncates long strings and arrays', () => {
        const long = 'x'.repeat(2_000);
        const lean = leanTranscriptEvent({ at: 't', type: 'tool_result', detail: { tool: 'get_thread', result: { body: long, items: Array.from({ length: 50 }, (_, i) => i) } } }) as any;
        expect(lean.type).toBe('tool_result');
        expect(lean.tool).toBe('get_thread');
        expect(lean.result.body.length).toBeLessThan(600);
        expect(lean.result.body.endsWith('[truncated]')).toBe(true);
        expect(lean.result.items).toHaveLength(20);
    });
    it('survives a cycle', () => {
        const a: any = { name: 'a' }; a.self = a;
        expect((truncateForWire(a) as any).self).toBe('[circular]');
    });
    it('tool_call / tool_error / assistant_text keep their shapes', () => {
        expect(leanTranscriptEvent({ at: 't', type: 'tool_call', detail: { tool: 'propose_reply', input: { intent: 'ask_gap' } } })).toMatchObject({ type: 'tool_call', tool: 'propose_reply', input: { intent: 'ask_gap' } });
        expect(leanTranscriptEvent({ at: 't', type: 'tool_error', detail: { tool: 'x', error: 'boom' } })).toMatchObject({ type: 'tool_error', tool: 'x', error: 'boom' });
        expect(leanTranscriptEvent({ at: 't', type: 'assistant_text', detail: { text: 'thinking' } })).toMatchObject({ type: 'assistant_text', detail: { text: 'thinking' } });
    });
});

describe('stageEvent', () => {
    it('is a stage step with a label and a truncated detail', () => {
        const e = stageEvent('triage', 'Triage: lane scoper', { reasons: ['r'.repeat(700)] });
        expect(e.type).toBe('stage');
        expect(e.stage).toBe('triage');
        expect(e.label).toBe('Triage: lane scoper');
        expect((e.detail as any).reasons[0].length).toBeLessThan(600);
        expect(typeof e.at).toBe('string');
    });
});

describe('wouldHaveHappened — the exit boundary, in one line', () => {
    const proposal = { intent: 'ask_gap' as const, body: ['Which room?', 'Photo?'], reasons: [] };
    it('send says SENT, loudly, with the approver and the bubble count', () => {
        const s = wouldHaveHappened({ decision: { kind: 'send', approver: 'agent.scoper' }, proposal, caseFile: cf() });
        expect(s).toMatch(/^SENT to the customer with no human approval \(agent\.scoper\): 2 bubbles/);
    });
    it('send with the window shut says only a template would go', () => {
        const s = wouldHaveHappened({ decision: { kind: 'send', approver: 'agent.scoper' }, proposal, caseFile: cf({ window: { canFreeform: false, templateRequired: true, lastInboundAt: null, channelLastUsed: 'whatsapp' } }) });
        expect(s).toContain('window shut');
    });
    it('pending is a draft for Ben with the reason', () => {
        expect(wouldHaveHappened({ decision: { kind: 'pending', dueAt: '2026-09-06T10:00:00Z', reason: 'intent ask_gap is at tier DRAFT' }, proposal, caseFile: cf() }))
            .toBe('queued as a DRAFT for Ben to approve (due 2026-09-06T10:00:00Z) — intent ask_gap is at tier DRAFT');
    });
    it('flag names the exception, and says so when the thread is already flagged', () => {
        const d = { kind: 'flag' as const, exception: 'callback_requested' as const, dueAt: 'd', note: 'n' };
        expect(wouldHaveHappened({ decision: d, proposal, caseFile: cf() })).toContain('flagged for Ben (callback_requested), due d');
        expect(wouldHaveHappened({ decision: d, proposal, caseFile: cf({ tags: ['needs_ben'] }) })).toContain('already flagged');
    });
    it('drop and none say nothing went out', () => {
        expect(wouldHaveHappened({ decision: { kind: 'drop', reason: 'spam' }, proposal: null, caseFile: cf() })).toContain('dropped — spam');
        expect(wouldHaveHappened({ decision: { kind: 'none', reason: 'no proposal' }, proposal: null, caseFile: cf() })).toBe('nothing sent — no proposal');
    });
});

describe('runEmitter', () => {
    it('emits run_started / run_event / run_finished with the run and conversation ids', () => {
        const emit = vi.fn();
        const ev = runEmitter('run_1', 'conv_1', emit as any);
        ev.started();
        ev.step({ type: 'tool_call', tool: 'x' });
        ev.stage('decision', 'Decision: pending', { kind: 'pending' });
        ev.finished(true);
        const types = emit.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['run_started', 'run_event', 'run_event', 'run_finished']);
        expect(emit.mock.calls[2][0]).toMatchObject({ runId: 'run_1', conversationId: 'conv_1', event: { type: 'stage', stage: 'decision', label: 'Decision: pending' } });
        expect(emit.mock.calls[3][0]).toMatchObject({ ok: true });
    });
    it('a throwing bus is logged and swallowed — the caller never sees it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ev = runEmitter('run_1', 'conv_1', (() => { throw new Error('bus down'); }) as any);
        expect(() => { ev.started(); ev.step({}); ev.stage('note', 'x'); ev.finished(false); }).not.toThrow();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
    it('no ids → a no-op emitter', () => {
        const emit = vi.fn();
        runEmitter('', 'conv', emit as any).started();
        expect(emit).not.toHaveBeenCalled();
    });
});
