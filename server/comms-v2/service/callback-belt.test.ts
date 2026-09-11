/**
 * The callback belt (7.2): a request for a call, or accepting one, holds for Ben whatever the
 * router read; a negated one does not, and neither does a request for a visit ("call round").
 */
import { describe, expect, it } from 'vitest';
import { callbackRequestMatch } from '../desk/lexicon';

describe('callbackRequestMatch', () => {
    it('reads a request for a call and an acceptance of one', () => {
        for (const t of ['Can you ring me about it?', 'Could Ben give me a call tomorrow', 'yes please call me', 'Just call me on this number', "I'd rather talk on the phone", 'A quick call would be easier', 'Ok, ring me when you can']) expect(callbackRequestMatch(t), t).toBeTruthy();
    });
    it('does not read a negated request or a plain answer', () => {
        for (const t of ['No need to call me, text is fine', "Please don't ring me, I'm at work", 'The tap is dripping', 'Whereabouts in the kitchen? Under the sink.', 'I called you last week about the fence']) expect(callbackRequestMatch(t), t).toBeNull();
    });
    it('does not read a request for a visit as a request for a phone call', () => {
        for (const t of ['Can you call round tomorrow to look at it?', 'Could someone call in on Tuesday', 'can you call out this week', 'Would Ben call by at some point?']) expect(callbackRequestMatch(t), t).toBeNull();
    });
});
