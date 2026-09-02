/**
 * Deterministic triage pre-checks over the CUSTOMER's words (Phase 2 / C; design §3.3 "keyword
 * lexicon for money/date/complaint" runs before any model call).
 *
 * The 31 Aug incident sends were clean as TEXT and unsafe by CONTEXT: "Tell me price", "it's
 * sounding too expensive", "can someone call me before I pay", "is another day better?" each got
 * a chirpy scoping reply at SEND. The text guards read the reply; this reads the question. Any
 * exception here lanes to Ben before an agent runs. Pure, and deliberately tight — every pattern
 * has a matching "must NOT trip" case in eval-cases/absence.
 */
import type { ExceptionKind, Lane } from '../spine/types';

const MONEY = [
    /\b(how much|what('s| is| would be) the (price|cost)|price\b|prices\b|pricing\b|cost(s|ing)?\b|quote (is|was|seems)|(too?|to) (expensive|dear|much|pricey)|cheaper|discount|budget|£\s?\d)/i,
    /\b(tell me (the )?price|price\?|what do you charge|charge for|rate\b|hourly)/i,
    /£\s?\d/,
    /\b(bit|little|tad) (expensive|steep|pricey|dear|much|high)\b|\bhourly\b|\b(your|the|day) rate\b|\bdo you charge\b|\bcharge for\b/i,
];
const DATE = [
    /\b(what time|which (day|time)|when (can|could|will|are) you|what day|another day|other day|reschedule|re-?arrange|move (it|the (visit|appointment))|(am|pm) (slot|time|please)|\bam or pm\b|\bpm or am\b|morning or afternoon|earliest|soonest|availability|available (on|this|next)|slot\b)/i,
    /\b(tomorrow|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\?/i,
    /\bbetween \d{1,2}(:\d{2})? ?(am|pm)? and \d{1,2}/i,
];
const COMPLAINT = [/\b(complain(t|ing)?|unhappy|not happy|disappointed|disgust|appalling|terrible|awful|shocking|rubbish|shoddy|poor (job|work|service)|let (me|us) down|ombudsman|trading standards)\b/i];
const REFUND = [/\b(refund|money back|charge ?back|dispute the (charge|payment))\b/i];
const CALLBACK = [/\b(call me|give me a (call|ring|bell)|ring me|phone me|(can|could) (someone|you|somebody) (call|ring|phone)|speak (to|with) (someone|a person|ben)|talk (it )?through on the phone)\b/i];
const OPT_OUT = [/^\s*(stop|unsubscribe|remove me|no more (messages|texts))\b/i];
const TRUST = [/\b(is this (a )?scam|legit\b|are you (real|genuine)|(a )?real company|reviews?\b.*\?|company (number|address)\??)/i];
/** Mirrors server/spine/triage.ts RE_REGULATED: work that needs a registered trade is Ben's call. */
const REGULATED = [/\b(gas safe|gas hobs?|gas cookers?|boiler|flue|consumer unit|fuse ?box|rewir(e|ing)|asbestos|load.?bearing|structural|rsj|chimney breast)\b/i];

const RULES: Array<[ExceptionKind, RegExp[]]> = [
    ['opted_out', OPT_OUT],
    ['refund', REFUND],
    ['complaint', COMPLAINT],
    ['trust_concern', TRUST],
    ['regulated_trade', REGULATED],
    ['money_question', MONEY],
    ['date_question', DATE],
    ['callback_requested', CALLBACK],
];

/** Exceptions the customer's own words raise. Empty = nothing for Ben in the text itself. */
export function lexiconExceptions(customerText: string | null | undefined): ExceptionKind[] {
    const text = (customerText ?? '').trim();
    if (!text) return [];
    const out: ExceptionKind[] = [];
    for (const [kind, res] of RULES) if (res.some((re) => re.test(text))) out.push(kind);
    return out;
}

/** The lane the pre-checks alone would choose. Any exception → Ben; otherwise the scoper. */
export function lexiconLane(exceptions: ExceptionKind[], opts: { firstContact?: boolean; postQuote?: boolean } = {}): Lane {
    if (exceptions.includes('opted_out') || exceptions.includes('spam')) return 'dropped';
    if (exceptions.length > 0) return 'ben';
    if (opts.firstContact) return 'rules';
    return opts.postQuote ? 'post_quote' : 'scoper';
}
