/**
 * The sales-call list over in-memory case files, the fixture style queue.test.ts uses: a file joins
 * it only while every customer turn on it is a call the classifier already marked `sales_spam`, it
 * leaves Needs you, and nothing about the verdict closes, holds or changes a file.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, closeFile, hold, open, recordFact, type CaseFile } from '../desk/case-file';
import type { ResolveResult } from '../desk/identity';
import { CALL_SUMMARY_KEY } from '../channels/call-adapter';
import { queueOf } from './queue';
import { boardOf } from './board';
import { SALES_CALL_KIND, isSalesCallFile, salesCallCandidate, salesCallIds, salesCallsOf } from './sales-calls';

let seq = 0;
const newId = (prefix: string) => `${prefix}_${++seq}`;
const at = (iso: string) => () => new Date(iso);

function resolved(name: string): Extract<ResolveResult, { ok: true }> {
    return {
        ok: true, personId: newId('person'), customerId: null, role: 'homeowner', isNew: true,
        canonical: `phone:+4477009${String(++seq).padStart(5, '0')}`, propertyId: null, landlordId: null, name,
    };
}

const TRANSCRIPT = '[call: they rang us and were answered, 2 min]\nCaller: Hi, I am calling from a web design agency, we can get your business to the top of Google. Agent: no thanks.';

function callFile(name: string, when: string, callId: string | null = newId('call')): CaseFile {
    const opened = open({
        identity: resolved(name),
        channel: 'call',
        address: '+447700900111',
        firstTurn: { at: when, channel: 'call', kind: 'call_transcript', body: TRANSCRIPT, media: [], ...(callId ? { callId } : {}) },
    }, { now: at(when), newId });
    if (!opened.ok) throw new Error(opened.reason);
    return opened.value;
}

const callIdsOf = (file: CaseFile) => file.turns.filter((t) => t.callId).map((t) => t.callId!);
const verdicts = (entries: Array<[string, string]>) => new Map(entries);
const marked = (...files: CaseFile[]) => verdicts(files.flatMap((f) => callIdsOf(f).map((id) => [id, SALES_CALL_KIND] as [string, string])));

const NOW = new Date('2026-09-18T11:00:00.000Z');

describe('which files are sales calls', () => {
    it('a file whose only call the classifier marked sales_spam is one; the same call marked anything else, or not at all, is not', () => {
        const file = callFile('Agency', '2026-09-18T09:00:00.000Z');
        const [id] = callIdsOf(file);
        expect(isSalesCallFile(file, verdicts([[id, 'sales_spam']]))).toBe(true);
        for (const kind of ['job_enquiry', 'existing_customer', 'supplier', 'complaint', 'wrong_number', 'other']) {
            expect(isSalesCallFile(file, verdicts([[id, kind]]))).toBe(false);
        }
        expect(isSalesCallFile(file, verdicts([]))).toBe(false);
    });

    it('a call turn naming no call row is never looked up, so never a sales call', () => {
        const file = callFile('Door call', '2026-09-18T09:00:00.000Z', null);
        expect(salesCallCandidate(file)).toBeNull();
    });

    it('every call on the file must be marked: one call with another verdict keeps the whole file off the list', () => {
        const file = callFile('Mixed', '2026-09-18T09:00:00.000Z');
        const second = appendTurn(file, { at: '2026-09-18T10:00:00.000Z', channel: 'call', direction: 'inbound', partyId: file.parties[0].personId, kind: 'call_transcript', body: TRANSCRIPT, media: [], callId: 'call_second', runId: null, approver: null }, { now: at('2026-09-18T10:00:00.000Z'), newId });
        if (!second.ok) throw new Error(second.reason);
        const [first] = callIdsOf(file);
        expect(isSalesCallFile(file, verdicts([[first, 'sales_spam'], ['call_second', 'sales_spam']]))).toBe(true);
        expect(isSalesCallFile(file, verdicts([[first, 'sales_spam'], ['call_second', 'job_enquiry']]))).toBe(false);
        expect(isSalesCallFile(file, verdicts([[first, 'sales_spam']]))).toBe(false);
    });

    it('a wrongly marked caller who then writes to us leaves the list at once: a text is not a call', () => {
        const file = callFile('Real customer', '2026-09-18T09:00:00.000Z');
        const kinds = marked(file);
        expect(isSalesCallFile(file, kinds)).toBe(true);
        const text = appendTurn(file, { at: '2026-09-18T09:30:00.000Z', channel: 'sms', direction: 'inbound', partyId: file.parties[0].personId, kind: 'text', body: 'Sorry, that was me about the leaking tap, can you come?', media: [], runId: null, approver: null }, { now: at('2026-09-18T09:30:00.000Z'), newId });
        if (!text.ok) throw new Error(text.reason);
        expect(isSalesCallFile(file, kinds)).toBe(false);
        expect(salesCallsOf([file], kinds).items).toEqual([]);
    });

    it('a file already closed is not listed', () => {
        const file = callFile('Closed', '2026-09-18T09:00:00.000Z');
        const kinds = marked(file);
        const closed = closeFile(file, 'done', { why: 'test' }, { now: at('2026-09-18T09:10:00.000Z') });
        if (!closed.ok) throw new Error(closed.reason);
        expect(salesCallsOf([file], kinds).items).toEqual([]);
    });
});

describe('salesCallsOf', () => {
    it('lists the sales calls newest call first, each with the call summary when there is one and the transcript opening otherwise', () => {
        const older = callFile('Older', '2026-09-17T09:00:00.000Z');
        const newer = callFile('Newer', '2026-09-18T09:00:00.000Z');
        const customer = callFile('Customer', '2026-09-18T10:00:00.000Z');
        recordFact(newer, { key: CALL_SUMMARY_KEY, value: 'Web design agency selling SEO', source: { kind: 'thread', turnId: newer.turns[0].id }, by: 'call_adapter' }, { now: at('2026-09-18T09:05:00.000Z'), newId });
        const kinds = verdicts([...marked(older, newer), [callIdsOf(customer)[0], 'job_enquiry']]);

        const { items } = salesCallsOf([older, customer, newer], kinds);
        expect(items.map((i) => i.customerName)).toEqual(['Newer', 'Older']);
        expect(items[0].calls).toEqual([{ at: '2026-09-18T09:00:00.000Z', summary: 'Web design agency selling SEO', excerpt: expect.stringContaining('web design agency') }]);
        expect(items[1].calls[0].summary).toBeNull();
        expect(items[1].calls[0].excerpt).not.toMatch(/^\[call/);
        // The list offers nothing to send: no draft, whatever the card is.
        expect(items.every((i) => !('draft' in i))).toBe(true);
    });

    it('reads the stored verdicts once for every candidate, and never for a file that cannot be one', async () => {
        const sales = callFile('Sales', '2026-09-18T09:00:00.000Z');
        const door = callFile('Door', '2026-09-18T09:00:00.000Z', null);
        const asked: string[][] = [];
        const ids = await salesCallIds([sales, door], async (callIds) => { asked.push(callIds); return marked(sales); });
        expect(asked).toEqual([callIdsOf(sales)]);
        expect(Array.from(ids)).toEqual([sales.id]);
        expect(await salesCallIds([door], async () => { throw new Error('not asked'); })).toEqual(new Set());
    });
});

describe('the verdict only suggests', () => {
    it('a held sales call leaves Needs you, and stays on the board in its stage column, open and held as it was', () => {
        const sales = callFile('Agency', '2026-09-18T09:00:00.000Z');
        const held = hold(sales, { approver: { kind: 'human', id: 'ben' }, reason: 'customer may have asked to stop on a call', draft: null }, { now: at('2026-09-18T09:01:00.000Z') });
        if (!held.ok) throw new Error(held.reason);
        const customer = callFile('Customer', '2026-09-18T09:00:00.000Z');
        const heldCustomer = hold(customer, { approver: { kind: 'human', id: 'ben' }, reason: 'money question', draft: null }, { now: at('2026-09-18T09:01:00.000Z') });
        if (!heldCustomer.ok) throw new Error(heldCustomer.reason);
        const before = JSON.stringify(sales);

        const exclude = new Set([sales.id]);
        expect(queueOf([sales, customer], { exclude }, {}, NOW).items.map((i) => i.id)).toEqual([customer.id]);
        expect(salesCallsOf([sales, customer], marked(sales)).items.map((i) => i.id)).toEqual([sales.id]);
        const board = boardOf([sales, customer]);
        expect(Object.values(board.columns).flat().map((c) => c.id).sort()).toEqual([sales.id, customer.id].sort());
        // Reading the list changed nothing on the file.
        expect(JSON.stringify(sales)).toBe(before);
        expect(sales.stage).not.toBe('done');
    });
});
