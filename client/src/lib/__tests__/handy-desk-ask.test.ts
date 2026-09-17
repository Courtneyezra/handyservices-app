/**
 * Handy Desk T2 - the ask bar's pure state: the ask body carries the selected card, refusals read
 * plainly, the ops_* events of this session (and only this session) fold into the live run, the run's
 * steps become thinking lines (newest amber while live), and the exchange on screen pairs the ask
 * with the answer carrying the run's id.
 */
import { describe, expect, it } from 'vitest';
import type { AskMessageDTO, LeanRunStep } from '@shared/ops-types';
import {
    applyAskEvent, askBody, askRefusal, currentExchange, settleRun, suggestions, thinkingLines, type AskRun,
} from '@/lib/handy-desk-ask';

const AT = '2026-09-17T09:00:00.000Z';
const SEL = { caseFileId: 'case_rob', address: 'phone:07700900942', name: 'Rob Hale' };

function msg(over: Partial<AskMessageDTO>): AskMessageDTO {
    return { id: 'm', sessionId: 's1', role: 'user', content: 'x', createdAt: AT, ...over } as AskMessageDTO;
}

describe('askBody', () => {
    it('sends the selected card as context by file id and address, trimmed', () => {
        expect(askBody('  draft a reply  ', 'typed', SEL)).toEqual({
            text: 'draft a reply', via: 'typed', context: { caseFileId: 'case_rob', phone: 'phone:07700900942' },
        });
    });
    it('sends no context with nothing selected', () => {
        expect(askBody('what needs me?', 'tap', null)).toEqual({ text: 'what needs me?', via: 'tap' });
    });
});

describe('askRefusal', () => {
    it('reads a run already going and a closed session plainly, and passes any other reason through', () => {
        expect(askRefusal(409, 'run_active')).toBe('The desk is still working on your last ask.');
        expect(askRefusal(409, 'session_archived')).toMatch(/closed/);
        expect(askRefusal(400, 'an ask needs text')).toBe('an ask needs text');
        expect(askRefusal(500, undefined)).toBe('The desk could not take that ask (500).');
    });
});

describe('applyAskEvent', () => {
    const step: LeanRunStep = { at: AT, type: 'tool_call', tool: 'get_board' };

    it('ignores other sessions and non-ops events', () => {
        expect(applyAskEvent(null, { type: 'ops_run_started', sessionId: 'other', runId: 'r1', at: AT }, 's1')).toEqual({ run: null, effect: 'none' });
        expect(applyAskEvent(null, { type: 'board_delta' }, 's1')).toEqual({ run: null, effect: 'none' });
    });

    it('opens, fills and finishes a run, keeping steps gathered before run_started', () => {
        let run: AskRun | null = { runId: 'r1', steps: [], finished: null };
        run = applyAskEvent(run, { type: 'ops_run_event', sessionId: 's1', runId: 'r1', step, at: AT }, 's1').run;
        run = applyAskEvent(run, { type: 'ops_run_started', sessionId: 's1', runId: 'r1', at: AT }, 's1').run;
        expect(run?.steps).toEqual([step]);
        const finished = applyAskEvent(run, { type: 'ops_run_finished', sessionId: 's1', runId: 'r1', ok: true, at: AT }, 's1');
        expect(finished.run?.finished).toEqual({ ok: true });
        expect(finished.effect).toBe('refetch');
    });

    it('joins a run it did not start, and marks the detail stale on a message', () => {
        const joined = applyAskEvent(null, { type: 'ops_run_event', sessionId: 's1', runId: 'r2', step, at: AT }, 's1').run;
        expect(joined).toEqual({ runId: 'r2', steps: [step], finished: null });
        expect(applyAskEvent(joined, { type: 'ops_message', sessionId: 's1', message: msg({}), at: AT }, 's1')).toEqual({ run: joined, effect: 'refetch' });
    });
});

describe('settleRun', () => {
    const live: AskRun = { runId: 'run_1', steps: [], finished: null };

    it('finishes a live run once its answer row is in the session, with no finish event', () => {
        const messages = [msg({ role: 'user' }), msg({ role: 'assistant', runId: 'run_1' })];
        expect(settleRun(live, messages)).toEqual({ ...live, finished: { ok: true } });
    });

    it('leaves a run alone with no answer row for it, or once already finished', () => {
        expect(settleRun(live, [msg({ role: 'assistant', runId: 'run_0' })])).toBe(live);
        const failed: AskRun = { ...live, finished: { ok: false } };
        expect(settleRun(failed, [msg({ role: 'assistant', runId: 'run_1' })])).toBe(failed);
        expect(settleRun(null, [])).toBeNull();
    });
});

describe('thinkingLines', () => {
    const steps: LeanRunStep[] = [
        { at: AT, type: 'route', detail: { surface: 'thread' } },
        { at: AT, type: 'tool_call', tool: 'get_case_file' },
        { at: AT, type: 'tool_result', tool: 'get_case_file', result: { id: 'case_rob' } },
        { at: AT, type: 'tool_call', tool: 'draft_reply' },
    ];

    it('lists the route and each tool call, the newest amber while live', () => {
        const lines = thinkingLines(steps, true);
        expect(lines.map((l) => [l.label, l.tool, l.state])).toEqual([
            ['Working out what you asked', null, 'done'],
            ['Reading the case file', 'get_case_file', 'done'],
            ['Drafting a reply to hold for you', 'draft_reply', 'current'],
        ]);
    });

    it('settles every line once finished, and shows a refused draft with its reason', () => {
        const lines = thinkingLines([...steps, { at: AT, type: 'tool_result', tool: 'draft_reply', result: { status: 'refused', reason: 'the file already holds a draft' } }], false);
        expect(lines.map((l) => l.state)).toEqual(['done', 'done', 'failed']);
        expect(lines[2].detail).toBe('the file already holds a draft');
    });

    it('marks a tool error and an unknown tool readably', () => {
        const lines = thinkingLines([
            { at: AT, type: 'tool_call', tool: 'look_up_thing' },
            { at: AT, type: 'tool_error', tool: 'look_up_thing', error: { message: 'boom' } },
        ], true);
        expect(lines).toEqual([{ key: 's1', tool: 'look_up_thing', label: 'Look up thing', detail: 'boom', state: 'failed' }]);
    });
});

describe('currentExchange', () => {
    const ask = msg({ id: 'a1', role: 'user', content: 'What did Rob say?', via: 'typed' });
    const answer = msg({ id: 'b1', role: 'assistant', content: 'He asked about Tuesday.', runId: 'r1', transcript: [{ at: AT, type: 'route' }], answer: { finalText: 'He asked about Tuesday.', surface: { type: 'words' } } });

    it('is nothing before any ask', () => {
        expect(currentExchange([], null, null)).toBeNull();
    });

    it('shows the pending ask with the live run before any row lands', () => {
        const run: AskRun = { runId: 'r1', steps: [{ at: AT, type: 'route' }], finished: null };
        expect(currentExchange([], run, { text: 'Draft a reply', via: 'tap', runId: 'r1' })).toEqual({
            ask: { text: 'Draft a reply', via: 'tap' }, answer: null, steps: run.steps, live: true, failed: false,
        });
    });

    it('pairs the run with the answer carrying its id, and lists the stored transcript once finished', () => {
        const run: AskRun = { runId: 'r1', steps: [], finished: { ok: true } };
        const ex = currentExchange([ask, answer], run, { text: 'What did Rob say?', via: 'typed', runId: 'r1' });
        expect(ex?.answer?.id).toBe('b1');
        expect(ex?.live).toBe(false);
        expect(ex?.steps).toEqual(answer.transcript);
    });

    it('does not pair a new run with the previous run\'s answer', () => {
        const run: AskRun = { runId: 'r2', steps: [], finished: null };
        const ex = currentExchange([ask, answer], run, { text: 'Show me the floor', via: 'tap', runId: 'r2' });
        expect(ex?.ask.text).toBe('Show me the floor');
        expect(ex?.answer).toBeNull();
    });

    it('says a finished run failed only when no answer came back for it', () => {
        const run: AskRun = { runId: 'r3', steps: [], finished: { ok: false } };
        expect(currentExchange([ask, answer], run, { text: 'x', via: 'typed', runId: 'r3' })?.failed).toBe(true);
    });

    it('with no run, shows the newest ask and the answer after it', () => {
        const ex = currentExchange([ask, answer], null, null);
        expect(ex?.ask).toEqual({ text: 'What did Rob say?', via: 'typed' });
        expect(ex?.answer?.id).toBe('b1');
    });
});

describe('suggestions', () => {
    it('names the selected customer by first name', () => {
        expect(suggestions(SEL)).toContain('Draft a reply to Rob');
        expect(suggestions(null)).toContain('What needs me?');
    });
});
