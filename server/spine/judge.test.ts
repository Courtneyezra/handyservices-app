import { describe, it, expect } from 'vitest';
import { parseVoiceVerdict, judgeSaysFine, judgeAgrees, judgeVoiceV1, buildVoiceJudgeSystem, buildVoiceJudgeUser } from './judge';

const good = { rubric: 'voice-v1', cannotJudge: false, dimensions: { register: 5, burstLength: 4, oneQuestion: 5, noSystemTells: 5, leverChoice: 4 }, overall: 4, notes: ['reads like him'], call: 'fine' };

describe('parseVoiceVerdict', () => {
    it('accepts a valid verdict and stamps the rubric', () => {
        const v = parseVoiceVerdict(good);
        expect(v.cannotJudge).toBe(false);
        expect(v.rubric).toBe('voice-v1');
        expect(v.overall).toBe(4);
    });
    it('null dimensions are allowed; out-of-range or missing fields become cannotJudge, never a throw', () => {
        expect(parseVoiceVerdict({ ...good, dimensions: { ...good.dimensions, leverChoice: null } }).cannotJudge).toBe(false);
        const bad = parseVoiceVerdict({ ...good, overall: 7 });
        expect(bad.cannotJudge).toBe(true);
        expect(bad.cannotJudgeReason).toMatch(/overall/);
        expect(parseVoiceVerdict('not json at all').cannotJudge).toBe(true);
        expect(parseVoiceVerdict({ ...good, call: 'brilliant' }).cannotJudge).toBe(true);
    });
});

describe('judgeSaysFine / judgeAgrees', () => {
    it('fine = overall ≥ 4 with no dimension ≤ 2', () => {
        expect(judgeSaysFine(parseVoiceVerdict(good))).toBe(true);
        expect(judgeSaysFine(parseVoiceVerdict({ ...good, dimensions: { ...good.dimensions, noSystemTells: 2 } }))).toBe(false);
        expect(judgeSaysFine(parseVoiceVerdict({ ...good, overall: 3 }))).toBe(false);
        expect(judgeSaysFine(parseVoiceVerdict({ ...good, overall: 7 }))).toBeNull();
    });
    it('agreement maps approve ⇔ fine, edit/reject ⇔ not fine, samples excluded', () => {
        const fine = parseVoiceVerdict(good);
        const notFine = parseVoiceVerdict({ ...good, overall: 2 });
        expect(judgeAgrees(fine, { verdict: 'approve', reason: 'fine' })).toBe(true);
        expect(judgeAgrees(notFine, { verdict: 'approve', reason: 'fine' })).toBe(false);
        expect(judgeAgrees(notFine, { verdict: 'reject', reason: 'tone' })).toBe(true);
        expect(judgeAgrees(fine, { verdict: 'edit', reason: 'tone' })).toBe(false);
        expect(judgeAgrees(fine, { verdict: 'sample_fine', reason: null })).toBeNull();
        expect(judgeAgrees(parseVoiceVerdict({ ...good, overall: 9 }), { verdict: 'approve', reason: 'fine' })).toBeNull();
    });
});

describe('judgeVoiceV1', () => {
    it('calls the injected llm with the rubric and parses the answer; attaches deterministic violations', async () => {
        const seen: any[] = [];
        const v = await judgeVoiceV1({ body: 'Got it — send a photo?', customerText: 'tap leaking', intent: 'ask_gap' }, {
            llm: async (args) => { seen.push(args); return { data: good, usage: null, model: 'claude-opus-5' }; },
            system: buildVoiceJudgeSystem('VOICE FILE'),
        });
        expect(seen[0].model).toBe('claude-opus-5');
        expect(seen[0].system).toContain('VOICE FILE');
        expect(seen[0].user).toBe(buildVoiceJudgeUser({ body: 'Got it — send a photo?', customerText: 'tap leaking', intent: 'ask_gap' }));
        expect(v.overall).toBe(4);
        expect(v.deterministic).toEqual(['em_dash']);
    });
    it('an llm failure or an empty body is cannotJudge, not a throw', async () => {
        const v = await judgeVoiceV1({ body: 'x' }, { llm: async () => { throw new Error('boom'); }, system: 's' });
        expect(v.cannotJudge).toBe(true);
        expect(v.cannotJudgeReason).toContain('boom');
        const e = await judgeVoiceV1({ body: '   ' }, { llm: async () => ({ data: good, usage: null, model: 'm' }), system: 's' });
        expect(e.cannotJudge).toBe(true);
    });
});
