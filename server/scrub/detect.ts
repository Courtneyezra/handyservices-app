/**
 * Finding identifying data that a column name did not advertise.
 *
 * Two jobs, both count-only — nothing in this file ever returns or logs a value it read:
 *
 *   before the scrub  collect the real identifiers out of the columns the plan classified, so the
 *                     sweep afterwards knows exactly which literal strings to hunt for in free
 *                     text nobody classified.
 *   after the scrub   check that no value anywhere still looks like a real person's telephone
 *                     number, e-mail address or postcode. This check needs no prior knowledge,
 *                     which is what makes it usable as a standing audit (`--verify`) on a
 *                     database that was scrubbed months ago.
 */
import {
    isReservedWord, isSyntheticEmail, isSyntheticPhone, isSyntheticPostcode, nationalDigits,
} from './synthetic';

/** A UK number as people actually type it: +44…, 0044…, 07…, with spaces, dashes or brackets. */
export const PHONE_RE = /(?:\+44|0044|\b0)\s?(?:\d[\s().-]?){9,12}/g;

export const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Full UK postcode. Deliberately strict: an outward code alone is not identifying. */
export const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi;

export type IdentifierKind = 'phone' | 'email' | 'postcode';

export interface Residual {
    kind: IdentifierKind;
    /** How many occurrences, never what they were. */
    count: number;
}

/**
 * Occurrences in `text` that still look real. A match inside a reserved range counts as clean, so
 * a scrubbed database reports nothing and a half-scrubbed one reports exactly what is left.
 */
export function residualsIn(text: string): Residual[] {
    const out: Residual[] = [];
    const phones = [...text.matchAll(PHONE_RE)].filter((m) => {
        const n = nationalDigits(m[0]);
        return !!n && n.length >= 10 && n.length <= 13 && !isSyntheticPhone(m[0]);
    });
    if (phones.length) out.push({ kind: 'phone', count: phones.length });

    const emails = [...text.matchAll(EMAIL_RE)].filter((m) => !isSyntheticEmail(m[0]));
    if (emails.length) out.push({ kind: 'email', count: emails.length });

    const postcodes = [...text.matchAll(POSTCODE_RE)].filter((m) => !isSyntheticPostcode(m[0]));
    if (postcodes.length) out.push({ kind: 'postcode', count: postcodes.length });

    return out;
}

/**
 * A name is only worth hunting for as a literal string when it is distinctive enough that a
 * word-boundary match cannot land on ordinary prose. "Wilkinson" qualifies; "Grant", "Mark" and
 * "Bill" do not, and are reported as unswept rather than substituted blindly.
 */
const COMMON_WORDS = new Set([
    'bill', 'mark', 'grant', 'rose', 'may', 'june', 'july', 'august', 'summer', 'hope', 'joy',
    'frank', 'rich', 'sunny', 'dawn', 'faith', 'art', 'chase', 'drew', 'jack', 'will', 'dean',
    'field', 'ford', 'green', 'brown', 'white', 'black', 'young', 'hall', 'wood', 'king', 'price',
    'stone', 'cook', 'baker', 'fisher', 'gardener', 'butler', 'carter', 'porter', 'taylor', 'ben',
    'home', 'house', 'north', 'south', 'east', 'west', 'lane', 'park', 'hill', 'gate', 'bridge',
]);

export function isSweepableName(token: string): boolean {
    const t = token.trim();
    if (t.length < 4) return false;
    if (!/^[A-Za-zÀ-ÿ'’-]+$/.test(t)) return false;
    return !COMMON_WORDS.has(t.toLowerCase());
}

/**
 * The literal strings the sweep looks for, built from the values the scrub read out of the
 * classified columns before it rewrote them. Keys are the real strings; values are what to put
 * in their place. Held in memory for the length of one run and never written anywhere.
 */
export class Substitutions {
    private readonly map = new Map<string, string>();
    /** Real tokens that were deliberately not swept because a match would be ambiguous. */
    readonly skipped = new Set<string>();

    /**
     * Add one real value and the synthetic value that replaced it, unless the real value is a
     * word the generators themselves write. Sweeping such a term would rewrite invented text and
     * counting it would report a leak that is not there, so it is recorded as unswept.
     */
    add(real: string | null | undefined, synthetic: string): void {
        const t = (real ?? '').trim();
        if (!t || t === synthetic) return;
        if (isReservedWord(t)) { this.skipped.add(t); return; }
        this.map.set(t, synthetic);
    }

    /**
     * Add a person's name plus each of its words, so "Jean Wilkinson" is caught whether the free
     * text says the whole name or just the surname. Ambiguous single words are skipped.
     */
    addName(real: string | null | undefined, synthetic: string): void {
        const t = (real ?? '').trim();
        if (!t) return;
        const realWords = t.split(/\s+/).filter(Boolean);
        const fakeWords = synthetic.split(/\s+/).filter(Boolean);
        // A one-word name gets the same ambiguity test as any other single word: sweeping "Ben"
        // as a bare term would rewrite it inside words that have nothing to do with a person.
        if (realWords.length < 2) {
            if (isSweepableName(t) && !isReservedWord(t)) this.map.set(t, synthetic);
            else this.skipped.add(t);
            return;
        }
        this.add(t, synthetic);
        realWords.forEach((w, i) => {
            if (isSweepableName(w) && !isReservedWord(w)) this.map.set(w, fakeWords[Math.min(i, fakeWords.length - 1)]);
            else this.skipped.add(w);
        });
    }

    /** Add a telephone number in every written form the database is likely to hold it in. */
    addPhone(real: string | null | undefined, syntheticNational: string): void {
        const national = nationalDigits(real ?? '');
        if (!national) return;
        const e164 = '+44' + national.slice(1);
        const syntheticE164 = '+44' + syntheticNational.slice(1);
        this.add(national, syntheticNational);
        this.add(e164, syntheticE164);
        this.add('0044' + national.slice(1), '0044' + syntheticNational.slice(1));
        this.add('44' + national.slice(1), '44' + syntheticNational.slice(1));
        // The spaced form people type, e.g. 07123 456789.
        if (national.length === 11) {
            this.add(`${national.slice(0, 5)} ${national.slice(5)}`,
                `${syntheticNational.slice(0, 5)} ${syntheticNational.slice(5)}`);
        }
    }

    get size(): number { return this.map.size; }

    /**
     * Longest first, so "Jean Wilkinson" is replaced before "Jean" can half-match it. Each term
     * also carries whether it must match on a word boundary: a name has to, because "Ben" is a
     * substring of ordinary words, while a telephone number, e-mail address, postcode or street
     * address carries digits or punctuation and is unambiguous as a plain substring.
     */
    private ordered(): { real: string; fake: string; wordy: boolean }[] {
        return [...this.map.entries()]
            .sort((a, b) => b[0].length - a[0].length)
            .map(([real, fake]) => ({ real, fake, wordy: /^[A-Za-zÀ-ÿ'’ -]+$/.test(real) }));
    }

    private cachedOrder: { real: string; fake: string; wordy: boolean }[] | null = null;

    private get terms() {
        this.cachedOrder ??= this.ordered();
        return this.cachedOrder;
    }

    /** Replace every known real string in `text`. Returns the text unchanged when none appear. */
    apply(text: string): string {
        if (!this.map.size) return text;
        let out = text;
        for (const { real, fake, wordy } of this.terms) {
            if (!out.includes(real)) continue;
            out = wordy ? out.replace(boundaryRe(real), fake) : out.split(real).join(fake);
        }
        return out;
    }

    /** How many known real strings appear in `text`. Used for the post-scrub proof, counts only. */
    countIn(text: string): number {
        if (!this.map.size) return 0;
        let n = 0;
        for (const { real, wordy } of this.terms) {
            if (wordy) {
                n += (text.match(boundaryRe(real)) ?? []).length;
                continue;
            }
            let from = 0;
            for (;;) {
                const at = text.indexOf(real, from);
                if (at < 0) break;
                n += 1;
                from = at + real.length;
            }
        }
        return n;
    }
}

function escapeRe(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `\b` is wrong at a non-word edge, so bound on "not a letter" instead. */
function boundaryRe(term: string): RegExp {
    return new RegExp(`(?<![A-Za-zÀ-ÿ])${escapeRe(term)}(?![A-Za-zÀ-ÿ])`, 'g');
}
