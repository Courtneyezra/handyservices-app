/**
 * The words that count as an opt-out today (17 Sep 2026, "Keep today's words"), written out by hand
 * so a test can walk every one against the detector. Changing one is a decision for Ben, not a
 * test update.
 */
import type { OptOutScope } from '../opt-out-detect';

/** A whole message that is nothing but one of these is an opt-out. */
export const EXACT_WORDS: Record<OptOutScope, string[]> = {
    marketing: [
        'stop', 'stopp', 'stop stop',
        'unsubscribe', 'unsub', 'unsubscribe me',
        'optout', 'opt out', 'opt me out',
        'end', 'quit',
        'remove me', 'take me off', 'take me off your list', 'take me off the list',
        'no more messages', 'no more texts', 'no more msgs',
        'stop messages', 'stop messaging', 'stop messaging me',
        'stop texting', 'stop texting me', 'stop text',
        'stop contacting me', 'stop emails',
        'stop sending messages', 'stop sending me messages', 'stop sending me texts',
    ],
    all: [
        'stop all', 'stopall',
        'do not contact', 'do not contact me', 'dont contact', 'dont contact me',
        'do not message me', 'dont message me', 'do not call me', 'dont call me again',
        'delete my number', 'delete my details', 'delete my data',
        'remove my number', 'remove my details',
        'lose my number', 'leave me alone',
        'never contact me', 'never contact me again', 'never message me again',
    ],
};

/** A short message carrying one of these is an opt-out. */
export const PHRASES: Record<OptOutScope, string[]> = {
    all: [
        'do not contact', 'dont contact me', 'do not ever contact', 'never contact me',
        'delete my number', 'delete my details', 'remove my number', 'lose my number',
        'leave me alone', 'stop all messages', 'stop all contact',
    ],
    marketing: [
        'unsubscribe',
        'opt out', 'opt me out', 'opted out',
        'stop messaging', 'stop texting', 'stop contacting',
        'stop sending me messages', 'stop sending me texts', 'stop sending me anything',
        'stop sending me these', 'stop sending these', 'stop sending any more',
        'stop these messages', 'stop the messages', 'stop these texts', 'stop the texts',
        'no more messages', 'no more texts', 'no more marketing',
        'any more of these messages', 'any more of these texts', 'any more of these',
        'take me off your list', 'take me off the list', 'take me off your mailing list',
        'take me off this list', 'take me off your database',
        'remove me from your list', 'remove me from the list', 'remove me from your database',
        'remove me from your mailing list', 'remove me from this list',
        'no longer wish to receive', 'do not wish to receive', 'dont want any more messages',
        'stop the marketing', 'stop spamming', 'stop spamming me',
    ],
};

/** Every word and phrase above, each on its own as a whole message. */
export const ALL_OPT_OUT_WORDS: string[] = [...EXACT_WORDS.marketing, ...EXACT_WORDS.all, ...PHRASES.all, ...PHRASES.marketing];

/** Messages that carry a stop-like word and are deliberately not opt-outs. */
export const NEAR_MISSES = ['cancel', 'remove', 'no more', 'stop sending someone round on Fridays', 'can you stop the leak', "the tap won't stop dripping", 'stop by on Tuesday'];
