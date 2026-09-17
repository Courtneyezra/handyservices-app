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
 * A homeowner with no customer record yet is looked up in the CRM (`resolveKnown`, through the
 * `known` lookup service/customer-record.ts supplies), so a customer the business already holds is
 * a known customer with their client record's id, not a new homeowner.
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

/** The CRM clients a key names (service/customer-record.ts `knownCustomer`). */
export type KnownCustomerLookup = (key: CanonicalKey) => Promise<Array<{ customerId: string; name: string | null }>>;

export interface IdentityOptions {
    directory?: IdentityDirectory;
    newId?: () => string;
    /** The CRM lookup for a known customer. Unset, nobody is looked up and a fresh key is a new homeowner. */
    known?: KnownCustomerLookup;
    log?: (line: string) => void;
}

export class Identity {
    readonly directory: IdentityDirectory;
    private readonly newId: () => string;
    private readonly known: KnownCustomerLookup | null;
    private readonly log: (line: string) => void;

    constructor(opts: IdentityOptions = {}) {
        this.directory = opts.directory ?? new MemoryIdentityDirectory();
        this.newId = opts.newId ?? (() => `person_${randomUUID()}`);
        this.known = opts.known ?? null;
        this.log = opts.log ?? (() => undefined);
    }

    canonical(raw: string | null | undefined): CanonicalKey | null { return canonical(raw); }

    /**
     * Resolve an address on a channel to one person and a role. Refuses when the address matches
     * two different people, when the address matches nobody and only a key the turn asserts names
     * someone (`namedByAssertedKey`: those are candidates for Ben, never a silent bind), and when
     * Ben's own handset or a staff number would resolve as a customer (an internal key always
     * resolves internal, first in the order, so it never becomes a customer).
     */
    resolve(channel: ChannelKind, address: string, hints: ResolveHints = {}): ResolveResult {
        const key = canonical(address) ?? (channel === 'email' ? null : canonical(hints.phone)) ?? canonical(hints.email);
        if (!key) return { ok: false, reason: 'not_an_address', detail: `the ${channel} address is not a phone or an email` };
        const matches = this.directory.byKey(key);
        const distinct = new Map(matches.map((p) => [p.id, p]));
        if (distinct.size > 1) return { ok: false, reason: 'candidates', candidates: Array.from(distinct.values()) };
        let person = matches[0] ?? null;
        let isNew = false;
        if (!person) {
            const asserted = this.namedByAssertedKey(key, hints);
            if (asserted.length) return { ok: false, reason: 'candidates', candidates: asserted };
            // A fresh key is a new homeowner here; `resolveKnown` looks it up in the CRM.
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
     * `resolve`, then the known-customer step of the role order: a homeowner with no customer
     * record yet is looked up in the CRM by the key the turn arrived on (never a key the turn only
     * asserts), and bound to the client when exactly one answers. Two clients for one key are
     * Ben's to tell apart, so neither is bound and the desk reads no record. A lookup that fails
     * leaves the person as they were: the desk answers as it would for a new customer, and says so
     * in the log. A person already bound is not looked up again.
     *
     * Synchronous when nothing is to be looked up and no lookup for the same person is still
     * running, so a turn lands on its file in the order it arrived; otherwise one person's lookups
     * finish in the order they were asked, and a turn that waited on an earlier lookup sees what it
     * bound.
     */
    resolveKnown(channel: ChannelKind, address: string, hints: ResolveHints = {}): ResolveResult | Promise<ResolveResult> {
        const r = this.resolve(channel, address, hints);
        if (!r.ok) return r;
        const id = r.personId;
        const pending = this.lookups.get(id);
        if (!pending && !this.wantsLookup(r)) return r;
        const entry = { done: Promise.resolve() as Promise<unknown> };
        const run = (async () => {
            try {
                await pending?.done;
                return await this.recognise(r);
            } finally {
                // Cleared before the caller resumes, so a person's next turn is synchronous again once nothing is running.
                if (this.lookups.get(id) === entry) this.lookups.delete(id);
            }
        })();
        entry.done = run.catch(() => undefined);
        this.lookups.set(id, entry);
        return run;
    }

    /** Each person's newest lookup, which the next one for them waits on. */
    private readonly lookups = new Map<string, { done: Promise<unknown> }>();

    private wantsLookup(r: Extract<ResolveResult, { ok: true }>): boolean {
        return r.role === 'homeowner' && !r.customerId && !!this.known;
    }

    private async recognise(r: Extract<ResolveResult, { ok: true }>): Promise<ResolveResult> {
        const person = this.directory.byId(r.personId);
        if (!person) return r;
        // An earlier lookup for this person may have bound them while this turn waited.
        const now = { ...r, customerId: person.customerId, name: person.name ?? r.name };
        if (!this.wantsLookup(now)) return now;
        let found: Array<{ customerId: string; name: string | null }>;
        try {
            found = await this.known!(r.canonical);
        } catch (e: any) {
            this.log(`identity: the customer record could not be read, so the person stays unknown to it (${e?.message ?? e})`);
            return now;
        }
        const ids = new Map(found.map((c) => [c.customerId, c]));
        if (ids.size !== 1) {
            if (ids.size > 1) this.log(`identity: ${ids.size} customer records carry this ${r.canonical.split(':')[0]}; none is bound`);
            return now;
        }
        const client = Array.from(ids.values())[0];
        const latest = this.directory.byId(r.personId) ?? person;
        const bound: Person = { ...latest, customerId: client.customerId, name: latest.name ?? client.name };
        this.directory.upsert(bound);
        return { ...now, customerId: bound.customerId, name: bound.name, isNew: false };
    }

    /**
     * The people another key on the same turn only asserts, when the turn's own address matches
     * nobody. A hint key is free text the sender typed about themselves - the web form's email
     * above all - so it is never proof of who they are. Binding on it alone would append a
     * stranger's enquiry to the file of whoever holds a shared household address, or the address a
     * typo lands on, and the reply, composed from that whole thread, could then be addressed to
     * that stranger's phone. So the turn is held as candidates for Ben, exactly as an address
     * matching two people is (Contract 1).
     *
     * Binding without asking happens only where the turn's own keys corroborate, which is the match
     * above this: a form whose phone the business already knows lands on that person's file, and
     * the email it asserts is linked to them on the way past.
     */
    private namedByAssertedKey(key: CanonicalKey, hints: ResolveHints): Person[] {
        const named = new Map<string, Person>();
        for (const raw of [hints.phone, hints.email]) {
            const other = canonical(raw);
            if (!other || other === key) continue;
            for (const p of this.directory.byKey(other)) named.set(p.id, p);
        }
        return Array.from(named.values());
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
