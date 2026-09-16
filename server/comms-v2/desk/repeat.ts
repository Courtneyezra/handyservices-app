/**
 * "Never a repeat of the previous message" (behaviour.md answer 90, 16 Sep 2026).
 *
 * The Kiran thread (16 Sep 2026) ended with four replies in a minute that each said the quote was
 * being put together, reworded every time. The one-reply guard counts replies per customer turn and
 * each of those answered a turn, so it let all four through. This check reads a reply against what
 * the business has said to the same party since it last asked them something, and names every
 * wrap-up sentence in it ("that's everything I need", "I'll put the quote together and send it
 * over", however it is worded) when one of those messages already wrapped up. A question asked since
 * (a new job being scoped) starts the count again. Nothing else is compared: an answer a customer asks for
 * twice is still given twice, and a brief human acknowledgement ("No worries at all, Kiran.") is what
 * answer 90 asks for.
 */
import type { CaseFile, Turn } from './case-file';

const RE_QUOTE = /\bquote\b/i;
const RE_QUOTE_PROMISE = /\b(?:put(?:ting)?\b.*\btogether|send(?:ing)?\b.*\bover|pric(?:e|ing)\b.*\bup|work(?:ing)?\s+on|sort(?:ing)?\s+out|get(?:ting)?\b.*\bover)\b/i;
const RE_ALL_I_NEED = /\b(?:everything|all)\s+(?:I|we)\s+need\b/i;

export function sentencesOf(text: string): string[] {
    return text.replace(/\r\n/g, '\n').split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The sentence wraps up: says that is everything needed, or that the quote is being put together or sent over. */
export function isWrapUp(sentence: string): boolean {
    return RE_ALL_I_NEED.test(sentence) || (RE_QUOTE.test(sentence) && RE_QUOTE_PROMISE.test(sentence));
}

/** Every wrap-up sentence of `reply`, when one of the `previous` messages already wrapped up. */
export function repeatedSentences(reply: string, previous: readonly string[]): string[] {
    if (!previous.some((p) => sentencesOf(p).some(isWrapUp))) return [];
    return sentencesOf(reply).filter(isWrapUp);
}

/**
 * What the business has said to this party since it last asked them something, newest first: every
 * outbound message back to (not including) the newest one with a question mark in it.
 */
export function saidSinceLastQuestion(file: CaseFile, partyId: string): Turn[] {
    const out: Turn[] = [];
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.direction !== 'outbound' || t.partyId !== partyId) continue;
        if (t.body.includes('?')) break;
        out.push(t);
    }
    return out;
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
