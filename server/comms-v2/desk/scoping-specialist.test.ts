/**
 * The Scoping specialist's reading of the model's output. A label of what is still unknown about the
 * job that runs long is shortened, never a reason the structured output fails and the pass loses the
 * turn's facts with it (the live desk, 15 September 2026, 20:04).
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from './case-file';
import { FakeModelClient } from './models';
import { JOB_UNKNOWN_MAX_CHARS, JOB_UNKNOWNS_MAX, clampJobUnknowns, scope, specialistOutputSchema } from './scoping-specialist';

function fixture(text: string): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

const LONG = 'which of the internal doors are sticking and which need new hinges';

describe('jobUnknowns', () => {
    it('clamps the labels: cut back at a word boundary, empty and repeated ones dropped, four at most', () => {
        expect(clampJobUnknowns(['which of the three bedroom doors needs rehanging first', '  ', 'tap type', 'tap type', 'panel size', 'wall or ceiling', 'how many']))
            .toEqual(['which of the three bedroom doors needs', 'tap type', 'panel size', 'wall or ceiling']);
        expect(clampJobUnknowns(['x'.repeat(60)])).toEqual(['x'.repeat(JOB_UNKNOWN_MAX_CHARS)]);
        for (const label of clampJobUnknowns([LONG])) expect(label.length).toBeLessThanOrEqual(JOB_UNKNOWN_MAX_CHARS);
    });

    it('the output schema takes a label over the limit, and more labels than the proposal carries', () => {
        const out = { facts: [], jobUnknowns: [LONG, 'a', 'b', 'c', 'd'], answeredSubjects: [] };
        expect(specialistOutputSchema.safeParse(out).success).toBe(true);
    });

    it('an over-long label no longer fails the pass: the facts land and the question carries the label shortened', async () => {
        const file = fixture('Hi, a few of the doors in the house need looking at');
        const client = new FakeModelClient({
            specialist: () => ({ facts: [{ key: 'job_type', value: 'sticking internal doors' }], jobUnknowns: [LONG, 'how many', 'a', 'b', 'c'], answeredSubjects: ['job'] }),
        });
        const ret = await scope(file, file.turns[0], file.parties[0], client);
        expect(ret.error).toBeNull();
        expect(file.job.type).toBe('sticking internal doors');
        expect(ret.factIds).toHaveLength(1);
        expect(ret.proposal.nextQuestion).toEqual({ subject: 'job', unknowns: ['which of the internal doors are sticking', 'how many', 'a', 'b'] });
        expect(ret.proposal.nextQuestion!.unknowns).toHaveLength(JOB_UNKNOWNS_MAX);
    });
});
