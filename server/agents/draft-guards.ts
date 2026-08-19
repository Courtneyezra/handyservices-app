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

/** The original guard from comms.ts: does this text touch money at all? */
export const MONEY_RE = /£\s*\d|(?:\b\d+(?:\.\d+)?\s*(?:pounds|quid)\b)/i;

export interface MoneyFigure {
    /** As written, e.g. "£1,200" or "180 quid". */
    raw: string;
    /** Normalised to pence so it can be compared against quote fields. */
    pence: number;
}

/**
 * Every money figure in a body, normalised to pence. "£180" and "£180.00" both come out as
 * 18000 so a draft cannot dodge the check by adding decimals.
 */
export function extractMoneyFigures(body: string): MoneyFigure[] {
    const out: MoneyFigure[] = [];
    const re = /£\s*([\d,]+(?:\.\d{1,2})?)|(\b[\d,]+(?:\.\d{1,2})?)\s*(?:pounds|quid)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        const digits = (m[1] ?? m[2] ?? '').replace(/,/g, '');
        if (!digits) continue;
        const value = Number(digits);
        if (!Number.isFinite(value)) continue;
        out.push({ raw: m[0].trim(), pence: Math.round(value * 100) });
    }
    return out;
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

    const patterns: RegExp[] = [
        // "10% off", "10 % discount"
        /\b\d{1,2}\s*%\s*(?:off|discount|reduction|less)\b/i,
        // "£20 off", "20 quid off"
        /£\s*[\d,]+(?:\.\d{1,2})?\s*(?:off|discount)\b/i,
        // an offering modal within a short reach of a reduction word
        /\b(?:can|could|will|would|happy to|able to|let me|i'?ll|we'?ll)\b[^.!?\n]{0,45}\b(?:discount|reduction|knock (?:off|it down)|bring (?:it|the price) down|come down|reduce (?:it|the price)|lower (?:it|the price)|drop (?:it|the price)|do it for less|do you a deal|meet you (?:in the middle|halfway|half way))\b/i,
        // a reduction word aimed at the customer
        /\b(?:discount|reduction)\b[^.!?\n]{0,20}\bfor you\b/i,
        // haggling closers
        /\b(?:best price i can do|best i can do is|i can do it for)\b/i,
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
    /\b(?:did|have)\s+you\s+(?:get|got|had|have|managed)\b[^.?!\n]{0,25}\b(?:look|see|seen|view|receive|read|open)\w*\b/i,
    /\b(?:did|have)\s+you\s+(?:see|seen|receive|received|get|got)\s+(?:the|your|our|it|that)\b/i,
    /\bjust (?:checking|making sure)\b[^.?!\n]{0,30}\b(?:got|received|saw|seen|came through|reached)\b/i,
    /\bin case you (?:missed|haven'?t seen)\b/i,
    /\bnot sure (?:if|whether) you (?:saw|got|received|had a chance to (?:see|look))\b/i,
    /\bdid it come through\b/i,
    /\b(?:re-?sending|sending (?:it|the quote|the link) (?:again|over again|across again))\b/i,
    /\bhere'?s (?:the|your) (?:quote )?link again\b/i,
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
const DATE_ISH = `(?:${WEEKDAY}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*|\\d{1,2}\\/\\d{1,2})`;

/**
 * A committed date. "We can come Tuesday" is a promise; "the quote has Tuesday on it" is not.
 * Matching the COMMITTING VERB rather than the weekday is what keeps the difference.
 */
const DATE_PROMISE_PATTERNS: RegExp[] = [
    new RegExp(`\\b(?:we|i)(?:'ll| will| can| could)\\s+(?:come|be there|pop (?:round|over)|get (?:that|it) done|do (?:it|that)|call round|swing by)\\b[^.?!\\n]{0,20}\\b${DATE_ISH}`, 'i'),
    new RegExp(`\\b(?:see you|book(?:ing)? you in for|put you (?:in|down) for|pencil(?:led)? (?:you )?in for|we'?re free|we have|i have|we'?ve got)\\b[^.?!\\n]{0,20}\\b${DATE_ISH}`, 'i'),
    new RegExp(`\\b${DATE_ISH}\\b[^.?!\\n]{0,20}\\b(?:works for us|is fine|no problem|we can do|is booked|is confirmed)\\b`, 'i'),
    /\b(?:yes|yeah|yep)\b[^.?!\n]{0,12}\b(?:we can do|that works|that'?s fine|see you then)\b/i,
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
}

export type DraftViolation = {
    code: 'discount_offer' | 'figure_not_on_quote' | 'implies_unseen' | 'capitulation' | 'date_promise';
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
            return {
                code: 'figure_not_on_quote',
                message: `These figures are not on quote ${input.quoteSlug ?? '(cited)'}: ${bad.map((b) => b.raw).join(', ')}. The only figures on it are: ${known}. You may repeat what is already on their quote and nothing else. If the customer needs a different number, use ask_ben.`,
            };
        }
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

    if (input.intent === 'price_objection') {
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
