/**
 * The opt-out ledger matches on the email address as a second key, so a row keyed on an email
 * blocks an email send as a phone-keyed row blocks a text. One opt-out is one row, on the address
 * it arrived on: it is never copied onto another address, so no party is silenced by an address
 * somebody else is also reachable on. An opt-out still holds on every channel because a sender
 * asks about every address the party wrote to us on (server/comms-v2/desk/sender.test.ts). Runs on
 * the in-memory store; nothing is sent.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));

import { blockedByOptOut, getOptOut, liftAddressOf, optOutEmailKey, optOutKeysOf, optOutRefusalMessage, recordOptOut, revokeOptOut, strongestOptOut } from './opt-out';
import { memoryOptOutStore, type MemoryOptOutStore } from './__tests__/opt-out-memory-store';

const SAM = { phone: '07700 900942', email: 'Sam.Tester@Example.com' };
const ALEX = { phone: '+447700900943', email: 'alex@example.com' };
const PHONE_ONLY = { phone: '07700900944' };
const SHARED_EMAIL = 'lettings@example.com';

describe('optOutEmailKey', () => {
    it('trims, lowercases and drops a mailto: and invisible marks; anything not shaped like an address is no key', () => {
        expect(optOutEmailKey('  Sam.Tester@Example.com ')).toBe('sam.tester@example.com');
        expect(optOutEmailKey('mailto:sam@example.com')).toBe('sam@example.com');
        expect(optOutEmailKey('‪sam@example.com‬')).toBe('sam@example.com');
        // Dots and plus tags are kept: they can be two different people.
        expect(optOutEmailKey('s.am+x@example.com')).toBe('s.am+x@example.com');
        expect(optOutEmailKey('07700900942')).toBeNull();
        expect(optOutEmailKey('sam@')).toBeNull();
        expect(optOutEmailKey(null)).toBeNull();
    });

    it('a bare string is still a phone number', () => {
        expect(optOutKeysOf('+447700900942')).toEqual({ phoneKeys: ['7700900942'], emailKeys: [] });
        expect(optOutKeysOf({ phones: ['447700900942@c.us', '07700 900942'], emails: ['SAM@example.com', null] }))
            .toEqual({ phoneKeys: ['7700900942'], emailKeys: ['sam@example.com'] });
    });
});

describe('recording an opt-out', () => {
    it('writes one row on the address it arrived on, and a redelivered message writes nothing', async () => {
        const store = memoryOptOutStore();
        const first = await recordOptOut({ phone: '447700900942@c.us', scope: 'marketing', source: 'inbound_keyword', channel: 'whatsapp', messageId: 'm1', matchedKeyword: 'stop', triggerText: 'STOP' }, store);
        const again = await recordOptOut({ phone: '447700900942@c.us', scope: 'marketing', source: 'inbound_keyword', channel: 'whatsapp', messageId: 'm1' }, store);
        expect(first).toMatchObject({ created: true, key: '7700900942', keys: { phoneKeys: ['7700900942'], emailKeys: [] } });
        expect(again).toMatchObject({ created: false, id: null });
        expect(store.rows.map((r) => [r.phoneKey, r.emailKey, r.e164])).toEqual([['7700900942', null, '+447700900942']]);

        expect(await blockedByOptOut('07700 900942', 'marketing', store)).toMatchObject({ scope: 'marketing' });
        // A plain STOP still lets a service reply through.
        expect(await blockedByOptOut('07700 900942', 'service_reply', store)).toBeNull();
        expect(await blockedByOptOut({ phones: [ALEX.phone], emails: [ALEX.email] }, 'marketing', store)).toBeNull();
    });

    it('keys a row on the email an opt-out arrived on, and on both when the caller names both', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ email: ' ALEX@example.com', scope: 'all', source: 'manual', channel: 'email', note: 'asked by email' }, store);
        expect(store.rows[0]).toMatchObject({ phoneKey: null, emailKey: 'alex@example.com', e164: null, channel: 'email' });
        expect(await blockedByOptOut({ emails: ['Alex@example.com'] }, 'service_reply', store)).toMatchObject({ scope: 'all' });
        // Nothing was copied onto a phone, so the ledger alone does not answer for one.
        expect(await blockedByOptOut(ALEX.phone, 'service_reply', store)).toBeNull();

        const both = memoryOptOutStore();
        await recordOptOut({ phone: SAM.phone, email: SAM.email, scope: 'all', source: 'manual' }, both);
        expect(both.rows[0]).toMatchObject({ phoneKey: '7700900942', emailKey: 'sam.tester@example.com' });
        expect(await blockedByOptOut({ emails: [SAM.email] }, 'service_reply', both)).toMatchObject({ scope: 'all' });
        expect(await blockedByOptOut(SAM.phone, 'service_reply', both)).toMatchObject({ scope: 'all' });
    });

    it('never carries onto an address another party is reachable on: a STOP by one tenant leaves the letting agent\'s address alone', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ phone: '07700 900950', scope: 'all', source: 'inbound_keyword', channel: 'whatsapp', messageId: 'x1', matchedKeyword: 'do not contact me' }, store);
        expect(store.rows.map((r) => [r.phoneKey, r.emailKey])).toEqual([['7700900950', null]]);

        expect(await blockedByOptOut('07700 900950', 'service_reply', store)).toMatchObject({ scope: 'all' });
        // The other tenant, and anyone else the agent's mailbox reaches, is untouched.
        expect(await blockedByOptOut({ phones: ['07700 900951'], emails: [SHARED_EMAIL] }, 'service_reply', store)).toBeNull();
        expect(await blockedByOptOut({ emails: [SHARED_EMAIL] }, 'marketing', store)).toBeNull();
    });

    it('is refused with no usable address at all, and nothing is written', async () => {
        const store = memoryOptOutStore();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await recordOptOut({ email: 'not an address', phone: null, scope: 'all', source: 'manual' }, store)).toMatchObject({ created: false, id: null, key: null });
        expect(store.rows).toEqual([]);
        warn.mockRestore();
    });
});

describe('the refusal a blocked send gives back', () => {
    it('names the row the block comes from and the addresses it is keyed on, masked', async () => {
        const store = memoryOptOutStore();
        const recorded = await recordOptOut({ phone: SAM.phone, email: SAM.email, scope: 'all', source: 'manual' }, store);
        const blocked = (await blockedByOptOut({ phones: [SAM.phone] }, 'service_reply', store))!;
        const message = optOutRefusalMessage(blocked);
        expect(message).toContain('asked us not to contact them at all');
        expect(message).toContain(recorded.id!);
        expect(message).toContain('•••942');
        expect(message).toContain('s•••@example.com');
        expect(message).not.toContain('7700900942');
        expect(message).not.toContain('sam.tester@example.com');
    });
});

describe('a party that never opted out', () => {
    it('is unaffected on every address', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ phone: SAM.phone, email: SAM.email, scope: 'all', source: 'manual' }, store);
        expect(await getOptOut({ phones: [ALEX.phone], emails: [ALEX.email] }, store)).toBeNull();
        expect(await blockedByOptOut({ phones: [ALEX.phone], emails: [ALEX.email] }, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut({ phones: [], emails: [] }, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut(null, 'marketing', store)).toBeNull();
    });
});

describe('phone-only matching', () => {
    it('behaves exactly as before: every format of the number, strongest scope wins, earliest among equals, a plain STOP lets a service reply through', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ phone: '447700900944@c.us', scope: 'marketing', source: 'inbound_keyword', messageId: 'p1' }, store);
        expect(store.rows.map((x) => [x.phoneKey, x.emailKey])).toEqual([['7700900944', null]]);
        for (const format of ['07700 900944', '+447700900944', '447700900944@c.us', '0044 7700 900944']) {
            expect(await blockedByOptOut(format, 'marketing', store)).toMatchObject({ scope: 'marketing' });
            expect(await blockedByOptOut(format, 'service_reply', store)).toBeNull();
        }
        // An omitted purpose is marketing.
        expect(await blockedByOptOut('07700900944', undefined, store)).not.toBeNull();

        await recordOptOut({ phone: '07700900944', scope: 'all', source: 'inbound_keyword', messageId: 'p2' }, store);
        await recordOptOut({ phone: '07700900944', scope: 'all', source: 'inbound_keyword', messageId: 'p3' }, store);
        const strongest = await getOptOut('07700900944', store);
        expect(strongest).toMatchObject({ scope: 'all', id: store.rows[1].id });
        expect(await blockedByOptOut('07700900944', 'service_reply', store)).toMatchObject({ scope: 'all' });
        expect(await blockedByOptOut('07700900947', 'marketing', store)).toBeNull();
        expect(await getOptOut('not a number', store)).toBeNull();
    });

    it('never matches a row on a key of the other kind', () => {
        const at = new Date('2026-09-16T09:00:00.000Z');
        const row = { id: 'o1', phoneKey: null, emailKey: 'sam@example.com', e164: null, scope: 'all' as const, source: 'manual', channel: null, at, matchedKeyword: null, triggerText: null };
        expect(strongestOptOut([row], { phoneKeys: ['7700900942'], emailKeys: [] })).toBeNull();
        expect(strongestOptOut([row], { phoneKeys: [], emailKeys: ['sam@example.com'] })).toBe(row);
    });
});

describe('revokeOptOut', () => {
    // A row carrying both keys is what an opt-out recorded against both addresses writes, and what
    // the rows a backfill or an earlier version of the ledger wrote look like. The lift rule holds
    // whatever shape a live row is in.
    const seed = async (store: MemoryOptOutStore, rows: Array<[string | null, string | null]>) => {
        const ids: string[] = [];
        for (const [phoneKey, emailKey] of rows) {
            const id = `optout_seed_${ids.length + 1}`;
            await store.insert({ id, phoneKey, emailKey, scope: 'all', source: 'backfill' });
            ids.push(id);
        }
        return ids;
    };

    it('lifts only a row whose every address is named', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ phone: SAM.phone, email: SAM.email, scope: 'all', source: 'manual' }, store);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const byEmail = await revokeOptOut({ emails: [SAM.email] }, 'human:ben@example.com', 'opted back in', store);
        expect(byEmail.revoked).toBe(0);
        expect(byEmail.notLifted.map((n) => n.alsoCarries)).toEqual([['•••942']]);
        expect(await blockedByOptOut({ emails: [SAM.email] }, 'marketing', store)).not.toBeNull();

        expect(await revokeOptOut({ phones: [SAM.phone], emails: [SAM.email] }, 'human:ben@example.com', 'opted back in', store)).toEqual({ revoked: 1, notLifted: [] });
        expect(await blockedByOptOut({ phones: [SAM.phone], emails: [SAM.email] }, 'marketing', store)).toBeNull();
        expect(await revokeOptOut('', 'human:ben@example.com', undefined, store)).toEqual({ revoked: 0, notLifted: [] });
        warn.mockRestore();
    });

    it('lifts every row of a party in one go when the lift names all of their addresses', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ phone: SAM.phone, scope: 'marketing', source: 'inbound_keyword', messageId: 's1' }, store);
        await recordOptOut({ email: 'sam.work@example.com', scope: 'all', source: 'manual' }, store);
        await recordOptOut({ phone: ALEX.phone, scope: 'all', source: 'manual' }, store);

        const lifted = await revokeOptOut(liftAddressOf(['07700 900942', 'Sam.Work@example.com']), 'human:ben@example.com', 'opted back in', store);
        expect(lifted).toEqual({ revoked: 2, notLifted: [] });
        expect(await blockedByOptOut(SAM.phone, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut({ emails: ['sam.work@example.com'] }, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut(ALEX.phone, 'marketing', store)).toMatchObject({ scope: 'all' });
    });

    it('never widens to a shared address: lifting one party leaves the other party opted out', async () => {
        const store = memoryOptOutStore();
        const [xRow, yRow] = await seed(store, [['7700900950', SHARED_EMAIL], ['7700900951', SHARED_EMAIL]]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const lifted = await revokeOptOut(liftAddressOf(['07700 900950', SHARED_EMAIL]), 'human:ben@example.com', 'opted back in', store);
        expect(lifted.revoked).toBe(1);
        expect(lifted.notLifted.map((n) => [n.record.id, n.alsoCarries])).toEqual([[yRow, ['•••951']]]);
        warn.mockRestore();
        expect(store.rows.find((r) => r.id === xRow)!.revokedAt).not.toBeNull();
        expect(await blockedByOptOut('07700 900950', 'marketing', store)).toBeNull();
        expect(await blockedByOptOut('07700 900951', 'marketing', store)).toMatchObject({ id: yRow });
        expect(await blockedByOptOut({ emails: [SHARED_EMAIL] }, 'marketing', store)).toMatchObject({ id: yRow });
    });

    it('lifts nothing by the address two parties share, and reports both rows', async () => {
        const store = memoryOptOutStore();
        await seed(store, [['7700900950', SHARED_EMAIL], ['7700900951', SHARED_EMAIL]]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const lifted = await revokeOptOut({ emails: [SHARED_EMAIL] }, 'human:ben@example.com', undefined, store);
        expect(lifted.revoked).toBe(0);
        expect(lifted.notLifted.map((n) => n.alsoCarries)).toEqual([['•••950'], ['•••951']]);
        expect(await blockedByOptOut('07700 900950', 'marketing', store)).not.toBeNull();
        expect(await blockedByOptOut('07700 900951', 'marketing', store)).not.toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('lifts a phone-only row by the phone, and reports the row that carries an email too', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ phone: PHONE_ONLY.phone, scope: 'marketing', source: 'inbound_keyword', messageId: 'l1' }, store);
        await recordOptOut({ phone: PHONE_ONLY.phone, email: 'pat@example.com', scope: 'all', source: 'manual' }, store);
        const [legacy, withEmail] = store.rows;
        expect([legacy.phoneKey, legacy.emailKey]).toEqual(['7700900944', null]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const first = await revokeOptOut(PHONE_ONLY.phone, 'human:ben@example.com', undefined, store);
        expect(first.revoked).toBe(1);
        expect(legacy.revokedAt).not.toBeNull();
        expect(first.notLifted).toEqual([{ record: expect.objectContaining({ id: withEmail.id }), alsoCarries: ['p•••@example.com'] }]);
        expect(await blockedByOptOut(PHONE_ONLY.phone, 'marketing', store)).toMatchObject({ id: withEmail.id });
        warn.mockRestore();
    });

    it('reads an ops lift argument with an @ as an email and anything else as a phone', () => {
        expect(optOutKeysOf(liftAddressOf(['+447700900942', 'Sam@Example.com', '07700 900943'])))
            .toEqual({ phoneKeys: ['7700900942', '7700900943'], emailKeys: ['sam@example.com'] });
    });
});
