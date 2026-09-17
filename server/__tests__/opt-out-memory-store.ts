/**
 * An in-memory OptOutStore (server/opt-out.ts) for tests: the ledger's rows and the leads the
 * addresses on file are read from, with the same matching the database store's SQL does. Every
 * address in it must be synthetic: numbers from the Ofcom drama range, example.com mail.
 */
import type { LeadAddresses, OptOutKeys, OptOutRecord, OptOutStore } from '../opt-out';
import { optOutEmailKey } from '../opt-out';
import { commsPhoneKey } from '../phone-utils';

export interface MemoryLead { id: string; phone: string; email: string | null }

export interface MemoryOptOutStore extends OptOutStore {
    rows: Array<OptOutRecord & { messageId: string | null; conversationId: string | null; revokedAt: Date | null; note: string | null }>;
    leads: MemoryLead[];
    /** conversation id → lead id */
    conversationLeads: Map<string, string>;
}

const carries = (r: { phoneKey: string | null; emailKey: string | null }, keys: OptOutKeys) =>
    (r.phoneKey !== null && keys.phoneKeys.includes(r.phoneKey)) ||
    (r.emailKey !== null && keys.emailKeys.includes(r.emailKey));

export function memoryOptOutStore(leads: MemoryLead[] = [], conversationLeads: Record<string, string> = {}): MemoryOptOutStore {
    let clock = Date.parse('2026-09-16T09:00:00.000Z');
    const store: MemoryOptOutStore = {
        rows: [],
        leads,
        conversationLeads: new Map(Object.entries(conversationLeads)),
        async liveRows(keys) {
            return store.rows.filter((r) => !r.revokedAt && carries(r, keys));
        },
        async leadsOn(keys, conversationId) {
            const linked = conversationId ? store.conversationLeads.get(conversationId) : undefined;
            const found: LeadAddresses[] = [];
            for (const l of store.leads) {
                const matches = carries({ phoneKey: commsPhoneKey(l.phone), emailKey: optOutEmailKey(l.email) }, keys);
                if (l.id === linked || matches) found.push({ phone: l.phone, email: l.email });
            }
            return found;
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
