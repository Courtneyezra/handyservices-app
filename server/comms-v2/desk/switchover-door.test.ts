/**
 * The switch-over's live test surface on the sandbox door, driven over HTTP the way the pipeline's
 * test step drives it:
 *
 *   `POST /run { live: true }` runs a clock pass with the desk in live mode through the real live
 *   deliverer: a due chase to Ben and a due escalation to the owner are each stopped at the new
 *   desk's own switch, labelled and recorded under their own purpose, and nothing is sent. The door
 *   refuses the live pass anywhere it could reach a person (answer 48).
 *
 *   A form posted with the web form's own photo shape takes the server-side checks POST /api/leads
 *   takes: too many, too large, a non-image labelled as an image, and a valid photo (answer 50).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ db: {}, pool: {} }));

import { useProcessLocalSpineConfig, _resetSpineConfigForTests } from '../../spine/config';
import { noFixedLineSource } from './fixed-lines';
import { FakeModelClient } from './models';
import { createSandboxDoor, doorLiveRunRefusal } from './sandbox-door';
import { emptyKb } from './scoping-tools';
import { CHASE_TEMPLATES, createChaseState } from '../service/chase';
import { MAX_PHOTO_BYTES } from '../channels/media';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';

let server: import('node:http').Server;
let base: string;
let dir: string;
const sent: unknown[] = [];

const approved = { async approved(name: string) { return name === CHASE_TEMPLATES.approver_chase.name || name === CHASE_TEMPLATES.owner_escalation.name ? { contentSid: `HX_${name}` } : null; } };

function doorApp(liveRunGate?: () => Promise<string | null>) {
    const client = new FakeModelClient({
        router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /how much/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'enquiry' }),
        specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking tap' }], jobUnknowns: [], answeredSubjects: [] }),
        composer: () => ({ reply: 'Hi Sam, a leaking tap, got it.\n\nWhereabouts are you?', factIds: [], kbIds: [] }),
    });
    const store = new MemoryQuoteStore();
    const { router } = createSandboxDoor({ quietMs: 0,
        client, fixedLines: noFixedLineSource, templates: approved, kb: emptyKb, mediaDir: dir,
        scoping: { describe: async () => ({ ok: true, description: 'a dripping tap', confidence: 'high', model: 'fake-vision', usage: null, durationMs: 1 }) },
        quoting: { store, drafter: new FakeDrafter(store), notifier: recordingNotifier },
        ...(liveRunGate ? { liveRunGate } : {}),
    });
    const app = express();
    app.use(express.json({ limit: '12mb' }));
    app.use('/door', router);
    return app;
}

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-switchover-'));
    // The new desk's sender switch at its default, off: the live deliverer is the real one.
    useProcessLocalSpineConfig({});
    vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: unknown) => { sent.push(i); return { ok: true, sid: 'SM_never', attempts: [], fellBack: false }; } }));
    const app = express();
    app.use('/gated', doorApp(async () => null));
    app.use('/default', doorApp());
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
    _resetSpineConfigForTests();
    vi.doUnmock('../../outbound');
});

async function call(method: string, route: string, body?: unknown) {
    const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
}

describe('POST /run { live: true }: chases and escalations in live mode, never sent', () => {
    it('Ben\'s chase goes to the real live deliverer, is stopped at the new desk\'s own switch, and is recorded as a chase under its own label', async () => {
        await call('POST', '/gated/door/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        const held = await call('POST', '/gated/door/message', { text: 'How much roughly?', channel: 'whatsapp' });
        expect(held.json.state.caseFile.hold).not.toBeNull();
        await call('POST', '/gated/door/chase-intervals', { chaseAfterMinutes: 1, escalateAfterMinutes: 2 });
        await call('POST', '/gated/door/age', { hours: 0.05 });

        const run = await call('POST', '/gated/door/run', { live: true });
        expect(run.status).toBe(200);
        expect(run.json).toMatchObject({ live: true, chase: { action: 'refused', purpose: 'approver_chase' } });
        expect(run.json.chase.reason).toMatch(/spine\.senders\.comms_v2\.enabled is not true/);
        const record = (await call('GET', '/gated/door/chase')).json.record;
        expect(record.attempts[0]).toMatchObject({ purpose: 'approver_chase', ok: false, mode: 'live', label: { purpose: 'marketing', context: 'comms_v2:approver_chase' } });
        // The replies on the thread spent their own run ids; a refused chase spends none.
        expect(run.json.state.caseFile.sentRunIds.filter((id: string) => id.startsWith('chase_'))).toEqual([]);
        expect(sent).toEqual([]);
    });

    it('the owner\'s escalation, once Ben has been chased, is stopped at the same switch and recorded as an escalation', async () => {
        expect((await call('POST', '/gated/door/run', {})).json.chase).toMatchObject({ action: 'chased' });
        await call('POST', '/gated/door/age', { hours: 0.06 });
        const run = await call('POST', '/gated/door/run', { live: true });
        expect(run.json.chase).toMatchObject({ action: 'refused', purpose: 'owner_escalation' });
        const record = (await call('GET', '/gated/door/chase')).json.record;
        expect(record.attempts.at(-1)).toMatchObject({ purpose: 'owner_escalation', ok: false, mode: 'live', label: { purpose: 'marketing', context: 'comms_v2:owner_escalation' } });
        expect(run.json.plannedSend.delivered).toBe(false);
        expect(sent).toEqual([]);
    });

    it('is refused anywhere a live pass could reach a person: off the branch database, on a live desk, with the sender switch on, or to anyone but the drama numbers', async () => {
        await call('POST', '/default/door/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam' });
        const refused = await call('POST', '/default/door/run', { live: true });
        expect(refused.status).toBe(409);
        expect(refused.json.error).toMatch(/branch database/);

        const branch = { COMMS_V2_DATABASE_URL: 'postgres://u:p@ep-branch.example.neon.tech/db', DATABASE_URL: 'postgres://u:p@ep-branch.example.neon.tech/db' } as NodeJS.ProcessEnv;
        const drama = createChaseState({ ben: { address: '+447700900901', name: 'Ben' }, owner: { address: '+447700900902', name: null } });
        expect(await doorLiveRunRefusal(drama, branch)).toBeNull();
        expect(await doorLiveRunRefusal(createChaseState({ ben: { address: '+447911123456', name: 'Ben' }, owner: { address: '+447700900902', name: null } }), branch)).toMatch(/drama numbers/);
        useProcessLocalSpineConfig({ senders: { comms_v2: { enabled: true } } });
        expect(await doorLiveRunRefusal(drama, branch)).toMatch(/would really send/);
        useProcessLocalSpineConfig({ commsDesk: 'comms_v2', senders: { comms_v2: { enabled: true } } });
        expect(await doorLiveRunRefusal(drama, { ...branch, COMMS_V2_INTAKE: '1', COMMS_WORKER: '1' })).toMatch(/is the live desk/);
        useProcessLocalSpineConfig({});
    });
});

describe('the web form\'s server-side photo checks, through the form door', () => {
    const jpeg = (size = 64) => { const b = Buffer.alloc(size, 0x11); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; return b; };
    const photo = (bytes: Buffer, mime = 'image/jpeg') => ({ contentBase64: bytes.toString('base64'), mime });
    const form = (photos: unknown[]) => call('POST', '/gated/door/start', { door: 'form', text: 'Bathroom tap dripping', name: 'Priya K', postcode: 'NG9 2AB', seed: { whatsapp: false }, photos });

    it('too many: the first four are kept and the rest refused', async () => {
        const r = await form(Array.from({ length: 5 }, () => photo(jpeg())));
        expect(r.status).toBe(200);
        expect(r.json.media).toHaveLength(4);
        expect(r.json.mediaFailures).toEqual([{ ref: '(photo)', reason: 'too many photos (5), kept the first 4' }]);
    });

    it('too large: refused before anything is written', async () => {
        const r = await form([photo(jpeg(MAX_PHOTO_BYTES + 1))]);
        expect(r.json.media).toEqual([]);
        expect(r.json.mediaFailures[0].reason).toMatch(/photo too large/);
    });

    it('a non-image labelled as an image: refused by its bytes, whatever the label says', async () => {
        const r = await form([photo(Buffer.from('this is not a photo at all'), 'image/jpeg')]);
        expect(r.json.media).toEqual([]);
        expect(r.json.mediaFailures[0].reason).toMatch(/not a recognised image/);
    });

    it('a valid photo: kept, typed by its bytes, on the turn', async () => {
        const r = await form([photo(jpeg(), 'image/png')]);
        expect(r.json.mediaFailures).toEqual([]);
        expect(r.json.media).toEqual([expect.objectContaining({ kind: 'image', mime: 'image/jpeg' })]);
    });
});
