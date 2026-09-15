/**
 * One customer turn out of a quick run of messages (checklist cross-cutting 2 and 2.8; design.md's
 * Desk API: "one entry per customer turn, not one per inbound message, so a burst of three bubbles
 * is one turn").
 *
 * Every message lands on the case file the moment it arrives, so the file stays append-only and a
 * durable store holds the customer's words whatever happens next. What waits is the desk: a text or
 * a photo on WhatsApp or SMS goes to it only once the same party has been quiet on that channel for
 * the quiet window, and every message that arrived inside the window goes together, as one turn. The
 * desk then routes, gathers and composes once, and the one-reply guard counts one reply. A customer
 * who waits for the reply before writing again starts a new turn, as before.
 *
 * The window is the old desk's inbound debounce default (server/spine/config.ts DEBOUNCE_SECONDS,
 * T35): eight seconds, long enough that "it's the tap in the kitchen" three seconds after "hi" is one
 * reply, short enough to read as a person typing back. No comms-v2 document settles a length, so the
 * number is an open decision, raised with the change that brought it.
 *
 * Only texts and photos on the two messaging channels wait. A form, an email, a call transcript and
 * a portal action go to the desk at once, after any messages still waiting from that party on that
 * file, so the desk reads the thread in the order it arrived (gateway.ts).
 */
import type { Turn } from './case-file';

export const CUSTOMER_TURN_QUIET_MS = 8_000;

/** A customer message that waits out the quiet window before the desk reads it. */
export function waitsForQuiet(turn: Turn): boolean {
    return turn.direction === 'inbound' && (turn.kind === 'text' || turn.kind === 'media') && (turn.channel === 'whatsapp' || turn.channel === 'sms');
}

/**
 * The messages of one burst as the one turn the desk reads: the newest message's id, time and
 * channel, every message's words in order, and every photo. The photos are the file's own objects,
 * so a description the desk writes on one lands on the stored turn. A burst of one is that turn.
 */
export function customerTurnOf(turns: Turn[]): Turn {
    if (turns.length === 1) return turns[0];
    const last = turns[turns.length - 1];
    const media = turns.flatMap((t) => t.media);
    return { ...last, kind: media.length ? 'media' : 'text', body: turns.map((t) => t.body.trim()).filter(Boolean).join('\n'), media, burst: turns.map((t) => t.id) };
}
