// server/notifications/channels/email.ts
//
// Module 10 — Notifications: Email adapter.
//
// We don't reuse the bespoke transactional helpers in `email-service.ts`
// (those are tightly coupled to specific HTML templates). Instead, we send
// raw text via Resend directly when configured, falling back to a console
// log otherwise. This keeps the channel adapter thin and lets templates
// own all messaging.
//
// Refs: server/email-service.ts (Resend integration), Module 10 §3

import type { ChannelSendResult, RecipientType, RenderedMessage } from '../types';

interface EmailRecipient {
    type: RecipientType;
    id: string;
    email?: string;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Handy Services <noreply@handy-services.co.uk>';
const ADMIN_FALLBACK_EMAIL = process.env.ADMIN_EMAIL || 'admin@handy-services.co.uk';
const DRY_RUN = process.env.NOTIFICATIONS_DRY_RUN === '1';

export async function send(recipient: EmailRecipient, message: RenderedMessage): Promise<ChannelSendResult> {
    // Admin recipients without an email use the configured admin inbox.
    const to = recipient.email
        || (recipient.type === 'admin' ? ADMIN_FALLBACK_EMAIL : undefined);

    if (!to) {
        return { status: 'failed', error: 'no_email_for_recipient' };
    }

    // Dry-run takes precedence — prevents accidental live emails during
    // preview/staging testing even when Resend credentials are present.
    if (DRY_RUN) {
        console.log(`[notifications:email] (DRY_RUN) → ${to}: ${message.subject ?? '(no subject)'} | ${message.body.slice(0, 80)}…`);
        return { status: 'sent', messageId: `dryrun_${Date.now()}` };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        // TODO: wire to email-service.ts once a generic send function exists.
        console.log(`[notifications:email] (no Resend key) → ${to}: ${message.subject ?? '(no subject)'} | ${message.body.slice(0, 80)}…`);
        return { status: 'sent', messageId: `dev_${Date.now()}` };
    }

    try {
        const { Resend } = await import('resend');
        const resend = new Resend(apiKey);
        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to,
            subject: message.subject ?? 'Handy Services',
            text: message.body,
        });
        if (error) {
            return { status: 'failed', error: error.message ?? String(error) };
        }
        return { status: 'sent', messageId: data?.id };
    } catch (err: any) {
        return {
            status: 'failed',
            error: err?.message ?? String(err),
        };
    }
}
