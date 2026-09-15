/**
 * The price screen's thread pane for a quote the new desk drafted (checklist 5.1).
 *
 * The pane reads the old conversations and messages tables for every other quote
 * (server/spine/price-brief.ts `loadThread`), and a comms-v2 thread writes neither: its record is
 * the case file. So for a draft whose row says the new desk wrote it (`SOURCE_CHANNEL` in
 * quote-store.ts), `server/spine/price-screen.ts` asks here through a lazy import, and Ben prices
 * with the conversation and the photos in front of him.
 *
 * Every turn on the file is a message on the pane, whatever channel it came in on - WhatsApp, text,
 * email, a call's transcript, the web form - because the file is one thread across all of them and
 * the pane already names a channel that is not WhatsApp. A turn carries any number of photos and the
 * pane shows one per message, so the second and later ones are messages of their own at the same
 * moment, each under an id of its own. A photo with no served url is left off: the pane has nothing
 * to show for it.
 */
import type { CaseFile, Turn } from '../desk/case-file';
import type { ThreadMessage } from '../../spine/price-brief';
import { priceScreenCaseFiles, quoteFileOn } from './ben-to-request';

function messagesOfTurn(file: CaseFile, turn: Turn): ThreadMessage[] {
    const direction = turn.direction === 'inbound' ? 'in' : 'out';
    const by = turn.direction === 'inbound' ? (file.parties.find((p) => p.personId === turn.partyId)?.name ?? null) : turn.approver;
    const media = turn.media.filter((m) => m.url);
    const base = { at: turn.at, direction, channel: turn.channel, by } as const;
    const first: ThreadMessage = { ...base, id: turn.id, body: turn.body, media: media[0] ? { url: media[0].url!, kind: media[0].kind } : null };
    return [first, ...media.slice(1).map((m): ThreadMessage => ({ ...base, id: `${turn.id}:${m.id}`, body: '', media: { url: m.url!, kind: m.kind } }))];
}

/** The file's turns as the pane's messages, in the file's order. */
export function threadMessagesOf(file: CaseFile): ThreadMessage[] {
    return file.turns.flatMap((t) => messagesOfTurn(file, t));
}

/** The pane's messages for this quote off the case file carrying it; empty when this process has no such file. */
export async function priceScreenThreadFor(slug: string): Promise<ThreadMessage[]> {
    const file = quoteFileOn(await priceScreenCaseFiles(), slug);
    return file ? threadMessagesOf(file) : [];
}
