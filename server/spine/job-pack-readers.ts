/**
 * P13 part 3 — the pack's readers: dispatch, the booking engine, the contractor portal.
 *
 *   dispatchLinesFromPack   the lines dispatch builds tasks from (category, minutes point, labour,
 *                           materials with supplier / size / price) — read, never inferred; a
 *                           missing dispatch-critical field is a loud 422 (dispatchBlockers)
 *   contractorPackView      what a contractor sees: per task the customer's words, the photo for
 *                           that task, procedure, assumptions, exclusions, materials with where to
 *                           buy, hazards, disposal; per job access, contact, parking, pets, prep,
 *                           delivery, done-looks-like. Address, codes and contact only after
 *                           acceptance; "changed since you accepted" from the change log.
 *   packChip                "pack complete" / "N missing" for the dashboard list
 *   siteContextFromPack     floor / lift / parking / occupied for the booking engine's day sizing
 *
 * Pure at the top, the reads at the bottom.
 */
import { changesSince, fieldLabel, missingFor, type ChangeLogEntry, type JobPack, type PackLine, type PackMaterial } from './job-pack';

// ---------------------------------------------------------------- dispatch

export interface DispatchLine {
    lineId: string;
    description: string;
    category: string;
    timeEstimateMinutes: number;
    /** Labour the contractor share is computed on (Ben's price less materials at margin). */
    guardedPricePence: number;
    materialsWithMarginPence: number;
    /** Supplier cost, no markup: the contractor's spend on our card. */
    materialsCostPence: number;
    materials: Array<{ name: string; qty: number; unitPricePence: number; supplier: string; supplierItemNumber?: string; size?: string }>;
}

/** Pure: what dispatch must have per line before it builds a task. */
export function dispatchBlockers(pack: Pick<JobPack, 'lines' | 'job' | 'required' | 'missing'>): string[] {
    const out: string[] = [];
    for (const l of pack.lines) {
        if (!l.category) out.push(`line:${l.lineId}.category`);
        if (!(l.minutesPoint && l.minutesPoint > 0)) out.push(`line:${l.lineId}.minutesPoint`);
        if (l.pricePence == null) out.push(`line:${l.lineId}.pricePence`);
    }
    // The clerk's price-critical fields the pack says this job needs (sizes, spec, disposal, hazards, lead time).
    for (const f of missingFor(pack)) if (f.startsWith('line:') && !out.includes(f)) out.push(f);
    return out;
}

/** Pure: blockers in words, for the 422 and the admin form. */
export function blockersInWords(pack: Pick<JobPack, 'lines'>, blockers: string[]): string[] {
    return blockers.map((b) => fieldLabel(b, pack.lines));
}

function materialsCost(materials: PackMaterial[]): number {
    return materials.reduce((s, m) => s + (m.unitPricePence ?? 0) * Math.max(1, m.qty), 0);
}

/** Pure: the dispatch lines, from the pack alone. Throws nothing; the caller checks blockers first. */
export function dispatchLinesFromPack(pack: Pick<JobPack, 'lines'>): DispatchLine[] {
    return pack.lines.map((l) => {
        const price = l.pricePence ?? 0;
        const mats = Math.min(l.materialsPence ?? 0, price);
        return {
            lineId: l.lineId,
            description: l.title,
            category: l.category ?? 'general_fixing',
            timeEstimateMinutes: l.minutesPoint ?? 0,
            guardedPricePence: l.labourPence ?? Math.max(0, price - mats),
            materialsWithMarginPence: mats,
            materialsCostPence: materialsCost(l.materials),
            materials: l.materials.map((m) => ({
                name: m.name, qty: m.qty, unitPricePence: m.unitPricePence ?? 0,
                supplier: m.supplier === 'screwfix' || m.supplier === 'catalog' ? m.supplier : 'manual',
                ...(m.sku ? { supplierItemNumber: m.sku } : {}), ...(m.size ? { size: m.size } : {}),
            })),
        };
    });
}

// ---------------------------------------------------------------- contractor view

export interface PackTaskView {
    lineId: string;
    /** The customer's own words this task came from. */
    customerWords: string[];
    /** Signed media URLs for this task (resolved from the pack's mediaIds by the caller). */
    mediaUrls: string[];
    procedure: string[];
    assumptions: string[];
    exclusions: string[];
    /** P15: the customer-facing "Not included" list, as Ben sent it. */
    notIncluded: string[];
    sizes: string | null;
    spec: string | null;
    supplyBy: string | null;
    materials: Array<{ name: string; qty: number; supplier: string | null; sku: string | null; size: string | null; unitPricePence: number | null }>;
    hazards: string[];
    disposal: string | null;
    leadTime: string | null;
    minutes: { low: number | null; point: number | null; high: number | null };
}

export interface PackJobView {
    accessMethod: string | null;
    /** Only after acceptance; null (with `locked: true`) before. */
    accessCodes: string | null;
    onSiteContact: { name: string | null; phone: string | null; role: string | null } | null;
    locked: boolean;
    floor: number | null;
    hasLift: boolean | null;
    parkingDistance: string | null;
    parkingPermit: string | null;
    occupied: boolean | null;
    pets: string | null;
    prep: string | null;
    utilities: string | null;
    deliverySlot: string | null;
    doneLooksLike: string | null;
    accessNotes: string[];
}

export interface ContractorPackView {
    quoteId: string;
    tasks: PackTaskView[];
    job: PackJobView;
    /** Day-relevant changes since the contractor accepted, newest first. */
    changes: Array<{ at: string; field: string; label: string; to: unknown }>;
    missing: string[];
    missingLabels: string[];
    lockedAt: string | null;
    updatedAt: string;
}

/** Pure: the contractor's view. `mediaUrlsFor` resolves a line's mediaIds to signed URLs. */
export function contractorPackView(pack: JobPack, opts: { accepted: boolean; acceptedAt: string | null; mediaUrlsFor?: (line: PackLine) => string[] }): ContractorPackView {
    const media = opts.mediaUrlsFor ?? (() => []);
    return {
        quoteId: pack.quoteId,
        tasks: pack.lines.map((l) => ({
            lineId: l.lineId,
            customerWords: l.evidence.map((e) => e.text).filter(Boolean),
            mediaUrls: media(l),
            procedure: l.procedure, assumptions: l.assumptions, exclusions: l.exclusions, notIncluded: l.notIncluded,
            sizes: l.sizes, spec: l.spec, supplyBy: l.supplyBy,
            materials: l.materials.map((m) => ({ name: m.name, qty: m.qty, supplier: m.supplier, sku: m.sku, size: m.size, unitPricePence: m.unitPricePence })),
            hazards: l.hazards, disposal: l.disposal, leadTime: l.leadTime,
            minutes: { low: l.minutesLow, point: l.minutesPoint, high: l.minutesHigh },
        })),
        job: {
            accessMethod: pack.job.accessMethod,
            accessCodes: opts.accepted ? pack.job.accessCodes : null,
            onSiteContact: opts.accepted ? pack.job.onSiteContact : null,
            locked: !opts.accepted,
            floor: pack.job.floor, hasLift: pack.job.hasLift, parkingDistance: pack.job.parkingDistance, parkingPermit: pack.job.parkingPermit,
            occupied: pack.job.occupied, pets: pack.job.pets, prep: pack.job.prep, utilities: pack.job.utilities, deliverySlot: pack.job.deliverySlot,
            doneLooksLike: pack.job.doneLooksLike, accessNotes: pack.job.accessNotes,
        },
        changes: changesSince(pack, opts.accepted ? opts.acceptedAt : null)
            .filter((e) => opts.accepted || !/accessCodes|onSiteContact/.test(e.field))
            .map((e) => ({ at: e.at, field: e.field, label: fieldLabel(e.field, pack.lines), to: e.to }))
            .reverse(),
        missing: pack.missing,
        missingLabels: pack.missing.map((f) => fieldLabel(f, pack.lines)),
        lockedAt: pack.lockedAt,
        updatedAt: pack.updatedAt,
    };
}

/** Pure: the dashboard chip. */
export function packChip(pack: Pick<JobPack, 'missing' | 'lines'> | null): { complete: boolean; missing: number; label: string } | null {
    if (!pack) return null;
    const n = pack.missing.length;
    return { complete: n === 0, missing: n, label: n === 0 ? 'Pack complete' : `${n} missing` };
}

/** Pure: which change-log rows are worth telling the contractor about (Part 4 uses the same rule). */
export function dayRelevantChanges(entries: ChangeLogEntry[]): ChangeLogEntry[] {
    return entries.filter((e) => /^job\.(accessMethod|accessCodes|onSiteContact|parkingDistance|parkingPermit|pets|prep|deliverySlot|utilities|occupied|floor|hasLift)$/.test(e.field) || /^line:[^.]+\.(materials|procedure|hazards|disposal|sizes|spec|exclusions|notIncluded)$/.test(e.field));
}

// ---------------------------------------------------------------- booking engine

export interface SiteContext { floorNumber: number | null; hasLift: boolean | null; parkingDistanceCategory: string | null; customerPresent: boolean | null }

/** Pure: the pack's job fields over the quote's columns; the quote fills what the pack does not know. */
export function siteContextFromPack(pack: Pick<JobPack, 'job'> | null, quote: SiteContext): SiteContext {
    if (!pack) return quote;
    return {
        floorNumber: pack.job.floor ?? quote.floorNumber,
        hasLift: pack.job.hasLift ?? quote.hasLift,
        parkingDistanceCategory: pack.job.parkingDistance ?? quote.parkingDistanceCategory,
        customerPresent: pack.job.occupied ?? quote.customerPresent,
    };
}

// ---------------------------------------------------------------- reads

/** Media message ids → media URLs (unsigned; the dispatch module signs). Unknown ids are dropped. */
export async function mediaUrlsByMessageId(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return out;
    const { db } = await import('../db');
    const { messages } = await import('@shared/schema');
    const { inArray } = await import('drizzle-orm');
    const rows = await db.select({ id: messages.id, mediaUrl: messages.mediaUrl }).from(messages).where(inArray(messages.id, unique));
    for (const r of rows) if (r.mediaUrl) out.set(String(r.id), r.mediaUrl);
    return out;
}

/** The pack for a quote with the media resolved, or null (no pack, or the table absent). */
export async function loadPackForQuote(quoteId: string | null | undefined): Promise<{ pack: JobPack; mediaUrlsFor: (line: PackLine) => string[] } | null> {
    if (!quoteId) return null;
    try {
        const { getPackForQuote } = await import('./job-pack');
        const pack = await getPackForQuote(quoteId);
        if (!pack) return null;
        const byId = await mediaUrlsByMessageId(pack.lines.flatMap((l) => l.mediaIds)).catch(() => new Map<string, string>());
        return { pack, mediaUrlsFor: (line) => line.mediaIds.map((id) => byId.get(id)).filter((u): u is string => !!u) };
    } catch (error: any) {
        const { isMissingTable } = await import('./job-pack');
        if (isMissingTable(error)) return null;
        throw error;
    }
}

/** The chips for a list of quote ids, one query. */
export async function packChipsForQuotes(quoteIds: string[]): Promise<Record<string, { complete: boolean; missing: number; label: string }>> {
    const out: Record<string, { complete: boolean; missing: number; label: string }> = {};
    const ids = Array.from(new Set(quoteIds.filter(Boolean)));
    if (!ids.length) return out;
    try {
        const { db } = await import('../db');
        const { jobPacks } = await import('@shared/schema');
        const { inArray } = await import('drizzle-orm');
        const rows = await db.select({ quoteId: jobPacks.quoteId, missing: jobPacks.missing }).from(jobPacks).where(inArray(jobPacks.quoteId, ids));
        for (const r of rows) out[r.quoteId] = packChip({ missing: Array.isArray(r.missing) ? r.missing : [], lines: [] })!;
    } catch (error: any) {
        const { isMissingTable } = await import('./job-pack');
        if (!isMissingTable(error)) throw error;
    }
    return out;
}

// ---------------------------------------------------------------- P13c: My Week (the tokenised schedule) and the materials run

export interface LoadedPack { pack: JobPack; mediaUrlsFor: (line: PackLine) => string[] }

export interface LoadPacksDeps {
    rows: (quoteIds: string[]) => Promise<any[]>;
    media: (messageIds: string[]) => Promise<Map<string, string>>;
}

async function livePackDeps(): Promise<LoadPacksDeps> {
    return {
        rows: async (ids) => {
            const { db } = await import('../db');
            const { jobPacks } = await import('@shared/schema');
            const { inArray } = await import('drizzle-orm');
            return db.select().from(jobPacks).where(inArray(jobPacks.quoteId, ids));
        },
        media: (ids) => mediaUrlsByMessageId(ids),
    };
}

/**
 * The packs for MANY quotes at once: one query for the rows, one for the media, however many
 * jobs are on the page. Quotes without a pack are simply absent from the map; a missing table is
 * an empty map (the pack is optional everywhere it is read).
 */
export async function loadPacksForQuotes(quoteIds: Array<string | null | undefined>, deps?: LoadPacksDeps): Promise<Map<string, LoadedPack>> {
    const out = new Map<string, LoadedPack>();
    const ids = Array.from(new Set(quoteIds.filter((q): q is string => !!q)));
    if (!ids.length) return out;
    const d = deps ?? await livePackDeps();
    let rows: any[];
    try {
        rows = await d.rows(ids);
    } catch (error: any) {
        const { isMissingTable } = await import('./job-pack');
        if (isMissingTable(error)) return out;
        throw error;
    }
    const { packFromRow } = await import('./job-pack');
    const packs = rows.map(packFromRow);
    const byId = await d.media(packs.flatMap((p) => p.lines.flatMap((l) => l.mediaIds))).catch(() => new Map<string, string>());
    for (const pack of packs) {
        out.set(pack.quoteId, { pack, mediaUrlsFor: (line) => line.mediaIds.map((id) => byId.get(id)).filter((u): u is string => !!u) });
    }
    return out;
}

export interface BookingAcceptance { acceptedAt?: Date | string | null; assignmentStatus?: string | null; status?: string | null }

/** Pure: is the booking accepted, so codes and the contact may show? Same rule as the dashboard job page. */
export function bookingAccepted(b: BookingAcceptance): boolean {
    return !!b.acceptedAt || b.status === 'accepted' || ['accepted', 'in_progress', 'completed'].includes(String(b.assignmentStatus ?? ''));
}

/** Pure: the two pack fields a booked job on the schedule carries: the full view and the list chip. Both null without a pack. */
export function bookingPackFields(loaded: LoadedPack | null | undefined, booking: BookingAcceptance): { jobPack: ContractorPackView | null; packChip: ReturnType<typeof packChip> } {
    if (!loaded) return { jobPack: null, packChip: null };
    const accepted = bookingAccepted(booking);
    const acceptedAt = booking.acceptedAt ? new Date(booking.acceptedAt).toISOString() : null;
    return {
        jobPack: contractorPackView(loaded.pack, { accepted, acceptedAt, mediaUrlsFor: loaded.mediaUrlsFor }),
        packChip: packChip(loaded.pack),
    };
}

export interface RunMaterial {
    name: string; qty: number; supplier?: string; supplierItemNumber?: string; size?: string;
    unitPricePence?: number; unitPriceIncVatPence?: number; imageUrl?: string; supplierUrl?: string;
}

/**
 * Pure: the materials run reads the PACK's materials when the pack has any (supplier, size, price
 * as Ben confirmed them), borrowing the image and the buy link from the quote's own line materials
 * where the SKU (else the name) matches. A pack with no materials falls back to the quote's.
 */
export function runMaterialsFromPack(pack: Pick<JobPack, 'lines'> | null | undefined, quoteMaterials: any[]): RunMaterial[] {
    const fromQuote: RunMaterial[] = (quoteMaterials ?? []).filter((m) => m && typeof m === 'object' && m.name).map((m) => ({ ...m }));
    const packMaterials = pack?.lines.flatMap((l) => l.materials) ?? [];
    if (!packMaterials.length) return fromQuote;
    const key = (sku: string | null | undefined, name: string) => (sku ? `sku:${sku}` : `name:${name.toLowerCase().trim()}`);
    const byKey = new Map<string, RunMaterial>();
    for (const q of fromQuote) { byKey.set(key(q.supplierItemNumber, q.name), q); if (q.supplierItemNumber) byKey.set(key(null, q.name), q); }
    return packMaterials.map((m) => {
        const q = byKey.get(key(m.sku, m.name)) ?? byKey.get(key(null, m.name));
        return {
            name: m.name, qty: Math.max(1, m.qty),
            ...(m.supplier ? { supplier: m.supplier } : q?.supplier ? { supplier: q.supplier } : {}),
            ...(m.sku ? { supplierItemNumber: m.sku } : q?.supplierItemNumber ? { supplierItemNumber: q.supplierItemNumber } : {}),
            ...(m.size ? { size: m.size } : {}),
            ...(m.unitPricePence != null ? { unitPricePence: m.unitPricePence } : q?.unitPricePence != null ? { unitPricePence: q.unitPricePence } : {}),
            ...(q?.unitPriceIncVatPence != null && m.unitPricePence == null ? { unitPriceIncVatPence: q.unitPriceIncVatPence } : {}),
            ...(q?.imageUrl ? { imageUrl: q.imageUrl } : {}),
            ...(q?.supplierUrl ? { supplierUrl: q.supplierUrl } : {}),
        };
    });
}
