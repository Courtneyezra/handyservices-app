/**
 * The date lexicon, on its own and PURE (P17 item 1, `ab-007-in-on-thursday`).
 *
 * Split out of server/spine/triage.ts so the rule can be tested without the database that module
 * pulls in at import time. triage.ts re-exports every name here, so nothing else changed shape.
 */

/**
 * The date lexicon in two halves (P17 item 1, `ab-007-in-on-thursday`).
 *
 * A bare weekday is not a question. "we're in on Thursday" states AVAILABILITY — the customer
 * telling us when they are around, which is scoping, not something Ben decides — and the single
 * flat alternation escalated it, so ordinary scoping threads landed in Ben's lane carrying a
 * `date_question` nobody asked.
 *
 *   RE_DATE_ASKING  phrases that ARE the question however they are punctuated: "when can you",
 *                   "what day", "what time", "another day", "reschedule", "availability", "slot",
 *                   "book", "between 11 and 12", "am or pm". These fire on their own.
 *   RE_DAY_WORD     a bare day token: a weekday, "tomorrow", "next week". Ambiguous by itself, so
 *                   it fires ONLY alongside RE_ASKING_SHAPE — a question mark, a wh-word, or a
 *                   request verb ("can you come Thursday?", "is Thursday ok?", "how about Friday").
 *
 * Widening is still the safe direction, so the asking half keeps everything the Phase 3 / C pass
 * added. What changed is only the bare day token, which now needs the customer to be asking.
 */
export const RE_DATE_ASKING = /(when can|when could|when will|when are you|what day|which day|what time|another day|other day|reschedule|re-?arrange|am or pm|pm or am|morning or afternoon|earliest|soonest|between \d{1,2}(:\d{2})?\s?(am|pm)? and \d{1,2}|available|availability|book|slot)/i;

/** A day the customer names, with no asking in it yet. */
export const RE_DAY_WORD = /\b(next week|this week|tomorrow|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/**
 * The customer is ASKING, not telling. A question mark, a wh-word, or a request verb. Deliberately
 * excludes the customer's own promises ("I'll let you know tomorrow") and plain statements of where
 * they are ("we're in on Thursday", "I'm around Tuesday", "we're away next week").
 */
export const RE_ASKING_SHAPE = /\?|\b(when|what|which|how about|what about|any chance|is it|is that|is there|are you|can you|can we|could you|could we|would you|would it|will you|do you|does that|shall we|possible|suits?|suitable|work for you|works for you|ok for|okay for|good for|fit (me|us) in|book (me|us) in|put (me|us) down|pencil)\b/i;

/**
 * Backwards-compatible union: anything either half matches. Exported because the widening test and
 * any future caller read it as "does this text mention a date at all". The TRIAGE decision uses
 * `looksLikeDateQuestion` — the union alone is what over-escalated.
 */
export const RE_DATE = new RegExp(`(${RE_DATE_ASKING.source}|${RE_DAY_WORD.source})`, 'i');

/**
 * Pure: does the customer's message ask about a date, rather than state their availability?
 * An asking phrase is enough on its own; a bare day needs a question mark or a request verb.
 */
export function looksLikeDateQuestion(text: string | null | undefined): boolean {
    const t = (text ?? '').trim();
    if (!t) return false;
    if (RE_DATE_ASKING.test(t)) return true;
    return RE_DAY_WORD.test(t) && RE_ASKING_SHAPE.test(t);
}
