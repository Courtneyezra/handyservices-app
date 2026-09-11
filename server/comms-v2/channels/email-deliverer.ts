/**
 * Live email delivery for the one sender, on the provider the business already sends from
 * (Resend, server/email-service.ts). The reply stays on the customer's thread: `In-Reply-To`
 * and `References` carry the inbound Message-ID chain and the subject keeps theirs with "Re:".
 *
 * Only the sender's live path reaches this, behind the registry switch it checks first; the
 * sandbox door runs in dry run and never comes here (behaviour.md answer 42: real sending is not
 * validated live). Nothing here reads a value from the environment beyond the provider key and
 * the from address, and nothing logs one.
 */
import type { EmailThreading } from './email-adapter';

export const EMAIL_FROM_ENV = 'COMMS_V2_EMAIL_FROM';
export const DEFAULT_EMAIL_FROM = 'Handy Services <bookings@handyservices.app>';

export interface EmailDelivery { to: string; text: string; threading: EmailThreading | null; runId: string; approver: string }
export type EmailDeliveryOutcome = { ok: true; id: string | null } | { ok: false; reason: string };

export interface EmailTransport {
    send(input: { from: string; to: string; subject: string; text: string; headers: Record<string, string> }): Promise<{ id: string | null }>;
}

/** Resend, loaded on first use so a test run never imports it. */
async function resendTransport(): Promise<EmailTransport | { refused: string }> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { refused: 'RESEND_API_KEY is not set; no email can leave' };
    const { Resend } = await import('resend');
    const client = new Resend(apiKey);
    return {
        async send(input) {
            const res = await client.emails.send({ from: input.from, to: [input.to], subject: input.subject, text: input.text, headers: input.headers } as any);
            if ((res as any)?.error) throw new Error((res as any).error?.message ?? 'resend refused the send');
            return { id: (res as any)?.data?.id ?? null };
        },
    };
}

export function emailHeaders(threading: EmailThreading | null, runId: string): Record<string, string> {
    const h: Record<string, string> = { 'X-Comms-V2-Run': runId };
    if (threading?.inReplyTo) h['In-Reply-To'] = threading.inReplyTo;
    if (threading?.references?.length) h.References = threading.references.join(' ');
    return h;
}

export async function deliverEmail(input: EmailDelivery, transport?: EmailTransport): Promise<EmailDeliveryOutcome> {
    const t = transport ?? (await resendTransport());
    if ('refused' in t) return { ok: false, reason: t.refused };
    const from = process.env[EMAIL_FROM_ENV] || DEFAULT_EMAIL_FROM;
    try {
        const sent = await t.send({ from, to: input.to, subject: input.threading?.subject ?? 'Your enquiry', text: input.text, headers: emailHeaders(input.threading, input.runId) });
        return { ok: true, id: sent.id };
    } catch (err: any) {
        return { ok: false, reason: err?.message ?? String(err) };
    }
}
