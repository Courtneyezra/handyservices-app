/**
 * P15 part 3 (docs/comms-build/BRIEF-P15-contractor-loop.md): an extra the contractor finds at the
 * door is a VARIATION, priced by Route A and confirmed by Ben. Never a price from a model, never a
 * price from the contractor, never a price agreed at the door.
 *
 *   contractor  → "Customer wants something extra": title, notes, photo (job drawer, Part 3 UI)
 *   server      → a dispatch_variations row (existing table) AND a clerk-shaped intake line
 *   Route A     → the SAME estimator + engine as a first quote (variation-route-a.ts): minutes and
 *                 materials from the estimator, the price from the engine, a band, check-this
 *   Ben         → Pushover "Variation to price" → /admin/price/variation/:id → accept / edit / send
 *   on send     → the customer gets a short message with the quote link (the existing quote-link
 *                 path — the line is on the quote by then), the pack gains the line LOCKED, the
 *                 contractor's pay moves through the existing pay engine, the contractor is told
 *
 * No migration: dispatch_variations already carries the description, the photos, the price, the
 * minutes and the status. The Route A brief rides in `admin_notes` as a JSON envelope under `p15`
 * (the P12 precedent — Ben's hold rides in pricing_suggestions.hold), so a human's plain note is
 * kept alongside it under `note` and never clobbered.
 *
 * Everything that decides is pure and tested; the store at the bottom does the reads and writes.
 */
import { computeContractorPay } from '../lib/contractor-pay';
import { stripChatDashes, toChatVoice } from '@shared/chat-voice';
import { emptyLine, missingFor, requiredFor, type ChangeLogEntry, type JobPack, type PackLine } from './job-pack';
import type { LineSuggestion } from './pricing-bridge';

// ---------------------------------------------------------------- shapes

export type VariationStatus = 'pending' | 'approved' | 'rejected';

/** What the contractor typed in the job drawer, cleaned. */
export interface ExtraRequest {
    title: string;
    notes: string | null;
    photoUrls: string[];
}

/** The Route A result for the one extra line, as it is stored and shown on the price screen. */
export interface VariationBrief {
    /** personalized_quotes.id the extra belongs to (the pack's quote). */
    quoteId: string | null;
    /** contractor_booking_requests.id the contractor reported it from. */
    bookingId: string | null;
    /** The pack line id this extra becomes on send. */
    lineId: string;
    estimateId: string | null;
    /** Non-null when the estimator failed and the line was priced from reference rates. */
    estimatorFailed: string | null;
    suggestion: PricedSuggestion | null;
    /** Set on send: what Ben actually charged, who sent it, and what it moved the contractor's pay by. */
    sentAt: string | null;
    sentBy: string | null;
    sentPricePence: number | null;
    payDeltaPence: number | null;
    runId: string | null;
    /** A human's own free-text admin note, preserved through every envelope write. */
    note: string | null;
}

/** The engine's answer for one line, flattened to what the one-line screen renders. */
export interface PricedSuggestion {
    lineId: string;
    title: string;
    category: string;
    suggestedPence: number;
    bandLowPence: number;
    bandHighPence: number;
    checkThis: boolean;
    reason: string | null;
    minutes: number;
    materialsPence: number;
    materialsWithMarginPence: number;
    labourPence: number;
}

/** A dispatch_variations row, in the shape this module reasons about. */
export interface VariationRow {
    id: string;
    dispatchId: string;
    contractorId: string;
    description: string;
    reason: string | null;
    additionalPricePence: number;
    additionalTimeMins: number;
    photoUrls: string[];
    status: VariationStatus;
    adminNotes: string | null;
    createdAt: string;
}

// ---------------------------------------------------------------- the contractor's ask (pure)

export const MAX_EXTRA_TITLE = 120;
export const MAX_EXTRA_NOTES = 800;
export const MAX_EXTRA_PHOTOS = 4;

/**
 * Pure: what the contractor typed, cleaned into something the clerk-shaped line can carry. He is
 * describing work, not pricing it: a price anywhere in the title or the notes is refused, because a
 * number typed at the door is exactly the promise this whole path exists to stop him making.
 */
export function validateExtra(body: unknown): { ok: true; extra: ExtraRequest } | { ok: false; errors: string[] } {
    const b = (body ?? {}) as Record<string, unknown>;
    const errors: string[] = [];
    const title = String(b.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRA_TITLE);
    const notes = String(b.notes ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_EXTRA_NOTES) || null;
    if (!title) errors.push('Say in a few words what the extra is.');
    if (title && title.length < 3) errors.push('Say in a few words what the extra is.');
    const money = /(?:£|\bgbp\b|\$)\s?\d|\b\d+\s?(?:quid|pounds)\b/i;
    if (money.test(title) || (notes && money.test(notes))) {
        errors.push('No prices here. Describe the work and the office prices it.');
    }
    const photoUrls = (Array.isArray(b.photoUrls) ? b.photoUrls : [])
        .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
        .slice(0, MAX_EXTRA_PHOTOS);
    if (errors.length) return { ok: false, errors };
    return { ok: true, extra: { title, notes, photoUrls } };
}

/** Pure: the pack line id an extra becomes. Deterministic, so a retry never doubles the line. */
export function variationLineId(variationId: string): string {
    return `var_${String(variationId).replace(/^dv_/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'x'}`;
}

/**
 * Pure: the clerk-shaped intake line Route A estimates. The contractor's own words are the detail
 * (the same contract the clerk's evidence has: his words, not our paraphrase), and no category is
 * asserted — the estimator picks one, exactly as it does for a first quote.
 */
export function clerkLineForExtra(variationId: string, extra: ExtraRequest): { lineId: string; title: string; detail: string | null; category: string | null; assumptions: string[] } {
    return {
        lineId: variationLineId(variationId),
        title: extra.title,
        detail: extra.notes,
        category: null,
        assumptions: [],
    };
}

// ---------------------------------------------------------------- the admin_notes envelope (pure)

export function emptyBrief(): VariationBrief {
    return { quoteId: null, bookingId: null, lineId: '', estimateId: null, estimatorFailed: null, suggestion: null, sentAt: null, sentBy: null, sentPricePence: null, payDeltaPence: null, runId: null, note: null };
}

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/**
 * Pure: read the Route A brief out of admin_notes. Tolerates every shape it could be in — the JSON
 * envelope, a human's plain sentence typed in the admin UI, empty, or unparseable — because
 * admin_notes is a free-text column that predates this path.
 */
export function readBrief(adminNotes: string | null | undefined): VariationBrief {
    const base = emptyBrief();
    const raw = String(adminNotes ?? '').trim();
    if (!raw) return base;
    if (!raw.startsWith('{')) return { ...base, note: raw };
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return { ...base, note: raw }; }
    const p = parsed?.p15;
    if (!p || typeof p !== 'object') return { ...base, note: s(parsed?.note) ?? raw };
    const sug = p.suggestion && typeof p.suggestion === 'object' ? p.suggestion : null;
    return {
        quoteId: s(p.quoteId), bookingId: s(p.bookingId), lineId: s(p.lineId) ?? '',
        estimateId: s(p.estimateId), estimatorFailed: s(p.estimatorFailed),
        suggestion: sug ? {
            lineId: String(sug.lineId ?? ''), title: String(sug.title ?? ''), category: String(sug.category ?? 'other'),
            suggestedPence: n(sug.suggestedPence) ?? 0, bandLowPence: n(sug.bandLowPence) ?? 0, bandHighPence: n(sug.bandHighPence) ?? 0,
            checkThis: !!sug.checkThis, reason: s(sug.reason),
            minutes: n(sug.minutes) ?? 0, materialsPence: n(sug.materialsPence) ?? 0,
            materialsWithMarginPence: n(sug.materialsWithMarginPence) ?? 0, labourPence: n(sug.labourPence) ?? 0,
        } : null,
        sentAt: s(p.sentAt), sentBy: s(p.sentBy), sentPricePence: n(p.sentPricePence), payDeltaPence: n(p.payDeltaPence),
        runId: s(p.runId), note: s(p.note),
    };
}

/** Pure: merge a patch into the brief and render admin_notes back. A human's note survives. */
export function writeBrief(adminNotes: string | null | undefined, patch: Partial<VariationBrief>): string {
    const next: VariationBrief = { ...readBrief(adminNotes), ...patch };
    return JSON.stringify({ p15: next });
}

/** Pure: flatten the engine's LineSuggestion to what the one-line screen and the pack need. */
export function suggestionFrom(line: LineSuggestion): PricedSuggestion {
    return {
        lineId: line.lineId, title: line.title, category: line.category,
        suggestedPence: line.suggestedPence, bandLowPence: line.bandLowPence, bandHighPence: line.bandHighPence,
        checkThis: line.checkThis, reason: line.reason,
        minutes: line.basis.minutes, materialsPence: line.basis.materialsPence,
        materialsWithMarginPence: line.basis.materialsWithMarginPence, labourPence: line.basis.labourPence,
    };
}

// ---------------------------------------------------------------- the one-line price screen (pure)

export interface VariationScreen {
    available: true;
    id: string;
    status: VariationStatus;
    /** 'to_price' | 'sent' — a sent variation is read-only, like a sent quote. */
    stage: 'to_price' | 'sent';
    dispatchId: string;
    quoteId: string | null;
    bookingId: string | null;
    contractor: { id: string; name: string | null };
    customer: { firstName: string; phone: string | null };
    jobTitle: string | null;
    /** His words, unedited. */
    title: string;
    notes: string | null;
    photoUrls: string[];
    reportedAt: string;
    suggestion: PricedSuggestion | null;
    estimatorFailed: string | null;
    /** What Ben's box opens at: the suggestion, or what he already sent. */
    defaultPence: number | null;
    sent: { at: string; by: string | null; pricePence: number; payDeltaPence: number | null } | null;
    /** The message the customer will read, with the link appended by the send path. */
    messagePreview: string;
    quoteUrl: string | null;
}

export interface ScreenContext {
    contractorName: string | null;
    customerFirstName: string | null;
    customerPhone: string | null;
    jobTitle: string | null;
    quoteUrl: string | null;
}

/** Pure: everything the one-line price screen renders. Read-only — nothing here prices or writes. */
export function variationScreen(row: VariationRow, ctx: ScreenContext): VariationScreen {
    const brief = readBrief(row.adminNotes);
    const sent = brief.sentAt && brief.sentPricePence != null;
    const firstName = (ctx.customerFirstName ?? '').trim().split(/\s+/)[0] || 'there';
    const price = sent ? brief.sentPricePence! : brief.suggestion?.suggestedPence ?? null;
    return {
        available: true,
        id: row.id,
        status: row.status,
        stage: sent ? 'sent' : 'to_price',
        dispatchId: row.dispatchId,
        quoteId: brief.quoteId,
        bookingId: brief.bookingId,
        contractor: { id: row.contractorId, name: ctx.contractorName },
        customer: { firstName, phone: ctx.customerPhone },
        jobTitle: ctx.jobTitle,
        title: row.description,
        notes: row.reason,
        photoUrls: row.photoUrls ?? [],
        reportedAt: row.createdAt,
        suggestion: brief.suggestion,
        estimatorFailed: brief.estimatorFailed,
        defaultPence: price,
        sent: sent ? { at: brief.sentAt!, by: brief.sentBy, pricePence: brief.sentPricePence!, payDeltaPence: brief.payDeltaPence } : null,
        messagePreview: extraMessage({ firstName, title: row.description, pricePence: price ?? 0 }),
        quoteUrl: ctx.quoteUrl,
    };
}

// ---------------------------------------------------------------- Ben's send (pure)

export const MAX_VARIATION_PENCE = 2_000_00;

/**
 * Pure: Ben's price, checked the way the quote price screen checks his. A price outside the band is
 * allowed (the band is advice, he is the decision) but a nonsense one is not.
 */
export function validateSend(body: unknown, screen: Pick<VariationScreen, 'stage' | 'defaultPence'>): { ok: true; finalPence: number } | { ok: false; status: number; errors: string[] } {
    if (screen.stage === 'sent') return { ok: false, status: 409, errors: ['This extra has already been sent.'] };
    const raw = (body as any)?.finalPence;
    const finalPence = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : null;
    if (finalPence == null) return { ok: false, status: 400, errors: ['Set a price for the extra.'] };
    if (finalPence <= 0) return { ok: false, status: 400, errors: ['The price must be more than nothing.'] };
    if (finalPence > MAX_VARIATION_PENCE) return { ok: false, status: 400, errors: [`£${(MAX_VARIATION_PENCE / 100).toLocaleString('en-GB')} is the ceiling for an extra. Anything bigger is a new quote.`] };
    return { ok: true, finalPence };
}

const pounds = (p: number): string => (p % 100 === 0 ? `£${(p / 100).toLocaleString('en-GB')}` : `£${(p / 100).toFixed(2)}`);

/**
 * Pure: the short message the customer reads. House voice (no dashes, no closers), the price named
 * once, and the decision left with her — the link is appended by the send path, not here.
 */
export function extraMessage(input: { firstName: string; title: string; pricePence: number }): string {
    const what = stripChatDashes(String(input.title ?? '').trim()).replace(/[.\s]+$/, '');
    const body = [
        `Hi ${input.firstName}, while we are with you today we spotted ${lowerFirst(what)}.`,
        `We can do it for ${pounds(input.pricePence)} on top of the job.`,
        'Say yes and we will crack on, or leave it and nothing changes.',
    ].join(' ');
    return toChatVoice(body);
}

function lowerFirst(t: string): string {
    if (!t) return 'something extra';
    // Keep an acronym or a proper noun as it is; only a plain capitalised word is lowered.
    return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/** Pure: what the contractor is told once Ben has sent it. Never the customer's number, never her name. */
export function contractorNoticeBody(input: { firstName: string | null; title: string; pricePence: number; payDeltaPence: number }): string {
    const who = (input.firstName ?? '').trim() || 'Hi';
    const what = stripChatDashes(String(input.title ?? '').trim()).replace(/[.\s]+$/, '');
    const lines = [
        `${who}, the extra you flagged is priced and with the customer: ${what}.`,
        `It is on the job pack as a locked line at ${pounds(input.pricePence)}.`,
    ];
    if (input.payDeltaPence > 0) lines.push(`Your pay goes up by ${pounds(input.payDeltaPence)} once she says yes.`);
    lines.push('Do not start it until she has.');
    return toChatVoice(lines.join(' '));
}

// ---------------------------------------------------------------- the pack line (pure)

/**
 * Pure: the extra as a pack line, priced and locked. It carries the estimator's minutes, the
 * engine's materials split and Ben's price, plus the variation id so the line's origin is legible
 * on the pack forever.
 */
export function packLineForVariation(input: { variationId: string; extra: ExtraRequest; suggestion: PricedSuggestion | null; finalPence: number }): PackLine {
    const lineId = variationLineId(input.variationId);
    const base = emptyLine(lineId, input.extra.title);
    const sug = input.suggestion;
    const materialsPence = Math.min(sug?.materialsWithMarginPence ?? 0, input.finalPence);
    return {
        ...base,
        detail: input.extra.notes,
        category: sug?.category ?? null,
        minutesLow: sug?.minutes ?? null,
        minutesPoint: sug?.minutes ?? null,
        minutesHigh: sug?.minutes ?? null,
        assumptions: ['Agreed on the day as an extra to the booked job.'],
        pricePence: input.finalPence,
        materialsPence,
        labourPence: Math.max(0, input.finalPence - materialsPence),
        variationId: input.variationId,
    };
}

/**
 * Pure: append a variation line to a LOCKED pack.
 *
 * `commit` refuses every `line:` change once the pack is locked, and says so in words: "use the
 * variation path for: …". This IS that path — the one sanctioned way a locked pack grows a line —
 * so it appends directly rather than going through commit, recomputes required and missing, and
 * writes one change-log row naming the variation. Idempotent: the same variation never doubles.
 */
export function appendVariationLine(pack: JobPack, line: PackLine, by: string, at: Date = new Date()): JobPack {
    if (pack.lines.some((l) => l.lineId === line.lineId)) return pack;
    const iso = at.toISOString();
    const lines = [...pack.lines, line];
    const entry: ChangeLogEntry = { at: iso, field: `line:${line.lineId}`, from: null, to: line.title, by, source: 'ben' };
    const next: JobPack = { ...pack, lines, changeLog: [...pack.changeLog, entry], updatedAt: iso };
    next.required = requiredFor(next.lines, next.job);
    next.missing = missingFor(next);
    return next;
}

// ---------------------------------------------------------------- the contractor's pay (pure)

/**
 * Pure: what the extra adds to the contractor's pay, through the EXISTING pay engine
 * (computeContractorPay at his delivery tier) rather than a second rule invented here. The delta is
 * the pay for the one extra line; his booked pay is never recomputed, so a dial change after the
 * booking cannot rewrite it.
 */
export function payDeltaFor(input: { finalPence: number; suggestion: PricedSuggestion | null; deliveryTier: string | null | undefined }): number {
    const materials = Math.min(input.suggestion?.materialsWithMarginPence ?? 0, input.finalPence);
    const labour = Math.max(0, input.finalPence - materials);
    if (labour <= 0) return 0;
    const pay = computeContractorPay([{
        category: input.suggestion?.category ?? 'other',
        description: input.suggestion?.title ?? null,
        guardedPricePence: labour,
        materialsCostPence: input.suggestion?.materialsPence ?? 0,
        timeEstimateMinutes: input.suggestion?.minutes ?? 60,
    } as any], input.deliveryTier);
    return Math.max(0, pay.totalPayPence);
}

// ---------------------------------------------------------------- store

/** A dispatch_variations row from drizzle, unknown-tolerant. */
export function rowFrom(r: any): VariationRow {
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : new Date(0).toISOString());
    return {
        id: String(r.id), dispatchId: String(r.dispatchId ?? r.dispatch_id ?? ''), contractorId: String(r.contractorId ?? r.contractor_id ?? ''),
        description: String(r.description ?? ''), reason: r.reason ?? null,
        additionalPricePence: Number(r.additionalPricePence ?? r.additional_price_pence ?? 0) || 0,
        additionalTimeMins: Number(r.additionalTimeMins ?? r.additional_time_mins ?? 0) || 0,
        photoUrls: Array.isArray(r.photoUrls ?? r.photo_urls) ? (r.photoUrls ?? r.photo_urls).map(String) : [],
        status: (['pending', 'approved', 'rejected'].includes(String(r.status)) ? r.status : 'pending') as VariationStatus,
        adminNotes: r.adminNotes ?? r.admin_notes ?? null,
        createdAt: iso(r.createdAt ?? r.created_at),
    };
}

export async function insertVariation(input: { dispatchId: string | null; bookingId: string | null; contractorId: string; extra: ExtraRequest; adminNotes: string }): Promise<VariationRow> {
    const { db } = await import('../db');
    const { dispatchVariations } = await import('@shared/schema');
    const [row] = await db.insert(dispatchVariations).values({
        dispatchId: input.dispatchId, bookingId: input.bookingId, contractorId: input.contractorId,
        description: input.extra.title, reason: input.extra.notes,
        additionalPricePence: 0, additionalTimeMins: 0,
        photoUrls: input.extra.photoUrls, adminNotes: input.adminNotes,
    } as any).returning();
    return rowFrom(row);
}

export async function getVariation(id: string): Promise<VariationRow | null> {
    const { db } = await import('../db');
    const { dispatchVariations } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(dispatchVariations).where(eq(dispatchVariations.id, id)).limit(1);
    return row ? rowFrom(row) : null;
}

export async function updateVariation(id: string, patch: { adminNotes?: string; additionalPricePence?: number; additionalTimeMins?: number; status?: VariationStatus; resolvedBy?: string | null; resolvedAt?: Date | null }): Promise<void> {
    const { db } = await import('../db');
    const { dispatchVariations } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(dispatchVariations).set({ ...patch, updatedAt: new Date() } as any).where(eq(dispatchVariations.id, id));
}
