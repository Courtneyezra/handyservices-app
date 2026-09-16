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
 *      format the same person appears under, and on the email address as a second key, so an
 *      opt-out holds on every channel whichever address it arrived on.
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
import { eq, and, or, isNull, isNotNull, desc, sql, inArray } from 'drizzle-orm';
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
    /** Null on a row keyed on email alone. */
    phoneKey: string | null;
    /** Null on a row keyed on the phone alone. */
    emailKey: string | null;
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

// ---------------------------------------------------------------- keys

/**
 * The ledger matches on two keys. The phone key is commsPhoneKey(). The email key is the address
 * trimmed and lowercased, with a `mailto:` and invisible marks dropped; anything that is not
 * shaped like an address is no key at all. Dots and plus tags are left alone: two addresses that
 * differ only there can be two people, and a match on the wrong one would silence a stranger.
 */
export function optOutEmailKey(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const s = raw.replace(/[​-‏‪-‮⁦-⁩]/g, '').trim().replace(/^mailto:/i, '').toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/**
 * Who a sender is asking about. A bare string is a phone number, exactly as it always was; the
 * object form names every address the sender knows the party by, so an opt-out that arrived on
 * any one of them holds on all of them.
 */
export type OptOutAddress =
    | string | null | undefined
    | { phones?: ReadonlyArray<string | null | undefined>; emails?: ReadonlyArray<string | null | undefined> };

export interface OptOutKeys { phoneKeys: string[]; emailKeys: string[] }

function uniq(values: Array<string | null>): string[] {
    return Array.from(new Set(values.filter((v): v is string => !!v)));
}

export function optOutKeysOf(who: OptOutAddress): OptOutKeys {
    if (who == null || typeof who === 'string') return { phoneKeys: uniq([commsPhoneKey(who)]), emailKeys: [] };
    return {
        phoneKeys: uniq((who.phones ?? []).map((p) => commsPhoneKey(p))),
        emailKeys: uniq((who.emails ?? []).map((e) => optOutEmailKey(e))),
    };
}

function mergeKeys(a: OptOutKeys, b: OptOutKeys): OptOutKeys {
    return { phoneKeys: uniq([...a.phoneKeys, ...b.phoneKeys]), emailKeys: uniq([...a.emailKeys, ...b.emailKeys]) };
}

function hasKeys(k: OptOutKeys): boolean {
    return k.phoneKeys.length > 0 || k.emailKeys.length > 0;
}

// ---------------------------------------------------------------- store

const STRENGTH: Record<OptOutScope, number> = { marketing: 1, all: 2 };

type OptOutRow = typeof commsOptOuts.$inferSelect;
type NewOptOutRow = typeof commsOptOuts.$inferInsert;

function toRecord(row: OptOutRow): OptOutRecord {
    return {
        id: row.id,
        phoneKey: row.phoneKey,
        emailKey: row.emailKey,
        e164: row.e164,
        scope: (row.scope as OptOutScope) ?? 'marketing',
        source: row.source,
        channel: row.channel,
        at: row.createdAt,
        matchedKeyword: row.matchedKeyword,
        triggerText: row.triggerText,
    };
}

/**
 * The strongest of the live rows that carry one of the keys. Strongest scope wins; among equals,
 * the earliest, because that is when they first asked. The store already filtered on the keys and
 * on revocation; the key filter is repeated here so the answer never rests on the query alone.
 */
export function strongestOptOut(records: OptOutRecord[], keys: OptOutKeys): OptOutRecord | null {
    const matching = records.filter((r) =>
        (r.phoneKey !== null && keys.phoneKeys.includes(r.phoneKey)) ||
        (r.emailKey !== null && keys.emailKeys.includes(r.emailKey)));
    if (!matching.length) return null;
    return matching.sort((a, b) => STRENGTH[b.scope] - STRENGTH[a.scope] || a.at.getTime() - b.at.getTime())[0];
}

/** Where the ledger reads and writes. The default is comms_opt_outs; a test passes its own. */
export interface OptOutStore {
    /** Rows not yet revoked that carry any of the keys. */
    liveRows(keys: OptOutKeys): Promise<OptOutRecord[]>;
    /**
     * Every phone and email on file for the party these keys name: a lead carrying one of the keys,
     * and the lead the conversation is linked to. One hop, never transitive.
     */
    onFile(keys: OptOutKeys, conversationId: string | null): Promise<OptOutKeys>;
    /** Insert one row. With a message id a second row for the same message is skipped and returns false. */
    insert(row: NewOptOutRow): Promise<boolean>;
    /**
     * Stamp as revoked every live row carrying any of the keys, and every live row recorded from
     * the same conversation as one of those, which is where recordOptOut's further addresses sit.
     */
    revoke(keys: OptOutKeys, revokedBy: string, note: string | null): Promise<number>;
}

/** The digit strings a stored phone column can hold for a key (commsPhoneKey folds them all to it). */
function phoneDigitForms(key: string): string[] {
    return key.length === 10 && /^[1237]/.test(key)
        ? [key, `0${key}`, `44${key}`, `0044${key}`]
        : [key, `00${key}`];
}

function keysWhere(keys: OptOutKeys) {
    const clauses = [];
    if (keys.phoneKeys.length) clauses.push(inArray(commsOptOuts.phoneKey, keys.phoneKeys));
    if (keys.emailKeys.length) clauses.push(inArray(commsOptOuts.emailKey, keys.emailKeys));
    return or(...clauses);
}

export const dbOptOutStore: OptOutStore = {
    async liveRows(keys) {
        if (!hasKeys(keys)) return [];
        const rows = await db.select().from(commsOptOuts)
            .where(and(keysWhere(keys), isNull(commsOptOuts.revokedAt)))
            .orderBy(desc(commsOptOuts.createdAt));
        return rows.map(toRecord);
    },
    async onFile(keys, conversationId) {
        const phoneForms = keys.phoneKeys.flatMap(phoneDigitForms);
        // Array parameters are bound with sql.param: a bare JS array would expand into a record.
        const rows: any = await db.execute(sql`
            SELECT l.phone, l.email FROM leads l
            WHERE regexp_replace(l.phone, '[^0-9]', '', 'g') = ANY(${sql.param(phoneForms)}::text[])
               OR lower(trim(l.email)) = ANY(${sql.param(keys.emailKeys)}::text[])
               OR l.id = (SELECT c.lead_id FROM conversations c WHERE c.id = ${conversationId ?? ''})
        `);
        const found = (rows.rows ?? rows) as Array<{ phone: string | null; email: string | null }>;
        const out: OptOutKeys = { phoneKeys: [], emailKeys: [] };
        for (const r of found) {
            const phoneKey = commsPhoneKey(r.phone);
            const emailKey = optOutEmailKey(r.email);
            if (phoneKey) out.phoneKeys.push(phoneKey);
            if (emailKey) out.emailKeys.push(emailKey);
        }
        return { phoneKeys: uniq(out.phoneKeys), emailKeys: uniq(out.emailKeys) };
    },
    async insert(row) {
        if (row.messageId) {
            const inserted = await db.insert(commsOptOuts).values(row)
                .onConflictDoNothing({ target: commsOptOuts.messageId })
                .returning({ id: commsOptOuts.id });
            return inserted.length > 0;
        }
        await db.insert(commsOptOuts).values(row);
        return true;
    },
    async revoke(keys, revokedBy, note) {
        if (!hasKeys(keys)) return 0;
        const sameConversation = db.select({ id: commsOptOuts.conversationId }).from(commsOptOuts)
            .where(and(keysWhere(keys), isNull(commsOptOuts.revokedAt), isNotNull(commsOptOuts.conversationId)));
        const rows = await db.update(commsOptOuts)
            .set({ revokedAt: new Date(), revokedBy, note })
            .where(and(or(keysWhere(keys), inArray(commsOptOuts.conversationId, sameConversation)), isNull(commsOptOuts.revokedAt)))
            .returning({ id: commsOptOuts.id });
        return rows.length;
    },
};

/** The same keys plus what is on file for them. A failed lookup keeps the keys the caller gave and says so loudly. */
async function withOnFile(keys: OptOutKeys, conversationId: string | null, store: OptOutStore, why: string): Promise<OptOutKeys> {
    try {
        return mergeKeys(keys, await store.onFile(keys, conversationId));
    } catch (error: any) {
        console.error(`[OptOut] Could not read the addresses on file while ${why}; only the address given is covered:`, error?.message);
        return keys;
    }
}

/** The strongest live suppression for a person, or null. Reads the log; never a cached flag. */
export async function getOptOut(who: OptOutAddress, store: OptOutStore = dbOptOutStore): Promise<OptOutRecord | null> {
    const keys = optOutKeysOf(who);
    if (!hasKeys(keys)) return null;
    return strongestOptOut(await store.liveRows(keys), keys);
}

/**
 * The one question every sender asks: may I send this? Returns the record that blocks the send, or
 * null when it may proceed. An opt-out recorded against any address the sender names blocks it,
 * on whichever channel the send is going out.
 *
 * An omitted purpose is 'marketing' — fail closed.
 */
export async function blockedByOptOut(
    who: OptOutAddress,
    purpose: OutboundPurpose = 'marketing',
    store: OptOutStore = dbOptOutStore,
): Promise<OptOutRecord | null> {
    const record = await getOptOut(who, store);
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

/**
 * All live suppressions as a lookup, for bulk tools that would otherwise do one query per person.
 * Keyed by phone key and by email key alike; the two never collide, because only an email key
 * holds an `@`.
 */
export async function loadOptOutIndex(): Promise<Map<string, OptOutRecord>> {
    const rows = await db.select().from(commsOptOuts).where(isNull(commsOptOuts.revokedAt));
    const index = new Map<string, OptOutRecord>();
    for (const row of rows) {
        const record = toRecord(row);
        for (const key of [record.phoneKey, record.emailKey]) {
            if (!key) continue;
            const existing = index.get(key);
            if (!existing || STRENGTH[record.scope] > STRENGTH[existing.scope]) index.set(key, record);
        }
    }
    return index;
}

export interface RecordOptOutInput {
    /** The address the opt-out arrived on, or the party's known addresses. At least one must be usable. */
    phone?: string | null;
    email?: string | null;
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
 * Write a suppression. Idempotent per triggering message (the unique index on message_id), so a
 * redelivered webhook or a re-run backfill adds nothing.
 *
 * An opt-out is the party's, not the address's: the phones and emails on file for the party are
 * covered too, whichever of them it arrived on. The first row carries the address it arrived on
 * and the first address of the other kind; every further address on file gets a row of its own
 * with the same scope and evidence, so each is matched on its own key.
 *
 * Returns `created: false` when the row already existed — the caller still treats the person as
 * suppressed, it just did not learn anything new.
 */
export async function recordOptOut(
    input: RecordOptOutInput,
    store: OptOutStore = dbOptOutStore,
): Promise<{ created: boolean; id: string | null; key: string | null; keys: OptOutKeys }> {
    const given = optOutKeysOf({ phones: [input.phone], emails: [input.email] });
    if (!hasKeys(given)) {
        console.warn('[OptOut] Cannot record an opt-out without a usable phone number or email address.');
        return { created: false, id: null, key: null, keys: given };
    }
    const keys = await withOnFile(given, input.conversationId ?? null, store, 'recording an opt-out');

    const newId = () => `optout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const evidence = {
        scope: input.scope,
        source: input.source,
        channel: input.channel ?? null,
        conversationId: input.conversationId ?? null,
        contactName: input.contactName ?? null,
        matchedKeyword: input.matchedKeyword ?? null,
        matchRule: input.matchRule ?? null,
        // Kept verbatim (capped): this is the evidence for "what exactly did they say?".
        triggerText: input.triggerText ? input.triggerText.slice(0, 2000) : null,
    };
    const rowFor = (phoneKey: string | null, emailKey: string | null) => ({
        id: newId(),
        phoneKey,
        emailKey,
        e164: phoneKey ? e164FromCommsKey(phoneKey) : null,
        ...evidence,
    });

    const [phoneKey = null, ...morePhones] = keys.phoneKeys;
    const [emailKey = null, ...moreEmails] = keys.emailKeys;
    const primary = { ...rowFor(phoneKey, emailKey), messageId: input.messageId ?? null, note: input.note ?? null };
    const created = await store.insert(primary);
    // A redelivered message wrote its rows the first time round.
    if (created) {
        const also = `covers another address on file for the party in ${primary.id}`;
        const extras = [...morePhones.map((k) => rowFor(k, null)), ...moreEmails.map((k) => rowFor(null, k))];
        for (const extra of extras) {
            try {
                await store.insert({ ...extra, messageId: null, note: also });
            } catch (error: any) {
                console.error(`[OptOut] Recorded ${primary.id} but could not cover ${extra.phoneKey ?? extra.emailKey} on a row of its own:`, error?.message);
            }
        }
    }
    return { created, id: created ? primary.id : null, key: phoneKey ?? emailKey, keys };
}

/**
 * Lift a suppression. Never deletes: the original rows stay, stamped with who lifted them. Lifts
 * it for the party, on every address on file and every row recorded from the same conversation,
 * as recordOptOut wrote it.
 */
export async function revokeOptOut(who: OptOutAddress, revokedBy: string, note?: string, store: OptOutStore = dbOptOutStore): Promise<number> {
    const given = optOutKeysOf(who);
    if (!hasKeys(given)) return 0;
    const keys = await withOnFile(given, null, store, 'lifting an opt-out');
    return store.revoke(keys, revokedBy, note ?? null);
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
        SELECT scope, count(DISTINCT coalesce(phone_key, email_key))::int AS n
        FROM comms_opt_outs WHERE revoked_at IS NULL GROUP BY scope
    `);
    const out = { marketing: 0, all: 0 };
    for (const r of (rows.rows ?? rows)) {
        if (r.scope === 'all') out.all = Number(r.n);
        else out.marketing = Number(r.n);
    }
    return out;
}
