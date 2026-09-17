/**
 * Handy Desk T1 - the queue read over in-memory case files built with Contract 2's own calls, the
 * same fixture style board.test.ts uses: only held files, the held draft carried through, and the
 * order is the office working-hours wait, so a hold raised at the weekend waits behind a weekday one.
 * The quotes waiting to be priced are a second group below every hold, oldest draft first.
 */
import { describe, expect, it } from 'vitest';
import { queueOf, withReadyToPrice } from './queue';
import type { PriceQueueItem } from '../../spine/price-queue';
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

function priceItem(slug: string, name: string, createdAt: string | null): PriceQueueItem {
    return {
        slug, quoteId: `q_${slug}`, firstName: name, name, postcode: 'NG1', customerType: 'homeowner', job: 'guttering',
        lineCount: 2, createdAt, waitingMs: createdAt ? NOW.getTime() - Date.parse(createdAt) : 0, sourceChannel: null,
        signals: { checkThis: 1, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: null },
    };
}
const prices = (...items: PriceQueueItem[]) => ({ count: items.length, items, oldestWaitingMs: null, at: NOW.toISOString() });

describe('withReadyToPrice', () => {
    it('keeps the holds at the top in their own order and appends the quotes in the price queue\'s order', () => {
        const heldOld = heldFile('HeldOld', '2026-09-11T09:00:00.000Z');   // Fri 10:00 -> 7h
        const heldNew = heldFile('HeldNew', '2026-09-11T14:00:00.000Z');   // Fri 15:00 -> 2h
        const held = queueOf([heldNew, heldOld], {}, {}, NOW);
        // As buildPriceQueue emits them: oldest draft first, a row with no created_at last.
        const merged = withReadyToPrice(held, prices(
            priceItem('weekend', 'Wes', '2026-09-06T10:00:00.000Z'),
            priceItem('sam', 'Sam', '2026-09-11T11:00:00.000Z'),
            priceItem('undated', 'Una', null),
        ));
        // Every hold first, in the order queueOf put them; the quotes follow, untouched.
        expect(merged.items.map((i) => i.id)).toEqual([heldOld.id, heldNew.id, 'price:weekend', 'price:sam', 'price:undated']);
        expect(merged.items.map((i) => i.kind)).toEqual(['held', 'held', 'ready_to_price', 'ready_to_price', 'ready_to_price']);
        expect(merged.items.filter((i) => i.kind === 'held').map((i) => i.id)).toEqual(held.items.map((i) => i.id));
        expect(merged.handledToday).toBe(held.handledToday);
        expect(merged.items[3]).toEqual({
            kind: 'ready_to_price', id: 'price:sam', slug: 'sam', quoteId: 'q_sam', customerName: 'Sam', job: 'guttering', postcode: 'NG1',
            createdAt: '2026-09-11T11:00:00.000Z', waitingMs: 5 * 3600_000, pricePath: '/admin/price/sam',
            signals: { checkThis: 1, unpriced: 0, contradictions: 0, lowConfidence: 0, estimateStatus: null },
        });
    });

    it('never lets a long-abandoned draft outrank a hold raised minutes ago', () => {
        const fresh = heldFile('Fresh', '2026-09-11T15:50:00.000Z');
        const merged = withReadyToPrice(queueOf([fresh], {}, {}, NOW), prices(
            priceItem('ancient', 'Anna', '2026-03-01T09:00:00.000Z'),
            priceItem('old', 'Otto', '2026-08-20T09:00:00.000Z'),
        ));
        expect(merged.items.map((i) => i.id)).toEqual([fresh.id, 'price:ancient', 'price:old']);
    });

    it('does not re-rank the quotes: they keep the order the price queue handed over', () => {
        // The producer owns "oldest first" (buildPriceQueue). Whatever order it gives, the desk keeps,
        // so the two can never quietly disagree about the rule.
        const merged = withReadyToPrice(queueOf([], {}, {}, NOW), prices(
            priceItem('second', 'Sid', '2026-09-10T09:00:00.000Z'),
            priceItem('first', 'Fay', '2026-09-01T09:00:00.000Z'),
        ));
        expect(merged.items.map((i) => i.id)).toEqual(['price:second', 'price:first']);
    });

    it('carries the true wall-clock wait, so two drafts past the office clock\'s fortnight cap still differ', () => {
        const merged = withReadyToPrice(queueOf([], {}, {}, NOW), prices(
            priceItem('sixmonths', 'Sam', '2026-03-13T16:00:00.000Z'),
            priceItem('twentydays', 'Tom', '2026-08-22T16:00:00.000Z'),
        ));
        const waits = merged.items.map((i) => (i as { waitingMs: number }).waitingMs);
        expect(waits[0]).toBeGreaterThan(waits[1]);
        expect(waits[1]).toBe(20 * 24 * 3600_000);
        expect(merged.items.some((i) => 'waitingWorkingHours' in i)).toBe(false);
    });

    it('gives held items the held kind', () => {
        expect(queueOf([heldFile('Held', '2026-09-11T09:00:00.000Z')], {}, {}, NOW).items[0].kind).toBe('held');
    });
});
