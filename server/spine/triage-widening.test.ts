/** Phase 3 / C: the customer lines the eval families showed slipping past the pre-checks. */
import { describe, it, expect } from 'vitest';
import { RE_MONEY, RE_DATE } from './triage';

describe('triage lexicon widening', () => {
    it.each(['Soory it\'s to much', 'What\'s your hourly rate?', 'Do you charge for coming out to look?', 'a bit steep for me'])('money: %s', (t) => {
        expect(RE_MONEY.test(t)).toBe(true);
    });
    it.each(['What time will Craig arrive?', 'Ok so is another day better?', 'Is it AM or PM? I need to know for work', 'Between 11 and 12 please'])('date: %s', (t) => {
        expect(RE_DATE.test(t)).toBe(true);
    });
    it('ordinary scoping lines still pass', () => {
        for (const t of ['Yes that\'s fine', 'It\'s the same tap, just a new cartridge', 'Two windows, both in the front bedroom', 'Sent the video just now']) {
            expect(RE_MONEY.test(t), t).toBe(false);
            expect(RE_DATE.test(t), t).toBe(false);
        }
    });
});
