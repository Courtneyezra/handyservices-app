/**
 * Contract 1 invariants: one canonical key never maps to two people; a person may carry many
 * keys; role order stops at the first match; an internal key never resolves as a customer; two
 * matches are candidates and no reply may be sent.
 */
import { describe, expect, it } from 'vitest';
import { Identity, MemoryIdentityDirectory, canonical, e164Of } from './identity';

describe('canonical', () => {
    it('collapses five spellings of one UK mobile to one key, the record\'s national convention', () => {
        const keys = ['07700 900942', '+447700900942', '447700900942', '0044 7700 900942', 'whatsapp:+447700900942', '447700900942@c.us'].map(canonical);
        expect(new Set(keys).size).toBe(1);
        expect(keys[0]).toBe('phone:07700900942');
    });
    it('lowercases an email and refuses what is neither', () => {
        expect(canonical('  Sam@Example.COM ')).toBe('email:sam@example.com');
        expect(canonical('not an address')).toBeNull();
        expect(canonical('')).toBeNull();
        expect(canonical('12')).toBeNull();
    });
    it('spells a phone key back as E.164 for a channel address', () => {
        expect(e164Of('phone:07700900942')).toBe('+447700900942');
        expect(e164Of('email:sam@example.com')).toBeNull();
    });
});

describe('Identity.resolve', () => {
    it('a fresh address is a new homeowner, and the same address twice is the same person', () => {
        const id = new Identity();
        const a = id.resolve('whatsapp', '+447700900942', { name: 'Sam' });
        const b = id.resolve('whatsapp', '07700 900942');
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(a.isNew).toBe(true);
        expect(b.isNew).toBe(false);
        expect(a.personId).toBe(b.personId);
        expect(a.role).toBe('homeowner');
        expect(b.name).toBe('Sam');
        expect(b.canonical).toBe('phone:07700900942');
    });
    it('refuses an address that is not a phone or an email', () => {
        const r = new Identity().resolve('whatsapp', 'nope');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('not_an_address');
    });
    it('an internal key resolves internal, first in the order, never as a customer', () => {
        const id = new Identity();
        expect(id.registerInternal('phone:07700900001', 'Ben').ok).toBe(true);
        const r = id.resolve('whatsapp', '+447700900001');
        expect(r.ok && r.role).toBe('internal');
        expect(r.ok && r.isNew).toBe(false);
    });
    it('refuses to register a customer key as internal', () => {
        const id = new Identity();
        id.resolve('whatsapp', '+447700900942');
        expect(id.registerInternal('phone:07700900942', 'Ben').ok).toBe(false);
    });
    it('returns candidates, not a person, when a key maps to two people', () => {
        const dir = new MemoryIdentityDirectory();
        dir.upsert({ id: 'p1', role: 'homeowner', customerId: null, name: 'A', keys: ['phone:07700900942'], propertyId: null, landlordId: null });
        dir.upsert({ id: 'p2', role: 'homeowner', customerId: null, name: 'B', keys: ['phone:07700900942'], propertyId: null, landlordId: null });
        const r = new Identity({ directory: dir }).resolve('whatsapp', '+447700900942');
        expect(r.ok).toBe(false);
        if (!r.ok && r.reason === 'candidates') expect(r.candidates.map((c) => c.id).sort()).toEqual(['p1', 'p2']);
    });
});

describe('Identity.link', () => {
    it('joins a phone and an email onto one person with the evidence, and refuses two different people', () => {
        const id = new Identity();
        id.resolve('whatsapp', '+447700900942');
        const linked = id.link('phone:07700900942', 'email:sam@example.com', 'web form gave both');
        expect(linked.ok).toBe(true);
        if (linked.ok) expect(linked.person.keys).toEqual(['phone:07700900942', 'email:sam@example.com']);
        expect(id.resolve('email', 'sam@example.com').ok && (id.resolve('email', 'sam@example.com') as any).isNew).toBe(false);
        id.resolve('sms', '+447700900111');
        expect(id.link('phone:07700900942', 'phone:07700900111', 'a guess').ok).toBe(false);
        expect(id.link('phone:07700900942', 'email:x@y.co', '').ok).toBe(false);
    });
});
