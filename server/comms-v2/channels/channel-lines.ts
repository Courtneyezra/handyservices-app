/**
 * The fixed lines a channel adds to a reply. One so far: a reply on SMS to a party who does not
 * write on WhatsApp carries the invitation to move there (checklist 1.4), in the fixed wording from
 * desk/fixed-lines.ts. Never to a party who already writes on WhatsApp, and never twice: the ask
 * ledger records the invitation as spent when the reply carrying it sends (desk/desk.ts), the same
 * record the missed-call acknowledgement uses, so an acknowledgement that held the thread for Ben
 * does not spend it and a reply that never goes does not either. Nothing reads the sent words for
 * it: the composer is told to weave a fixed line in naturally and to keep one text short, so it
 * rewords this one, and a search for the wording would invite them again on the next text.
 *
 * "Already writes on WhatsApp" means a WhatsApp channel with an inbound turn recorded on it, not
 * merely a WhatsApp channel: the gateway also puts one on the party when the presence source says
 * the number is on WhatsApp, and someone who has never written there, and has just texted us,
 * is exactly who the line is for.
 */
import { everAsked, type CaseFile, type Party, type Turn } from '../desk/case-file';
import { fixedLine, type FixedLine, type FixedLineSource } from '../desk/fixed-lines';
import { chooseChannel } from '../desk/sender';

/**
 * The ledger subject the invitation to move to WhatsApp is recorded under once it has gone. Like the
 * missed-call acknowledgement it is not a question, so it is not one of the case file's ASK_SUBJECTS;
 * it is on the ledger because the ledger is the one place a thing the desk does once per thread is
 * written down.
 */
export const MOVE_TO_WHATSAPP_SUBJECT = 'move_to_whatsapp_invite';

export async function channelFixedLines(file: CaseFile, party: Party, turn: Turn, source: FixedLineSource, now: Date = new Date()): Promise<FixedLine[]> {
    const choice = chooseChannel(party, turn.channel, now);
    if (!choice.ok || choice.channel !== 'sms') return [];
    if (party.channels.some((c) => c.kind === 'whatsapp' && c.lastInboundAt)) return [];
    if (everAsked(file, MOVE_TO_WHATSAPP_SUBJECT)) return [];
    return [await fixedLine('move_to_whatsapp', source)];
}
