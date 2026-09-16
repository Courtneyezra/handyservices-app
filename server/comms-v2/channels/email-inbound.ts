/**
 * The inbound email webhook: Resend POSTs `email.received` here, and the email becomes a turn on
 * the new desk.
 *
 * Mounted by server/index.ts at `RESEND_INBOUND_PATH`, outside the admin-gated /api/comms-v2
 * prefix, because a provider has no session. Its own authentication is Resend's webhook signature
 * (Svix: the `svix-id`, `svix-timestamp` and `svix-signature` headers over the raw body, verified
 * with the `svix` library Resend's "Verify webhooks requests" page names). The body must reach this
 * route unparsed, so index.ts puts a raw parser on the path ahead of the global JSON parser.
 *
 * Off by default, and every answer before the signature is checked accepts nothing:
 *
 *   404  the switch is off: `COMMS_V2_EMAIL_INBOUND=1` and the intake switch `COMMS_V2_INTAKE=1`
 *        are both needed, read the way `COMMS_V2_INTAKE` is (exactly '1' is on). Nothing is read.
 *   503  `RESEND_INBOUND_WEBHOOK_SECRET` (the endpoint's signing secret, `whsec_...`) or
 *        `RESEND_API_KEY` (to read the body and attachments) is not set.
 *   401  the signature is missing, does not verify, or is stamped more than five minutes from now
 *        (the library's tolerance), which is what refuses an old request replayed.
 *   200  a verified delivery already seen (same `svix-id`, or the same received email): a replay
 *        inside the tolerance, or Resend retrying, adds no second turn. Also any other event type.
 *   409  the same email is being read right now; Resend retries later.
 *   502  Resend's API could not be read; nothing is marked seen, so Resend's retry reads it again.
 *   200  accepted: the envelope is built (email, attachments downloaded) and forwarded to the
 *        intake without waiting on the desk's turn.
 *
 * Seen deliveries are remembered in this process for a day, which covers Resend's retry schedule.
 * No value from an email is logged.
 */
import express, { Router, type Request, type Response } from 'express';
import { Webhook } from 'svix';
import type { InboundEnvelope } from './envelope';
import { forwardToCommsV2, intakeEnabled, INTAKE_ENV } from './intake';
import { envelopeFromResend, type ResendEmailReceivedEvent, type ResendInboundDeps } from './resend-inbound';

export const RESEND_INBOUND_PATH = '/api/webhooks/resend/inbound-email';
export const EMAIL_INBOUND_ENV = 'COMMS_V2_EMAIL_INBOUND';
export const RESEND_INBOUND_SECRET_ENV = 'RESEND_INBOUND_WEBHOOK_SECRET';
export const RESEND_API_KEY_ENV = 'RESEND_API_KEY';
/** Resend's metadata-only event is small; anything bigger is not one. */
export const RESEND_INBOUND_BODY_LIMIT = '1mb';

/** On only with its own switch and the intake's, each exactly '1'. */
export function emailInboundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return intakeEnabled(env) && (env[EMAIL_INBOUND_ENV] ?? '').trim() === '1';
}

/** The raw-body parser the route needs, mounted by index.ts ahead of the global JSON parser. */
export function resendInboundRawBody() {
    return express.raw({ type: () => true, limit: RESEND_INBOUND_BODY_LIMIT });
}

const SEEN_MS = 24 * 60 * 60 * 1000;
const SEEN_MAX = 10_000;

/** Keys seen within the last day, oldest first. */
export class SeenKeys {
    private readonly at = new Map<string, number>();
    constructor(private readonly now: () => number = Date.now) {}
    has(key: string): boolean {
        const t = this.at.get(key);
        return t !== undefined && this.now() - t < SEEN_MS;
    }
    add(key: string): void {
        const now = this.now();
        this.at.delete(key);
        this.at.set(key, now);
        for (const [k, t] of Array.from(this.at)) {
            if (this.at.size <= SEEN_MAX && now - t < SEEN_MS) break;
            this.at.delete(k);
        }
    }
}

export interface EmailInboundDeps {
    env?: NodeJS.ProcessEnv;
    /** Builds the turn from a received email's id; the default reads Resend's API. */
    envelope?: (emailId: string, deps: ResendInboundDeps) => Promise<InboundEnvelope>;
    /** Hands the turn to the intake; the default is the fire-and-forget forward. */
    forward?: (envelope: InboundEnvelope) => void;
    seen?: SeenKeys;
    mediaDir?: string;
}

function header(req: Request, name: string): string {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

export function resendInboundRouter(deps: EmailInboundDeps = {}): Router {
    const env = deps.env ?? process.env;
    const build = deps.envelope ?? envelopeFromResend;
    const forward = deps.forward ?? ((envelope: InboundEnvelope) => forwardToCommsV2({ kind: 'email_received', envelope }, env));
    const seen = deps.seen ?? new SeenKeys();
    const reading = new Set<string>();
    const router = Router();
    router.post(RESEND_INBOUND_PATH, async (req: Request, res: Response) => {
        if (!emailInboundEnabled(env)) { res.status(404).json({ error: `inbound email is off (${EMAIL_INBOUND_ENV}=1 and ${INTAKE_ENV}=1 turn it on)` }); return; }
        const secret = (env[RESEND_INBOUND_SECRET_ENV] ?? '').trim();
        const apiKey = (env[RESEND_API_KEY_ENV] ?? '').trim();
        if (!secret || !apiKey) { res.status(503).json({ error: `${!secret ? RESEND_INBOUND_SECRET_ENV : RESEND_API_KEY_ENV} is not set; inbound email accepts nothing` }); return; }
        if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'the body did not arrive raw; the signature cannot be checked' }); return; }

        const id = header(req, 'svix-id');
        const timestamp = header(req, 'svix-timestamp');
        const signature = header(req, 'svix-signature');
        if (!id || !timestamp || !signature) { res.status(401).json({ error: 'missing signature' }); return; }
        let event: { type?: string; data?: Partial<ResendEmailReceivedEvent['data']> };
        try {
            event = new Webhook(secret).verify(req.body.toString('utf8'), { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }) as typeof event;
        } catch {
            res.status(401).json({ error: 'signature does not verify' });
            return;
        }

        if (seen.has(`delivery:${id}`)) { res.status(200).json({ ok: true, duplicate: true }); return; }
        if (event?.type !== 'email.received') { seen.add(`delivery:${id}`); res.status(200).json({ ok: true, ignored: event?.type ?? 'unknown' }); return; }
        const emailId = typeof event.data?.email_id === 'string' ? event.data.email_id.trim() : '';
        if (!emailId) { res.status(400).json({ error: 'email.received without an email_id' }); return; }
        if (seen.has(`email:${emailId}`)) { seen.add(`delivery:${id}`); res.status(200).json({ ok: true, duplicate: true }); return; }
        if (reading.has(emailId)) { res.status(409).json({ error: 'this email is being read; retry later' }); return; }

        reading.add(emailId);
        let envelope: InboundEnvelope;
        try {
            envelope = await build(emailId, { apiKey, mediaDir: deps.mediaDir });
        } catch (err: any) {
            console.error(`[comms-v2 email] reading a received email from Resend failed: ${err?.message ?? err}`);
            res.status(502).json({ error: 'the received email could not be read from Resend' });
            return;
        } finally {
            reading.delete(emailId);
        }
        seen.add(`email:${emailId}`);
        seen.add(`delivery:${id}`);
        forward(envelope);
        res.status(200).json({ ok: true, accepted: true, media: envelope.media.length, mediaFailures: envelope.mediaFailures.length });
    });
    return router;
}
