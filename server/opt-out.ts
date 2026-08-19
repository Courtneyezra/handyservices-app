/**
 * OPT-OUT: making "Reply STOP" mean something.
 *
 * Four approved WhatsApp templates on this account end with an opt-out instruction. Until this
 * module existed, nothing in the codebase listened for the reply: there was no suppression list, no
 * keyword detection on any of the three inbound ingest paths, and the outbound router consulted
 * nothing. A STOP would have landed on the board as an ordinary card and been archived with the
 * rest. Under UK PECR the opt-out mechanism has to actually work, and advertising one that does not
 * is worse than offering none: it turns a compliant send into a documented breach, and it is the
 * single easiest thing for a complainant to evidence.
 *
 * Three jobs live here, and nothing else:
 *
 *   1. DETECT — decide whether an inbound message is an opt-out. Deliberately conservative (see
 *      detectOptOut). This is a trades business: "can you stop the leak" and "stop by on Tuesday"
 *      are normal customer messages, and silencing a live customer because they used the word stop
 *      is its own harm.
 *   2. RECORD — write it down, keyed on the normalised phone identity so it holds across every
 *      format the same person appears under.
 *   3. ANSWER "may I send to this person?" — one function, consulted by the outbound router, the
 *      approval queue and every bulk tool.
 *
 * WHAT THIS MODULE NEVER DOES: reply. A second message to someone who just asked for no more
 * messages is precisely the wrong move, and on the SMS path Twilio already sends its own
 * acknowledgement. Silence is the correct acknowledgement here.
 *
 * SCOPE — the judgement call, spelled out because it will be re-litigated:
 *
 *   'marketing'  A plain STOP / UNSUBSCRIBE. Blocks everything we chose to start: campaigns, bulk
 *                revival, promotional templates, the board clear-out. It does NOT block a service
 *                reply, because PECR governs direct marketing, not the performance of a contract. A
 *                customer with a job booked next Tuesday who taps STOP after a marketing blast still
 *                needs the answer to their own question and their booking confirmation. Refusing
 *                those would be hiding behind compliance while abandoning a live obligation.
 *   'all'        An explicit "do not contact me" / "delete my number" / "leave me alone". This
 *                person asked to be left alone, full stop. Nothing automated reaches them, service
 *                replies included, and the only way past it is a human deciding to pick up the
 *                phone outside this system.
 *
 * A plain STOP defaults to 'marketing' because that is what the advertised keyword promises — the
 * instruction sits at the bottom of a marketing template, so the reply answers that template.
 */
import { db } from './db';
import { commsOptOuts, conversations } from '@shared/schema';
import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { commsPhoneKey, e164FromCommsKey } from './phone-utils';

// ---------------------------------------------------------------- types

export const OPT_OUT_SCOPES = ['marketing', 'all'] as const;
export type OptOutScope = (typeof OPT_OUT_SCOPES)[number];

/**
 * Why a message is being sent. THE DEFAULT IS 'marketing' EVERYWHERE — an omitted purpose is
 * treated as the suppressible kind, so a new call site that forgets to think about opt-outs fails
 * closed rather than quietly messaging someone who asked us to stop.
 *
 * 'service_reply' is the deliberate exception and it is meant to be hard to reach by accident: it
 * has to be typed at the call site, it is greppable, it never bypasses an 'all' suppression, and
 * every use of it against a suppressed number is logged loudly. It belongs on exactly two kinds of
 * traffic: a human's own typed reply from the comms composer, and a message the job itself requires
 * (booking confirmation, contractor on the way, invoice for work done).
 */
export type OutboundPurpose = 'marketing' | 'service_reply';

export interface OptOutMatch {
    scope: OptOutScope;
    /** The words that fired, for the audit row. */
    keyword: string;
    rule: 'exact' | 'phrase';
}

export interface OptOutRecord {
    id: string;
    phoneKey: string;
    e164: string | null;
    scope: OptOutScope;
    source: string;
    channel: string | null;
    at: Date;
    matchedKeyword: string | null;
    triggerText: string | null;
}

// ---------------------------------------------------------------- detection

/**
 * Politeness wrappers that carry no meaning. Stripped so "please stop" and "stop thanks" are read
 * as the bare keyword they are, without loosening the whole-message rule that keeps "can you stop
 * the leak" out.
 */
// 'no' is deliberately NOT in this list: stripping it would turn "no more messages" into "more
// messages" and lose a real opt-out. Every other word here is inert at the start of a stop keyword.
const LEADING_NOISE = /^(please|pls|plz|hi|hey|hello|yeah|yes|ok|okay)\s+/;
const TRAILING_NOISE = /\s+(please|pls|plz|thanks|thank you|thankyou|thx|ta|cheers|mate)$/;

/**
 * Whole-message opt-outs. A message that IS one of these and nothing else. This is where the bare
 * keywords live, because a bare keyword is only unambiguous when it is the entire message.
 *
 * NOT HERE, on purpose:
 *   'cancel'  — Twilio treats it as a stop keyword, but in a handyman's inbox "cancel" overwhelmingly
 *               means cancel my booking. Suppressing a customer who was trying to move a job would
 *               be a worse failure than missing an opt-out, and anyone who means it will also say
 *               stop or unsubscribe.
 *   'remove'  — "remove" alone is as likely to be about an old tap or a radiator.
 */
const EXACT_MARKETING = [
    'stop', 'stopp', 'stop stop',
    'unsubscribe', 'unsub', 'unsubscribe me',
    'optout', 'opt out', 'opt me out',
    'end', 'quit',
    'remove me', 'take me off', 'take me off your list', 'take me off the list',
    // 'no more' on its own is absent deliberately: it is the natural answer to "anything else?".
    'no more messages', 'no more texts', 'no more msgs',
    'stop messages', 'stop messaging', 'stop messaging me',
    'stop texting', 'stop texting me', 'stop text',
    'stop contacting me', 'stop emails',
    'stop sending messages', 'stop sending me messages', 'stop sending me texts',
];

/** Whole-message "leave me alone entirely". Stronger than a plain STOP, so it suppresses everything. */
const EXACT_ALL = [
    'stop all', 'stopall',
    'do not contact', 'do not contact me', 'dont contact', 'dont contact me',
    'do not message me', 'dont message me', 'do not call me', 'dont call me again',
    'delete my number', 'delete my details', 'delete my data',
    'remove my number', 'remove my details',
    'lose my number', 'leave me alone',
    'never contact me', 'never contact me again', 'never message me again',
];

/**
 * Phrases that are unambiguous even with a few words of context around them ("please can you
 * unsubscribe me from this"). Only consulted on a SHORT message — see detectOptOut — because the
 * same words inside a long job description are context, not an instruction.
 *
 * Every entry is a full phrase, never a bare verb. 'stop sending' is deliberately absent: "can you
 * stop sending someone round on Fridays" is a scheduling request, not an opt-out.
 */
const PHRASE_ALL = [
    'do not contact', 'dont contact me', 'do not ever contact', 'never contact me',
    'delete my number', 'delete my details', 'remove my number', 'lose my number',
    'leave me alone', 'stop all messages', 'stop all contact',
];

const PHRASE_MARKETING = [
    'unsubscribe',
    'opt out', 'opt me out', 'opted out',
    'stop messaging', 'stop texting', 'stop contacting',
    'stop sending me messages', 'stop sending me texts', 'stop sending me anything',
    // Added 19 Aug 2026 after an adversarial pass: "please stop sending me these messages" and
    // "stop sending me these texts please" both missed, and they are what a real person types.
    // 'stop sending' alone stays out — "stop sending someone round on Fridays" is a job request.
    'stop sending me these', 'stop sending these', 'stop sending any more',
    'stop these messages', 'stop the messages', 'stop these texts', 'stop the texts',
    'no more messages', 'no more texts', 'no more marketing',
    'any more of these messages', 'any more of these texts', 'any more of these',
    'take me off your list', 'take me off the list', 'take me off your mailing list',
    'take me off this list', 'take me off your database',
    'remove me from your list', 'remove me from the list', 'remove me from your database',
    'remove me from your mailing list', 'remove me from this list',
    'no longer wish to receive', 'do not wish to receive', 'dont want any more messages',
    'stop the marketing', 'stop spamming', 'stop spamming me',
];

/**
 * A short message. The threshold is what keeps this conservative: an opt-out is a terse instruction,
 * and anybody writing three sentences about their boiler is not opting out even if the word stop is
 * in there somewhere.
 */
const SHORT_CHARS = 90;
const SHORT_WORDS = 14;

/** Lowercase, drop invisible marks and apostrophes, turn punctuation and emoji into spaces. */
function normaliseForMatch(text: string): string {
    return text
        .replace(/[​-‏‪-‮⁦-⁩]/g, '')
        .toLowerCase()
        .replace(/['‘’`]/g, '')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Is this inbound message an opt-out? Returns null for everything that is not clearly one.
 *
 * Two rules, both conservative:
 *   EXACT   the whole message (minus a politeness wrapper) is a stop keyword. This is the only way
 *           a bare word like "stop" or "end" can ever match.
 *   PHRASE  a full unambiguous phrase inside a SHORT message. Never a bare verb.
 *
 * The cases this must get right, and does:
 *   "STOP"                        → opt-out (marketing)
 *   "please stop, thanks"         → opt-out (marketing)
 *   "do not contact me again"     → opt-out (all)
 *   "can you stop the leak"       → NOT an opt-out
 *   "stop by on Tuesday"          → NOT an opt-out
 *   "the tap won't stop dripping" → NOT an opt-out
 */
export function detectOptOut(text: string | null | undefined): OptOutMatch | null {
    if (!text) return null;
    let s = normaliseForMatch(text);
    if (!s) return null;

    // "S T O P" and "S.T.O.P" are the same instruction typed by someone making a point. A message
    // that is nothing but single letters separated by spaces gets them joined back up before the
    // keyword lists see it. Anything longer or mixed is left exactly as it was.
    if (/^(?:[a-z] ){2,}[a-z]$/.test(s)) s = s.replace(/ /g, '');

    // Strip a politeness wrapper from each end, repeatedly ("please please stop thanks mate").
    for (let i = 0; i < 3; i++) {
        const before = s;
        s = s.replace(LEADING_NOISE, '').replace(TRAILING_NOISE, '').trim();
        if (s === before) break;
    }
    if (!s) return null;

    // EXACT — strongest scope first, so "stop all" is 'all' and not merely 'marketing'.
    if (EXACT_ALL.includes(s)) return { scope: 'all', keyword: s, rule: 'exact' };
    if (EXACT_MARKETING.includes(s)) return { scope: 'marketing', keyword: s, rule: 'exact' };

    // PHRASE — short messages only.
    const words = s.split(' ').length;
    if (s.length > SHORT_CHARS || words > SHORT_WORDS) return null;

    for (const p of PHRASE_ALL) if (s.includes(p)) return { scope: 'all', keyword: p, rule: 'phrase' };
    for (const p of PHRASE_MARKETING) if (s.includes(p)) return { scope: 'marketing', keyword: p, rule: 'phrase' };

    return null;
}

// ---------------------------------------------------------------- store

const STRENGTH: Record<OptOutScope, number> = { marketing: 1, all: 2 };

function toRecord(row: typeof commsOptOuts.$inferSelect): OptOutRecord {
    return {
        id: row.id,
        phoneKey: row.phoneKey,
        e164: row.e164,
        scope: (row.scope as OptOutScope) ?? 'marketing',
        source: row.source,
        channel: row.channel,
        at: row.createdAt,
        matchedKeyword: row.matchedKeyword,
        triggerText: row.triggerText,
    };
}

/** The strongest live suppression for a person, or null. Reads the log; never a cached flag. */
export async function getOptOut(phone: string | null | undefined): Promise<OptOutRecord | null> {
    const key = commsPhoneKey(phone);
    if (!key) return null;
    const rows = await db.select().from(commsOptOuts)
        .where(and(eq(commsOptOuts.phoneKey, key), isNull(commsOptOuts.revokedAt)))
        .orderBy(desc(commsOptOuts.createdAt));
    if (!rows.length) return null;
    // Strongest scope wins; among equals, the earliest, because that is when they first asked.
    return rows
        .map(toRecord)
        .sort((a, b) => STRENGTH[b.scope] - STRENGTH[a.scope] || a.at.getTime() - b.at.getTime())[0];
}

/**
 * The one question every sender asks: may I send this? Returns the record that blocks the send, or
 * null when it may proceed.
 *
 * An omitted purpose is 'marketing' — fail closed.
 */
export async function blockedByOptOut(
    phone: string | null | undefined,
    purpose: OutboundPurpose = 'marketing',
): Promise<OptOutRecord | null> {
    const record = await getOptOut(phone);
    if (!record) return null;
    if (record.scope === 'all') return record;             // nothing gets through, service included
    return purpose === 'service_reply' ? null : record;    // a plain STOP blocks marketing only
}

/** Human-readable, and the same words wherever a refusal surfaces. */
export function optOutRefusalMessage(record: OptOutRecord): string {
    const when = record.at.toISOString().slice(0, 10);
    return record.scope === 'all'
        ? `This person asked us not to contact them at all (${when}). Nothing may be sent to them from this system.`
        : `This person opted out of marketing on ${when}. Campaigns and bulk outreach are blocked. A service reply to their own enquiry is still allowed.`;
}

/** All live suppressions as a lookup, for bulk tools that would otherwise do one query per person. */
export async function loadOptOutIndex(): Promise<Map<string, OptOutRecord>> {
    const rows = await db.select().from(commsOptOuts).where(isNull(commsOptOuts.revokedAt));
    const index = new Map<string, OptOutRecord>();
    for (const row of rows) {
        const record = toRecord(row);
        const existing = index.get(record.phoneKey);
        if (!existing || STRENGTH[record.scope] > STRENGTH[existing.scope]) index.set(record.phoneKey, record);
    }
    return index;
}

export interface RecordOptOutInput {
    phone: string;
    scope: OptOutScope;
    source: 'inbound_keyword' | 'backfill' | 'manual';
    channel?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    contactName?: string | null;
    matchedKeyword?: string | null;
    matchRule?: 'exact' | 'phrase' | null;
    triggerText?: string | null;
    note?: string | null;
}

/**
 * Write a suppression. Idempotent per triggering message (the partial unique index on message_id),
 * so a redelivered webhook or a re-run backfill adds nothing.
 *
 * Returns `created: false` when the row already existed — the caller still treats the person as
 * suppressed, it just did not learn anything new.
 */
export async function recordOptOut(input: RecordOptOutInput): Promise<{ created: boolean; id: string | null; key: string | null }> {
    const key = commsPhoneKey(input.phone);
    if (!key) {
        console.warn('[OptOut] Cannot record an opt-out for an unusable number:', input.phone);
        return { created: false, id: null, key: null };
    }

    const id = `optout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const values = {
        id,
        phoneKey: key,
        e164: e164FromCommsKey(key),
        scope: input.scope,
        source: input.source,
        channel: input.channel ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        contactName: input.contactName ?? null,
        matchedKeyword: input.matchedKeyword ?? null,
        matchRule: input.matchRule ?? null,
        // Kept verbatim (capped): this is the evidence for "what exactly did they say?".
        triggerText: input.triggerText ? input.triggerText.slice(0, 2000) : null,
        note: input.note ?? null,
    };

    if (input.messageId) {
        const inserted = await db.insert(commsOptOuts).values(values)
            .onConflictDoNothing({ target: commsOptOuts.messageId })
            .returning({ id: commsOptOuts.id });
        return { created: inserted.length > 0, id: inserted[0]?.id ?? null, key };
    }

    await db.insert(commsOptOuts).values(values);
    return { created: true, id, key };
}

/** Lift a suppression. Never deletes: the original row stays, stamped with who lifted it. */
export async function revokeOptOut(phone: string, revokedBy: string, note?: string): Promise<number> {
    const key = commsPhoneKey(phone);
    if (!key) return 0;
    const rows = await db.update(commsOptOuts)
        .set({ revokedAt: new Date(), revokedBy, note: note ?? null })
        .where(and(eq(commsOptOuts.phoneKey, key), isNull(commsOptOuts.revokedAt)))
        .returning({ id: commsOptOuts.id });
    return rows.length;
}

// ---------------------------------------------------------------- the inbound hook

export interface InboundOptOutResult {
    matched: boolean;
    scope?: OptOutScope;
    keyword?: string;
    rule?: 'exact' | 'phrase';
    /** False when this person was already suppressed by an earlier message. */
    newlyRecorded?: boolean;
}

/**
 * Run on every stored inbound message, ahead of everything else the inbound lane does.
 *
 * On a match it records the suppression, tags the conversation and closes the card — and then stops
 * the lane. Nothing is drafted, nothing is acknowledged, nothing is sent. A person who has just
 * asked for no more messages must not receive one, and the first-contact auto-acknowledger would
 * otherwise cheerfully reply to a STOP that happened to be someone's first message to us.
 *
 * Exception-proof by contract: this sits in the ingest path, and a suppression failure must never
 * cost us the customer's message.
 */
export async function applyInboundOptOut(input: {
    conversationId: string;
    phone: string;
    text?: string | null;
    channel?: string | null;
    messageId?: string | null;
    contactName?: string | null;
}): Promise<InboundOptOutResult> {
    const match = detectOptOut(input.text);
    if (!match) return { matched: false };

    const written = await recordOptOut({
        phone: input.phone,
        scope: match.scope,
        source: 'inbound_keyword',
        channel: input.channel ?? null,
        conversationId: input.conversationId || null,
        messageId: input.messageId ?? null,
        contactName: input.contactName ?? null,
        matchedKeyword: match.keyword,
        matchRule: match.rule,
        triggerText: input.text ?? null,
    });

    // Make it visible on the board rather than only in a table: tag the thread and close the card.
    // Closing is right even mid-conversation — there is nothing left for Ben to do here, and a card
    // sitting in 'new' would generate SLA pressure to reply to someone who asked us not to.
    if (input.conversationId) {
        try {
            const [conv] = await db.select({ tags: conversations.tags }).from(conversations)
                .where(eq(conversations.id, input.conversationId));
            const tags = new Set<string>([...(conv?.tags ?? []), 'opted_out']);
            if (match.scope === 'all') tags.add('do_not_contact');
            await db.update(conversations)
                .set({ tags: [...tags], stage: 'closed', updatedAt: new Date() })
                .where(eq(conversations.id, input.conversationId));
        } catch (error: any) {
            // The suppression is already written, which is the part that matters legally.
            console.error('[OptOut] Recorded the opt-out but could not tag/close the thread:', error?.message);
        }
    }

    console.warn(
        `[OptOut] ${input.phone} opted out (${match.scope}) via "${match.keyword}" on ${input.channel ?? 'unknown'} — ` +
        `${written.created ? 'recorded' : 'already suppressed'}. Nothing will be sent in reply.`,
    );

    return { matched: true, scope: match.scope, keyword: match.keyword, rule: match.rule, newlyRecorded: written.created };
}

/**
 * Which conversation ids belong to suppressed people. Used by the thread view and by anything that
 * needs to badge a board card without a query per row.
 */
export async function optOutsByConversation(conversationIds: string[]): Promise<Map<string, OptOutRecord>> {
    if (!conversationIds.length) return new Map();
    const convs = await db.select({ id: conversations.id, phone: conversations.phoneNumber })
        .from(conversations).where(inArray(conversations.id, conversationIds));
    const index = await loadOptOutIndex();
    const out = new Map<string, OptOutRecord>();
    for (const c of convs) {
        const key = commsPhoneKey(c.phone);
        const record = key ? index.get(key) : undefined;
        if (record) out.set(c.id, record);
    }
    return out;
}

/** Count of live suppressions, for ops output. */
export async function countOptOuts(): Promise<{ marketing: number; all: number }> {
    const rows: any = await db.execute(sql`
        SELECT scope, count(DISTINCT phone_key)::int AS n
        FROM comms_opt_outs WHERE revoked_at IS NULL GROUP BY scope
    `);
    const out = { marketing: 0, all: 0 };
    for (const r of (rows.rows ?? rows)) {
        if (r.scope === 'all') out.all = Number(r.n);
        else out.marketing = Number(r.n);
    }
    return out;
}
