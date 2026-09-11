/**
 * Turning one real value into its synthetic replacement.
 *
 * Two keying strategies live here and the difference between them is the whole design:
 *
 *   keyed on the value  names, telephone numbers, e-mail addresses, addresses, postcodes. The
 *                       same real customer therefore becomes the same fake customer in `leads`,
 *                       in `conversations`, in `calls` and in `invoices`, so a reader can still
 *                       follow one thread across the database.
 *   keyed on the row    free text: message bodies, job descriptions, notes, transcripts. Keying
 *                       on (table, primary key, column) rather than on the text being replaced is
 *                       what makes the scrub idempotent — a second run regenerates the identical
 *                       string and writes nothing.
 *
 * Every function returns the value unchanged when it is already synthetic, which is the same
 * property stated from the other side.
 */
import type { Treatment } from './plan';
import type { Substitutions } from './detect';
import { fakeProse, fakePreview, isSyntheticProse, type ProseKind } from './prose';
import {
    fakeAddressLine1, fakeBusinessName, fakeCoordinate, fakeEmail, fakeExternalId, fakeFirstName,
    fakeFullName, fakeLastName, fakePostcode, fakeToken, fakeTown, fakeUrl, isSyntheticAddress,
    isSyntheticBusinessName, isSyntheticEmail, isSyntheticExternalId, isSyntheticName,
    isSyntheticPhone, isSyntheticPostcode, isSyntheticToken, isSyntheticTown, isSyntheticUrl,
    nationalDigits, toE164,
} from './synthetic';

/**
 * A bcrypt hash of a long random string that was generated once and thrown away. Every scrubbed
 * account therefore has a well-formed hash that `bcrypt.compare` can run against and that nobody,
 * including whoever wrote this file, can satisfy.
 */
export const UNUSABLE_PASSWORD_HASH = '$2b$10$DOsgEcxhVBtlsnisgLkYy.5K/Mrklz2WO1G0yybGQy1pZgZQXvieS';

/** What the express-session row is reduced to: a valid, empty, expired-looking session. */
export const EMPTY_SESSION = { cookie: { originalMaxAge: 86400000, httpOnly: true, path: '/', secure: false } };

export interface ValueContext {
    seed: string;
    table: string;
    column: string;
    /** Stable identity of the row: its primary key rendered as text. */
    rowKey: string;
    /** Allocated synthetic telephone numbers, by national form of the real number. */
    phoneFor(real: string): string | null;
    /** Known real strings and their replacements, for free text and json leaves. */
    subs: Substitutions;
    /** The row's own synthetic customer name and town, when it has one, so prose reads as a thread. */
    rowName?: string | null;
    rowTown?: string | null;
    /**
     * Rewrite unconditionally, ignoring the "this is already synthetic" checks.
     *
     * Those checks are how the scrub stays idempotent, but several of them are memberships of a
     * pool rather than proofs: a real customer called Ada Beeston, or a real house in Nottingham,
     * would test as synthetic and survive. So the first scrub of a database rewrites everything
     * and only later runs trust the checks. scrub.ts decides which this is by looking for the
     * marker the previous run left behind.
     */
    force?: boolean;
}

const PROSE_KIND: Partial<Record<Treatment, ProseKind>> = {
    message_body: 'message',
    narrative: 'narrative',
    note: 'note',
    transcript: 'transcript',
};

/** Extract the first postcode written inside a longer string, normalised. */
function postcodeIn(text: string): string | null {
    const m = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.exec(text);
    return m ? m[0].replace(/\s+/g, '').toUpperCase() : null;
}

/** A file extension worth keeping, because code branches on it. */
function extensionOf(url: string): string {
    const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url);
    return m ? m[1].toLowerCase() : 'jpg';
}

/** Does this value look like an identifier rather than a person's name? */
function looksLikeIdentifier(value: string): boolean {
    const t = value.trim();
    if (!t) return true;
    if (/^(human|system|agent|bot|rules|auto):/i.test(t)) return true;
    if (/^[0-9a-f-]{16,}$/i.test(t)) return true;             // uuid or hex id
    if (/^[A-Za-z0-9_-]{12,}$/.test(t) && !/\s/.test(t)) return true; // nanoid-style id
    if (!/\s/.test(t) && t === t.toLowerCase()) return true;  // a lower-case slug or enum word
    return false;
}

/**
 * The replacement for one scalar value, or the value itself when nothing needs doing. `null` in,
 * `null` out: the scrub never invents a value where the database held none, so row shape is kept.
 */
export function scrubScalar(treatment: Treatment, value: string | null, ctx: ValueContext): string | null {
    if (value === null || value === undefined) return value;
    const raw = String(value);
    if (!raw.trim()) return value;
    const { seed } = ctx;
    const settled = (already: boolean) => !ctx.force && already;
    const rowParts = [ctx.table, ctx.rowKey, ctx.column];

    switch (treatment) {
        case 'person_name':
            return settled(isSyntheticName(raw)) ? raw : fakeFullName(seed, 'person', raw.trim().toLowerCase());
        case 'first_name':
            return settled(isSyntheticName(raw)) ? raw : fakeFirstName(seed, 'person', raw.trim().toLowerCase());
        case 'last_name':
            return settled(isSyntheticName(raw)) ? raw : fakeLastName(seed, 'person', raw.trim().toLowerCase());
        case 'business_name':
            return settled(isSyntheticBusinessName(raw)) ? raw : fakeBusinessName(seed, 'trading', raw.trim().toLowerCase());

        case 'phone':
        case 'phone_e164': {
            if (isSyntheticPhone(raw)) return raw;
            const national = nationalDigits(raw);
            if (!national) return raw;
            const fake = ctx.phoneFor(national);
            if (!fake) return raw;
            // Keep the form the column already used, because parsers downstream depend on it.
            if (treatment === 'phone_e164' || raw.trim().startsWith('+')) return toE164(fake);
            return fake;
        }
        case 'phone_key': {
            // server/clients.ts keys threads as `phone:<national>`; keep the prefix, swap the number.
            const m = /^([a-z]+:)?([\s\S]*)$/.exec(raw.trim());
            const prefix = m?.[1] ?? '';
            const rest = m?.[2] ?? raw.trim();
            if (isSyntheticPhone(rest)) return raw;
            const national = nationalDigits(rest);
            if (!national) return raw;
            const fake = ctx.phoneFor(national);
            return fake ? `${prefix}${fake}` : raw;
        }

        case 'email':
            return settled(isSyntheticEmail(raw)) ? raw : fakeEmail(seed, 'email', raw.trim().toLowerCase());

        case 'postcode':
            return settled(isSyntheticPostcode(raw)) ? raw : fakePostcode(seed, 'postcode', raw.replace(/\s+/g, '').toUpperCase());
        case 'town':
            return settled(isSyntheticTown(raw)) ? raw : fakeTown(seed, 'town', raw.trim().toLowerCase());
        case 'address': {
            if (settled(isSyntheticAddress(raw))) return raw;
            const key = raw.trim().toLowerCase();
            const pc = postcodeIn(raw);
            // When the real address carried a postcode, key the fake postcode on it so this
            // address and the row's own postcode column end up agreeing.
            const postcode = pc ? fakePostcode(seed, 'postcode', pc) : fakePostcode(seed, 'address', key);
            const town = pc ? fakeTown(seed, 'town-of', pc) : fakeTown(seed, 'address', key);
            return `${fakeAddressLine1(seed, 'address', key)}, ${town}, ${postcode}`;
        }
        case 'address_line':
            return settled(isSyntheticAddress(raw)) ? raw : fakeAddressLine1(seed, 'address', raw.trim().toLowerCase());

        case 'latitude':
            return String(fakeCoordinate(seed, 'coord', ctx.table, ctx.rowKey).lat);
        case 'longitude':
            return String(fakeCoordinate(seed, 'coord', ctx.table, ctx.rowKey).lng);

        case 'url':
            return settled(isSyntheticUrl(raw)) ? raw : fakeUrl(seed, extensionOf(raw), ...rowParts, raw.length.toString());
        case 'data_url':
            // A signature or photo pasted inline. Keep it a data: URL so renderers still cope.
            return raw.startsWith('data:image/png;base64,AAAA') ? raw : 'data:image/png;base64,AAAA';

        case 'token':
            return settled(isSyntheticToken(raw)) ? raw : fakeToken(seed, ...rowParts);
        case 'password':
            return UNUSABLE_PASSWORD_HASH;
        case 'external_id':
            return settled(isSyntheticExternalId(raw)) ? raw : fakeExternalId(seed, raw, ...rowParts);

        case 'message_body':
        case 'narrative':
        case 'note':
        case 'transcript':
            if (settled(isSyntheticProse(raw))) return raw;
            return fakeProse(seed, PROSE_KIND[treatment]!, rowParts, {
                name: ctx.rowName, town: ctx.rowTown, targetLength: raw.length,
            });
        case 'preview':
            if (settled(isSyntheticProse(raw))) return raw;
            return fakePreview(seed, rowParts, { name: ctx.rowName, town: ctx.rowTown });

        case 'actor':
            // A user id or a `human:<id>` handle stays; a name typed into the same column goes.
            if (looksLikeIdentifier(raw)) return ctx.subs.apply(raw);
            return settled(isSyntheticName(raw)) ? raw : fakeFullName(seed, 'person', raw.trim().toLowerCase());

        case 'keep':
            return ctx.subs.apply(raw);

        default:
            return raw;
    }
}
