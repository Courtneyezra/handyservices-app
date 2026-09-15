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
 * the acknowledgement a guard hold sends (Contract 4, second failure). `first_contact_ack` is
 * Goal 4's: the quote delivery carries it where the acknowledgement a web-form enquiry was owed
 * held for Ben and never went, so the first message that ever reaches them names us and the
 * enquiry it follows rather than being a bare link (`quoting/quoting-door.ts`).
 *
 * Goal 6 (server/comms-v2/service) adds the Service specialist's hold vocabulary: a question we
 * have no source for, scoping that is not converging, a requested change of details, and a
 * customer asking for a call (checklist 7.1, 7.2). Those are the checklist's own wording and send
 * live; the knowledge base is not read for them.
 *
 * Every line is Ben's own voice, because the desk is Ben (brand-voice/whatsapp-comms.md, "Who you
 * are"): none names Ben, the office or the team in the third person, and a line that needs an
 * answer the desk does not have says so in the first person. The four knowledge-base defaults close
 * with his "Thanks / Ben" sign-off; the short lines are woven into a reply and carry none.
 * `first_contact_ack` introduces him in the first person ("Ben here"), which is not the third person.
 */
export type FixedLineKind = 'gas' | 'complaint' | 'refund' | 'trust' | 'money_to_ben' | 'dates_with_quote' | 'date_change_to_ben' | 'held_ack' | 'move_to_whatsapp' | 'first_contact_ack' | 'no_source' | 'not_converging' | 'change_of_details' | 'callback_to_ben';

export const DEFAULT_FIXED_LINES: Record<FixedLineKind, string> = {
    gas: "Thanks for getting in touch. We don't take on gas work, so a Gas Safe registered engineer is the one to call for this.\n\nThanks\nBen",
    complaint: "I'm sorry to hear that. Leave it with me, I'll look into it properly and come back to you personally.\n\nThanks\nBen",
    refund: "Understood. Let me go through the job and the payment, and I'll come back to you on it personally.\n\nThanks\nBen",
    trust: "That's a fair question. Let me get you a proper answer rather than a quick one, and I'll come back to you.\n\nThanks\nBen",
    money_to_ben: 'Let me check on the price and come straight back to you.',
    dates_with_quote: 'Dates come with your quote.',
    date_change_to_ben: 'Let me check on the date and come straight back to you.',
    held_ack: "Thanks, leave it with me and I'll come back to you.",
    move_to_whatsapp: "If it's easier, you can message us on WhatsApp on this same number.",
    first_contact_ack: 'Thanks for your enquiry - Ben here from Handy Services.',
    no_source: 'Let me check on that one and come straight back to you.',
    not_converging: 'Let me look at this properly and come back to you.',
    change_of_details: "Thanks, I've noted that and I'll update your details.",
    callback_to_ben: "No problem, I'll give you a call back.",
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

export async function fixedLine(kind: FixedLineKind, source: FixedLineSource = knowledgeBaseFixedLines): Promise<FixedLine> {
    if (KB_BACKED.has(kind)) {
        const row = await source.reviewed(kind as KbFixedLineKind);
        if (row) return { kind, text: row.words, kbId: row.id };
    }
    return { kind, text: DEFAULT_FIXED_LINES[kind], kbId: null };
}
