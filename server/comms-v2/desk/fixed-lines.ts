/**
 * The fixed lines: the few sentences the desk sends in Ben's words rather than the composer's.
 *
 * Four are the threads the desk does not scope (behaviour.md answer 21): gas, a complaint, a
 * refund, a trust doubt. Their reviewed wording lives in the knowledge base (server/spine/
 * knowledge-base.ts getFixedLine, reviewed rows only); the defaults here stand in dry run until
 * Ben has reviewed one. Live, the sender refuses a default for those four: only words from the
 * four sources reach a customer. The Goal 1 lines below them are the checklist's own wording and
 * send live: dates come with the quote (2.6), the invitation to move to WhatsApp, and
 * `first_contact_ack`, Goal 4's: the quote delivery carries it where the acknowledgement a
 * web-form enquiry was owed held for Ben and never went, so the first message that ever reaches
 * them names us and the enquiry it follows rather than being a bare link (`quoting/quoting-door.ts`).
 *
 * No line promises to come back to the customer (the captain's ruling, 18 Sep 2026: "remove that
 * line entirely"). Where the desk cannot answer something (money, a date change, a question we have
 * no source for, scoping that is not converging, a reply that could not be written) the thread is
 * held for Ben and the desk says nothing about it: the hold is on his card, and the customer hears
 * only what the reply can answer, or nothing (service/hold-reasons.ts `FIXED_LINE_FOR`, desk.ts).
 *
 * Goal 6 (server/comms-v2/service) adds the Service specialist's lines: a requested change of
 * details and a customer asking for a call (checklist 7.1, 7.2). Those are the checklist's own
 * wording and send live; the knowledge base is not read for them.
 *
 * Every line is Ben's own voice, because the desk is Ben (brand-voice/whatsapp-comms.md, "Who you
 * are"): none names Ben, the office or the team in the third person. The four knowledge-base
 * defaults close with his "Thanks / Ben" sign-off; the short lines are woven into a reply and carry
 * none. `first_contact_ack` introduces him in the first person ("Ben here"), which is not the third person.
 *
 * One line says what arrived and when, from the turns themselves, so no model is needed to write
 * it: a thanks for media that arrived well before the turn being answered says it is late and goes
 * after the reply to what the customer has just said (`lateMediaAckLine`).
 */
import type { TurnMedia } from './case-file';
import { withoutDashPunctuation } from './dashes';

export type FixedLineKind = 'gas' | 'complaint' | 'refund' | 'trust' | 'dates_with_quote' | 'move_to_whatsapp' | 'first_contact_ack' | 'change_of_details' | 'callback_to_ben' | 'late_media_ack';

export const DEFAULT_FIXED_LINES: Record<FixedLineKind, string> = {
    gas: "Thanks for getting in touch. We don't take on gas work, so a Gas Safe registered engineer is the one to call for this.\n\nThanks\nBen",
    complaint: "I'm sorry to hear that. Leave it with me, I'll look into it properly and come back to you personally.\n\nThanks\nBen",
    refund: "Understood. Let me go through the job and the payment, and I'll come back to you on it personally.\n\nThanks\nBen",
    trust: "That's a fair question. Let me get you a proper answer rather than a quick one, and I'll come back to you.\n\nThanks\nBen",
    dates_with_quote: 'Dates come with your quote.',
    move_to_whatsapp: "If it's easier, you can message us on WhatsApp on this same number.",
    first_contact_ack: 'Thanks for your enquiry, Ben here from Handy Services.',
    change_of_details: "Thanks, I've noted that and I'll update your details.",
    callback_to_ben: "No problem, I'll give you a call back.",
    late_media_ack: "Thanks for what you sent earlier, sorry I'm only getting back to you on it now.",
};

/** The four whose words are Ben's to review; a default for one of these sends in dry run only. The other kinds are Goal 1 wording and send live. */
export const KB_BACKED: ReadonlySet<FixedLineKind> = new Set<FixedLineKind>(['gas', 'complaint', 'refund', 'trust']);

export type KbFixedLineKind = 'gas' | 'complaint' | 'refund' | 'trust';

export interface FixedLineSource {
    /** A reviewed knowledge-base row for the kind, or null when none is reviewed. */
    reviewed(kind: KbFixedLineKind): Promise<{ id: string; words: string } | null>;
}

/**
 * The knowledge base, read through its reviewed-only helpers. Loaded on first use: it opens the
 * database. A reader, so it does not ask live-database.ts whose subject is writing: on a database
 * the desk may not write to it simply finds nothing and the caller falls back to Goal 1's wording,
 * which is what keeps a gas, complaint or refund turn answerable at all.
 */
export const knowledgeBaseFixedLines: FixedLineSource = {
    async reviewed(kind) {
        try {
            const kb = await import('../../spine/knowledge-base');
            const e = await kb.getFixedLine(kind);
            return e && e.approvedWords.trim() ? { id: e.id, words: e.approvedWords.trim() } : null;
        } catch {
            return null;
        }
    },
};

export const noFixedLineSource: FixedLineSource = { async reviewed() { return null; } };

export interface FixedLine { kind: FixedLineKind; text: string; kbId: string | null }

/**
 * The line for a kind. A reviewed row's words go out with any dash used as punctuation made a comma,
 * the house rule every customer text keeps (dashes.ts); the verbatim rail compares the row's words
 * the same way (guards.ts), so the line still counts as the row's.
 */
export async function fixedLine(kind: FixedLineKind, source: FixedLineSource = knowledgeBaseFixedLines): Promise<FixedLine> {
    if (KB_BACKED.has(kind)) {
        const row = await source.reviewed(kind as KbFixedLineKind);
        if (row) return { kind, text: withoutDashPunctuation(row.words), kbId: row.id };
    }
    return { kind, text: DEFAULT_FIXED_LINES[kind], kbId: null };
}

/** What arrived, as the customer would say it: "photo", "videos", "photos and the video"; null for no media. */
export function mediaNoun(media: readonly TurnMedia[]): string | null {
    const count = (kind: TurnMedia['kind'], one: string) => {
        const n = media.filter((m) => m.kind === kind).length;
        return n === 0 ? null : n === 1 ? one : `${one}s`;
    };
    const parts = [count('image', 'photo'), count('video', 'video')].filter((p): p is string => !!p);
    return parts.length ? parts.join(' and the ') : null;
}

/**
 * The held acknowledgement the desk sent before the captain's ruling of 18 Sep 2026, when a reply
 * could not be written or a thread was held: "Thanks, leave it with me and I'll come back to you.",
 * or naming what the turn brought ("Thanks for the video, leave it with me..."). The desk no longer
 * sends it (a held turn is silent), but threads still carry it, so it is kept only to read them.
 */
export const FORMER_HELD_ACK = "Thanks, leave it with me and I'll come back to you.";

/**
 * Whether an outbound text is that former held acknowledgement and nothing else. A send record
 * keeps no fixed-line kind, so the wording is the only record; it says nothing about the
 * customer's question, so a template send does not count it as an answer (human-reply.ts
 * `unansweredQuestion`).
 */
export function isHeldAckText(text: string): boolean {
    const t = text.trim();
    if (t === FORMER_HELD_ACK) return true;
    const rest = FORMER_HELD_ACK.replace(/^Thanks,/, '');
    const m = /^Thanks for the (.+?),(.*)$/s.exec(t);
    return !!m && m[2] === rest && /^(?:photos?|videos?)(?: and the videos?)?$/.test(m[1]);
}

/** Media that arrived longer ago than this before the turn being answered is thanked for as late. */
export const LATE_MEDIA_MS = 30 * 60 * 1000;

const londonDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * The thanks for media that arrived well before the turn being answered, saying when it came in
 * words the date guard allows ("earlier", "yesterday", "the other day"; never a weekday or a time)
 * and that the reply to it is late. The desk puts it after the composed reply, so what the
 * customer has just asked is answered first.
 */
export function lateMediaAckLine(media: readonly TurnMedia[], sentAt: Date, now: Date): FixedLine {
    const noun = mediaNoun(media);
    if (!noun) return { kind: 'late_media_ack', text: DEFAULT_FIXED_LINES.late_media_ack, kbId: null };
    const yesterday = londonDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const when = londonDay(sentAt) === londonDay(now) ? 'earlier' : londonDay(sentAt) === yesterday ? 'yesterday' : 'the other day';
    return { kind: 'late_media_ack', text: `Thanks for the ${noun} you sent ${when}, sorry I'm only getting back to you on it now.`, kbId: null };
}
