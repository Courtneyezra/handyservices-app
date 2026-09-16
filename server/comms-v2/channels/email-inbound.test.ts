/**
 * The inbound email webhook: signed by Resend (Svix), off unless both switches say '1', mounted
 * outside the admin gate with its body kept raw. A good signature lands one turn; a bad, missing or
 * stale one lands nothing; a replay of a delivery already taken lands nothing more. An accepted
 * email is kept before Resend is answered, and a store that cannot keep it is answered with an error.
 */
import http from 'node:http';
import express from 'express';
import { Webhook } from 'svix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboundEnvelope } from './envelope';
import { EMAIL_INBOUND_ENV, emailInboundEnabled, mountResendInbound, RESEND_INBOUND_PATH, RESEND_INBOUND_SECRET_ENV, resendInboundRawBody, resendInboundRouter, runInboundEmailRetryTick, SeenKeys, type EmailInboundDeps } from './email-inbound';
import { inboundEmailQueue, MemoryInboundEmailRows, RETRY_DELAYS_MS } from './inbound-email-store';
import { envelopeFromResend, type ResendInboundDeps } from './resend-inbound';

vi.mock('../../db', () => ({ db: {} }));

const SECRET = `whsec_${Buffer.from('synthetic-signing-secret-for-tests').toString('base64')}`;
const OTHER_SECRET = `whsec_${Buffer.from('some-other-endpoint-secret').toString('base64')}`;
const ON: NodeJS.ProcessEnv = { COMMS_V2_INTAKE: '1', [EMAIL_INBOUND_ENV]: '1', [RESEND_INBOUND_SECRET_ENV]: SECRET, RESEND_API_KEY: 're_test_key' };

/** Resend's documented `email.received` event, with synthetic addresses. */
function receivedEvent(emailId = '56761188-7520-42d8-8898-ff6fc54ce618') {
    return {
        type: 'email.received',
        created_at: '2026-09-16T09:12:43.126Z',
        data: {
            email_id: emailId,
            created_at: '2026-09-16T09:12:42.894Z',
            from: 'Sam Jones <sam.jones@example.com>',
            to: ['bookings@handyservices.example'],
            bcc: [],
            cc: [],
            received_for: ['bookings@handyservices.example'],
            message_id: '<CAF3x9@mail.example.com>',
            subject: 'Leaking tap',
            attachments: [{ id: '2a0c9ce0-3112-4728-976e-47ddcd16a318', filename: 'leak.png', content_type: 'image/png', content_disposition: 'attachment', content_id: null }],
        },
    };
}

function signed(body: string, opts: { secret?: string; id?: string; at?: Date } = {}): Record<string, string> {
    const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`;
    const at = opts.at ?? new Date();
    return { 'svix-id': id, 'svix-timestamp': String(Math.floor(at.getTime() / 1000)), 'svix-signature': new Webhook(opts.secret ?? SECRET).sign(id, at, body) };
}

const envelope: InboundEnvelope = { channel: 'email', address: 'sam.jones@example.com', name: 'Sam Jones', text: 'Subject: Leaking tap\n\nIt drips.', media: [], at: '2026-09-16T09:12:42.674Z', providerMessageId: '<CAF3x9@mail.example.com>', via: 'resend', mediaFailures: [], kind: 'text', email: { subject: 'Leaking tap', messageId: '<CAF3x9@mail.example.com>', references: ['<CAF3x9@mail.example.com>'] } };

let server: http.Server | null = null;
afterEach(() => { server?.close(); server = null; });

const RECEIVED_ID = '56761188-7520-42d8-8898-ff6fc54ce618';

/** A store in memory whose hand-over to the desk is a spy. */
function memoryQueue(rows = new MemoryInboundEmailRows()) {
    const handOver = vi.fn(async (_id: string, _e: InboundEnvelope) => {});
    return { rows, handOver, queue: inboundEmailQueue({ rows: async () => rows, handOver, pageable: false }) };
}

/** The app as index.ts builds it: raw parser on the path, the global JSON parser, then the router. */
async function start(deps: Partial<EmailInboundDeps> & { env?: NodeJS.ProcessEnv; rows?: MemoryInboundEmailRows } = {}) {
    const build = vi.fn(async (_id: string, _d: { apiKey: string }) => envelope);
    const { rows, handOver: forward, queue } = memoryQueue(deps.rows);
    const app = express();
    app.use(RESEND_INBOUND_PATH, resendInboundRawBody());
    app.use(express.json());
    app.use(resendInboundRouter({ env: ON, envelope: build, queue, ...deps }));
    server = http.createServer(app);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const post = async (body: string, headers: Record<string, string>) => {
        const res = await fetch(`http://127.0.0.1:${port}${RESEND_INBOUND_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
        return { status: res.status, json: await res.json() as Record<string, unknown> };
    };
    return { post, build, forward, rows };
}

describe('the switch', () => {
    it('is on only with its own switch and the intake switch, each exactly 1', () => {
        expect(emailInboundEnabled({})).toBe(false);
        expect(emailInboundEnabled({ [EMAIL_INBOUND_ENV]: '1' })).toBe(false);
        expect(emailInboundEnabled({ COMMS_V2_INTAKE: '1' })).toBe(false);
        expect(emailInboundEnabled({ COMMS_V2_INTAKE: '1', [EMAIL_INBOUND_ENV]: 'true' })).toBe(false);
        expect(emailInboundEnabled({ COMMS_V2_INTAKE: '1', [EMAIL_INBOUND_ENV]: ' 1 ' })).toBe(true);
    });

    it('off, accepts nothing even with a good signature, and reads nothing', async () => {
        for (const env of [{ ...ON, [EMAIL_INBOUND_ENV]: undefined }, { ...ON, COMMS_V2_INTAKE: '0' }]) {
            const { post, build, forward } = await start({ env });
            const body = JSON.stringify(receivedEvent());
            const res = await post(body, signed(body));
            expect(res.status).toBe(404);
            expect(String(res.json.error)).toMatch(/inbound email is off/);
            expect(build).not.toHaveBeenCalled();
            expect(forward).not.toHaveBeenCalled();
            server?.close();
        }
    });

    it('accepts nothing without the signing secret or the API key', async () => {
        for (const missing of [RESEND_INBOUND_SECRET_ENV, 'RESEND_API_KEY']) {
            const { post, build } = await start({ env: { ...ON, [missing]: '' } });
            const body = JSON.stringify(receivedEvent());
            const res = await post(body, signed(body));
            expect(res.status).toBe(503);
            expect(String(res.json.error)).toContain(missing);
            expect(build).not.toHaveBeenCalled();
            server?.close();
        }
    });
});

describe('the signature', () => {
    it('good: the email is read with the API key and one turn is forwarded', async () => {
        const { post, build, forward } = await start();
        const body = JSON.stringify(receivedEvent());
        const res = await post(body, signed(body));
        expect(res).toEqual({ status: 200, json: { ok: true, accepted: true, media: 0, mediaFailures: 0 } });
        expect(build).toHaveBeenCalledTimes(1);
        expect(build.mock.calls[0][0]).toBe('56761188-7520-42d8-8898-ff6fc54ce618');
        expect(build.mock.calls[0][1].apiKey).toBe('re_test_key');
        await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(RECEIVED_ID, envelope));
    });

    it('bad: signed with another secret, or the body changed after signing, is refused', async () => {
        const { post, build, forward } = await start();
        const body = JSON.stringify(receivedEvent());
        expect((await post(body, signed(body, { secret: OTHER_SECRET }))).status).toBe(401);
        const tampered = JSON.stringify(receivedEvent('00000000-0000-4000-8000-000000000000'));
        const res = await post(tampered, signed(body));
        expect(res).toEqual({ status: 401, json: { error: 'signature does not verify' } });
        expect(build).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
    });

    it('missing: any of the three headers absent is refused', async () => {
        const { post, build } = await start();
        const body = JSON.stringify(receivedEvent());
        const headers = signed(body);
        expect((await post(body, {})).status).toBe(401);
        for (const drop of Object.keys(headers)) {
            const partial = { ...headers };
            delete partial[drop];
            expect(await post(body, partial)).toEqual({ status: 401, json: { error: 'missing signature' } });
        }
        expect(build).not.toHaveBeenCalled();
    });

    it('replayed: a delivery already taken adds no second turn, and a stale one is refused', async () => {
        const { post, build, forward } = await start();
        const body = JSON.stringify(receivedEvent());
        const headers = signed(body, { id: 'msg_replay_1' });
        expect((await post(body, headers)).status).toBe(200);
        // The same signed request again, byte for byte.
        expect(await post(body, headers)).toEqual({ status: 200, json: { ok: true, duplicate: true } });
        // A fresh delivery id for the same received email (Resend retrying, or a re-signed replay).
        expect(await post(body, signed(body, { id: 'msg_replay_2' }))).toEqual({ status: 200, json: { ok: true, duplicate: true } });
        expect(build).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(1));
        // A request stamped outside the five-minute tolerance is refused even with a valid signature.
        const old = JSON.stringify(receivedEvent('11111111-1111-4111-8111-111111111111'));
        const stale = await post(old, signed(old, { at: new Date(Date.now() - 10 * 60 * 1000) }));
        expect(stale).toEqual({ status: 401, json: { error: 'signature does not verify' } });
        const future = await post(old, signed(old, { at: new Date(Date.now() + 10 * 60 * 1000) }));
        expect(future.status).toBe(401);
        expect(build).toHaveBeenCalledTimes(1);
    });
});

describe('after the signature', () => {
    it('ignores other event types', async () => {
        const { post, build } = await start();
        const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-16T09:12:43.126Z', data: { email_id: 'x' } });
        expect(await post(body, signed(body))).toEqual({ status: 200, json: { ok: true, ignored: 'email.delivered' } });
        expect(build).not.toHaveBeenCalled();
    });

    it('answers 502 when Resend cannot be read, and takes the retry', async () => {
        const build = vi.fn()
            .mockRejectedValueOnce(new Error('Resend /emails/receiving/:id failed: HTTP 500'))
            .mockResolvedValueOnce(envelope);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { post, forward } = await start({ envelope: build });
        const body = JSON.stringify(receivedEvent());
        const headers = signed(body);
        expect((await post(body, headers)).status).toBe(502);
        expect(forward).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
        expect((await post(body, headers)).status).toBe(200);
        await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(1));
        errors.mockRestore();
    });

    it('answers 409 while the same email is still being read', async () => {
        let release!: (e: InboundEnvelope) => void;
        const build = vi.fn(() => new Promise<InboundEnvelope>((r) => { release = r; }));
        const { post, forward } = await start({ envelope: build });
        const body = JSON.stringify(receivedEvent());
        const first = post(body, signed(body));
        await vi.waitFor(() => expect(build).toHaveBeenCalled());
        expect((await post(body, signed(body))).status).toBe(409);
        release(envelope);
        expect((await first).status).toBe(200);
        await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(1));
    });

    it('forgets a seen key after a day', () => {
        let now = 0;
        const seen = new SeenKeys(() => now);
        seen.add('email:a');
        now = 23 * 60 * 60 * 1000;
        expect(seen.has('email:a')).toBe(true);
        now = 25 * 60 * 60 * 1000;
        expect(seen.has('email:a')).toBe(false);
    });
});

describe('ignored mail', () => {
    const API = 'https://api.resend.com';
    const EMAIL_ID = '56761188-7520-42d8-8898-ff6fc54ce618';
    function readFrom(email: Record<string, unknown>) {
        const calls: string[] = [];
        const fetch = (async (input: any) => {
            calls.push(String(input));
            return String(input) === `${API}/emails/receiving/${EMAIL_ID}` ? new Response(JSON.stringify(email)) : new Response('', { status: 404 });
        }) as typeof globalThis.fetch;
        return { calls, envelope: (id: string, d: ResendInboundDeps) => envelopeFromResend(id, { ...d, fetch }) };
    }
    const email = (from: string, headers: Record<string, string> = {}) => ({ object: 'email', id: EMAIL_ID, to: ['bookings@handyservices.example'], from, created_at: '2026-09-16T09:12:42.674Z', subject: 'Leaking tap', html: null, text: 'It drips.', headers: { from, ...headers }, message_id: '<CAF3x9@mail.example.com>', attachments: [] });

    it('is answered 200 as ignored, logged with the reason only, marked seen and never forwarded', async () => {
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { calls, envelope: build } = readFrom(email('Sam Jones <sam.jones@example.com>', { 'Auto-Submitted': 'auto-replied' }));
        const { post, forward, rows } = await start({ envelope: build });
        const body = JSON.stringify(receivedEvent());
        expect(await post(body, signed(body))).toEqual({ status: 200, json: { ok: true, ignored: 'auto_submitted' } });
        expect(await post(body, signed(body))).toEqual({ status: 200, json: { ok: true, duplicate: true } });
        expect(calls).toHaveLength(1);
        expect(forward).not.toHaveBeenCalled();
        expect(rows.rows.size).toBe(0);
        expect(logs.mock.calls.map((c) => c.join(' '))).toEqual(['[comms-v2 email] received email ignored: auto_submitted']);
        logs.mockRestore();
    });

    it('with no readable sender is a warning carrying the email id, and nothing from the email', async () => {
        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { post, forward } = await start({ envelope: readFrom(email('undisclosed-sender')).envelope });
        const body = JSON.stringify(receivedEvent());
        expect((await post(body, signed(body))).json).toEqual({ ok: true, ignored: 'no_sender_address' });
        expect(forward).not.toHaveBeenCalled();
        expect(warns.mock.calls.map((c) => c.join(' '))).toEqual([`[comms-v2 email] received email ${EMAIL_ID} ignored: no_sender_address`]);
        warns.mockRestore();
    });

    it('from an internal address is ignored; a customer email is forwarded', async () => {
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
        const env = { ...ON, INTERNAL_EMAIL_ADDRESSES: 'ben@handyservices.example' };
        const internal = await start({ env, envelope: readFrom(email('"Ben" <Ben@HandyServices.example>')).envelope });
        const body = JSON.stringify(receivedEvent());
        expect((await internal.post(body, signed(body))).json).toEqual({ ok: true, ignored: 'internal_sender' });
        expect(internal.forward).not.toHaveBeenCalled();
        server?.close();
        const customer = await start({ env, envelope: readFrom(email('Sam Jones <sam.jones@example.com>')).envelope });
        expect((await customer.post(body, signed(body))).json).toEqual({ ok: true, accepted: true, media: 0, mediaFailures: 0 });
        await vi.waitFor(() => expect(customer.forward).toHaveBeenCalledWith(RECEIVED_ID, expect.objectContaining({ channel: 'email', address: 'sam.jones@example.com', name: 'Sam Jones', via: 'resend' })));
        logs.mockRestore();
    });
});

describe('the mount', () => {
    it('answers a signed POST without a session, with the raw body, ahead of the JSON parser and any admin gate', async () => {
        expect(RESEND_INBOUND_PATH.startsWith('/api/comms-v2')).toBe(false);
        const { handOver: forward, queue } = memoryQueue();
        const app = express();
        mountResendInbound(app, { env: ON, envelope: async () => envelope, queue });
        app.use(express.json());
        app.use((_req, res) => { res.status(401).json({ error: 'admin only' }); });
        server = http.createServer(app);
        await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
        const port = (server.address() as { port: number }).port;
        const body = JSON.stringify(receivedEvent());
        const res = await fetch(`http://127.0.0.1:${port}${RESEND_INBOUND_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...signed(body) }, body });
        expect({ status: res.status, json: await res.json() }).toEqual({ status: 200, json: { ok: true, accepted: true, media: 0, mediaFailures: 0 } });
        await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(RECEIVED_ID, envelope));
    });
});

describe('the safeguard', () => {
    it('keeps the email before answering: the answer does not wait on the desk, and the row is there when it comes', async () => {
        const rows = new MemoryInboundEmailRows();
        const handOver = vi.fn(() => new Promise<void>(() => {}));
        const { post } = await start({ queue: inboundEmailQueue({ rows: async () => rows, handOver }) });
        const body = JSON.stringify(receivedEvent());
        expect((await post(body, signed(body))).json).toMatchObject({ accepted: true });
        expect(rows.rows.get(RECEIVED_ID)).toMatchObject({ status: 'pending', envelope });
        await vi.waitFor(() => expect(handOver).toHaveBeenCalledTimes(1));
    });

    it('answers 503 when the email cannot be kept, marks nothing seen, and keeps Resend\'s next delivery', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const rows = new MemoryInboundEmailRows();
        const insert = vi.spyOn(rows, 'insert').mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        const { post, forward } = await start({ rows });
        const body = JSON.stringify(receivedEvent());
        const headers = signed(body);
        expect(await post(body, headers)).toEqual({ status: 503, json: { error: 'the received email could not be kept; retry later' } });
        expect(errors).toHaveBeenCalledWith(expect.stringContaining(`keeping received email ${RECEIVED_ID} failed; Resend will deliver it again`));
        expect(forward).not.toHaveBeenCalled();
        expect(rows.rows.size).toBe(0);
        expect(await post(body, headers)).toEqual({ status: 200, json: { ok: true, accepted: true, media: 0, mediaFailures: 0 } });
        expect(insert).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(1));
        errors.mockRestore();
    });

    it('answers 503 when the store cannot be read, before Resend is read', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const rows = new MemoryInboundEmailRows();
        vi.spyOn(rows, 'has').mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        const { post, build } = await start({ rows });
        const body = JSON.stringify(receivedEvent());
        expect((await post(body, signed(body))).status).toBe(503);
        expect(build).not.toHaveBeenCalled();
        errors.mockRestore();
    });

    it('a redelivery after a restart is answered from the store: Resend is not read again and nothing more is kept or handed over', async () => {
        const rows = new MemoryInboundEmailRows();
        const before = await start({ rows });
        const body = JSON.stringify(receivedEvent());
        expect((await before.post(body, signed(body))).json).toMatchObject({ accepted: true });
        await vi.waitFor(() => expect(before.forward).toHaveBeenCalledTimes(1));
        server?.close();
        // A new process: nothing remembered in memory, the same rows.
        const after = await start({ rows });
        expect(await after.post(body, signed(body))).toEqual({ status: 200, json: { ok: true, duplicate: true } });
        expect(after.build).not.toHaveBeenCalled();
        expect(after.forward).not.toHaveBeenCalled();
        expect(rows.rows.size).toBe(1);
    });

    it('a failed first hand-over leaves the row pending, and the retry pass hands it over', async () => {
        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
        let t = Date.now();
        const rows = new MemoryInboundEmailRows();
        const handOver = vi.fn().mockRejectedValueOnce(new Error('the gateway could not be built')).mockResolvedValue(undefined);
        const queue = inboundEmailQueue({ rows: async () => rows, handOver, now: () => new Date(t) });
        const { post } = await start({ queue });
        const body = JSON.stringify(receivedEvent());
        expect((await post(body, signed(body))).json).toMatchObject({ accepted: true });
        await vi.waitFor(() => expect(rows.rows.get(RECEIVED_ID)).toMatchObject({ status: 'pending', attempts: 1, lastError: 'the gateway could not be built' }));
        // Switched off, the retry pass does nothing.
        t += RETRY_DELAYS_MS[0];
        expect(await runInboundEmailRetryTick({ env: { ...ON, [EMAIL_INBOUND_ENV]: '0' }, queue })).toEqual({ ran: false, due: 0, handed: 0, retrying: 0, failed: 0, errors: 0 });
        expect(handOver).toHaveBeenCalledTimes(1);
        expect(await runInboundEmailRetryTick({ env: ON, queue })).toEqual({ ran: true, due: 1, handed: 1, retrying: 0, failed: 0, errors: 0 });
        expect(rows.rows.get(RECEIVED_ID)).toMatchObject({ status: 'done', attempts: 2 });
        warns.mockRestore();
        logs.mockRestore();
    });
});
