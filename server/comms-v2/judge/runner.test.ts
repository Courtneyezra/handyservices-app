/**
 * The runner's own rules, over a scripted door: a door failure stands as the error with no retry,
 * the seed's after-start steps, one planned send per customer turn, and the artefact verdict when
 * the door never put a planned reply on the thread. This is a unit test of the runner; the judge
 * itself only ever runs against the real door (cli.ts).
 */
import { describe, expect, it } from 'vitest';
import { DoorError, type DoorClient } from './door';
import { ARTEFACT_REASON } from './expectations';
import { RUNS, runAll, runScenario, sendLanded } from './runner';
import { parseScenario } from './scenario';
import { plannedSendFromDoorResponse } from './planned-send';

function pass(decision: 'send' | 'pending' = 'send', windowOpen = true, opts: { landed?: boolean } = {}) {
    const bubble = 'Whereabouts are you?';
    return {
        ok: true,
        run: {
            runId: `run_${Math.random().toString(36).slice(2, 8)}`, pack: { id: 'customer.default' }, triage: { lane: 'scoper', intent: 'ask_gap' },
            proposal: { intent: 'ask_gap', body: [bubble] }, guards: { ok: true, guardsHit: [], notes: [] },
            decision: decision === 'send' ? { kind: 'send', approver: 'scoper' } : { kind: 'pending', reason: 'wait', dueAt: 'x' },
            caseFile: { stage: 'scoping', tags: [], window: { canFreeform: windowOpen } },
        },
        mirrored: null,
        state: {
            phone: { e164: '+447700900942' }, conversation: { id: 'conv', stage: 'scoping', tags: [] }, window: { canFreeform: windowOpen, summary: windowOpen ? 'OPEN' : 'SHUT' },
            messages: opts.landed ? [{ direction: 'inbound', content: 'hi' }, { direction: 'outbound', content: bubble }] : [{ direction: 'inbound', content: 'hi' }],
        },
    };
}

/** A door that answers from a script of responses or throws; records every call. */
function scriptedDoor(script: Array<unknown | Error>, opts: { ageShuts?: boolean } = {}): DoorClient & { calls: string[] } {
    const calls: string[] = [];
    const next = async (op: string) => {
        calls.push(op);
        const r = script.shift();
        if (r instanceof Error) throw r;
        return r ?? pass();
    };
    return {
        mode: 'http', host: 'scripted', calls,
        reset: () => next('reset'), start: () => next('start'), message: () => next('message'), clock: () => next('clock'),
        age: async (h) => { calls.push(`age ${h}`); return { ok: true, state: pass('send', !opts.ageShuts).state }; },
        call: () => next('call'), price: () => next('price'), state: () => next('state'), close: async () => undefined,
    };
}

const twoTurns = parseScenario({ id: '2.1-x', title: 't', lines: ['2.1'], turns: [
    { from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.1', kind: 'reply_sent' }] },
    { from: 'customer', kind: 'message', text: 'more', expect: [{ line: '2.1', kind: 'reply_sent' }] },
] });

describe('runScenario', () => {
    it('yields one planned send per customer turn and judges each expectation', async () => {
        const door = scriptedDoor([pass(), pass('pending')]);
        const r = await runScenario(twoTurns, { door, judge: null, run: 1 });
        expect(r.error).toBeNull();
        expect(door.calls).toEqual(['start', 'message']);
        expect(r.turns.map((t) => t.plannedSend?.delivered)).toEqual([true, false]);
        expect(r.turns.map((t) => t.expectations[0].status)).toEqual(['pass', 'fail']);
    });

    it('a door timeout marks the turn and every later turn as error, never pass', async () => {
        const door = scriptedDoor([new DoorError('timeout', 'POST /start timed out')]);
        const r = await runScenario(twoTurns, { door, judge: null, run: 1 });
        expect(r.error).toMatch(/timeout/);
        expect(r.turns.flatMap((t) => t.expectations.map((e) => e.status))).toEqual(['error', 'error']);
        expect(door.calls).toEqual(['start']);
    });

    it('a shut-window seed ages the thread after the opening turn and records whether the door honoured it', async () => {
        const shut = parseScenario({ id: 'w-1', title: 't', lines: ['2.1'], seed: { window: 'shut' }, turns: [{ from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.1', kind: 'window_state', state: 'shut' }] }] });
        const honoured = await runScenario(shut, { door: scriptedDoor([pass()], { ageShuts: true }), judge: null, run: 1 });
        expect(honoured.seed.unsupported).toEqual([]);
        expect(honoured.turns[0].expectations[0].status).toBe('pass');
        const notHonoured = await runScenario(shut, { door: scriptedDoor([pass()], { ageShuts: false }), judge: null, run: 1 });
        expect(notHonoured.seed.unsupported).toEqual(['window']);
        expect(notHonoured.turns[0].expectations[0].reason).toBe('window seed unsupported by current desk');
    });
});

describe('a planned reply the door never put on the thread', () => {
    const replyThenQuiet = parseScenario({ id: '2.8-x', title: 't', lines: ['2.8'], turns: [
        { from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.8', kind: 'reply_sent' }] },
        { from: 'system', kind: 'clock', expect: [{ line: '2.8', kind: 'reply_not_sent' }] },
    ] });

    it('sendLanded reads the door state for an outbound message carrying the first bubble', () => {
        const landed = plannedSendFromDoorResponse(pass('send', true, { landed: true }));
        const missing = plannedSendFromDoorResponse(pass('send', true, { landed: false }));
        expect(sendLanded(landed.plannedSend, landed.pass)).toBe(true);
        expect(sendLanded(missing.plannedSend, missing.pass)).toBe(false);
        const silent = plannedSendFromDoorResponse(pass('pending'));
        expect(sendLanded(silent.plannedSend, silent.pass)).toBe(false);
    });

    it('marks the post-send-dependent expectations on later turns as fail with the artefact reason', async () => {
        const r = await runScenario(replyThenQuiet, { door: scriptedDoor([pass('send', true, { landed: false }), pass('send')]), judge: null, run: 1 });
        expect(r.turns[0].landed).toBe(false);
        expect(r.turns[0].expectations[0].status).toBe('pass');
        expect(r.turns[1].expectations[0]).toMatchObject({ kind: 'reply_not_sent', status: 'fail', reason: ARTEFACT_REASON });
    });

    it('judges the desk when the reply did land', async () => {
        const r = await runScenario(replyThenQuiet, { door: scriptedDoor([pass('send', true, { landed: true }), pass('send')]), judge: null, run: 1 });
        expect(r.turns[0].landed).toBe(true);
        const quiet = r.turns[1].expectations[0];
        expect(quiet.status).toBe('fail');
        expect(quiet.reason).not.toBe(ARTEFACT_REASON);
        expect(quiet.reason).toMatch(/a reply would go/);
    });
});

describe('the model judge beside own_words', () => {
    const ownWords = parseScenario({ id: '2.3-x', title: 't', lines: ['2.3'], turns: [
        { from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.3', kind: 'own_words' }] },
        { from: 'customer', kind: 'message', text: 'more', expect: [{ line: '2.3', kind: 'own_words' }] },
    ] });
    it('is asked only when a reply would go, and its verdict sits beside the deterministic result', async () => {
        const asked: string[][] = [];
        const judge = { ownWords: async (i: { bubbles: readonly string[] }) => { asked.push([...i.bubbles]); return { model: 'm', promptHash: 'h', verdict: 'yes' as const, reason: 'natural' }; } };
        const r = await runScenario(ownWords, { door: scriptedDoor([pass(), pass('pending')]), judge, run: 1 });
        expect(asked).toEqual([['Whereabouts are you?']]);
        expect(r.turns[0].expectations[0]).toMatchObject({ status: 'pass', modelJudge: { verdict: 'yes' } });
        expect(r.turns[1].expectations[0]).toMatchObject({ status: 'fail', modelJudge: { verdict: 'skipped', reason: 'no reply to judge' } });
    });
});

describe('runAll', () => {
    it('runs the whole set twice and records the door by mode and host only', async () => {
        const door = scriptedDoor([]);
        const res = await runAll([twoTurns], { door, judge: null, requiredLines: [] });
        expect(RUNS).toBe(2);
        expect(res.runs).toBe(2);
        expect(res.scenarios.map((s) => s.run)).toEqual([1, 2]);
        expect(door.calls).toEqual(['start', 'message', 'start', 'message']);
        expect(res.door).toEqual({ mode: 'http', host: 'scripted' });
        expect(res.lines.find((l) => l.line === '2.1')!.status).toBe('pass');
        expect(res.exitCode).toBe(0);
    });

    it('a door failure stands as the error with no retry, and the exit code is non-zero', async () => {
        const door = scriptedDoor([new DoorError('timeout', 'POST /start timed out')]);
        const res = await runAll([twoTurns], { door, judge: null, requiredLines: [] });
        expect(door.calls).toEqual(['start', 'start', 'message']);
        expect(res.scenarios[0]).toMatchObject({ run: 1, error: expect.stringMatching(/timed out/) });
        expect(res.scenarios[1]).toMatchObject({ run: 2, error: null });
        expect(res.lines.find((l) => l.line === '2.1')!.status).toBe('error');
        expect(res.exitCode).toBe(1);
    });

    it('a fail is not an error: exit code 0 with failing lines', async () => {
        const door = scriptedDoor([pass('pending'), pass('pending'), pass('pending'), pass('pending')]);
        const res = await runAll([twoTurns], { door, judge: null, requiredLines: [] });
        expect(res.summary).toEqual({ pass: 0, fail: 1, error: 0 });
        expect(res.exitCode).toBe(0);
    });
});
