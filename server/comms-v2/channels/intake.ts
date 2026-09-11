/**
 * The old inputs connected to the new plumbing, behind one switch (behaviour.md answer 37).
 *
 * `COMMS_V2_INTAKE` off (unset, 0, false): nothing here runs and nothing old changes. On (1,
 * true, on, yes): each old inbound entry point (the Twilio webhook for WhatsApp and SMS, the
 * Meta WhatsApp webhook, the web form, a finished call) also forwards its raw event here, where
 * the matching adapter builds the gateway's envelope and the channel gateway hands the turn to
 * the desk. The old handler still runs today. The desk here runs in dry run: it does everything
 * up to delivery and lands its reply on its own in-memory case file, nothing leaves. The cutover
 * that turns the old handler off and this desk's delivery on is a later task.
 *
 * `forwardToCommsV2` never throws and never blocks: an old handler's response does not wait on
 * the new desk, and a failure here is one log line. No value from an event is logged, only the
 * case id and the decision.
 */
import type { InboundEnvelope } from './envelope';

export const INTAKE_ENV = 'COMMS_V2_INTAKE';

export function intakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true|on|yes)$/i.test((env[INTAKE_ENV] ?? '').trim());
}

export type IntakeEvent =
    | { kind: 'twilio_incoming'; body: Record<string, unknown> }
    | { kind: 'meta_webhook'; payload: unknown }
    | { kind: 'web_form'; lead: { customerName?: string | null; phone?: string | null; email?: string | null; jobDescription?: string | null; postcode?: string | null; address?: string | null; source?: string | null; leadId?: string | null } }
    | { kind: 'call_finished'; callRecordId: string }
    | { kind: 'email_inbound'; envelope: InboundEnvelope };

export interface IntakeReport { forwarded: number; skipped: string[] }

let live: Promise<import('./channel-gateway').ChannelGateway> | null = null;

/** The one live gateway, built on first use: a dry-run desk on the desk's own in-memory store. */
export function liveChannelGateway(): Promise<import('./channel-gateway').ChannelGateway> {
    if (!live) {
        live = (async () => {
            const { ChannelGateway } = await import('./channel-gateway');
            const { ChannelDesk } = await import('./channel-desk');
            const { Desk } = await import('../desk/desk');
            const log = (line: string) => console.log(`[comms-v2 intake] ${line}`);
            return new ChannelGateway({ desk: new ChannelDesk(new Desk({ mode: 'dry_run', log }), { mode: 'dry_run', log }), presence: messagesPresence, log });
        })();
    }
    return live;
}

/** Whether a number is on WhatsApp, from the messages the business already holds: an inbound WhatsApp message from it. */
export const messagesPresence: import('./channel-gateway').WhatsAppPresence = {
    async knownOnWhatsApp(e164) {
        try {
            const { db } = await import('../../db');
            const { conversations, messages } = await import('@shared/schema');
            const { and, eq, sql } = await import('drizzle-orm');
            const digits = e164.replace(/\D/g, '');
            const rows = await db.select({ id: messages.id }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
                .where(and(eq(messages.direction, 'inbound'), eq(messages.channel, 'whatsapp'), sql`${conversations.phoneNumber} like ${`${digits}%`}`)).limit(1);
            return rows.length > 0 ? true : null;
        } catch {
            return null;
        }
    },
};

/** Every envelope an event yields; the adapters do the work. Exported so the switch-off and the shapes are testable without a desk. */
export async function envelopesOf(event: IntakeEvent, deps: { fetch?: typeof fetch; mediaDir?: string } = {}): Promise<{ envelopes: InboundEnvelope[]; skipped: string[] }> {
    const skipped: string[] = [];
    switch (event.kind) {
        case 'twilio_incoming': {
            const { isTwilioSms, fromTwilioSms } = await import('./sms-adapter');
            if (isTwilioSms(event.body)) return { envelopes: [fromTwilioSms(event.body as any)], skipped };
            const { fromTwilio } = await import('../desk/whatsapp-adapter');
            return { envelopes: [await fromTwilio(event.body as any, { fetch: deps.fetch, mediaDir: deps.mediaDir })], skipped };
        }
        case 'meta_webhook': {
            const { fromMeta } = await import('../desk/whatsapp-adapter');
            return { envelopes: await fromMeta(event.payload as any, { fetch: deps.fetch, mediaDir: deps.mediaDir }), skipped };
        }
        case 'web_form': {
            const { fromWebForm } = await import('./form-adapter');
            return { envelopes: [await fromWebForm(event.lead, { fetch: deps.fetch, mediaDir: deps.mediaDir })], skipped };
        }
        case 'call_finished': {
            const { db } = await import('../../db');
            const { calls } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            const [call] = await db.select().from(calls).where(eq(calls.id, event.callRecordId)).limit(1);
            if (!call) { skipped.push('no call record'); return { envelopes: [], skipped }; }
            const { describeCall } = await import('../../call-thread');
            const info = describeCall(call as any);
            const { fromFinishedCall } = await import('./call-adapter');
            const env = fromFinishedCall({ phone: call.phoneNumber, name: call.customerName, direction: info.direction, missed: info.missed, transcript: call.transcription, durationSeconds: call.duration, at: (call.endTime ?? call.startTime)?.toISOString() ?? null, jobSummary: call.jobSummary, callId: call.id });
            if (!env) skipped.push('an unanswered outbound call is recorded on the call row only');
            return { envelopes: env ? [env] : [], skipped };
        }
        case 'email_inbound':
            return { envelopes: [event.envelope], skipped };
    }
}

/** Forward one old-input event into the new desk. Fire and forget: returns at once, never throws. */
export function forwardToCommsV2(event: IntakeEvent, env: NodeJS.ProcessEnv = process.env): void {
    if (!intakeEnabled(env)) return;
    void forwardNow(event).catch((err) => console.warn(`[comms-v2 intake] ${event.kind} failed: ${err?.message ?? err}`));
}

/** The same forward, awaited: the email webhook and the tests use it. */
export async function forwardNow(event: IntakeEvent): Promise<IntakeReport> {
    const { envelopes, skipped } = await envelopesOf(event);
    const gateway = await liveChannelGateway();
    let forwarded = 0;
    for (const envelope of envelopes) {
        const out = await gateway.inbound(envelope);
        if (out.kind === 'handled') { forwarded++; console.log(`[comms-v2 intake] ${event.kind} -> case ${out.file.id}: ${out.result.decision}${out.result.channel ? ` on ${out.result.channel}` : ''} (dry run)`); }
        else skipped.push(out.kind === 'candidates' ? 'identity returned candidates' : out.reason);
    }
    return { forwarded, skipped };
}

/** For tests: forget the live gateway, or put a scripted one in its place. */
export function resetLiveChannelGateway(gateway?: import('./channel-gateway').ChannelGateway): void { live = gateway ? Promise.resolve(gateway) : null; }
