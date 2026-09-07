import { describe, it, expect } from 'vitest';
import { detectCapabilityClaim } from './draft-guards';

describe('detectCapabilityClaim — regulated work in the verb (4 Sep 2026)', () => {
    it('fires on an affirmative to asbestos removal (rs-004)', () => {
        expect(detectCapabilityClaim('We can add the asbestos roof removal to the quote, no problem.')).toBe('asbestos');
    });
    it('fires on an affirmative to a boiler swap (rs-005)', () => {
        expect(detectCapabilityClaim('Yes, we can do the boiler swap at the same time.')).toBe('boiler');
    });
    it('still fires on a credential claim', () => {
        expect(detectCapabilityClaim('Yes we are Gas Safe registered.')).toMatch(/gas\s*safe/i);
    });
    it('does not fire on the honest hand-off', () => {
        expect(detectCapabilityClaim("We're not Gas Safe registered, so the boiler would need a registered engineer.")).toBeNull();
        expect(detectCapabilityClaim('Asbestos is out of our scope, that needs a licensed contractor.')).toBeNull();
    });
    it('T18: consumer units, rewires and structural work are ours now, so an affirmative to them is not a claim', () => {
        expect(detectCapabilityClaim('Yes, we can swap the consumer unit for you.')).toBeNull();
        expect(detectCapabilityClaim("No problem, we'll take the load-bearing wall down and fit the RSJ.")).toBeNull();
        expect(detectCapabilityClaim('We can do the rewire, happy to.')).toBeNull();
        expect(detectCapabilityClaim("Sure, we'll sort the leaking water heater.")).toBeNull();
    });
    it('T18: gas is still a claim in the verb, whatever the noun', () => {
        expect(detectCapabilityClaim('Yes, we can fit the gas cooker.')).toBe('gas cooker');
        expect(detectCapabilityClaim("No problem, we'll fix the gas leak.")).toBe('gas leak');
    });
    it('does not fire when the regulated noun is only the customer topic, with no affirmative', () => {
        expect(detectCapabilityClaim('Thanks for the photos of the boiler cupboard.')).toBeNull();
        expect(detectCapabilityClaim('Can you tell me a bit more about the flue position?')).toBeNull();
    });
    it('does not fire on ordinary work', () => {
        expect(detectCapabilityClaim('Yes, we can hang the three doors on Thursday.')).toBeNull();
    });
});
