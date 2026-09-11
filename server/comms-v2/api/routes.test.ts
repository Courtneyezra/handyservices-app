/**
 * Goal 2 - the board API driven the way the page drives it: a thread started through the mounted
 * sandbox door shows on the board (the door replaces its gateway on every start, so the board must
 * read the live one), a money turn holds it for ben, and release is by the signed-in session only.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import { createCommsV2ApiRouter } from './routes';

let server: import('node:http').Server;
let base: string;

beforeAll(async () => {
    const client = new FakeModelClient({
        router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /how much/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'enquiry' }),
        specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking tap' }], jobUnknowns: [], answeredSubjects: [] }),
        composer: () => ({ reply: 'Hi Sam, a leaking tap, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
    });
    const door = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const email = req.header('x-test-user');
        if (email) (req as any).user = { id: `user_${email}`, email, role: email.startsWith('ben') ? 'admin' : 'va' };
        next();
    });
    app.use('/api/comms-v2', createCommsV2ApiRouter(door));
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
        expect(cardsOn(held.json)[0]).toMatchObject({ held: true, holdApprover: 'ben', lastCustomerMessage: 'How much roughly?' });

        const detail = await call('GET', `/case-files/${id}`);
        expect(detail.json.hold).toMatchObject({ approver: { kind: 'human', id: 'ben' } });
        expect(detail.json).not.toHaveProperty('ledger');
        expect(detail.json).not.toHaveProperty('sends');
    });

    it('a session that is not the hold approver cannot release, even naming ben in the body', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;

        const anonymous = await call('POST', `/case-files/${id}/release`, { words: 'fine' });
        expect(anonymous.status).toBe(401);

        const va = await call('POST', `/case-files/${id}/release`, { approver: 'ben', words: 'Checked, all fine' }, 'va@handyservices.app');
        expect(va.status).toBe(409);
        expect(va.json.error).toMatch(/only ben may release/);

        const still = await call('GET', '/board?held=true');
        expect(cardsOn(still.json).map((c) => c.id)).toEqual([id]);
    });

    it('ben\'s session releases with the words recorded, and the card leaves the held filter', async () => {
        const board = await call('GET', '/board?held=true');
        const id = cardsOn(board.json)[0].id as string;

        const noWords = await call('POST', `/case-files/${id}/release`, { words: '   ' }, 'ben@handyservices.app');
        expect(noWords.status).toBe(409);

        const ok = await call('POST', `/case-files/${id}/release`, { words: 'Spoke to the customer, resolved.' }, 'ben@handyservices.app');
        expect(ok.status).toBe(200);
        expect(ok.json.release).toMatchObject({ approver: { kind: 'human', id: 'ben' }, words: 'Spoke to the customer, resolved.' });
        expect(ok.json.card.held).toBe(false);

        const held = await call('GET', '/board?held=true');
        expect(cardsOn(held.json)).toEqual([]);
        const detail = await call('GET', `/case-files/${id}`);
        expect(detail.json.hold).toBeNull();
    });
});
