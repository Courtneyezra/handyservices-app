import { describe, it, expect } from 'vitest';
import { lexiconExceptions, lexiconLane } from './triage-lexicon';

describe('lexiconExceptions', () => {
    it('money', () => {
        for (const t of ['Tell me price', 'How much would that be?', "It's sounding too expensive already mate", 'Soory it\'s to much', 'Any discount for cash?', 'what do you charge per hour', 'Is the £450 including materials?'])
            expect(lexiconExceptions(t), t).toContain('money_question');
    });
    it('dates', () => {
        for (const t of ['Ok so is another day better?', 'What time works for you?', 'Between 11 and 12 please', 'Can we reschedule the visit', 'are you available on Saturday?', 'Is it AM or PM? I need to know for work'])
            expect(lexiconExceptions(t), t).toContain('date_question');
    });
    it('callback, complaint, refund, opt-out, trust', () => {
        expect(lexiconExceptions('Happy with quote. Can someone call me to discuss before I pay?')).toContain('callback_requested');
        expect(lexiconExceptions('Honestly not happy with the job, the paint is peeling already')).toContain('complaint');
        expect(lexiconExceptions('I want a refund')).toContain('refund');
        expect(lexiconExceptions('STOP')).toContain('opted_out');
        expect(lexiconExceptions('is this a scam?')).toContain('trust_concern');
    });
    it('ordinary scoping text raises nothing', () => {
        for (const t of ['Yes that\'s fine', 'Ng37eg', 'concrete floor', 'It\'s come completely loose', 'No water tanks but will be pipes', 'Landing about 1 meter sq', 'Yes sure, happy to talk', 'already sent, see above', 'The bath leak is under the taps I think', 'Two bedrooms and the hallway'])
            expect(lexiconExceptions(t), t).toEqual([]);
    });
    it('empty is empty', () => {
        expect(lexiconExceptions('')).toEqual([]);
        expect(lexiconExceptions(null)).toEqual([]);
    });
});

describe('lexiconLane', () => {
    it('any exception lanes to Ben; opt-out drops; else scoper/rules/post_quote', () => {
        expect(lexiconLane(['money_question'])).toBe('ben');
        expect(lexiconLane(['opted_out'])).toBe('dropped');
        expect(lexiconLane([])).toBe('scoper');
        expect(lexiconLane([], { firstContact: true })).toBe('rules');
        expect(lexiconLane([], { postQuote: true })).toBe('post_quote');
    });
});
