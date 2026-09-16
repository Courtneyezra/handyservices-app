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
 *   200  a verified delivery already seen (same `svix-id`, or the same received email, remembered in
 *        this process or kept in the store): a replay inside the tolerance, or Resend retrying,
 *        adds no second turn. Also any other event type.
 *   409  the same email is being read right now; Resend retries later.
 *   502  Resend's API could not be read; nothing is marked seen, so Resend's retry reads it again.
 *   503  the store could not be read or written; nothing is marked seen, so Resend retries.
 *   200  ignored: automated or internal mail (resend-inbound.ts `ignoredReason`). It is marked seen,
 *        logged with the reason only (no readable sender is a warning carrying Resend's email id),
 *        and never stored or forwarded; no attachment is downloaded.
 *   200  accepted: the envelope is built (email, attachments downloaded) and written to the store
 *        (inbound-email-store.ts) before the answer. The first hand-over to the desk starts once the
 *        answer is sent; the comms worker retries it until the desk has the email, and an email that
 *        spends every attempt is kept as failed and paged.
 *
 * The safeguard is in place: an email Resend has a 200 for is in the store, and a desk that fails to
 * take it is tried again, so it is not lost. Switching inbound email on still needs the migration
 * `20260916_comms_v2_inbound_emails.sql` applied, `COMMS_V2_EMAIL_INBOUND=1`, `COMMS_V2_INTAKE=1`,
 * the two variables above, and a `COMMS_WORKER=1` process for the retries (docs/RUNBOOK.md,
 * "Inbound email (Resend)"). None of them is set here.
 *
 * Seen deliveries are also remembered in this process for a day, which spares a store read on a
 * replay. No value from an email is logged.
 */
import express, { Router, type Request, type Response } from 'express';
import { Webhook } from 'svix';
import type { InboundEnvelope } from './envelope';
import { intakeEnabled, INTAKE_ENV } from './intake';
import { inboundEmailQueue, type InboundEmailQueue, type InboundEmailQueueDeps, type RetryPass } from './inbound-email-store';
import { envelopeFromResend, isIgnored, type IgnoredEmail, type ResendEmailReceivedEvent, type ResendInboundDeps } from './resend-inbound';

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

/** The raw-body parser the route needs, mounted ahead of the global JSON parser. */
export function resendInboundRawBody() {
    return express.raw({ type: () => true, limit: RESEND_INBOUND_BODY_LIMIT });
}

/**
 * Mounts the webhook on the app: its raw-body parser and its router, with no admin guard. index.ts
 * calls this before the global JSON parser and before any session or admin middleware.
 */
export function mountResendInbound(app: express.Express, deps: EmailInboundDeps = {}): void {
    app.use(RESEND_INBOUND_PATH, resendInboundRawBody());
    app.use(resendInboundRouter(deps));
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
    envelope?: (emailId: string, deps: ResendInboundDeps) => Promise<InboundEnvelope | IgnoredEmail>;
    /** Where accepted emails are kept and handed to the desk from; the default is the database store. */
    queue?: InboundEmailQueue;
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
    const queue = deps.queue ?? inboundEmailQueue();
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
        try {
            try {
                if (await queue.has(emailId)) { seen.add(`email:${emailId}`); seen.add(`delivery:${id}`); res.status(200).json({ ok: true, duplicate: true }); return; }
            } catch (err: any) {
                console.error(`[comms-v2 email] reading the inbound email store failed: ${err?.message ?? err}`);
                res.status(503).json({ error: 'the inbound email store could not be read; retry later' });
                return;
            }
            let envelope: InboundEnvelope | IgnoredEmail;
            try {
                envelope = await build(emailId, { apiKey, mediaDir: deps.mediaDir, env });
            } catch (err: any) {
                console.error(`[comms-v2 email] reading a received email from Resend failed: ${err?.message ?? err}`);
                res.status(502).json({ error: 'the received email could not be read from Resend' });
                return;
            }
            if (isIgnored(envelope)) {
                seen.add(`email:${emailId}`);
                seen.add(`delivery:${id}`);
                if (envelope.ignored === 'no_sender_address') console.warn(`[comms-v2 email] received email ${emailId} ignored: ${envelope.ignored}`);
                else console.log(`[comms-v2 email] received email ignored: ${envelope.ignored}`);
                res.status(200).json({ ok: true, ignored: envelope.ignored });
                return;
            }
            let stored: boolean;
            try {
                stored = await queue.store(emailId, envelope);
            } catch (err: any) {
                console.error(`[comms-v2 email] keeping received email ${emailId} failed; Resend will deliver it again: ${err?.message ?? err}`);
                res.status(503).json({ error: 'the received email could not be kept; retry later' });
                return;
            }
            seen.add(`email:${emailId}`);
            seen.add(`delivery:${id}`);
            if (!stored) { res.status(200).json({ ok: true, duplicate: true }); return; }
            res.status(200).json({ ok: true, accepted: true, media: envelope.media.length, mediaFailures: envelope.mediaFailures.length });
            void queue.attempt(emailId).catch((err: any) => console.error(`[comms-v2 email] the first hand-over of received email ${emailId} failed; the retry takes it: ${err?.message ?? err}`));
        } finally {
            reading.delete(emailId);
        }
    });
    return router;
}

export interface RetryTick extends RetryPass { ran: boolean }

let retrying = false;

/**
 * The comms worker's retry pass over kept emails (server/cron.ts, every minute): nothing while
 * inbound email is switched off, and never two passes at once. Null when the last one is still running.
 */
export async function runInboundEmailRetryTick(deps: { env?: NodeJS.ProcessEnv; queue?: InboundEmailQueue } & InboundEmailQueueDeps = {}): Promise<RetryTick | null> {
    if (!emailInboundEnabled(deps.env ?? process.env)) return { ran: false, due: 0, handed: 0, retrying: 0, failed: 0, errors: 0 };
    if (retrying) return null;
    retrying = true;
    try {
        const pass = await (deps.queue ?? inboundEmailQueue(deps)).retryDue();
        if (pass.due) console.log(`[comms-v2 email] retry pass: ${pass.due} due, ${pass.handed} handed, ${pass.retrying} to retry, ${pass.failed} failed for good, ${pass.errors} errors`);
        return { ran: true, ...pass };
    } finally {
        retrying = false;
    }
}
