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

/** A line the composer opened with a bullet: "- a photo", "• the postcode", "* how old is it?". */
const RE_BULLET_LINE = /^[ \t]*(?:[-*•·▪–—])[ \t]+(?=\S)/;

/**
 * A bulleted list the desk wrote, turned into the sentence a person would text: the markers go,
 * the items are joined by commas, and the last item ends its sentence when more words follow, so
 * "- the rough size of the cupboard\nCheers" (a capital: a new sentence) never folds into "the cupboard Cheers". Run before a
 * channel folds a paragraph's lines into one, which would otherwise leave "me: - a photo - the
 * size" with a hyphen used as punctuation. A numbered list is left to the renderer.
 */
export function bulletsAsProse(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let prevBullet = false;
    lines.forEach((line, i) => {
        const bullet = RE_BULLET_LINE.test(line);
        if (!bullet) { out.push(line); prevBullet = false; return; }
        let item = line.replace(RE_BULLET_LINE, '').trimEnd();
        if (prevBullet && !/[.,;:!?]$/.test(out[out.length - 1])) out[out.length - 1] += ',';
        const next = lines[i + 1];
        if (next !== undefined && /^\s*[A-Z]/.test(next) && !RE_BULLET_LINE.test(next) && !/[.;:!?]$/.test(item)) item += '.';
        out.push(item);
        prevBullet = true;
    });
    return out.join('\n');
}
