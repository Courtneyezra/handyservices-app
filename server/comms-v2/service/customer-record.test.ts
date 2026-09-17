/**
 * The read-only full customer record (captain's answer of 17 Sep): identity recognises a customer
 * the CRM already holds; Service reads their leads, quotes, jobs with visit days and invoices, and
 * answers an invoice or receipt question from the invoice row as facts with a customer-record
 * source; a money question on a known customer's invoice is Service's to answer or hold, never a
 * guess; the stored email, address and postcode never reach the model; the figure and date guards
 * accept a record value only as this run read it; the database reader refuses anything but the
 * branch.
 */
import { describe, expect, it } from 'vitest';
import { open, recordFact, type CaseFile } from '../desk/case-file';
import { Desk, type DeskDeps } from '../desk/desk';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { Gateway } from '../desk/gateway';
import { identityFromCaseFiles } from '../desk/database-store';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { ChannelGateway } from '../channels/channel-gateway';
import { fromDoorSms } from '../channels/sms-adapter';
import { fromWebForm } from '../channels/form-adapter';
import { fromDoorEmail } from '../channels/email-adapter';
import { runGuards } from '../desk/guards';
import { Identity } from '../desk/identity';
import { FakeModelClient } from '../desk/models';
import { route as routeTurn } from '../desk/router';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import type { InboundTurn } from '../desk/whatsapp-adapter';
import { asksAboutInvoice, databaseCustomerRecords, invoiceLinesOf, invoiceMoneyQuestion, MemoryCustomerRecords, recordItems, type CustomerRecord, type RecordInvoice } from './customer-record';
import { ASKED_LABEL_MAX, askedLabel, serve } from './service-specialist';

const PHONE = 'phone:07700900942' as const;
const invoice = (over: Partial<RecordInvoice> = {}): RecordInvoice => ({
    id: 'inv-row-1', number: 'INV-2026-014', status: 'sent', totalPence: 12000, depositPaidPence: 4000, balanceDuePence: 8000,
    lines: [{ description: 'Hang two internal doors', totalPence: 12000 }],
    sentAt: '2026-09-08T09:00:00.000Z', dueAt: '2026-09-25T00:00:00.000Z', paidAt: null, ...over,
});
const baseRecord = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({ customerId: 'client-1', name: 'Sam Returning', leads: [], quotes: [], jobs: [], invoices: [], ...over });

function records(record: Partial<CustomerRecord> = {}): MemoryCustomerRecords {
    const r = new MemoryCustomerRecords();
    r.add({ customerId: 'client-1', name: 'Sam Returning', keys: [PHONE] }, { leads: [], quotes: [], jobs: [], invoices: [invoice()], ...record });
    return r;
}

function knownFile(text: string, customerId: string | null = 'client-1'): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId, role: 'homeowner', isNew: false, canonical: PHONE, propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [], ...(customerId ? { customerId } : {}) },
    });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

const quietDesk: DeskLike = {
    async handleTurn(file) { return { runId: 'run_x', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 } as DeskResult; },
    async clockPass(file) { return this.handleTurn(file, file.turns[0]); },
};
const serviceOut = (over: Record<string, unknown> = {}) => ({ answers: [], changeOfDetails: null, holdReason: null, ...over });
const now = () => new Date('2026-09-11T10:00:00.000Z');

describe('the customer record as items', () => {
    it('an invoice carries its own status, figures to the penny, dates and lines; nothing is added up', () => {
        const [item] = recordItems(baseRecord({ invoices: [invoice()] }), '2026-09-11');
        expect(item.ref).toBe('invoice:INV-2026-014');
        expect(item.facts.map((f) => [f.attr, f.value])).toEqual([
            ['status', 'sent, not yet paid'], ['total', '£120.00'], ['deposit_paid', '£40.00'], ['balance_due', '£80.00'],
            ['sent_on', '8 September 2026'], ['due_on', '25 September 2026'], ['line_1', '£120.00'],
        ]);
    });
    it('a paid invoice says paid and when, and no balance or due date is read back beside it', () => {
        const [item] = recordItems(baseRecord({ invoices: [invoice({ status: 'paid', paidAt: '2026-09-10T15:00:00.000Z', balanceDuePence: 8000 })] }), '2026-09-11');
        const attrs = item.facts.map((f) => f.attr);
        expect(attrs).toContain('paid_on');
        expect(attrs).not.toContain('balance_due');
        expect(attrs).not.toContain('due_on');
        expect(item.facts.find((f) => f.attr === 'paid_on')?.value).toBe('10 September 2026');
    });
    it('a draft or void invoice and a draft quote are never read, and a quote carries no figure', () => {
        const items = recordItems(baseRecord({
            invoices: [invoice({ number: 'D1', status: 'draft' }), invoice({ number: 'V1', status: 'void' })],
            quotes: [{ id: 'q1', slug: 'abc123', status: 'draft', summary: 'shelves', createdAt: null }, { id: 'q2', slug: 'def456', status: 'expired', summary: 'a door', createdAt: '2026-08-01T00:00:00.000Z' }],
        }), '2026-09-11');
        expect(items.map((i) => i.ref)).toEqual(['quote:def456']);
        expect(items[0].facts.map((f) => f.value).join(' ')).not.toMatch(/£/);
    });
    it('a job carries its visit days; a cancelled one carries none', () => {
        const items = recordItems(baseRecord({ jobs: [
            { id: 'b1', quoteRef: 'q2', status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'scheduled', scheduledDays: ['2026-09-22', '2026-09-23'], completedAt: null, summary: 'fit a door' },
            { id: 'b2', quoteRef: null, status: 'cancelled', assignmentStatus: 'assigned', dayOfStatus: null, scheduledDays: ['2026-09-30'], completedAt: null, summary: 'shelves' },
        ] }), '2026-09-11');
        expect(items[0].facts).toContainEqual({ attr: 'visit', label: 'visit days', value: '22 September 2026, 23 September 2026' });
        expect(items[1].facts.map((f) => f.attr)).toEqual(['status']);
        expect(items[1].facts[0].value).toBe('cancelled');
    });
    it('a booking no contractor has taken on carries no visit day, as the diary never confirms one; a visit done still carries its day', () => {
        const items = recordItems(baseRecord({ jobs: [
            { id: 'b3', quoteRef: null, status: 'pending', assignmentStatus: 'unassigned', dayOfStatus: 'scheduled', scheduledDays: ['2026-09-15'], completedAt: null, summary: 'a gate' },
            { id: 'b4', quoteRef: null, status: 'completed', assignmentStatus: 'completed', dayOfStatus: 'completed', scheduledDays: ['2026-09-01'], completedAt: '2026-09-01T16:00:00.000Z', summary: 'a tap' },
        ] }), '2026-09-11');
        expect(items[0].facts.map((f) => f.attr)).toEqual(['status']);
        expect(items[0].facts[0].value).toBe('booked, waiting for a tradesperson to take it on');
        expect(items[1].facts).toContainEqual({ attr: 'visit', label: 'visit day', value: '1 September 2026' });
    });
    it('a stored invoice line that is a property header (it names the address) is never read', () => {
        expect(invoiceLinesOf([
            { description: '--- 12 Sandbox Road, Nottingham NG9 1AB ---', total: 0, isPropertyHeader: true, propertyAddress: '12 Sandbox Road' },
            { description: 'Fit a door', total: 9000 },
            { description: 'no total' },
        ])).toEqual([{ description: 'Fit a door', totalPence: 9000 }]);
    });
});

describe('the invoice question', () => {
    it('matches an invoice, receipt or payment question and refuses one an invoice cannot settle', () => {
        expect(asksAboutInvoice('Can I get a receipt for last week?')).toBe(true);
        expect(asksAboutInvoice('Can you fix my tap?')).toBe(false);
        expect(invoiceMoneyQuestion('How much is left to pay on my invoice?')).toBe(true);
        expect(invoiceMoneyQuestion('Did you get my deposit payment?')).toBe(true);
        expect(invoiceMoneyQuestion('Can I get a discount on my invoice?')).toBe(false);
        expect(invoiceMoneyQuestion('I think my invoice is wrong')).toBe(false);
        expect(invoiceMoneyQuestion('How much was the quote? I paid the deposit')).toBe(false);
        expect(invoiceMoneyQuestion('How much for a new shelf?')).toBe(false);
        // An invoice question that also asks a new price stays Ben's: answering the invoice half must not clear the hold on the rest.
        expect(invoiceMoneyQuestion('how much do I still owe on my invoice, and how much would it cost to paint the fence too?')).toBe(false);
        expect(invoiceMoneyQuestion('what do I owe on the invoice and what is your price for a gate')).toBe(false);
        expect(invoiceMoneyQuestion('how much do I still owe on my invoice?')).toBe(true);
    });
    it('keeps a haggle, terms of payment or an offered figure on an invoice with Ben', () => {
        expect(invoiceMoneyQuestion('Will you take £60 cash for the invoice balance?')).toBe(false);
        expect(invoiceMoneyQuestion("That's a bit steep for my invoice")).toBe(false);
        expect(invoiceMoneyQuestion("can I pay it in parts, it's for my invoice")).toBe(false);
        expect(invoiceMoneyQuestion('could I pay monthly for the outstanding balance?')).toBe(false);
        expect(invoiceMoneyQuestion('I can do 50 quid towards the invoice')).toBe(false);
    });
});

describe('identity recognises a customer the CRM holds', () => {
    it('binds a fresh key to the one client it names, with the client\'s name when the turn gave none', async () => {
        const recs = records();
        const identity = new Identity({ known: (k) => recs.knownCustomer(k) });
        const r = await identity.resolveKnown('whatsapp', '+447700900942');
        expect(r).toMatchObject({ ok: true, customerId: 'client-1', name: 'Sam Returning', isNew: false });
        // Bound once: the next turn is not looked up again, and resolves synchronously.
        const again = identity.resolveKnown('whatsapp', '+447700900942');
        expect(again).not.toBeInstanceOf(Promise);
        expect(again).toMatchObject({ ok: true, customerId: 'client-1' });
        expect(recs.reads).toEqual([`known ${PHONE}`]);
    });
    it('binds nobody when two clients carry the key, or none does, and a key the turn only asserts is never looked up', async () => {
        const recs = new MemoryCustomerRecords();
        recs.add({ customerId: 'client-a', name: 'A', keys: [PHONE] });
        recs.add({ customerId: 'client-b', name: 'B', keys: [PHONE] });
        recs.add({ customerId: 'client-c', name: 'C', keys: ['email:someone@example.invalid'] });
        const logs: string[] = [];
        const identity = new Identity({ known: (k) => recs.knownCustomer(k), log: (l) => logs.push(l) });
        expect(await identity.resolveKnown('whatsapp', '+447700900942')).toMatchObject({ ok: true, customerId: null, isNew: true });
        expect(logs.join('\n')).toMatch(/2 customer records carry this phone; none is bound/);
        expect(await identity.resolveKnown('sms', '+447700900111', { email: 'someone@example.invalid' })).toMatchObject({ ok: true, customerId: null });
        expect(recs.reads).not.toContain('known email:someone@example.invalid');
    });
    it('a lookup that fails leaves the person a new customer and says so in the log', async () => {
        const logs: string[] = [];
        const identity = new Identity({ known: async () => { throw new Error('database down'); }, log: (l) => logs.push(l) });
        expect(await identity.resolveKnown('whatsapp', '+447700900942')).toMatchObject({ ok: true, customerId: null });
        expect(logs.join('\n')).toMatch(/could not be read.*database down/);
    });
    it('answer 126: the F3 example, a web form typed with a real customer\'s phone and the visitor\'s own email, never binds, and neither does a later email from that address', async () => {
        const recs = records();
        const g = new ChannelGateway({ desk: quietDesk, identity: new Identity({ known: (k) => recs.knownCustomer(k) }), now: () => new Date('2026-09-11T10:00:00.000Z') });
        const form = await fromWebForm({ customerName: 'Visitor', phone: '07700 900942', email: 'visitor@example.invalid', jobDescription: 'what do I owe on my invoice?', postcode: null, source: 'web_quote' }, { now: () => new Date('2026-09-11T09:59:00.000Z') });
        const a = await g.inbound(form, { whatsapp: false });
        if (a.kind !== 'handled') throw new Error(a.kind);
        expect(a.turn.customerId).toBeUndefined();
        const b = await g.inbound(fromDoorEmail({ address: 'visitor@example.invalid', text: 'so how much is left on my invoice?', at: '2026-09-11T10:02:00.000Z' }));
        if (b.kind !== 'handled') throw new Error(b.kind);
        expect(b.file.id).toBe(a.file.id);
        expect(b.turn.customerId).toBeUndefined();
        expect(recs.reads).toEqual(['known email:visitor@example.invalid']);
    });
    it('a real WhatsApp or SMS turn from the number binds, and an email linked only through a form still never does after it', async () => {
        const recs = records();
        const g = new ChannelGateway({ desk: quietDesk, identity: new Identity({ known: (k) => recs.knownCustomer(k) }), now: () => new Date('2026-09-11T10:00:00.000Z') });
        const form = await fromWebForm({ customerName: 'Visitor', phone: '07700 900942', email: 'visitor@example.invalid', jobDescription: 'a gate', postcode: null, source: 'web_quote' }, { now: () => new Date('2026-09-11T09:59:00.000Z') });
        await g.inbound(form, { whatsapp: false });
        const sms = await g.inbound(fromDoorSms({ address: '+447700900942', text: 'did my payment go through?', name: null, at: '2026-09-11T10:01:00.000Z' }));
        if (sms.kind !== 'handled') throw new Error(sms.kind);
        expect(sms.turn.customerId).toBe('client-1');
        const wa = await g.inbound({ channel: 'whatsapp', address: '+447700900942', name: null, text: 'and the invoice?', media: [], at: '2026-09-11T10:02:00.000Z', providerMessageId: null, via: 'meta', mediaFailures: [] });
        if (wa.kind !== 'handled') throw new Error(wa.kind);
        expect(wa.turn.customerId).toBe('client-1');
        const email = await g.inbound(fromDoorEmail({ address: 'visitor@example.invalid', text: 'what is on my invoice?', at: '2026-09-11T10:03:00.000Z' }));
        if (email.kind !== 'handled') throw new Error(email.kind);
        expect(email.file.id).toBe(sms.file.id);
        expect(email.turn.customerId).toBeUndefined();
    });
    it('an email binds when the CRM record itself holds the address; a call from the number never binds', async () => {
        const recs = new MemoryCustomerRecords();
        recs.add({ customerId: 'client-1', name: 'Sam Returning', keys: [PHONE, 'email:sam.onfile@example.invalid'] });
        const identity = new Identity({ known: (k) => recs.knownCustomer(k) });
        expect(await identity.resolveKnown('email', 'sam.onfile@example.invalid')).toMatchObject({ ok: true, customerId: 'client-1' });
        const other = new Identity({ known: (k) => recs.knownCustomer(k) });
        expect(await other.resolveKnown('call', '+447700900942')).toMatchObject({ ok: true, customerId: null });
        expect(await other.resolveKnown('form', '+447700900942')).toMatchObject({ ok: true, customerId: null });
    });
    it('with no lookup configured, resolves synchronously as before', () => {
        expect(new Identity().resolveKnown('whatsapp', '+447700900942')).toMatchObject({ ok: true, customerId: null, isNew: true });
    });
    it('one person\'s lookups finish in the order they were asked, and a turn that waited sees what the first bound', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        let asked = 0;
        const identity = new Identity({ known: async () => { asked++; await gate; return [{ customerId: 'client-1', name: null }]; } });
        const order: string[] = [];
        const first = Promise.resolve(identity.resolveKnown('whatsapp', '+447700900942')).then((r) => { order.push('first'); return r; });
        const second = Promise.resolve(identity.resolveKnown('whatsapp', '+447700900942')).then((r) => { order.push('second'); return r; });
        release();
        const [a, b] = await Promise.all([first, second]);
        expect(order).toEqual(['first', 'second']);
        expect(a).toMatchObject({ customerId: 'client-1' });
        expect(b).toMatchObject({ customerId: 'client-1' });
        expect(asked).toBe(1);
    });
});

describe('the binding belongs to the turn', () => {
    it('an SMS from a known customer carries the client on its turn, not on the file; a restart looks the key up again', async () => {
        const recs = records();
        const g = new ChannelGateway({ desk: quietDesk, identity: new Identity({ known: (k) => recs.knownCustomer(k) }), now: () => new Date('2026-09-11T10:00:00.000Z') });
        const out = await g.inbound(fromDoorSms({ address: '+447700900942', text: 'did my payment go through?', name: null, at: '2026-09-11T10:00:00.000Z' }));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.turn.customerId).toBe('client-1');
        expect(out.file.parties[0]).toMatchObject({ name: 'Sam Returning' });
        expect(out.file.parties[0]).not.toHaveProperty('customerId');
        const rebuilt = identityFromCaseFiles([out.file], { known: (k) => recs.knownCustomer(k) });
        expect(await rebuilt.resolveKnown('sms', '+447700900942')).toMatchObject({ ok: true, customerId: 'client-1', personId: out.file.parties[0].personId });
        expect(recs.reads).toEqual([`known ${PHONE}`, `known ${PHONE}`]);
    });
    it('a turn whose lookup failed stays unbound; the next turn is looked up again and binds', async () => {
        let online = false;
        const recs = records();
        const g = new ChannelGateway({ desk: quietDesk, identity: new Identity({ known: async (k) => { if (!online) throw new Error('down'); return recs.knownCustomer(k); } }), now: () => new Date('2026-09-11T10:00:00.000Z') });
        const first = await g.inbound(fromDoorSms({ address: '+447700900942', text: 'hi', name: null, at: '2026-09-11T10:00:00.000Z' }));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.turn.customerId).toBeUndefined();
        online = true;
        const second = await g.inbound(fromDoorSms({ address: '+447700900942', text: 'any news?', name: null, at: '2026-09-11T10:01:00.000Z' }));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.file.id).toBe(first.file.id);
        expect(second.turn.customerId).toBe('client-1');
    });
});

describe('the Service specialist reads the record', () => {
    it('a returning customer\'s invoice question is answered from the invoice row: each value a fact with a customer-record source, the brief carrying them', async () => {
        const file = knownFile('Hi, how much is left to pay on my invoice?');
        const client = new FakeModelClient({ specialist: ({ user }) => {
            expect(user).toContain('- ref invoice:INV-2026-014: invoice INV-2026-014; status sent, not yet paid; total £120.00');
            expect(user).toContain('balance due £80.00');
            return serviceOut({ answers: [{ asked: 'balance left', source: 'history', id: 'invoice:INV-2026-014' }] });
        } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: records(), now }, { routed: true, scopingRan: false, invoiceMoney: true });
        expect(out.proposal.hold).toBeNull();
        const facts = file.facts.filter((f) => out.factIds.includes(f.id));
        expect(facts.find((f) => f.key === 'record:invoice:INV-2026-014:balance_due')).toMatchObject({ value: '£80.00', source: { kind: 'customer_record', customerId: 'client-1', field: 'crm:invoice:INV-2026-014:balance_due' }, by: 'service' });
        expect(out.brief.join('\n')).toMatch(/balance due "£80\.00" \(fact fact_/);
        expect(out.brief.join('\n')).toMatch(/never add them up/);
        expect(out.note).toContain('record invoice:INV-2026-014');
    });
    it('a label the model wrote longer than a label still answers the invoice question, clipped in the brief and the note', async () => {
        // 17 Sep 2026, driven live on the sandbox door: the model echoed the whole question back as
        // `asked`, the answer did not fit the schema, and a known customer asking what was left to
        // pay was held for Ben every time with a holding line instead of the row's own figure.
        const question = 'Hi, quick one about the invoice you sent me for the two doors - have I paid it all off or is there still something outstanding?';
        const file = knownFile(question);
        const client = new FakeModelClient({ specialist: () => serviceOut({ answers: [{ asked: question, source: 'history', id: 'invoice:INV-2026-014' }] }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: records(), now }, { routed: true, scopingRan: false, invoiceMoney: true });
        expect(out.proposal.hold).toBeNull();
        expect(file.facts.find((f) => f.key === 'record:invoice:INV-2026-014:balance_due')?.value).toBe('£80.00');
        const label = askedLabel(question);
        expect(label).toHaveLength(ASKED_LABEL_MAX);
        expect(out.brief.join('\n')).toContain(`They asked "${label}"`);
        expect(out.note).toContain(`record invoice:INV-2026-014 for "${label}"`);
    });
    it('a ref the record did not return is no source; a money question no invoice answered holds as money', async () => {
        const file = knownFile('How much do I owe you?');
        const client = new FakeModelClient({ specialist: () => serviceOut({ answers: [{ asked: 'owe', source: 'history', id: 'invoice:INV-9999' }] }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: records(), now }, { routed: true, scopingRan: false, invoiceMoney: true });
        expect(out.factIds).toEqual([]);
        expect(out.proposal.hold?.reason).toBe('money');
        expect(out.proposal.hold?.match).toMatch(/no invoice on their record answered/);
    });
    it('a failed model call on handed-over money holds as money, not silence', async () => {
        const file = knownFile('How much do I owe you?');
        const client = new FakeModelClient({ specialist: () => ({ error: 'overloaded' }) });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: records(), now }, { routed: true, scopingRan: false, invoiceMoney: true });
        expect(out.proposal.hold?.reason).toBe('money');
    });
    it('a customer the CRM does not know gets no history, and nothing is read', async () => {
        const file = knownFile('Can I get a receipt?', null);
        const recs = records();
        const client = new FakeModelClient({ specialist: ({ user }) => { expect(user).toContain('(no customer record)'); return serviceOut(); } });
        await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: recs, now }, { routed: true, scopingRan: false });
        expect(recs.reads).toEqual([]);
    });
    it('a record read that fails is said to the model and noted, never guessed at', async () => {
        const file = knownFile('Can I get a receipt?');
        const failing = { knownCustomer: async () => [], record: async () => { throw new Error('refused'); } };
        const client = new FakeModelClient({ specialist: ({ user }) => { expect(user).toContain('(their record could not be read just now)'); return serviceOut({ answers: [{ asked: 'receipt', source: 'none', id: null }] }); } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: failing, now }, { routed: true, scopingRan: false });
        expect(out.proposal.hold?.reason).toBe('no_source');
        expect(out.note).toContain('the customer record could not be read');
    });
    it('masking: the stored email, address and postcode never reach the model, and free text on the record is masked like the thread', async () => {
        const file = knownFile('What jobs have you done for me?');
        file.parties[0].channels.push({ kind: 'email', address: 'sam.stored@example.invalid', lastInboundAt: null });
        const recs = records({
            leads: [{ id: 'lead-1', status: 'converted', summary: 'Gate repair at 12 Sandbox Road, Beeston NG9 1AB, email sam.typed@example.invalid', createdAt: '2026-08-20T00:00:00.000Z' }],
            invoices: [invoice({ lines: [{ description: 'Gate at 12 Sandbox Road', totalPence: 12000 }] })],
        });
        let seen = '';
        const client = new FakeModelClient({ specialist: ({ user }) => { seen = user; return serviceOut({ answers: [{ asked: 'past jobs', source: 'history', id: 'lead:lead-1' }] }); } });
        const out = await serve(file, file.turns[0], file.parties[0], client, { kb: emptyKb, records: recs, now }, { routed: true, scopingRan: false });
        expect(seen).not.toMatch(/example\.invalid/);
        expect(seen).not.toMatch(/Sandbox Road|NG9 1AB/);
        expect(seen).toContain('[address withheld]');
        expect(seen).toContain('[email withheld]');
        expect(seen).toContain('email: held on file (not shown)');
        expect(out.brief.join('\n')).not.toMatch(/Sandbox Road|example\.invalid/);
        // The record type has no email, address or postcode to hand over in the first place.
        const rec = (await recs.record('client-1'))!;
        expect(Object.keys(rec).sort()).toEqual(['customerId', 'invoices', 'jobs', 'leads', 'name', 'quotes']);
        expect(Object.keys(rec.invoices[0])).not.toEqual(expect.arrayContaining(['customerEmail']));
    });
});

describe('the router hands a known customer\'s invoice money to Service', () => {
    const router = (exception: string | null = 'money') => new FakeModelClient({ router: () => ({ subjects: ['service'], proposedStage: 'scoping', party: 'customer', exception, turnKind: 'question' }) });
    it('known customer, invoice question: no money exception, Service leads the subjects', async () => {
        const file = knownFile('How much is left to pay on my invoice?');
        const r = await routeTurn(file, file.turns[0], router());
        expect(r.moneyToService).toBe(true);
        expect(r.exceptions).not.toContain('money');
        expect(r.subjects[0]).toBe('service');
    });
    it('an unknown customer, a discount on an invoice, or a price for new work keeps the money exception for Ben', async () => {
        for (const [text, id] of [['How much is left to pay on my invoice?', null], ['Can I get a discount on my invoice? how much off?', 'client-1'], ['How much for a new shelf?', 'client-1']] as const) {
            const file = knownFile(text, id);
            const r = await routeTurn(file, file.turns[0], router());
            expect(r.moneyToService, text).toBe(false);
            expect(r.exceptions, text).toContain('money');
        }
    });
});

describe('the guards accept a record value only as this run read it', () => {
    function withFacts() {
        const file = knownFile('How much is left?');
        const src = (field: string) => ({ kind: 'customer_record' as const, customerId: 'client-1', field });
        const balance = recordFact(file, { key: 'record:invoice:INV-2026-014:balance_due', value: '£80.00', source: src('crm:invoice:INV-2026-014:balance_due'), by: 'service' });
        const due = recordFact(file, { key: 'record:invoice:INV-2026-014:due_on', value: '25 September 2026', source: src('crm:invoice:INV-2026-014:due_on'), by: 'service' });
        if (!balance.ok || !due.ok) throw new Error('facts refused');
        return { file, ids: [balance.value.id, due.value.id] };
    }
    const reply = 'There is £80.00 left to pay on invoice INV-2026-014, due on 25 September 2026.';
    it('passes the figure and the date looked up on this run', () => {
        const { file, ids } = withFacts();
        const g = runGuards({ file, party: file.parties[0], turn: file.turns[0], reply, factIds: ids, kbIds: [], kbRows: [], fixedLines: [], lookedUp: ids, proposedSubject: null, liveQuoteRefs: new Set() });
        expect(g.guards.figure.result).toBe('pass');
        expect(g.guards.date_time_duration.result).toBe('pass');
    });
    it('refuses the same values from an earlier read: the invoice may have been paid since', () => {
        const { file, ids } = withFacts();
        const g = runGuards({ file, party: file.parties[0], turn: file.turns[0], reply, factIds: ids, kbIds: [], kbRows: [], fixedLines: [], lookedUp: [], proposedSubject: null, liveQuoteRefs: new Set() });
        expect(g.guards.figure.result).toBe('fail');
        expect(g.guards.date_time_duration.result).toBe('fail');
    });
});

describe('a returning customer on the desk', () => {
    function turn(text: string, at: string): InboundTurn {
        return { channel: 'whatsapp', address: '+447700900942', name: null, text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
    }
    function desk(recs: MemoryCustomerRecords, handlers: ConstructorParameters<typeof FakeModelClient>[0], extra: Partial<DeskDeps> = {}) {
        const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
        const tick = () => new Date(clock.t += 1000);
        const client = new FakeModelClient(handlers);
        const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now: tick, service: { records: recs }, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, ...extra });
        return { client, gateway: new Gateway({ desk: d, now: tick, identity: new Identity({ known: (k) => recs.knownCustomer(k) }) }) };
    }
    const router = () => ({ subjects: ['service'], proposedStage: 'scoping', party: 'customer', exception: 'money', turnKind: 'question' });

    it('is recognised on their first message, and their invoice question is answered from the invoice with every guard passing and no hold', async () => {
        const recs = records();
        const { gateway } = desk(recs, {
            router,
            specialist: () => serviceOut({ answers: [{ asked: 'balance left', source: 'history', id: 'invoice:INV-2026-014' }] }),
            composer: ({ user }) => {
                expect(user).toMatch(/Customer: Sam Returning\./);
                const balance = /balance due "£80\.00" \(fact (fact_[^)]+)\)/.exec(user)![1];
                const due = /due on "25 September 2026" \(fact (fact_[^)]+)\)/.exec(user)![1];
                return { reply: 'Hi Sam, there is £80.00 left to pay on invoice INV-2026-014, due on 25 September 2026.', factIds: [balance, due], kbIds: [] };
            },
        });
        const out = await gateway.inbound(turn('Hi, how much is left to pay on my invoice?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.turn.customerId).toBe('client-1');
        expect(out.result.decision).toBe('send');
        expect(Object.values(out.result.guards).every((g) => g.result === 'pass')).toBe(true);
        expect(out.file.hold).toBeNull();
        expect(out.result.bubbles.map((b) => b.text).join(' ')).toContain('£80.00');
        expect(recs.reads).toEqual([`known ${PHONE}`, 'record client-1']);
    });
    it('a customer the CRM does not know asking the same holds for Ben on money, with the money line', async () => {
        const recs = new MemoryCustomerRecords();
        const { gateway } = desk(recs, {
            router,
            specialist: ({ user }) => { expect(user).toContain('(no customer record)'); return serviceOut({ answers: [{ asked: 'balance left', source: 'none', id: null }] }); },
            composer: () => ({ reply: `${DEFAULT_FIXED_LINES.money_to_ben}`, factIds: [], kbIds: [] }),
        });
        const out = await gateway.inbound(turn('Hi, how much is left to pay on my invoice?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.hold?.exception).toBe('money');
        expect(recs.reads).toEqual([`known ${PHONE}`]);
    });
    it('a known customer whose invoice question the model could not tie to an invoice holds on money', async () => {
        const { gateway } = desk(records(), {
            router,
            specialist: () => serviceOut({ answers: [{ asked: 'balance left', source: 'none', id: null }] }),
            composer: () => ({ reply: `${DEFAULT_FIXED_LINES.money_to_ben}`, factIds: [], kbIds: [] }),
        });
        const out = await gateway.inbound(turn('Hi, how much is left to pay on my invoice?', '2026-09-11T10:00:00.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.file.hold?.exception).toBe('money');
        expect(out.file.hold?.reason).toMatch(/^money: an invoice money question no invoice on their record answered/);
    });
    it('a composer that repeats a record figure from an earlier turn without this run reading it is refused', async () => {
        const recs = records();
        let n = 0;
        const { gateway } = desk(recs, {
            router: () => ({ subjects: n === 0 ? ['service'] : ['scoping'], proposedStage: 'scoping', party: 'customer', exception: n === 0 ? 'money' : null, turnKind: n === 0 ? 'question' : 'acknowledgement' }),
            specialist: ({ system }) => /Service specialist/.test(system) ? serviceOut(n === 0 ? { answers: [{ asked: 'balance', source: 'history', id: 'invoice:INV-2026-014' }] } : {}) : { facts: [], jobUnknowns: [], answeredSubjects: [] },
            composer: ({ user }) => {
                if (n === 0) {
                    n++;
                    const balance = /balance due "£80\.00" \(fact (fact_[^)]+)\)/.exec(user)![1];
                    return { reply: 'There is £80.00 left to pay.', factIds: [balance], kbIds: [] };
                }
                // Not offered this run: the earlier balance fact is left off the composer's list.
                expect(user).not.toContain('record:invoice:INV-2026-014:balance_due');
                return { reply: 'Just to confirm, £80.00 is still to pay.', factIds: [], kbIds: [] };
            },
        });
        const first = await gateway.inbound(turn('Hi, how much is left to pay on my invoice?', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.result.decision).toBe('send');
        const second = await gateway.inbound(turn('ok thanks', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        // Refused on both attempts: held for Ben with the figure named, and the customer gets the acknowledgement, not the figure.
        expect(second.result.decision).toBe('hold');
        expect(second.file.hold?.failures).toContain('figure: a figure appears that is not a line of the live quote or a customer record: £80.00');
        expect(second.result.bubbles.map((b) => b.text).join(' ')).not.toContain('£80.00');
    });
});

describe('the database reader', () => {
    it('refuses anything but the branch before it opens a connection', async () => {
        const saved = { ...process.env };
        try {
            delete process.env.COMMS_V2_DATABASE_URL;
            await expect(databaseCustomerRecords('sandbox').knownCustomer(PHONE)).rejects.toThrow(/COMMS_V2_DATABASE_URL/);
            await expect(databaseCustomerRecords('sandbox').record('client-1')).rejects.toThrow(/COMMS_V2_DATABASE_URL/);
        } finally {
            process.env = saved;
        }
    });
});
