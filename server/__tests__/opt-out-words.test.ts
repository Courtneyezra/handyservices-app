/**
 * The words that count as an opt-out are pinned (17 Sep 2026, "Keep today's words"): the old desk
 * (server/opt-out.ts) and the new one (server/comms-v2/desk/desk.ts) read the same detector, and a
 * fix that silences an opt-out on the new desk must not widen or narrow what counts as one.
 */
import { describe, expect, it, vi } from 'vitest';
import { OPT_OUT_SCOPES, detectOptOut } from '../opt-out-detect';
import { EXACT_WORDS, NEAR_MISSES, PHRASES } from './opt-out-words';

vi.mock('../db', () => ({ db: {} }));

describe('opt-out words', () => {
    it('every whole-message word is today\'s opt-out, in its scope', () => {
        for (const scope of OPT_OUT_SCOPES) for (const word of EXACT_WORDS[scope]) {
            expect(detectOptOut(word), word).toEqual({ scope, keyword: word, rule: 'exact' });
            expect(detectOptOut(`Please ${word.toUpperCase()}, thanks`), word).toEqual({ scope, keyword: word, rule: 'exact' });
        }
    });

    it('every phrase is today\'s opt-out inside a short message, in its scope', () => {
        for (const scope of OPT_OUT_SCOPES) for (const phrase of PHRASES[scope]) {
            const match = detectOptOut(`Could you ${phrase} from now on`);
            expect(match, phrase).toMatchObject({ scope, rule: 'phrase' });
            expect(phrase, phrase).toContain(match!.keyword);
        }
    });

    it('a phrase inside a long message is not an opt-out', () => {
        const long = 'The boiler in the loft has been making a knocking noise all week and I would like someone to look at it, but please stop messaging me at work';
        expect(detectOptOut(long)).toBeNull();
    });

    it('the deliberate misses still miss', () => {
        for (const text of NEAR_MISSES) expect(detectOptOut(text), text).toBeNull();
        expect(detectOptOut('STOP')).toEqual({ scope: 'marketing', keyword: 'stop', rule: 'exact' });
    });

    it('server/opt-out.ts hands out the same detector', async () => {
        const ledger = await import('../opt-out');
        expect(ledger.detectOptOut).toBe(detectOptOut);
        expect(ledger.OPT_OUT_SCOPES).toBe(OPT_OUT_SCOPES);
    });
});
