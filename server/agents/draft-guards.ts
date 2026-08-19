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
import { priceBandFor } from './objection-levers';

// ---------------------------------------------------------------- money

/**
 * Does this text touch money at all?
 *
 * Widened 19 Aug 2026 after an adversarial pass: the original was `£\s*\d` plus "pounds|quid",
 * which meant "I can do it for 150 GBP", "call it 1.5k" and "one hundred and fifty pounds" carried
 * no money as far as the guard was concerned. They therefore needed NO price source and skipped the
 * on-quote check entirely — the exact hole the money guard exists to close, reachable by anyone who
 * can get the model to write a number without a pound sign.
 *
 * Kept as a regex because comms.ts also runs it over BEN's answers, where the question is only
 * "did a human state a figure here".
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
     * Normalised to pence so it can be compared against quote fields. NaN when the figure is
     * written in a form we cannot pin to a number ("a couple of hundred quid") — deliberately
     * un-matchable against the allowed set, so an unverifiable figure is always refused.
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
    // Spelled out. Never valued, always refused: the only safe reply repeats the quote's own digits.
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
 * Which figures in the body are NOT on the quote (or in Ben's own answer).
 *
 * This is the teeth of the money guard. Citing a quote_slug used to be enough on its own, which
 * meant a fabricated number could ride along beside a real one. Now the number itself has to
 * exist on the customer's quote.
 */
export function moneyFiguresNotAllowed(body: string, allowedPence: readonly number[]): MoneyFigure[] {
    const allowed = new Set(allowedPence.map((p) => Math.round(p)));
    return extractMoneyFigures(body).filter((f) => !allowed.has(f.pence));
}

/**
 * Negated modals confuse every "is this an offer" pattern below, because "we can't do a discount"
 * and "we can do a discount" differ by two characters. Neutralise them before matching.
 */
function stripNegations(body: string): string {
    return body
        .replace(/\b(can|could|would|will|do|does|is|are)n(?:'|’)?t\b/gi, 'NEGATED')
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
export function detectCapabilityClaim(body: string): string | null {
    for (const clause of body.split(/[.!?\n]|,\s+(?:but|and|so|though)\b|---/i)) {
        const m = clause.match(CREDENTIALS);
        if (!m) continue;
        if (CREDENTIAL_NEGATORS.test(clause)) continue;
        return m[0].trim();
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
    /**
     * The quote figures the draft is allowed to repeat, in pence. Null means the draft cited no
     * quote, so the money source was settled elsewhere (Ben's own answer) and there is nothing
     * here to check against.
     */
    allowedFigurePence: readonly number[] | null;
    /** The cited quote's slug, purely for the error message. */
    quoteSlug?: string | null;
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
    code: 'discount_offer' | 'figure_not_on_quote' | 'implies_unseen' | 'capitulation' | 'date_promise'
        | 'capability_claim' | 'liability_admission' | 'voice_breach';
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
            message: `This draft offers a reduction ("${discount}"). You may never offer a discount, a percentage off, or any hint that there is room to move on price. The only discount this business gives is for volume, it is always Ben's call, and it is always customer-initiated. Re-scope instead ("happy to edit it for you, which bits matter most?"), or use ask_ben.`,
        };
    }

    if (input.allowedFigurePence) {
        const bad = moneyFiguresNotAllowed(input.body, input.allowedFigurePence);
        if (bad.length) {
            const known = input.allowedFigurePence.map((p) => `£${p / 100}`).join(', ') || '(none)';
            const vague = bad.filter((b) => b.unverifiable);
            return {
                code: 'figure_not_on_quote',
                message: `These figures are not on quote ${input.quoteSlug ?? '(cited)'}: ${bad.map((b) => b.raw).join(', ')}. The only figures on it are: ${known}. You may repeat what is already on their quote and nothing else.${vague.length ? ' Write a price as the digits on the quote (£180), never in words, so it can be checked.' : ''} If the customer needs a different number, use ask_ben.`,
            };
        }
    }

    const liability = detectLiabilityAdmission(input.body);
    if (liability) {
        return {
            code: 'liability_admission',
            message: `This draft admits liability or promises to pay for damage ("${liability}"). You may never do that: you cannot see the job, the contractor's account is not in this thread, and an admission written here is the one a claim is settled on. Say we are looking into it if you must say anything, set priority=urgent, and use ask_ben.`,
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
            message: `This draft claims a credential the business does not hold ("${credential}"). Never say we are Gas Safe, NICEIC, Part P, certified, accredited or qualified. If they asked, the honest answer is that we are not, and that work of that kind needs a registered engineer, which is a question for Ben. Use ask_ben.`,
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
                message: `This draft capitulates ("${capitulation}") with no lever in it. A bare agreement to end the conversation converted 1 time in 8 and is the worst performing response we have. This quote is in the ${band.label} band: ${band.playbook} Redraft with a lever, or use ask_ben.`,
            };
        }
    }

    const datePromise = detectDatePromise(input.body);
    if (datePromise) {
        const offered = input.offeredDates ?? [];
        return {
            code: 'date_promise',
            message: `This draft commits to a date ("${datePromise}"). You cannot confirm a date from here. ${offered.length ? `Their quote already offers ${offered.join(', ')} — point them at the date picker on the quote so it is booked there with the deposit.` : 'Their quote offers no dates.'} If they need a specific day, use ask_ben. Never promise a date the thread or the quote does not already confirm.`,
        };
    }

    return null;
}
