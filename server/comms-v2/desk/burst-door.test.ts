/**
 * A burst on the sandbox door (checklist cross-cutting 2 and 2.8): three WhatsApp messages sent
 * together are one customer turn, so the desk replies once, reading all three. Messages that each
 * wait for the reply before the next are three turns, and each is answered.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noFixedLineSource } from './fixed-lines';
import { FakeModelClient } from './models';
import { plannedSendOfResponse } from './planned-send';
import { createSandboxDoor } from './sandbox-door';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';

let server: import('node:http').Server;
let base: string;
let client: FakeModelClient;

beforeAll(async () => {
    client = new FakeModelClient({
        router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer' }),
        specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] }),
        composer: () => ({ reply: 'Thanks Sam, that is all noted.', factIds: [], kbIds: [] }),
    });
    const store = new MemoryQuoteStore();
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, quietMs: 300, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store, drafter: new FakeDrafter(store), notifier: recordingNotifier } });
    const app = express();
    app.use(express.json());
    app.use('/door', router);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/door`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function post(route: string, body: unknown) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
}

const replies = (state: any) => state.messages.filter((m: any) => m.direction === 'outbound');
const composerCalls = () => client.calls.filter((c) => c.role === 'composer');

describe('a burst of messages on the sandbox door', () => {
    it('three WhatsApp messages sent together draw one reply, composed once from all three', async () => {
        const opened = await post('/start', { door: 'whatsapp', text: 'Hi, my kitchen tap is dripping', name: 'Sam' });
        expect(opened.status).toBe(200);
        expect(replies(opened.json.state)).toHaveLength(1);
        const composedBefore = composerCalls().length;

        const burst = ['it is the mixer tap', 'dripping at the base', 'been going a week'];
        const out = await Promise.all(burst.map((text) => post('/message', { text, channel: 'whatsapp' })));

        expect(out.map((r) => r.status)).toEqual([200, 200, 200]);
        const state = (await (await fetch(base)).json()) as any;
        expect(state.messages.map((m: any) => m.direction)).toEqual(['inbound', 'outbound', 'inbound', 'inbound', 'inbound', 'outbound']);
        expect(composerCalls().length - composedBefore).toBe(1);
        const marked = composerCalls().at(-1)!.user.split('\n').filter((l) => l.startsWith('>> ')).join('\n');
        for (const text of burst) expect(marked).toContain(text);

        const sends = out.map((r) => plannedSendOfResponse(r.json));
        expect(sends.filter((s) => s.delivered)).toHaveLength(1);
        expect(new Set(sends.map((s) => s.runId)).size).toBe(1);
        for (const r of out) expect(r.json.burst.turnIds).toHaveLength(3);
        expect(sends.filter((s) => !s.delivered).every((s) => /one customer turn/.test(s.evidence.note ?? ''))).toBe(true);
        expect(sends.find((s) => s.delivered)!.guards.one_reply.result).toBe('pass');
    });

    it('messages that each wait for the reply are separate turns, and each is answered', async () => {
        const before = replies((await (await fetch(base)).json()) as any).length;
        for (const text of ['one more thing', 'the tap is a Bristan']) {
            const r = await post('/message', { text, channel: 'whatsapp' });
            expect(plannedSendOfResponse(r.json).delivered).toBe(true);
            expect(r.json.burst.turnIds).toHaveLength(1);
        }
        const state = (await (await fetch(base)).json()) as any;
        expect(replies(state).length - before).toBe(2);
    });

    it('a burst whose last message is STOP draws no reply and no model call, though the joined text is no whole-message keyword', async () => {
        const opened = await post('/start', { door: 'whatsapp', text: 'Hi, is that the handyman?', name: 'Sam' });
        expect(replies(opened.json.state)).toHaveLength(1);
        const callsBefore = client.calls.length;

        const out = await Promise.all(['Sorry wrong number', 'STOP'].map((text) => post('/message', { text, channel: 'whatsapp' })));

        expect(out.map((r) => r.status)).toEqual([200, 200]);
        for (const r of out) expect(r.json.burst.turnIds).toHaveLength(2);
        expect(out.map((r) => plannedSendOfResponse(r.json)).some((s) => s.delivered)).toBe(false);
        expect(client.calls.length).toBe(callsBefore);
        const state = (await (await fetch(base)).json()) as any;
        expect(replies(state)).toHaveLength(1);
    });
});
