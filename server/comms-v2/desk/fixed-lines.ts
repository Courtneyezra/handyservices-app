/**
 * The fixed lines: the few sentences the desk sends in Ben's words rather than the composer's.
 *
 * Four are the threads the desk does not scope (behaviour.md answer 21): gas, a complaint, a
 * refund, a trust doubt. Their reviewed wording lives in the knowledge base (server/spine/
 * knowledge-base.ts getFixedLine, reviewed rows only); the defaults here stand in dry run until
 * Ben has reviewed one, because the captain's rule is "almost never silent, always acknowledge".
 * Live, the sender refuses a default: only words from the four sources reach a customer.
 * The rest are Goal 1's: money goes to Ben (checklist 2.7), dates come with the quote (2.6), and
 * the acknowledgement a guard hold sends (Contract 4, second failure).
 */
export type FixedLineKind = 'gas' | 'complaint' | 'refund' | 'trust' | 'money_to_ben' | 'dates_with_quote' | 'held_ack';

export const DEFAULT_FIXED_LINES: Record<FixedLineKind, string> = {
    gas: "Thanks for getting in touch. Gas work isn't something we take on ourselves, so I've passed this to Ben and he'll come back to you.",
    complaint: "I'm sorry to hear that. I've passed this straight to Ben and he'll come back to you personally.",
    refund: "I've passed this straight to Ben and he'll come back to you on it personally.",
    trust: "That's a fair question. I've passed it to Ben and he'll come back to you himself.",
    money_to_ben: 'Ben will come back to you on the price.',
    dates_with_quote: 'Dates come with your quote.',
    held_ack: "Thanks, I've passed this to Ben and he'll come back to you.",
};

const KB_BACKED: ReadonlySet<FixedLineKind> = new Set<FixedLineKind>(['gas', 'complaint', 'refund', 'trust']);

export interface FixedLineSource {
    /** A reviewed knowledge-base row for one of the four, or null when none is reviewed. */
    reviewed(kind: 'gas' | 'complaint' | 'refund' | 'trust'): Promise<{ id: string; words: string } | null>;
}

/** The knowledge base, read through its reviewed-only helper. Loaded on first use: it opens the database. */
export const knowledgeBaseFixedLines: FixedLineSource = {
    async reviewed(kind) {
        try {
            const { getFixedLine } = await import('../../spine/knowledge-base');
            const e = await getFixedLine(kind);
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
        const row = await source.reviewed(kind as 'gas' | 'complaint' | 'refund' | 'trust');
        if (row) return { kind, text: row.words, kbId: row.id };
    }
    return { kind, text: DEFAULT_FIXED_LINES[kind], kbId: null };
}
