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
    });

    it('keeps every step of a long plan and chains past the twelfth (answer A5)', () => {
        const long = cleanSteps(Array.from({ length: 20 }, (_, i) => ({ label: `s${i + 1}`, done: i < 12 })));
        expect(long).toHaveLength(20);
        const plan = buildPlan({ steps: long, proposal: { id: 'a13' } })!;
        expect(plan).toHaveLength(20);
        expect(plan[12]).toEqual({ label: 's13', state: 'current', actionId: 'a13' });
        const after = planAfter(plan, { id: 'a13', status: 'executed', result: {} });
        expect(remainingAfter(after, 'a13').map((s) => s.label)).toEqual(['s14', 's15', 's16', 's17', 's18', 's19', 's20']);
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
