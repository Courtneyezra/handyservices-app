/**
 * The gateway's inbound envelope, for every channel. The WhatsApp adapter's turn
 * (desk/whatsapp-adapter.ts InboundTurn) is one of these already; the SMS, email, web form and
 * call adapters in this directory produce the same shape, so the gateway treats five channels as
 * one normalised turn (docs/comms-v2/design.md, "Five channels, one desk").
 *
 * The fields beyond the WhatsApp turn are what the other channels prove or carry: `kind` (a form
 * or a call transcript is its own turn kind), `hints` (a form gives a phone and an email at once,
 * which is Identity's link evidence), `reach` (the addresses this turn shows the party can be
 * reached on, so a form's phone becomes an SMS channel on the file), `facts` (what the adapter
 * itself established, recorded on the file with the turn as its source: a form's postcode, a
 * call's outcome) and `email` (the thread the reply must stay on).
 */
import type { ReplyChannel, TurnKind } from '../desk/case-file';
import type { ChannelKind } from '../desk/identity';
import type { InboundMedia } from '../desk/whatsapp-adapter';

export interface IntakeFact { key: string; value: string }

/** The email thread an inbound email arrived on, kept on the party's email channel so the reply stays on it. */
export interface EmailThreadRef { subject: string | null; messageId: string | null; references: string[] }

export interface InboundEnvelope {
    channel: ChannelKind;
    /** E.164 for a phone channel, the lowercase email for email. */
    address: string;
    name: string | null;
    text: string;
    media: InboundMedia[];
    at: string;
    providerMessageId: string | null;
    via: string;
    mediaFailures: Array<{ ref: string; reason: string }>;
    /** The turn kind; text or media when absent. */
    kind?: TurnKind;
    /** What else the turn told us about the person: Identity's hints and link evidence. */
    hints?: { email?: string | null; phone?: string | null; postcode?: string | null };
    /** Addresses this turn proves the party can be reached on, added to the party's channels. */
    reach?: Array<{ kind: ReplyChannel; address: string }>;
    /** Facts the adapter established, recorded at intake with this turn as the source. */
    facts?: IntakeFact[];
    email?: EmailThreadRef;
}

/** The first name from a full name, for a greeting. Null when there is none. */
export function firstNameOf(name: string | null | undefined): string | null {
    const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
    return first ? first : null;
}

/** Truncate on a word boundary to about `max` characters. */
export function truncateWords(text: string, max: number): string {
    const s = text.replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max + 1);
    const at = cut.lastIndexOf(' ');
    return (at > max / 2 ? cut.slice(0, at) : s.slice(0, max)).replace(/[,;:.\s]+$/, '');
}
