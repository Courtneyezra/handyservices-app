/**
 * An in-memory OptOutStore (server/opt-out.ts) for tests: the ledger's rows, matched the way the
 * database store's SQL matches them. Every address in it must be synthetic: numbers from the Ofcom
 * drama range, example.com mail.
 */
import type { OptOutKeys, OptOutRecord, OptOutStore } from '../opt-out';

export interface MemoryOptOutStore extends OptOutStore {
    rows: Array<OptOutRecord & { messageId: string | null; conversationId: string | null; revokedAt: Date | null; note: string | null }>;
}

const carries = (r: { phoneKey: string | null; emailKey: string | null }, keys: OptOutKeys) =>
    (r.phoneKey !== null && keys.phoneKeys.includes(r.phoneKey)) ||
    (r.emailKey !== null && keys.emailKeys.includes(r.emailKey));

export function memoryOptOutStore(): MemoryOptOutStore {
    let clock = Date.parse('2026-09-16T09:00:00.000Z');
    const store: MemoryOptOutStore = {
        rows: [],
        async liveRows(keys) {
            return store.rows.filter((r) => !r.revokedAt && carries(r, keys));
        },
        async insert(row) {
            if (row.messageId && store.rows.some((r) => r.messageId === row.messageId)) return false;
            if (!row.phoneKey && !row.emailKey) throw new Error('comms_opt_outs_has_key: a row needs a phone key or an email key');
            store.rows.push({
                id: row.id, phoneKey: row.phoneKey ?? null, emailKey: row.emailKey ?? null, e164: row.e164 ?? null,
                scope: (row.scope as OptOutRecord['scope']) ?? 'marketing', source: row.source, channel: row.channel ?? null,
                at: new Date(clock += 1000), matchedKeyword: row.matchedKeyword ?? null, triggerText: row.triggerText ?? null,
                messageId: row.messageId ?? null, conversationId: row.conversationId ?? null, revokedAt: null, note: row.note ?? null,
            });
            return true;
        },
        async revoke(ids, _by, note) {
            let n = 0;
            for (const r of store.rows) {
                if (r.revokedAt || !ids.includes(r.id)) continue;
                r.revokedAt = new Date(); r.note = note; n++;
            }
            return n;
        },
    };
    return store;
}
