/**
 * "Never a repeat of the previous message" (behaviour.md answer 90, 16 Sep 2026).
 *
 * The Kiran thread (16 Sep 2026) ended with four replies in a minute that each said the quote was
 * being put together, reworded every time. The one-reply guard counts replies per customer turn and
 * each of those answered a turn, so it let all four through. This check reads a reply against what
 * the business has said to the same party since it last asked them something, and names every
 * wrap-up sentence in it ("that's everything I need", "I'll put the quote together and send it
 * over", however it is worded) when one of those messages already wrapped up. A question asked since
 * (a new job being scoped) starts the count again; a closing offer ("Anything else I can help with?")
 * asks them nothing and does not. Nothing else is compared: an answer a customer asks for
 * twice is still given twice, and a brief human acknowledgement ("No worries at all, Kiran.") is what
 * answer 90 asks for.
 */
import type { CaseFile, Turn } from './case-file';

// The quote by any of its everyday names: a quote, a price, an estimate, the costs, a figure.
const RE_QUOTE = /\b(?:quotes?|prices?|pricing|estimates?|costs?|costings?|figures?)\b/i;
// However the composer rewords it: put together, priced up, prepared, sent/texted/popped/dropped over or
// across, sent to them, with them, theirs to have, on its way or coming their way, to follow, expected,
// in their inbox, let known, being worked on, or coming back to them with it.
const RE_QUOTE_PROMISE = new RegExp([
    String.raw`put(?:ting)?\b.*\btogether`,
    String.raw`pric(?:e|ing)\b.*\bup`,
    String.raw`work(?:ing)?\s+(?:on|out)`,
    String.raw`sort(?:ing)?\s+out`,
    String.raw`prepar(?:e|ed|ing)`,
    String.raw`draw(?:ing)?\s+up`,
    String.raw`(?:send|sending|get|getting|text|texting|pop|popping|pass|passing|message|messaging|email|emailing|drop|dropping|ping|pinging|fire|firing|shoot|shooting|whatsapp)\b.*\b(?:over|across|through|to you)`,
    String.raw`(?:send|sending|message|messaging|text|texting|email|emailing)\s+(?:you|it)`,
    String.raw`coming\s+(?:shortly|soon|later|today|tonight|tomorrow)`,
    String.raw`your\s+(?:way|inbox)`,
    String.raw`(?:to|will|['’]ll|shall|should)\s+follow`,
    String.raw`follow(?:ing)?\s+up`,
    String.raw`expect\s+(?:the|a|your|it)`,
    String.raw`let\s+you\s+know`,
    String.raw`(?:['’]ll|will|shall)\s+have\s+(?:the|a|your|it)\s+(?:quote|price|estimate|figure|over|ready|with)`,
    String.raw`(?:['’]s|is|['’]m|am|['’]re|are)\s+on\s+(?:it|(?:the|your)\s+(?:quote|price|estimate))`,
    String.raw`with you`,
    String.raw`on (?:its|the) way`,
    String.raw`(?:be|come|coming|get|getting)\s+back\s+(?:to\s+you|with)`,
    String.raw`you(?:['’]ll|\s+will)\s+have(?!\s+to\b)`,
    String.raw`be\s+in\s+touch`,
].map((p) => `\\b(?:${p})\\b`).join('|'), 'i');
// A sign-off question that asks the customer for nothing: anything else we can help with or they need, any questions.
const RE_CLOSING_OFFER = new RegExp(`^(?:(?:and|also|oh|but),?\\s+)?(?:${[
    String.raw`(?:is\s+there\s+|have\s+you\s+got\s+|got\s+)?any(?:thing|\s+other|\s+more|\s+further)?\s+(?:else\s+)?questions?`,
    String.raw`(?:is\s+there\s+)?anything\s+else\s+(?:I|we)\s+can\s+(?:help|do)`,
    String.raw`(?:is\s+there\s+)?anything\s+else\s+you\s+need\s+(?:from\s+(?:me|us)|to\s+know)`,
    String.raw`(?:can|could)\s+(?:I|we)\s+help\s+(?:you\s+)?with\s+anything\s+else`,
].join('|')})\\b`, 'i');
const RE_ALL_I_NEED = /\b(?:everything|all)\s+(?:I|we)\s+need\b/i;

export function sentencesOf(text: string): string[] {
    return text.replace(/\r\n/g, '\n').split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The sentence wraps up: says that is everything needed, or promises the quote in any wording. A question never does. */
export function isWrapUp(sentence: string): boolean {
    if (sentence.trimEnd().endsWith('?')) return false;
    return RE_ALL_I_NEED.test(sentence) || (RE_QUOTE.test(sentence) && RE_QUOTE_PROMISE.test(sentence));
}

/** Every wrap-up sentence of `reply`, when one of the `previous` messages already wrapped up. */
export function repeatedSentences(reply: string, previous: readonly string[]): string[] {
    if (!previous.some((p) => sentencesOf(p).some(isWrapUp))) return [];
    return sentencesOf(reply).filter(isWrapUp);
}

/**
 * What the business has said to this party since it last asked them something, newest first: every
 * outbound message back to (not including) the newest one with a question mark in it, a closing
 * offer's aside.
 */
export function saidSinceLastQuestion(file: CaseFile, partyId: string): Turn[] {
    const out: Turn[] = [];
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.direction !== 'outbound' || t.partyId !== partyId) continue;
        if (asksSomething(t.body)) break;
        out.push(t);
    }
    return out;
}

/** The message asks the party something: a question mark on any sentence that is not a closing offer. */
function asksSomething(body: string): boolean {
    return sentencesOf(body).some((s) => s.includes('?') && !RE_CLOSING_OFFER.test(s));
}

/**
 * The reply with the repeated sentences taken out, keeping its bubble breaks. Empty when nothing
 * else was in it.
 */
export function withoutSentences(reply: string, drop: readonly string[]): string {
    if (!drop.length) return reply;
    const gone = new Set(drop);
    return reply.replace(/\r\n/g, '\n').split(/\n\s*\n+/)
        .map((p) => sentencesOf(p).filter((s) => !gone.has(s)).join(' '))
        .filter((p) => p.trim())
        .join('\n\n');
}
