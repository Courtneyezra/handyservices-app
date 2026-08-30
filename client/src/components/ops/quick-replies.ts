/**
 * Quick-reply parsing for ops agent messages (E-WP2).
 *
 * Convention (frozen, taught to the model by the server prompt): an assistant
 * message MAY end with a fenced code block whose info string is `options`,
 * containing a JSON array of 2–6 short strings:
 *
 *     ```options
 *     ["Craig Smith", "Craig Jones"]
 *     ```
 *
 * When present it is always the LAST thing in the message. Anything that does
 * not exactly match the contract (block not at the end, bad JSON, wrong
 * shapes, too few/many entries) is left in the body untouched — we never
 * silently hide malformed content.
 *
 * Pure module: no React imports, so node test scripts can exercise it.
 */

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;
const MAX_OPTION_LENGTH = 80;

// A trailing ```options fence: opening fence at the start of a line, closing
// fence at the start of a line, nothing but whitespace after it.
const TRAILING_OPTIONS_BLOCK = /(?:^|\n)```options[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(?:\r?\n)*[ \t]*$/;

export function parseQuickReplies(content: string): { body: string; options: string[] } {
    const none = { body: content, options: [] as string[] };

    const match = TRAILING_OPTIONS_BLOCK.exec(content);
    if (!match) return none;

    let parsed: unknown;
    try {
        parsed = JSON.parse(match[1]);
    } catch {
        return none;
    }

    if (!Array.isArray(parsed)) return none;
    if (parsed.length < MIN_OPTIONS || parsed.length > MAX_OPTIONS) return none;
    if (!parsed.every(
        (o): o is string => typeof o === 'string' && o.trim().length > 0 && o.length <= MAX_OPTION_LENGTH,
    )) return none;

    return {
        body: content.slice(0, match.index).trim(),
        options: parsed,
    };
}
