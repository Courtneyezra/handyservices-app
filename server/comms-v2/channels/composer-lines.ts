/**
 * The one thing the composer is told about the channel: how long and in what form the reply will
 * travel. It writes one reply for every channel; the sender renders it (Contract 5). SMS and
 * email differ enough in shape (one short message; a letter body) that the composer must know,
 * or the SMS render returns every reply to shorten and the email reads as bubbles.
 *
 * `sendOn` is for a caller that has already resolved the channel its send goes out on and may have
 * resolved a different one from `choose_channel`: the quote delivery does. Told nothing, the lines
 * are worked out the way the reply path does it. Such a caller is not writing the turn's reply
 * either, so the first-contact line below is left to it: the quote delivery puts that
 * acknowledgement in the send itself rather than asking the composer to fit it in beside the link
 * (`server/comms-v2/quoting/quoting-door.ts`).
 *
 * `reserved` is how many characters such a caller is putting in the send ahead of the reply. The
 * budget the composer is told is what is left after them, because a reply written to the whole
 * channel budget and then added to is one the render refuses, which holds the very send those
 * reserved words were there to carry.
 */
import type { CaseFile, Party, ReplyChannel, Turn } from '../desk/case-file';
import { chooseChannel } from '../desk/sender';

/**
 * Whether the send being written is still the first contact a web-form enquiry is owed: they wrote
 * on the form and nothing has gone back to them yet. Their acknowledgement can hold for Ben rather
 * than go (a shut window with no approved template), and then the quote delivery is the first
 * message they ever receive from us, so it is the one that must name what they asked about. One
 * definition: the reply path's line below asks the composer for it, and the quote delivery writes
 * it itself (`server/comms-v2/quoting/quoting-door.ts`). The acknowledgement's hold is not cleared
 * by that delivery: the card stands until Ben answers it.
 */
export function acknowledgesEnquiry(file: CaseFile, turn: Turn): boolean {
    return turn.kind === 'form' && !file.turns.some((t) => t.direction === 'outbound');
}

/** The characters a reply going by SMS is told it may use, before anything the caller has reserved. */
export const SMS_REPLY_BUDGET = 300;

export function composerChannelLines(file: CaseFile, party: Party, turn: Turn, now: Date = new Date(), sendOn?: ReplyChannel, reserved = 0): string[] {
    const choice = sendOn ? { ok: true as const, channel: sendOn } : chooseChannel(party, turn.channel, now);
    const channel = choice.ok ? choice.channel : 'whatsapp';
    const lines: string[] = [];
    if (channel === 'sms') lines.push(`This reply goes by SMS, not WhatsApp: one short text message, under ${SMS_REPLY_BUDGET - reserved} characters in total, no blank lines and no bubbles. Say the one thing that matters and ask the one question.`);
    else if (channel === 'email') lines.push('This reply goes by email: write the body only, in short paragraphs separated by a blank line, in a plain friendly register. No greeting line and no sign-off; the sender adds those.');
    if (reserved > 0) {
        lines.push('A line the desk writes goes ahead of your words in this send: do not introduce us and do not repeat that line.');
        if (channel === 'sms') lines.push('The characters named above are what is left of that one text for you, after that line.');
    }
    if (!sendOn && acknowledgesEnquiry(file, turn)) lines.push('They wrote on the web form, not WhatsApp, so this is the first message they receive from us: quote their enquiry back in your own words before anything else, in one line and with no figure.');
    return lines;
}
