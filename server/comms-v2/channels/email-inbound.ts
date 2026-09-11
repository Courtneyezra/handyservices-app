/**
 * The inbound email webhook: the one new entry point this goal adds, because email has no inbound
 * today. Mounted by server/index.ts at POST /api/comms-v2/email/inbound, and alive only with the
 * intake switch on (COMMS_V2_INTAKE) and a shared secret set.
 *
 * Provider configuration it expects (nothing is configured here): an inbound-parse provider that
 * receives mail for the business's address and POSTs JSON to this URL. Two bodies are accepted:
 *   - the provider-neutral shape (email-adapter.ts InboundEmail): { from, fromName?, subject?,
 *     text? | html?, messageId?, inReplyTo?, references?, attachments?: [{ name?, contentType,
 *     content (base64) }] }
 *   - Postmark's inbound webhook JSON as it ships (FromFull, Subject, TextBody, MessageID,
 *     Headers, Attachments), detected by shape.
 * The provider must send the secret in the `X-Comms-V2-Email-Secret` header; the value comes from
 * COMMS_V2_EMAIL_WEBHOOK_SECRET. Without a secret in the environment the endpoint answers 503 and
 * accepts nothing. Outbound replies go through the sender's live path on Resend
 * (email-deliverer.ts) once the desk's delivery switch is on; until then the desk runs dry.
 */
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fromInboundEmail, fromPostmark, isPostmarkShape, type InboundEmail } from './email-adapter';
import { forwardNow, intakeEnabled } from './intake';

export const EMAIL_INBOUND_PATH = '/api/comms-v2/email/inbound';
export const EMAIL_SECRET_ENV = 'COMMS_V2_EMAIL_WEBHOOK_SECRET';
export const EMAIL_SECRET_HEADER = 'x-comms-v2-email-secret';

function secretMatches(given: unknown, expected: string): boolean {
    const g = Buffer.from(String(given ?? ''));
    const e = Buffer.from(expected);
    return g.length === e.length && timingSafeEqual(g, e);
}

export interface EmailInboundDeps { env?: NodeJS.ProcessEnv; forward?: typeof forwardNow; mediaDir?: string }

export function emailInboundRouter(deps: EmailInboundDeps = {}): Router {
    const env = deps.env ?? process.env;
    const forward = deps.forward ?? forwardNow;
    const router = Router();
    router.post(EMAIL_INBOUND_PATH, async (req, res) => {
        if (!intakeEnabled(env)) { res.status(404).json({ error: 'the comms-v2 intake is off' }); return; }
        const secret = env[EMAIL_SECRET_ENV];
        if (!secret) { res.status(503).json({ error: `${EMAIL_SECRET_ENV} is not set; the inbound email endpoint accepts nothing` }); return; }
        if (!secretMatches(req.headers[EMAIL_SECRET_HEADER], secret)) { res.status(401).json({ error: 'bad secret' }); return; }
        try {
            const body = req.body;
            const email: InboundEmail = isPostmarkShape(body) ? fromPostmark(body) : (body as InboundEmail);
            if (!email || typeof email.from !== 'string' || !email.from.trim()) { res.status(400).json({ error: 'from is required' }); return; }
            const envelope = fromInboundEmail(email, { mediaDir: deps.mediaDir });
            const report = await forward({ kind: 'email_inbound', envelope });
            res.status(200).json({ ok: true, forwarded: report.forwarded, skipped: report.skipped });
        } catch (err: any) {
            res.status(400).json({ error: err?.message ?? 'bad inbound email' });
        }
    });
    return router;
}
