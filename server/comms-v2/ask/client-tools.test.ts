/**
 * The ask agent finding people and showing their record (N2, N3, N4), through a whole turn: the
 * pick card when Ben must choose (A4), the tap that carries his original ask on, the client card
 * read only with email and address only "on file" (answers 46, 47 and 115), and nothing read or
 * proposed for a person Ben has not picked.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AskContext, PickSurface } from '@shared/ops-types';
import { BEN } from '../desk/guards';
import { FakeModelClient } from '../desk/models';
import { runAskTurn, type RunAskTurnOptions } from './agent';
import { MemoryAskActionStore } from './actions';
import { MemoryPeopleDirectory, type PersonRow } from './people';
import { MemoryAskSessionStore } from './sessions';
import { createAskRouter } from './routes';
import { sessionPeople } from './session-people';
import type { DossierReader } from './client-record';
import { BEN_PERSON, dossierOf, memorySource, now, personRow, scriptedLoop, whatsappFile, type ScriptStep } from './ask-fixtures';

const route = (over: Record<string, unknown> = {}) => ({ intents: ['find', 'show'], domains: ['clients'], surface: 'client', steps: ['Find them'], moneyAction: false, wantsDraft: false, ...over });

const ELLIS: PersonRow = personRow({
    kind: 'client', id: 'c-ellis', name: 'Sarah Ellis', phone: '+447700900111', outwardPostcodes: ['NG7'], emailOnFile: true, addressOnFile: true,
    companyFields: [
        { field: 'name', text: 'Sarah Ellis', shown: null },
        { field: 'tags', text: 'Tena Properties', shown: 'Tena Properties' },
        { field: 'notes', text: 'Key under the mat at 14 Lenton Boulevard', shown: null },
    ],
});
const BROWN = personRow({ kind: 'client', id: 'c-brown', name: 'Sarah Brown', phone: '+447700900222' });
const ALAN_NG5 = personRow({ kind: 'client', id: 'c-alan-ng5', name: 'Alan Smith', phone: '07700900333', outwardPostcodes: ['NG5'] });
const ALAN_DE1 = personRow({ kind: 'lead', id: 'l-alan-de1', name: 'Alan Smith', phone: '07700900444', outwardPostcodes: ['DE1'] });

const directory = () => new MemoryPeopleDirectory([ELLIS, BROWN, ALAN_NG5, ALAN_DE1], {
    'client:c-ellis': [{ id: 'sp-1', source: 'service', role: 'client', outwardPostcode: 'NG7', active: true }],
});

const dossier: DossierReader = async (phone) => (phone === ELLIS.phone ? dossierOf({
    name: 'Sarah Ellis',
    summary: { jobs: 1, openBalancePence: 4500, liveQuotes: 1, counts: { leads: 1, quotes: 2, jobs: 1, invoices: 1, conversations: 0, calls: 1 } },
    quotes: [
        { id: 'q-2', shortSlug: 'ab12cd', name: 'Sarah Ellis', job: 'Fit two shelves', pricePence: 14000, status: 'live', expiresAt: null, viewedAt: '2026-09-15T10:00:00.000Z', bookedAt: null, depositPaidAt: null, createdAt: '2026-09-14T10:00:00.000Z' },
        { id: 'q-1', shortSlug: 'zz99yy', name: 'Sarah Ellis', job: 'Hang a door', pricePence: 9000, status: 'booked', expiresAt: null, viewedAt: null, bookedAt: '2026-08-01T10:00:00.000Z', depositPaidAt: null, createdAt: '2026-07-30T10:00:00.000Z' },
    ],
    jobs: [
        { id: 'j-old', quoteId: 'q-1', invoiceId: null, name: 'Sarah Ellis', description: 'Hang a door', status: 'completed', assignmentStatus: 'accepted', dayOfStatus: 'completed', scheduledDate: '2026-08-05T00:00:00.000Z', completedAt: '2026-08-05T15:00:00.000Z', createdAt: '2026-08-01T10:00:00.000Z' },
        { id: 'j-next', quoteId: 'q-2', invoiceId: null, name: 'Sarah Ellis', description: 'Fit two shelves', status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: null, scheduledDate: '2026-09-22T00:00:00.000Z', completedAt: null, createdAt: '2026-09-15T10:00:00.000Z' },
    ],
    invoices: [{ id: 'inv-1', invoiceNumber: 'INV-0042', quoteId: 'q-1', name: 'Sarah Ellis', totalPence: 9000, balanceDuePence: 4500, status: 'sent', dueDate: '2026-08-20T00:00:00.000Z', paidAt: null, createdAt: '2026-08-06T10:00:00.000Z' }],
    calls: [{ id: 'call-1', direction: 'inbound', status: 'completed', outcome: 'INSTANT_PRICE', durationSec: 120, jobSummary: 'Wants shelves', startTime: '2026-09-13T10:00:00.000Z' }],
    leads: [{ id: 'lead-1', name: 'Sarah Ellis', stage: 'quote_sent', status: 'new', source: 'call', job: 'Shelves', createdAt: '2026-09-13T10:00:00.000Z' }],
}) : dossierOf());

function ask(over: Partial<RunAskTurnOptions> = {}): RunAskTurnOptions {
    return { sessionId: 'session-1', userMessage: 'send a whatsapp to sarah from tena properties telling her we will call her this afternoon', via: 'typed', context: null, history: [], person: BEN_PERSON, approver: BEN, ...over };
}

async function turn(opts: Partial<RunAskTurnOptions>, steps: ScriptStep[], extra: { routeOver?: Record<string, unknown>; files?: ReturnType<typeof whatsappFile>[]; people?: MemoryPeopleDirectory } = {}) {
    const { source } = memorySource(extra.files ?? []);
    const seen: { opts?: any; results: any[] } = { results: [] };
    const actions = new MemoryAskActionStore();
    const out = await runAskTurn(ask(opts), {
        source, assignments: async () => ({ ben: ['u1'] }), now: now(), actions,
        client: new FakeModelClient({ router: () => route(extra.routeOver) }),
        people: extra.people ?? directory(), dossier,
        loop: scriptedLoop(steps, seen),
    });
    return { out, seen, actions };
}

describe('"send a whatsapp to Sarah from Tena Properties": the pick comes first', () => {
    it('asks about the single match the first time, and reads or proposes nothing for her until Ben taps', async () => {
        const file = whatsappFile({ name: 'Sam' });
        const { out, seen, actions } = await turn({}, [
            { tool: 'find_people', input: { query: 'Sarah', hint: 'Tena Properties' } },
            { tool: 'client_record', input: { personId: 'client:c-ellis' } },
            { tool: 'propose_send_held_draft', input: { caseFileId: file.id } },
            { tool: 'give_answer', input: { finalText: 'Sarah Ellis is at Tena Properties.', surface: 'words' } },
        ], { routeOver: { intents: ['find', 'message'], domains: ['clients', 'messages'], surface: 'pick' }, files: [file] });

        expect(seen.opts.tools.map((t: { name: string }) => t.name)).toEqual(['get_board', 'find_case_files', 'get_case_file', 'find_people', 'client_record', 'properties_of', 'draft_reply', 'propose_send_held_draft', 'give_answer']);
        expect(seen.results[0]).toMatchObject({ status: 'pick', question: 'Did you mean Sarah Ellis at Tena Properties?', total: 1, candidates: [{ personId: 'client:c-ellis', company: 'Tena Properties', phoneTail: '111' }] });
        expect(seen.results[1]).toEqual({ status: 'refused', reason: 'Ben has not picked this person yet: answer with the pick card and wait for his tap' });
        expect(seen.results[2]).toEqual({ status: 'refused', reason: 'Ben has not picked who this is about yet: answer with the pick card and propose nothing' });
        expect(actions.rows.size).toBe(0);

        // The pick is the answer whatever the model chose, and a waiting pick is not a refused plan.
        expect(out.answer).toEqual({
            finalText: 'Did you mean Sarah Ellis at Tena Properties?',
            surface: {
                type: 'pick', question: 'Did you mean Sarah Ellis at Tena Properties?', query: 'Sarah', hint: 'Tena Properties', total: 1,
                candidates: [{
                    id: 'client:c-ellis', name: 'Sarah Ellis', kind: 'client', company: 'Tena Properties', phoneTail: '111', outwardPostcode: 'NG7',
                    lastActivity: ELLIS.lastActivity, caseFileId: null, stage: null, held: false,
                    choose: { text: 'Sarah Ellis, Tena Properties', context: { personId: 'client:c-ellis', caseFileId: null } },
                }],
            },
        });
        const text = JSON.stringify([out.answer, seen.results]);
        expect(text).not.toContain('Lenton');
        expect(text).not.toContain('+447700900111');
    });

    it('carries the original ask on after the tap, with the person settled and the clients group offered', async () => {
        const pick: PickSurface = { type: 'pick', question: 'Did you mean Sarah Ellis at Tena Properties?', candidates: [{ id: 'client:c-ellis', name: 'Sarah Ellis' }] };
        const original = ask().userMessage;
        const context: AskContext = { personId: 'client:c-ellis', caseFileId: null };
        const people = sessionPeople([
            { id: 'm1', sessionId: 'session-1', role: 'user', content: original, runId: null, transcript: null, createdAt: '2026-09-17T09:00:00.000Z' },
            { id: 'm2', sessionId: 'session-1', role: 'assistant', content: pick.question, runId: 'r1', transcript: null, createdAt: '2026-09-17T09:00:01.000Z', answer: { finalText: pick.question, surface: pick } },
        ], context);

        const { out, seen } = await turn({ userMessage: 'Sarah Ellis, Tena Properties', via: 'tap', context, knownPeople: people.settled, picked: people.picked }, [
            { tool: 'find_people', input: { query: 'Sarah', hint: 'Tena Properties' } },
            { tool: 'client_record', input: { personId: 'client:c-ellis' } },
            { tool: 'give_answer', input: { finalText: 'Here is Sarah Ellis.', surface: 'client', personId: 'client:c-ellis' } },
        ], { routeOver: { domains: ['messages'], surface: 'thread' } });

        expect(seen.opts.goal).toContain('Ben tapped: Sarah Ellis, Tena Properties');
        expect(seen.opts.goal).toContain('Ben picked Sarah Ellis (personId client:c-ellis) for "Did you mean Sarah Ellis at Tena Properties?"');
        expect(seen.opts.goal).toContain(`Carry on with the ask the pick came from: ${original}`);
        expect(seen.opts.tools.map((t: { name: string }) => t.name)).toContain('find_people');
        expect(seen.results[0]).toMatchObject({ status: 'found', person: { personId: 'client:c-ellis' } });
        expect(seen.results[1]).toMatchObject({ status: 'ok', record: { id: 'client:c-ellis', name: 'Sarah Ellis' } });
        expect(out.answer.surface).toMatchObject({ type: 'client', id: 'client:c-ellis' });
    });
});

describe('several Alan Smiths', () => {
    it('shows a pick card with each one, told apart by postcode, and never a record', async () => {
        const { out, seen } = await turn({ userMessage: 'show me the latest quote for alan smith' }, [
            { tool: 'find_people', input: { query: 'Alan Smith' } },
            { tool: 'give_answer', input: { finalText: 'Which Alan Smith?', surface: 'pick' } },
        ]);
        expect(seen.results[0]).toMatchObject({ status: 'pick', total: 2 });
        expect(out.answer.finalText).toBe('Which Alan Smith?');
        expect(out.answer.surface).toMatchObject({
            type: 'pick', question: '2 matches for Alan Smith. Which one?', total: 2,
            candidates: [
                { id: 'client:c-alan-ng5', name: 'Alan Smith', outwardPostcode: 'NG5', phoneTail: '333', choose: { text: 'Alan Smith', context: { personId: 'client:c-alan-ng5', caseFileId: null } } },
                { id: 'lead:l-alan-de1', name: 'Alan Smith', outwardPostcode: 'DE1', phoneTail: '444' },
            ],
        });
    });

    it('goes straight to the one Ben already picked this session', async () => {
        const { out, seen } = await turn({ userMessage: 'show me alan smith', knownPeople: ['client:c-alan-ng5'] }, [
            { tool: 'find_people', input: { query: 'Alan Smith', hint: 'NG5' } },
            { tool: 'client_record', input: { personId: 'client:c-alan-ng5' } },
            { tool: 'give_answer', input: { finalText: 'Alan Smith, NG5.', surface: 'client', personId: 'client:c-alan-ng5' } },
        ]);
        expect(seen.results[0]).toMatchObject({ status: 'found', person: { personId: 'client:c-alan-ng5' } });
        expect(out.answer.surface).toMatchObject({ type: 'client', id: 'client:c-alan-ng5', name: 'Alan Smith', phoneTail: '333' });
    });
});

describe('a single match', () => {
    it('is asked about the first time, and not when it is the selected card\'s customer', async () => {
        const file = whatsappFile({ name: 'Sarah Brown' });
        const onFile = personRow({ ...BROWN, phone: file.parties[0].channels[0].address });
        const people = new MemoryPeopleDirectory([onFile]);

        const first = await turn({ userMessage: 'show sarah brown' }, [{ tool: 'find_people', input: { query: 'Sarah Brown' } }], { people, files: [file] });
        expect(first.seen.results[0]).toMatchObject({ status: 'pick', question: 'Did you mean Sarah Brown?' });
        expect(first.out.answer.surface.type).toBe('pick');

        const selected = await turn({ userMessage: 'show sarah brown', context: { caseFileId: file.id } }, [
            { tool: 'find_people', input: { query: 'Sarah Brown' } },
            { tool: 'client_record', input: { personId: 'client:c-brown' } },
        ], { people, files: [file] });
        expect(selected.seen.results[0]).toMatchObject({ status: 'found', note: expect.stringContaining('selected card'), person: { caseFileId: file.id } });
        // With no give_answer, the record it read is what the answer shows.
        expect(selected.out.answer.surface).toMatchObject({ type: 'client', id: 'client:c-brown', caseFile: { id: file.id, stage: file.stage, held: false } });
    });
});

describe('no match', () => {
    it('says so, names the near misses, and shows words', async () => {
        const { out, seen } = await turn({ userMessage: 'message sarah from acme lettings' }, [
            { tool: 'find_people', input: { query: 'Sarah', hint: 'Acme Lettings' } },
            { tool: 'give_answer', input: { finalText: 'I cannot find a Sarah at Acme Lettings. Search by phone?', surface: 'words' } },
        ]);
        expect(seen.results[0]).toEqual({ status: 'none', query: 'Sarah', hint: 'Acme Lettings', note: '2 people match the name, but not "Acme Lettings". Tell Ben, and offer to search by phone number.' });
        expect(out.answer).toEqual({ finalText: 'I cannot find a Sarah at Acme Lettings. Search by phone?', surface: { type: 'words' } });
    });

    it('refuses a record for an id it never found, and a client card it never read', async () => {
        const { out, seen } = await turn({ userMessage: 'show me client:c-ellis' }, [
            { tool: 'client_record', input: { personId: 'client:c-ellis' } },
            { tool: 'client_record', input: { personId: '07700900111' } },
            { tool: 'give_answer', input: { finalText: 'Here.', surface: 'client', personId: 'client:c-ellis' } },
        ]);
        expect(seen.results[0]).toEqual({ status: 'refused', reason: 'this person has not been found in this ask: call find_people first and use the id it returns' });
        expect(seen.results[1]).toEqual({ status: 'refused', reason: 'that is not a person id: use an id find_people returned' });
        expect(seen.results[2]).toEqual({ ok: false, error: 'read that person with client_record first' });
        expect(out.answer.surface).toEqual({ type: 'words' });
    });
});

describe('the client card: the full record, read only, masked', () => {
    it('shows the record and figures, and email and address only as on file', async () => {
        const { out, seen } = await turn({ userMessage: 'show me sarah ellis', knownPeople: ['client:c-ellis'] }, [
            { tool: 'find_people', input: { query: 'Sarah Ellis' } },
            { tool: 'client_record', input: { personId: 'client:c-ellis' } },
            { tool: 'properties_of', input: { personId: 'client:c-ellis' } },
            { tool: 'give_answer', input: { finalText: 'Sarah Ellis owes £45.', surface: 'client', personId: 'client:c-ellis' } },
        ]);
        expect(seen.results[2]).toEqual({ status: 'ok', properties: [{ id: 'sp-1', outwardPostcode: 'NG7', role: 'client', active: true }] });
        expect(out.answer.surface).toEqual({
            type: 'client', id: 'client:c-ellis', kind: 'client', name: 'Sarah Ellis', company: null, phoneTail: '111',
            emailOnFile: true, addressOnFile: true,
            properties: [{ id: 'sp-1', outwardPostcode: 'NG7', role: 'client', active: true }],
            caseFile: null,
            lastQuote: { id: 'q-2', slug: 'ab12cd', status: 'live', pricePence: 14000, summary: 'Fit two shelves', createdAt: '2026-09-14T10:00:00.000Z', viewedAt: '2026-09-15T10:00:00.000Z' },
            nextBooking: { id: 'j-next', quoteId: 'q-2', status: 'accepted', dayOfStatus: null, scheduledDate: '2026-09-22T00:00:00.000Z', completedAt: null, summary: 'Fit two shelves' },
            owedPence: 4500, liveQuotes: 1,
            counts: { leads: 1, quotes: 2, jobs: 1, invoices: 1, calls: 1 },
            quotes: [expect.objectContaining({ id: 'q-2' }), expect.objectContaining({ id: 'q-1', pricePence: 9000 })],
            jobs: [expect.objectContaining({ id: 'j-old' }), expect.objectContaining({ id: 'j-next' })],
            invoices: [{ id: 'inv-1', number: 'INV-0042', status: 'sent', totalPence: 9000, balanceDuePence: 4500, dueDate: '2026-08-20T00:00:00.000Z', paidAt: null }],
            calls: [{ id: 'call-1', direction: 'inbound', outcome: 'INSTANT_PRICE', startTime: '2026-09-13T10:00:00.000Z', summary: 'Wants shelves' }],
            leads: [{ id: 'lead-1', status: 'new', stage: 'quote_sent', summary: 'Shelves', createdAt: '2026-09-13T10:00:00.000Z' }],
        });
        // Nothing the model or the card carries holds the note, the phone, an email address or a street.
        const text = JSON.stringify([out.answer, seen.results, seen.opts.goal]);
        for (const secret of ['Lenton', 'Key under', '+447700900111', '7700900111', '@']) expect(text).not.toContain(secret);
        // Nothing was proposed: a record is only ever read.
        expect(out.answer.confirm).toBeUndefined();
    });
});

describe('the pick tap over HTTP', () => {
    let server: import('node:http').Server;
    let base: string;
    const seen: RunAskTurnOptions[] = [];
    const sessions = new MemoryAskSessionStore(() => new Date('2026-09-17T09:10:00.000Z'));
    const pick: PickSurface = { type: 'pick', question: 'Did you mean Sarah Ellis?', candidates: [{ id: 'client:c-ellis', name: 'Sarah Ellis' }] };

    beforeAll(async () => {
        const { source } = memorySource();
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { (req as any).user = { id: 'user_ben', email: BEN_PERSON, role: 'admin' }; next(); });
        app.use('/ask', createAskRouter({
            source, sessions, actions: new MemoryAskActionStore(), approvers: async () => ({}), emit: () => {},
            runTurn: async (opts) => {
                seen.push(opts);
                return { answer: opts.via === 'typed' ? { finalText: pick.question, surface: pick } : { finalText: 'ok', surface: { type: 'words' } }, leanTranscript: [], usage: { loop: null, calls: [] } };
            },
        }));
        await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
        base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/ask`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    async function settled(sessionId: string, count: number) {
        for (let i = 0; i < 50; i++) {
            const found = await sessions.get(sessionId);
            if (found && found.messages.length >= count) return found;
            await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('run did not finish');
    }

    it('takes only a person the session showed, and hands the run the pick and the ask it answers', async () => {
        const session = await (await post('/sessions', {})).json();
        // An id the session never showed is dropped before the run and before it is stored.
        expect((await post(`/sessions/${session.id}/messages`, { text: 'show them', via: 'tap', context: { personId: 'client:c-ellis' } })).status).toBe(202);
        await settled(session.id, 2);
        expect(seen[0].context).toBeNull();
        expect(seen[0].knownPeople).toEqual([]);
        expect((await sessions.get(session.id))!.messages[0].context).toBeNull();

        expect((await post(`/sessions/${session.id}/messages`, { text: 'message sarah ellis' })).status).toBe(202);
        await settled(session.id, 4);
        expect((await post(`/sessions/${session.id}/messages`, { text: 'Sarah Ellis', via: 'tap', context: { personId: 'client:c-ellis', caseFileId: null } })).status).toBe(202);
        const done = await settled(session.id, 6);
        expect(seen[2]).toMatchObject({
            via: 'tap',
            context: { personId: 'client:c-ellis', caseFileId: null, phone: null },
            knownPeople: ['client:c-ellis'],
            picked: { personId: 'client:c-ellis', name: 'Sarah Ellis', question: 'Did you mean Sarah Ellis?', ask: 'message sarah ellis' },
        });
        expect(done.messages[4].context).toEqual({ personId: 'client:c-ellis', caseFileId: null, phone: null });
    });
});
