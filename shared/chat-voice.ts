/**
 * The chat-voice hard rules, in code.
 *
 * `brand-voice/whatsapp-comms.md` is loaded verbatim into the comms agent's standing orders, so
 * anything a MODEL writes is governed by it. Nothing governed our own generated copy — and the
 * corpus measurement (docs/WHATSAPP-CONVERSATION-ANALYSIS.md, 10 weeks of Ben's real 1:1 chat)
 * found the gap is not small:
 *
 *   · Ben typed an em dash in 3 of 1,532 hand-typed customer messages (0%).
 *   · Our auto-composed templates carried one in 195 of 350 sends (56%).
 *   · "Just let me know when suits and we'll get it done" went out 64 times, against a rule the
 *     file states explicitly ("Never 'let me know when suits' — that's scheduling ping-pong and
 *     it's banned").
 *
 * A prompt instruction alone did not hold, because most of those dashes were never written by a
 * model: they were in our own style copy, in the approved-claims list, and in an approved Meta
 * template body. So the rules live here as functions, and the composers run them on the way out.
 * Prompts still carry the rule (a model that never writes one needs no scrubbing), but the guard
 * is what makes it true.
 *
 * Shared, not server-only: the admin "Send WhatsApp" buttons compose their message in the browser.
 *
 * NOT in scope: Ben's own conventions. The same analysis found the brand-voice file wrong to ban
 * his "Thanks / Ben" sign-off (34% of his messages) and his emoji (20%). Reconciling that is a
 * separate change, and nothing here touches sign-offs or emoji.
 */

/** Dash characters that must never reach a customer chat. Hyphens are handled separately. */
const DASHES = /[—–]/;

/**
 * Rewrite dashes for 1:1 chat.
 *
 * Three passes, and the order matters:
 *   1. NUMERIC RANGES FIRST. "£80–£100" is a range, not punctuation, and blindly stripping it
 *      gives "£80, £100" — which reads as two prices. It becomes "£80 to £100".
 *   2. Em/en dashes used as punctuation become a comma.
 *   3. A spaced hyphen (" - ") is the same offence typed differently.
 *
 * URLs survive: their hyphens have no surrounding spaces, and dashes do not appear in ours.
 * Unspaced hyphens in words and durations ("48-72 hours", "pre-approved") are left alone — the
 * rule is about punctuation, not about the character.
 *
 * Idempotent: running it twice changes nothing, so a composer and its caller may both call it.
 */
export function stripChatDashes(text: string): string {
    if (!text) return text;
    return text
        // 1. Ranges → "to". Money first (the £ sign may sit on either or both sides).
        .replace(/(£\d[\d,]*(?:\.\d+)?)\s*[—–]\s*(£?\d[\d,]*(?:\.\d+)?)/g, '$1 to $2')
        .replace(/(\d)\s*[—–]\s*(\d)/g, '$1 to $2')
        // 2. Punctuation dashes → comma.
        .replace(/\s*[—–]\s*/g, ', ')
        // 3. The spaced hyphen, same offence.
        .replace(/\s+-\s+/g, ', ')
        // Tidy what the substitutions can leave behind: a doubled comma, a comma against
        // punctuation that already closed the clause, and a line that now opens with one.
        .replace(/,\s*,/g, ',')
        .replace(/([,;:.!?])\s*,\s*/g, '$1 ')
        .replace(/^[ \t]*,\s*/gm, '')
        .replace(/[ \t]+$/gm, '');
}

/**
 * Closers that hand scheduling back to the customer.
 *
 * Banned because booking is self-serve in the quote link: every one of these invites a WhatsApp
 * back-and-forth instead of a tap, and the customer who has to compose a reply is the customer who
 * puts their phone down. "Just tap the link when you're ready" is fine and deliberately not
 * matched here — the ban is on asking THEM to propose a time, not on the words "when you're ready".
 */
export const BANNED_CHAT_CLOSERS: Array<{ name: string; re: RegExp }> = [
    { name: 'let_me_know_when_suits', re: /\blet (me|us) know\b[^.!?]{0,20}\b(when|what|which)\b[^.!?]{0,20}\b(suits?|works?|is good|is best|you'?re free)\b/i },
    { name: 'let_me_know_a_time', re: /\blet (me|us) know\b[^.!?]{0,15}\b(a|the|your)\b[^.!?]{0,10}\b(time|day|date|slot)\b/i },
    { name: 'ready_when_you_are', re: /\bready when you(?: are|'?re ready)\b/i },
    { name: 'shout_when_ready', re: /\b(shout|give (me|us) a (shout|bell|buzz))\b[^.!?]{0,25}\b(ready|to book|when you)\b/i },
    { name: 'whenever_suits', re: /\b(whenever|whatever|any time that) suits (you|yourself)\b/i },
    { name: 'when_suits_you', re: /\bwhen (it )?suits you\b/i },
];

/** The first banned closer in the text, or null. Used to reject copy, not to rewrite it. */
export function findBannedCloser(text: string): string | null {
    if (!text) return null;
    for (const { name, re } of BANNED_CHAT_CLOSERS) {
        if (re.test(text)) return name;
    }
    return null;
}

/**
 * Every chat-voice violation in a piece of copy, machine-readable.
 *
 * For guarding copy we did not write and cannot rewrite — an approved Meta template body, most of
 * all. A template is Meta's wording once approved, so the only lever we have is to decline to send
 * it and fall back to something we composed ourselves.
 */
export function chatVoiceViolations(text: string): string[] {
    const issues: string[] = [];
    if (!text) return issues;
    // A dash between two digits is a range, not punctuation, so it is not a violation.
    const punctuationDash = text.replace(/(\d)\s*[—–]\s*(\d)/g, '$1$2');
    if (DASHES.test(punctuationDash)) issues.push('em_dash');
    if (/\s+-\s+/.test(text)) issues.push('spaced_hyphen');
    const closer = findBannedCloser(text);
    if (closer) issues.push(`banned_closer:${closer}`);
    return issues;
}

/** True when this copy is safe to put in a customer chat as written. */
export function isChatSafe(text: string): boolean {
    return chatVoiceViolations(text).length === 0;
}

/**
 * The last gate before a composed message goes to a customer. Rewrites what can be rewritten
 * (dashes); a banned closer is a copy decision, not a substitution, so callers check for it with
 * `findBannedCloser` and choose a replacement line instead of having one guessed for them.
 */
export function toChatVoice(text: string): string {
    return stripChatDashes(text);
}
