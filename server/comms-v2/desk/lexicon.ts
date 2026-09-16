/**
 * The desk's deterministic matchers, shared by the router's belts, the guards and the Scoping
 * tools. No model. Written from the contracts and the checklist, not imported from the old desk:
 * the old desk is being replaced and these must outlive it.
 */

/** Only gas and asbestos are out of scope (behaviour.md, checklist cross-cutting 5). Plumbing, roofing, structural and electrical are ours. */
export const RE_REGULATED = /\b(?:gas(?:\s|-)?(?:boiler|hob|cooker|fire|meter|pipe|leak|safe|engineer|supply|work|appliance|heater)|boiler\b(?![^.?!]*\b(?:cupboard|casing|box)\b)|gas\b|asbestos|artex(?:\s+\w+)?\s+(?:ceiling|test)|corgi)\b/i;

export function regulatedMatch(text: string): string | null {
    const m = RE_REGULATED.exec(text);
    return m ? m[0] : null;
}

/** A figure of money. */
export const RE_FIGURE = /(?:£\s*\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:pounds?|quid|gbp)\b)|(?:\b\d+p\b)/i;

/** A money question beyond a quote line: how much, cost, price, cheaper, discount. "A quote for X" is an enquiry, not a money question. */
export const RE_MONEY_QUESTION = /\b(?:how much|cost(?:s|ing)?|price[sd]?|pricing|charge[sd]?|ballpark|rough(?:ly)?\s+(?:idea|figure|cost|price|estimate)|estimate\b|cheap(?:er|est)?|expensive|discount|any cheaper|do it for less|knock (?:some|a bit) off|call[- ]?out fee|hourly rate|day rate|deposit)\b|£\s*\d/i;

export function moneyQuestionMatch(text: string): string | null {
    const m = RE_MONEY_QUESTION.exec(text);
    return m ? m[0] : null;
}

/** Haggling, a discount or terms of payment: money that is Ben's whatever the quote says, never a plain ask of its own price. */
export const RE_HAGGLE = /\b(?:discount(?:s|ed)?|cheap(?:er|est)?|(?:for|any) less\b|knock(?:ed)?\s+\w+(?:\s+\w+)?\s+off|best (?:price|deal|offer|you can do|you could do)|better (?:price|deal|offer)|lower|reduc(?:e|ed|tion)|negotiat\w*|mates'? rates|cash (?:price|in hand)|price match|match (?:it|that|the|their)|beat (?:it|that|the|their)|too (?:expensive|much|dear|pricey|steep)|expensive|pricey|instal(?:l)?ments?|payment plan|pay (?:monthly|later|in parts|in stages|weekly))\b/i;

export function haggleMatch(text: string): string | null {
    const m = RE_HAGGLE.exec(text);
    return m ? m[0] : null;
}

const PLAIN_THING = `(?:(?:that|the|this|your|my|our)\\s+)?(?:(?:quoted?|total|original|old)\\s+)?(?:price|quote|cost|total|figure|amount|£x)`;
const PLAIN_TAIL = '(?:\\s+(?:now|again|then|please|still|today|at the moment))*';
const PLAIN_ASKS = [
    `(?:is|are)\\s+${PLAIN_THING}(?:\\s+still)?\\s+(?:ok|okay|right|valid|good|correct|current|the same|standing|available|on)`,
    `(?:does|will|would)\\s+${PLAIN_THING}\\s+still\\s+(?:stand|apply|be (?:ok|okay|right|valid|the same))`,
    `(?:is|has)\\s+${PLAIN_THING}\\s+(?:changed|gone up|different)`,
    `(?:and\\s+)?how much\\s+(?:is|was|would|will)\\s+(?:it|that|this|the (?:quote|job|work|total|price))(?:\\s+be)?`,
    `(?:and\\s+)?what(?:'s|\\s+is|\\s+was|\\s+would be|\\s+will be)\\s+(?:the|my|your)\\s+(?:total|price|cost|quote)`,
    `what does (?:it|that|the job) cost`,
    `(?:can|could) you (?:confirm|remind me of) ${PLAIN_THING}`,
];
const RE_PLAIN_CLAUSE = new RegExp(`^(?:${PLAIN_ASKS.join('|')})${PLAIN_TAIL}$`, 'i');
const RE_PLEASANTRY = /^(?:hi|hiya|hello|hey|morning|afternoon|evening|ok|okay|thanks|thank you|cheers|sorry|quick question|just checking|just wondering)(?:\s+(?:there|again|mate|ben))?$/i;
const RE_ANY_FIGURE = /£\s*(\d[\d,]*(?:\.\d{1,2})?)/g;

const toPence = (amount: string): number => Math.round(Number(amount.replace(/,/g, '')) * 100);

/**
 * Whether a whole message is nothing but a plain ask of a quote's own price or whether it still
 * stands ("is that price still ok?", "how much is it now?", "is the £120 still right?"), with at most
 * a greeting or a thanks beside it. Fails closed: every clause must be one of those asks or a
 * pleasantry, every figure it names must be one of `quotedPence`, and anything haggling
 * (`haggleMatch`) is never plain.
 */
export function plainPriceAsk(text: string, quotedPence: readonly number[]): boolean {
    if (haggleMatch(text)) return false;
    for (const m of Array.from(text.matchAll(RE_ANY_FIGURE))) if (!quotedPence.includes(toPence(m[1]))) return false;
    const clauses = text.replace(RE_ANY_FIGURE, '£x').toLowerCase().replace(/[’`]/g, "'").split(/[?!.,;:\n]+|\s+-\s+/).map((c) => c.trim().replace(/\s+/g, ' ')).filter(Boolean);
    let asked = false;
    for (const c of clauses) {
        if (RE_PLAIN_CLAUSE.test(c)) asked = true;
        else if (!RE_PLEASANTRY.test(c)) return false;
    }
    return asked;
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)day';
const WEEKDAY_ABBR = '(?:mon|tues?|weds?|thur?s?|fri|sat|sun)';
const BEFORE = '(?:on|this|next|by|for|from|until|till|every|coming)';
const AFTER = '(?:morning|afternoon|evening|night|week|\\d{1,2}(?:st|nd|rd|th))';

const DAY_AND_MONTH = [
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+\\d{4}\\b)?`,
    `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4}\\b)?`,
];

/** A date, a time, a lead time or a duration, in a reply. */
export const RE_DATE_TIME_DURATION = new RegExp([
    `\\b${WEEKDAY}\\b`,
    `\\b${BEFORE}\\s+${WEEKDAY_ABBR}\\b`,
    `\\b${WEEKDAY_ABBR}\\s+${AFTER}\\b`,
    ...DAY_AND_MONTH,
    `\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b`,
    `\\b(?:tomorrow|tonight|this (?:morning|afternoon|evening|week|weekend)|next (?:week|month|day|few days)|end of (?:the )?(?:week|month)|first thing|later today|by the weekend|within the week)\\b`,
    `\\b(?:at|by|from|around|about)\\s+\\d{1,2}(?::\\d{2}\\b|(?::\\d{2})?\\s*(?:am|pm|o'?clock)\\b)`,
    `\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b`,
    `\\b(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half a|couple of|few)\\s+(?:working\\s+)?(?:mins?|minutes?|hours?|hrs?|days?|weeks?|months?)\\b`,
    `\\b(?:within|in)\\s+(?:\\d+|a|an|one|two|three|four|five|six|seven|a couple of|a few)\\s+(?:working\\s+)?(?:days?|weeks?|hours?)\\b`,
    `\\blead[- ]time\\b`,
    `\\b(?:same[- ]day|next[- ]day)\\b`,
].join('|'), 'i');

/** An ordinal written in figures: "2nd". */
const RE_ORDINAL = /\b\d{1,2}(?:st|nd|rd|th)\b/gi;

/**
 * What an ordinal counts in this trade, when it is the very next word: "1st floor", "2nd-fix",
 * "3rd bedroom", "2nd coat", "1st visit". Only these nouns, and only directly after the ordinal
 * (a space or a hyphen between, nothing else), since a date is said the same way with any word
 * that is not one of them after it: "the 2nd works", "the 2nd if that suits". A word missing
 * from here costs a retry and at worst the acknowledgement, never a date.
 */
const COUNTED = '(?:floors?|stor(?:ey|ie|y)s?|fix(?:es|ing)?|coats?|layers?|bedrooms?|bathrooms?|rooms?|toilets?|landings?|steps?|stairs?|treads?|shelf|shelves|drawers?|doors?|windows?|panels?|sockets?|radiators?|cupboards?|units?|tiles?|rows?|courses?|visits?)';
const RE_COUNTED_AFTER = new RegExp(`^(?:\\s+|\\s*-\\s*)${COUNTED}\\b`, 'i');

/**
 * The bare ordinals in a reply read as days of the month: "the 2nd", "Tuesday the 2nd", "2nd of
 * the month". Each ordinal is read on its own words, never on what else the reply says: an ordinal
 * is a day unless what it counts comes straight after it, so "the 1st floor bathroom" is not a
 * date in a reply that also gives one, and "the 2nd" is one in a reply that gives none. Fails
 * closed: an ordinal this cannot place is a day.
 */
export function ordinalDays(text: string): string[] {
    return Array.from(text.matchAll(RE_ORDINAL)).filter((m) => !RE_COUNTED_AFTER.test(text.slice(m.index! + m[0].length))).map((m) => m[0]);
}

/**
 * A promise that Ben will come back to the customer, in the third person or in his own first person
 * ("I'll come back to you", "let me check and come straight back to you"). Allowed wherever a hold
 * reaches Ben to keep it; the commitment guard refuses it on a request to move a date when no hold
 * does (guards.ts).
 */
export const RE_BEN_COMES_BACK = /\b(?:ben|he|she|i|someone|one of (?:us|the team)|the team|we)\b[^.?!\n]{0,40}\b(?:will|['’]ll|can|is going to)\b[^.?!\n]{0,40}\b(?:be in touch|come back|get back|let you know|confirm|call|ring|phone)\b|\blet me\b[^.?!\n]{0,40}\b(?:come (?:straight )?back|get back|confirm)\b/i;

/**
 * A reply that puts off a question: "I'll check and come back to you on that", "let me find out".
 * Narrower than RE_BEN_COMES_BACK: an offer to call, a confirmation and the wrap-up's "I'll put the
 * quote together and send it over" are not a question left open, so they are not read as one.
 */
export const RE_DEFERS = /\b(?:i|we)\b[^.?!\n]{0,40}\b(?:will|['’]ll|am going to|['’]m going to)\b[^.?!\n]{0,40}\b(?:check|find out|come (?:straight )?back|get back|be in touch|let you know)\b|\blet me\b[^.?!\n]{0,40}\b(?:check|find out|come (?:straight )?back|get back)\b/i;

/**
 * Words that tie a put-off to a question rather than to the job: "on that", "on the Checkatrade
 * question", "find out", "check whether". "I'll have a look and get back to you" and "I'll let you
 * know once I've seen the photos" are the job being scoped, not a question left open.
 */
const RE_ABOUT_A_QUESTION = /\b(?:on|about) (?:that|this)\b|\bquestion\b|\bfind out\b|\bcheck (?:on|whether)\b/i;

/**
 * A customer's ask that is the job itself: "can you fix it?", "could you put up these shelves",
 * "how long will it take". Scoping answers it, so a put-off on it is not a question for Ben.
 */
const RE_JOB_ASK = /\b(?:can|could|would|will) (?:you|someone|ben)\b[^.?!\n]{0,20}\b(?:fix|repair|replace|do|sort|put|hang|mount|install|fit|come|pop|look|help|paint|build|change|remove|unblock|assemble|take a look)\b|\bhow (?:long|soon|quickly)\b/i;

/**
 * Where a question starts: an auxiliary and its subject ("do you", "is there"), a wh-word and an
 * auxiliary ("when do", "what is"), "what's", "any chance", or "what" or "which" and a noun
 * ("what insurance", "which areas").
 */
const QUESTION_START = "(?:(?:do|does|did|are|is|can|could|will|would|have|has) (?:you|they|he|she|ben|it|there)|(?:what|when|where|which|who|why|how) (?:do|does|did|are|is|can|could|will|would|have|has)|what['’]s|any chance|(?:what|which) (?!(?:you|i|we|they|he|she|it|if|a|an|the)\\b)[a-z]+)\\b";
const RE_QUESTION_START = new RegExp(`^${QUESTION_START}`, 'i');
/**
 * A second question joined on by a dash, or by a comma, "and" or "but" where a question starts:
 * "can you fix my tap and do you work weekends?". "When you get a chance, could you..." stays one ask.
 */
const RE_JOINED_QUESTION = new RegExp(`\\s+[-–]\\s+|(?:\\s*[,;:]\\s*|\\s+(?:and|but)\\s+)(?=${QUESTION_START})`, 'i');

/**
 * The words of a reply that put off a question the customer asked on this turn, or null. A clause
 * of the customer's words, split where a second question starts, must be a question (opening as one or
 * carrying its question mark) that asks something (RE_ASKING) that is not the job itself, and the reply's sentence must say it will
 * check or come back on that question. A sentence about the quote is the wrap-up or its delivery
 * ("I'll get the quote over to you"), not a question left open, so it is skipped.
 */
export function deferralMatch(reply: string, asked: string): string | null {
    const clauses = sentencesOf(asked).flatMap((s) => s.split(RE_JOINED_QUESTION));
    if (!clauses.some((c) => (RE_QUESTION_START.test(c) || c.includes('?')) && RE_ASKING.test(c) && !RE_JOB_ASK.test(c))) return null;
    for (const sentence of sentencesOf(reply)) {
        if (/\bquote\b/i.test(sentence) || !RE_ABOUT_A_QUESTION.test(sentence)) continue;
        const m = RE_DEFERS.exec(sentence);
        if (m) return m[0];
    }
    return null;
}

/**
 * A promise to do, fix or guarantee something, a claim that a change to the customer's details is
 * already made (a change of details is Ben's to make; the desk only passes it on), or an admission
 * of fault. Fails closed: broad on purpose.
 */
export const RE_COMMITMENT_OR_FAULT = new RegExp([
    `\\b(?:i|we|ben)(?:'ve| have)\\s+(?:now\\s+|just\\s+|already\\s+)?(?:updated|changed|amended|corrected)\\s+(?:your|the)\\s+(?:address|e-?mail(?: address)?|(?:phone |mobile )?number|name|details|record)\\b`,
    `\\byour\\s+(?:address|e-?mail(?: address)?|(?:phone |mobile )?number|name|details|record)\\s+(?:has|have|is|are)\\s+(?:now\\s+)?(?:been\\s+)?(?:updated|changed|amended|corrected)\\b`,
    `\\b(?:we|i|ben)(?:'ll| will| can| shall)\\s+(?:definitely\\s+|certainly\\s+|easily\\s+)?(?:fix|sort|repair|replace|do|finish|complete|have (?:it|this|that) (?:done|sorted|fixed)|be (?:there|round|out)|come (?:out|round)|get (?:it|this|that) (?:done|sorted|fixed)|take care of (?:it|this|that))\\b`,
    `\\b(?:guarantee[ds]?|promise[ds]?|warranty|consider it done|no problem at all, consider it done)\\b`,
    `\\b(?:our (?:fault|mistake|error)|my (?:fault|mistake)|we (?:messed|screwed) up|we (?:got|had) (?:it|that|this) wrong|we let you down|we apologise for (?:the|our) (?:mistake|error))\\b`,
    `\\bfree of charge\\b`,
].join('|'), 'i');

/** A statement about the business, its services, hours, coverage or policies. */
export const RE_BUSINESS_CLAIM = new RegExp([
    `\\b(?:we|ben|our team)(?:'re| are|'s| is)?\\s+(?:open|closed|available|fully (?:insured|qualified)|insured|qualified|certified|registered|accredited|gas safe|niceic|dbs[- ]checked)\\b`,
    `\\bour (?:hours|opening hours|policy|rates?|prices?|call[- ]?out|coverage|area|guarantee|warranty)\\b`,
    `\\b(?:we|ben)\\s+(?:cover|covers|don'?t cover|do not cover|charge|charges|don'?t charge|do not charge|offer|offers|accept|accepts|take|takes)\\s+(?:card|cash|the whole|all of|most of|anywhere|\\w+shire|nottingham|derby|leicester|a (?:call[- ]?out|deposit|fee))\\b`,
    `\\b(?:no|free) call[- ]?out (?:fee|charge)\\b`,
    `\\b(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\s*(?:to|-|until)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))\\b`,
    `\\b(?:we|ben)(?:'ve| have) (?:been (?:doing|in|trading)|done (?:hundreds|thousands|loads|plenty))\\b`,
    `\\b(?:years? of experience|years in the trade|fully licensed)\\b`,
].join('|'), 'i');

/** A line describing the sender as automated or an assistant. No disclosure line (answer 24). */
export const RE_DISCLOSURE = /\b(?:automated|automatic(?:ally)? (?:reply|response|message)|auto[- ]?reply|(?:an?|the|our|ben'?s) (?:ai|a\.i\.|bot|chatbot|virtual assistant|digital assistant|assistant)\b|i'?m (?:an? )?(?:ai|bot|chatbot|assistant|virtual)|artificial intelligence|language model|this is an? (?:automated|auto|bot))\b/i;

export const SUBJECT_WORDS: Record<string, RegExp> = {
    media: /\b(?:photo|photos|picture|pictures|pic|pics|video|videos|snap|snaps|image|images|footage|clip)\b/i,
    // Only an ask about where THEY are: "whereabouts does it catch" and "where is it sticking" are job questions.
    postcode: /\b(?:postcode|post code|post-code|address|which (?:area|part of town|town|road|street)|what area|where(?:abouts)? (?:are you|you are|are you based|is the (?:house|property|place)|in (?:the )?(?:city|town|area)|in [A-Z][a-z]+)|whereabouts in\b|your (?:location|area)|where (?:you'?re|you are) (?:based|located))\b/i,
    access: /\b(?:access|parking|park|key safe|keysafe|keys?|gate code|door code|someone (?:be )?(?:in|home|there|about|around)|anyone (?:be )?(?:in|home|there)|get in|let us in|be home|be in)\b/i,
    handoff: /\b(?:ben|he|she|someone|one of (?:us|the team)|the team)\b[^.?!\n]{0,40}\b(?:will|'ll|can|is going to)\b[^.?!\n]{0,40}\b(?:be in touch|call|ring|phone|come back|get back|pick (?:this|it) up|look at|confirm|price)\b/i,
    job: /\b(?:what(?:'s| is) (?:the|it|that)|which|how (?:big|many|old|long|wide|tall|high)|what (?:kind|type|sort|size|material)|is it|are they|does it|do they|tell me (?:a bit )?more|describe|whereabouts (?:in|on) the)\b/i,
};

/**
 * Asking phrasing: a question mark, or an imperative or request to send or tell. "Is there" and
 * "are there" ask only in question order, opening a clause: "the valves are there and working"
 * states a fact, as a quote's assumptions do.
 */
export const RE_ASKING = /\?|\b(?:send|share|pop|drop|attach|ping|forward|could you|can you|would you|if you (?:can|could|get a chance|have)|do you have|have you got|let (?:me|us) know|what(?:'s| is)|where|which|when|how|any chance)\b|(?:^|[,;:]\s*|\b(?:and|but|or|so|also)\s+)(?:is|are) there\b/i;

/** A clause that waves the subject away, so its mention is not an ask of it. */
export const RE_DISMISSIVE = /\b(?:no worries about|don'?t worry about|do not worry about|no need for|no need to|not to worry about|without (?:a |the |any )?|rather not|no problem (?:at all )?(?:about|with|without)|forget the|skip the|leave the)\b/i;

export function sentencesOf(text: string): string[] {
    return text.split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function clausesOf(sentence: string): string[] {
    return sentence.split(/[,;:]|\s+-\s+/).map((c) => c.trim()).filter(Boolean);
}

/** Whether a sentence asks for a subject: subject word plus an asking phrase, outside a dismissive clause. */
export function sentenceAsks(sentence: string, subject: string): boolean {
    const words = SUBJECT_WORDS[subject];
    if (!words || !words.test(sentence) || !RE_ASKING.test(sentence)) return false;
    return clausesOf(sentence).filter((c) => words.test(c)).some((c) => !RE_DISMISSIVE.test(c));
}

export function textAsks(text: string, subject: string): boolean {
    return sentencesOf(text).some((s) => sentenceAsks(s, subject));
}

/**
 * Whether a composed reply asked the question the brief proposed. A question in words the lexicon
 * does not know still counts, but only a question about the job: an offer of a call ("is it OK if
 * I give you a quick call?") or a question that asks for a different subject ("could you send a
 * photo?") is not the proposed one, so the proposed subject is not spent on it and is asked later.
 */
export function asksProposed(text: string, subject: string): boolean {
    if (textAsks(text, subject)) return true;
    const others = ['media', 'postcode', 'access'].filter((o) => o !== subject);
    return sentencesOf(text).some((s) => s.includes('?') && scopingQuestionCount(s) > 0 && !others.some((o) => sentenceAsks(s, o)));
}

/**
 * The same question of prose nobody composed to the desk's shape, read tightly: the subject word
 * and the asking phrase must fall in one clause. "I will be in touch later today, what is the best
 * number for you?" asks for neither access nor anything else. Where a human's phrasing is
 * ambiguous nothing is recorded, so the desk asks again rather than never asking.
 */
export function clauseAsks(text: string, subject: string): boolean {
    const words = SUBJECT_WORDS[subject];
    if (!words) return false;
    return sentencesOf(text).some((s) => clausesOf(s).some((c) => words.test(c) && RE_ASKING.test(c) && !RE_DISMISSIVE.test(c)));
}

/** Thanks for media: "thanks for the photo". */
export const RE_THANKS_MEDIA = /\b(?:thank(?:s| you)|cheers|ta)\b[^.?!\n]{0,40}\b(?:photo|photos|picture|pictures|pic|pics|video|videos|snap|snaps|image|images|footage|clip)s?\b/i;

/** An offer of a call, in the ways a handyman business phrases it. */
export const RE_CALL_OFFER = new RegExp([
    `\\bgive you a (?:quick |short |wee )?(?:call|ring|bell|buzz)\\b`,
    `\\b(?:call|ring|phone|bell) you\\b`,
    `\\ba (?:quick |short |wee )?(?:call|phone call|chat on the phone|chat over the phone)\\b`,
    `\\b(?:jump|hop) on a (?:quick )?call\\b`,
    `\\bhappy to (?:call|ring|phone|have a (?:quick )?(?:call|chat))\\b`,
    `\\b(?:can|could|shall|should|may) (?:we|i|ben) (?:call|ring|phone)\\b`,
    `\\b(?:over|on) the phone\\b`,
    `\\bcall (?:would|might) (?:help|be (?:easier|quicker|best))\\b`,
].join('|'), 'i');

const RE_CALL_NEGATION = /\b(?:won'?t|will not|wont|(?:cannot|can'?t|can not)(?!\s+(?:wait|hurt))|no need (?:to|for)|not going to|rather than|instead of|never(?!\s+hurts?)|(?:don'?t|do not|won'?t|will not) (?:need|have|want) to|not necessary to|no (?:calls?|phone))(?:\s+\S+){0,2}\s*$/i;

/** Questions about the job: every question except an offer of a call, which is not a scoping question. */
export function scopingQuestionCount(text: string): number {
    return sentencesOf(text).filter((s) => s.includes('?') && clausesOf(s).every((c) => { const m = RE_CALL_OFFER.exec(c); return !m || RE_CALL_NEGATION.test(c.slice(0, m.index)); })).length;
}

export function offersCall(text: string): string | null {
    for (const s of sentencesOf(text)) for (const clause of clausesOf(s)) {
        const m = RE_CALL_OFFER.exec(clause);
        if (m && !RE_CALL_NEGATION.test(clause.slice(0, m.index))) return m[0];
    }
    return null;
}

/** A UK postcode, full or outward only. */
export const RE_POSTCODE_FULL = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
export const RE_POSTCODE_OUTWARD = /\b([A-Z]{1,2}\d[A-Z\d]?)\b(?!\s*\d[A-Z]{2})/i;

export interface LocationParse { postcode: string | null; outward: string | null; confidence: 'high' | 'medium' | 'low'; text: string | null }

/** confirm_location's parse: a full postcode is high, an outward code medium, a named area low. */
export function parseLocation(text: string): LocationParse {
    const full = RE_POSTCODE_FULL.exec(text);
    if (full) return { postcode: `${full[1].toUpperCase()} ${full[2].toUpperCase()}`, outward: full[1].toUpperCase(), confidence: 'high', text: null };
    const out = RE_POSTCODE_OUTWARD.exec(text);
    if (out && /\d/.test(out[1]) && !/^\d/.test(out[1]) && out[1].length >= 3 && !/\b(?:ft|cm|mm|kg|am|pm)\b/i.test(out[1])) return { postcode: null, outward: out[1].toUpperCase(), confidence: 'medium', text: null };
    const area = /\b(?:in|at|near|around)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/.exec(text);
    if (area) return { postcode: null, outward: null, confidence: 'low', text: area[1] };
    return { postcode: null, outward: null, confidence: 'low', text: null };
}
