/**
 * Pure guards for anything the comms agent wants to send a customer.
 *
 * These live outside comms.ts on purpose: the money guard is the one rule that must never be
 * taken on trust, so it has to be callable from a test without an LLM, a database or a running
 * conversation. server/agents/comms.ts wires them into queue_draft; scripts/_post-quote-test.ts
 * proves each one refuses what it claims to refuse.
 *
 * Every guard returns null/[] for "fine" and a human-readable reason for "refuse". They are
 * deliberately conservative in one direction only: a false refusal costs a draft and sends the
 * decision to Ben, which is the outcome we already want when anything is uncertain.
 */
import { priceBandFor, DURATION_RAIL, VISIT_TERMS_RAIL } from './objection-levers';

// ---------------------------------------------------------------- money

/**
 * Does this text touch money at all?
 *
 * Widened 19 Aug 2026 after an adversarial pass: the original was `£\s*\d` plus "pounds|quid",
 * which meant "I can do it for 150 GBP", "call it 1.5k" and "one hundred and fifty pounds" carried
 * no money as far as the guard was concerned — the exact hole the money guard exists to close,
 * reachable by anyone who can get the model to write a number without a pound sign.
 *
 * Kept as an exported regex because neverSendDirectReason (comms.ts) runs the same test as its own
 * independent rail.
 */
export const MONEY_RE = new RegExp([
    String.raw`£\s*\d`,
    String.raw`\b\d[\d,]*(?:\.\d{1,2})?\s*(?:k\b|pounds?\b|quid\b|notes\b|gbp\b|sterling\b)`,
    String.raw`\bgbp\s*\d`,
    // spelled out: "two hundred quid", "a grand", "fifteen hundred pounds"
    String.raw`\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|a|couple)\b[\w\s-]{0,24}\b(?:pounds?|quid|grand)\b`,
    // "do it for 150", "comes to 220" — a bare number in an unmistakably money-shaped slot.
    // The unit exclusion is what keeps "for 2 hours" and "at 30 mins" out of the money guard.
    String.raw`\b(?:for|at|of|costs?|cost|totals?|comes to|call it|price of|charged?|(?:total|price|cost|balance|deposit|quote|figure|it|that)\s+(?:is|was|would be|comes to|works out at))\s+\d{2,5}\b(?!\s*(?:%|am\b|pm\b|mins?\b|minutes?\b|hours?\b|hrs?\b|days?\b|weeks?\b|months?\b|years?\b|people\b|persons?\b|men\b|lads\b|coats?\b|mm\b|cm\b|m\b|metres?\b|meters?\b|litres?\b|liters?\b|kg\b|degrees?\b|st\b|nd\b|rd\b|th\b|:\d))`,
].join('|'), 'i');

export interface MoneyFigure {
    /** As written, e.g. "£1,200" or "180 quid". */
    raw: string;
    /**
     * Normalised to pence so tests and analytics can compare figures. NaN when the figure is
     * written in a form we cannot pin to a number ("a couple of hundred quid") — still money,
     * still refused; the pence value just cannot be stated.
     */
    pence: number;
    /** True for the NaN case above, so a caller can say WHY it was refused. */
    unverifiable?: boolean;
}

/** Number words we accept in a spelled-out amount. Only used to spot one, never to value it. */
const WORD_NUMBER = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|couple|few|a|and)';

/**
 * Units that make a bare number NOT money. "for 2 hours", "for 3 people", "at 9 am" are not prices,
 * and refusing them would cost real drafts.
 */
const NOT_MONEY_UNIT = String.raw`(?:\s*(?:%|am\b|pm\b|min\b|mins\b|minutes?\b|hours?\b|hrs?\b|days?\b|weeks?\b|months?\b|years?\b|people\b|persons?\b|men\b|lads\b|coats?\b|mm\b|cm\b|m\b|metres?\b|meters?\b|litres?\b|liters?\b|kg\b|degrees?\b|st\b|nd\b|rd\b|th\b|:\d))`;

/**
 * Every money figure in a body, normalised to pence. "£180" and "£180.00" both come out as
 * 18000 so a draft cannot dodge the check by adding decimals, and "£1.5k" comes out as 150000
 * rather than being read as £1.50.
 */
export function extractMoneyFigures(body: string): MoneyFigure[] {
    const out: MoneyFigure[] = [];
    const push = (raw: string, digits: string, thousands: boolean) => {
        const value = Number(digits.replace(/,/g, ''));
        if (!Number.isFinite(value)) return;
        out.push({ raw: raw.trim(), pence: Math.round(value * (thousands ? 1000 : 1) * 100) });
    };

    // £1,200 / £180.00 / £1.5k / £ 180
    for (const m of body.matchAll(/£\s*([\d,]+(?:\.\d{1,2})?)\s*(k\b)?/gi)) push(m[0], m[1], !!m[2]);
    // 180 quid / 180 pounds / 1.5k / 150 GBP / 150 notes
    for (const m of body.matchAll(/\b([\d,]+(?:\.\d{1,2})?)\s*(k\b|(?:pounds?|quid|notes|gbp|sterling)\b)/gi)) {
        push(m[0], m[1], /^k\b/i.test(m[2]));
    }
    // GBP150
    for (const m of body.matchAll(/\bgbp\s*([\d,]+(?:\.\d{1,2})?)/gi)) push(m[0], m[1], false);
    // "do it for 150", "comes to 220" — a bare number in a money-shaped slot, with units excluded.
    const bare = new RegExp(String.raw`\b(?:for|at|of|costs?|cost|totals?|comes to|call it|price of|charged?|(?:total|price|cost|balance|deposit|quote|figure|it|that)\s+(?:is|was|would be|comes to|works out at))\s+([\d,]{2,7}(?:\.\d{1,2})?)\b(?!${NOT_MONEY_UNIT})`, 'gi');
    for (const m of body.matchAll(bare)) push(m[0], m[1], false);
    // Spelled out. Never valued: money in words is still money, and still refused.
    const spelled = new RegExp(String.raw`\b${WORD_NUMBER}(?:[\s-]+${WORD_NUMBER})*[\s-]+(?:pounds?|quid|grand)\b`, 'gi');
    for (const m of body.matchAll(spelled)) out.push({ raw: m[0].trim(), pence: Number.NaN, unverifiable: true });

    // De-dupe overlapping alternatives ("£150" caught once, not twice).
    const seen = new Set<string>();
    return out.filter((f) => {
        const key = `${f.raw.toLowerCase()}|${f.pence}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * ANY money figure in a draft, full stop.
 *
 * This guard used to be an allowed-set comparison: figures already on the customer's quote (or in
 * Ben's typed answer) could ride out, and only fabricated ones were refused. The owner's
 * full-autonomy constitution (21 Aug 2026) retired the transmit path entirely: the quote page is
 * the numbers channel, and a figure in chat — even a TRUE one, copied correctly off their own live
 * quote — is how a price gets renegotiated in a medium with no paperwork attached. So the check is
 * now presence, not provenance, which also deletes a whole class of source-tracking machinery
 * (allowedFigurePence, quote_slug citing, price_source='ben_answer') that existed only to feed the
 * comparison. The widened MONEY_RE and extractMoneyFigures stay: detection is still the hard part.
 */
export function detectMoneyFigure(body: string): string | null {
    const figures = extractMoneyFigures(body);
    if (figures.length) return figures.map((f) => f.raw).join(', ');
    // Belt and braces: MONEY_RE is deliberately wider than the extractor. Anything it sees that
    // the extractor cannot pin down is still money, and unverifiable money refuses hardest of all.
    const m = body.match(MONEY_RE);
    return m ? m[0].trim() : null;
}

/**
 * Negated modals confuse every "is this an offer" pattern below, because "we can't do a discount"
 * and "we can do a discount" differ by two characters. Neutralise them before matching.
 */
function stripNegations(body: string): string {
    return body
        .replace(/\b(can|could|would|will|do|does|is|are)n(?:'|’)?t\b/gi, 'NEGATED')
        // "can't" never matched the line above (the captured "can" swallows the n, leaving n't
        // nothing to match), so "we can't do a discount" was refused while the proven-fine
        // "we cannot do a discount" passed. Found 27 Aug 2026 by the content-guard suite.
        .replace(/\bcan(?:'|’)t\b/gi, 'NEGATED')
        .replace(/\b(cannot|unable to)\b/gi, 'NEGATED');
}

/**
 * A discount OFFER, with or without a figure. "I can do 10% off" carries no £ sign and so slips
 * straight past the money guard, which is exactly the hole this closes.
 *
 * Volume discounts are real (Ben gives them when a customer bundles jobs) but they are Ben's to
 * give: this refuses the agent offering one, not the existence of the policy.
 */
export function detectDiscountOffer(body: string): string | null {
    const text = stripNegations(body);

    // Every reduction word, in one place. Widened 19 Aug 2026: an adversarial pass got "a bit of
    // wiggle room", "sort you out on the price", "throw the second job in for free", "take a bit
    // off" and "we can be flexible on the price" straight through a guard whose whole job is to
    // stop the agent hinting there is room to move.
    const REDUCTION = [
        'discount', 'reduction',
        'knock (?:off|it down|a bit off|something off|some off)', 'knock (?:it|that|the price) down',
        'take (?:a bit|a little|some|something|£?\\d+) off', 'off the price', 'off for you',
        'bring (?:it|that|the price|the cost) down', 'come down (?:on|a bit|a little|to)?', 'coming down on',
        'reduce (?:it|that|the price|the cost)', 'lower (?:it|that|the price|the cost)',
        'drop (?:it|that|the price|the cost)', 'shave (?:a bit|some|something)',
        'do it (?:for|at) less', 'do you a deal', 'do you a better price', 'better price',
        'cheaper for you', 'do it cheaper', 'a bit less', 'a little less', 'bit cheaper',
        'meet you (?:in the middle|halfway|half way)',
        'wiggle room', 'room to move', 'movement on (?:the )?price', 'flexible on (?:the )?price',
        'sharpen (?:my|the) pencil', 'sort you out on (?:the )?price', 'see what i can do on (?:the )?price',
        'waive', 'throw (?:it|that|the \\w+) in for (?:free|nothing)', 'for free', 'free of charge',
        'on the house', 'no charge for', 'negotiate on', 'negotiable',
        '(?:match|beat) (?:that|their|the|your|his)?\\s*(?:other\\s+)?(?:price|quote|figure|number)',
        // arithmetic the customer invites: "half of that", "split the difference"
        'half (?:of )?(?:that|it|the price)', 'split the difference',
    ].join('|');

    const patterns: RegExp[] = [
        // "10% off", "10 % discount", "80% of that"
        /\b\d{1,3}\s*%\s*(?:off|discount|reduction|less|of (?:that|it|the price))\b/i,
        // "£20 off", "20 quid off", "20 off"
        /(?:£\s*)?[\d,]+(?:\.\d{1,2})?\s*(?:quid|pounds?)?\s*(?:off|discount)\b/i,
        // an offering modal within a short reach of a reduction word
        new RegExp(String.raw`\b(?:can|could|will|would|happy to|able to|let me|i'?ll|we'?ll|might be|there(?:'|’)?s|there is|leave it with me and)\b[^.!?\n]{0,45}\b(?:${REDUCTION})\b`, 'i'),
        // a reduction word aimed at the customer, with no modal in front of it
        new RegExp(String.raw`\b(?:${REDUCTION})\b[^.!?\n]{0,20}\bfor you\b`, 'i'),
        // haggling closers
        /\b(?:best price i can do|best i can do is|i can do it for|call it £?[\d,]+)\b/i,
        // arithmetic on their price, with or without a modal. "Half of that is fine" is a
        // reduction agreed in two words.
        /\bhalf (?:of )?(?:that|it|the price|the total)\b|\bsplit the difference\b/i,
    ];

    for (const re of patterns) {
        const m = text.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- invented terms

/**
 * A commercial mechanism stated at the customer: a fee credited against the bill, deducted from
 * the job, refunded on booking, or waived.
 *
 * 27 Aug 2026 (+447950552830, "James", £992 bathroom floor): the agent auto-sent "that'd be a
 * paid survey visit rather than a free look, the fee comes off the job if he goes ahead". "The
 * fee comes off the job" is a credit against the bill — it changes what the customer pays, which
 * makes it Ben's, same family as discounts. The VISITS ARE NEVER FREE standing order existed and
 * did not help, because it banned FREE visits, not inventing the TERMS of a paid one.
 *
 * This extends detectDiscountOffer rather than duplicating it: the discount guard wants an
 * offering modal near a reduction word ("we can knock a bit off"), and a stated MECHANISM carries
 * no modal at all — "the fee comes off the job" is policy narrated as fact, which is worse.
 * Where a phrase carries both (a modal AND a mechanism), the discount guard fires first in
 * checkDraft and keeps it; either refusal routes the same place.
 *
 * No negation stripping, deliberately: "we can't waive the fee" states the business's terms as
 * hard as "we can", and both are Ben's to state. A false refusal here costs a redraft and a flag,
 * which is the outcome we want whenever the agent is narrating commercial policy.
 */
/**
 * The thing the customer owes. 'quote' and 'work' are deliberately NOT in here: "happy to take
 * that off the quote" is the re-scope lever (removing a LINE, allowed and encouraged), where
 * "comes off the bill" is a credit (money, Ben's). The towards-pattern below carries 'work'
 * itself, because "the fee goes towards the work" has no re-scope reading.
 */
const BILL_NOUN = String.raw`(?:job|bill|total|price|invoice|cost|balance|final (?:bill|price|invoice|total|cost))`;

const POLICY_COMMITMENT_PATTERNS: RegExp[] = [
    // "comes off the job", "knock the fee off the total", "taken off your final bill"
    new RegExp(String.raw`\b(?:comes?|come|coming|came|taken?|taking|took|knock(?:ed|ing|s)?)\b[^.?!\n]{0,20}\boff (?:the|your|his|her|their) ${BILL_NOUN}\b`, 'i'),
    // "deducted from the job", "deduct it off the final bill"
    new RegExp(String.raw`\bdeduct(?:ed|ing|s)?\b[^.?!\n]{0,30}\b(?:from|off|against)\b[^.?!\n]{0,20}\b${BILL_NOUN}\b`, 'i'),
    // "credited against the job", "credit it towards the work", "credited back when you book"
    /\bcredit(?:ed|ing|s)?\b[^.?!\n]{0,30}\b(?:against|towards?|back|off|to (?:the|your))\b/i,
    // "the fee goes towards the job", "counts towards the final bill", "put towards the work"
    new RegExp(String.raw`\b(?:goes?|going|counts?|counting|put|putting)\s+towards?\s+(?:the|your) (?:work|${BILL_NOUN})\b`, 'i'),
    // "refunded if you go ahead", "money back when you book"
    /\brefund(?:ed|able)?\b[^.?!\n]{0,40}\b(?:if|when|once|should)\b[^.?!\n]{0,30}\b(?:book|go(?:es)? ahead|proceed|confirm|accept)/i,
    /\bmoney back\b[^.?!\n]{0,30}\b(?:if|when|once)\b[^.?!\n]{0,30}\b(?:book|go(?:es)? ahead|proceed)/i,
    // "waive the fee", "the callout charge is waived"
    /\bwaiv(?:e|ed|ing|er)\b[^.?!\n]{0,30}\b(?:fee|charge|cost|call-?out|survey|deposit)\b/i,
    /\b(?:fee|charge|cost|call-?out|survey|deposit)s?\b[^.?!\n]{0,30}\bwaived?\b/i,
    // a survey/callout fee stated WITH a mechanism, whichever way round it is phrased
    /\b(?:survey|call-?out|visit|inspection|assessment) fees?\b[^.?!\n]{0,50}\b(?:off\b|deduct|credit|refund|waiv|towards?\b|free\b)/i,
];

export function detectPolicyCommitment(body: string): string | null {
    for (const re of POLICY_COMMITMENT_PATTERNS) {
        const m = body.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- the losing move

/**
 * The graceful exit: agreeing with the customer's decision to stop, without changing anything
 * about the offer. 8 threads in the corpus, 1 sale.
 *
 * Only fires when the draft closes the door AND carries no lever. Ben's best line opens with
 * "No problem at all!" too, so a bare phrase match would refuse the single best message in the
 * corpus; the lever markers are what separate them.
 */
const CLOSING_PHRASES = [
    /\bno problem(?:\s+at all)?\b/i,
    /\bno worries\b/i,
    /\bthanks anyway\b/i,
    /\bthat'?s (?:fine|ok|okay)\b/i,
    /\bsorry (?:to hear|we could)/i,
    /\bwe(?:'re| are) here (?:in the future|if you)/i,
    /\bif you (?:do )?(?:choose to )?come back\b/i,
    /\bunderstood\b/i,
];

/** Any of these means the reply is still doing work, so it is not a capitulation. */
const LEVER_MARKERS = [
    // re-scope
    /\b(?:edit|amend|adjust|change|revise|redo|split|take (?:it|that|some) out|leave (?:that|it) off|trim)\b/i,
    /\bwhich (?:bits|parts|jobs|lines)\b/i,
    // a reason for the price
    /\b(?:because|so that|means|ensur\w+|2 people|two people|a full day|two days|not rushed|paramount)\b/i,
    // invite the comparison
    /\b(?:a few more quotes|other quotes|shop(?:ping)? around|happy to book you in)\b/i,
    // a dated re-contact
    /\b(?:check back|come back to you|drop you a line|give you a shout)\b/i,
    // an offer to refresh a stale quote (the `expiry_is_not_a_weapon` lever). Ben's own line for it
    // is "No problem, I can get that refreshed for you", which this guard read as a capitulation
    // until 19 Aug 2026 — refusing a lever we issue in the playbook and which classifyLever in
    // scripts/_backtest-corpus.ts already scores as holding. Offering a fresh quote keeps the offer
    // alive; it is the opposite of agreeing to end the conversation.
    /\b(?:refresh(?:ed)?|re-?issue[ds]?|get (?:that|it) (?:updated|sorted)|new quote|updated quote)\b/i,
    // a question keeps the thread alive
    /\?/,
];

export function detectCapitulation(body: string): string | null {
    const closing = CLOSING_PHRASES.map((re) => body.match(re)).find(Boolean);
    if (!closing) return null;
    if (LEVER_MARKERS.some((re) => re.test(body))) return null;
    return closing[0].trim();
}

// ---------------------------------------------------------------- "you have not seen it"

/**
 * 102 of the 104 quiet customers had opened their quote, 69 of them three or more times. A reply
 * that implies otherwise tells a customer who has read the thing four times that we are not
 * paying attention.
 *
 * Tight on purpose. "Have you had a chance to think it over" is fine and must stay fine; it is
 * the SEEING verbs that carry the false implication.
 */
const UNSEEN_PATTERNS: RegExp[] = [
    // "did you manage to look", "have you had chance to review" — the verb list was too short to
    // catch the two commonest phrasings until the adversarial pass on 19 Aug 2026.
    /\b(?:did|have)\s+you\s+(?:get|got|had|have|manage|managed|find)\b[^.?!\n]{0,30}\b(?:look|see|seen|view|receive|read|open|review|go through|glance)\w*\b/i,
    /\b(?:did|have)\s+you\s+(?:see|seen|receive|received|get|got|read|opened|reviewed)\s+(?:the|your|our|it|that|my)\b/i,
    /\bjust (?:checking|making sure|wondering)\b[^.?!\n]{0,40}\b(?:got|received|saw|seen|came through|reached|landed|arrived)\b/i,
    /\bin case (?:you (?:missed|haven'?t seen)|it (?:got lost|went missing|didn'?t (?:arrive|land|come through)))/i,
    /\bnot sure (?:if |whether )?(?:you (?:saw|got|received|had a chance to (?:see|look))|(?:it|that|the quote|the link) (?:landed|arrived|came through|reached you|got to you))/i,
    /\b(?:did|has) (?:it|that|the quote|the link) (?:come through|arrive|land|reach you|get to you)/i,
    /\b(?:re-?sending|re-?send|sending (?:it|the quote|the link) (?:again|over again|across again))\b/i,
    // "shall I send the quote over again", "I'll fire the link over once more"
    /\b(?:send|sending|fire|ping|pop|shoot)\w*\b[^.?!\n]{0,30}\b(?:again|once more|a second time|one more time)\b/i,
    /\bhere\b[^.?!\n]{0,25}\bagain\b/i,
    /\b(?:if|unless) you (?:never|didn'?t|did not|haven'?t) (?:get|got|receive|see|seen)\b/i,
];

export function detectUnseenImplication(body: string): string | null {
    for (const re of UNSEEN_PATTERNS) {
        const m = body.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- dates

const WEEKDAY = '(?:mon|tues?|wednes|thurs?|fri|satur|sun)day|tomorrow|today|next week|this week|(?:mon|tue|wed|thu|fri|sat|sun)\\b';
const DATE_ISH = `(?:${WEEKDAY}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*|\\d{1,2}\\/\\d{1,2}|\\d{1,2}(?:st|nd|rd|th))`;

/**
 * A committed date. "We can come Tuesday" is a promise; "the quote has Tuesday on it" is not.
 * Matching the COMMITTING VERB rather than the weekday is what keeps the difference.
 */
/**
 * Anyone who might turn up. "Craig will be with you Tuesday" is exactly as much of a promise as
 * "we'll come Tuesday", and the first version of this guard only knew about "we" and "I".
 */
const WHO_TURNS_UP = String.raw`(?:we|i|craig|joe|ben|the lads|the team|someone|somebody|one of (?:the lads|us|the team)|a lad|the guys)`;
/** A clock time. Arrival-time commitments carried no guard at all until 19 Aug 2026. */
const TIME_ISH = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm|o'?clock)|\d{1,2}:\d{2}|between \d{1,2} and \d{1,2}`;

const DATE_PROMISE_PATTERNS: RegExp[] = [
    new RegExp(`\\b(?:we|i)(?:'ll| will| can| could)\\s+(?:come|be there|be with you|get there|pop (?:round|over|in)|get (?:that|it) done|do (?:it|that)|call round|swing by|start|make a start)\\b[^.?!\\n]{0,25}\\b${DATE_ISH}`, 'i'),
    new RegExp(`\\b(?:see you|book(?:ing|ed)? (?:you )?in for|put you (?:in|down) for|have you (?:in|down) for|pencil(?:led)? (?:you )?in for|we'?re free|we have|i have|we'?ve got|all set for|sorted for|down for|confirm(?:ed|ing)? (?:you )?(?:for )?|in the diary for)\\b[^.?!\\n]{0,25}\\b${DATE_ISH}`, 'i'),
    // The date first, then anything that reads as agreement to it.
    new RegExp(`\\b${DATE_ISH}\\b(?:'s)?[^.?!\\n]{0,25}\\b(?:works|suits|(?:is |'s )?fine|(?:is |'s )?good|no problem|we can do|(?:is |'s )?booked|(?:is |'s )?confirmed|(?:is |'s )?yours|it is)\\b`, 'i'),
    new RegExp(`\\b(?:consider|treat)\\b[^.?!\\n]{0,20}\\b${DATE_ISH}\\b[^.?!\\n]{0,20}\\b(?:booked|confirmed|sorted|done)\\b`, 'i'),
    // Somebody arriving on a named day, however it is phrased.
    new RegExp(`\\b${WHO_TURNS_UP}\\b[^.?!\\n]{0,30}\\b(?:will be|will get|be with you|coming|come round|round|arriv\\w+|turn up|there)\\b[^.?!\\n]{0,25}\\b${DATE_ISH}`, 'i'),
    // An ARRIVAL TIME. "We'll be with you at 9am" promises as much as any weekday does.
    new RegExp(`\\b${WHO_TURNS_UP}\\b[^.?!\\n]{0,30}\\b(?:will be|be with you|arriv\\w+|get there|be there|start|turn up|come)\\b[^.?!\\n]{0,25}\\b(?:at|by|for|between|around)?\\s*(?:${TIME_ISH})`, 'i'),
    new RegExp(`\\b(?:first thing|straight after|early doors)\\b[^.?!\\n]{0,20}\\b${DATE_ISH}`, 'i'),
    /\b(?:yes|yeah|yep)\b[^.?!\n]{0,12}\b(?:we can do|that works|that'?s fine|see you then|confirmed)\b/i,
    // A date the customer asserted, echoed back as fact. "You said Thursday, that still stands."
    new RegExp(`\\b(?:still stands|still (?:in|on) the diary|as (?:agreed|arranged|planned)|as we said)\\b`, 'i'),
];

/**
 * Returns the promise if the body commits to a date. The caller decides whether that date is
 * actually confirmed; this only spots the commitment.
 */
export function detectDatePromise(body: string): string | null {
    for (const re of DATE_PROMISE_PATTERNS) {
        const m = body.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

/** Weekday/relative-date words present at all — used to decide whether a date claim needs checking. */
export function mentionsADate(body: string): boolean {
    return new RegExp(DATE_ISH, 'i').test(body);
}

// ---------------------------------------------------------------- duration

/**
 * A claim about how long the job takes, how many visits it needs, or how long the customer loses
 * the use of anything.
 *
 * 27 Aug 2026 (+447950552830, "James", £992 bathroom floor): asked "is the toilet going to be out
 * of use for two days?", the agent auto-sent "It's all done in one visit James, so the toilet's
 * only out of action while we're actually on site that day" — while his quote said it is a TWO
 * DAY job, and he caught the contradiction himself ("It says on the quote it's a two day job
 * though?"). Chat contradicting the quote page destroys trust in the numbers channel.
 *
 * Treated exactly like detectDatePromise: the agent may NEVER assert duration, whether or not the
 * claim happens to match the quote, because it cannot verify the claim against the job and
 * right-but-unverifiable is how the last one went out wrong. The quote page is the
 * scope-and-logistics channel. Deliberately wide in one direction only — a false refusal costs a
 * redraft that points at the quote, which is the reply we wanted anyway. What must NOT trip it:
 * "no rush", "take your time", "whenever you get a minute", and the deposit line ("we do have to
 * take a deposit up front"), all of which are proven in scripts/_test-content-guards.ts.
 *
 * NOTE this supersedes one blessed line in the archived suite: scripts/archive/_post-quote-test.ts
 * case 3d-bis passed "That covers both jobs in one visit" as the model figure-free answer. Since
 * 27 Aug 2026 that sentence is refused — "one visit" is the incident phrase.
 */
const DURATION_NUM = String.raw`(?:a|an|one|two|three|four|five|six|half a|a single|a couple of|a few|\d{1,2})`;
const DURATION_UNIT = String.raw`(?:days?|mornings?|afternoons?|evenings?|weekends?|weeks?|hours?|hrs?|visits?|trips?|sittings?)`;

const DURATION_CLAIM_PATTERNS: RegExp[] = [
    // A counted visit: "one visit", "two visits", "a single visit", "separate visits".
    /\b(?:one|two|three|four|1|2|3|4|a single|single|multiple|separate)\s+visits?\b/i,
    // A sized job: "a two day job", "one-day job", "2 day thing".
    new RegExp(String.raw`\b${DURATION_NUM}[\s-]day\b[^.?!\n]{0,15}\b(?:job|thing|work|affair)\b`, 'i'),
    // "done in a day", "all done in one go", "finished in a morning", "in and out in a morning"
    new RegExp(String.raw`\b(?:done|finished|sorted|completed|wrapped up|out)\b[^.?!\n]{0,20}\bin ${DURATION_NUM}\s+(?:go\b|${DURATION_UNIT})`, 'i'),
    /\bin one go\b|\bin a single (?:go|hit|visit)\b|\bin and out\b/i,
    /\bsame[\s-]day\b/i,
    // Loss-of-use reassurance: "only out of action while we're on site", "out of use for a day".
    /\b(?:only|just)\b[^.?!\n]{0,30}\bout of (?:action|use|commission|order)\b/i,
    new RegExp(String.raw`\bout of (?:action|use|commission|order)\b[^.?!\n]{0,45}\b(?:while|whilst|for ${DURATION_NUM}\s+${DURATION_UNIT}|that day|on the day)\b`, 'i'),
    /\b(?:back to normal|back in (?:use|action)|up and running|usable again)\b[^.?!\n]{0,30}\b(?:by|before|that (?:same )?(?:day|evening|night)|the same day|tonight|this (?:evening|afternoon))\b/i,
    // How long it takes: "won't take long on the day", "takes a couple of hours", "took two days".
    /\b(?:won(?:'|’)?t|wouldn(?:'|’)?t|shouldn(?:'|’)?t|will not|not going to|doesn(?:'|’)?t|does not) take (?:too |that |very )?long\b/i,
    new RegExp(String.raw`\b(?:takes?|taking|took)\s+(?:about |around |roughly |only |just |no more than |more than |less than |under |over )?${DURATION_NUM}\s+${DURATION_UNIT}\b`, 'i'),
    /\bwon(?:'|’)?t be (?:there |here )?(?:too |very )?long\b/i,
    /\b(?:quick|easy|fast|small) (?:job|fix)\b/i,
    // Time on site: "the lads will only be on site for a couple of hours", "with you for two days".
    new RegExp(String.raw`\b(?:on[\s-]?site|at yours|in your (?:house|home|property)|there|with you)\s+for\s+(?:only |just |about |around )?${DURATION_NUM}\s+${DURATION_UNIT}\b`, 'i'),
    // Job shape: "split it over two visits", "spread across three days".
    new RegExp(String.raw`\b(?:over|across|spread (?:over|across)|split (?:over|across|into))\s+${DURATION_NUM}\s+(?:days?|visits?|mornings?|weekends?|weeks?)\b`, 'i'),
    // The bare assertion: "it's two days", "it'll be a couple of hours", "should be one day".
    new RegExp(String.raw`\b(?:it(?:'|’)?s|it is|it(?:'|’)?ll be|it will be|that(?:'|’)?s|that is|should be|will be|going to be|would be)\s+(?:about |around |only |just |roughly )?${DURATION_NUM}\s+${DURATION_UNIT}\b`, 'i'),
    // "a full day's work", "full day on site". Bare "a full day" is left alone on purpose: it is
    // a REASON marker in the capitulation guard's lever list and eating it wholesale would refuse
    // the price-justification levers. The residual gap is noted in the guard test.
    /\b(?:a |one )?full day(?:'|’)?s?\b[^.?!\n]{0,15}\b(?:work|job|graft|on[\s-]?site)\b/i,
];

export function detectDurationClaim(body: string): string | null {
    for (const re of DURATION_CLAIM_PATTERNS) {
        const m = body.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- credentials we do not hold

/**
 * Regulated credentials this business does not hold. brand-voice/whatsapp-comms.md bans them by
 * name ("credentials we don't hold (certified, Gas Safe, qualified)") and nothing enforced it:
 * "are you Gas Safe?" is a question a customer really asks, and "yes we are" is a sentence that
 * costs an insurer's refusal and a Trading Standards complaint, not a lost sale.
 *
 * The honest answer must survive. "We're not Gas Safe registered, gas work needs a registered
 * engineer" is the RIGHT reply, so this only fires on an AFFIRMATIVE claim: the clause carrying
 * the credential is checked for a negation or a hand-off first.
 */
const CREDENTIALS = /\b(?:gas\s*safe|niceic|napit|oftec|hetas|corgi|part\s*p|nvq|city\s*(?:&|and)\s*guilds|fully qualified|time served|certified|accredited|chartered)\b/i;
/** A clause that disclaims, defers or refuses is not a claim. */
const CREDENTIAL_NEGATORS = /\b(?:not|arent|aren'?t|isn'?t|no|never|don'?t|do not|cannot|can'?t|unable|would need|will need|needs? (?:a|an)|only (?:a|an)|separate|refer|pass (?:it|you) (?:on|to)|out of our|beyond (?:our|what)|we do not touch|we don'?t touch)\b/i;

/**
 * Returns the claimed credential, or null. Splits on clause boundaries so a negation in one
 * sentence cannot excuse a claim in the next.
 */
/**
 * Regulated or licensed work this business does not do itself, and an affirmative that we will.
 * "We can add the asbestos roof removal to the quote" and "yes, we can do the boiler swap" carry
 * no credential word, so CREDENTIALS never saw them (eval rs-004 / rs-005, 4 Sep 2026): the
 * claim is in the verb, not a certificate. The nouns mirror the triage lexicon (RE_REGULATED in
 * server/spine/triage.ts) so a thread the triage holds for Ben is also a body the guard holds.
 */
const REGULATED_WORK = /\b(?:asbestos|gas(?:\s+(?:hob|cooker|fire|pipe|meter|supply|work))?|boilers?|flues?|consumer units?|fuse\s*(?:box|board)|rewir(?:e|es|ing)|load[\s-]?bearing|structural|rsj|chimney breast|solar panels?|f[\s-]?gas|air ?con(?:ditioning)?|oil (?:tank|boiler))\b/i;
const AFFIRMATIVE_CAPABILITY = /\b(?:we|i)(?:'?ll| will| can| could|'?re able to| are able to| are happy to|'?d be happy to| would be happy to)\b|\b(?:yes|yep|yeah|sure|no problem|no bother|not a problem|happy to|can do)\b/i;

export function detectCapabilityClaim(body: string): string | null {
    for (const clause of body.split(/[.!?\n]|,\s+(?:but|and|so|though)\b|---/i)) {
        const m = clause.match(CREDENTIALS);
        if (m) {
            if (CREDENTIAL_NEGATORS.test(clause)) continue;
            return m[0].trim();
        }
        const work = clause.match(REGULATED_WORK);
        if (!work) continue;
        if (!AFFIRMATIVE_CAPABILITY.test(clause)) continue;
        // "no problem" is the affirmative, not a negation: strip it before the negator check.
        if (CREDENTIAL_NEGATORS.test(clause.replace(/\bno (?:problem|bother|worries|hassle)\b|\bnot a problem\b/gi, ''))) continue;
        return work[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- liability

/**
 * An admission of fault, or a promise to pay for one.
 *
 * The standing orders already say complaints go to Ben rather than being answered with an apology
 * that carries a commitment, and until now that was a sentence in a prompt. A customer claiming we
 * scratched their floor is the highest-stakes message this agent can receive: "sorry, that's our
 * fault, we'll cover it" is an admission an insurer reads, written by something that cannot see the
 * floor. Apologising is fine. Owning the damage is not.
 */
const LIABILITY_PATTERNS: RegExp[] = [
    /\b(?:our|my) (?:fault|mistake|error|responsibility)\b/i,
    /\bwe (?:were|are|have been) (?:at fault|to blame|negligent)\b/i,
    /\bwe (?:damaged|broke|scratched|ruined|caused|cracked|spoilt|spoiled)\b/i,
    /\b(?:we'?ll|we will|i'?ll|i will) (?:cover|pay)\b[^.!?\n]{0,20}\b(?:cost|damage|repair|replacement|it|that|any)\b/i,
    /\b(?:we'?ll|we will|i'?ll|i will) (?:reimburse|refund|compensate)\b/i,
    /\b(?:full|partial) refund\b|\bput it right at our (?:cost|expense)\b|\bno charge for the (?:repair|damage)\b/i,
    /\bclaim (?:it )?(?:on|through) (?:our|the) insurance\b/i,
];

export function detectLiabilityAdmission(body: string): string | null {
    for (const re of LIABILITY_PATTERNS) {
        const m = body.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- voice, the checkable half

/**
 * The two voice rules with no legitimate exception, enforced rather than merely requested.
 * brand-voice/whatsapp-comms.md: Ben typed 3 em dashes in 1,532 messages and never once signed off
 * "Kind regards". Everything softer (question count, emoji, burst length) stays advisory, because a
 * refusal there would cost good drafts.
 */
export function detectVoiceBreach(body: string): string | null {
    const dash = body.match(/[—–]/);
    if (dash) return 'em dash / en dash';
    const signoff = body.match(/\b(?:kind regards|best regards|yours sincerely|yours faithfully|warm regards)\b/i);
    if (signoff) return signoff[0];
    return null;
}

// ---------------------------------------------------------------- what the CUSTOMER said

/**
 * Is the customer's own message a price objection?
 *
 * The capitulation guard used to run only when the MODEL labelled its own draft
 * intent='price_objection', which made the strongest post-quote rail opt-out-able by the thing it
 * was meant to constrain: relabel the draft 'other' and "No problem at all, thanks anyway" sailed
 * through. This reads the customer's words instead, which no draft can rewrite.
 */
const PRICE_OBJECTION_PATTERNS: RegExp[] = [
    /\btoo (?:much|expensive|dear|steep|pricey|high)\b/i,
    /\b(?:bit|little) (?:steep|much|pricey|dear|high|expensive)\b/i,
    /\bcheaper\b|\bcheapest\b/i,
    /\bcan'?t (?:really )?(?:afford|justify|stretch)\b|\bcannot (?:afford|justify)\b/i,
    /\bout of (?:my|our) (?:budget|price range)\b|\bover (?:my|our) budget\b/i,
    /\bmore than (?:i|we) (?:was|were) (?:expecting|hoping)\b/i,
    /\bbest (?:price|you can do)\b|\bany (?:movement|discount|deal|better)\b/i,
    /\b(?:another|other|second|third) quote\b|\bquoted me\b|\bmate got it for\b/i,
    /\bdiscount\b|\bknock (?:anything|something|a bit) off\b|\bdo (?:it|any) better\b/i,
    /\bprice (?:is|seems|feels) (?:a bit )?(?:high|steep|much)\b/i,
    // "my mate had the same done for less", "£30 less than yours"
    /\bfor less\b|\bless than (?:that|yours|what you)\b/i,
    // a counter-offer: "can you do it for 150", "would you take £140"
    /\b(?:do (?:it|that|this)|take|accept)\s+(?:it\s+)?for\s+£?\s*\d/i,
    /\bwould you take\b|\bhow about £?\d/i,
    // cash, which in this trade is always an ask for a lower number
    /\bcash (?:price|job|deal|in hand)\b|\bpay(?:ing)? (?:in )?cash\b|\bif i pay cash\b/i,
    // splitting their own number
    /\bhalf (?:of )?(?:that|it|the price|what)\b|\bmeet (?:me|you) (?:in the middle|halfway|half way)\b/i,
    /\bdo (?:me|us) a deal\b|\byouve got a deal\b|\bgot a deal\b/i,
];

export function detectPriceObjection(customerText: string | null | undefined): string | null {
    if (!customerText) return null;
    for (const re of PRICE_OBJECTION_PATTERNS) {
        const m = customerText.match(re);
        if (m) return m[0].trim();
    }
    return null;
}

// ---------------------------------------------------------------- the chain

export interface DraftCheckInput {
    body: string;
    /** A DRAFT_INTENTS value. Only 'price_objection' triggers the capitulation check. */
    intent: string;
    /** Have they opened the quote? If so, a draft may not imply otherwise. */
    quoteSeen: boolean;
    quoteViewCount?: number;
    /** Dates already offered on their quote, for the date-promise message. */
    offeredDates?: readonly string[];
    /** Quote total, so a capitulation refusal can name the band and its playbook. */
    quoteTotalPence?: number | null;
    /**
     * The customer's own last message. Used ONLY to decide whether the capitulation check applies,
     * because the draft's declared intent is written by the same model the guard constrains.
     */
    customerText?: string | null;
}

export type DraftViolation = {
    code: 'discount_offer' | 'money_figure' | 'implies_unseen' | 'capitulation' | 'date_promise'
        | 'capability_claim' | 'liability_admission' | 'voice_breach' | 'duration_claim'
        | 'policy_commitment';
    message: string;
};

/**
 * Every rule that can be decided from the text plus the quote, in the order they should fire.
 * comms.ts calls this from inside queue_draft; the test calls the same function with staged
 * inputs, so what is proven is what actually runs.
 *
 * Returns null when the draft is safe.
 */
export function checkDraft(input: DraftCheckInput): DraftViolation | null {
    const discount = detectDiscountOffer(input.body);
    if (discount) {
        return {
            code: 'discount_offer',
            message: `This draft offers a reduction ("${discount}"). You may never offer a discount, a percentage off, or any hint that there is room to move on price. The only discount this business gives is for volume, it is always Ben's call, and it is always customer-initiated. Re-scope instead ("happy to edit it for you, which bits matter most?"), or use flag_for_ben.`,
        };
    }

    // 27 Aug 2026: "the fee comes off the job if he goes ahead" — an invented credit against the
    // bill, auto-sent. Sits directly behind the discount guard because it is the same family
    // (things that change what the customer pays): a phrase carrying both a modal and a mechanism
    // is refused above as a discount, and either refusal routes to Ben.
    const policy = detectPolicyCommitment(input.body);
    if (policy) {
        return {
            code: 'policy_commitment',
            message: `This draft states commercial terms for a visit or a fee ("${policy}"). ${VISIT_TERMS_RAIL}`,
        };
    }

    const money = detectMoneyFigure(input.body);
    if (money) {
        return {
            code: 'money_figure',
            message: `This draft contains a money figure ("${money}"). You never write a figure to a customer — not even one copied correctly off their own quote. The quote page is the numbers channel: every price, deposit and line total lives there, itemised, and repeating a number in chat is how a price gets renegotiated. Rewrite the reply WITHOUT the number and point at their quote instead ("it's all itemised on your quote" plus the link). Describing WHAT is included is yours; the digits are the page's. If they need a number that is not on their quote, that is a money decision: flag_for_ben.`,
        };
    }

    const liability = detectLiabilityAdmission(input.body);
    if (liability) {
        return {
            code: 'liability_admission',
            message: `This draft admits liability or promises to pay for damage ("${liability}"). You may never do that: you cannot see the job, the contractor's account is not in this thread, and an admission written here is the one a claim is settled on. Say we are looking into it if you must say anything, set priority=urgent, and use flag_for_ben.`,
        };
    }

    const voice = detectVoiceBreach(input.body);
    if (voice) {
        return {
            code: 'voice_breach',
            message: `This draft breaks a house voice rule ("${voice}"). No em dashes or en dashes anywhere a customer can read, and never a corporate sign-off. Use a comma, a full stop or a new message part, and sign off "Thanks / Ben" or not at all. Rewrite and call queue_draft again.`,
        };
    }

    const credential = detectCapabilityClaim(input.body);
    if (credential) {
        return {
            code: 'capability_claim',
            message: `This draft claims a credential the business does not hold ("${credential}"). Never say we are Gas Safe, NICEIC, Part P, certified, accredited or qualified. If they asked, the honest answer is that we are not, and that work of that kind needs a registered engineer, which is a question for Ben. Use flag_for_ben.`,
        };
    }

    if (input.quoteSeen) {
        const unseen = detectUnseenImplication(input.body);
        if (unseen) {
            return {
                code: 'implies_unseen',
                message: `This draft implies they have not seen the quote ("${unseen}"), and they have opened it ${input.quoteViewCount ?? 1} time(s). Never ask whether the link arrived and never re-send it. Write to someone who has read it and is deciding.`,
            };
        }
    }

    // The declared intent is the MODEL's word for what it is doing, so it cannot be the only thing
    // that arms this rail: the customer's own message arms it too.
    const objection = detectPriceObjection(input.customerText);
    if (input.intent === 'price_objection' || objection) {
        const capitulation = detectCapitulation(input.body);
        if (capitulation) {
            const band = priceBandFor(input.quoteTotalPence ?? null);
            return {
                code: 'capitulation',
                message: `This draft capitulates ("${capitulation}") with no lever in it. A bare agreement to end the conversation converted 1 time in 8 and is the worst performing response we have. This quote is in the ${band.label} band: ${band.playbook} Redraft with a lever, or use flag_for_ben.`,
            };
        }
    }

    const datePromise = detectDatePromise(input.body);
    if (datePromise) {
        const offered = input.offeredDates ?? [];
        return {
            code: 'date_promise',
            message: `This draft commits to a date ("${datePromise}"). You cannot confirm a date from here. ${offered.length ? `Their quote already offers ${offered.join(', ')} — point them at the date picker on the quote so it is booked there with the deposit.` : 'Their quote offers no dates.'} If they need a specific day, use flag_for_ben. Never promise a date the thread or the quote does not already confirm.`,
        };
    }

    // 27 Aug 2026: "It's all done in one visit James" auto-sent against a quote that said TWO
    // DAYS, and the customer caught the contradiction himself. Duration is the dates rail's twin:
    // the agent may never assert it, right or wrong.
    const duration = detectDurationClaim(input.body);
    if (duration) {
        return {
            code: 'duration_claim',
            message: `This draft asserts job duration or visit count ("${duration}"). ${DURATION_RAIL}`,
        };
    }

    return null;
}
