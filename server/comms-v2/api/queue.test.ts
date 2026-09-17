/**
 * Handy Desk T1 - the queue read over in-memory case files built with Contract 2's own calls, the
 * same fixture style board.test.ts uses: only held files, the held draft carried through, and the
 * order is the office working-hours wait, so a hold raised at the weekend waits behind a weekday one.
 */
import { describe, expect, it } from 'vitest';
import { queueOf } from './queue';
import { hold, open, type CaseFile } from '../desk/case-file';
import type { ResolveResult } from '../desk/identity';

let seq = 0;
const newId = (prefix: string) => `${prefix}_${++seq}`;
const at = (iso: string) => () => new Date(iso);

function resolved(name: string): Extract<ResolveResult, { ok: true }> {
    return {
        ok: true, personId: newId('person'), customerId: null, role: 'homeowner', isNew: true,
        canonical: `phone:0770090${String(++seq).padStart(4, '0')}`, propertyId: null, landlordId: null, name,
    };
}

function openFile(name: string, when: string): CaseFile {
    const opened = open({
        identity: resolved(name),
        channel: 'whatsapp',
        address: '+447700900942',
        firstTurn: { at: when, channel: 'whatsapp', kind: 'text', body: `Hi, it's ${name}`, media: [] },
    }, { now: at(when), newId });
    if (!opened.ok) throw new Error(opened.reason);
    return opened.value;
}

function heldFile(name: string, since: string, draft: string | null = null): CaseFile {
    const file = openFile(name, since);
    const held = hold(file, { approver: { kind: 'human', id: 'ben' }, reason: `${name}'s reason`, draft }, { now: at(since) });
    if (!held.ok) throw new Error(held.reason);
    return file;
}

// Friday 11 September 2026, 17:00 in London (BST).
const NOW = new Date('2026-09-11T16:00:00.000Z');

describe('queueOf', () => {
    it('lists only held files, longest office working-hours wait first', () => {
        const recent = heldFile('Recent', '2026-09-11T14:00:00.000Z');   // Fri 15:00 -> 2h
        const oldest = heldFile('Oldest', '2026-09-10T15:00:00.000Z');   // Thu 16:00 -> 2h Thu + 9h Fri = 11h
        const morning = heldFile('Morning', '2026-09-11T10:00:00.000Z'); // Fri 11:00 -> 6h
        const unheld = openFile('Unheld', '2026-09-09T09:00:00.000Z');

        const { items } = queueOf([recent, unheld, oldest, morning], {}, {}, NOW);
        expect(items.map((i) => i.customerName)).toEqual(['Oldest', 'Morning', 'Recent']);
        expect(items.map((i) => i.waitingWorkingHours)).toEqual([11, 6, 2]);
        expect(items.every((i) => i.held)).toBe(true);
    });

    it('a hold raised out of office hours has waited no working time, and equal waits keep the older hold first', () => {
        const monday = new Date('2026-09-14T06:00:00.000Z'); // Mon 07:00, before opening
        const sunday = heldFile('Sunday', '2026-09-13T10:00:00.000Z');
        const saturday = heldFile('Saturday', '2026-09-12T10:00:00.000Z');

        const { items } = queueOf([sunday, saturday], {}, {}, monday);
        expect(items.map((i) => [i.customerName, i.waitingWorkingHours])).toEqual([['Saturday', 0], ['Sunday', 0]]);
    });

    it('carries the held draft, the hold reason and the approver, and whether that slot is assigned', () => {
        const withDraft = heldFile('Rob', '2026-09-11T10:00:00.000Z', 'Hi Rob, Tuesday morning works.');
        const without = heldFile('Gemma', '2026-09-11T11:00:00.000Z');

        const { items } = queueOf([withDraft, without], {}, { ben: ['user_ben'] }, NOW);
        expect(items[0]).toMatchObject({ customerName: 'Rob', draft: 'Hi Rob, Tuesday morning works.', holdReason: "Rob's reason", holdApprover: 'ben', holdApproverAssigned: true, holdSince: '2026-09-11T10:00:00.000Z' });
        expect(items[1]).toMatchObject({ customerName: 'Gemma', draft: null });
    });

    it('filters by mode: a file with no live send is sandbox', () => {
        const file = heldFile('Sandboxed', '2026-09-11T10:00:00.000Z');
        expect(queueOf([file], { mode: 'live' }, {}, NOW).items).toEqual([]);
        expect(queueOf([file], { mode: 'sandbox' }, {}, NOW).items).toHaveLength(1);
    });

    it('an empty desk is an empty queue', () => {
        expect(queueOf([], {}, {}, NOW)).toEqual({ items: [] });
    });
});
