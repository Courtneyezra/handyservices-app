/**
 * P15 part 2 — the contractor talks to the customer THROUGH the app.
 *
 * At the door a contractor needs one of three things and rings the office for all of them: he has
 * arrived, he is running late, or he cannot work out which door / where to park. Today that is a
 * phone call to Ben, or worse, a text from the contractor's own mobile that the business never
 * sees and the customer keeps forever.
 *
 * This carries his words on the business number instead:
 *
 *   contractor → customer   his message, prefixed with his first name so she knows who is writing,
 *                           sent through the ONE exit (sendCustomerMessage) with approver
 *                           `contractor:<id>` and a run id, logged like every other send. Ben reads
 *                           the exchange on the thread as usual.
 *   customer   → contractor her reply is relayed to his screen and pushed to his WhatsApp as a
 *                           job_pack_changed-style notice. Nothing is auto-answered.
 *
 * What a contractor may NOT do from here is the same list the agents may not do: no money, no
 * dates. Those two guards HOLD the message and hand it to Ben, because a contractor promising
 * "I'll knock £20 off" or "we'll come back Tuesday" is exactly the commitment the business reserves
 * to itself. The voice rules apply to him as they do to everyone (no dashes, no corporate closers).
 *
 * Pure at the top, the store at the bottom, deps injected so the tests never touch a database.
 */
import { detectDatePromise, detectMoneyFigure } from './agents/draft-guards';
import { chatVoiceViolations, toChatVoice } from '@shared/chat-voice';
import { guardContractorBody } from './spine/job-pack-notify';
import { newRunId, type Approver } from './approver';

// ---------------------------------------------------------------- vocabulary

/** At most this many relayed messages per job per day. A sixth is a phone call, not a text. */
export const RELAY_DAILY_LIMIT = 5;

/** The tag a thread carries while a contractor is mid-relay, so triage lanes her reply back to him. */
export const RELAY_TAG = 'contractor_relay_open';

/** How long after his message her reply still counts as an answer to him. */
export const RELAY_WINDOW_MS = 6 * 60 * 60_000;

export type RelayPresetId = 'arrived' | 'running_late' | 'access';

export interface RelayPreset { id: RelayPresetId; label: string; body: (opts: { minutes?: number }) => string }

/**
 * The three lines that replace the three phone calls. Fixed wording: a preset is not a prompt, and
 * a contractor tapping "arrived" must not be able to reword it into a promise.
 */
export const RELAY_PRESETS: RelayPreset[] = [
    { id: 'arrived', label: "I've arrived", body: () => "I'm outside now." },
    { id: 'running_late', label: 'Running late', body: ({ minutes }) => `I'm running about ${Math.max(5, Math.min(120, Math.round(minutes ?? 15)))} minutes behind. On my way.` },
    { id: 'access', label: 'Which door / parking?', body: () => 'Which door should I use, and where is best to park?' },
];

export function presetBody(id: RelayPresetId, minutes?: number): string | null {
    const p = RELAY_PRESETS.find((x) => x.id === id);
    return p ? p.body({ minutes }) : null;
}

// ---------------------------------------------------------------- compose + guard (pure)

export function firstNameOf(name: string | null | undefined): string {
    const n = (name ?? '').trim();
    return n ? n.split(/\s+/)[0] : 'Your tradesperson';
}

/**
 * Pure: his words as the customer reads them. Prefixed with his first name so an unknown number on
 * her phone is a person, and run through the house voice (a dash becomes a full stop, so
 * "Craig here, I'm outside — which door?" leaves as "Craig here, I'm outside. Which door?").
 */
export function composeRelayBody(contractorName: string | null | undefined, text: string): string {
    const first = firstNameOf(contractorName);
    let words = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!words) return '';
    // A dash between two clauses becomes a full stop and a new sentence, not a comma: a message
    // from the door is two short statements ("I'm outside. Which door?"), which is also the one
    // shape the voice rules allow.
    words = words.replace(/\s*[—–]\s*|\s+-\s+/g, '. ').replace(/\.\s+([a-z])/g, (_m, c: string) => `. ${c.toUpperCase()}`);
    const alreadyIntroduced = new RegExp(`^${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(words);
    if (alreadyIntroduced) return toChatVoice(words);
    // "I" and "I'm" keep their capital when they follow the introduction; everything else drops one.
    const lead = /^I\b|^I'/.test(words) ? words : `${words[0].toLowerCase()}${words.slice(1)}`;
    return toChatVoice(`${first} here, ${lead}`);
}

export type RelayVerdict =
    | { ok: true; body: string }
    | { ok: false; hold: true; reason: string; guard: 'money' | 'date_promise'; body: string }
    | { ok: false; hold: false; reason: string; guard: 'empty' | 'too_long' | 'voice' };

/**
 * Pure: may this leave? Money and a date promise HOLD (Ben decides and sends); everything else is
 * either fine or a fixable mistake the contractor is told about on the spot.
 */
export function checkRelayBody(rawBody: string): RelayVerdict {
    const body = String(rawBody ?? '').trim();
    if (!body) return { ok: false, hold: false, reason: 'Nothing to send.', guard: 'empty' };
    if (body.length > 480) return { ok: false, hold: false, reason: 'Keep it under 480 characters. For anything longer, call the office.', guard: 'too_long' };

    const money = detectMoneyFigure(body);
    if (money) {
        return {
            ok: false, hold: true, guard: 'money', body,
            reason: `That mentions money ("${money}"), and prices are the office's to give. It has gone to Ben, who will pick it up.`,
        };
    }
    const date = detectDatePromise(body);
    if (date) {
        return {
            ok: false, hold: true, guard: 'date_promise', body,
            reason: `That commits to a date ("${date}"), and dates are booked by the office. It has gone to Ben, who will pick it up.`,
        };
    }
    // Voice is the one thing we fix rather than refuse: toChatVoice already rewrote the dashes, so a
    // violation here is a banned closer the contractor should reword himself.
    const voice = chatVoiceViolations(body);
    if (voice.length) return { ok: false, hold: false, reason: `Reword that bit: ${voice[0]}.`, guard: 'voice' };
    return { ok: true, body };
}

/** Pure: has this job used its five for today? */
export function rateLimited(sentToday: number): boolean {
    return sentToday >= RELAY_DAILY_LIMIT;
}

/** Pure: the approver for a contractor's own words. He is a person, not an agent. */
export function contractorApprover(contractorId: string): Approver {
    return `contractor:${contractorId}` as Approver;
}

// ---------------------------------------------------------------- her reply, back to him (pure)

export interface ReplyNoticeInput { firstName: string; text: string; link: string }

/**
 * Pure: the job_pack_changed-shaped notice that lands on his WhatsApp. Her first name only, her
 * words trimmed, and the link is his own portal page — never her number.
 */
export function replyNoticeBody(i: ReplyNoticeInput): string {
    const words = String(i.text ?? '').replace(/\s+/g, ' ').trim();
    const short = words.length > 160 ? `${words.slice(0, 157)}...` : words;
    return toChatVoice(`${i.firstName} replied: "${short}" ${i.link}`);
}

/** Pure: what the drawer shows. No phone number, no address, no surname: his screen carries none of it. */
export interface RelayMessageView { id: string; at: string; direction: 'out' | 'in'; body: string; heldForBen?: boolean }

export function relayView(rows: Array<{ id: string; at: Date | string | null; direction: string; body: string | null; held?: boolean }>): RelayMessageView[] {
    return rows
        .filter((r) => (r.body ?? '').trim())
        .map((r): RelayMessageView => ({
            id: String(r.id),
            at: (r.at instanceof Date ? r.at : new Date(r.at ?? 0)).toISOString(),
            direction: r.direction === 'inbound' ? 'in' : 'out',
            body: String(r.body).trim(),
            ...(r.held ? { heldForBen: true } : {}),
        }))
        .sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------- the send

export interface RelayDeps {
    /** Messages already relayed for this job today. */
    countToday: (bookingId: string) => Promise<number>;
    send: (input: { to: string; body: string; approver: Approver; runId: string; conversationId: string | null }) => Promise<{ ok: boolean; error?: string }>;
    /** Money / date: Ben gets it as a pending draft rather than the customer getting it at all. */
    queueForBen: (input: { phone: string; body: string; reason: string; runId: string }) => Promise<string | null>;
    /** Mark the thread as mid-relay so triage lanes her reply back to him. */
    markRelayOpen: (conversationId: string) => Promise<void>;
    log: (e: { kind: 'send' | 'hold'; summary: string; detail: Record<string, unknown>; phone?: string | null; conversationId?: string | null; source: string }) => Promise<void>;
    now: () => Date;
}

export interface RelayTarget {
    bookingId: string;
    contractorId: string;
    contractorName: string | null;
    customerPhone: string;
    customerName: string | null;
    conversationId: string | null;
}

export type RelayOutcome =
    | { ok: true; sent: true; body: string; remaining: number }
    | { ok: true; sent: false; held: true; body: string; reason: string; draftId: string | null }
    | { ok: false; status: number; reason: string };

/**
 * One contractor message, one decision. The order matters: rate limit before anything is composed,
 * guards before anything leaves, and a hold is still a success from his point of view (his words
 * reached the business, just not the customer).
 */
export async function relayToCustomer(target: RelayTarget, text: string, deps: RelayDeps): Promise<RelayOutcome> {
    const sentToday = await deps.countToday(target.bookingId);
    if (rateLimited(sentToday)) {
        return { ok: false, status: 429, reason: `That is ${RELAY_DAILY_LIMIT} messages on this job today. Give the office a ring for anything else.` };
    }

    const body = composeRelayBody(target.contractorName, text);
    const verdict = checkRelayBody(body);
    const runId = newRunId('relay');

    if (!verdict.ok && !verdict.hold) {
        return { ok: false, status: 400, reason: verdict.reason };
    }

    if (!verdict.ok && verdict.hold) {
        const draftId = await deps.queueForBen({
            phone: target.customerPhone, body: verdict.body, runId,
            reason: `[contractor_relay:${target.bookingId}] ${firstNameOf(target.contractorName)} wrote this to the customer from the app and the ${verdict.guard} guard held it. He has been told it is with you.`,
        }).catch(() => null);
        await deps.log({
            kind: 'hold', phone: target.customerPhone, conversationId: target.conversationId, source: 'contractor-relay',
            summary: `[contractor_relay:${target.bookingId}] held for Ben (${verdict.guard})`,
            detail: { bookingId: target.bookingId, contractorId: target.contractorId, guard: verdict.guard, runId, draftId },
        }).catch(() => undefined);
        return { ok: true, sent: false, held: true, body: verdict.body, reason: verdict.reason, draftId };
    }

    const approver = contractorApprover(target.contractorId);
    const r = await deps.send({ to: target.customerPhone, body: verdict.body, approver, runId, conversationId: target.conversationId });
    if (!r.ok) return { ok: false, status: 502, reason: r.error ?? 'That did not go through. Try again, or ring the office.' };

    if (target.conversationId) await deps.markRelayOpen(target.conversationId).catch(() => undefined);
    await deps.log({
        kind: 'send', phone: target.customerPhone, conversationId: target.conversationId, source: 'contractor-relay',
        summary: `[contractor_relay:${target.bookingId}] ${firstNameOf(target.contractorName)} messaged the customer from the app`,
        detail: { bookingId: target.bookingId, contractorId: target.contractorId, approver, runId },
    }).catch(() => undefined);
    return { ok: true, sent: true, body: verdict.body, remaining: Math.max(0, RELAY_DAILY_LIMIT - sentToday - 1) };
}

// ---------------------------------------------------------------- her reply, pushed to him

export interface NotifyReplyDeps {
    /** His WhatsApp number and his portal link for this job, or null when we cannot reach him. */
    contractor: (conversationId: string) => Promise<{ contractorId: string; name: string | null; phone: string | null; link: string; bookingId: string } | null>;
    send: (input: { to: string; body: string; runId: string; contactName: string | null }) => Promise<{ ok: boolean; error?: string }>;
    log: (e: { kind: 'send' | 'hold'; summary: string; detail: Record<string, unknown>; phone?: string | null; source: string }) => Promise<void>;
}

export type ReplyNoticeOutcome = { sent: boolean; reason: string };

/**
 * Her reply goes to his phone. Guarded with the same rule as every other contractor message
 * (job-pack-notify's guardContractorBody): no money, no phone number, no full postcode, no street,
 * no surname. A guard hit means the notice is dropped, not sanitised: he opens the app instead,
 * where the thread is already on his screen.
 */
export async function notifyContractorOfReply(conversationId: string, text: string, deps: NotifyReplyDeps): Promise<ReplyNoticeOutcome> {
    const c = await deps.contractor(conversationId).catch(() => null);
    if (!c) return { sent: false, reason: 'no active job on this thread' };
    if (!c.phone) return { sent: false, reason: 'no phone for the contractor' };

    const body = replyNoticeBody({ firstName: 'The customer', text, link: c.link });
    const bad = guardContractorBody(body, {});
    if (bad.length) {
        await deps.log({ kind: 'hold', phone: c.phone, source: 'contractor-relay', summary: `[contractor_relay:${c.bookingId}] reply notice dropped (${bad.join(', ')})`, detail: { bookingId: c.bookingId, guards: bad } }).catch(() => undefined);
        return { sent: false, reason: `guard: ${bad.join(', ')}` };
    }

    const runId = newRunId('relay');
    const r = await deps.send({ to: c.phone, body, runId, contactName: c.name });
    await deps.log({
        kind: r.ok ? 'send' : 'hold', phone: c.phone, source: 'contractor-relay',
        summary: `[contractor_relay:${c.bookingId}] customer reply ${r.ok ? 'pushed to' : 'not delivered to'} ${c.name ?? c.phone}`,
        detail: { bookingId: c.bookingId, contractorId: c.contractorId, runId, error: r.error ?? null },
    }).catch(() => undefined);
    return { sent: r.ok, reason: r.ok ? 'SENT' : (r.error ?? 'send failed') };
}

// ---------------------------------------------------------------- store

const BASE = () => (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'https://handyservices.app').replace(/\/$/, '');

/** The thread for a booking: its quote's phone against conversations, customer lane. Null when there is none. */
export async function conversationForBooking(bookingId: string): Promise<{ conversationId: string | null; phone: string | null; customerName: string | null }> {
    const { db } = await import('./db');
    const { contractorBookingRequests, personalizedQuotes, conversations } = await import('@shared/schema');
    const { eq, sql, desc, and } = await import('drizzle-orm');
    const [b] = await db.select({ quoteId: contractorBookingRequests.quoteId, name: contractorBookingRequests.customerName, phone: contractorBookingRequests.customerPhone })
        .from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);
    if (!b) return { conversationId: null, phone: null, customerName: null };
    let phone: string | null = b.phone ?? null;
    let customerName: string | null = b.name ?? null;
    if (b.quoteId) {
        const [q] = await db.select({ phone: personalizedQuotes.phone, name: personalizedQuotes.customerName })
            .from(personalizedQuotes).where(eq(personalizedQuotes.id, b.quoteId)).limit(1);
        phone = q?.phone ?? phone;
        customerName = q?.name ?? customerName;
    }
    if (!phone) return { conversationId: null, phone: null, customerName };
    const digits = phone.replace(/\D/g, '').slice(-10);
    const [conv] = await db.select({ id: conversations.id })
        .from(conversations)
        .where(and(sql`right(regexp_replace(${conversations.phoneNumber}, '\\D', '', 'g'), 10) = ${digits}`, eq(conversations.roleProfile, 'customer')))
        .orderBy(desc(conversations.updatedAt)).limit(1);
    return { conversationId: conv?.id ?? null, phone, customerName };
}

/** How many relays this job has had today (UK day), counted off the system-event log the send writes. */
export async function countRelaysToday(bookingId: string, now: Date = new Date()): Promise<number> {
    const { db } = await import('./db');
    const { systemEvents } = await import('@shared/schema');
    const { and, eq, gte, sql } = await import('drizzle-orm');
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const rows = await db.select({ id: systemEvents.id }).from(systemEvents)
        .where(and(eq(systemEvents.source, 'contractor-relay'), gte(systemEvents.at, dayStart), sql`${systemEvents.detail}->>'bookingId' = ${bookingId}`, sql`${systemEvents.summary} not like '%customer reply%'`));
    return rows.length;
}

export async function liveRelayDeps(): Promise<RelayDeps> {
    return {
        countToday: (bookingId) => countRelaysToday(bookingId),
        send: async (input) => {
            const { sendCustomerMessage } = await import('./outbound');
            const r = await sendCustomerMessage({
                approver: input.approver, runId: input.runId, to: input.to, body: input.body,
                context: 'contractor_relay', purpose: 'service_reply',
            });
            return { ok: r.ok, error: r.error };
        },
        queueForBen: async (input) => (await import('./message-drafts')).queueDraft({ phone: input.phone, body: input.body, source: 'manual', reason: input.reason, runId: input.runId, purpose: 'service_reply' }),
        markRelayOpen: async (conversationId) => {
            const { db } = await import('./db');
            const { conversations } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            const [row] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
            const current = (row?.tags as string[] | null) ?? [];
            if (current.includes(RELAY_TAG)) return;
            await db.update(conversations).set({ tags: [...current, RELAY_TAG], updatedAt: new Date() } as any).where(eq(conversations.id, conversationId));
        },
        log: async (e) => { const { logSystemEvent } = await import('./system-events'); await logSystemEvent(e as any); },
        now: () => new Date(),
    };
}

/** The contractor to push a customer reply to: the newest job on this thread he is still on. */
export async function contractorForConversation(conversationId: string): Promise<{ contractorId: string; name: string | null; phone: string | null; link: string; bookingId: string } | null> {
    const { db } = await import('./db');
    const { conversations, personalizedQuotes, contractorBookingRequests, handymanProfiles, users } = await import('@shared/schema');
    const { and, desc, eq, inArray, isNotNull, sql } = await import('drizzle-orm');
    const [conv] = await db.select({ phone: conversations.phoneNumber }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv?.phone) return null;
    const digits = conv.phone.replace(/\D/g, '').slice(-10);
    const quotes = await db.select({ id: personalizedQuotes.id }).from(personalizedQuotes)
        .where(sql`right(regexp_replace(${personalizedQuotes.phone}, '\\D', '', 'g'), 10) = ${digits}`);
    if (!quotes.length) return null;
    const [booking] = await db.select({
        id: contractorBookingRequests.id,
        contractorId: contractorBookingRequests.contractorId,
        assignedContractorId: contractorBookingRequests.assignedContractorId,
    }).from(contractorBookingRequests)
        .where(and(inArray(contractorBookingRequests.quoteId, quotes.map((q) => q.id)), isNotNull(contractorBookingRequests.scheduledDate), inArray(contractorBookingRequests.status, ['accepted', 'pending'])))
        .orderBy(desc(contractorBookingRequests.scheduledDate)).limit(1);
    const contractorId = booking?.assignedContractorId ?? booking?.contractorId ?? null;
    if (!booking || !contractorId) return null;
    const [p] = await db.select({ token: handymanProfiles.appToken, whatsapp: handymanProfiles.whatsappNumber, firstName: users.firstName, lastName: users.lastName, phone: users.phone })
        .from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id)).where(eq(handymanProfiles.id, contractorId)).limit(1);
    return {
        contractorId, bookingId: booking.id,
        name: [p?.firstName, p?.lastName].filter(Boolean).join(' ') || null,
        phone: p?.whatsapp ?? p?.phone ?? null,
        link: `${BASE()}/my-week/${p?.token ?? ''}`,
    };
}

export async function liveNotifyReplyDeps(): Promise<NotifyReplyDeps> {
    return {
        contractor: (conversationId) => contractorForConversation(conversationId),
        send: async (input) => {
            const { sendCustomerMessage } = await import('./outbound');
            const r = await sendCustomerMessage({
                approver: 'rules.job_pack', runId: input.runId, to: input.to, body: input.body,
                context: 'contractor_relay:reply', contactName: input.contactName, purpose: 'service_reply',
            });
            return { ok: r.ok, error: r.error };
        },
        log: async (e) => { const { logSystemEvent } = await import('./system-events'); await logSystemEvent(e as any); },
    };
}

/** The exchange for the drawer: his relayed messages and her replies since the first one today. */
export async function relayThreadForBooking(bookingId: string, limit = 20): Promise<RelayMessageView[]> {
    const { conversationId } = await conversationForBooking(bookingId);
    if (!conversationId) return [];
    const { db } = await import('./db');
    const { messages } = await import('@shared/schema');
    const { and, desc, eq, gte, isNull } = await import('drizzle-orm');
    const since = new Date(Date.now() - 7 * 24 * 3_600_000);
    const rows = await db.select({ id: messages.id, at: messages.createdAt, direction: messages.direction, body: messages.content })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), gte(messages.createdAt, since), isNull(messages.quarantinedAt)))
        .orderBy(desc(messages.createdAt)).limit(limit);
    return relayView(rows.map((r) => ({ id: r.id, at: r.at ?? new Date(), direction: r.direction, body: r.body })));
}
