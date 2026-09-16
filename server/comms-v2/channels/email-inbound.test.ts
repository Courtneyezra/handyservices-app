/**
 * The inbound email webhook: signed by Resend (Svix), off unless both switches say '1', mounted
 * outside the admin gate with its body kept raw. A good signature lands one turn; a bad, missing or
 * stale one lands nothing; a replay of a delivery already taken lands nothing more.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Webhook } from 'svix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboundEnvelope } from './envelope';
import { EMAIL_INBOUND_ENV, emailInboundEnabled, RESEND_INBOUND_PATH, RESEND_INBOUND_SECRET_ENV, resendInboundRawBody, resendInboundRouter, SeenKeys, type EmailInboundDeps } from './email-inbound';

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

/** The app as index.ts builds it: raw parser on the path, the global JSON parser, then the router. */
async function start(deps: Partial<EmailInboundDeps> & { env?: NodeJS.ProcessEnv } = {}) {
    const build = vi.fn(async (_id: string, _d: { apiKey: string }) => envelope);
    const forward = vi.fn((_e: InboundEnvelope) => {});
    const app = express();
    app.use(RESEND_INBOUND_PATH, resendInboundRawBody());
    app.use(express.json());
    app.use(resendInboundRouter({ env: ON, envelope: build, forward, ...deps }));
    server = http.createServer(app);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const post = async (body: string, headers: Record<string, string>) => {
        const res = await fetch(`http://127.0.0.1:${port}${RESEND_INBOUND_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
        return { status: res.status, json: await res.json() as Record<string, unknown> };
    };
    return { post, build, forward };
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
        expect(forward).toHaveBeenCalledWith(envelope);
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
        expect(forward).toHaveBeenCalledTimes(1);
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
        expect(forward).toHaveBeenCalledTimes(1);
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
        expect(forward).toHaveBeenCalledTimes(1);
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

describe('the mount', () => {
    const index = fs.readFileSync(path.join(__dirname, '../../index.ts'), 'utf8');

    it('is outside the admin-gated /api/comms-v2 prefix and mounted without an admin guard', () => {
        expect(RESEND_INBOUND_PATH.startsWith('/api/comms-v2')).toBe(false);
        expect(index).toMatch(/^app\.use\(resendInboundRouter\(\)\);/m);
    });

    it('keeps the body raw ahead of the global JSON parser', () => {
        const raw = index.indexOf('app.use(RESEND_INBOUND_PATH, resendInboundRawBody());');
        const json = index.indexOf("app.use(express.json({ limit: '10mb' }))");
        expect(raw).toBeGreaterThan(-1);
        expect(json).toBeGreaterThan(raw);
    });
});
