import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { seedPlan } from './door';
import { buildOwnWordsPrompt, makeModelJudge, parseVerdict } from './model-judge';
import { UNAVAILABLE, allGuardsUnavailable, type PlannedSend } from './planned-send';
import { renderMarkdown } from './report';
import { lineResults, type ScenarioRunResult } from './runner';
import { FIXTURES_DIR, GOAL_1_LINES, SCENARIOS_DIR, loadScenarios, parseScenario, seedSchema, uncoveredGoal1Lines } from './scenario';

describe('the scenario files', () => {
    const scenarios = loadScenarios();

    it('one per Goal 1 line, every line covered, every scenario on the WhatsApp door', () => {
        expect(scenarios).toHaveLength(GOAL_1_LINES.length);
        expect(uncoveredGoal1Lines(scenarios)).toEqual([]);
        for (const l of GOAL_1_LINES) expect(scenarios.some((s) => s.id.startsWith(`${l}-`) && s.lines.includes(l)), l).toBe(true);
        for (const s of scenarios) expect(s.door).toBe('whatsapp');
    });

    it('every turn expectation is deterministic, with the model judge on 2.3 only', () => {
        for (const s of scenarios) for (const t of s.turns) for (const e of t.expect) {
            if (e.kind === 'own_words') expect(e.line).toBe('2.3');
        }
        expect(scenarios.find((s) => s.id.startsWith('2.3-'))!.turns.some((t) => t.expect.some((e) => e.kind === 'own_words'))).toBe(true);
    });

    it('every media fixture exists', () => {
        for (const s of scenarios) for (const t of s.turns) if (t.kind === 'message') for (const m of t.media) {
            expect(fs.existsSync(path.join(FIXTURES_DIR, m.file)), m.file).toBe(true);
        }
    });

    it('files are named after their id', () => {
        for (const f of fs.readdirSync(SCENARIOS_DIR).filter((x) => x.endsWith('.json'))) {
            expect(JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf8')).id).toBe(f.replace(/\.json$/, ''));
        }
    });
});

describe('the scenario schema', () => {
    const ok = { id: 'x-1', title: 't', lines: ['2.1'], turns: [{ from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.1', kind: 'reply_sent' }] }] };

    it('fills the seed defaults: new customer, WhatsApp, window open', () => {
        const s = parseScenario(ok);
        expect(s.seed).toEqual({ customer: 'new', name: null, prefersText: false, alreadyRung: false, channels: ['whatsapp'], window: 'open', facts: [], ledger: [] });
    });
    it('a seed can state known or new, prefers text, already rung, window open or shut', () => {
        const s = seedSchema.parse({ customer: 'known', prefersText: true, alreadyRung: true, window: 'shut' });
        expect(s).toMatchObject({ customer: 'known', prefersText: true, alreadyRung: true, window: 'shut' });
    });
    it('refuses own_words off line 2.3, a non-customer first turn, and an expectation on a line the scenario does not claim', () => {
        expect(() => parseScenario({ ...ok, turns: [{ ...ok.turns[0], expect: [{ line: '2.1', kind: 'own_words' }] }] })).toThrow(/2\.3 only/);
        expect(() => parseScenario({ ...ok, turns: [{ from: 'system', kind: 'clock', expect: [] }] })).toThrow(/first turn/);
        expect(() => parseScenario({ ...ok, turns: [{ ...ok.turns[0], expect: [{ line: '2.7', kind: 'reply_sent' }] }] })).toThrow(/not in the scenario/);
    });
    it('refuses a bad regex', () => {
        expect(() => parseScenario({ ...ok, turns: [{ ...ok.turns[0], expect: [{ line: '2.1', kind: 'text_matches', pattern: '(' }] }] })).toThrow(/bad pattern/);
    });
});

describe('seedPlan (what the current door honours)', () => {
    it('window shut ages the thread after start; the rest are recorded as unsupported with a reason', () => {
        const p = seedPlan(seedSchema.parse({ customer: 'known', prefersText: true, alreadyRung: true, window: 'shut', facts: [{ key: 'job', value: 'tap', source: 'turn' }], ledger: [{ subject: 'media', state: 'asked' }] }));
        expect(p.afterStart).toEqual([{ op: 'age', hours: 25 }]);
        expect(p.honoured.window).toBeTruthy();
        expect(Object.keys(p.unsupported).sort()).toEqual(['alreadyRung', 'customer', 'facts', 'ledger', 'prefersText']);
    });
    it('a plain new customer with the window open needs nothing', () => {
        const p = seedPlan(seedSchema.parse({ name: 'Sam' }));
        expect(p.afterStart).toEqual([]);
        expect(p.unsupported).toEqual({});
    });
});

function fakePs(delivered: boolean): PlannedSend {
    return {
        caseId: 'c', party: { role: 'homeowner', address: '+447700900942', name: null }, channel: 'whatsapp', windowState: 'open', templateId: null,
        bubbles: delivered ? ['hi?'] : [], factIds: UNAVAILABLE, kbIds: UNAVAILABLE, guards: allGuardsUnavailable('t'), approver: null, runId: 'r', hold: null,
        delivered, origin: delivered ? 'desk' : 'none',
        evidence: { decision: delivered ? 'send' : 'pending', intent: null, lane: null, pack: null, stageAfter: null, exitNote: null, legacyGuardsHit: [], legacyGuardNotes: [], mirrorLiveWouldSend: null, error: null },
    };
}

function scenarioRun(id: string, run: number, status: 'pass' | 'fail' | 'error', line = '2.1'): ScenarioRunResult {
    return {
        scenarioId: id, title: id, lines: [line], run, seed: { requested: seedSchema.parse({}), plan: { honoured: {}, unsupported: {}, afterStart: [] }, unsupported: [] },
        turns: [{ index: 0, from: 'customer', kind: 'message', input: 'hi', plannedSend: fakePs(status === 'pass'), snapshot: null, durationMs: 1, error: status === 'error' ? 'door unreachable' : null,
            expectations: [{ line, kind: 'reply_sent', status, reason: status }] }],
        error: status === 'error' ? 'door unreachable' : null, errorKind: status === 'error' ? 'unreachable' : null, retriedAfter: null, startedAt: 'now', durationMs: 1,
    };
}

describe('lineResults (a line passes only when it passes both runs; error beats fail)', () => {
    const scen = [parseScenario({ id: '2.1-x', title: 't', lines: ['2.1'], turns: [{ from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.1', kind: 'reply_sent' }] }] })];
    const of = (a: 'pass' | 'fail' | 'error', b: 'pass' | 'fail' | 'error') => lineResults([scenarioRun('2.1-x', 1, a), scenarioRun('2.1-x', 2, b)], 2, scen).find((l) => l.line === '2.1')!;
    it('pass + pass = pass', () => expect(of('pass', 'pass').status).toBe('pass'));
    it('pass + fail = fail', () => expect(of('pass', 'fail').status).toBe('fail'));
    it('fail + error = error', () => expect(of('fail', 'error').status).toBe('error'));
    it('a Goal 1 line with no expectation evaluated is an error, never a pass', () => {
        const r = lineResults([scenarioRun('2.1-x', 1, 'pass'), scenarioRun('2.1-x', 2, 'pass')], 2, scen);
        expect(r.find((l) => l.line === '2.7')!.status).toBe('error');
        expect(r.find((l) => l.line === '2.7')!.perRun[0].reasons[0]).toMatch(/no expectation/);
    });
    it('carries the planned send and snapshot as evidence per line', () => {
        const r = of('pass', 'pass');
        expect(r.evidence).toHaveLength(2);
        expect(r.evidence[0].plannedSend?.delivered).toBe(true);
    });
});

describe('the markdown report', () => {
    it('names every line with its status and shows the bubbles and the model verdict', () => {
        const scen = [parseScenario({ id: '2.3-x', title: 't', lines: ['2.3'], turns: [{ from: 'customer', kind: 'message', text: 'hi', expect: [{ line: '2.3', kind: 'own_words' }] }] })];
        const sr = scenarioRun('2.3-x', 1, 'pass', '2.3');
        sr.turns[0].expectations[0] = { line: '2.3', kind: 'own_words', status: 'pass', reason: 'one question', modelJudge: { model: 'claude-haiku-4-5', promptHash: 'abc123def456', verdict: 'yes', reason: 'natural' } };
        sr.turns[0].snapshot = { conversationId: 'c', stage: 'scoping', tags: [], contactName: null, window: { canFreeform: true, summary: 'OPEN' }, messages: [], quote: null, openFlags: [], openPromises: [], lastCall: null };
        const lines = lineResults([sr], 1, scen);
        const md = renderMarkdown({ generatedAt: 'now', desk: 'd', door: { mode: 'http', baseUrl: 'u' }, runs: 1, lines, scenarios: [sr], summary: { pass: 1, fail: 0, error: 10 }, exitCode: 1 });
        expect(md).toContain('| 2.3 |');
        expect(md).toContain('> hi?');
        expect(md).toContain('model judge (beside, not instead): claude-haiku-4-5');
        expect(md).toContain('verdict **yes**');
        expect(md).toContain('Case-file snapshot');
    });
});

describe('the model judge', () => {
    it('hashes the prompt and parses a verdict', async () => {
        const p = buildOwnWordsPrompt({ customerText: 'hi', bubbles: ['Where are you?'] });
        expect(p.hash).toMatch(/^[a-f0-9]{64}$/);
        expect(buildOwnWordsPrompt({ customerText: 'hi', bubbles: ['Where are you?'] }).hash).toBe(p.hash);
        expect(parseVerdict('{"verdict":"yes","reason":"natural"}')).toEqual({ verdict: 'yes', reason: 'natural' });
        expect(parseVerdict('nonsense').verdict).toBe('no');
        const judge = makeModelJudge(async () => '{"verdict":"no","reason":"template"}');
        const v = await judge.ownWords({ customerText: 'hi', bubbles: ['Hi {{1}}'] });
        expect(v).toMatchObject({ model: 'claude-haiku-4-5', verdict: 'no', reason: 'template', promptHash: expect.any(String) });
    });
    it('a failing model call is skipped with the reason, not an error', async () => {
        const judge = makeModelJudge(async () => { throw new Error('boom'); });
        expect((await judge.ownWords({ customerText: 'hi', bubbles: ['x?'] })).verdict).toBe('skipped');
    });
});
