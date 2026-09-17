/**
 * The words that count as an opt-out are pinned (17 Sep 2026, "Keep today's words"): the old desk
 * (server/opt-out.ts) and the new one (server/comms-v2/desk/desk.ts) read the same detector, and a
 * fix that silences an opt-out on the new desk must not widen or narrow what counts as one. The
 * detector moved to server/opt-out-detect.ts byte for byte; the hash is of the rules as they stood
 * in server/opt-out.ts on main at 61309613. Changing a word or a rule is a decision for Ben, not a
 * test update.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { detectOptOut } from '../opt-out-detect';
import { detectionRulesHash, optOutWords } from './opt-out-words';

describe('opt-out words', () => {
    it('the detection rules are byte for byte the ones on main before the move', () => {
        expect(detectionRulesHash()).toBe('05b50546e24597e708944ffbdba8bfa30eabbdb2e41158c60906a51d6fa95b25');
    });

    it('the whole-message words are today\'s', () => {
        expect(optOutWords('EXACT_MARKETING')).toEqual([
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
        ]);
        expect(optOutWords('EXACT_ALL')).toEqual([
            'stop all', 'stopall',
            'do not contact', 'do not contact me', 'dont contact', 'dont contact me',
            'do not message me', 'dont message me', 'do not call me', 'dont call me again',
            'delete my number', 'delete my details', 'delete my data',
            'remove my number', 'remove my details',
            'lose my number', 'leave me alone',
            'never contact me', 'never contact me again', 'never message me again',
        ]);
    });

    it('the phrases are today\'s', () => {
        expect(optOutWords('PHRASE_ALL')).toEqual([
            'do not contact', 'dont contact me', 'do not ever contact', 'never contact me',
            'delete my number', 'delete my details', 'remove my number', 'lose my number',
            'leave me alone', 'stop all messages', 'stop all contact',
        ]);
        expect(optOutWords('PHRASE_MARKETING')).toEqual([
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
        ]);
    });

    it('server/opt-out.ts still hands out the same detector, and the deliberate misses still miss', () => {
        // Read as text: importing server/opt-out.ts opens the database module.
        const ledger = readFileSync(path.resolve(__dirname, '../opt-out.ts'), 'utf8');
        expect(ledger).toContain("import { OPT_OUT_SCOPES, detectOptOut, type OptOutMatch, type OptOutScope } from './opt-out-detect';");
        expect(ledger).toContain('export { OPT_OUT_SCOPES, detectOptOut, type OptOutMatch, type OptOutScope };');
        expect(ledger).not.toMatch(/function detectOptOut|const (EXACT|PHRASE)_/);
        for (const text of ['cancel', 'remove', 'no more', 'stop sending someone round on Fridays', 'can you stop the leak', "the tap won't stop dripping"]) {
            expect(detectOptOut(text)).toBeNull();
        }
        expect(detectOptOut('STOP')).toEqual({ scope: 'marketing', keyword: 'stop', rule: 'exact' });
    });
});
