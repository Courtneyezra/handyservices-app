/**
 * The runner's own rules, over a scripted door: one retry after a transient door failure, none
 * after a refusal, the seed's after-start steps, and one planned send per customer turn. This is a
 * unit test of the runner; the judge itself only ever runs against the real door (cli.ts).
 */
import { describe, expect, it } from 'vitest';
import { DoorError, type DoorClient } from './door';
import { RETRY_ONCE_ON, runAll, runScenario } from './runner';
import { parseScenario } from './scenario';

function pass(decision: 'send' | 'pending' = 'send', windowOpen = true) {
    return {
        ok: true,
        run: {
            runId: `run_${Math.random().toString(36).slice(2, 8)}`, pack: { id: 'customer.default' }, triage: { lane: 'scoper', intent: 'ask_gap' },
            proposal: { intent: 'ask_gap', body: ['Whereabouts are you?'] }, guards: { ok: true, guardsHit: [], notes: [] },
            decision: decision === 'send' ? { kind: 'send', approver: 'scoper' } : { kind: 'pending', reason: 'wait', dueAt: 'x' },
            caseFile: { stage: 'scoping', tags: [], window: { canFreeform: windowOpen } },
        },
        mirrored: null,
        state: { phone: { e164: '+447700900942' }, conversation: { id: 'conv', stage: 'scoping', tags: [] }, window: { canFreeform: windowOpen, summary: windowOpen ? 'OPEN' : 'SHUT' }, messages: [] },
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
        mode: 'http', baseUrl: 'scripted', calls,
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
        expect(r.errorKind).toBe('timeout');
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
    it('retries a scenario once after a transient door failure and keeps the first error as evidence', async () => {
        const door = scriptedDoor([new DoorError('timeout', 'POST /start timed out'), pass(), pass()]);
        const res = await runAll([twoTurns], { door, judge: null, runs: 1, requiredLines: [] });
        expect(door.calls).toEqual(['start', 'start', 'message']);
        expect(res.scenarios).toHaveLength(1);
        expect(res.scenarios[0].error).toBeNull();
        expect(res.scenarios[0].retriedAfter).toMatch(/timeout/);
        expect(res.lines.find((l) => l.line === '2.1')!.status).toBe('pass');
        expect(res.exitCode).toBe(0);
    });

    it('a second door failure stands as the error and the exit code is non-zero', async () => {
        const door = scriptedDoor([new DoorError('unreachable', 'gone'), new DoorError('unreachable', 'still gone')]);
        const res = await runAll([twoTurns], { door, judge: null, runs: 1, requiredLines: [] });
        expect(door.calls).toEqual(['start', 'start']);
        expect(res.scenarios[0].error).toMatch(/still gone/);
        expect(res.lines.find((l) => l.line === '2.1')!.status).toBe('error');
        expect(res.exitCode).toBe(1);
    });

    it('never retries a refusal or a bad shape: those are bugs, not blips', async () => {
        expect(RETRY_ONCE_ON).not.toContain('refused');
        expect(RETRY_ONCE_ON).not.toContain('shape');
        const door = scriptedDoor([new DoorError('refused', 'POST /start -> 400: text is empty')]);
        const res = await runAll([twoTurns], { door, judge: null, runs: 1, requiredLines: [] });
        expect(door.calls).toEqual(['start']);
        expect(res.exitCode).toBe(1);
    });

    it('a fail is not an error: exit code 0 with failing lines', async () => {
        const door = scriptedDoor([pass('pending'), pass('pending'), pass('pending'), pass('pending')]);
        const res = await runAll([twoTurns], { door, judge: null, runs: 2, requiredLines: [] });
        expect(res.summary).toEqual({ pass: 0, fail: 1, error: 0 });
        expect(res.exitCode).toBe(0);
    });
});
