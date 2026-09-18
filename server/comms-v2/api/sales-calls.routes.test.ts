/**
 * The sales-call list and its one-tap close, driven over HTTP the way the Handy Desk drives them.
 *
 * The case that matters most first: a real customer whose call the classifier wrongly marked as a
 * sales call is not closed by the desk. The call goes through the sandbox door's real gateway and
 * desk, the clock passes over it, and the file stays open, sends nothing, and waits on the list for
 * a person; once they write to us it leaves the list for the desk's ordinary path.
 *
 * Then the close: only a signed-in session holding a slot, only while the stored verdicts still make
 * the file a sales call, a standing hold released only with the person's words, and nothing sent.
 */
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { hold as setHold, open, type CaseFile } from '../desk/case-file';
import { noFixedLineSource } from '../desk/fixed-lines';
import { BEN } from '../desk/guards';
import { FakeModelClient } from '../desk/models';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import { MemoryCaseFileStore } from '../desk/store';
import type { ApproverAssignments } from './approvers';
import { createCommsV2ApiRouter } from './routes';
import type { BoardSourceFor } from './store';
import { SALES_CALL_KIND, type ReadCallKinds } from './sales-calls';

const BEN_EMAIL = 'Ben.Real@handyservices.app';
const listed: ApproverAssignments = { ben: [`user_${BEN_EMAIL}`] };
const TRANSCRIPT = 'Caller: Hi, is that the handyman? I have a leaking kitchen tap that needs looking at. Agent: sure, whereabouts are you? Caller: NG7, I will text you a photo.';

function sandboxDoor() {
    return createSandboxDoor({
        quietMs: 0,
        client: new FakeModelClient({
            router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' }),
            specialist: ({ user }) => /Transcript:/.test(user)
                ? { jobPhrase: 'the kitchen tap', jobType: 'leaking tap', location: null, benAskedFor: [], callbackAgreed: false, customerName: null, prefersText: false }
                : { facts: [], jobUnknowns: [], answeredSubjects: [] },
            composer: () => ({ reply: 'A leaking tap, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
        }),
        fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb,
    });
}

let closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.map((c) => c())); closers = []; });

async function harness(opts: { callKinds: ReadCallKinds; store?: MemoryCaseFileStore }) {
    const door = sandboxDoor();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { const email = req.header('x-test-user'); if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' }; next(); });
    const sourceFor: BoardSourceFor | undefined = opts.store ? async () => ({ store: opts.store!, live: true, mode: 'dry_run' as const }) : undefined;
    app.use('/api/comms-v2', createCommsV2ApiRouter(door, async () => listed, sourceFor, undefined, undefined, () => true, undefined, undefined, opts.callKinds));
    const srv = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    closers.push(() => new Promise<void>((r) => srv.close(() => r())));
    const root = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/comms-v2`;
    const call = async (method: string, route: string, body?: unknown, as?: string) => {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (as) headers['x-test-user'] = as;
        const res = await fetch(`${root}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: res.status, json: await res.json() as any };
    };
    return { door, call };
}

/** The classifier's stored verdicts, as the call rows would carry them. */
const stored = (entries: Record<string, string>): ReadCallKinds => async (ids) => new Map(ids.filter((id) => id in entries).map((id) => [id, entries[id]]));

describe('a real customer whose call is wrongly marked as a sales call', () => {
    it('is not closed by the desk: the file stays open through the call and the clock, sends nothing, and waits on the list for a person', async () => {
        const { door, call } = await harness({ callKinds: stored({ call_wrongly_marked: SALES_CALL_KIND }) });
        const started = await call('POST', '/sandbox/start', { door: 'call', outcome: 'answered_inbound', transcript: TRANSCRIPT, name: 'Priya', callId: 'call_wrongly_marked' });
        expect(started.status).toBe(200);
        const [file] = door.gateway.store.all();
        expect(file.turns[0]).toMatchObject({ kind: 'call_transcript', callId: 'call_wrongly_marked' });

        const ran = await call('POST', '/sandbox/run', {});
        expect(ran.status).toBe(200);

        const after = door.gateway.store.get(file.id)!;
        expect(after.stage).not.toBe('done');
        expect(after.stage).not.toBe('booked');
        expect(after.sends).toHaveLength(0);
        expect(after.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);

        // Seen, not hidden: on the list for a person to judge, and on the board in its stage column.
        const list = await call('GET', '/sales-calls');
        expect(list.status).toBe(200);
        expect(list.json.items.map((i: any) => i.id)).toEqual([file.id]);
        expect(list.json.items[0].calls[0].excerpt).toMatch(/leaking kitchen tap/);
        const board = await call('GET', '/board');
        expect(Object.values(board.json.columns as Record<string, any[]>).flat().map((c) => c.id)).toEqual([file.id]);
    });

    it('once they write to us the file leaves the list and the desk answers them as it would anyone', async () => {
        const { door, call } = await harness({ callKinds: stored({ call_wrongly_marked: SALES_CALL_KIND }) });
        await call('POST', '/sandbox/start', { door: 'call', outcome: 'answered_inbound', transcript: TRANSCRIPT, name: 'Priya', callId: 'call_wrongly_marked', seed: { whatsapp: false } });
        const [file] = door.gateway.store.all();
        expect((await call('GET', '/sales-calls')).json.items).toHaveLength(1);

        const texted = await call('POST', '/sandbox/message', { channel: 'sms', text: 'Hi, it was me who rang about the tap, can you come this week?' });
        expect(texted.status).toBe(200);
        expect((await call('GET', '/sales-calls')).json.items).toEqual([]);
        const after = door.gateway.store.get(file.id)!;
        expect(after.stage).not.toBe('done');
        expect(after.turns.some((t) => t.direction === 'outbound')).toBe(true);

        // And a close from a stale list refuses: it is a customer's file now.
        const refused = await call('POST', `/case-files/${file.id}/close-sales-call`, {}, BEN_EMAIL);
        expect(refused.status).toBe(409);
        expect(door.gateway.store.get(file.id)!.stage).not.toBe('done');
    });
});

let seq = 0;
const newId = (prefix: string) => `${prefix}_${++seq}`;
const AT = '2026-09-18T09:00:00.000Z';

function callFile(name: string, callId: string): CaseFile {
    const r = open({
        identity: { ok: true, personId: newId('person'), customerId: null, role: 'homeowner', isNew: true, canonical: `phone:+4477009${String(++seq).padStart(5, '0')}`, propertyId: null, landlordId: null, name },
        channel: 'call', address: '+447700900222',
        firstTurn: { at: AT, channel: 'call', kind: 'call_transcript', body: `[call: they rang us and were answered, 1 min]\nCaller: we sell SEO packages for trades, can I speak to the owner?`, media: [], callId },
    }, { now: () => new Date(AT), newId });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('the sales-call list and Needs you', () => {
    it('a held sales call is on the list and not in Needs you; a customer\'s hold stays in Needs you', async () => {
        const store = new MemoryCaseFileStore();
        const sales = callFile('Agency', 'call_sales');
        setHold(sales, { approver: BEN, reason: 'customer may have asked to stop on a call; check and record the opt-out' }, { now: () => new Date(AT) });
        const customer = callFile('Customer', 'call_customer');
        setHold(customer, { approver: BEN, reason: 'money question' }, { now: () => new Date(AT) });
        store.put(sales); store.put(customer);
        const { call } = await harness({ store, callKinds: stored({ call_sales: SALES_CALL_KIND, call_customer: 'job_enquiry' }) });

        expect((await call('GET', '/queue')).json.items.map((i: any) => i.id)).toEqual([customer.id]);
        const list = await call('GET', '/sales-calls');
        expect(list.json.items.map((i: any) => i.id)).toEqual([sales.id]);
        expect(list.json.items[0]).toMatchObject({ held: true, holdReason: expect.stringMatching(/opt-out/) });
    });

    it('a fault reading the verdicts leaves every file in Needs you and says so on the list, never an empty list', async () => {
        const store = new MemoryCaseFileStore();
        const sales = callFile('Agency', 'call_sales');
        setHold(sales, { approver: BEN, reason: 'a hold' }, { now: () => new Date(AT) });
        store.put(sales);
        const { call } = await harness({ store, callKinds: async () => { throw new Error('database unreachable'); } });

        expect((await call('GET', '/queue')).json.items.map((i: any) => i.id)).toEqual([sales.id]);
        expect((await call('GET', '/sales-calls')).status).toBe(503);
        expect((await call('POST', `/case-files/${sales.id}/close-sales-call`, { words: 'a sales call' }, BEN_EMAIL)).status).toBe(503);
        expect(store.get(sales.id)!.stage).not.toBe('done');
    });
});

describe('one-tap close', () => {
    it('only a signed-in session with a slot closes it; it goes to done under their name and nothing is sent', async () => {
        const store = new MemoryCaseFileStore();
        const sales = callFile('Agency', 'call_sales');
        store.put(sales);
        const { call } = await harness({ store, callKinds: stored({ call_sales: SALES_CALL_KIND }) });

        expect((await call('POST', `/case-files/${sales.id}/close-sales-call`)).status).toBe(401);
        expect((await call('POST', `/case-files/${sales.id}/close-sales-call`, {}, 'someone@handyservices.app')).status).toBe(403);
        expect((await call('POST', '/case-files/case_nope/close-sales-call', {}, BEN_EMAIL)).status).toBe(404);
        expect(store.get(sales.id)!.stage).not.toBe('done');

        const closed = await call('POST', `/case-files/${sales.id}/close-sales-call`, {}, BEN_EMAIL);
        expect(closed.status).toBe(200);
        const after = store.get(sales.id)!;
        expect(after.stage).toBe('done');
        expect(after.stageHistory.at(-1)).toMatchObject({ to: 'done', approver: `human:${BEN_EMAIL}`, why: expect.stringMatching(/sales-call list/) });
        expect(after.sends).toHaveLength(0);
        expect(after.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
        expect((await call('GET', '/sales-calls')).json.items).toEqual([]);
    });

    it('a file whose call is marked anything but sales is refused and left open', async () => {
        const store = new MemoryCaseFileStore();
        const customer = callFile('Customer', 'call_customer');
        store.put(customer);
        const { call } = await harness({ store, callKinds: stored({ call_customer: 'job_enquiry' }) });
        expect((await call('POST', `/case-files/${customer.id}/close-sales-call`, {}, BEN_EMAIL)).status).toBe(409);
        expect(store.get(customer.id)!.stage).not.toBe('done');
    });

    it('a held sales call closes only with the person\'s words, which release the hold; nothing is sent', async () => {
        const store = new MemoryCaseFileStore();
        const sales = callFile('Agency', 'call_sales');
        setHold(sales, { approver: BEN, reason: 'a hold' }, { now: () => new Date(AT) });
        store.put(sales);
        const { call } = await harness({ store, callKinds: stored({ call_sales: SALES_CALL_KIND }) });

        expect((await call('POST', `/case-files/${sales.id}/close-sales-call`, {}, BEN_EMAIL)).status).toBe(409);
        expect(store.get(sales.id)!.hold).not.toBeNull();

        const closed = await call('POST', `/case-files/${sales.id}/close-sales-call`, { words: 'Listened to it: SEO agency.' }, BEN_EMAIL);
        expect(closed.status).toBe(200);
        const after = store.get(sales.id)!;
        expect(after.stage).toBe('done');
        expect(after.hold).toBeNull();
        expect(after.sends).toHaveLength(0);
    });
});
