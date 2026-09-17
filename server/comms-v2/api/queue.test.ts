/**
 * Handy Desk T1 - the queue read over in-memory case files built with Contract 2's own calls, the
 * same fixture style board.test.ts uses: only held files, the held draft carried through, and the
 * order is the office working-hours wait, so a hold raised at the weekend waits behind a weekday one.
 * The quotes waiting to be priced are not on this endpoint: the page merges them in
 * (client/src/lib/handy-desk-queue.ts), so they are tested there.
 */
import { describe, expect, it } from 'vitest';
import { queueOf } from './queue';
import { appendTurn, hold, open, type CaseFile } from '../desk/case-file';
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
        expect(queueOf([], {}, {}, NOW)).toEqual({ items: [], handledToday: 0 });
    });

    it('counts the turns handled since London midnight, one per outbound run, by the desk or a person, held or not', () => {
        function reply(file: CaseFile, when: string, runId: string, approver: string) {
            const done = appendTurn(file, { at: when, channel: 'whatsapp', direction: 'outbound', partyId: file.turns[0].partyId, kind: 'text', body: 'Reply', media: [], runId, approver });
            if (!done.ok) throw new Error(done.reason);
        }
        const answered = openFile('Answered', '2026-09-10T20:00:00.000Z');
        reply(answered, '2026-09-10T22:30:00.000Z', 'run_yesterday', 'agent.comms_v2'); // Thu 23:30 BST
        reply(answered, '2026-09-10T23:30:00.000Z', 'run_desk', 'agent.comms_v2');      // Fri 00:30 BST
        reply(answered, '2026-09-10T23:30:05.000Z', 'run_desk', 'agent.comms_v2');      // second bubble, same run
        reply(answered, '2026-09-11T09:00:00.000Z', 'run_ben', 'human:ben@example.com');
        const held = heldFile('Held', '2026-09-11T08:00:00.000Z');
        reply(held, '2026-09-11T08:30:00.000Z', 'run_held', 'agent.comms_v2');

        const queue = queueOf([answered, held], {}, {}, NOW);
        expect(queue.handledToday).toBe(3);
        expect(queue.items.map((i) => i.customerName)).toEqual(['Held']);
        expect(queueOf([answered, held], { mode: 'live' }, {}, NOW).handledToday).toBe(0);
    });
});

describe('queueOf hold exception', () => {
    it('carries the router exception that raised the hold, and null when a hold names none', () => {
        const money = openFile('Money', '2026-09-11T10:00:00.000Z');
        const raised = hold(money, { approver: { kind: 'human', id: 'ben' }, reason: 'money', exception: 'money', draft: 'Hi' }, { now: at('2026-09-11T10:00:00.000Z') });
        if (!raised.ok) throw new Error(raised.reason);
        const plain = heldFile('Plain', '2026-09-11T11:00:00.000Z');

        const { items } = queueOf([money, plain], {}, {}, NOW);
        expect(items.map((i) => [i.customerName, i.holdException, i.hasDraft])).toEqual([['Money', 'money', true], ['Plain', null, false]]);
    });
});

describe('the queue carries holds only', () => {
    it('gives held items the held kind and nothing else', () => {
        const { items } = queueOf([heldFile('Held', '2026-09-11T09:00:00.000Z')], {}, {}, NOW);
        expect(items.map((i) => i.kind)).toEqual(['held']);
    });
});
