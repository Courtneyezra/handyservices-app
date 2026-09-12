/**
 * The fixed lines a channel adds to a reply. One so far: a reply on SMS to a party who does not
 * write on WhatsApp carries the invitation to move there (checklist 1.4), in the fixed wording from
 * desk/fixed-lines.ts. Never to a party who already writes on WhatsApp, and never twice: it is
 * withheld on the record that its words have actually gone out on an SMS to them, not on the count
 * of SMS replies, so an acknowledgement that held the thread for Ben, which carries no invitation,
 * does not spend it.
 *
 * "Already writes on WhatsApp" means a WhatsApp channel with an inbound turn recorded on it, not
 * merely a WhatsApp channel: the gateway also puts one on the party when the presence source says
 * the number is on WhatsApp, and someone who has never written there, and has just texted us,
 * is exactly who the line is for.
 */
import type { CaseFile, Party, Turn } from '../desk/case-file';
import { fixedLine, type FixedLine, type FixedLineSource } from '../desk/fixed-lines';
import { chooseChannel } from '../desk/sender';

export async function channelFixedLines(file: CaseFile, party: Party, turn: Turn, source: FixedLineSource, now: Date = new Date()): Promise<FixedLine[]> {
    const choice = chooseChannel(party, turn.channel, now);
    if (!choice.ok || choice.channel !== 'sms') return [];
    if (party.channels.some((c) => c.kind === 'whatsapp' && c.lastInboundAt)) return [];
    const line = await fixedLine('move_to_whatsapp', source);
    const alreadyWent = file.turns.some((t) => t.direction === 'outbound' && t.channel === 'sms' && t.partyId === party.personId && t.body.includes(line.text));
    return alreadyWent ? [] : [line];
}
