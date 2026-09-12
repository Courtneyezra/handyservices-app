/**
 * The one thing the composer is told about the channel: how long and in what form the reply will
 * travel. It writes one reply for every channel; the sender renders it (Contract 5). SMS and
 * email differ enough in shape (one short message; a letter body) that the composer must know,
 * or the SMS render returns every reply to shorten and the email reads as bubbles.
 */
import type { Party, Turn } from '../desk/case-file';
import { chooseChannel } from '../desk/sender';

export function composerChannelLines(party: Party, turn: Turn, now: Date = new Date()): string[] {
    const choice = chooseChannel(party, turn.channel, now);
    const channel = choice.ok ? choice.channel : 'whatsapp';
    const lines: string[] = [];
    if (channel === 'sms') lines.push('This reply goes by SMS, not WhatsApp: one short text message, under 300 characters in total, no blank lines and no bubbles. Say the one thing that matters and ask the one question.');
    else if (channel === 'email') lines.push('This reply goes by email: write the body only, in short paragraphs separated by a blank line, in a plain friendly register. No greeting line and no sign-off; the sender adds those.');
    if (turn.kind === 'form') lines.push('They wrote on the web form, not WhatsApp, so this is the first message they receive from us: quote their enquiry back in your own words before anything else.');
    return lines;
}
