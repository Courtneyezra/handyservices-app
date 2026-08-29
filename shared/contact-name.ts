/**
 * The placeholder-name gate.
 *
 * conversations.contact_name is seeded from the WhatsApp pushname (the Meta webhook's
 * ProfileName, falling back to the bare number — server/conversation-engine.ts), and a pushname
 * is whatever the customer once typed into their own phone: "Just Me", an emoji, their company
 * name in caps, a bare number. Real threads leaked these into quotes and customer greetings
 * ("Hi Just Me"), so anything that would use the stored name AS a name must pass this gate first.
 *
 * The gate is deliberately strict. Rejecting a real-but-odd pushname costs one polite "who am I
 * speaking with?" in chat; accepting a junk one prints it on a quote. False negatives are cheap,
 * false positives are not.
 */

/** Lowercased, punctuation-stripped pushnames that are self-descriptions, not names. */
const GENERIC_PLACEHOLDERS = new Set([
    'me', 'just me', 'its me', 'only me', 'myself', 'you', 'user', 'whatsapp user', 'whatsapp',
    'unknown', 'no name', 'noname', 'none', 'n a', 'na', 'nil', 'null', 'test', 'testing',
    'customer', 'new customer', 'client', 'guest', 'admin', 'owner', 'person',
    'iphone', 'android', 'samsung', 'galaxy', 'pixel', 'nokia', 'huawei',
    'phone', 'my phone', 'mobile', 'cell', 'main', 'personal', 'private', 'home', 'work',
    'mum', 'mom', 'mummy', 'dad', 'daddy', 'nan', 'gran', 'grandad',
    'wife', 'hubby', 'husband', 'partner', 'babe', 'bae', 'love', 'boss',
    'website', 'website visitor', 'web visitor', 'visitor', 'lead', 'enquiry', 'caller',
]);

/**
 * Words that mark a BUSINESS name rather than a person, wherever they appear. A business texting
 * us is a fine customer, but "Hi Peninsular Property" is not how a person is greeted — the agent
 * asks who it is speaking with instead.
 */
const BUSINESS_TOKEN_RE = new RegExp(
    '\\b(ltd|limited|llp|plc|inc|co|uk|group|services?|solutions?|systems?|'
    + 'property|properties|lettings?|estates?|realty|homes?|housing|rentals?|'
    + 'maintenance|builders?|building|construction|contractors?|developments?|'
    + 'plumbing|electrical|electricians?|roofing|heating|cleaning|landscaping|'
    + 'handyman|management|agency|agents?|investments?|holdings?|enterprises?)\\b',
    'i',
);

/**
 * Does this string look like a real person's name — something we could put on a quote or open a
 * message with? False for null/empty, phone numbers and anything digit-bearing, emoji or symbol
 * strings, single letters, known generic placeholders ("Just Me", "iPhone"), business-looking
 * names, and shouty multi-word ALL-CAPS strings.
 */
export function isLikelyRealName(raw: string | null | undefined): boolean {
    if (!raw) return false;
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60) return false;

    // Any digit disqualifies: bare numbers, "+44 7700 900123", "Dave 2", "Flat 3".
    if (/\d/.test(name)) return false;

    // Emoji and pictographic symbols anywhere — "🌸", "Sarah 🌸". If a name is in there, the
    // polite ask recovers it clean; the raw string must not be echoed back.
    if (/\p{Extended_Pictographic}|\uFE0F/u.test(name)) return false;

    // Letters (any script), spaces and name punctuation only. Starts with a letter, so "@dave",
    // ".", "---" and handle-like strings all fail.
    if (!/^\p{L}[\p{L}\s.'’-]*$/u.test(name)) return false;

    // At least two actual letters — "J", "A." are initials, not a name we can use.
    const letters = name.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) return false;

    const words = name.split(' ');
    // A personal name is 1-4 words; longer is a strapline or a sentence.
    if (words.length > 4) return false;

    // Known self-descriptions, compared with punctuation flattened out ("it's me" → "its me").
    const flattened = name.toLowerCase().replace(/[.'’-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (GENERIC_PLACEHOLDERS.has(flattened)) return false;

    // Business vocabulary anywhere in the string.
    if (BUSINESS_TOKEN_RE.test(name)) return false;

    // ALL-CAPS reads as a business or a shout: reject multi-word caps ("ELITE SPRAY TECH",
    // "JOHN SMITH" — greeting either verbatim is wrong) and long single-word caps. A short
    // caps-lock first name ("DAVE") is let through.
    const isAllCaps = name === name.toUpperCase() && name !== name.toLowerCase();
    if (isAllCaps && (words.length > 1 || name.length > 9)) return false;

    return true;
}

/** The gate as a mapper: the tidied name when it passes, null when it does not. */
export function realNameOrNull(raw: string | null | undefined): string | null {
    return isLikelyRealName(raw) ? (raw as string).replace(/\s+/g, ' ').trim() : null;
}
