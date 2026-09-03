/**
 * P13b — back-fill a job pack for a job that was quoted and booked BEFORE the pack existed
 * (docs/comms-build/BRIEF-P13b-backfill-mj.md). Test case: MJ, quote `uhj5jips`, booked as a
 * contractor_booking_requests row with no job_dispatches row.
 *
 * Sources, in this order, all read-only, nothing invented:
 *   1. the quote's pricing_line_items       → lines (title, category, minutes, materials, assumptions,
 *                                              Ben's prices); the quote's site columns → job.floor /
 *                                              hasLift / parkingDistance / occupied
 *   2. quote_estimates (if any)             → procedure, minutes range, materials with supplier, access notes
 *   3. the thread                           → per-line evidence by P12b's `evidenceForLines` ranking,
 *                                              media by time; job fields by the P13 filing rules run over
 *                                              EVERY inbound (a rescope-looking message is never filed)
 *   4. the booking (and dispatch if one exists) → access notes; the lock when the booking is accepted
 *
 * A field with no source stays empty and lands in `missing`. Every diff is a change-log row at
 * `now` (source `system`, by the script), plus ONE marker row per source that changed something;
 * a re-run that changes nothing appends exactly one "re-run: nothing changed" marker. The pack keys on
 * quote_id, which is what the dashboard job page (`/api/jobs/:id` → booking.quoteId →
 * loadPackForQuote) already reads: no schema change.
 *
 * The pure builder is at the top; the reads and the contractor notice are at the bottom.
 */
import {
    applyBenEdits, commit, fieldLabel, linesFromClerk, lock, mergeEstimate, newPack, normaliseJob, PackLockedError,
    type ChangeLogEntry, type ClerkLineInput, type EstimateLineInput, type JobPack, type PackJob, type PackLine,
} from './job-pack';
import { estimateLinesFor } from './job-pack-writers';
import { decideFiling, parseDeliveryAnswer } from './job-pack-filing';
import { evidenceForLines, type PriceScreenThread } from './price-brief';
import type { QuoteEstimate } from './estimate-store';
import { guardContractorBody, readyBody, readyVariables, sendToContractor, READY_TEMPLATE_NAMES, type ContractorSendOutcome, type ContractorTarget, type NotifyDeps } from './job-pack-notify';

// ---------------------------------------------------------------- shapes

export interface BackfillQuote {
    id: string;
    slug: string;
    customerName: string;
    phone: string | null;
    postcode: string | null;
    address: string | null;
    jobDescription: string | null;
    /** personalized_quotes.pricing_line_items as stored (any engine's shape; read tolerantly). */
    pricingLineItems: unknown;
    createdAt: string | null;
    depositPaidAt: string | null;
    floorNumber: number | null;
    hasLift: boolean | null;
    parkingDistanceCategory: string | null;
    customerPresent: boolean | null;
}

export interface BackfillBooking {
    id: string;
    status: string;
    assignmentStatus: string | null;
    acceptedAt: string | null;
    scheduledDate: string | null;
    scheduledSlot: string | null;
    contractorId: string | null;
    contractorName: string | null;
    customerAccessNotes: string | null;
}

export interface BackfillDispatch {
    id: string;
    title: string;
    postcode: string | null;
    scheduledDate: string | null;
    /** contractor_job_links tokens, for the `/contractor-job/<token>` URLs. */
    linkTokens: string[];
}

export interface BackfillSources {
    quote: BackfillQuote;
    conversationId: string | null;
    estimate: QuoteEstimate | null;
    thread: Pick<PriceScreenThread, 'messages' | 'latestInboundId'>;
    booking: BackfillBooking | null;
    dispatch: BackfillDispatch | null;
    /** The pack already stored for this quote, if any (a re-run). */
    existing: JobPack | null;
    by: string;
    now: Date;
}

export type BackfillSource = 'quote' | 'estimate' | 'thread' | 'booking' | 'dispatch';

export interface BackfillResult {
    pack: JobPack;
    created: boolean;
    /** Locked on this run, or already locked from a previous one. */
    locked: boolean;
    lockRef: string | null;
    sources: Array<{ source: BackfillSource; changes: number; note: string }>;
    /** Job fields the thread answered, with the message they came from (the customer's words). */
    filed: Array<{ field: string; value: unknown; messageId: string; at: string; text: string }>;
    /** Inbound messages the filing rules refused (a rescope), for the orchestrator to eyeball. */
    skipped: Array<{ messageId: string; at: string; why: string; text: string }>;
    /** Line fields that differ from the locked pack: NOT written (the variation path owns them). */
    frozenConflicts: string[];
    /** The change-log rows this run appended. */
    appended: ChangeLogEntry[];
    summary: string;
    urls: string[];
}

// ---------------------------------------------------------------- the quote's line items, read tolerantly

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const strs = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max) : []);

export interface QuoteLineItem {
    lineId: string;
    title: string;
    detail: string | null;
    category: string | null;
    minutes: number | null;
    materials: NonNullable<EstimateLineInput['materials']>;
    assumptions: string[];
    exclusions: string[];
    pricePence: number | null;
    materialsPence: number | null;
    supplyBy: 'us' | 'customer' | 'none' | null;
}

const CUSTOMER_SUPPLIES = /\b(customer[- ]?supplied|supplied by (?:the )?customer|customer to supply|their own|own materials)\b/i;
const LABOUR_ONLY = /\b(labour only|labor only|fit only|fitting only|install only)\b/i;
const WE_SUPPLY = /\b(supply|supplied|supplying|source)\b/i;

/** Pure: who supplies, read from the line's own words ("Supply and fit" says we do). Null when the title does not say. */
export function supplyByFromTitle(title: string): QuoteLineItem['supplyBy'] {
    if (CUSTOMER_SUPPLIES.test(title)) return 'customer';
    if (LABOUR_ONLY.test(title)) return 'none';
    if (WE_SUPPLY.test(title)) return 'us';
    return null;
}

/**
 * Pure: pricing_line_items → one plain shape, whatever engine wrote them. Ids follow P13's
 * derivePricingLineItems rule (`lineId`, else position `card_N`) so a re-run keys the same lines.
 * Ben's override wins over the engine's estimate for time and price.
 */
export function readQuoteLineItems(raw: unknown): QuoteLineItem[] {
    const arr = Array.isArray(raw) ? raw.filter((x) => x && typeof x === 'object') : [];
    return arr.map((x: any, i: number) => {
        const title = str(x.label) ?? str(x.title) ?? str(x.description) ?? str(x.name) ?? `Line ${i + 1}`;
        const description = str(x.description);
        const materials = (Array.isArray(x.materials) ? x.materials : []).filter((m: any) => m && typeof m === 'object' && str(m.name)).map((m: any) => ({
            name: str(m.name)!, qty: Math.max(1, int(m.qty) ?? int(m.quantity) ?? 1),
            unitCostPence: int(m.unitPricePence) ?? int(m.unitCostPence) ?? int(m.pricePence) ?? 0,
            source: str(m.supplier) ?? str(m.source) ?? undefined, supplierItemNumber: str(m.supplierItemNumber) ?? str(m.sku) ?? null, catalogId: str(m.catalogId) ?? null, size: str(m.size) ?? null,
        }));
        const guarded = int(x.guardedPricePence);
        const withMargin = int(x.materialsWithMarginPence);
        const pricePence = int(x.priceOverridePence) ?? int(x.pricePence) ?? (guarded != null ? guarded + (withMargin ?? 0) : null) ?? int(x.finalPence);
        return {
            lineId: str(x.lineId) ?? `card_${i + 1}`,
            title,
            detail: description && description !== title ? description : null,
            category: str(x.category),
            minutes: int(x.timeOverrideMinutes) ?? int(x.timeEstimateMinutes) ?? int(x.scheduleMinutes),
            materials,
            assumptions: strs(x.assumptions, 8),
            exclusions: strs(x.exclusions, 8),
            pricePence,
            materialsPence: withMargin ?? int(x.materialsPence) ?? int(x.materialsCostPence) ?? (pricePence != null && materials.length === 0 ? 0 : null),
            supplyBy: supplyByFromTitle(title),
        };
    });
}

// ---------------------------------------------------------------- the lock for a booking

/**
 * Pure: lock the pack for a booked job. With a dispatch it is P13's `lock` (dispatch_id set); without
 * one, `dispatch_id` stays null and the lock row records `booking:<id>` so the reader knows what
 * froze it. Idempotent: the same reference locks once.
 */
export function lockForJob(pack: JobPack, ref: { bookingId: string; dispatchId: string | null }, by: string, at: Date): JobPack {
    if (ref.dispatchId) return lock(pack, ref.dispatchId, by, at);
    if (pack.lockedAt && !pack.dispatchId) return pack;
    const iso = at.toISOString();
    return {
        ...pack, lockedAt: iso, dispatchId: null, updatedAt: iso,
        changeLog: [...pack.changeLog, { at: iso, field: 'lock', from: pack.dispatchId, to: `booking:${ref.bookingId}`, by, source: 'dispatch' }],
    };
}

// ---------------------------------------------------------------- the builder

const NOTE: Record<BackfillSource, string> = {
    quote: 'backfilled from quote lines', estimate: 'backfilled from estimate', thread: 'backfilled from thread', booking: 'backfilled from booking', dispatch: 'backfilled from dispatch',
};

/** A commit that survives a locked pack: job.* still lands, frozen line fields are reported, never written. */
function safeCommit(pack: JobPack, next: { lines?: PackLine[]; job?: PackJob }, by: string, at: Date, frozen: string[]): JobPack {
    try {
        return commit(pack, next, by, 'system', at);
    } catch (e) {
        if (!(e instanceof PackLockedError)) throw e;
        for (const f of e.fields) if (!frozen.includes(f)) frozen.push(f);
        return next.job ? commit(pack, { job: next.job }, by, 'system', at) : pack;
    }
}

function isAccepted(b: BackfillBooking): boolean {
    return !!b.acceptedAt || b.status === 'accepted' || ['accepted', 'in_progress', 'completed'].includes(String(b.assignmentStatus ?? ''));
}

/** Pure: the whole pack from the four sources. Deterministic: the same sources build the same pack. */
export function buildBackfillPack(src: BackfillSources): BackfillResult {
    const { now, by } = src;
    const frozen: string[] = [];
    const sources: BackfillResult['sources'] = [];
    const filed: BackfillResult['filed'] = [];
    const skipped: BackfillResult['skipped'] = [];
    const startLen = src.existing?.changeLog.length ?? 0;

    const usableEstimate = src.estimate && src.estimate.status !== 'failed' ? src.estimate : null;
    let pack: JobPack = src.existing ?? newPack({ quoteId: src.quote.id, conversationId: src.conversationId, estimateId: usableEstimate?.id ?? null, now });
    if (src.conversationId && !pack.conversationId) pack = { ...pack, conversationId: src.conversationId };
    const step = (source: BackfillSource, next: { lines?: PackLine[]; job?: PackJob }): void => {
        const before = pack.changeLog.length;
        pack = safeCommit(pack, next, by, now, frozen);
        const changes = pack.changeLog.length - before;
        sources.push({ source, changes, note: changes ? NOTE[source] : 'nothing new' });
    };

    // 1. the quote: lines, Ben's prices, the site columns
    const items = readQuoteLineItems(src.quote.pricingLineItems);
    const clerk: ClerkLineInput[] = items.map((i) => ({
        lineId: i.lineId, title: i.title, detail: i.detail, assumptions: i.assumptions, category: i.category, exclusions: i.exclusions, supplyBy: i.supplyBy,
    }));
    let lines = linesFromClerk(pack.lines, clerk);
    lines = mergeEstimate(lines, items.map((i) => ({ lineId: i.lineId, category: i.category, minutesPoint: i.minutes ?? undefined, materials: i.materials })), null).lines;
    lines = applyBenEdits(lines, items.filter((i) => i.pricePence != null).map((i) => ({ lineId: i.lineId, finalPence: i.pricePence!, materialsPence: i.materialsPence ?? 0 })));
    const q = src.quote;
    let job: PackJob = normaliseJob({
        ...pack.job,
        floor: q.floorNumber ?? pack.job.floor, hasLift: q.hasLift ?? pack.job.hasLift,
        parkingDistance: q.parkingDistanceCategory ?? pack.job.parkingDistance, occupied: q.customerPresent ?? pack.job.occupied,
    });
    step('quote', { lines, job });

    // 2. the estimate, when the chain ran on this thread (lines matched by id; access notes always)
    if (usableEstimate) {
        const est = estimateLinesFor(usableEstimate);
        const merged = mergeEstimate(pack.lines, est, usableEstimate.job);
        job = { ...pack.job, accessNotes: Array.from(new Set([...pack.job.accessNotes, ...merged.accessNotes])).slice(0, 12) };
        if (!pack.estimateId) pack = { ...pack, estimateId: usableEstimate.id };
        step('estimate', { lines: merged.lines, job });
    }

    // 3. the thread: her words under each line, photos by time, the delivery answers by the filing rules
    const inbound = src.thread.messages.filter((m) => m.direction === 'in');
    const evidence = evidenceForLines(pack.lines.map((l) => ({ title: l.title, notes: l.detail, category: l.category })), src.thread);
    const allMedia = inbound.filter((m) => m.media).map((m) => m.id);
    lines = pack.lines.map((l, i) => {
        const ev = evidence[i];
        const media = ev.media.map((m) => m.messageId);
        // A one-line job has nothing else the photos could show: every inbound photo sits under it.
        const mediaIds = Array.from(new Set(pack.lines.length === 1 ? [...media, ...allMedia] : media)).slice(0, 12);
        return { ...l, evidence: ev.quotes.filter((x) => x.text).slice(0, 3).map((x) => ({ messageId: x.messageId, text: x.text })), mediaIds };
    });
    let jobRaw: Record<string, unknown> = { ...pack.job };
    for (const m of [...inbound].sort((a, b) => a.at.localeCompare(b.at))) {
        const text = m.body.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const verdict = decideFiling(text, parseDeliveryAnswer(text));
        if (verdict.kind === 'rescope') { if (parseDeliveryAnswer(text)) skipped.push({ messageId: m.id, at: m.at, why: verdict.why, text: text.slice(0, 200) }); continue; }
        if (verdict.kind !== 'filed') continue;
        const key = verdict.answer.field.slice(4);
        jobRaw = { ...jobRaw, [key]: verdict.answer.value };
        filed.push({ field: verdict.answer.field, value: verdict.answer.value, messageId: m.id, at: m.at, text: text.slice(0, 200) });
    }
    step('thread', { lines, job: normaliseJob(jobRaw) });

    // 4. the booking (access notes; the lock when accepted) and the dispatch if one exists
    let lockRef: string | null = null;
    if (src.booking) {
        const b = src.booking;
        let changes = 0;
        const notes = str(b.customerAccessNotes);
        if (notes) {
            const before = pack.changeLog.length;
            pack = safeCommit(pack, { job: { ...pack.job, accessNotes: Array.from(new Set([...pack.job.accessNotes, notes])).slice(0, 12) } }, by, now, frozen);
            changes += pack.changeLog.length - before;
        }
        let note = changes ? NOTE.booking : 'no access notes on the booking';
        if (isAccepted(b)) {
            const before = pack.changeLog.length;
            pack = lockForJob(pack, { bookingId: b.id, dispatchId: src.dispatch?.id ?? null }, by, now);
            lockRef = src.dispatch?.id ?? `booking:${b.id}`;
            const lockChanges = pack.changeLog.length - before;
            if (src.dispatch) sources.push({ source: 'dispatch', changes: lockChanges, note: lockChanges ? `${NOTE.dispatch} (locked)` : 'already locked to this dispatch' });
            else if (lockChanges) { changes += lockChanges; note = `${NOTE.booking} (locked: booking accepted)`; }
            else note = `${note}; already locked`;
        } else {
            note = `${note}; not locked: booking is ${b.status} / ${b.assignmentStatus ?? 'unassigned'}`;
        }
        sources.push({ source: 'booking', changes, note });
    } else if (src.dispatch) {
        const before = pack.changeLog.length;
        pack = lock(pack, src.dispatch.id, by, now);
        lockRef = src.dispatch.id;
        const changes = pack.changeLog.length - before;
        sources.push({ source: 'dispatch', changes, note: changes ? `${NOTE.dispatch} (locked)` : 'already locked to this dispatch' });
    }

    // markers: one per source that changed something; exactly one when nothing did
    const iso = now.toISOString();
    const markers: ChangeLogEntry[] = sources.filter((s) => s.changes > 0).map((s) => ({ at: iso, field: 'backfill', from: null, to: NOTE[s.source], by, source: 'system' as const }));
    if (!markers.length) markers.push({ at: iso, field: 'backfill', from: null, to: src.existing ? 're-run: nothing changed' : 'nothing to back-fill', by, source: 'system' as const });
    pack = { ...pack, changeLog: [...pack.changeLog, ...markers], updatedAt: iso };

    const missingWords = pack.missing.map((f) => fieldLabel(f, pack.lines));
    const summary = `pack for ${src.quote.slug}: ${pack.lines.length} line${pack.lines.length === 1 ? '' : 's'}, ${pack.required.length} required, ${pack.missing.length} missing${missingWords.length ? `: ${missingWords.join(', ')}` : ''}`;
    const urls: string[] = [];
    if (src.booking) urls.push(`/contractor/dashboard/jobs/${src.booking.id}`);
    for (const t of src.dispatch?.linkTokens ?? []) urls.push(`/contractor-job/${t}`);

    return {
        pack, created: !src.existing, locked: !!pack.lockedAt, lockRef: lockRef ?? (pack.lockedAt ? pack.dispatchId ?? 'booking (earlier run)' : null),
        sources, filed, skipped, frozenConflicts: frozen, appended: pack.changeLog.slice(startLen), summary, urls,
    };
}

// ---------------------------------------------------------------- the dry-run report (pure)

const money = (p: number | null | undefined) => (p == null ? '—' : `£${(p / 100).toFixed(2)}`);

export function renderBackfillReport(r: BackfillResult, opts: { mode: 'dry-run' | 'apply' } = { mode: 'dry-run' }): string {
    const out: string[] = [];
    const p = r.pack;
    out.push(`${opts.mode === 'dry-run' ? 'DRY RUN — the pack that WOULD be written' : 'APPLIED'} for quote ${p.quoteId} (${r.created ? 'new pack' : `existing pack ${p.id}`})`);
    out.push(`conversation: ${p.conversationId ?? '—'}   estimate: ${p.estimateId ?? '— (none: quote predates Route A)'}   lock: ${r.locked ? r.lockRef ?? 'yes' : 'no'}`);
    out.push('');
    out.push(`LINES (${p.lines.length})`);
    p.lines.forEach((l, i) => {
        out.push(`  ${i + 1}. [${l.lineId}] ${l.title}`);
        out.push(`     category ${l.category ?? '—'} · minutes ${l.minutesLow ?? '—'}/${l.minutesPoint ?? '—'}/${l.minutesHigh ?? '—'} · price ${money(l.pricePence)} (labour ${money(l.labourPence)}, materials ${money(l.materialsPence)}) · supply-by ${l.supplyBy ?? '—'}`);
        if (l.detail) out.push(`     detail: ${l.detail}`);
        for (const e of l.evidence) out.push(`     her words (${e.messageId}): "${e.text}"`);
        if (l.mediaIds.length) out.push(`     media: ${l.mediaIds.length} (${l.mediaIds.join(', ')})`);
        if (l.procedure.length) out.push(`     procedure: ${l.procedure.join(' → ')}`);
        if (l.assumptions.length) out.push(`     assumptions: ${l.assumptions.join(' | ')}`);
        if (l.exclusions.length) out.push(`     exclusions: ${l.exclusions.join(' | ')}`);
        if (l.materials.length) out.push(`     materials: ${l.materials.map((m) => `${m.qty}× ${m.name}${m.supplier ? ` (${m.supplier}${m.sku ? ` ${m.sku}` : ''})` : ''}${m.unitPricePence != null ? ` @ ${money(m.unitPricePence)}` : ''}`).join('; ')}`);
        if (l.hazards.length) out.push(`     hazards: ${l.hazards.join(', ')}`);
        for (const [k, v] of [['sizes', l.sizes], ['spec', l.spec], ['disposal', l.disposal], ['lead time', l.leadTime]] as const) if (v) out.push(`     ${k}: ${v}`);
    });
    out.push('');
    out.push('JOB');
    const j = p.job;
    const show = (k: string, v: unknown) => out.push(`  ${k.padEnd(16)} ${v == null || v === '' || (Array.isArray(v) && !v.length) ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    show('access method', j.accessMethod); show('access codes', j.accessCodes ? '(set)' : null); show('on-site contact', j.onSiteContact); show('floor / lift', j.floor == null && j.hasLift == null ? null : `${j.floor ?? '—'} / ${j.hasLift ?? '—'}`);
    show('parking', j.parkingDistance); show('permit', j.parkingPermit); show('occupied', j.occupied); show('pets', j.pets); show('prep', j.prep); show('utilities', j.utilities); show('delivery slot', j.deliverySlot); show('done looks like', j.doneLooksLike); show('access notes', j.accessNotes);
    out.push('');
    out.push(`REQUIRED (${p.required.length}): ${p.required.join(', ') || '—'}`);
    out.push(`MISSING (${p.missing.length}): ${p.missing.map((f) => `${f} (${fieldLabel(f, p.lines)})`).join(', ') || '—'}`);
    out.push('');
    out.push('FILED FROM THE THREAD');
    if (!r.filed.length) out.push('  (nothing: no inbound answered a delivery question)');
    for (const f of r.filed) out.push(`  ${f.field} ← ${f.messageId} @ ${f.at}: "${f.text}"`);
    if (r.skipped.length) { out.push('NOT FILED (rescope-looking, left for Ben)'); for (const s of r.skipped) out.push(`  ${s.messageId} @ ${s.at}: "${s.text}" (${s.why})`); }
    if (r.frozenConflicts.length) { out.push(''); out.push(`FROZEN — the pack is locked and these line fields differ from the sources; NOT written (variation path): ${r.frozenConflicts.join(', ')}`); }
    out.push('');
    out.push(`SOURCES: ${r.sources.map((s) => `${s.source} (${s.changes} change${s.changes === 1 ? '' : 's'}: ${s.note})`).join('; ')}`);
    out.push(`CHANGE LOG — ${r.appended.length} row${r.appended.length === 1 ? '' : 's'} this run (${p.changeLog.length} total)`);
    for (const e of r.appended) out.push(`  ${e.at} ${e.source.padEnd(8)} ${e.field}${e.field === 'backfill' || e.field === 'lock' ? ` → ${JSON.stringify(e.to)}` : ''}`);
    out.push('');
    out.push(r.summary);
    if (r.urls.length) out.push(`open: ${r.urls.join('  ')}`);
    return out.join('\n');
}

// ---------------------------------------------------------------- the contractor notice for a booking (no dispatch)

/** Pure: the title the notice carries: the first line's words, cut at a word, "+ N more" for the rest. Never money, never a name. */
export function bookingNoticeTitle(lines: Array<Pick<PackLine, 'title'>>, max = 60): string {
    const first = (lines[0]?.title ?? 'your job').replace(/\s+/g, ' ').trim();
    let head = first;
    if (head.length > max) { const cut = head.slice(0, max); head = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).trim()}…`; }
    return lines.length > 1 ? `${head} + ${lines.length - 1} more` : head;
}

const BASE = () => (process.env.PUBLIC_BASE_URL || 'https://handyservices.app').replace(/\/$/, '');

export interface BookingNoticeInput {
    bookingId: string;
    contractor: { id: string; name: string | null; phone: string | null };
    lines: Array<Pick<PackLine, 'title'>>;
    postcode: string | null;
    scheduledDate: string | Date | null;
    customer: { firstName?: string | null; fullName?: string | null };
}

/**
 * `job_pack_ready` for a booking with no dispatch: the same body, guard and pipe as P13 part 4
 * (window → freeform; approved template; else queued for Ben), the link being the contractor's
 * dashboard job page rather than a dispatch token.
 */
export async function notifyJobPackReadyForBooking(input: BookingNoticeInput, deps: NotifyDeps): Promise<ContractorSendOutcome> {
    const target: ContractorTarget = { contractorId: input.contractor.id, name: input.contractor.name, phone: input.contractor.phone, link: `${BASE()}/contractor/dashboard/jobs/${input.bookingId}` };
    const i = { title: bookingNoticeTitle(input.lines), postcode: input.postcode, date: input.scheduledDate, link: target.link };
    const body = readyBody(i);
    const bad = guardContractorBody(body, input.customer);
    if (bad.length) return { phone: target.phone ?? '', sent: false, mode: 'skipped', reason: `guard: ${bad.join(', ')}` };
    return sendToContractor('job_pack_ready', target, body, READY_TEMPLATE_NAMES, readyVariables(i), `booking:${input.bookingId}`, deps);
}

// ---------------------------------------------------------------- reads (the script's loaders)

export interface LoadedSources extends Omit<BackfillSources, 'by' | 'now'> {
    contractor: { id: string; name: string | null; phone: string | null } | null;
    /** Null when the job_packs table is absent (migration 20260906_job_packs not applied). */
    packTablePresent: boolean;
}

function digits(phone: string | null | undefined): string {
    return String(phone ?? '').replace(/\D/g, '');
}

/** Everything the builder needs for one quote, by short slug or id. Read-only. */
export async function loadBackfillSources(slugOrId: string, opts: { conversationId?: string | null; bookingId?: string | null } = {}): Promise<LoadedSources> {
    const { db } = await import('../db');
    const { personalizedQuotes, contractorBookingRequests, handymanProfiles, users, jobDispatches, contractorJobLinks, conversations, quoteEstimates } = await import('@shared/schema');
    const { and, desc, eq, isNull, ne, sql } = await import('drizzle-orm');

    const [qrow] = await db.select().from(personalizedQuotes).where(slugOrId.startsWith('quote_') ? eq(personalizedQuotes.id, slugOrId) : eq(personalizedQuotes.shortSlug, slugOrId)).limit(1);
    if (!qrow) throw new Error(`no quote for "${slugOrId}"`);
    const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
    const quote: BackfillQuote = {
        id: qrow.id, slug: qrow.shortSlug, customerName: qrow.customerName, phone: qrow.phone ?? null, postcode: qrow.postcode ?? null, address: qrow.address ?? null,
        jobDescription: qrow.jobDescription ?? null, pricingLineItems: qrow.pricingLineItems, createdAt: iso(qrow.createdAt), depositPaidAt: iso(qrow.depositPaidAt),
        floorNumber: qrow.floorNumber ?? null, hasLift: qrow.hasLift ?? null, parkingDistanceCategory: qrow.parkingDistanceCategory ?? null, customerPresent: qrow.customerPresent ?? null,
    };

    // The thread: by the quote's phone against conversations.phone_number (customer lane, newest), unless given.
    let conversationId: string | null = opts.conversationId ?? null;
    if (!conversationId) {
        const d = digits(quote.phone);
        if (d.length >= 10) {
            const [c] = await db.select({ id: conversations.id }).from(conversations)
                .where(and(eq(conversations.roleProfile, 'customer'), sql`right(regexp_replace(${conversations.phoneNumber}, '[^0-9]', '', 'g'), 10) = ${d.slice(-10)}`))
                .orderBy(desc(conversations.lastMessageAt)).limit(1);
            conversationId = c?.id ?? null;
        }
    }
    const { loadThread } = await import('./price-brief');
    const thread = await loadThread(conversationId);

    // The estimate: the one that drafted this quote, else the newest live one on the thread.
    const { getEstimate, latestEstimateForConversation } = await import('./estimate-store');
    let estimate: QuoteEstimate | null = null;
    const [erow] = await db.select({ id: quoteEstimates.id }).from(quoteEstimates).where(and(eq(quoteEstimates.draftQuoteId, quote.id), isNull(quoteEstimates.supersededAt))).orderBy(desc(quoteEstimates.createdAt)).limit(1);
    if (erow) estimate = await getEstimate(erow.id);
    else if (conversationId) estimate = await latestEstimateForConversation(conversationId);

    // The booking: the given one, else the accepted one for this quote, else the newest.
    const brows = await db.select().from(contractorBookingRequests)
        .where(opts.bookingId ? eq(contractorBookingRequests.id, opts.bookingId) : eq(contractorBookingRequests.quoteId, quote.id))
        .orderBy(desc(contractorBookingRequests.createdAt)).limit(10);
    const brow = brows.find((b) => b.status === 'accepted' || b.acceptedAt) ?? brows[0] ?? null;
    let booking: BackfillBooking | null = null;
    let contractor: LoadedSources['contractor'] = null;
    if (brow) {
        const contractorId = brow.assignedContractorId ?? brow.contractorId ?? null;
        if (contractorId) {
            const [p] = await db.select({ id: handymanProfiles.id, businessName: handymanProfiles.businessName, whatsappNumber: handymanProfiles.whatsappNumber, firstName: users.firstName, lastName: users.lastName, userPhone: users.phone })
                .from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id)).where(eq(handymanProfiles.id, contractorId)).limit(1);
            if (p) contractor = { id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.businessName || null, phone: p.whatsappNumber || p.userPhone || null };
        }
        booking = {
            id: brow.id, status: brow.status, assignmentStatus: brow.assignmentStatus ?? null, acceptedAt: iso(brow.acceptedAt), scheduledDate: iso(brow.scheduledDate),
            scheduledSlot: brow.scheduledSlot ?? brow.requestedSlot ?? null, contractorId, contractorName: contractor?.name ?? null, customerAccessNotes: brow.customerAccessNotes ?? null,
        };
    }

    // The dispatch, only if one exists.
    let dispatch: BackfillDispatch | null = null;
    const [drow] = await db.select({ id: jobDispatches.id, title: jobDispatches.title, postcode: jobDispatches.postcode, scheduledDate: jobDispatches.scheduledDate })
        .from(jobDispatches).where(and(eq(jobDispatches.quoteId, quote.id), ne(jobDispatches.status, 'cancelled'))).orderBy(desc(jobDispatches.createdAt)).limit(1);
    if (drow) {
        const links = await db.select({ token: contractorJobLinks.token }).from(contractorJobLinks).where(eq(contractorJobLinks.dispatchId, drow.id));
        dispatch = { id: drow.id, title: drow.title, postcode: drow.postcode ?? null, scheduledDate: iso(drow.scheduledDate), linkTokens: links.map((l) => l.token) };
    }

    // The pack already there, if the table is.
    const { getPackForQuote, isMissingTable } = await import('./job-pack');
    let existing: JobPack | null = null;
    let packTablePresent = true;
    try { existing = await getPackForQuote(quote.id); } catch (e: any) { if (!isMissingTable(e)) throw e; packTablePresent = false; }

    return { quote, conversationId, estimate, thread, booking, dispatch, existing, contractor, packTablePresent };
}
