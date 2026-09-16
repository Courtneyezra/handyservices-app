import { describe, expect, it } from 'vitest';
import { detectOptOut } from './opt-out-detect';

// Overnight round 19 (16 Sep 2026): these everyday opt-outs reached the new desk's router and composer
// and were answered, because only the bare keywords and a few phrases were read as one.
describe('detectOptOut', () => {
    it('reads the everyday ways people text an opt-out', () => {
        const all = ["Don't text me again", 'Do not text me again', "Please don't message me anymore", "Don't message me again",
            'Dont text me', "please don't text me again"];
        const marketing = ['Wrong number, please stop', 'Wrong number. Stop.', "I didn't ask for this, stop", 'Stop, found someone else',
            'Stop - not needed anymore', "Stop please I'm not interested", 'stop msging me', 'Stop msg', 'stop txt', 'Stop sms',
            'stop now', 'STOP NOW', 'Stop it', 'Please stop sending texts', 'Please take my number off your list', 'Stop! Who is this?'];
        for (const t of all) expect(detectOptOut(t)?.scope, t).toBe('all');
        for (const t of marketing) expect(detectOptOut(t)?.scope, t).toBe('marketing');
    });

    it('still leaves job talk, channel preferences and a stop with no reason alone', () => {
        const not = ['stop by tomorrow', "the tap won't stop dripping", "Please don't call me, text instead", "Don't text me, call me instead",
            "Don't text me again, just call", "Don't message me any more on this number, email me", 'Stop, the leak is getting worse',
            'stop cock not needed', 'Stop the leak please, not needed tomorrow', "Wait stop, I've sorted the photo",
            "The water won't stop, it's the wrong number of washers", 'Please stop by, sorted parking for you', 'Wrong number sorry',
            "I'm not interested in the extra shelf, just the tap", "Don't text after 9pm please", 'end of the week works'];
        for (const t of not) expect(detectOptOut(t), t).toBeNull();
    });
});
