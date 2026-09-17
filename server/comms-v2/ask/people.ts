/**
 * Handy Desk - who Ben is asking about (ask-agent specification N2, answers A4 and A7).
 *
 * `rankPeople` (the `find_people` tool, client-tools.ts) turns a name, a phone number or a company word into ranked candidates, from five
 * sources: the comms-v2 case files on the board, `service_clients`, `leads`, `tenants` and the
 * landlords who own `properties`. It never guesses. There is no company table (answer A7, "Match the
 * word now"), so a company word ("Tena Properties") is matched as whole words on a client's name,
 * tags and internal notes, a lead's name, a tenant's landlord and property, and a landlord's own name
 * and properties. Generic words ("properties", "lettings", "ltd") are dropped when a distinctive one
 * is left, so "Tena Properties" matches the word "tena" and never "tenant".
 *
 * Whether Ben must pick (answer A4, "Several matches, or first time"): always when there are several
 * candidates, and for a single candidate the first time that person comes up in the session. A person
 * is settled once Ben has picked them on a pick card, or a client card has shown them, in this session.
 * A selected card skips the question: a candidate on the selected card's case file is taken as meant.
 *
 * What leaves this file is the candidate: a person ref (`<kind>:<id>`), name, the company as the
 * card may show it (a tag or the landlord's name, never a note), the last three digits of the phone,
 * the outward postcode, the open case file, and the last activity. Notes, email addresses and postal
 * addresses are read only to match or to say "on file", never returned (answers 46 and 47).
 *
 * The database directory reads the app's own database, as every admin page does, and writes nothing.
 * A memory directory stands in for tests.
 */
import type { CaseStage } from '@shared/ops-types';
import type { CaseFile } from '../desk/case-file';
import { customerOf, fileAnswersTo } from './surface';

export const PERSON_KINDS = ['client', 'tenant', 'landlord', 'lead', 'case_file'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];
/** The CRM kinds the directory reads; case files come from the board's store. */
export type DirectoryKind = Exclude<PersonKind, 'case_file'>;

/** Candidates a find returns, and the most a pick card lists. */
export const CANDIDATE_CAP = 5;
/** Rows each source may hand the ranking. */
export const SOURCE_ROW_CAP = 50;

export function personRef(kind: PersonKind, id: string): string {
    return `${kind}:${id}`;
}

export function parsePersonRef(ref: unknown): { kind: PersonKind; id: string } | null {
    if (typeof ref !== 'string') return null;
    const at = ref.indexOf(':');
    if (at <= 0) return null;
    const kind = ref.slice(0, at) as PersonKind;
    const id = ref.slice(at + 1).trim();
    return (PERSON_KINDS as readonly string[]).includes(kind) && id ? { kind, id } : null;
}

/** Where a company word may be found on a row. */
export type CompanyField = 'name' | 'tags' | 'notes' | 'landlord' | 'property' | 'postcode';

/** A CRM person as the directory reads them. Server-side only: the phone and the matched text never reach the model. */
export interface PersonRow {
    kind: DirectoryKind;
    id: string;
    name: string | null;
    phone: string | null;
    /** The service_clients row this person is, or belongs to. */
    clientId: string | null;
    /**
     * Text the company word is matched on. `shown` is what the card may say when this field matched
     * (a tag, a landlord's name); null for text that is never shown, such as a note.
     */
    companyFields: { field: CompanyField; text: string; shown: string | null }[];
    /** The company the card shows when no company word was asked for: a tenant's landlord. */
    company: string | null;
    outwardPostcodes: string[];
    emailOnFile: boolean;
    addressOnFile: boolean;
    lastActivity: string | null;
}

/** One property as a client card lists it: never the address, only its outward postcode. */
export interface PropertyBrief {
    id: string;
    /** service: a service_properties row; landlord: a landlord's properties row. */
    source: 'service' | 'landlord';
    /** The person's relation to it. */
    role: 'client' | 'tenant' | 'landlord';
    outwardPostcode: string | null;
    active: boolean;
}

export interface SearchTerms {
    /** Lowercase words to look for in names and company fields. */
    words: string[];
    /** The last ten digits of a phone number, when the query carries one. */
    digits: string | null;
}

export interface PeopleDirectory {
    /** Rows that may match: a superset, ranked by `findPeople`. */
    search(terms: SearchTerms): Promise<PersonRow[]>;
    get(kind: DirectoryKind, id: string): Promise<PersonRow | null>;
    properties(kind: DirectoryKind, id: string): Promise<PropertyBrief[]>;
}

// ---------------------------------------------------------------- matching

/** Words that name a kind of company rather than a company. */
export const GENERIC_COMPANY_WORDS: ReadonlySet<string> = new Set([
    'the', 'and', 'of', 'properties', 'property', 'lettings', 'letting', 'lets', 'estates', 'estate', 'homes', 'home',
    'housing', 'group', 'management', 'managers', 'ltd', 'limited', 'llp', 'plc', 'co', 'company', 'services',
    'agency', 'agents', 'rentals', 'residential', 'investments', 'holdings', 'uk',
]);

export function words(text: string | null | undefined): string[] {
    return (text ?? '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

export function digitsKey(text: string | null | undefined): string | null {
    const d = (text ?? '').replace(/\D/g, '');
    return d.length >= 7 ? d.slice(-10) : null;
}

/** The outward half of a UK postcode ("NG5 1AB" -> "NG5"), or null. */
export function outwardPostcode(raw: string | null | undefined): string | null {
    const pc = (raw ?? '').toUpperCase().replace(/\s+/g, '');
    if (!pc) return null;
    if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) return pc.slice(0, -3);
    if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(pc)) return pc;
    return null;
}

export interface ParsedQuery {
    /** The person's name words. Empty for a phone or company-only search. */
    name: string[];
    /** The company word as Ben gave it, or null. */
    hint: string | null;
    digits: string | null;
}

/**
 * "Sarah from Tena Properties" -> name "sarah", hint "Tena Properties", unless a hint was given apart.
 * A hint that is a postcode ("Alan Smith in NG5") is matched on the person's outward postcodes.
 */
export function parseQuery(query: string, hint?: string | null): ParsedQuery {
    let q = query.trim();
    let h = hint?.trim() || null;
    if (!h) {
        const m = q.match(/^(.+?)\s+(?:from|at|of|@|in)\s+(.+)$/i);
        if (m) { q = m[1]; h = m[2].trim(); }
    }
    const digits = digitsKey(q);
    const name = words(q.replace(/[\d+()-]/g, ' '));
    return { name, hint: h, digits };
}

/** The words a company match needs: the distinctive ones, or all of them when none is distinctive. */
export function companyWords(hint: string): string[] {
    const all = words(hint);
    const distinct = all.filter((w) => !GENERIC_COMPANY_WORDS.has(w));
    return distinct.length ? distinct : all;
}

/** The field a company word matches as whole words, or null. */
export function companyMatch(row: Pick<PersonRow, 'companyFields'>, hint: string): PersonRow['companyFields'][number] | null {
    const want = companyWords(hint);
    if (!want.length) return null;
    for (const f of row.companyFields) {
        const have = new Set(words(f.text));
        if (want.every((w) => have.has(w))) return f;
    }
    return null;
}

/** 3: every word of the name is the query; 2: every query word is a word of the name; 1: every query word starts one; 0: no match. */
export function nameScore(name: string | null, query: string[]): number {
    if (!query.length) return 0;
    const have = words(name);
    if (!have.length) return 0;
    if (query.every((q) => have.includes(q))) return have.length === query.length ? 3 : 2;
    if (query.every((q) => q.length >= 2 && have.some((w) => w.startsWith(q)))) return 1;
    return 0;
}

// ---------------------------------------------------------------- candidates

/** A person Ben may mean, as the model and the pick card see them. */
export interface PersonCandidate {
    /** The person ref: `<kind>:<id>`. */
    id: string;
    kind: PersonKind;
    name: string | null;
    company: string | null;
    phoneTail: string | null;
    outwardPostcode: string | null;
    /** The open case file for this person on the board, if any. */
    caseFileId: string | null;
    stage: CaseStage | null;
    held: boolean;
    lastActivity: string | null;
    /** Why they matched, in words: "name", "phone", "company word in tags"... */
    matched: string[];
    /** Other refs merged into this one (the same phone, or a lead of the client). */
    alsoAs: string[];
}

interface Scored { c: PersonCandidate; score: number; phoneKey: string | null; clientId: string | null }

const KIND_ORDER: Record<PersonKind, number> = { client: 0, tenant: 1, landlord: 2, lead: 3, case_file: 4 };

const tail = (phone: string | null | undefined): string | null => {
    const d = (phone ?? '').replace(/\D/g, '');
    return d.length >= 3 ? d.slice(-3) : null;
};

const newest = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/** The phone a case file's customer is reached on: a phone channel, else a `phone:` key. */
export function phoneOfFile(file: CaseFile): string | null {
    const party = customerOf(file);
    if (!party) return null;
    const ch = party.channels.find((c) => c.kind === 'whatsapp' || c.kind === 'sms');
    if (ch) return ch.address;
    return party.canonical.startsWith('phone:') ? party.canonical.slice('phone:'.length) : null;
}

const lastAt = (file: CaseFile): string | null => file.turns[file.turns.length - 1]?.at ?? file.openedAt ?? null;

/** The case file a CRM person is on: one naming their client id, else their phone; open files first, then the newest. */
export function fileOfPerson(files: CaseFile[], person: { phone: string | null; clientId: string | null }): CaseFile | null {
    const hits = files.filter((f) =>
        (!!person.clientId && f.turns.some((t) => t.customerId === person.clientId))
        || (!!person.phone && fileAnswersTo(f, person.phone)));
    hits.sort((a, b) => (a.stage === 'done' ? 1 : 0) - (b.stage === 'done' ? 1 : 0) || Date.parse(lastAt(b) ?? '') - Date.parse(lastAt(a) ?? ''));
    return hits[0] ?? null;
}

function fileFields(file: CaseFile | null): Pick<PersonCandidate, 'caseFileId' | 'stage' | 'held'> {
    return file ? { caseFileId: file.id, stage: file.stage as CaseStage, held: !!file.hold } : { caseFileId: null, stage: null, held: false };
}

export interface FindInput {
    query: string;
    hint?: string | null;
    rows: PersonRow[];
    files: CaseFile[];
}

export interface FindOutcome {
    parsed: ParsedQuery;
    /** Ranked, merged, at most CANDIDATE_CAP. */
    candidates: PersonCandidate[];
    total: number;
    /** With a company word: how many matched the name but not the company. */
    nameOnly: number;
}

/** Ranks every row and case file against the query. Pure. */
export function rankPeople(input: FindInput): FindOutcome {
    const parsed = parseQuery(input.query, input.hint);
    const scored: Scored[] = [];
    let nameOnly = 0;

    const consider = (base: Omit<PersonCandidate, 'matched' | 'alsoAs'>, row: Pick<PersonRow, 'companyFields' | 'phone' | 'clientId' | 'outwardPostcodes'>) => {
        const matched: string[] = [];
        let score = 0;
        const rowDigits = digitsKey(row.phone);
        const byPhone = !!parsed.digits && !!rowDigits && (rowDigits === parsed.digits || (parsed.digits.length < 10 && rowDigits.endsWith(parsed.digits)));
        if (byPhone) { matched.push('phone'); score += 40; }
        const ns = nameScore(base.name, parsed.name);
        let company = base.company;
        if (parsed.name.length) {
            if (ns) { matched.push('name'); score += ns * 10; }
            else if (!parsed.hint && !byPhone) {
                // A query that names nobody may be the company itself.
                const f = companyMatch(row, parsed.name.join(' '));
                if (!f) return;
                matched.push(`company word in ${f.field}`);
                company = f.shown ?? company;
                score += 5;
            } else if (!byPhone) return;
        } else if (!byPhone && !parsed.hint) return;
        if (parsed.hint) {
            const area = outwardPostcode(parsed.hint);
            const f = companyMatch(row, parsed.hint)
                ?? (area && row.outwardPostcodes.includes(area) ? { field: 'postcode' as const, text: area, shown: null } : null);
            if (!f && !byPhone) {
                nameOnly += 1;
                return;
            }
            if (f) {
                matched.push(`company word in ${f.field}`);
                company = f.shown ?? company ?? (f.field === 'postcode' ? null : parsed.hint);
                score += 5;
            }
        }
        if (base.caseFileId) score += 1;
        scored.push({ c: { ...base, company, matched, alsoAs: [] }, score, phoneKey: rowDigits, clientId: row.clientId });
    };

    for (const row of input.rows) {
        const file = fileOfPerson(input.files, row);
        consider({
            id: personRef(row.kind, row.id), kind: row.kind, name: row.name, company: row.company,
            phoneTail: tail(row.phone), outwardPostcode: row.outwardPostcodes[0] ?? null,
            ...fileFields(file), lastActivity: newest(row.lastActivity, file ? lastAt(file) : null),
        }, row);
    }
    for (const file of input.files) {
        const party = customerOf(file);
        if (!party) continue;
        const phone = phoneOfFile(file);
        consider({
            id: personRef('case_file', file.id), kind: 'case_file', name: party.name, company: null,
            phoneTail: tail(phone), outwardPostcode: outwardPostcode(file.job.location),
            ...fileFields(file), lastActivity: lastAt(file),
        }, { companyFields: party.name ? [{ field: 'name', text: party.name, shown: null }] : [], phone, clientId: null, outwardPostcodes: [outwardPostcode(file.job.location)].filter((x): x is string => !!x) });
    }

    // One person, one row: the same phone, or a lead or file of a client, merges into the first by kind.
    scored.sort((a, b) => KIND_ORDER[a.c.kind] - KIND_ORDER[b.c.kind]);
    const merged: Scored[] = [];
    for (const s of scored) {
        const into = merged.find((m) =>
            (!!s.phoneKey && s.phoneKey === m.phoneKey)
            || (!!s.clientId && s.clientId === m.clientId)
            || (s.c.kind === 'case_file' && m.c.caseFileId === s.c.caseFileId && m.c.kind !== 'case_file'));
        if (!into) { merged.push(s); continue; }
        into.c.alsoAs.push(s.c.id);
        into.score = Math.max(into.score, s.score);
        for (const why of s.c.matched) if (!into.c.matched.includes(why)) into.c.matched.push(why);
        into.c.company ??= s.c.company;
        into.c.outwardPostcode ??= s.c.outwardPostcode;
        into.c.name ??= s.c.name;
        into.c.lastActivity = newest(into.c.lastActivity, s.c.lastActivity);
        if (!into.c.caseFileId && s.c.caseFileId) Object.assign(into.c, { caseFileId: s.c.caseFileId, stage: s.c.stage, held: s.c.held });
    }
    merged.sort((a, b) => b.score - a.score || Date.parse(b.c.lastActivity ?? '') - Date.parse(a.c.lastActivity ?? '') || 0);
    // Only the strongest name matches stand when some are exact: "Alan Smith" does not list "Alana Smithers".
    const best = merged.length ? Math.floor(merged[0].score / 10) : 0;
    const kept = best >= 2 ? merged.filter((m) => Math.floor(m.score / 10) >= 2 || m.c.matched.includes('phone')) : merged;
    return { parsed, candidates: kept.slice(0, CANDIDATE_CAP).map((m) => m.c), total: kept.length, nameOnly };
}

// ---------------------------------------------------------------- whether Ben must pick

/** What one ask run knows about people: whom it may act on, the picks waiting, and the cards it read. */
export interface RunPeople {
    /** Person refs settled for this run: from the session, the selected card, and finds that needed no pick. */
    settled: Set<string>;
    /** Pick cards waiting on Ben, oldest first; the answer shows the first. */
    picks: import('@shared/ops-types').PickSurface[];
    /** Client cards this run read, by ref. */
    cards: Map<string, import('@shared/ops-types').ClientSurface>;
    lastCard: string | null;
}

export function newRunPeople(settled: Iterable<string> = []): RunPeople {
    return { settled: new Set(settled), picks: [], cards: new Map(), lastCard: null };
}

export interface PickRule {
    /** Refs settled in this session: picked by Ben, or shown on a client card. */
    settled: ReadonlySet<string>;
    /** The case file of the card Ben has selected, if any. */
    selectedCaseFileId: string | null;
}

const refsOf = (c: PersonCandidate): string[] => [c.id, ...c.alsoAs];

/** A candidate is settled when any ref it carries is. */
export function isSettled(c: PersonCandidate, settled: ReadonlySet<string>): boolean {
    return refsOf(c).some((r) => settled.has(r));
}

export type PickDecision =
    | { status: 'none' }
    | { status: 'found'; person: PersonCandidate; why: 'settled' | 'selected card' }
    | { status: 'pick'; question: string };

/** Answer A4: several matches, or the first time a single one comes up; the selected card is taken as meant. */
export function pickDecision(outcome: FindOutcome, rule: PickRule): PickDecision {
    const cs = outcome.candidates;
    if (!cs.length) return { status: 'none' };
    if (rule.selectedCaseFileId) {
        const onCard = cs.filter((c) => c.caseFileId === rule.selectedCaseFileId);
        if (onCard.length === 1) return { status: 'found', person: onCard[0], why: 'selected card' };
    }
    if (cs.length === 1 && isSettled(cs[0], rule.settled)) return { status: 'found', person: cs[0], why: 'settled' };
    return { status: 'pick', question: pickQuestion(outcome) };
}

export function pickQuestion(outcome: FindOutcome): string {
    const cs = outcome.candidates;
    const who = outcome.parsed.name.length ? outcome.parsed.name.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'this';
    const at = outcome.parsed.hint ? ` at ${outcome.parsed.hint}` : '';
    if (cs.length === 1) {
        const c = cs[0];
        return `Did you mean ${c.name ?? 'this person'}${c.company ? ` at ${c.company}` : ''}?`;
    }
    const n = outcome.total > cs.length ? `${outcome.total} matches` : `${cs.length} matches`;
    return `${n} for ${who}${at}. Which one?`;
}

// ---------------------------------------------------------------- directories

export function searchTerms(parsed: ParsedQuery): SearchTerms {
    const all = [...parsed.name, ...(parsed.hint ? companyWords(parsed.hint) : [])];
    return { words: Array.from(new Set(all.filter((w) => w.length >= 2))), digits: parsed.digits };
}

/** A directory over rows a test gives. */
export class MemoryPeopleDirectory implements PeopleDirectory {
    readonly searches: SearchTerms[] = [];
    constructor(readonly rows: PersonRow[] = [], readonly props: Record<string, PropertyBrief[]> = {}) {}
    async search(terms: SearchTerms) {
        this.searches.push(terms);
        return this.rows;
    }
    async get(kind: DirectoryKind, id: string) {
        return this.rows.find((r) => r.kind === kind && r.id === id) ?? null;
    }
    async properties(kind: DirectoryKind, id: string) {
        return this.props[personRef(kind, id)] ?? [];
    }
}

const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

type LoadPick = { terms: SearchTerms } | { kind: DirectoryKind; id: string };

/**
 * The rows a search or a single ref names, each source shaped the same way. A search prefilters with
 * ILIKE on its words and a digits match on the phone, capped at SOURCE_ROW_CAP per source.
 */
async function loadRows(pick: LoadPick): Promise<PersonRow[]> {
    const { db } = await import('../../db');
    const s = await import('@shared/schema');
    const { and, eq, ilike, inArray, isNull, or, sql } = await import('drizzle-orm');
    const terms = 'terms' in pick ? pick.terms : null;
    const like = (col: any) => (terms ? terms.words.map((w) => ilike(col, `%${w}%`)) : []);
    const phoneIs = (col: any) => (terms?.digits ? [sql`right(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), ${terms.digits.length}) = ${terms.digits}`] : []);
    const anyOf = (conds: any[]) => (conds.length ? or(...conds)! : sql`false`);
    const wants = (kinds: DirectoryKind[]) => !('kind' in pick) || kinds.includes(pick.kind);
    const idOf = 'kind' in pick ? pick.id : '';

    const c = s.serviceClients;
    const l = s.leads;
    const t = s.tenants;
    const p = s.properties;
    const sp = s.serviceProperties;

    const [clientRows, leadRows, tenantRows] = await Promise.all([
        wants(['client']) ? db.select({
            id: c.id, name: c.displayName, primaryPhone: c.primaryPhone, phones: c.phones, tags: c.tags, notes: c.notes,
            hasEmail: sql<boolean>`(${c.primaryEmail} is not null or coalesce(jsonb_array_length(case when jsonb_typeof(${c.emails}) = 'array' then ${c.emails} end), 0) > 0)`,
            hasAddress: sql<boolean>`(${c.billingAddress} is not null and btrim(${c.billingAddress}) <> '')`,
            updatedAt: c.updatedAt,
        }).from(c).where(and(isNull(c.archivedAt), terms ? anyOf([
            ...like(c.displayName), ...like(sql`${c.tags}::text`), ...like(c.notes),
            ...phoneIs(c.primaryPhone), ...(terms.digits ? [ilike(sql`${c.phones}::text`, `%${terms.digits}%`)] : []),
        ]) : eq(c.id, idOf))).limit(SOURCE_ROW_CAP) : Promise.resolve([]),
        wants(['lead', 'landlord']) ? db.select({
            id: l.id, name: l.customerName, phone: l.phone, clientId: l.clientId, postcode: l.postcode,
            hasEmail: sql<boolean>`(${l.email} is not null and btrim(${l.email}) <> '')`,
            hasAddress: sql<boolean>`coalesce(${l.address}, ${l.addressCanonical}, ${l.addressRaw}) is not null`,
            at: sql<Date>`coalesce(${l.updatedAt}, ${l.createdAt})`,
        }).from(l).where(terms ? and(isNull(l.mergedIntoId), anyOf([...like(l.customerName), ...phoneIs(l.phone)])) : eq(l.id, idOf)).limit(SOURCE_ROW_CAP) : Promise.resolve([]),
        wants(['tenant']) ? db.select({
            id: t.id, name: t.name, phone: t.phone,
            hasEmail: sql<boolean>`(${t.email} is not null and btrim(${t.email}) <> '')`,
            at: sql<Date>`coalesce(${t.lastContactAt}, ${t.updatedAt})`,
            postcode: p.postcode, nickname: p.nickname, propertyNotes: p.notes, landlordName: l.customerName,
        }).from(t).innerJoin(p, eq(t.propertyId, p.id)).innerJoin(l, eq(p.landlordLeadId, l.id))
            .where(terms
                ? and(eq(t.isActive, true), anyOf([...like(t.name), ...phoneIs(t.phone), ...like(l.customerName), ...like(p.nickname), ...like(p.notes)]))
                : eq(t.id, idOf))
            .limit(SOURCE_ROW_CAP) : Promise.resolve([]),
    ]);

    const leadIds = leadRows.map((r) => r.id);
    const clientIds = clientRows.map((r) => r.id);
    const [owned, clientProps] = await Promise.all([
        leadIds.length ? db.select({ leadId: p.landlordLeadId, postcode: p.postcode, nickname: p.nickname, notes: p.notes }).from(p).where(and(inArray(p.landlordLeadId, leadIds), eq(p.isActive, true))) : Promise.resolve([]),
        clientIds.length ? db.select({ clientId: sp.clientId, postcode: sp.postcode }).from(sp).where(inArray(sp.clientId, clientIds)) : Promise.resolve([]),
    ]);

    const rows: PersonRow[] = [];
    for (const r of clientRows) {
        const name = txt(r.name);
        const notes = txt(r.notes);
        const props = clientProps.filter((x) => x.clientId === r.id);
        rows.push({
            kind: 'client', id: r.id, name, phone: txt(r.primaryPhone) ?? list(r.phones)[0] ?? null, clientId: r.id,
            companyFields: [
                ...(name ? [{ field: 'name' as const, text: name, shown: null }] : []),
                ...list(r.tags).map((tag) => ({ field: 'tags' as const, text: tag, shown: tag })),
                ...(notes ? [{ field: 'notes' as const, text: notes, shown: null }] : []),
            ],
            company: null,
            outwardPostcodes: props.map((x) => outwardPostcode(x.postcode)).filter((x): x is string => !!x),
            emailOnFile: !!r.hasEmail, addressOnFile: !!r.hasAddress || props.length > 0,
            lastActivity: iso(r.updatedAt),
        });
    }
    for (const r of leadRows) {
        const name = txt(r.name);
        const props = owned.filter((x) => x.leadId === r.id);
        rows.push({
            kind: props.length ? 'landlord' : 'lead', id: r.id, name, phone: txt(r.phone), clientId: r.clientId ?? null,
            companyFields: [
                ...(name ? [{ field: 'name' as const, text: name, shown: null }] : []),
                ...props.flatMap((x) => [txt(x.nickname), txt(x.notes)].filter((v): v is string => !!v).map((v) => ({ field: 'property' as const, text: v, shown: null }))),
            ],
            company: null,
            outwardPostcodes: [outwardPostcode(r.postcode), ...props.map((x) => outwardPostcode(x.postcode))].filter((x): x is string => !!x),
            emailOnFile: !!r.hasEmail, addressOnFile: !!r.hasAddress || props.length > 0,
            lastActivity: iso(r.at),
        });
    }
    for (const r of tenantRows) {
        const landlord = txt(r.landlordName);
        rows.push({
            kind: 'tenant', id: r.id, name: txt(r.name), phone: txt(r.phone), clientId: null,
            companyFields: [
                ...(txt(r.name) ? [{ field: 'name' as const, text: r.name, shown: null }] : []),
                ...(landlord ? [{ field: 'landlord' as const, text: landlord, shown: landlord }] : []),
                ...[txt(r.nickname), txt(r.propertyNotes)].filter((v): v is string => !!v).map((v) => ({ field: 'property' as const, text: v, shown: null })),
            ],
            company: landlord,
            outwardPostcodes: [outwardPostcode(r.postcode)].filter((x): x is string => !!x),
            // A tenant's address is the property they rent.
            emailOnFile: !!r.hasEmail, addressOnFile: true,
            lastActivity: iso(r.at),
        });
    }
    return rows;
}

/** The CRM through the app's database, as every admin page reads it. Read only. */
export const databasePeopleDirectory: PeopleDirectory = {
    async search(terms) {
        if (!terms.words.length && !terms.digits) return [];
        return loadRows({ terms });
    },

    async get(kind, id) {
        // A lead's ref stays good once the lead owns a property, and the other way round.
        const rows = await loadRows({ kind, id });
        return rows.find((r) => r.id === id && (r.kind === kind || (kind !== 'client' && kind !== 'tenant' && (r.kind === 'lead' || r.kind === 'landlord')))) ?? null;
    },

    async properties(kind, id) {
        const { db } = await import('../../db');
        const s = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const sp = s.serviceProperties;
        const p = s.properties;
        let clientId: string | null = kind === 'client' ? id : null;
        if (kind === 'lead' || kind === 'landlord') {
            const [lead] = await db.select({ clientId: s.leads.clientId }).from(s.leads).where(eq(s.leads.id, id)).limit(1);
            clientId = lead?.clientId ?? null;
        }
        const out: PropertyBrief[] = [];
        if (clientId) {
            const rows = await db.select({ id: sp.id, postcode: sp.postcode }).from(sp).where(eq(sp.clientId, clientId)).limit(SOURCE_ROW_CAP);
            out.push(...rows.map((r) => ({ id: r.id, source: 'service' as const, role: 'client' as const, outwardPostcode: outwardPostcode(r.postcode), active: true })));
        }
        if (kind === 'tenant') {
            const rows = await db.select({ id: p.id, postcode: p.postcode, active: p.isActive })
                .from(s.tenants).innerJoin(p, eq(s.tenants.propertyId, p.id)).where(eq(s.tenants.id, id)).limit(1);
            out.push(...rows.map((r) => ({ id: r.id, source: 'landlord' as const, role: 'tenant' as const, outwardPostcode: outwardPostcode(r.postcode), active: r.active })));
        }
        if (kind === 'lead' || kind === 'landlord') {
            const rows = await db.select({ id: p.id, postcode: p.postcode, active: p.isActive }).from(p).where(eq(p.landlordLeadId, id)).limit(SOURCE_ROW_CAP);
            out.push(...rows.map((r) => ({ id: r.id, source: 'landlord' as const, role: 'landlord' as const, outwardPostcode: outwardPostcode(r.postcode), active: r.active })));
        }
        return out;
    },
};
