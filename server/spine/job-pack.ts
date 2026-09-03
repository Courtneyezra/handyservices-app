/**
 * THE JOB PACK (P13, docs/comms-build/BRIEF-P13-job-pack.md) — one live record per quote from the
 * clerk to the contractor at the door.
 *
 * A contractor needs five things: where and when; who lets them in; what exactly to do and what is
 * excluded; what to bring; what could go wrong. Each is a structured field with ONE owner and ONE
 * capture moment, carried unchanged to the job sheet:
 *
 *   clerk      → lines: title, her words (evidence), photos (mediaIds), detail, assumptions,
 *                exclusions, sizes, spec, supply-by, hazards, disposal, lead time (price-critical:
 *                they gate Route A through the clerk's gaps)
 *   estimator  → per line: procedure, category, minutes range, materials with supplier / size /
 *                price; job: access notes
 *   Ben        → prices, materials as sent, assumptions as sent, contradiction resolutions
 *   rules      → after the deposit, one question at a time for the delivery-critical job fields
 *   customer   → a later reply files silently into a delivery field (change_log source `customer`);
 *                anything touching lines, sizes, spec or supply is a RESCOPE, never a pack edit
 *   dispatch   → reads it, never infers; locks it (line / price / date fields freeze, job.* stays live)
 *
 * Everything that decides is pure and tested; the store at the bottom does the reads and writes.
 * `required` is derived from the lines, `missing` is recomputed on every write, and every change
 * appends to `change_log` with who and which source.
 */

// ---------------------------------------------------------------- shapes

export interface PackEvidence { messageId: string; text: string }

export interface PackMaterial {
    name: string;
    supplier: string | null;
    sku: string | null;
    size: string | null;
    qty: number;
    unitPricePence: number | null;
}

export type SupplyBy = 'us' | 'customer' | 'none';

export interface PackLine {
    lineId: string;
    title: string;
    /** Her words this line came from (docs/comms-build/CLERK-EVIDENCE.md). */
    evidence: PackEvidence[];
    mediaIds: string[];
    /** The clerk's internal detail: what the photos and messages actually show. */
    detail: string | null;
    /** Customer-facing caveats, as Ben left them. */
    assumptions: string[];
    /** What this line does NOT include, in the customer's terms. */
    exclusions: string[];
    /**
     * P15 part 1: the customer-facing "Not included: …" in plain words. The clerk derives it from
     * the exclusions and the assumptions that exclude something ("small top door not included",
     * "frames reused"); Ben edits it on the price screen; the quote page and the pack task render it.
     */
    notIncluded: string[];
    /** Sizes the work depends on ("762 × 1981 mm, 35 mm thick"), when the line supplies something sized. */
    sizes: string | null;
    /** Spec / finish / model ("oak veneer, 4 panel, unfinished"). */
    spec: string | null;
    supplyBy: SupplyBy | null;
    procedure: string[];
    category: string | null;
    minutesLow: number | null;
    minutesPoint: number | null;
    minutesHigh: number | null;
    materials: PackMaterial[];
    hazards: string[];
    /** Where the waste goes ("customer's skip", "we take 2 bags", "none"). */
    disposal: string | null;
    /** Supplier lead time the date depends on ("doors 5 working days"). */
    leadTime: string | null;
    /** Ben's confirmed line price (after the price screen); null on a draft. */
    pricePence: number | null;
    labourPence: number | null;
    materialsPence: number | null;
    /**
     * P15/3: the dispatch_variations row this line came from, when the line was added to a LOCKED
     * pack through the variation path (an extra the contractor found at the door, priced by Route A
     * and confirmed by Ben). Null on every line the clerk wrote. Additive: nothing else reads it.
     */
    variationId?: string | null;
}

export interface OnSiteContact { name: string | null; phone: string | null; role: string | null }

export interface PackJob {
    /** How the contractor gets in: "customer home", "key safe", "neighbour", "lockbox", "agent meets". */
    accessMethod: string | null;
    /** Key safe / gate / alarm codes. Contractor-visible only after acceptance. */
    accessCodes: string | null;
    onSiteContact: OnSiteContact | null;
    floor: number | null;
    hasLift: boolean | null;
    /** 'on_drive' | 'street_outside' | 'street_within_50m' | '50m_plus' (personalized_quotes vocabulary). */
    parkingDistance: string | null;
    occupied: boolean | null;
    pets: string | null;
    parkingPermit: string | null;
    /** What the customer does before we arrive ("clear the cupboard", "move the car"). */
    prep: string | null;
    /** Water / power / heating we can use or must isolate. */
    utilities: string | null;
    /** When materials can be delivered / when the customer is in. */
    deliverySlot: string | null;
    /** The finished picture in one sentence, for the contractor to check against. */
    doneLooksLike: string | null;
    accessNotes: string[];
}

export type ChangeSource = 'clerk' | 'estimator' | 'ben' | 'customer' | 'rules' | 'system' | 'dispatch';

export interface ChangeLogEntry {
    at: string;                 // ISO
    /** 'job.accessMethod' | 'line:<lineId>.sizes' | 'lock' … */
    field: string;
    from: unknown;
    to: unknown;
    /** Approver string or 'customer'. */
    by: string;
    source: ChangeSource;
}

export interface JobPack {
    id: string;
    quoteId: string;
    conversationId: string | null;
    intakeRunId: string | null;
    estimateId: string | null;
    lines: PackLine[];
    job: PackJob;
    required: string[];
    missing: string[];
    changeLog: ChangeLogEntry[];
    lockedAt: string | null;
    dispatchId: string | null;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------- empties and normalisers

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const strs = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max) : []);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export function emptyJob(): PackJob {
    return {
        accessMethod: null, accessCodes: null, onSiteContact: null, floor: null, hasLift: null, parkingDistance: null, occupied: null,
        pets: null, parkingPermit: null, prep: null, utilities: null, deliverySlot: null, doneLooksLike: null, accessNotes: [],
    };
}

export function emptyLine(lineId: string, title: string): PackLine {
    return {
        lineId, title, evidence: [], mediaIds: [], detail: null, assumptions: [], exclusions: [], notIncluded: [], sizes: null, spec: null, supplyBy: null,
        procedure: [], category: null, minutesLow: null, minutesPoint: null, minutesHigh: null, materials: [], hazards: [], disposal: null,
        leadTime: null, pricePence: null, labourPence: null, materialsPence: null, variationId: null,
    };
}

export function normaliseMaterial(m: any): PackMaterial | null {
    const name = str(m?.name);
    if (!name) return null;
    return {
        name, supplier: str(m?.supplier) ?? str(m?.source) ?? null, sku: str(m?.sku) ?? str(m?.supplierItemNumber) ?? str(m?.catalogId) ?? null,
        size: str(m?.size) ?? null, qty: Math.max(1, int(m?.qty) ?? 1),
        unitPricePence: int(m?.unitPricePence) ?? int(m?.unitCostPence) ?? null,
    };
}

export function normaliseSupplyBy(v: unknown): SupplyBy | null {
    const s = String(v ?? '').toLowerCase().trim();
    if (s === 'us' || s === 'we' || s === 'handy' || s === 'supplied' || s === 'we_supply') return 'us';
    if (s === 'customer' || s === 'customer_supplies' || s === 'their own') return 'customer';
    if (s === 'none' || s === 'labour_only' || s === 'labour only') return 'none';
    return null;
}

/** A job object from any partial, unknown-tolerant. */
export function normaliseJob(j: any): PackJob {
    const base = emptyJob();
    if (!j || typeof j !== 'object') return base;
    const contact = j.onSiteContact && typeof j.onSiteContact === 'object'
        ? { name: str(j.onSiteContact.name), phone: str(j.onSiteContact.phone), role: str(j.onSiteContact.role) } : null;
    return {
        accessMethod: str(j.accessMethod), accessCodes: str(j.accessCodes),
        onSiteContact: contact && (contact.name || contact.phone) ? contact : null,
        floor: int(j.floor), hasLift: bool(j.hasLift), parkingDistance: str(j.parkingDistance), occupied: bool(j.occupied),
        pets: str(j.pets), parkingPermit: str(j.parkingPermit), prep: str(j.prep), utilities: str(j.utilities), deliverySlot: str(j.deliverySlot),
        doneLooksLike: str(j.doneLooksLike), accessNotes: strs(j.accessNotes, 12),
    };
}

export function normaliseLine(l: any, index = 0): PackLine {
    const lineId = str(l?.lineId) ?? `card_${index + 1}`;
    const base = emptyLine(lineId, str(l?.title) ?? `Line ${index + 1}`);
    if (!l || typeof l !== 'object') return base;
    return {
        ...base,
        evidence: Array.isArray(l.evidence) ? l.evidence.map((e: any) => ({ messageId: String(e?.messageId ?? ''), text: String(e?.text ?? '').trim() })).filter((e: PackEvidence) => e.text || e.messageId).slice(0, 3) : [],
        mediaIds: strs(l.mediaIds, 12),
        detail: str(l.detail), assumptions: strs(l.assumptions, 8), exclusions: strs(l.exclusions, 8), notIncluded: strs(l.notIncluded, 8),
        sizes: str(l.sizes), spec: str(l.spec), supplyBy: normaliseSupplyBy(l.supplyBy),
        procedure: strs(l.procedure, 8), category: str(l.category),
        minutesLow: int(l.minutesLow), minutesPoint: int(l.minutesPoint), minutesHigh: int(l.minutesHigh),
        materials: (Array.isArray(l.materials) ? l.materials : []).map(normaliseMaterial).filter((m: PackMaterial | null): m is PackMaterial => !!m).slice(0, 60),
        hazards: strs(l.hazards, 8), disposal: str(l.disposal), leadTime: str(l.leadTime),
        pricePence: int(l.pricePence), labourPence: int(l.labourPence), materialsPence: int(l.materialsPence),
        variationId: str(l.variationId),
    };
}

// ---------------------------------------------------------------- required and missing

/** Job fields every pack needs before the day, in the order the rules layer asks for them. */
export const DELIVERY_FIELDS_IN_ASK_ORDER = ['job.accessMethod', 'job.onSiteContact', 'job.parkingDistance', 'job.pets', 'job.prep', 'job.deliverySlot'] as const;
export type DeliveryField = (typeof DELIVERY_FIELDS_IN_ASK_ORDER)[number];

/** Categories where what we SUPPLY has a size and a spec the price rests on. */
const SIZED_SUPPLY = new Set(['door_fitting', 'carpentry', 'flooring', 'curtain_blinds', 'kitchen_fitting', 'bathroom_fitting', 'tiling', 'shelving', 'fencing']);
const SIZED_WORDS = /\b(door|doors|window|windows|worktop|unit|units|radiator|blind|blinds|panel|panels|fence|gate|shelf|shelves|flooring|laminate|tiles?)\b/i;
const DISPOSAL_WORDS = /\b(remove|removal|rip out|take out|strip|dispose|disposal|skip|rubbish|waste|clearance|old\b)/i;
const HAZARD_WORDS = /\b(asbestos|artex|lead paint|gas|boiler|electric|consumer unit|roof|height|ladder|scaffold|chemical)\b/i;

/**
 * Pure: which fields THIS job needs. Job-level delivery fields always; per line: sizes and spec when
 * we supply something sized (doors, units, blinds …), disposal when the line removes or strips
 * something, hazards named when the words point at one. Lead time when we supply materials.
 */
export function requiredFor(lines: PackLine[], _job: PackJob): string[] {
    const req: string[] = [...DELIVERY_FIELDS_IN_ASK_ORDER];
    const weSupply = (l: PackLine) => l.supplyBy === 'us' || (l.supplyBy == null && l.materials.length > 0);
    let anySupply = false;
    for (const l of lines) {
        const text = `${l.title} ${l.detail ?? ''}`;
        if (weSupply(l)) anySupply = true;
        if (weSupply(l) && (SIZED_SUPPLY.has(l.category ?? '') || SIZED_WORDS.test(l.title))) {
            req.push(`line:${l.lineId}.sizes`, `line:${l.lineId}.spec`);
        }
        if (DISPOSAL_WORDS.test(text) || l.category === 'waste_removal') req.push(`line:${l.lineId}.disposal`);
        if (HAZARD_WORDS.test(text)) req.push(`line:${l.lineId}.hazards`);
        if (weSupply(l) && l.materials.length > 0) req.push(`line:${l.lineId}.leadTime`);
    }
    if (!anySupply) {
        // Nothing to deliver: the delivery slot is not a question worth asking.
        const i = req.indexOf('job.deliverySlot');
        if (i >= 0) req.splice(i, 1);
    }
    return Array.from(new Set(req));
}

/** Pure: read a field key ('job.pets', 'line:card_1.sizes') off the pack. */
export function readField(pack: Pick<JobPack, 'lines' | 'job'>, field: string): unknown {
    if (field.startsWith('job.')) return (pack.job as any)[field.slice(4)];
    const m = /^line:([^.]+)\.(.+)$/.exec(field);
    if (!m) return undefined;
    const line = pack.lines.find((l) => l.lineId === m[1]);
    return line ? (line as any)[m[2]] : undefined;
}

function isKnown(v: unknown): boolean {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(isKnown);
    return true;
}

/** Pure: required minus known, in required order. */
export function missingFor(pack: Pick<JobPack, 'lines' | 'job' | 'required'>): string[] {
    return pack.required.filter((f) => !isKnown(readField(pack, f)));
}

/** Plain words for a field key, for the 422 and the portal chip. */
export function fieldLabel(field: string, lines: PackLine[] = []): string {
    const JOB: Record<string, string> = {
        'job.accessMethod': 'how we get in', 'job.accessCodes': 'access codes', 'job.onSiteContact': 'who is on site', 'job.parkingDistance': 'parking',
        'job.pets': 'pets', 'job.prep': 'what the customer prepares', 'job.deliverySlot': 'delivery slot', 'job.floor': 'floor', 'job.hasLift': 'lift',
        'job.occupied': 'occupied', 'job.parkingPermit': 'parking permit', 'job.utilities': 'water / power', 'job.doneLooksLike': 'what done looks like',
    };
    if (JOB[field]) return JOB[field];
    const m = /^line:([^.]+)\.(.+)$/.exec(field);
    if (!m) return field;
    const line = lines.find((l) => l.lineId === m[1]);
    const what: Record<string, string> = { sizes: 'sizes', spec: 'spec', disposal: 'disposal', hazards: 'hazards', leadTime: 'lead time', procedure: 'procedure', category: 'category', minutesPoint: 'time' };
    return `${what[m[2]] ?? m[2]} for "${line?.title ?? m[1]}"`;
}

// ---------------------------------------------------------------- change log

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const LINE_FIELDS: Array<keyof PackLine> = ['title', 'evidence', 'mediaIds', 'detail', 'assumptions', 'exclusions', 'notIncluded', 'sizes', 'spec', 'supplyBy', 'procedure', 'category', 'minutesLow', 'minutesPoint', 'minutesHigh', 'materials', 'hazards', 'disposal', 'leadTime', 'pricePence', 'labourPence', 'materialsPence'];
const JOB_FIELDS: Array<keyof PackJob> = ['accessMethod', 'accessCodes', 'onSiteContact', 'floor', 'hasLift', 'parkingDistance', 'occupied', 'pets', 'parkingPermit', 'prep', 'utilities', 'deliverySlot', 'doneLooksLike', 'accessNotes'];

/** Pure: every field that differs between two packs, as change-log rows. */
export function diffPacks(before: Pick<JobPack, 'lines' | 'job'>, after: Pick<JobPack, 'lines' | 'job'>, by: string, source: ChangeSource, at: Date): ChangeLogEntry[] {
    const out: ChangeLogEntry[] = [];
    const iso = at.toISOString();
    for (const f of JOB_FIELDS) {
        if (!same(before.job[f], after.job[f])) out.push({ at: iso, field: `job.${f}`, from: before.job[f] ?? null, to: after.job[f] ?? null, by, source });
    }
    const beforeById = new Map(before.lines.map((l) => [l.lineId, l]));
    const afterIds = new Set(after.lines.map((l) => l.lineId));
    for (const l of after.lines) {
        const b = beforeById.get(l.lineId);
        if (!b) { out.push({ at: iso, field: `line:${l.lineId}`, from: null, to: l.title, by, source }); continue; }
        for (const f of LINE_FIELDS) if (!same(b[f], l[f])) out.push({ at: iso, field: `line:${l.lineId}.${f}`, from: b[f] ?? null, to: l[f] ?? null, by, source });
    }
    for (const b of before.lines) if (!afterIds.has(b.lineId)) out.push({ at: iso, field: `line:${b.lineId}`, from: b.title, to: null, by, source });
    return out;
}

/** Fields that freeze once the pack is locked (dispatch has snapshotted them); job.* stays live. */
const FROZEN_AFTER_LOCK = /^line:/;

export class PackLockedError extends Error {
    constructor(public readonly fields: string[]) { super(`Job pack is locked; use the variation path for: ${fields.join(', ')}`); this.name = 'PackLockedError'; }
}

/** Pure: apply a change, recompute required / missing, append the log. Throws PackLockedError on a frozen field. */
export function commit(pack: JobPack, next: { lines?: PackLine[]; job?: PackJob }, by: string, source: ChangeSource, at: Date = new Date()): JobPack {
    const after = { ...pack, lines: next.lines ?? pack.lines, job: next.job ?? pack.job };
    const entries = diffPacks(pack, after, by, source, at);
    if (pack.lockedAt) {
        const frozen = entries.filter((e) => FROZEN_AFTER_LOCK.test(e.field)).map((e) => e.field);
        if (frozen.length) throw new PackLockedError(frozen);
    }
    after.required = requiredFor(after.lines, after.job);
    after.missing = missingFor(after);
    after.changeLog = [...pack.changeLog, ...entries];
    after.updatedAt = at.toISOString();
    return after;
}

// ---------------------------------------------------------------- writers (pure)

export interface ClerkLineInput {
    lineId: string; title: string; detail?: string | null; assumptions?: string[]; category?: string | null;
    evidence?: PackEvidence[] | null; mediaIds?: string[] | null;
    exclusions?: string[] | null; sizes?: string | null; spec?: string | null; supplyBy?: string | null;
    hazards?: string[] | null; disposal?: string | null; leadTime?: string | null;
    /** P15: given explicitly (a human card), else derived from exclusions + assumptions. */
    notIncluded?: string[] | null;
}

/** An assumption that takes something OUT of the line ("frames reused", "customer disposes of the old doors"). */
const EXCLUDING_ASSUMPTION = /\b(not included|excluded|reuse[ds]?|re-use[ds]?|kept|left in place|left as is|stays? as (it is|they are)|customer (to )?(supply|supplies|supplied|dispose|disposes|remove|removes|clear|clears)|no (decorating|painting|making good|plastering|electrics|plumbing|disposal))\b/i;

function plainWords(s: string): string {
    // One clause, no trailing stop, no dashes (shared/chat-voice.ts rule), first letter lower unless it is a name or a size.
    let t = s.replace(/\s*[–—]\s*/g, ', ').replace(/\s+-\s+/g, ', ').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '');
    if (/^[A-Z][a-z]/.test(t) && !/^[A-Z][a-z]+\s[A-Z]/.test(t)) t = t[0].toLowerCase() + t.slice(1);
    return t;
}

/**
 * P15 part 1, pure: the customer-facing "Not included" list from the clerk's exclusions and the
 * assumptions that exclude something. Exclusions are stated as "… not included" unless they
 * already say so; excluding assumptions are carried in their own words. De-duplicated, max 8.
 */
export function notIncludedFrom(exclusions: string[] | null | undefined, assumptions: string[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (s: string) => { const key = s.toLowerCase(); if (s && !seen.has(key)) { seen.add(key); out.push(s); } };
    for (const e of strs(exclusions, 8)) {
        const p = plainWords(e);
        push(/\b(not included|excluded|not (part of|in) (this|the) (quote|price|job))\b/i.test(p) ? p : `${p} not included`);
    }
    for (const a of strs(assumptions, 8)) if (EXCLUDING_ASSUMPTION.test(a)) push(plainWords(a));
    return out.slice(0, 8);
}

/**
 * Pure: the clerk's lines onto the pack. Clerk-owned fields are replaced; estimator- and Ben-owned
 * fields on a line that already exists (procedure, minutes, materials, prices) are kept.
 */
export function linesFromClerk(existing: PackLine[], input: ClerkLineInput[]): PackLine[] {
    const byId = new Map(existing.map((l) => [l.lineId, l]));
    return input.map((c, i) => {
        const prev = byId.get(c.lineId) ?? emptyLine(c.lineId, c.title);
        const assumptions = c.assumptions ? strs(c.assumptions, 8) : prev.assumptions;
        const exclusions = c.exclusions ? strs(c.exclusions, 8) : prev.exclusions;
        return {
            ...prev,
            lineId: c.lineId, title: str(c.title) ?? prev.title,
            detail: str(c.detail) ?? prev.detail,
            assumptions,
            category: str(c.category) ?? prev.category,
            evidence: c.evidence ? normaliseLine({ evidence: c.evidence }, i).evidence : prev.evidence,
            mediaIds: c.mediaIds ? strs(c.mediaIds, 12) : prev.mediaIds,
            exclusions,
            // P15: the clerk writes the customer-facing list every time it writes the line; a human card may give it outright.
            notIncluded: c.notIncluded ? strs(c.notIncluded, 8) : notIncludedFrom(exclusions, assumptions),
            sizes: c.sizes !== undefined ? str(c.sizes) : prev.sizes,
            spec: c.spec !== undefined ? str(c.spec) : prev.spec,
            supplyBy: c.supplyBy !== undefined ? normaliseSupplyBy(c.supplyBy) : prev.supplyBy,
            hazards: c.hazards ? strs(c.hazards, 8) : prev.hazards,
            disposal: c.disposal !== undefined ? str(c.disposal) : prev.disposal,
            leadTime: c.leadTime !== undefined ? str(c.leadTime) : prev.leadTime,
        };
    });
}

export interface EstimateLineInput {
    lineId: string; category?: string | null; minutesLow?: number; minutesPoint?: number; minutesHigh?: number;
    procedure?: string[]; assumptions?: string[]; flags?: string[];
    materials?: Array<{ name: string; qty?: number; unitCostPence?: number; source?: string; supplierItemNumber?: string | null; catalogId?: string | null; size?: string | null }>;
}

/** Pure: the estimator's judgement onto the lines (by lineId). Lines it did not estimate are untouched. */
export function mergeEstimate(lines: PackLine[], est: EstimateLineInput[], job?: { accessNotes?: string[] } | null): { lines: PackLine[]; accessNotes: string[] } {
    const byId = new Map(est.map((e) => [e.lineId, e]));
    const merged = lines.map((l) => {
        const e = byId.get(l.lineId);
        if (!e) return l;
        const hazards = new Set(l.hazards);
        for (const f of e.flags ?? []) if (/asbestos|gas|electric|height|ladder|roof|hazard|unknown_substrate|live_wire|damp|lead/i.test(f)) hazards.add(f);
        return {
            ...l,
            category: str(e.category) ?? l.category,
            minutesLow: int(e.minutesLow) ?? l.minutesLow, minutesPoint: int(e.minutesPoint) ?? l.minutesPoint, minutesHigh: int(e.minutesHigh) ?? l.minutesHigh,
            procedure: e.procedure?.length ? strs(e.procedure, 8) : l.procedure,
            assumptions: Array.from(new Set([...l.assumptions, ...strs(e.assumptions, 8)])).slice(0, 8),
            materials: e.materials ? e.materials.map((m) => normaliseMaterial({ ...m, supplier: m.source, unitPricePence: m.unitCostPence, sku: m.supplierItemNumber ?? m.catalogId })).filter((m): m is PackMaterial => !!m) : l.materials,
            hazards: Array.from(hazards).slice(0, 8),
        };
    });
    return { lines: merged, accessNotes: strs(job?.accessNotes, 12) };
}

export interface BenLineEdit {
    lineId: string; finalPence?: number; materialsPence?: number;
    materials?: Array<{ name: string; qty: number; unitCostPence: number; source?: string | null }>;
    assumptions?: string[]; /** P15 */ notIncluded?: string[];
    /** P16: Ben deleted this line on the price screen. It leaves the pack with the quote. */
    deleted?: boolean;
    /** P16: Ben added this line by hand. It joins the pack with no evidence and no estimate. */
    added?: { title: string; category?: string | null; minutesPoint?: number | null };
}

/**
 * Pure: Ben's price-screen edits onto the lines. Prices, materials, assumptions and the
 * not-included list are his, and since P16 so are the lines themselves: an edit may add a line he
 * typed or remove one he deleted.
 *
 * A removal on a LOCKED pack is not refused here — `commit` is the one place that knows about the
 * lock, and a dropped line shows up in its diff as a frozen `line:<id>` change, so the
 * PackLockedError comes from there with the field named.
 */
export function applyBenEdits(lines: PackLine[], edits: BenLineEdit[]): PackLine[] {
    const byId = new Map(edits.map((e) => [e.lineId, e]));
    const known = new Set(lines.map((l) => l.lineId));
    const appended: PackLine[] = edits
        .filter((e) => e.added && !known.has(e.lineId) && !e.deleted)
        .map((e) => {
            const base = emptyLine(e.lineId, e.added!.title);
            return { ...base, category: str(e.added!.category) ?? null, minutesPoint: int(e.added!.minutesPoint), minutesLow: int(e.added!.minutesPoint), minutesHigh: int(e.added!.minutesPoint) };
        });
    return [...lines, ...appended].filter((l) => !byId.get(l.lineId)?.deleted).map((l) => {
        const e = byId.get(l.lineId);
        if (!e) return l;
        const materials = e.materials ? e.materials.map((m) => normaliseMaterial({ ...m, supplier: m.source ?? null, unitPricePence: m.unitCostPence })).filter((m): m is PackMaterial => !!m) : l.materials;
        const pricePence = int(e.finalPence) ?? l.pricePence;
        const materialsPence = int(e.materialsPence) ?? (pricePence != null ? l.materialsPence : null);
        return {
            ...l, materials,
            assumptions: e.assumptions ? strs(e.assumptions, 8) : l.assumptions,
            notIncluded: e.notIncluded ? strs(e.notIncluded.map(plainWords), 8) : l.notIncluded,
            pricePence, materialsPence,
            labourPence: pricePence != null && materialsPence != null ? Math.max(0, pricePence - materialsPence) : l.labourPence,
        };
    });
}

/** The delivery fields a customer's own message may fill. Nothing else. */
export const CUSTOMER_FILEABLE: ReadonlySet<string> = new Set(['job.accessMethod', 'job.accessCodes', 'job.onSiteContact', 'job.pets', 'job.parkingDistance', 'job.parkingPermit', 'job.deliverySlot', 'job.prep', 'job.occupied', 'job.floor', 'job.hasLift', 'job.utilities']);

export class NotFileableError extends Error {
    constructor(public readonly field: string) { super(`"${field}" is not a delivery field; a customer message that touches it is a rescope, not a pack edit`); this.name = 'NotFileableError'; }
}

/** Pure: file ONE answer into a delivery field. A customer source may only touch CUSTOMER_FILEABLE. */
export function fileAnswer(pack: JobPack, answer: { field: string; value: unknown; by: string; source: ChangeSource }, at: Date = new Date()): JobPack {
    if (answer.source === 'customer' && !CUSTOMER_FILEABLE.has(answer.field)) throw new NotFileableError(answer.field);
    if (!answer.field.startsWith('job.')) throw new NotFileableError(answer.field);
    const key = answer.field.slice(4) as keyof PackJob;
    const job = normaliseJob({ ...pack.job, [key]: answer.value });
    return commit(pack, { job }, answer.by, answer.source, at);
}

/** Pure: lock at dispatch. Line fields freeze; job.* stays live. Idempotent for the same dispatch. */
export function lock(pack: JobPack, dispatchId: string, by: string, at: Date = new Date()): JobPack {
    if (pack.lockedAt && pack.dispatchId === dispatchId) return pack;
    const iso = at.toISOString();
    return {
        ...pack, lockedAt: iso, dispatchId, updatedAt: iso,
        changeLog: [...pack.changeLog, { at: iso, field: 'lock', from: pack.dispatchId, to: dispatchId, by, source: 'dispatch' }],
    };
}

/** Pure: the change-log rows a contractor should see since they accepted (day-relevant fields only). */
export function changesSince(pack: Pick<JobPack, 'changeLog'>, sinceIso: string | null | undefined): ChangeLogEntry[] {
    if (!sinceIso) return [];
    return pack.changeLog.filter((e) => e.at > sinceIso && e.field !== 'lock' && !/\.(pricePence|labourPence|materialsPence|evidence|mediaIds|detail)$/.test(e.field));
}

/** Job-level fields whose change after acceptance is worth a contractor notification (Part 4). */
export const DAY_RELEVANT_JOB_FIELDS: ReadonlySet<string> = new Set(['job.accessMethod', 'job.accessCodes', 'job.onSiteContact', 'job.parkingDistance', 'job.parkingPermit', 'job.pets', 'job.prep', 'job.deliverySlot', 'job.utilities', 'job.occupied', 'job.floor', 'job.hasLift']);

// ---------------------------------------------------------------- the quote's line items, derived

/**
 * Pure: the customer-visible pricing_line_items DERIVED from the pack (never the other way round).
 * Keeps whatever the existing item carries that the pack does not own (engine fields), and writes
 * the pack's title, category, time, materials, assumptions and Ben's prices on top.
 */
export function derivePricingLineItems(pack: Pick<JobPack, 'lines'>, existing: any[]): any[] {
    const byId = new Map((existing ?? []).filter((x) => x && typeof x === 'object').map((x: any, i: number) => [String(x.lineId ?? `card_${i + 1}`), x]));
    return pack.lines.map((l, i) => {
        const prev = byId.get(l.lineId) ?? existing?.[i] ?? {};
        const materials = l.materials.map((m) => ({ name: m.name, qty: m.qty, unitPricePence: m.unitPricePence ?? 0, unitCostPence: m.unitPricePence ?? 0, supplier: m.supplier === 'screwfix' || m.supplier === 'catalog' ? m.supplier : 'manual', ...(m.sku ? { supplierItemNumber: m.sku } : {}), ...(m.size ? { size: m.size } : {}) }));
        const out: Record<string, unknown> = {
            ...prev,
            lineId: l.lineId,
            label: l.title, title: l.title, description: l.title,
            category: l.category ?? prev.category ?? 'general_fixing',
            timeEstimateMinutes: l.minutesPoint ?? prev.timeEstimateMinutes ?? null,
            materials,
            assumptions: l.assumptions,
            exclusions: l.exclusions,
            notIncluded: l.notIncluded,
            source: prev.source ?? 'job_pack',
        };
        if (l.pricePence != null) {
            const mats = Math.min(l.materialsPence ?? 0, l.pricePence);
            const labour = l.pricePence - mats;
            Object.assign(out, { pricePence: l.pricePence, labourPence: labour, materialsPence: mats, guardedPricePence: labour, materialsWithMarginPence: mats, confirmedBy: 'human' });
        }
        return out;
    });
}

// ---------------------------------------------------------------- new pack

export function newPackId(): string {
    return `jp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function newPack(input: { quoteId: string; conversationId?: string | null; intakeRunId?: string | null; estimateId?: string | null; now?: Date }): JobPack {
    const iso = (input.now ?? new Date()).toISOString();
    const pack: JobPack = {
        id: newPackId(), quoteId: input.quoteId, conversationId: input.conversationId ?? null, intakeRunId: input.intakeRunId ?? null, estimateId: input.estimateId ?? null,
        lines: [], job: emptyJob(), required: [], missing: [], changeLog: [], lockedAt: null, dispatchId: null, createdAt: iso, updatedAt: iso,
    };
    pack.required = requiredFor(pack.lines, pack.job);
    pack.missing = missingFor(pack);
    return pack;
}

/** A pack from a stored row (to_jsonb or drizzle), unknown-tolerant. */
export function packFromRow(row: any): JobPack {
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
    const pack: JobPack = {
        id: String(row.id), quoteId: String(row.quoteId ?? row.quote_id), conversationId: row.conversationId ?? row.conversation_id ?? null,
        intakeRunId: row.intakeRunId ?? row.intake_run_id ?? null, estimateId: row.estimateId ?? row.estimate_id ?? null,
        lines: (Array.isArray(row.lines) ? row.lines : []).map(normaliseLine), job: normaliseJob(row.job),
        required: strs(row.required, 100), missing: strs(row.missing, 100),
        changeLog: Array.isArray(row.changeLog ?? row.change_log) ? (row.changeLog ?? row.change_log) : [],
        lockedAt: iso(row.lockedAt ?? row.locked_at), dispatchId: row.dispatchId ?? row.dispatch_id ?? null,
        createdAt: iso(row.createdAt ?? row.created_at) ?? new Date(0).toISOString(), updatedAt: iso(row.updatedAt ?? row.updated_at) ?? new Date(0).toISOString(),
    };
    return pack;
}

// ---------------------------------------------------------------- store

export async function getPackForQuote(quoteId: string): Promise<JobPack | null> {
    const { db } = await import('../db');
    const { jobPacks } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(jobPacks).where(eq(jobPacks.quoteId, quoteId)).limit(1);
    return row ? packFromRow(row) : null;
}

export async function getPackForDispatch(dispatchId: string): Promise<JobPack | null> {
    const { db } = await import('../db');
    const { jobPacks } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(jobPacks).where(eq(jobPacks.dispatchId, dispatchId)).limit(1);
    return row ? packFromRow(row) : null;
}

/** The newest pack on a thread (the live quote's). */
export async function getPackForConversation(conversationId: string): Promise<JobPack | null> {
    const { db } = await import('../db');
    const { jobPacks } = await import('@shared/schema');
    const { desc, eq } = await import('drizzle-orm');
    const [row] = await db.select().from(jobPacks).where(eq(jobPacks.conversationId, conversationId)).orderBy(desc(jobPacks.updatedAt)).limit(1);
    return row ? packFromRow(row) : null;
}

/** Upsert on quote_id. Never throws for a missing table: the caller decides what a null means. */
export async function savePack(pack: JobPack): Promise<JobPack> {
    const { db } = await import('../db');
    const { jobPacks } = await import('@shared/schema');
    const values = {
        id: pack.id, quoteId: pack.quoteId, conversationId: pack.conversationId, intakeRunId: pack.intakeRunId, estimateId: pack.estimateId,
        lines: pack.lines, job: pack.job, required: pack.required, missing: pack.missing, changeLog: pack.changeLog,
        lockedAt: pack.lockedAt ? new Date(pack.lockedAt) : null, dispatchId: pack.dispatchId,
        createdAt: new Date(pack.createdAt), updatedAt: new Date(pack.updatedAt),
    };
    await db.insert(jobPacks).values(values as any).onConflictDoUpdate({
        target: jobPacks.quoteId,
        set: {
            conversationId: values.conversationId, intakeRunId: values.intakeRunId, estimateId: values.estimateId,
            lines: values.lines, job: values.job, required: values.required, missing: values.missing, changeLog: values.changeLog,
            lockedAt: values.lockedAt, dispatchId: values.dispatchId, updatedAt: values.updatedAt,
        } as any,
    });
    return pack;
}

/** 42P01: migration 20260906_job_packs not applied here. The pack is optional everywhere it is read. */
export function isMissingTable(error: any): boolean {
    return String(error?.code) === '42P01' || /job_packs/.test(String(error?.message ?? ''));
}

/** Clerk: create or refresh the pack for a quote from the intake lines. */
export async function upsertFromClerk(input: { quoteId: string; conversationId?: string | null; intakeRunId?: string | null; lines: ClerkLineInput[]; job?: Partial<PackJob> | null; by?: string; now?: Date }): Promise<JobPack> {
    const now = input.now ?? new Date();
    const existing = await getPackForQuote(input.quoteId);
    const base = existing ?? newPack({ quoteId: input.quoteId, conversationId: input.conversationId, intakeRunId: input.intakeRunId, now });
    const lines = linesFromClerk(base.lines, input.lines);
    const job = input.job ? normaliseJob({ ...base.job, ...input.job }) : base.job;
    const next = commit({ ...base, intakeRunId: input.intakeRunId ?? base.intakeRunId, conversationId: input.conversationId ?? base.conversationId }, { lines, job }, input.by ?? 'agent.quote_clerk', 'clerk', now);
    return savePack(next);
}

/** Estimator: procedure, category, minutes, materials, access notes onto the pack. */
export async function upsertFromEstimate(input: { quoteId: string; conversationId?: string | null; estimateId?: string | null; lines: EstimateLineInput[]; job?: { accessNotes?: string[] } | null; by?: string; now?: Date }): Promise<JobPack> {
    const now = input.now ?? new Date();
    const existing = await getPackForQuote(input.quoteId);
    const base = existing ?? newPack({ quoteId: input.quoteId, conversationId: input.conversationId, estimateId: input.estimateId, now });
    const lines = base.lines.length ? base.lines : input.lines.map((e, i) => emptyLine(e.lineId, `Line ${i + 1}`));
    const merged = mergeEstimate(lines, input.lines, input.job);
    const job = { ...base.job, accessNotes: Array.from(new Set([...base.job.accessNotes, ...merged.accessNotes])).slice(0, 12) };
    const next = commit({ ...base, estimateId: input.estimateId ?? base.estimateId }, { lines: merged.lines, job }, input.by ?? 'agent.estimator', 'estimator', now);
    return savePack(next);
}

/** Ben's price screen: his prices, materials, assumptions onto the pack. Null when there is no pack. */
export async function applyBenEditsToQuote(input: { quoteId: string; edits: BenLineEdit[]; by: string; now?: Date }): Promise<JobPack | null> {
    const existing = await getPackForQuote(input.quoteId);
    if (!existing) return null;
    const next = commit(existing, { lines: applyBenEdits(existing.lines, input.edits) }, input.by, 'ben', input.now ?? new Date());
    return savePack(next);
}

export async function fileAnswerForQuote(input: { quoteId: string; field: string; value: unknown; by: string; source: ChangeSource; now?: Date }): Promise<JobPack | null> {
    const existing = await getPackForQuote(input.quoteId);
    if (!existing) return null;
    return savePack(fileAnswer(existing, input, input.now ?? new Date()));
}

export async function lockPack(input: { quoteId: string; dispatchId: string; by: string; now?: Date }): Promise<JobPack | null> {
    const existing = await getPackForQuote(input.quoteId);
    if (!existing) return null;
    return savePack(lock(existing, input.dispatchId, input.by, input.now ?? new Date()));
}
