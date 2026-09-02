/**
 * P8 vitest: the estimator belt refuses prices; history beats the model; the fold; a run with a
 * stubbed runner writes a row and never prices. No model, no db.
 */
import { describe, it, expect, vi } from 'vitest';
import { findPriceFields, findMoneyInText, historyRange, foldEstimateLines, keywordsFor, buildEstimatorBelt, runEstimateForIntake, HISTORY_MIN_SAMPLES, intakeLinesFromArtifact } from './estimator';
import type { CaseFile, TriageResult } from '../types';

vi.mock('../../agents/estimator-tools', () => ({
    buildEstimatorTools: () => {
        let build: any = null;
        return {
            tools: [
                { name: 'search_materials', description: 'x', input_schema: {}, run: async () => ({}) },
                { name: 'submit_build', description: 'submit', input_schema: {}, run: async (input: any) => { build = { ...input, estimatorVersion: 't', createdAt: 'now' }; return { accepted: true }; } },
            ],
            getBuild: () => build,
        };
    },
    getTimeHistory: async () => ({ estimates: [], avgMinutes: 0, confidence: 'low' }),
}));
vi.mock('../../agents/quote-estimator', () => ({ SYSTEM: 'system' }));
vi.mock('../run-record', () => ({ recordSpineRunStart: vi.fn(async () => undefined), recordSpineRunFinish: vi.fn(async () => undefined) }));

const GOOD = { lines: [{ lineIndex: 0, description: 'Replace tap', category: 'plumbing_minor', time: { minutes: 60, confidence: 'medium', basis: 'model', rangeMinutes: [45, 90] }, materials: [{ name: 'Tap', qty: 1, unitPricePence: 4000, supplier: 'screwfix' }], procedure: ['Isolate'], assumptions: [], flags: ['ladder'] }] };

describe('the belt never accepts a price', () => {
    it('finds price fields anywhere in the submission, but allows material unit costs', () => {
        expect(findPriceFields(GOOD)).toEqual([]);
        expect(findPriceFields({ lines: [{ ...GOOD.lines[0], pricePence: 12000 }] })).toEqual(['lines[0].pricePence']);
        expect(findPriceFields({ lines: [{ ...GOOD.lines[0], labourPence: 9000, suggestedPrice: 120 }], totalPence: 15000 })).toEqual(['lines[0].labourPence', 'lines[0].suggestedPrice', 'totalPence']);
        expect(findPriceFields({ lines: [{ ...GOOD.lines[0], materials: [{ name: 'Tap', qty: 1, unitPricePence: 4000, unitPriceIncVatPence: 4800, supplier: 'screwfix' }] }] })).toEqual([]);
    });
    it('finds money written into prose (but not inside a material entry)', () => {
        expect(findMoneyInText({ lines: [{ ...GOOD.lines[0], assumptions: ['should come to about £180'] }] })).toEqual(['lines[0].assumptions[0]']);
        expect(findMoneyInText({ lines: [{ ...GOOD.lines[0], materials: [{ name: 'Tap £40', qty: 1, unitPricePence: 4000, supplier: 'screwfix' }] }] })).toEqual([]);
        expect(findMoneyInText(GOOD)).toEqual([]);
    });
    it('submit_build refuses a priced submission with a readable message and accepts a clean one', async () => {
        const belt = buildEstimatorBelt('c1');
        const submit = belt.tools.find((t) => t.name === 'submit_build')!;
        await expect(submit.run({ lines: [{ ...GOOD.lines[0], pricePence: 12000 }] })).rejects.toThrow(/never outputs a price.*lines\[0\]\.pricePence/);
        expect(belt.getBuild()).toBeNull();
        await expect(submit.run(GOOD)).resolves.toEqual({ accepted: true });
        expect(belt.getBuild().lines[0].flags).toEqual(['ladder']);
        expect(submit.description).toMatch(/NEVER include a price/);
    });
});

describe('time: history first', () => {
    it('median + IQR from ≥ 3 samples; null below that', () => {
        expect(historyRange([30, 45, 60, 90, 120])).toEqual({ median: 60, q1: 45, q3: 90, n: 5 });
        expect(historyRange([30, 60])).toBeNull();
        expect(historyRange([0, -5, NaN, 40, 50, 60])).toEqual({ median: 50, q1: 45, q3: 55, n: 3 });
        expect(HISTORY_MIN_SAMPLES).toBe(3);
    });
    it('foldEstimateLines: history wins, model second, fallback when nothing measured', () => {
        const intake = [{ lineId: 'card_1', title: 'Replace tap' }, { lineId: 'card_2', title: 'Hang mirror' }, { lineId: 'card_3', title: 'Mystery' }];
        const build = { lines: [GOOD.lines[0], { lineIndex: 1, category: 'general_fixing', time: { minutes: 30, confidence: 'high' }, materials: [] }] };
        const lines = foldEstimateLines(intake, build, [{ median: 55, q1: 45, q3: 70, n: 7 }, null, null]);
        expect(lines[0]).toMatchObject({ timeSource: 'history', minutesPoint: 55, minutesLow: 45, minutesHigh: 70, confidence: 'high', category: 'plumbing_minor', flags: ['ladder'] });
        expect(lines[0].materials[0]).toMatchObject({ name: 'Tap', unitCostPence: 4000, source: 'screwfix' });
        expect(lines[1]).toMatchObject({ timeSource: 'model', minutesPoint: 30, minutesLow: 24, minutesHigh: 39, confidence: 'high' });
        expect(lines[2]).toMatchObject({ timeSource: 'fallback', minutesPoint: 0, confidence: 'low' });
        expect(lines[2].reasoning).toMatch(/returned no line/);
    });
    it('keywordsFor drops stop words', () => {
        expect(keywordsFor('Replace the kitchen mixer tap', 'leaking at the base')).toEqual(['kitchen', 'mixer', 'tap', 'leaking', 'base']);
    });
    it('intakeLinesFromArtifact reads the clerk artifact', () => {
        expect(intakeLinesFromArtifact({ data: { lines: [{ title: 'A', detail: 'd', category: 'painting' }, { title: '' }] } })).toEqual([{ lineId: 'card_1', title: 'A', detail: 'd', category: 'painting', assumptions: [] }]);
        expect(intakeLinesFromArtifact(null)).toEqual([]);
    });
});

describe('runEstimateForIntake', () => {
    const cf = (): CaseFile => ({ conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Sam', timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' }, client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: '2026-09-04T09:00:00.000Z' });
    const tri = (): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'quote_clerk', exceptions: [], stage: 'scoping', tags: [], reasons: [], source: 'rules' });
    it('writes running → complete with the folded lines, job allowance and cost; the runner gets the belt', async () => {
        const rows: any[] = []; const finishes: any[] = [];
        const store = { insert: vi.fn(async (r: any) => { rows.push(r); return 'est_1'; }), finish: vi.fn(async (id: string, p: any) => { finishes.push([id, p]); }) };
        const runAgent = vi.fn(async (opts: any) => {
            const submit = opts.tools.find((t: any) => t.name === 'submit_build');
            await submit.run(GOOD);
            return { finalText: 'done', turns: 3, costPence: 7, model: 'claude-sonnet-5' };
        });
        const est = await runEstimateForIntake({ caseFile: cf(), pack: { id: 'customer.default', version: 1 }, triage: tri(), runId: 'run_e', intakeRunId: 'run_c', intakeLines: [{ lineId: 'card_1', title: 'Replace tap', category: 'plumbing_minor' }] }, { store, runAgent, history: async () => [50, 60, 70, 80] });
        expect(rows[0]).toMatchObject({ conversationId: 'c1', intakeRunId: 'run_c', status: 'running' });
        expect(finishes[0][0]).toBe('est_1');
        expect(finishes[0][1]).toMatchObject({ status: 'complete', costPence: 7 });
        expect(est.lines[0]).toMatchObject({ timeSource: 'history', minutesPoint: 65 });
        expect(est.job).toEqual({ setupMinutes: 15, cleanupMinutes: 15, accessNotes: ['ladder'] });
        expect(findPriceFields(est)).toEqual([]); // no price anywhere (material unit cost and the model cost are not prices)
        expect(runAgent.mock.calls[0][0]).toMatchObject({ name: 'estimator', parentRunId: 'run_e', conversationId: 'c1' });
        expect(runAgent.mock.calls[0][0].goal).toMatch(/Never a price/);
    });
    it('a runner failure marks the row failed and rethrows', async () => {
        const store = { insert: vi.fn(async () => 'est_2'), finish: vi.fn(async () => undefined) };
        await expect(runEstimateForIntake({ caseFile: cf(), pack: { id: 'customer.default', version: 1 }, triage: tri(), runId: 'r', intakeRunId: 'c', intakeLines: [{ lineId: 'card_1', title: 'x' }] }, { store, runAgent: async () => { throw new Error('model down'); }, history: async () => [] })).rejects.toThrow('model down');
        expect(store.finish).toHaveBeenCalledWith('est_2', { status: 'failed', error: 'model down' });
    });
});
