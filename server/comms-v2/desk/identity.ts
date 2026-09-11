/**
 * Contract 1 - Identity (docs/comms-v2/contracts.md).
 *
 * Turns an address on a channel into a person with a role, before the desk replies. Every turn
 * passes through it; nothing downstream ever sees a raw phone number.
 *
 * Keys follow the convention the customer record already uses (server/clients.ts
 * clientDedupeKey): `phone:<canonical UK national>` or `email:<lowercase>`. The contract's example
 * writes the phone in E.164; the record's convention is the national form, and `canonical` takes
 * either spelling and collapses both to the same key. The E.164 form is what a channel address
 * looks like on the party's channel record, never the identity key.
 *
 * Goal 1: only `homeowner` and `internal` are live. `tenant`, `landlord` and `contractor` exist in
 * the type and return nothing until the landlord service attaches. Role resolution runs in the
 * fixed order internal, contractor, tenant, landlord, known customer, new customer and stops at the
 * first match.
 */
import { randomUUID } from 'node:crypto';
import { canonicalUkPhone, normEmail } from '../../clients';

export type ChannelKind = 'whatsapp' | 'sms' | 'email' | 'call' | 'form';
export type Role = 'homeowner' | 'tenant' | 'landlord' | 'contractor' | 'internal';

/** `phone:0XXXXXXXXXX` or `email:<lowercase>`. */
export type CanonicalKey = `phone:${string}` | `email:${string}`;

export interface Person {
    id: string;
    role: Role;
    /** The customer record this person is, when they are a customer. */
    customerId: string | null;
    name: string | null;
    keys: CanonicalKey[];
    /** For a tenant, later: the property and landlord ids. Null in Goal 1. */
    propertyId: string | null;
    landlordId: string | null;
}

export interface ResolveHints {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    postcode?: string | null;
}

export type ResolveResult =
    | { ok: true; personId: string; customerId: string | null; role: Role; isNew: boolean; canonical: CanonicalKey; propertyId: string | null; landlordId: string | null; name: string | null }
    /** The address matches two different people: no reply may be sent until a person picks one. */
    | { ok: false; reason: 'candidates'; candidates: Person[] }
    | { ok: false; reason: 'not_an_address'; detail: string };

export type LinkResult = { ok: true; person: Person } | { ok: false; reason: string };

/** The one place a key can be looked up. In-memory for Goal 1; a durable one is a later goal. */
export interface IdentityDirectory {
    byKey(key: CanonicalKey): Person[];
    byId(id: string): Person | null;
    upsert(person: Person): void;
    all(): Person[];
    clear(): void;
}

export class MemoryIdentityDirectory implements IdentityDirectory {
    private people = new Map<string, Person>();
    byKey(key: CanonicalKey): Person[] { return Array.from(this.people.values()).filter((p) => p.keys.includes(key)); }
    byId(id: string): Person | null { return this.people.get(id) ?? null; }
    upsert(person: Person): void { this.people.set(person.id, person); }
    all(): Person[] { return Array.from(this.people.values()); }
    clear(): void { this.people.clear(); }
}

/** One canonical key for a phone or an email in any form, or null when it is neither. */
export function canonical(raw: string | null | undefined): CanonicalKey | null {
    if (!raw) return null;
    const s = raw.trim().replace(/^whatsapp:/i, '').replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '');
    if (!s) return null;
    if (s.includes('@')) {
        const e = normEmail(s);
        return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `email:${e}` : null;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length < 7) return null;
    const p = canonicalUkPhone(s);
    return p ? `phone:${p}` : null;
}

/** The E.164 spelling of a phone key, for a channel address. Null for an email key. */
export function e164Of(key: CanonicalKey): string | null {
    if (!key.startsWith('phone:')) return null;
    const national = key.slice('phone:'.length);
    if (national.startsWith('0')) return `+44${national.slice(1)}`;
    if (national.startsWith('44')) return `+${national}`;
    return `+${national}`;
}

const ROLE_ORDER: readonly Role[] = ['internal', 'contractor', 'tenant', 'landlord', 'homeowner'];

export interface IdentityOptions {
    directory?: IdentityDirectory;
    newId?: () => string;
}

export class Identity {
    readonly directory: IdentityDirectory;
    private readonly newId: () => string;

    constructor(opts: IdentityOptions = {}) {
        this.directory = opts.directory ?? new MemoryIdentityDirectory();
        this.newId = opts.newId ?? (() => `person_${randomUUID()}`);
    }

    canonical(raw: string | null | undefined): CanonicalKey | null { return canonical(raw); }

    /**
     * Resolve an address on a channel to one person and a role. Refuses when the address matches
     * two different people, and when Ben's own handset or a staff number would resolve as a customer
     * (an internal key always resolves internal, first in the order, so it never becomes a customer).
     */
    resolve(channel: ChannelKind, address: string, hints: ResolveHints = {}): ResolveResult {
        const key = canonical(address) ?? (channel === 'email' ? null : canonical(hints.phone)) ?? canonical(hints.email);
        if (!key) return { ok: false, reason: 'not_an_address', detail: `the ${channel} address is not a phone or an email` };
        const matches = this.directory.byKey(key);
        const distinct = new Map(matches.map((p) => [p.id, p]));
        if (distinct.size > 1) return { ok: false, reason: 'candidates', candidates: Array.from(distinct.values()) };
        let person = matches[0] ?? this.namedByAnotherKey(key, hints);
        let isNew = false;
        if (!person) {
            // Known customer would be looked up in the CRM here; Goal 1 has no seeded record, so a
            // fresh key is a new homeowner.
            person = { id: this.newId(), role: 'homeowner', customerId: null, name: hints.name?.trim() || null, keys: [key], propertyId: null, landlordId: null };
            isNew = true;
        } else {
            person = { ...person, keys: person.keys.includes(key) ? person.keys : [...person.keys, key], name: person.name || (hints.name?.trim() || null) };
        }
        this.directory.upsert(person);
        const role = ROLE_ORDER.find((r) => r === person!.role) ?? 'homeowner';
        return { ok: true, personId: person.id, customerId: person.customerId, role, isNew, canonical: key, propertyId: person.propertyId, landlordId: person.landlordId, name: person.name };
    }

    /**
     * The person another key on the same turn already names. The web form is the join (Contract 1):
     * a turn that carries a phone and an email together belongs to whichever of them the business
     * already knows, in either order, so no second person is minted for the other key. Two
     * different people across the turn's keys stay two: merging those is Ben's call, through `link`.
     */
    private namedByAnotherKey(key: CanonicalKey, hints: ResolveHints): Person | null {
        const named = new Map<string, Person>();
        for (const raw of [hints.phone, hints.email]) {
            const other = canonical(raw);
            if (!other || other === key) continue;
            for (const p of this.directory.byKey(other)) named.set(p.id, p);
        }
        return named.size === 1 ? Array.from(named.values())[0]! : null;
    }

    /** Two keys belong together, with the evidence. Refused when either already belongs to a different person. */
    link(a: CanonicalKey, b: CanonicalKey, evidence: string): LinkResult {
        if (!evidence.trim()) return { ok: false, reason: 'link needs the evidence the keys belong together' };
        const pa = this.directory.byKey(a);
        const pb = this.directory.byKey(b);
        if (pa.length > 1 || pb.length > 1) return { ok: false, reason: 'a key maps to more than one person' };
        const owner = pa[0] ?? pb[0] ?? null;
        if (pa[0] && pb[0] && pa[0].id !== pb[0].id) return { ok: false, reason: 'the keys belong to two different people; that is Ben\'s call' };
        const person: Person = owner
            ? { ...owner, keys: Array.from(new Set([...owner.keys, a, b])) }
            : { id: this.newId(), role: 'homeowner', customerId: null, name: null, keys: [a, b], propertyId: null, landlordId: null };
        this.directory.upsert(person);
        return { ok: true, person };
    }

    /** Ben's handset, staff and the business's own numbers. Refused when the key is already a customer. */
    registerInternal(key: CanonicalKey, name: string): LinkResult {
        const existing = this.directory.byKey(key);
        if (existing.some((p) => p.role !== 'internal')) return { ok: false, reason: 'the key is already a customer' };
        const person: Person = existing[0] ?? { id: this.newId(), role: 'internal', customerId: null, name, keys: [key], propertyId: null, landlordId: null };
        this.directory.upsert({ ...person, role: 'internal', name: person.name ?? name });
        return { ok: true, person: this.directory.byId(person.id)! };
    }

    /** A known customer, seeded (the door's `seed.customer: known` on POST /start). */
    seedCustomer(key: CanonicalKey, input: { name?: string | null; customerId?: string | null } = {}): Person {
        const existing = this.directory.byKey(key)[0];
        const person: Person = existing ?? { id: this.newId(), role: 'homeowner', customerId: input.customerId ?? `customer_${randomUUID().slice(0, 8)}`, name: input.name ?? null, keys: [key], propertyId: null, landlordId: null };
        this.directory.upsert(person);
        return person;
    }
}
