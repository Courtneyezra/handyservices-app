/**
 * The fixed lines: the few sentences the desk sends in Ben's words rather than the composer's.
 *
 * Four are the threads the desk does not scope (behaviour.md answer 21): gas, a complaint, a
 * refund, a trust doubt. Their reviewed wording lives in the knowledge base (server/spine/
 * knowledge-base.ts getFixedLine, reviewed rows only); the defaults here stand in dry run until
 * Ben has reviewed one, because the captain's rule is "almost never silent, always acknowledge".
 * Live, the sender refuses a default for those four: only words from the four sources reach a
 * customer. The Goal 1 lines below them are the checklist's own wording and send live.
 * The rest are Goal 1's: money goes to Ben (checklist 2.7), a booked date change goes to Ben too
 * (`date_change_to_ben`, the Scheduling specialist's line), dates come with the quote (2.6), and
 * the acknowledgement a guard hold sends (Contract 4, second failure).
 *
 * Goal 6 (server/comms-v2/service) adds the Service specialist's hold vocabulary: a question we
 * have no source for, scoping that is not converging, a requested change of details, and a
 * customer asking for a call (checklist 7.1, 7.2). Those are the checklist's own wording and send
 * live; the knowledge base is not read for them.
 */
export type FixedLineKind = 'gas' | 'complaint' | 'refund' | 'trust' | 'money_to_ben' | 'dates_with_quote' | 'date_change_to_ben' | 'held_ack' | 'move_to_whatsapp' | 'no_source' | 'not_converging' | 'change_of_details' | 'callback_to_ben';

export const DEFAULT_FIXED_LINES: Record<FixedLineKind, string> = {
    gas: "Thanks for getting in touch. Gas work isn't something we take on ourselves, so I've passed this to Ben and he'll come back to you.",
    complaint: "I'm sorry to hear that. I've passed this straight to Ben and he'll come back to you personally.",
    refund: "I've passed this straight to Ben and he'll come back to you on it personally.",
    trust: "That's a fair question. I've passed it to Ben and he'll come back to you himself.",
    money_to_ben: 'Ben will come back to you on the price.',
    dates_with_quote: 'Dates come with your quote.',
    date_change_to_ben: 'Ben will come back to you on the date.',
    held_ack: "Thanks, I've passed this to Ben and he'll come back to you.",
    move_to_whatsapp: "If it's easier, you can message us on WhatsApp on this same number.",
    no_source: "I've passed that one to Ben and he'll come back to you on it.",
    not_converging: "I've passed this over to Ben so he can pick it up with you directly.",
    change_of_details: "I've noted that and passed it to Ben to update your details.",
    callback_to_ben: "I've passed that on to Ben and he'll call you back.",
};

/** The four whose words are Ben's to review; a default for one of these sends in dry run only. The other kinds are Goal 1 wording and send live. */
export const KB_BACKED: ReadonlySet<FixedLineKind> = new Set<FixedLineKind>(['gas', 'complaint', 'refund', 'trust']);

export type KbFixedLineKind = 'gas' | 'complaint' | 'refund' | 'trust';

export interface FixedLineSource {
    /** A reviewed knowledge-base row for the kind, or null when none is reviewed. */
    reviewed(kind: KbFixedLineKind): Promise<{ id: string; words: string } | null>;
}

/** The knowledge base, read through its reviewed-only helpers. Loaded on first use: it opens the database. */
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

export async function fixedLine(kind: FixedLineKind, source: FixedLineSource = knowledgeBaseFixedLines): Promise<FixedLine> {
    if (KB_BACKED.has(kind)) {
        const row = await source.reviewed(kind as KbFixedLineKind);
        if (row) return { kind, text: row.words, kbId: row.id };
    }
    return { kind, text: DEFAULT_FIXED_LINES[kind], kbId: null };
}
