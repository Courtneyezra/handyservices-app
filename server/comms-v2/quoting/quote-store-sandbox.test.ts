/**
 * The sandbox door's `/reset` cleanup (quote-store.ts `deleteSandbox`).
 *
 * An invoice raised against a sandbox quote holds a foreign key on it
 * (`invoices_quote_id_personalized_quotes_id_fk`), so a cleanup that leaves it behind cannot delete
 * the quote: the delete throws, the door answers `{ ok: true, quotes: { error } }` and every sandbox
 * quote survives the reset, which is how a drive ends up reading the previous drive's rows. Found on
 * the branch on 17 Sep 2026, with one sent invoice holding twenty sandbox quotes in place.
 */
import { describe, expect, it, vi } from 'vitest';

const executed: string[] = [];

/** The SQL a chunked drizzle template would send, near enough to assert a table and an order on. */
function textOf(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node.value)) return node.value.join('?');
    if (Array.isArray(node.queryChunks)) return node.queryChunks.map(textOf).join('');
    return '';
}

vi.mock('../live-database', () => ({
    assertCommsV2DatabaseFor: () => undefined,
    commsV2Db: async () => ({
        execute: async (q: any) => {
            const text = textOf(q).replace(/\s+/g, ' ').trim();
            executed.push(text);
            if (/^select id, short_slug from personalized_quotes/.test(text)) {
                return { rows: [{ id: 'quote_1', short_slug: 'aaa11111' }, { id: 'quote_2', short_slug: 'bbb22222' }] };
            }
            if (/^select distinct conversation_id/.test(text)) return { rows: [] };
            return { rowCount: 1 };
        },
    }),
}));

describe('deleteSandbox', () => {
    it('deletes the invoices raised against the sandbox quotes before the quotes themselves, and counts them', async () => {
        executed.length = 0;
        const { liveQuoteStore } = await import('./quote-store');
        const out = await liveQuoteStore.deleteSandbox(['+447700900942', 'sandbox-customer@example.invalid']);

        const invoiceDelete = executed.findIndex((q) => /^delete from invoices where quote_id in/.test(q));
        const quoteDelete = executed.findIndex((q) => /^delete from personalized_quotes where id in/.test(q));
        expect(invoiceDelete, 'no invoice delete: the foreign key would block the quote delete and the whole reset').toBeGreaterThanOrEqual(0);
        expect(quoteDelete).toBeGreaterThanOrEqual(0);
        expect(invoiceDelete).toBeLessThan(quoteDelete);
        expect(out.invoices).toBe(1);
        expect(out.quotes).toBe(1);
    });
});
