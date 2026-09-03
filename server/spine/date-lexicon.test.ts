/**
 * P17 item 1 (`ab-007-in-on-thursday`): a bare weekday is availability, not a date question.
 *
 * "we're in on Thursday" tells us when the customer is around. The old flat alternation read it as
 * a question, added `date_question` and laned the thread to Ben, so ordinary scoping landed in his
 * queue. The asking half still fires on its own; a bare day now needs the customer to be asking.
 *
 * Both directions use the real strings: the eval cases (absence, date_question, point_to_picker)
 * and the Phase 3 / C widening lines.
 */
import { describe, it, expect } from 'vitest';
import { RE_DATE, RE_DATE_ASKING, RE_DAY_WORD, looksLikeDateQuestion } from './date-lexicon';

describe('looksLikeDateQuestion — the customer is asking', () => {
    it.each([
        // the brief's four
        'can you come Thursday?',
        'what day are you coming?',
        'is Thursday ok?',
        'When can you fit me in?',
        // the eval cases that must stay green
        'Can you come Tuesday morning?',          // dq-001
        'What time will Craig arrive?',           // dq-002
        'Ok so is another day better?',           // dq-003
        'What day can you come? Back soon with the measurement', // dq-007
        'Can you do Saturday morning?',           // pp-004
        // the Phase 3 / C widening lines
        'Is it AM or PM? I need to know for work',
        'Between 11 and 12 please',
        // a day paired with an asking verb but no question mark
        'how about Friday',
        'any chance of Monday',
        'are you free Tuesday',
        'could you do next week',
    ])('asks: %s', (t) => {
        expect(looksLikeDateQuestion(t)).toBe(true);
    });
});

describe('looksLikeDateQuestion — the customer is stating availability', () => {
    it.each([
        "we're in on Thursday",       // ab-007, the red this fixes
        "I'm around Tuesday",
        "we're away next week",
        'we are in all day monday',
        'the shed is coming tomorrow',
        'Okay thank you i wil let you know tomorrow',  // the customer promising US, not asking
    ])('does not escalate: %s', (t) => {
        expect(looksLikeDateQuestion(t)).toBe(false);
    });

    it('ordinary scoping lines are not dates at all', () => {
        for (const t of [
            "Yes that's fine",
            "It's the same tap, just a new cartridge",
            'Two windows, both in the front bedroom',
            'Sent the video just now',
            "That's the only cladding, back soon with measurement", // dq-006
        ]) {
            expect(looksLikeDateQuestion(t), t).toBe(false);
            expect(RE_DATE.test(t), t).toBe(false);
        }
    });
});

describe('the two halves', () => {
    it('an asking phrase fires on its own, with no day and no question mark', () => {
        expect(RE_DATE_ASKING.test('what time works')).toBe(true);
        expect(looksLikeDateQuestion('what time works')).toBe(true);
        expect(RE_DAY_WORD.test('what time works')).toBe(false);
    });

    it('a bare day is a date MENTION but not a date QUESTION', () => {
        expect(RE_DAY_WORD.test("we're in on Thursday")).toBe(true);
        expect(RE_DATE.test("we're in on Thursday")).toBe(true);
        expect(looksLikeDateQuestion("we're in on Thursday")).toBe(false);
    });

    it('empty and whitespace are never a question', () => {
        for (const t of [null, undefined, '', '   ']) expect(looksLikeDateQuestion(t)).toBe(false);
    });
});
