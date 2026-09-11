/**
 * Goal 6's door actions over HTTP: "Ben replies" lands his words, releases the hold and the
 * next turn is automated; the chase intervals take test values and a clock pass after aging chases
 * Ben then the owner; GET /chase shows the ledger; the fixture is refused without a database.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { plannedSendOfResponse } from '../desk/planned-send';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { CHASE_TEMPLATES } from './chase';

let server: import('node:http').Server;
let base: string;
const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };

beforeAll(async () => {
    const client = new FakeModelClient({
        router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /rubbish/i.test(user.split('>>').pop() ?? '') ? 'complaint' : null, turnKind: 'enquiry' }),
        specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking tap' }], jobUnknowns: [], answeredSubjects: [] }),
        composer: () => ({ reply: 'Got it, thanks.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
    });
    const templates = { async approved(name: string) { return name === CHASE_TEMPLATES.approver_chase.name || name === CHASE_TEMPLATES.owner_escalation.name ? { contentSid: `HX_${name}` } : null; } };
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates, kb: emptyKb, now: () => new Date(clock.t += 1000), scoping: { describe: async () => ({ ok: false, reason: 'none' }) } });
    const app = express();
    app.use(express.json());
    app.use('/api/comms-v2-sandbox', router);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/comms-v2-sandbox`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function call(method: 'POST' | 'GET', route: string, body?: unknown) {
    const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
    return { status: res.status, json: await res.json() as any };
}

describe('Goal 6 on the door', () => {
    it('refuses Ben\'s reply with no thread, and empty words', async () => {
        await call('POST', '/reset');
        expect((await call('POST', '/ben-replies', { text: 'hi' })).status).toBe(409);
        await call('POST', '/start', { door: 'whatsapp', text: 'Your last job was rubbish', name: 'Sam' });
        expect((await call('POST', '/ben-replies', { text: '  ' })).status).toBe(400);
    });
    it('a complaint sits with Ben, the state says so, and the chase intervals take test values', async () => {
        const st = await call('GET', '/');
        expect(st.json.automation).toMatchObject({ state: 'with_approver', approver: 'ben' });
        expect(st.json.messages.map((m: any) => m.content)).toEqual(['Your last job was rubbish', DEFAULT_FIXED_LINES.complaint]);
        expect((await call('POST', '/chase-intervals', { chaseAfterMinutes: 0, escalateAfterMinutes: 5 })).status).toBe(400);
        const set = await call('POST', '/chase-intervals', { chaseAfterMinutes: 30, escalateAfterMinutes: 60 });
        expect(set.json).toMatchObject({ ok: true, intervals: { chaseAfterMinutes: 30, escalateAfterMinutes: 60 }, recipients: { ben: { address: '+447700900901' }, owner: { address: '+447700900902' } } });
    });
    it('a clock pass chases Ben once the hold is old enough, then the owner, and never the customer', async () => {
        const early = await call('POST', '/run');
        expect(early.json.chase.action).toBe('none');
        expect(plannedSendOfResponse(early.json).delivered).toBe(false);
        clock.t += 31 * 60_000;
        const chased = await call('POST', '/run');
        expect(chased.json.chase.action).toBe('chased');
        expect(chased.json.chase.send).toMatchObject({ templateId: 'desk_approver_chase_v1', to: { address: '+447700900901' }, approver: 'agent.comms_v2' });
        expect(plannedSendOfResponse(chased.json).delivered).toBe(false);
        expect(chased.json.state.messages).toHaveLength(2);
        clock.t += 61 * 60_000;
        const escalated = await call('POST', '/run');
        expect(escalated.json.chase.action).toBe('escalated');
        expect(escalated.json.chase.send.to.address).toBe('+447700900902');
        const ledger = await call('GET', '/chase');
        expect(ledger.json.record.attempts).toHaveLength(2);
        expect(ledger.json.automation.state).toBe('with_approver');
    });
    it('Ben replies: his words land on the thread with a human approver, the hold is released, the chase is cleared, and the next turn is automated', async () => {
        const ben = await call('POST', '/ben-replies', { text: 'Sorry Sam, I will come and put that right.', surface: 'kanban' });
        expect(ben.status).toBe(200);
        expect(ben.json).toMatchObject({ event: 'return_to_automation', approver: 'human:ben', surface: 'kanban', automation: { state: 'automated' } });
        expect(ben.json.released.words).toMatch(/put that right/);
        expect(ben.json.state.messages.pop()).toMatchObject({ direction: 'outbound', content: 'Sorry Sam, I will come and put that right.' });
        expect((await call('GET', '/chase')).json.record).toBeNull();
        const next = await call('POST', '/message', { text: 'Thanks Ben', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(next.json);
        expect(ps.delivered).toBe(true);
        expect(ps.hold).toBeNull();
        expect(ps.bubbles[0]).toMatch(/Got it/);
    });
    it('the fixture refuses to run without the branch database', async () => {
        const r = await call('POST', '/fixture');
        expect(r.status).toBe(500);
        expect(String(r.json.error)).toBeTruthy();
    });
});
