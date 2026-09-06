/**
 * T5 vitest (client): LiveRunPanel renders the spine's stage events and, with keepFinished, keeps
 * the finished pass on screen. The SSE hook is mocked: the test pushes events by hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

type Listener = (evt: any) => void;
// One mounted panel per test; the real hook keeps the latest callback in a ref, so the mock
// keeps only the latest too (a new closure arrives on every render).
let latest: Listener | null = null;
vi.mock('@/hooks/useCommsEvents', () => ({
    useCommsEvents: (onEvent?: Listener) => { latest = onEvent ?? null; },
}));

import { LiveRunPanel, applyRunStep, type LiveRun } from '@/components/comms/LiveRunPanel';

const push = (evt: any) => act(() => { latest?.(evt); });
const at = '2026-09-06T10:00:00.000Z';

beforeEach(() => { latest = null; vi.useRealTimers(); });

describe('applyRunStep with stage events', () => {
    const keys = () => { let n = 0; return () => `k${++n}`; };
    it('adds a stage as its own line and settles any spinning tool', () => {
        const nextKey = keys();
        let run: LiveRun = { runId: 'r', lines: [], finished: null };
        run = applyRunStep(run, { type: 'tool_call', tool: 'get_thread' }, nextKey);
        expect(run.lines[0].pending).toBe(true);
        run = applyRunStep(run, { type: 'stage', stage: 'proposal', label: 'Proposed ask_gap: 1 bubble' }, nextKey);
        expect(run.lines).toHaveLength(2);
        expect(run.lines[0].pending).toBe(false);
        expect(run.lines[1]).toMatchObject({ kind: 'stage', stage: 'proposal', label: 'Proposed ask_gap: 1 bubble', pending: false });
    });
    it('a stage with no label is ignored; unknown types still are', () => {
        const nextKey = keys();
        const run: LiveRun = { runId: 'r', lines: [], finished: null };
        expect(applyRunStep(run, { type: 'stage' }, nextKey)).toBe(run);
        expect(applyRunStep(run, { type: 'done' }, nextKey)).toBe(run);
    });
});

describe('<LiveRunPanel keepFinished>', () => {
    it('shows the stages for its conversation, ignores other threads, and stays up after run_finished', () => {
        vi.useFakeTimers();
        render(<LiveRunPanel conversationId="sbx" keepFinished />);
        expect(screen.queryByTestId('live-run-panel')).toBeNull();

        push({ type: 'run_started', runId: 'run_1', conversationId: 'sbx', at });
        push({ type: 'run_event', runId: 'run_1', conversationId: 'sbx', at, event: { type: 'stage', stage: 'triage', label: 'Triage (rules): lane post_quote' } });
        push({ type: 'run_event', runId: 'run_1', conversationId: 'sbx', at, event: { type: 'tool_call', tool: 'propose_reply' } });
        push({ type: 'run_event', runId: 'run_1', conversationId: 'other', at, event: { type: 'stage', stage: 'triage', label: 'NOT MINE' } });
        push({ type: 'run_event', runId: 'run_1', conversationId: 'sbx', at, event: { type: 'stage', stage: 'exit', label: 'DRY RUN — nothing sent' } });
        push({ type: 'run_finished', runId: 'run_1', conversationId: 'sbx', ok: true, at });

        expect(screen.getByText('Triage (rules): lane post_quote')).toBeTruthy();
        expect(screen.getByText('Propose reply')).toBeTruthy();
        expect(screen.queryByText('NOT MINE')).toBeNull();
        const exitLine = screen.getByText('DRY RUN — nothing sent').closest('li')!;
        expect(exitLine.getAttribute('data-stage')).toBe('exit');
        expect(screen.getByText('Agent finished')).toBeTruthy();

        act(() => { vi.advanceTimersByTime(10_000); });
        expect(screen.getByTestId('live-run-panel')).toBeTruthy();
        expect(screen.getByText('DRY RUN — nothing sent')).toBeTruthy();
    });

    it('without keepFinished the finished panel still clears itself (the desk behaviour is unchanged)', () => {
        vi.useFakeTimers();
        render(<LiveRunPanel conversationId="c1" />);
        push({ type: 'run_started', runId: 'run_2', conversationId: 'c1', at });
        push({ type: 'run_finished', runId: 'run_2', conversationId: 'c1', ok: true, at });
        expect(screen.getByTestId('live-run-panel')).toBeTruthy();
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(screen.queryByTestId('live-run-panel')).toBeNull();
    });
});
