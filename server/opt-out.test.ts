/**
 * The opt-out ledger matches on the email address as a second key, so an opt-out holds on every
 * channel whichever address it arrived on: a STOP by phone blocks email to the party's address, an
 * opt-out recorded against an email blocks it, a party that never opted out is unaffected, and a
 * phone-only party is matched exactly as before. Runs on the in-memory store; nothing is sent.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));

import { blockedByOptOut, getOptOut, liftAddressOf, optOutEmailKey, optOutKeysOf, optOutRefusalMessage, recordOptOut, revokeOptOut, strongestOptOut } from './opt-out';
import { memoryOptOutStore, type MemoryOptOutStore } from './__tests__/opt-out-memory-store';

const SAM = { id: 'lead_sam', phone: '07700 900942', email: 'Sam.Tester@Example.com' };
const ALEX = { id: 'lead_alex', phone: '+447700900943', email: 'alex@example.com' };
const PHONE_ONLY = { id: 'lead_pat', phone: '07700900944', email: null };

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

describe('a STOP by phone', () => {
    it('blocks email to the address on file for that party, whichever lead or conversation carries it', async () => {
        const store = memoryOptOutStore([SAM, ALEX]);
        const r = await recordOptOut({ phone: '447700900942@c.us', scope: 'marketing', source: 'inbound_keyword', channel: 'whatsapp', messageId: 'm1', matchedKeyword: 'stop', triggerText: 'STOP' }, store);
        expect(r).toMatchObject({ created: true, key: '7700900942', keys: { phoneKeys: ['7700900942'], emailKeys: ['sam.tester@example.com'] } });
        expect(store.rows).toHaveLength(1);
        expect(store.rows[0]).toMatchObject({ phoneKey: '7700900942', emailKey: 'sam.tester@example.com', e164: '+447700900942' });

        expect(await blockedByOptOut({ emails: ['sam.tester@example.com'] }, 'marketing', store)).toMatchObject({ scope: 'marketing' });
        // A plain STOP still lets a service reply through, on email as on the phone.
        expect(await blockedByOptOut({ emails: ['sam.tester@example.com'] }, 'service_reply', store)).toBeNull();
        // Another party is untouched.
        expect(await blockedByOptOut({ phones: [ALEX.phone], emails: [ALEX.email] }, 'marketing', store)).toBeNull();
    });

    it('covers the email on the lead the conversation is linked to, even under a different number', async () => {
        const store = memoryOptOutStore([{ id: 'lead_sam_old', phone: '07700 900945', email: 'sam@example.com' }], { conv_1: 'lead_sam_old' });
        await recordOptOut({ phone: '+447700900942', scope: 'all', source: 'inbound_keyword', conversationId: 'conv_1', messageId: 'm2' }, store);
        expect(await blockedByOptOut({ emails: ['sam@example.com'] }, 'service_reply', store)).toMatchObject({ scope: 'all' });
        // The lead's own number is covered too, on a row of its own.
        expect(await blockedByOptOut('07700900945', 'service_reply', store)).toMatchObject({ scope: 'all' });
        expect(store.rows.map((x) => [x.phoneKey, x.emailKey, x.messageId])).toEqual([
            ['7700900942', 'sam@example.com', 'm2'],
            ['7700900945', null, null],
        ]);
    });

    it('writes one row per further email on file, and a redelivered message writes nothing', async () => {
        const store = memoryOptOutStore([SAM, { id: 'lead_sam_2', phone: '+447700900942', email: 'sam.work@example.com' }]);
        const first = await recordOptOut({ phone: '07700900942', scope: 'all', source: 'inbound_keyword', messageId: 'm3' }, store);
        const again = await recordOptOut({ phone: '07700900942', scope: 'all', source: 'inbound_keyword', messageId: 'm3' }, store);
        expect([first.created, again.created]).toEqual([true, false]);
        expect(store.rows.map((x) => [x.phoneKey, x.emailKey])).toEqual([
            ['7700900942', 'sam.tester@example.com'],
            [null, 'sam.work@example.com'],
        ]);
        expect(await blockedByOptOut({ emails: ['sam.work@example.com'] }, 'marketing', store)).toMatchObject({ scope: 'all' });
    });

    it('keeps the recorded opt-out when a further address cannot be written, and says so', async () => {
        const store = memoryOptOutStore([SAM, { id: 'lead_sam_2', phone: '07700 900945', email: 'sam.work@example.com' }], { conv_2: 'lead_sam_2' });
        const insert = store.insert;
        store.insert = async (row) => {
            if (row.phoneKey === '7700900945') throw new Error('connection reset');
            return insert(row);
        };
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const r = await recordOptOut({ phone: '07700900942', scope: 'all', source: 'inbound_keyword', conversationId: 'conv_2', messageId: 'm4' }, store);
        expect(r).toMatchObject({ created: true, key: '7700900942' });
        expect(r.id).toBe(store.rows[0].id);
        expect(store.rows.map((x) => [x.phoneKey, x.emailKey])).toEqual([
            ['7700900942', 'sam.tester@example.com'],
            [null, 'sam.work@example.com'],
        ]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining(r.id!), 'connection reset');
        errors.mockRestore();
    });

    it('still records the phone when the addresses on file cannot be read', async () => {
        const store = memoryOptOutStore([SAM]);
        store.leadsOn = async () => { throw new Error('connection reset'); };
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const r = await recordOptOut({ phone: '07700900942', scope: 'marketing', source: 'manual' }, store);
        expect(r.created).toBe(true);
        expect(store.rows[0]).toMatchObject({ phoneKey: '7700900942', emailKey: null });
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();
    });
});

describe('an opt-out recorded against an email', () => {
    it('blocks that address, and the phone on file for the party', async () => {
        const store = memoryOptOutStore([ALEX]);
        const r = await recordOptOut({ email: ' ALEX@example.com', scope: 'all', source: 'manual', channel: 'email', note: 'asked by email' }, store);
        expect(r).toMatchObject({ created: true, key: '7700900943' });
        expect(store.rows[0]).toMatchObject({ phoneKey: '7700900943', emailKey: 'alex@example.com', channel: 'email' });
        expect(await blockedByOptOut({ emails: ['alex@example.com'] }, 'service_reply', store)).toMatchObject({ scope: 'all' });
        expect(await blockedByOptOut('+447700900943', 'service_reply', store)).toMatchObject({ scope: 'all' });
    });

    it('with nothing on file, is a row keyed on the email alone', async () => {
        const store = memoryOptOutStore();
        await recordOptOut({ email: 'nobody.known@example.com', scope: 'marketing', source: 'manual' }, store);
        expect(store.rows[0]).toMatchObject({ phoneKey: null, emailKey: 'nobody.known@example.com', e164: null });
        expect(await blockedByOptOut({ emails: ['Nobody.Known@example.com'] }, 'marketing', store)).not.toBeNull();
        expect(await blockedByOptOut({ phones: ['07700900946'], emails: ['nobody.known@example.com'] }, 'marketing', store)).not.toBeNull();
        expect(await blockedByOptOut('07700900946', 'marketing', store)).toBeNull();
    });

    it('is refused with no usable address at all, and nothing is written', async () => {
        const store = memoryOptOutStore();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await recordOptOut({ email: 'not an address', phone: null, scope: 'all', source: 'manual' }, store)).toMatchObject({ created: false, id: null, key: null });
        expect(store.rows).toEqual([]);
        warn.mockRestore();
    });
});

describe('an address two parties are reachable on', () => {
    const X = { id: 'lead_x', phone: '07700 900950', email: 'lettings@example.com' };
    const Y = { id: 'lead_y', phone: '07700 900951', email: 'lettings@example.com' };

    it('never carries one party\'s opt-out: the other stays reachable on their own number and on the shared address', async () => {
        const store = memoryOptOutStore([X, Y]);
        await recordOptOut({ phone: X.phone, scope: 'all', source: 'inbound_keyword', channel: 'whatsapp', messageId: 'x1', matchedKeyword: 'do not contact me' }, store);
        expect(store.rows.map((r) => [r.phoneKey, r.emailKey])).toEqual([['7700900950', null]]);

        expect(await blockedByOptOut(X.phone, 'service_reply', store)).toMatchObject({ scope: 'all' });
        expect(await blockedByOptOut({ phones: [Y.phone], emails: ['lettings@example.com'] }, 'service_reply', store)).toBeNull();
        expect(await blockedByOptOut({ emails: ['lettings@example.com'] }, 'marketing', store)).toBeNull();
    });

    it('is still the key of an opt-out that arrived on it, and pulls in no other party\'s number', async () => {
        const store = memoryOptOutStore([X, Y]);
        await recordOptOut({ email: 'Lettings@example.com', scope: 'all', source: 'manual', channel: 'email' }, store);
        expect(store.rows.map((r) => [r.phoneKey, r.emailKey])).toEqual([[null, 'lettings@example.com']]);

        expect(await blockedByOptOut({ emails: ['lettings@example.com'] }, 'service_reply', store)).toMatchObject({ scope: 'all' });
        expect(await blockedByOptOut(X.phone, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut(Y.phone, 'marketing', store)).toBeNull();
    });

    it('does not stop the party\'s own second address from being covered', async () => {
        const store = memoryOptOutStore([
            { id: 'lead_x', phone: X.phone, email: 'lettings@example.com' },
            { id: 'lead_x_2', phone: X.phone, email: 'x.home@example.com' },
            Y,
        ]);
        await recordOptOut({ phone: X.phone, scope: 'all', source: 'manual' }, store);
        expect(store.rows.map((r) => [r.phoneKey, r.emailKey])).toEqual([['7700900950', 'x.home@example.com']]);
        expect(await blockedByOptOut({ emails: ['x.home@example.com'] }, 'service_reply', store)).toMatchObject({ scope: 'all' });
        expect(await blockedByOptOut({ phones: [Y.phone], emails: ['lettings@example.com'] }, 'service_reply', store)).toBeNull();
    });
});

describe('the refusal a blocked send gives back', () => {
    it('names the row the block comes from and the addresses it is keyed on, masked', async () => {
        const store = memoryOptOutStore([SAM]);
        const recorded = await recordOptOut({ phone: SAM.phone, scope: 'all', source: 'manual' }, store);
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
        const store = memoryOptOutStore([SAM, ALEX]);
        await recordOptOut({ phone: SAM.phone, scope: 'all', source: 'manual' }, store);
        expect(await getOptOut({ phones: [ALEX.phone], emails: [ALEX.email] }, store)).toBeNull();
        expect(await blockedByOptOut({ phones: [ALEX.phone], emails: [ALEX.email] }, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut({ phones: [], emails: [] }, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut(null, 'marketing', store)).toBeNull();
    });
});

describe('phone-only matching', () => {
    it('behaves exactly as before: every format of the number, strongest scope wins, earliest among equals, a plain STOP lets a service reply through', async () => {
        const store = memoryOptOutStore([PHONE_ONLY]);
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
    const X = { id: 'lead_x', phone: '07700 900950', email: 'lettings@example.com' };
    const Y = { id: 'lead_y', phone: '07700 900951', email: 'lettings@example.com' };

    it('lifts only a row whose every address is named', async () => {
        const store = memoryOptOutStore([SAM]);
        await recordOptOut({ phone: SAM.phone, scope: 'all', source: 'manual' }, store);
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

    it('lifts a further-address row only when its address is named, and nobody else', async () => {
        const store = memoryOptOutStore([{ id: 'lead_sam_old', phone: '07700 900945', email: 'sam@example.com' }], { conv_1: 'lead_sam_old' });
        await recordOptOut({ phone: '+447700900942', scope: 'all', source: 'inbound_keyword', conversationId: 'conv_1', messageId: 'm2' }, store);
        await recordOptOut({ phone: ALEX.phone, scope: 'all', source: 'manual' }, store);
        const lifted = await revokeOptOut(liftAddressOf(['+447700900942', 'sam@example.com', '07700 900945']), 'human:ben@example.com', 'opted back in', store);
        expect(lifted).toEqual({ revoked: 2, notLifted: [] });
        expect(await blockedByOptOut('07700900945', 'marketing', store)).toBeNull();
        expect(await blockedByOptOut({ emails: ['sam@example.com'] }, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut(ALEX.phone, 'marketing', store)).toMatchObject({ scope: 'all' });
    });

    // Rows recorded before the ledger stopped spreading onto a shared address still carry one, and
    // so do rows an opt-out arrived on from the shared address itself. The lift rule holds on those.
    const seedShared = async (store: MemoryOptOutStore, rows: Array<[string | null, string | null]>) => {
        const ids: string[] = [];
        for (const [phoneKey, emailKey] of rows) {
            const id = `optout_seed_${ids.length + 1}`;
            await store.insert({ id, phoneKey, emailKey, scope: 'all', source: 'backfill' });
            ids.push(id);
        }
        return ids;
    };

    it('never widens to what is on file: lifting one party leaves another party on a shared email opted out', async () => {
        const store = memoryOptOutStore([X, Y]);
        const [xRow, yRow] = await seedShared(store, [['7700900950', 'lettings@example.com'], ['7700900951', 'lettings@example.com']]);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lifted = await revokeOptOut(liftAddressOf([X.phone, X.email]), 'human:ben@example.com', 'opted back in', store);
        expect(lifted.revoked).toBe(1);
        expect(lifted.notLifted.map((n) => [n.record.id, n.alsoCarries])).toEqual([[yRow, ['•••951']]]);
        warn.mockRestore();
        expect(store.rows.find((r) => r.id === xRow)!.revokedAt).not.toBeNull();
        expect(await blockedByOptOut(X.phone, 'marketing', store)).toBeNull();
        expect(await blockedByOptOut(Y.phone, 'marketing', store)).toMatchObject({ id: yRow });
        expect(await blockedByOptOut({ emails: ['lettings@example.com'] }, 'marketing', store)).toMatchObject({ id: yRow });
    });

    it('lifts nothing by the address two parties share, and reports both rows', async () => {
        const store = memoryOptOutStore([X, Y]);
        await seedShared(store, [['7700900950', 'lettings@example.com'], ['7700900951', 'lettings@example.com']]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const lifted = await revokeOptOut({ emails: ['lettings@example.com'] }, 'human:ben@example.com', undefined, store);
        expect(lifted.revoked).toBe(0);
        expect(lifted.notLifted.map((n) => n.alsoCarries)).toEqual([['•••950'], ['•••951']]);
        expect(await blockedByOptOut(X.phone, 'marketing', store)).not.toBeNull();
        expect(await blockedByOptOut(Y.phone, 'marketing', store)).not.toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('keeps another party opted out when the shared email sits on a further-address row', async () => {
        const store = memoryOptOutStore([X, Y]);
        const [, , yRow] = await seedShared(store, [
            ['7700900950', 'x.home@example.com'],
            [null, 'lettings@example.com'],
            ['7700900951', 'lettings@example.com'],
        ]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const lifted = await revokeOptOut({ emails: ['lettings@example.com'] }, 'human:ben@example.com', undefined, store);
        expect(lifted.revoked).toBe(1);
        expect(lifted.notLifted.map((n) => [n.record.phoneKey, n.alsoCarries])).toEqual([['7700900951', ['•••951']]]);
        expect(await blockedByOptOut(Y.phone, 'service_reply', store)).toMatchObject({ id: yRow, scope: 'all' });
        expect(await blockedByOptOut({ emails: ['lettings@example.com'] }, 'service_reply', store)).toMatchObject({ scope: 'all' });
        warn.mockRestore();
    });

    it('lifts every row of a party with two emails when every address is named', async () => {
        const SAM_TWO = { id: 'lead_sam', phone: '07700 900942', email: 'sam.one@example.com' };
        const store = memoryOptOutStore([SAM_TWO, { id: 'lead_sam_2', phone: '07700 900942', email: 'sam.two@example.com' }]);
        await recordOptOut({ phone: SAM_TWO.phone, scope: 'marketing', source: 'inbound_keyword', messageId: 's1' }, store);
        await recordOptOut({ email: 'sam.two@example.com', scope: 'all', source: 'manual' }, store);
        expect(store.rows.map((x) => [x.phoneKey, x.emailKey])).toEqual([
            ['7700900942', 'sam.one@example.com'],
            [null, 'sam.two@example.com'],
            ['7700900942', 'sam.two@example.com'],
        ]);

        const lifted = await revokeOptOut(liftAddressOf(['07700 900942', 'Sam.One@example.com', 'sam.two@example.com']), 'human:ben@example.com', undefined, store);
        expect(lifted).toEqual({ revoked: 3, notLifted: [] });
        expect(store.rows.every((r) => r.revokedAt)).toBe(true);
        expect(await blockedByOptOut({ phones: [SAM_TWO.phone], emails: ['sam.one@example.com', 'sam.two@example.com'] }, 'marketing', store)).toBeNull();
    });

    it('lifts a legacy phone-only row by the phone, and reports the row that carries an email too', async () => {
        const store = memoryOptOutStore([PHONE_ONLY]);
        await recordOptOut({ phone: PHONE_ONLY.phone, scope: 'marketing', source: 'inbound_keyword', messageId: 'l1' }, store);
        store.leads.push({ id: 'lead_pat_2', phone: PHONE_ONLY.phone, email: 'pat@example.com' });
        await recordOptOut({ phone: PHONE_ONLY.phone, scope: 'all', source: 'manual' }, store);
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
