/**
 * The plan strip: the model names the steps, the proposals say where the changes stand, and a
 * refusal drops everything after it.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan, cleanSteps, planAfter, remainingAfter } from './plan';

const steps = cleanSteps([{ label: 'Find Marcus', done: true }, { label: 'Move to Tue 23', done: false }, 'Tell Marcus']);

describe('the plan strip', () => {
    it('is not shown for a one-step ask, and trims what the model gave', () => {
        expect(buildPlan({ steps: cleanSteps(['Answer Ben']) })).toBeUndefined();
        expect(cleanSteps([' ', { label: '  Find\n Marcus ' }, 7, 'x'.repeat(200)])).toEqual([{ label: 'Find Marcus', done: false }, { label: 'x'.repeat(80), done: false }]);
        expect(cleanSteps(Array.from({ length: 20 }, (_, i) => `s${i}`))).toHaveLength(12);
    });

    it('marks the first unfinished step current with its proposal, or refused with the rest dropped', () => {
        expect(buildPlan({ steps, proposal: { id: 'a1' } })).toEqual([
            { label: 'Find Marcus', state: 'done' },
            { label: 'Move to Tue 23', state: 'current', actionId: 'a1' },
            { label: 'Tell Marcus', state: 'waiting' },
        ]);
        expect(buildPlan({ steps, refusal: 'the slot is taken' })).toEqual([
            { label: 'Find Marcus', state: 'done' },
            { label: 'Move to Tue 23', state: 'refused', reason: 'the slot is taken' },
            { label: 'Tell Marcus', state: 'dropped' },
        ]);
        expect(buildPlan({ steps })).toEqual([{ label: 'Find Marcus', state: 'done' }, { label: 'Move to Tue 23', state: 'waiting' }, { label: 'Tell Marcus', state: 'waiting' }]);
        // Every step marked done while a change still waits: the change is the last step.
        expect(buildPlan({ steps: cleanSteps([{ label: 'a', done: true }, { label: 'b', done: true }]), proposal: { id: 'a2' } })?.[1]).toEqual({ label: 'b', state: 'current', actionId: 'a2' });
    });

    it('moves with its proposal', () => {
        const plan = buildPlan({ steps, proposal: { id: 'a1' } })!;
        const done = planAfter(plan, { id: 'a1', status: 'executed', result: {} });
        expect(done[1]).toEqual({ label: 'Move to Tue 23', state: 'done', actionId: 'a1' });
        expect(remainingAfter(done, 'a1')).toEqual([{ label: 'Tell Marcus', state: 'waiting' }]);
        expect(planAfter(plan, { id: 'a1', status: 'cancelled', result: { reason: 'cancelled by human:ben' } }).slice(1)).toEqual([
            { label: 'Move to Tue 23', state: 'refused', actionId: 'a1', reason: 'cancelled by human:ben' },
            { label: 'Tell Marcus', state: 'dropped' },
        ]);
        expect(planAfter(plan, { id: 'a1', status: 'expired', result: null })[1]).toMatchObject({ state: 'refused', reason: 'the change was expired' });
        expect(planAfter(plan, { id: 'other', status: 'executed', result: null })).toBe(plan);
        expect(remainingAfter(plan, 'other')).toEqual([]);
    });
});
