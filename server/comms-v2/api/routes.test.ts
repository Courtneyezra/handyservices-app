/**
 * Goal 2 - the board API driven the way the page drives it: a thread started through the mounted
 * sandbox door shows on the board (the door replaces its gateway on every start, so the board must
 * read the live one), a money turn holds it for ben, and release is by the signed-in session only,
 * and only when the comms_v2_approvers row lists that session for the slot. The sandbox door the
 * board mounts follows the same rule: "Ben replies" releases as the session's slot, never as a
 * name in the request body.
 *
 * Then the answer half: Ben writes the reply himself and it goes out through the desk's one sender
 * with him as approver - the signed-in person, not the slot - and the guards not applied, lands on the file
 * as his turn, clears the hold and hands the thread back to the desk; the same session rules gate
 * it as they gate release.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { open, hold as setHold, type CaseFile } from '../desk/case-file';
import { noFixedLineSource } from '../desk/fixed-lines';
import { BEN } from '../desk/guards';
import { FakeModelClient } from '../desk/models';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import type { TemplateStatusSource } from '../desk/sender';
import { noTemplateApproved } from '../desk/sender';
import { MemoryCaseFileStore } from '../desk/store';
import { sessionApprover, type ApproverAssignments } from './approvers';
import { createCommsV2ApiRouter } from './routes';
import type { PriceQueueItem, PriceQueuePayload } from '../../spine/price-queue';

const noPriceQueue = async (): Promise<PriceQueuePayload> => ({ count: 0, items: [], oldestWaitingMs: null, at: new Date().toISOString() });

let server: import('node:http').Server;
let base: string;
let assignments: ApproverAssignments = {};

beforeAll(async () => {
    const client = new FakeModelClient({
        router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /how much/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'enquiry' }),
        specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking tap' }], jobUnknowns: [], answeredSubjects: [] }),
        composer: () => ({ reply: 'Hi Sam, a leaking tap, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
    });
    const door = createSandboxDoor({ quietMs: 0, client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, approver: sessionApprover(async () => assignments) });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const email = req.header('x-test-user');
        if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' };
        next();
    });
    const staffNames = async (emails: string[]) => Object.fromEntries(
        emails.filter((e) => e.toLowerCase() === 'ben.real@handyservices.app').map((e) => [e.toLowerCase(), 'Ben Real']),
    );
    app.use('/api/comms-v2', createCommsV2ApiRouter(door, async () => assignments, undefined, undefined, staffNames, undefined, undefined, undefined, noPriceQueue));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/comms-v2`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function call(method: string, route: string, body?: unknown, as?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (as) headers['x-test-user'] = as;
    const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
}
const cardsOn = (board: any) => Object.values(board.columns as Record<string, any[]>).flat();

describe('the board over the sandbox door', () => {
    it('a thread started through the door is on the board, and so is the next one after the door resets', async () => {
        const first = await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        expect(first.status).toBe(200);
        const firstId = first.json.state.conversation.id as string;

        let board = await call('GET', '/board');
        expect(board.status).toBe(200);
        expect(cardsOn(board.json).map((c) => c.id)).toEqual([firstId]);
        expect(board.json.columns.scoping[0]).toMatchObject({ customerName: 'Sam', jobType: 'leaking tap', replyChannel: 'whatsapp', mode: 'sandbox', held: false });

        const second = await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi again, a new job', name: 'Sam' });
        const secondId = second.json.state.conversation.id as string;
        expect(secondId).not.toBe(firstId);

        board = await call('GET', '/board');
        expect(cardsOn(board.json).map((c) => c.id)).toEqual([secondId]);
        const detail = await call('GET', `/case-files/${secondId}`);
        expect(detail.status).toBe(200);
        expect(detail.json.turns.map((t: any) => t.direction)).toEqual(['inbound', 'outbound']);
    });

    it('a money turn holds the card for ben; the held filter and the detail carry the hold', async () => {
        const r = await call('POST', '/sandbox/message', { text: 'How much roughly?', channel: 'whatsapp' });
        expect(r.status).toBe(200);
        const id = r.json.state.conversation.id as string;

        const held = await call('GET', '/board?held=true');
        expect(cardsOn(held.json).map((c) => c.id)).toEqual([id]);
        expect(cardsOn(held.json)[0]).toMatchObject({ held: true, holdApprover: 'ben', holdApproverAssigned: false, lastCustomerMessage: 'How much roughly?' });

        const detail = await call('GET', `/case-files/${id}`);
        expect(detail.json.hold).toMatchObject({ approver: { kind: 'human', id: 'ben' } });
        expect(detail.json.holdApproverAssigned).toBe(false);
        expect(detail.json).not.toHaveProperty('ledger');
        expect(detail.json).not.toHaveProperty('sends');
    });

    it('the Handy Desk queue lists the held file with its draft and its working-hours wait, and nothing unheld', async () => {
        const held = await call('GET', '/board?held=true');
        const id = cardsOn(held.json)[0].id as string;

        const queue = await call('GET', '/queue');
        expect(queue.status).toBe(200);
        expect(queue.json.items.map((i: any) => i.id)).toEqual([id]);
        const detail = await call('GET', `/case-files/${id}`);
        expect(queue.json.items[0]).toMatchObject({ held: true, holdApprover: 'ben', lastCustomerMessage: 'How much roughly?', draft: detail.json.hold.draft });
        expect(typeof queue.json.items[0].waitingWorkingHours).toBe('number');
        expect(typeof queue.json.handledToday).toBe('number');
        expect(typeof queue.json.sandboxAvailable).toBe('boolean');

        const liveOnly = await call('GET', '/queue?mode=live');
        expect(liveOnly.json.items).toEqual([]);
    });

    it('with no approvers row, nobody can release, not even an account whose email is ben@', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;

        const anonymous = await call('POST', `/case-files/${id}/release`, { words: 'fine' });
        expect(anonymous.status).toBe(401);

        const ben = await call('POST', `/case-files/${id}/release`, { words: 'Checked, all fine' }, 'ben@handyservices.app');
        expect(ben.status).toBe(403);
        expect(ben.json.error).toMatch(/no approver slot/);

        const still = await call('GET', '/board?held=true');
        expect(cardsOn(still.json).map((c) => c.id)).toEqual([id]);
    });

    it('once the row lists a user for ben, the card shows the slot assigned and an unlisted session still cannot release', async () => {
        assignments = { ben: ['user_Ben.Real@handyservices.app'] };
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;
        expect(cardsOn(board.json)[0].holdApproverAssigned).toBe(true);

        const unlisted = await call('POST', `/case-files/${id}/release`, { approver: 'ben', words: 'Checked, all fine' }, 'ben@handyservices.app');
        expect(unlisted.status).toBe(403);

        const still = await call('GET', '/board?held=true');
        expect(cardsOn(still.json).map((c) => c.id)).toEqual([id]);
    });

    it('the listed session releases with the words recorded, and the card leaves the held filter', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;

        const noWords = await call('POST', `/case-files/${id}/release`, { words: '   ' }, 'Ben.Real@handyservices.app');
        expect(noWords.status).toBe(409);

        const ok = await call('POST', `/case-files/${id}/release`, { words: 'Spoke to the customer, resolved.' }, 'Ben.Real@handyservices.app');
        expect(ok.status).toBe(200);
        expect(ok.json.release).toMatchObject({ approver: { kind: 'human', id: 'ben' }, words: 'Spoke to the customer, resolved.' });
        expect(ok.json.card.held).toBe(false);

        const held = await call('GET', '/board?held=true');
        expect(cardsOn(held.json)).toEqual([]);
        const detail = await call('GET', `/case-files/${id}`);
        expect(detail.json.hold).toBeNull();
    });

    it('the door\'s "Ben replies" releases as the session\'s slot only, never as a name in the body', async () => {
        assignments = { ben: ['user_Ben.Real@handyservices.app'] };
        await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        await call('POST', '/sandbox/message', { text: 'How much roughly?', channel: 'whatsapp' });
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;

        const anonymous = await call('POST', '/sandbox/ben-replies', { text: 'Leave it with me', by: 'ben' });
        expect(anonymous.status).toBe(403);
        const unlisted = await call('POST', '/sandbox/ben-replies', { text: 'Leave it with me', by: 'ben' }, 'ben@handyservices.app');
        expect(unlisted.status).toBe(403);
        expect((await call('GET', `/case-files/${id}`)).json.hold).not.toBeNull();
        expect((await call('GET', `/case-files/${id}`)).json.turns.map((t: any) => t.direction)).toEqual(['inbound', 'outbound', 'inbound', 'outbound']);

        const listed = await call('POST', '/sandbox/ben-replies', { text: 'Leave it with me, Sam', surface: 'kanban' }, 'Ben.Real@handyservices.app');
        expect(listed.status).toBe(200);
        // The send carries the person who wrote it; the hold is released by the slot that session occupies.
        expect(listed.json).toMatchObject({ event: 'return_to_automation', approver: 'human:Ben.Real@handyservices.app', released: { approver: { kind: 'human', id: 'ben' } }, automation: { state: 'automated' } });
        expect((await call('GET', `/case-files/${id}`)).json.hold).toBeNull();
    });
});

describe('Ben answers from the board', () => {
    it('refuses without a session, without a slot, without words and on an unknown file', async () => {
        await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        const money = await call('POST', '/sandbox/message', { text: 'How much roughly?', channel: 'whatsapp' });
        const id = money.json.state.conversation.id as string;

        assignments = {};
        expect((await call('POST', `/case-files/${id}/answer`, { words: 'Hi Sam' })).status).toBe(401);
        expect((await call('POST', `/case-files/${id}/answer`, { words: 'Hi Sam' }, 'ben@handyservices.app')).status).toBe(403);

        assignments = { ben: ['user_Ben.Real@handyservices.app'] };
        const noWords = await call('POST', `/case-files/${id}/answer`, { words: '  ' }, 'Ben.Real@handyservices.app');
        expect(noWords.status).toBe(400);
        expect(noWords.json.error).toMatch(/needs words/);
        expect((await call('POST', '/case-files/case_nope/answer', { words: 'Hi' }, 'Ben.Real@handyservices.app')).status).toBe(404);

        const still = await call('GET', '/board?held=true');
        expect(cardsOn(still.json).map((c) => c.id)).toEqual([id]);
    });

    it('refuses a session listed for another slot on a file that answers to ben', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;
        const before = await call('GET', `/case-files/${id}`);

        assignments = { ben: ['user_Ben.Real@handyservices.app'], landlord_1: ['user_Lena.Landlord@handyservices.app'] };
        const wrong = await call('POST', `/case-files/${id}/answer`, { words: 'Morning Sam, I can sort that for you.' }, 'Lena.Landlord@handyservices.app');
        expect(wrong.status).toBe(409);
        expect(wrong.json.error).toMatch(/only ben may answer/);

        const after = await call('GET', `/case-files/${id}`);
        expect(after.json.turns).toHaveLength(before.json.turns.length);
        expect(after.json.hold).not.toBeNull();
    });

    it('refuses a reply the sender will not carry, and sends nothing', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;
        const before = await call('GET', `/case-files/${id}`);

        const wall = ['one', 'two', 'three', 'four', 'five'].join('\n\n');
        const refused = await call('POST', `/case-files/${id}/answer`, { words: wall }, 'Ben.Real@handyservices.app');
        expect(refused.status).toBe(409);
        expect(refused.json.error).toMatch(/over the ceiling/);

        const after = await call('GET', `/case-files/${id}`);
        expect(after.json.turns).toHaveLength(before.json.turns.length);
        expect(after.json.hold).not.toBeNull();
    });

    it('sends Ben\'s own words with him as approver, lands his turn, clears the hold and leaves the thread to the desk', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;

        const sent = await call('POST', `/case-files/${id}/answer`, { words: 'Morning Sam, I will take a look and come back to you myself.' }, 'Ben.Real@handyservices.app');
        expect(sent.status).toBe(200);
        expect(sent.json.sent).toMatchObject({ approver: 'human:Ben.Real@handyservices.app' });
        expect(sent.json.sent.bubbles).toEqual(['Morning Sam, I will take a look and come back to you myself.']);
        expect(sent.json.card.held).toBe(false);
        expect(sent.json.release).toMatchObject({ approver: { kind: 'human', id: 'ben' } });

        const detail = await call('GET', `/case-files/${id}`);
        expect(detail.json.hold).toBeNull();
        const last = detail.json.turns[detail.json.turns.length - 1];
        expect(last).toMatchObject({ direction: 'outbound', approver: 'human:Ben.Real@handyservices.app' });
        expect(last.body).toContain('come back to you myself');
        // The board resolves the raw approver login to the staff member's name, for the thread to show.
        expect(detail.json.speakerNames).toEqual({ 'ben.real@handyservices.app': 'Ben Real' });
        expect(cardsOn((await call('GET', '/board?held=true')).json)).toEqual([]);
    });

    it('the desk answers the next customer message itself, the thread back with automation', async () => {
        const next = await call('POST', '/sandbox/message', { text: 'Thanks, it is in the kitchen', channel: 'whatsapp' });
        expect(next.status).toBe(200);
        expect(next.json.plannedSend.approver).toBe('agent.comms_v2');
        expect(next.json.plannedSend.delivered).toBe(true);
    });
});

describe('the board over the live desk\'s store', () => {
    /**
     * While the new desk is the live desk the board reads the live intake's store, not the sandbox
     * door's (api/store.ts). The source is injected: here a second door stands in for the live
     * intake, so the test needs no switch, no database and no delivery.
     */
    it('reads and acts on the store the source names, puts what it changed back to it, answers in its mode, and is 503 when it cannot be opened', async () => {
        const client = new FakeModelClient({
            router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /how much/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'enquiry' }),
            specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking tap' }], jobUnknowns: [], answeredSubjects: [] }),
            composer: () => ({ reply: 'Hi Sam, a leaking tap, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
        });
        const doorDeps = { client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb };
        const sandbox = createSandboxDoor({ ...doorDeps, quietMs: 0 });
        const liveIntake = createSandboxDoor({ ...doorDeps, quietMs: 0 });
        const put: string[] = [];
        let failing = false;
        const modes: string[] = [];
        const listed: ApproverAssignments = { ben: ['user_ben@handyservices.app'] };
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { const email = req.header('x-test-user'); if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' }; next(); });
        app.use('/live-intake', liveIntake.router);
        app.use('/api/comms-v2', createCommsV2ApiRouter(sandbox, async () => listed, async () => {
            if (failing) throw new Error('the intake refuses to start');
            const store = liveIntake.gateway.store;
            const wrapped = Object.assign(Object.create(store), { put: (f: any) => { put.push(f.id); store.put(f); } });
            modes.push('live');
            return { store: wrapped, live: true, mode: 'dry_run' as const };
        }));
        const live = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const root = `http://127.0.0.1:${(live.address() as { port: number }).port}`;
        const req = async (method: string, route: string, body?: unknown, as?: string) => {
            const headers: Record<string, string> = { 'content-type': 'application/json' };
            if (as) headers['x-test-user'] = as;
            const res = await fetch(`${root}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: res.status, json: await res.json() as any };
        };
        try {
            await req('POST', '/api/comms-v2/sandbox/start', { door: 'whatsapp', text: 'A sandbox thread', name: 'Sandy' });
            const started = await req('POST', '/live-intake/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
            await req('POST', '/live-intake/message', { text: 'How much roughly?', channel: 'whatsapp' });
            const id = started.json.state.conversation.id as string;

            const board = await req('GET', '/api/comms-v2/board');
            expect(board.status).toBe(200);
            expect(cardsOn(board.json).map((c) => c.id)).toEqual([id]);
            expect((await req('GET', `/api/comms-v2/case-files/${id}`)).status).toBe(200);

            const released = await req('POST', `/api/comms-v2/case-files/${id}/release`, { words: 'Called them, sorted.' }, 'ben@handyservices.app');
            expect(released.status).toBe(200);
            expect(put).toContain(id);

            put.length = 0;
            const answered = await req('POST', `/api/comms-v2/case-files/${id}/answer`, { words: 'I will be round on Thursday.' }, 'ben@handyservices.app');
            expect(answered.status).toBe(200);
            expect(put).toEqual([id]);
            expect(liveIntake.gateway.store.get(id)!.sends.at(-1)).toMatchObject({ approver: 'human:ben@handyservices.app', mode: 'dry_run' });

            failing = true;
            const refused = await req('GET', '/api/comms-v2/board');
            expect(refused.status).toBe(503);
            expect(refused.json.error).toMatch(/the intake refuses to start/);
            expect(modes.length).toBeGreaterThan(0);
        } finally {
            await new Promise<void>((r) => live.close(() => r()));
        }
    });
});

describe('one tap: send the held draft, and a template send on a shut window', () => {
    // The route calls sendHeldDraft/sendReopenTemplate with no clock override, so the window rule
    // reads the real wall clock: the open fixture's turn has to be recent by it, not by a fixed date.
    const OPEN_AT = new Date().toISOString();
    const STALE_AT = '2020-01-01T10:00:00.000Z';

    function fileWithDraftHold(): CaseFile {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900943', propertyId: null, landlordId: null, name: 'Priya' },
            channel: 'whatsapp', address: '+447700900943',
            firstTurn: { at: OPEN_AT, channel: 'whatsapp', kind: 'text', body: 'How much would a new tap be?', media: [] },
        }, { now: () => new Date(OPEN_AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money', draft: 'Hi Priya, that is usually around £80 fitted.' }, { now: () => new Date(OPEN_AT) });
        return file;
    }

    function fileWithShutWindow(): CaseFile {
        const r = open({
            identity: { ok: true, personId: 'p2', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900944', propertyId: null, landlordId: null, name: 'Dara' },
            channel: 'whatsapp', address: '+447700900944',
            firstTurn: { at: STALE_AT, channel: 'whatsapp', kind: 'text', body: 'Any update on my extractor fan?', media: [] },
        }, { now: () => new Date(STALE_AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: () => new Date(STALE_AT) });
        return file;
    }

    async function harness(sandboxAvailable: () => boolean = () => false, templates?: TemplateStatusSource, priceQueue: () => Promise<PriceQueuePayload> = noPriceQueue) {
        const store = new MemoryCaseFileStore();
        const listed: ApproverAssignments = { ben: ['user_Ben.Real@handyservices.app'] };
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { const email = req.header('x-test-user'); if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' }; next(); });
        const door = createSandboxDoor({ quietMs: 0,
            client: new FakeModelClient({ router: () => ({ subjects: [], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' }), specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] }), composer: () => ({ reply: 'ignored', factIds: [], kbIds: [] }) }),
            fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb,
        });
        app.use('/api/comms-v2', createCommsV2ApiRouter(door, async () => listed, async () => ({ store, live: true, mode: 'dry_run' as const }), undefined, undefined, sandboxAvailable, undefined, templates, priceQueue));
        const srv = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const root = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/comms-v2`;
        const call = async (method: string, route: string, as?: string, body?: unknown) => {
            const headers: Record<string, string> = { 'content-type': 'application/json' };
            if (as) headers['x-test-user'] = as;
            const res = await fetch(`${root}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: res.status, json: await res.json() as any };
        };
        return { store, call, close: () => new Promise<void>((r) => srv.close(() => r())) };
    }

    it('send-held-draft: gates on session and slot the same as release and answer, then sends the draft as-is and clears the hold', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithDraftHold();
            store.put(file);

            expect((await call('POST', `/case-files/${file.id}/send-held-draft`)).status).toBe(401);
            expect((await call('POST', `/case-files/${file.id}/send-held-draft`, 'ben@handyservices.app')).status).toBe(403);
            expect((await call('POST', '/case-files/case_nope/send-held-draft', 'Ben.Real@handyservices.app')).status).toBe(404);

            const sent = await call('POST', `/case-files/${file.id}/send-held-draft`, 'Ben.Real@handyservices.app');
            expect(sent.status).toBe(200);
            expect(sent.json.sent.bubbles).toEqual(['Hi Priya, that is usually around £80 fitted.']);
            expect(sent.json.sent.approver).toBe('human:Ben.Real@handyservices.app');
            expect(sent.json.card.held).toBe(false);

            const detail = await call('GET', `/case-files/${file.id}`);
            expect(detail.json.hold).toBeNull();
            expect(detail.json.turns.at(-1)).toMatchObject({ approver: 'human:Ben.Real@handyservices.app', body: 'Hi Priya, that is usually around £80 fitted.' });
        } finally {
            await close();
        }
    });

    it('send-held-draft: an expectedDraft matching the held draft sends it', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithDraftHold();
            store.put(file);
            const sent = await call('POST', `/case-files/${file.id}/send-held-draft`, 'Ben.Real@handyservices.app', { expectedDraft: 'Hi Priya, that is usually around £80 fitted.' });
            expect(sent.status).toBe(200);
            expect(sent.json.sent.bubbles).toEqual(['Hi Priya, that is usually around £80 fitted.']);
            expect(store.get(file.id)!.hold).toBeNull();
        } finally {
            await close();
        }
    });

    it('send-held-draft: an expectedDraft the held draft no longer matches is refused 409, and nothing is sent', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithDraftHold();
            store.put(file);
            const turnsBefore = file.turns.length;
            const refused = await call('POST', `/case-files/${file.id}/send-held-draft`, 'Ben.Real@handyservices.app', { expectedDraft: 'Hi Priya, an older draft.' });
            expect(refused.status).toBe(409);
            expect(refused.json.error).toBe('the held draft changed since you saw it');
            const after = store.get(file.id)!;
            expect(after.hold?.draft).toBe('Hi Priya, that is usually around £80 fitted.');
            expect(after.turns).toHaveLength(turnsBefore);
            expect(after.sends).toHaveLength(0);

            const badType = await call('POST', `/case-files/${file.id}/send-held-draft`, 'Ben.Real@handyservices.app', { expectedDraft: 42 });
            expect(badType.status).toBe(400);
            expect(store.get(file.id)!.hold).not.toBeNull();
        } finally {
            await close();
        }
    });

    it('send-held-draft: refuses a hold with no draft to send, and sends nothing', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithShutWindow();
            store.put(file);
            const refused = await call('POST', `/case-files/${file.id}/send-held-draft`, 'Ben.Real@handyservices.app');
            expect(refused.status).toBe(409);
            expect(refused.json.error).toMatch(/no held draft/);
            expect(store.get(file.id)!.hold).not.toBeNull();
        } finally {
            await close();
        }
    });

    it('send-template: gates on session and slot the same as release and answer', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithShutWindow();
            store.put(file);
            expect((await call('POST', `/case-files/${file.id}/send-template`)).status).toBe(401);
            expect((await call('POST', `/case-files/${file.id}/send-template`, 'ben@handyservices.app')).status).toBe(403);
            expect((await call('POST', '/case-files/case_nope/send-template', 'Ben.Real@handyservices.app')).status).toBe(404);
        } finally {
            await close();
        }
    });

    it('send-template: with no template actually approved (the real live status, undriveable here without Meta/the database), the card stays held rather than sending an unapproved word', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithShutWindow();
            store.put(file);
            const refused = await call('POST', `/case-files/${file.id}/send-template`, 'Ben.Real@handyservices.app');
            expect(refused.status).toBe(409);
            expect(refused.json.error).toMatch(/no approved template/);
            expect(store.get(file.id)!.hold).not.toBeNull();
        } finally {
            await close();
        }
    });

    it('template-offer: gates on session and slot the same as send-template', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithShutWindow();
            store.put(file);
            expect((await call('GET', `/case-files/${file.id}/template-offer`)).status).toBe(401);
            expect((await call('GET', `/case-files/${file.id}/template-offer`, 'ben@handyservices.app')).status).toBe(403);
            expect((await call('GET', '/case-files/case_nope/template-offer', 'Ben.Real@handyservices.app')).status).toBe(404);
        } finally {
            await close();
        }
    });

    it('template-offer: shows the template and its wording, sends nothing, and the send that follows carries exactly that wording', async () => {
        const reopen: TemplateStatusSource = { async approved(name) { return name === 'answer_ready_reopen_v1' ? { contentSid: 'HX_reopen' } : null; } };
        const { store, call, close } = await harness(undefined, reopen);
        try {
            const file = fileWithShutWindow();
            store.put(file);
            const offer = await call('GET', `/case-files/${file.id}/template-offer`, 'Ben.Real@handyservices.app');
            expect(offer.status).toBe(200);
            expect(offer.json).toMatchObject({ ok: true, template: 'answer_ready_reopen_v1', channel: 'whatsapp' });
            expect(offer.json.body).toMatch(/Dara/);
            expect(store.get(file.id)!.sends).toHaveLength(0);
            expect(store.get(file.id)!.hold).not.toBeNull();

            const sent = await call('POST', `/case-files/${file.id}/send-template`, 'Ben.Real@handyservices.app');
            expect(sent.status).toBe(200);
            expect(sent.json.sent.bubbles).toEqual([offer.json.body]);
        } finally {
            await close();
        }
    });

    it('template-offer: a refusal is the send\'s own words, as a 200 with ok false', async () => {
        const { store, call, close } = await harness();
        try {
            const file = fileWithShutWindow();
            store.put(file);
            const offer = await call('GET', `/case-files/${file.id}/template-offer`, 'Ben.Real@handyservices.app');
            const sent = await call('POST', `/case-files/${file.id}/send-template`, 'Ben.Real@handyservices.app');
            expect(offer.status).toBe(200);
            expect(offer.json.ok).toBe(false);
            expect(offer.json.reason).toMatch(/no approved template/);
            expect(sent.status).toBe(409);
            expect(offer.json.reason).toBe(sent.json.error);

            const open = fileWithDraftHold();
            store.put(open);
            const openOffer = await call('GET', `/case-files/${open.id}/template-offer`, 'Ben.Real@handyservices.app');
            expect(openOffer.json).toEqual({ ok: false, reason: 'the whatsapp window is open; send a freeform reply instead of a template' });
        } finally {
            await close();
        }
    });

    it('/board and /queue tell the viewer whether this session holds a slot, from the same lookup the writes use', async () => {
        const { store, call, close } = await harness();
        try {
            store.put(fileWithDraftHold());
            for (const route of ['/board', '/queue']) {
                expect((await call('GET', route, 'Ben.Real@handyservices.app')).json.viewer).toEqual({ approver: 'ben', canAct: true });
                expect((await call('GET', route, 'ben@handyservices.app')).json.viewer).toEqual({ approver: null, canAct: false });
                expect((await call('GET', route)).json.viewer).toEqual({ approver: null, canAct: false });
            }
            const queue = await call('GET', '/queue', 'Ben.Real@handyservices.app');
            expect(queue.json.items[0]).toMatchObject({ hasDraft: true, holdException: 'money', draft: 'Hi Priya, that is usually around £80 fitted.' });
        } finally {
            await close();
        }
    });

    function priceItem(slug: string, name: string, createdAt: string): PriceQueueItem {
        return {
            slug, quoteId: `q_${slug}`, firstName: name.split(' ')[0], name, postcode: null, customerType: 'homeowner',
            job: 'a new tap', lineCount: 1, createdAt, waitingMs: Date.now() - Date.parse(createdAt), sourceChannel: 'whatsapp',
            signals: { checkThis: 0, unpriced: 1, contradictions: 0, lowConfidence: 0, estimateStatus: 'complete' },
        };
    }

    it('/queue merges the quotes waiting to be priced as ready_to_price items, below every hold, when asked for them', async () => {
        const payload: PriceQueuePayload = {
            count: 2,
            items: [priceItem('oldquote', 'Sam Old', '2019-06-03T09:00:00.000Z'), priceItem('newquote', 'Nia New', new Date().toISOString())],
            oldestWaitingMs: 1, at: new Date().toISOString(),
        };
        const read = vi.fn(async () => payload);
        const { store, call, close } = await harness(undefined, undefined, read);
        try {
            const recent = fileWithDraftHold();
            const stale = fileWithShutWindow();
            store.put(recent);
            store.put(stale);
            const queue = await call('GET', '/queue?readyToPrice=1', 'Ben.Real@handyservices.app');
            expect(queue.status).toBe(200);
            // Both holds first, on their own office clock; then the quotes, the 2019 draft before today's.
            expect(queue.json.items.map((i: any) => i.id)).toEqual([stale.id, recent.id, 'price:oldquote', 'price:newquote']);
            expect(queue.json.items.map((i: any) => i.kind)).toEqual(['held', 'held', 'ready_to_price', 'ready_to_price']);
            expect(queue.json.items[2]).toMatchObject({
                kind: 'ready_to_price', slug: 'oldquote', customerName: 'Sam Old', job: 'a new tap', pricePath: '/admin/price/oldquote',
                createdAt: '2019-06-03T09:00:00.000Z',
            });
            expect(queue.json).not.toHaveProperty('priceQueueError');

            // A mode filter names a case file's mode, which a quote draft has not got, so it reads none.
            read.mockClear();
            const filtered = await call('GET', '/queue?mode=sandbox&readyToPrice=1', 'Ben.Real@handyservices.app');
            expect(filtered.json.items.map((i: any) => i.kind)).toEqual(['held', 'held']);
            expect(read).not.toHaveBeenCalled();
        } finally {
            await close();
        }
    });

    it('/queue reads no quotes at all unless the caller asks for them: the held-count badge poll must cost nothing', async () => {
        const read = vi.fn(async (): Promise<PriceQueuePayload> => ({
            count: 1, items: [priceItem('oldquote', 'Sam Old', '2019-06-03T09:00:00.000Z')], oldestWaitingMs: 1, at: new Date().toISOString(),
        }));
        const { store, call, close } = await harness(undefined, undefined, read);
        try {
            const held = fileWithDraftHold();
            store.put(held);
            const queue = await call('GET', '/queue', 'Ben.Real@handyservices.app');
            expect(queue.status).toBe(200);
            expect(read).not.toHaveBeenCalled();
            expect(queue.json.items.map((i: any) => i.id)).toEqual([held.id]);
            expect(queue.json).not.toHaveProperty('priceQueueError');

            // Anything but the opt-in's own value leaves the route on its cheap in-memory read.
            for (const q of ['?readyToPrice=0', '?readyToPrice=true', '?readyToPrice=']) {
                const other = await call('GET', `/queue${q}`, 'Ben.Real@handyservices.app');
                expect(other.json.items.map((i: any) => i.id)).toEqual([held.id]);
            }
            expect(read).not.toHaveBeenCalled();
        } finally {
            await close();
        }
    });

    it('/queue still returns the holds, and says so, when the price queue read fails', async () => {
        const { store, call, close } = await harness(undefined, undefined, async () => { throw new Error('connection refused'); });
        const errors: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { errors.push(args); };
        try {
            const held = fileWithDraftHold();
            store.put(held);
            const queue = await call('GET', '/queue?readyToPrice=1', 'Ben.Real@handyservices.app');
            expect(queue.status).toBe(200);
            expect(queue.json.items.map((i: any) => i.id)).toEqual([held.id]);
            expect(queue.json.priceQueueError).toBe('Could not load the quotes waiting to be priced');
            expect(errors.some((a) => String(a[1]).includes('connection refused'))).toBe(true);
        } finally {
            console.error = original;
            await close();
        }
    });

    it('/case-files/:id carries the reply channel and window a send from the thread would use', async () => {
        const { store, call, close } = await harness();
        try {
            const shut = fileWithShutWindow();
            const open = fileWithDraftHold();
            store.put(shut);
            store.put(open);
            const shutDetail = (await call('GET', `/case-files/${shut.id}`)).json;
            expect(shutDetail).toMatchObject({ replyChannel: 'whatsapp', replyWindow: { state: 'shut', closesAt: null }, replyRefusal: null });
            const openDetail = (await call('GET', `/case-files/${open.id}`)).json;
            expect(openDetail).toMatchObject({ replyChannel: 'whatsapp', replyWindow: { state: 'open' } });
            expect(Date.parse(openDetail.replyWindow.closesAt)).toBe(Date.parse(OPEN_AT) + 24 * 3_600_000);
        } finally {
            await close();
        }
    });

    it('/board carries sandboxAvailable exactly as the injected check answers, false by default (fail towards hiding)', async () => {
        const { call, close } = await harness();
        try {
            const board = await call('GET', '/board');
            expect(board.json.sandboxAvailable).toBe(false);
        } finally {
            await close();
        }
    });

    it('/board carries sandboxAvailable true only when the check says the sandbox door could write here', async () => {
        const { call, close } = await harness(() => true);
        try {
            const board = await call('GET', '/board');
            expect(board.json.sandboxAvailable).toBe(true);
        } finally {
            await close();
        }
    });
});

describe('Ben closes a file by hand from the board', () => {
    it('refuses without a session, without a slot, and on an unknown file; nothing changes', async () => {
        const start = await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        const id = start.json.state.conversation.id as string;
        assignments = {};
        expect((await call('POST', `/case-files/${id}/close`, {})).status).toBe(401);
        const noSlot = await call('POST', `/case-files/${id}/close`, {}, 'ben@handyservices.app');
        expect(noSlot.status).toBe(403);
        expect(noSlot.json.error).toMatch(/no approver slot/);
        assignments = { ben: ['user_Ben.Real@handyservices.app'] };
        expect((await call('POST', '/case-files/case_nope/close', {}, 'Ben.Real@handyservices.app')).status).toBe(404);
        expect((await call('GET', `/case-files/${id}`)).json.stage).toBe('scoping');
    });

    it('the listed session closes it as done under its own name and words, and a second close is refused', async () => {
        assignments = { ben: ['user_Ben.Real@handyservices.app'] };
        const start = await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        const id = start.json.state.conversation.id as string;
        const ok = await call('POST', `/case-files/${id}/close`, { words: 'Sorted on the phone.' }, 'Ben.Real@handyservices.app');
        expect(ok.json.release).toBeNull();
        expect(ok.status).toBe(200);
        expect(ok.json.card.stage).toBe('done');
        expect(ok.json.change).toMatchObject({ from: 'scoping', to: 'done', approver: 'human:Ben.Real@handyservices.app', words: 'Sorted on the phone.', why: 'closed by hand from the board' });
        expect(ok.json.release).toBeNull();
        const board = await call('GET', '/board');
        expect(board.json.columns.done.map((c: any) => c.id)).toEqual([id]);
        const again = await call('POST', `/case-files/${id}/close`, {}, 'Ben.Real@handyservices.app');
        expect(again.status).toBe(409);
        expect(again.json.error).toMatch(/already done/);
    });

    it('a held file is released by the same rule as a release, then closed; the customer\'s next message opens a new file', async () => {
        assignments = { ben: ['user_Ben.Real@handyservices.app'] };
        await call('POST', '/sandbox/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        const money = await call('POST', '/sandbox/message', { text: 'How much roughly?', channel: 'whatsapp' });
        const id = money.json.state.conversation.id as string;
        const held = (await call('GET', `/case-files/${id}`)).json;
        expect(held.hold).not.toBeNull();

        for (const body of [{}, { words: '' }, { words: '   ' }]) {
            const refused = await call('POST', `/case-files/${id}/close`, body, 'Ben.Real@handyservices.app');
            expect(refused.status).toBe(409);
            expect(refused.json.error).toBe('release needs the approver\'s words');
        }
        const unchanged = (await call('GET', `/case-files/${id}`)).json;
        expect(unchanged.stage).toBe(held.stage);
        expect(unchanged.hold).toEqual(held.hold);

        const ok = await call('POST', `/case-files/${id}/close`, { words: 'Quoted him on the phone.' }, 'Ben.Real@handyservices.app');
        expect(ok.status).toBe(200);
        expect(ok.json.release).toMatchObject({ approver: { kind: 'human', id: 'ben' }, words: 'Quoted him on the phone.' });
        expect(ok.json.change).toMatchObject({ to: 'done', words: 'Quoted him on the phone.' });
        expect(ok.json.card).toMatchObject({ stage: 'done', held: false });
        expect((await call('GET', '/queue')).json.items.map((i: any) => i.id)).not.toContain(id);

        const next = await call('POST', '/sandbox/message', { text: 'Hi, can you also look at a door?', channel: 'whatsapp' });
        expect(next.status).toBe(200);
        expect(next.json.state.conversation.id).not.toBe(id);
        const closed = await call('GET', `/case-files/${id}`);
        expect(closed.json.turns.map((t: any) => t.body)).not.toContain('Hi, can you also look at a door?');
    });
});
