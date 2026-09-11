/**
 * The fixed lines a channel adds to a reply. One so far: the first reply on SMS to a party who does
 * not write on WhatsApp carries the invitation to move there (checklist 1.4), in the fixed wording
 * from desk/fixed-lines.ts. Never on a later SMS, never to a party who already writes on WhatsApp.
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
    const smsRepliesBefore = file.turns.filter((t) => t.direction === 'outbound' && t.channel === 'sms' && t.partyId === party.personId).length;
    if (smsRepliesBefore > 0) return [];
    return [await fixedLine('move_to_whatsapp', source)];
}
