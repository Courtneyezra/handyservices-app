/**
 * The three properties the whole scrub rests on, stated as tests: a synthetic value is
 * deterministic, it is valid where the product parses it, and it is a fixed point of its own
 * generator so a second scrub writes nothing.
 */
import { describe, it, expect } from 'vitest';
import {
    DRAMA_BLOCKS, DRAMA_CAPACITY, OUTWARD_CODES, RESERVED_WORDS, SYNTHETIC_EMAIL_DOMAIN,
    dramaNumberAt, fakeAddress, fakeBusinessName, fakeCoordinate, fakeEmail, fakeExternalId,
    fakeFullName, fakePostcode, fakeToken, fakeTown, fakeUrl, isReservedWord, isSyntheticAddress,
    isSyntheticBusinessName, isSyntheticEmail, isSyntheticExternalId, isSyntheticName,
    isSyntheticPhone, isSyntheticPostcode, isSyntheticToken, isSyntheticTown, isSyntheticUrl,
    nationalDigits, toE164,
} from '../synthetic';

const SEED = 'test-seed';

describe('determinism', () => {
    it('gives the same fake person for the same real one, every time', () => {
        expect(fakeFullName(SEED, 'person', 'margaret wilkinson'))
            .toBe(fakeFullName(SEED, 'person', 'margaret wilkinson'));
        expect(fakeEmail(SEED, 'email', 'a@b.com')).toBe(fakeEmail(SEED, 'email', 'a@b.com'));
        expect(fakePostcode(SEED, 'postcode', 'NG72QX')).toBe(fakePostcode(SEED, 'postcode', 'NG72QX'));
        expect(fakeAddress(SEED, 'address', '14 beechdale road'))
            .toBe(fakeAddress(SEED, 'address', '14 beechdale road'));
    });

    it('gives a different fake person under a different seed', () => {
        expect(fakeFullName('a', 'person', 'x')).not.toBe(fakeFullName('b', 'person', 'x'));
    });

    it('gives a different fake person for a different real one', () => {
        const a = fakeFullName(SEED, 'person', 'margaret wilkinson');
        const b = fakeFullName(SEED, 'person', 'anthony radcliffe');
        expect(a).not.toBe(b);
    });
});

describe('validity', () => {
    it('writes UK mobile numbers the product can parse', () => {
        for (let i = 0; i < 50; i += 1) {
            const n = dramaNumberAt(i);
            expect(n).toMatch(/^0\d{10}$/);
            expect(nationalDigits(n)).toBe(n);
            expect(toE164(n)).toMatch(/^\+44\d{10}$/);
        }
    });

    it('draws every telephone number from an Ofcom drama range', () => {
        for (let i = 0; i < DRAMA_CAPACITY; i += 137) {
            expect(isSyntheticPhone(dramaNumberAt(i))).toBe(true);
        }
    });

    it('never repeats a number within the pools', () => {
        const seen = new Set<string>();
        for (let i = 0; i < DRAMA_CAPACITY; i += 1) seen.add(dramaNumberAt(i));
        expect(seen.size).toBe(DRAMA_CAPACITY);
        expect(DRAMA_CAPACITY).toBe(DRAMA_BLOCKS.reduce((n, b) => n + 10 ** b.tail, 0));
    });

    it('writes Nottingham and Derby postcodes the product can parse', () => {
        const ukPostcode = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;
        for (let i = 0; i < 200; i += 1) {
            const pc = fakePostcode(SEED, 'postcode', `real-${i}`);
            expect(pc).toMatch(ukPostcode);
            expect(OUTWARD_CODES).toContain(pc.split(' ')[0]);
        }
    });

    it('writes e-mail addresses in a domain that cannot receive mail', () => {
        const address = fakeEmail(SEED, 'email', 'someone@real.example');
        expect(address).toMatch(/^[a-z]+\.[a-z]+\d{3}@example\.invalid$/);
        expect(address.endsWith(SYNTHETIC_EMAIL_DOMAIN)).toBe(true);
    });

    it('puts coordinates in the box that covers Nottingham and Derby', () => {
        for (let i = 0; i < 50; i += 1) {
            const { lat, lng } = fakeCoordinate(SEED, 'coord', 'leads', `row-${i}`);
            expect(lat).toBeGreaterThanOrEqual(52.85);
            expect(lat).toBeLessThanOrEqual(53.45);
            expect(lng).toBeGreaterThanOrEqual(-1.65);
            expect(lng).toBeLessThanOrEqual(-1.05);
        }
    });
});

describe('fixed points: running the scrub twice must change nothing', () => {
    it('recognises its own names', () => {
        for (let i = 0; i < 100; i += 1) {
            expect(isSyntheticName(fakeFullName(SEED, 'person', `real-${i}`))).toBe(true);
        }
    });

    it('recognises its own trading names', () => {
        for (let i = 0; i < 50; i += 1) {
            expect(isSyntheticBusinessName(fakeBusinessName(SEED, 'trading', `real-${i}`))).toBe(true);
        }
    });

    it('recognises its own postcodes', () => {
        for (let i = 0; i < 200; i += 1) {
            expect(isSyntheticPostcode(fakePostcode(SEED, 'postcode', `real-${i}`))).toBe(true);
        }
    });

    it('recognises its own towns, addresses, e-mail addresses, URLs and tokens', () => {
        expect(isSyntheticTown(fakeTown(SEED, 'town', 'derby'))).toBe(true);
        expect(isSyntheticAddress(fakeAddress(SEED, 'address', 'somewhere'))).toBe(true);
        expect(isSyntheticEmail(fakeEmail(SEED, 'email', 'a@b.c'))).toBe(true);
        expect(isSyntheticUrl(fakeUrl(SEED, 'jpg', 'calls', 'row', 'media_url'))).toBe(true);
        expect(isSyntheticToken(fakeToken(SEED, 'users', 'row', 'widget_token'))).toBe(true);
        expect(isSyntheticExternalId(fakeExternalId(SEED, 'pi_abc', 'invoices', 'row', 'x'))).toBe(true);
    });

    it('keeps the provider prefix on an external reference, because code branches on it', () => {
        expect(fakeExternalId(SEED, 'pi_live123', 'a', 'b', 'c').startsWith('pi_')).toBe(true);
        expect(fakeExternalId(SEED, 'acct_live123', 'a', 'b', 'c').startsWith('acct_')).toBe(true);
    });
});

describe('a real postcode is never mistaken for a synthetic one', () => {
    // The bug this guards: an earlier version accepted any valid final letter pair, which made
    // NG7 2QX — somebody's house — test as already synthetic, so it survived the scrub.
    it.each(['NG7 2QX', 'NG9 5FN', 'DE22 3HL', 'NG3 6AA', 'NG1 5DT', 'DE24 8AA', 'NG16 2BB'])(
        'rejects %s', (postcode) => {
            expect(isSyntheticPostcode(postcode)).toBe(false);
        },
    );

    it('is insensitive to the space and to case', () => {
        const pc = fakePostcode(SEED, 'postcode', 'x');
        expect(isSyntheticPostcode(pc.replace(' ', ''))).toBe(true);
        expect(isSyntheticPostcode(pc.toLowerCase())).toBe(true);
    });
});

describe('reserved words', () => {
    it('covers every word the generators can write, so the sweep never hunts one', () => {
        expect(isReservedWord(fakeTown(SEED, 'town', 'x'))).toBe(true);
        const name = fakeFullName(SEED, 'person', 'x');
        for (const word of name.split(' ')) expect(isReservedWord(word)).toBe(true);
        expect(RESERVED_WORDS.has('nottingham')).toBe(true);
        expect(RESERVED_WORDS.has('derby')).toBe(true);
    });
});

describe('nationalDigits', () => {
    it.each([
        ['+447812345678', '07812345678'],
        ['00447812345678', '07812345678'],
        ['447812345678', '07812345678'],
        ['07812 345678', '07812345678'],
        ['(0115) 947 2811', '01159472811'],
    ])('reads %s as %s', (input, expected) => {
        expect(nationalDigits(input)).toBe(expected);
    });

    it('returns null for something that is not a UK number', () => {
        expect(nationalDigits('hello')).toBeNull();
        expect(nationalDigits('+1 415 555 0100')).toBeNull();
    });
});
