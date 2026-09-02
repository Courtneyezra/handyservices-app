/**
 * Phase 1 vitest: appendEvent's idempotency contract against a fake db (no Postgres).
 *
 * The fake honours the real unique index (ref_table, ref_id, event_type): a second insert with the
 * same key returns no rows, the way ON CONFLICT DO NOTHING ... RETURNING does. DATABASE_URL must be
 * set to any syntactically valid URL for the module to import (server/db.ts throws without one);
 * nothing connects.
 */
import { describe, it, expect, vi } from 'vitest';
import { appendEvent, actorFromApprovedBy, actorFromDraftSource, e164Of, type LedgerDb } from './ledger';

function fakeDb() {
    const seen = new Set<string>();
    const inserted: any[] = [];
    const db = {
        insert: vi.fn((_table: unknown) => ({
            values: (v: any) => ({
                onConflictDoNothing: () => ({
                    returning: async () => {
                        const key = `${v.refTable}|${v.refId}|${v.eventType}`;
                        if (seen.has(key)) return [];
                        seen.add(key);
                        inserted.push(v);
                        return [{ id: v.id }];
                    },
                }),
            }),
        })),
    } as unknown as LedgerDb;
    return { db, inserted, seen };
}

const base = {
    phone: '+447700900123', actor: 'agent:comms', refTable: 'message_drafts', refId: 'draft_1',
} as const;

describe('appendEvent', () => {
    it('inserts the first event and returns its id', async () => {
        const f = fakeDb();
        const r = await appendEvent({ ...base, eventType: 'draft_created', body: 'hello', runId: 'run_x' }, { db: f.db });
        expect(r.inserted).toBe(true);
        expect(r.id).toBeTruthy();
        expect(f.inserted).toHaveLength(1);
        expect(f.inserted[0]).toMatchObject({ eventType: 'draft_created', refTable: 'message_drafts', refId: 'draft_1', runId: 'run_x', phone: '+447700900123', channel: 'system' });
    });

    it('is a no-op on the same (ref_table, ref_id, event_type) — the retry and the backfill converge', async () => {
        const f = fakeDb();
        const first = await appendEvent({ ...base, eventType: 'draft_sent' }, { db: f.db });
        const again = await appendEvent({ ...base, eventType: 'draft_sent', body: 'different words, same event' }, { db: f.db });
        expect(first.inserted).toBe(true);
        expect(again.inserted).toBe(false);
        expect(again.error).toBeUndefined();
        expect(f.inserted).toHaveLength(1);
    });

    it('records a different event type for the same ref as a new row', async () => {
        const f = fakeDb();
        await appendEvent({ ...base, eventType: 'draft_created' }, { db: f.db });
        const r = await appendEvent({ ...base, eventType: 'draft_approved' }, { db: f.db });
        expect(r.inserted).toBe(true);
        expect(f.inserted.map((x) => x.eventType)).toEqual(['draft_created', 'draft_approved']);
    });

    it('never throws: a failing insert is reported, not raised', async () => {
        const db = { insert: () => { throw new Error('connection refused'); } } as unknown as LedgerDb;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r = await appendEvent({ ...base, eventType: 'draft_created' }, { db });
        warn.mockRestore();
        expect(r.inserted).toBe(false);
        expect(r.error).toMatch(/connection refused/);
    });

    it('normalises the phone and defaults occurred_at and role', async () => {
        const f = fakeDb();
        await appendEvent({ ...base, phone: '447700900123@c.us', eventType: 'message_out', refTable: 'messages', refId: 'SM1' }, { db: f.db });
        expect(f.inserted[0].phone).toBe('+447700900123');
        expect(f.inserted[0].occurredAt).toBeInstanceOf(Date);
        expect(f.inserted[0].roleProfile).toBe('customer');
    });
});

describe('attribution vocabulary', () => {
    it('maps Phase 0 approvers and legacy prefixes to ledger actors', () => {
        expect(actorFromApprovedBy('human:ben@handyservices.app')).toBe('human:ben@handyservices.app');
        expect(actorFromApprovedBy('agent.comms.autosend')).toBe('agent:comms');
        expect(actorFromApprovedBy('agent.sla_chase')).toBe('agent:sla_chase');
        expect(actorFromApprovedBy('rules.first_contact')).toBe('system:first_contact_ack');
        expect(actorFromApprovedBy('system.invoice')).toBe('system:invoice');
        expect(actorFromApprovedBy('comms_agent:autosend')).toBe('agent:comms');
        expect(actorFromApprovedBy('first_contact_ack:whatsapp')).toBe('system:first_contact_ack');
        expect(actorFromApprovedBy('ben@handyservices.app')).toBe('human:ben@handyservices.app');
        expect(actorFromApprovedBy(null)).toBeNull();
    });
    it('maps draft sources and phones', () => {
        expect(actorFromDraftSource('comms_agent')).toBe('agent:comms');
        expect(actorFromDraftSource('first_contact_ack')).toBe('system:first_contact_ack');
        expect(e164Of('447700900123@c.us')).toBe('+447700900123');
        expect(e164Of(null)).toBe('');
    });
});
