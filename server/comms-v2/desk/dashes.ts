/**
 * No dash used as punctuation in anything the desk writes to a customer. The house rule
 * (brand-voice/whatsapp-comms.md): "NO em dashes, and no hyphens used as punctuation. Use a comma,
 * a full stop, or a new message." The composer is told so, and this rewrites whatever still carries
 * one, because a model told once still writes "NG3 3EG - got that".
 *
 * A spaced hyphen, an em dash or an en dash between two words becomes a comma; one that follows
 * punctuation already there is dropped, as is one that ends a line. A hyphenated word
 * ("follow-up"), a range between digits ("9–5" becomes "9-5") and a hyphen opening a line are
 * not punctuation and stay.
 *
 * Only words the desk wrote pass through here: a person's own words on Ben's board are sent as
 * typed (`render`'s `asTyped`).
 */

/** A spaced hyphen (or two), or any em or en dash, with the spaces either side of it. */
const RE_DASH = /[ \t]+-{1,2}(?=[ \t]|$)[ \t]*|[ \t]*[–—]+[ \t]*/g;

function lineWithoutDashes(line: string): string {
    return line.replace(/(\d)–(?=\d)/g, '$1-').replace(RE_DASH, (dash, offset: number, whole: string) => {
        const before = whole.slice(0, offset);
        const after = whole.slice(offset + dash.length);
        if (!before.trim()) return /[–—]/.test(dash) ? '' : dash;
        if (!after.trim()) return '';
        if (/[.,;:!?]$/.test(before) || /^[.,;:!?)]/.test(after)) return /^[.,;:!?)]/.test(after) ? '' : ' ';
        return ', ';
    });
}

/** The text with every dash used as punctuation rewritten as a comma. */
export function withoutDashPunctuation(text: string): string {
    return text.split('\n').map(lineWithoutDashes).join('\n');
}

/** True when the text carries a dash used as punctuation. */
export function hasDashPunctuation(text: string): boolean {
    return withoutDashPunctuation(text) !== text;
}
