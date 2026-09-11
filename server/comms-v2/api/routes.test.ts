/**
 * Goal 2 - the board API driven the way the page drives it: a thread started through the mounted
 * sandbox door shows on the board (the door replaces its gateway on every start, so the board must
 * read the live one), a money turn holds it for ben, and release is by the signed-in session only,
 * and only when the comms_v2_approvers row lists that session for the slot.
 *
 * Then the answer half: Ben writes the reply himself and it goes out through the desk's one sender
 * with him as approver, recorded as human-authored with the guards not applied, lands on the file
 * as his turn, clears the hold and hands the thread back to the desk; the same session rules gate
 * it as they gate release.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import type { ApproverAssignments } from './approvers';
import { createCommsV2ApiRouter } from './routes';

let server: import('node:http').Server;
let base: string;
let assignments: ApproverAssignments = {};

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
        if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' };
        next();
    });
    app.use('/api/comms-v2', createCommsV2ApiRouter(door, async () => assignments));
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
        expect(sent.json.sent).toMatchObject({ approver: 'human:ben', author: 'human', guards: 'not_applied' });
        expect(sent.json.sent.bubbles).toEqual(['Morning Sam, I will take a look and come back to you myself.']);
        expect(sent.json.card.held).toBe(false);
        expect(sent.json.release).toMatchObject({ approver: { kind: 'human', id: 'ben' } });

        const detail = await call('GET', `/case-files/${id}`);
        expect(detail.json.hold).toBeNull();
        const last = detail.json.turns[detail.json.turns.length - 1];
        expect(last).toMatchObject({ direction: 'outbound', approver: 'human:ben' });
        expect(last.body).toContain('come back to you myself');
        expect(cardsOn((await call('GET', '/board?held=true')).json)).toEqual([]);
    });

    it('the desk answers the next customer message itself, the thread back with automation', async () => {
        const next = await call('POST', '/sandbox/message', { text: 'Thanks, it is in the kitchen', channel: 'whatsapp' });
        expect(next.status).toBe(200);
        expect(next.json.plannedSend.approver).toBe('agent.comms_v2');
        expect(next.json.plannedSend.delivered).toBe(true);
    });
});
