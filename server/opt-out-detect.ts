/**
 * Deciding whether an inbound message is an opt-out, with nothing else attached: no database, so
 * the new desk (server/comms-v2/desk/desk.ts) can read it on every turn without opening one.
 * server/opt-out.ts re-exports all of it and holds the ledger; the reasoning behind the scopes and
 * the conservative matching is there and below.
 */

export const OPT_OUT_SCOPES = ['marketing', 'all'] as const;
export type OptOutScope = (typeof OPT_OUT_SCOPES)[number];

export interface OptOutMatch {
    scope: OptOutScope;
    /** The words that fired, for the audit row. */
    keyword: string;
    rule: 'exact' | 'phrase';
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
    // Added 16 Sep 2026 (overnight round 19): the short forms people text, and a bare "stop" with a word after it.
    'stop now', 'stop it', 'stop msg', 'stop msgs', 'stop msging', 'stop msging me', 'stop txt', 'stop txts',
    'stop txting', 'stop txting me', 'stop sms', 'stop sending texts',
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
    'dont text me', 'do not text me', 'dont text me again', 'do not text me again',
    'dont message me again', 'do not message me again',
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

/**
 * "Don't text me again" and its kin, as phrases. Consulted only when the message does not go on to
 * name another way to reach them: "don't text me again, just call me" is a channel preference, not
 * an opt-out. Added 16 Sep 2026 (overnight round 19).
 */
const PHRASE_ALL_UNLESS_REDIRECT = [
    'dont text me again', 'do not text me again', 'dont message me again', 'do not message me again',
    'dont text me anymore', 'dont text me any more', 'do not text me anymore', 'do not text me any more',
    'dont message me anymore', 'dont message me any more', 'do not message me anymore', 'do not message me any more',
];
const REDIRECT = /\b(call|ring|phone|email|e mail|whatsapp|instead)\b/;

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
    'take my number off', 'take my details off',
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

/**
 * A bare stop said alongside the reason for it: "Wrong number, please stop", "Stop, found someone
 * else", "Stop please I'm not interested". The bare keyword alone stays whole-message only; these
 * reasons are what make it unambiguous, and they never describe a job. Added 16 Sep 2026.
 */
const BARE_STOP = new Set(['stop', 'stop it', 'stop now', 'stop please', 'please stop', 'stop thanks', 'stop stop']);
const STOP_REASON = /^(?:(?:i|im|i am|we are|were|sorry|but|as|because|cos|coz|ive|weve|i have|we have|already|just)\s+)*(?:wrong number|not interested|found someone|found somebody|got someone|not needed|no longer need|dont need|didnt ask|never asked|who is this|who are you|sorted|all sorted)\b/;
const CLAUSE_BREAK = /[,.;:!?\n]+|\s[-–—]+\s?/;

function stopWithReason(text: string): boolean {
    const clauses = text.split(CLAUSE_BREAK).map(normaliseForMatch).filter(Boolean);
    if (clauses.length >= 2) {
        const first = clauses[0];
        const last = clauses[clauses.length - 1];
        if (BARE_STOP.has(first) && clauses.slice(1).some((c) => STOP_REASON.test(c))) return true;
        if (BARE_STOP.has(last) && clauses.slice(0, -1).some((c) => STOP_REASON.test(c))) return true;
    }
    // Unpunctuated: "stop please im not interested". The reason must follow the keyword directly, so
    // "stop cock not needed" is not read as one.
    const whole = normaliseForMatch(text);
    const m = /^(?:please )?stop(?: it| now| please| thanks)? (.+)$/.exec(whole);
    return !!m && STOP_REASON.test(m[1]);
}

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
    if (!REDIRECT.test(s)) {
        for (const p of PHRASE_ALL_UNLESS_REDIRECT) if (s.includes(p)) return { scope: 'all', keyword: p, rule: 'phrase' };
    }
    for (const p of PHRASE_MARKETING) if (s.includes(p)) return { scope: 'marketing', keyword: p, rule: 'phrase' };
    if (stopWithReason(text)) return { scope: 'marketing', keyword: 'stop', rule: 'phrase' };

    return null;
}
