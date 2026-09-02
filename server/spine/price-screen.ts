/**
 * PRICE AND SEND — server side (P8 / B, docs/comms-build/BRIEF-P8-price-screen.md).
 *
 * Ben's phone-first screen at /admin/price/<slug> reads ONE payload (`GET /api/spine/price/:slug`)
 * built here from the Route A draft: the personalized_quotes draft row (P8 / A's automatic draft,
 * prices null), its pricing suggestions (the engine's per-line suggestion + band, stored beside the
 * draft, never on the customer-visible fields) and the quote_estimates row (minutes, materials,
 * confidence, flags). The screen shows the suggestion prefilled in an editable field; Ben's tap on
 * "Send quote" posts his final per-line prices to `POST /api/spine/price/:slug/send`, which is the
 * only thing that writes a customer-visible price (`confirmPrices`) and then hands the quote link to
 * the EXISTING send path (server/agent-staff.ts deliverQuoteLink) under approver human:<id>.
 *
 * Shapes this module reads are P8 / A's (BRIEF-P8-chain.md §1, §3, §4). They were not in this
 * worktree when it was written, so every read is defensive: the row comes in as `to_jsonb(row)` so a
 * column the sibling pane adds (pricing_suggestions, superseded_at) is optional here, the suggestion
 * is read from `pricing_suggestions.lines[]` first and from per-line fields on pricing_line_items
 * second, and the estimate row is optional (the screen still works from the draft alone, with
 * "no suggestion" lines that Ben prices by hand).
 *
 * Nothing here prices: the ONLY numbers this module produces are Ben's own, echoed back.
 */
import type { Approver } from '../approver';

// ---------------------------------------------------------------- shapes (pane A's, described)

/** One line of quote_estimates.lines (BRIEF-P8-chain §1). */
export interface EstimateLineShape {
    lineId?: string;
    title?: string;
    category?: string | null;
    minutesLow?: number;
    minutesHigh?: number;
    minutesPoint?: number;
    materials?: Array<{ name: string; qty?: number; unitCostPence?: number; source?: string }>;
    flags?: string[];
    confidence?: 'low' | 'medium' | 'high';
    reasoning?: string;
    timeSource?: 'history' | 'model' | 'fallback';
}

/** quote_estimates row as `to_jsonb(row)`. */
export interface EstimateRowShape {
    id?: string;
    conversation_id?: string | null;
    draft_quote_id?: string | null;
    status?: string | null;
    lines?: EstimateLineShape[] | null;
    job?: { setupMinutes?: number; cleanupMinutes?: number; accessNotes?: string | null } | null;
    confidence?: string | null;
    created_at?: string | null;
    superseded_at?: string | null;
}

/** One entry of personalized_quotes.pricing_suggestions.lines (BRIEF-P8-chain §3–4). */
export interface SuggestionLineShape {
    lineId?: string;
    suggestedPence?: number | null;
    bandLowPence?: number | null;
    bandHighPence?: number | null;
    checkThis?: boolean;
    checkReason?: string | null;
    reason?: string | null;
    confidence?: 'low' | 'medium' | 'high' | null;
    basis?: { minutes?: number; ratePencePerHour?: number; materialsPence?: number; marginPct?: number; rules?: string[] } | null;
}

export interface SuggestionsShape {
    at?: string | null;
    version?: string | null;
    estimateId?: string | null;
    supersededAt?: string | null;
    job?: { setupMinutes?: number; cleanupMinutes?: number; accessNotes?: string | null } | null;
    lines?: SuggestionLineShape[] | null;
}

/** personalized_quotes as `to_jsonb(row)` — only the columns the screen reads. */
export interface DraftRowShape {
    id: string;
    short_slug: string;
    customer_name?: string | null;
    phone?: string | null;
    postcode?: string | null;
    customer_type?: string | null;
    job_description?: string | null;
    is_draft?: boolean | null;
    revoked_at?: string | null;
    deposit_paid_at?: string | null;
    superseded_at?: string | null;
    pricing_line_items?: any[] | null;
    pricing_suggestions?: SuggestionsShape | null;
    quote_assumptions?: string[] | null;
    customer_photo_urls?: string[] | null;
    customer_video_urls?: string[] | null;
    source_channel?: string | null;
    base_price?: number | null;
    created_at?: string | null;
}

// ---------------------------------------------------------------- payload (what the screen renders)

export type PriceScreenStatus = 'draft' | 'sent' | 'superseded' | 'revoked';
export type Confidence = 'low' | 'medium' | 'high';

export interface PriceScreenLine {
    lineId: string;
    title: string;
    category: string | null;
    qty: number;
    minutes: { point: number; low: number; high: number } | null;
    timeSource: string | null;
    materialsCount: number;
    /** Materials at the live margin — what the customer pays for the line's materials. */
    materialsPence: number;
    suggestedPence: number | null;
    bandLowPence: number | null;
    bandHighPence: number | null;
    confidence: Confidence | null;
    checkThis: boolean;
    checkReason: string | null;
    flags: string[];
    assumptions: string[];
    basis: { minutes: number | null; ratePencePerHour: number | null; marginPct: number | null; rules: string[] } | null;
}

export interface PriceScreenMaterial { lineId: string; name: string; qty: number; unitCostPence: number | null; source: string | null }

export interface PriceScreenPayload {
    available: true;
    slug: string;
    quoteId: string;
    conversationId: string | null;
    /** Supersede token: the send must echo it; a different one means a new scope arrived (409). */
    version: string;
    status: PriceScreenStatus;
    customer: { firstName: string; name: string; postcode: string | null; customerType: string; readiness: string | null };
    lines: PriceScreenLine[];
    job: { setupMinutes: number; cleanupMinutes: number; accessNotes: string | null } | null;
    settings: { materialsMarginPercent: number; depositPercent: number };
    materials: PriceScreenMaterial[];
    photos: string[];
    videos: string[];
    builderUrl: string;
    estimate: { id: string | null; status: string | null; confidence: string | null; at: string | null } | null;
    quoteUrl: string;
}

export interface Totals { labourPence: number; materialsPence: number; totalPence: number; depositPence: number }

// ---------------------------------------------------------------- pure

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n); };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const conf = (v: unknown): Confidence | null => (v === 'low' || v === 'medium' || v === 'high' ? v : null);

export function firstNameOf(name: string | null | undefined): string {
    const n = (name ?? '').trim();
    if (!n) return 'Customer';
    return n.split(/\s+/)[0];
}

/** The draft's customer-facing status. A superseded or revoked draft must not be priced. */
export function statusOf(row: Pick<DraftRowShape, 'is_draft' | 'revoked_at' | 'superseded_at' | 'pricing_suggestions'>): PriceScreenStatus {
    if (row.revoked_at) return 'revoked';
    if (row.superseded_at || row.pricing_suggestions?.supersededAt) return 'superseded';
    if (row.is_draft === false) return 'sent';
    return 'draft';
}

/**
 * The supersede token. It changes when the chain re-runs (new estimate id / new suggestions
 * timestamp) or when the line set changes; the client echoes it on send and a mismatch is a 409.
 */
export function versionOf(row: DraftRowShape, estimate: EstimateRowShape | null): string {
    const lineIds = (row.pricing_line_items ?? []).map((l: any, i: number) => str(l?.lineId) ?? `idx_${i}`);
    const s = row.pricing_suggestions ?? null;
    return [
        estimate?.id ?? s?.estimateId ?? '-',
        s?.version ?? s?.at ?? '-',
        row.superseded_at ?? s?.supersededAt ?? '-',
        row.is_draft === false ? 'sent' : 'draft',
        lineIds.join(','),
    ].join('|');
}

/** Materials at the live margin from an estimate line's cost list. Never hardcodes the margin. */
export function materialsAtMargin(materials: EstimateLineShape['materials'] | undefined, marginPercent: number): number {
    if (!Array.isArray(materials) || !materials.length) return 0;
    const cost = materials.reduce((s, m) => s + (num(m?.unitCostPence) ?? 0) * (num(m?.qty) ?? 1), 0);
    return Math.round(cost * (1 + marginPercent / 100));
}

function minutesOf(line: any, est: EstimateLineShape | null, sug: SuggestionLineShape | null): PriceScreenLine['minutes'] {
    // 1. estimate row (the source), 2. per-line field on the draft, 3. the suggestion's basis
    const p = int(est?.minutesPoint) ?? int(line?.minutes?.point) ?? int(line?.minutes) ?? int(line?.timeEstimateMinutes) ?? int(sug?.basis?.minutes);
    if (p == null) return null;
    const low = int(est?.minutesLow) ?? int(line?.minutes?.low) ?? p;
    const high = int(est?.minutesHigh) ?? int(line?.minutes?.high) ?? p;
    return { point: p, low: Math.min(low, p), high: Math.max(high, p) };
}

function bandOf(line: any, sug: SuggestionLineShape | null): { low: number | null; high: number | null } {
    const lowS = int(sug?.bandLowPence), highS = int(sug?.bandHighPence);
    if (lowS != null && highS != null) return { low: Math.min(lowS, highS), high: Math.max(lowS, highS) };
    const b = line?.priceBandPence;
    if (Array.isArray(b) && b.length >= 2) { const l = int(b[0]), h = int(b[1]); if (l != null && h != null) return { low: Math.min(l, h), high: Math.max(l, h) }; }
    if (b && typeof b === 'object') { const l = int(b.low), h = int(b.high); if (l != null && h != null) return { low: Math.min(l, h), high: Math.max(l, h) }; }
    return { low: null, high: null };
}

/**
 * One screen line from the draft line + (optional) estimate line + (optional) suggestion. The
 * three are matched by lineId, falling back to position. Pure.
 */
export function buildScreenLine(input: {
    index: number; line: any; estimateLine: EstimateLineShape | null; suggestion: SuggestionLineShape | null; materialsMarginPercent: number;
}): PriceScreenLine {
    const { index, line, estimateLine: est, suggestion: sug, materialsMarginPercent } = input;
    const lineId = str(line?.lineId) ?? str(est?.lineId) ?? `card_${index + 1}`;
    const title = str(line?.title) ?? str(line?.label) ?? str(line?.description) ?? str(est?.title) ?? `Line ${index + 1}`;
    const suggested = int(sug?.suggestedPence) ?? int(line?.suggestedPricePence) ?? null;
    const band = bandOf(line, sug);
    const estMaterials = Array.isArray(est?.materials) ? est!.materials! : Array.isArray(line?.materials) ? line.materials : [];
    const materialsPence = int(sug?.basis?.materialsPence) ?? int(line?.materialsWithMarginPence) ?? materialsAtMargin(estMaterials, materialsMarginPercent);
    const checkThis = sug?.checkThis === true || line?.checkThis === true;
    const checkReason = str(sug?.checkReason) ?? str(sug?.reason) ?? str(line?.checkReason) ?? (checkThis ? 'Fallback price, no history for this line' : null);
    const flags = Array.isArray(est?.flags) ? est!.flags!.map(String) : Array.isArray(line?.flags) ? line.flags.map(String) : [];
    return {
        lineId, title,
        category: str(line?.category) ?? str(est?.category) ?? null,
        qty: Math.max(1, int(line?.qty) ?? 1),
        minutes: minutesOf(line, est, sug),
        timeSource: str(est?.timeSource) ?? str(line?.timeSource) ?? null,
        materialsCount: estMaterials.length,
        materialsPence,
        suggestedPence: suggested != null && suggested > 0 ? suggested : null,
        bandLowPence: band.low, bandHighPence: band.high,
        confidence: conf(sug?.confidence) ?? conf(est?.confidence) ?? conf(line?.confidence),
        checkThis, checkReason: checkThis ? checkReason : null,
        flags,
        assumptions: Array.isArray(line?.assumptions) ? line.assumptions.map(String) : [],
        basis: sug?.basis ? {
            minutes: int(sug.basis.minutes), ratePencePerHour: int(sug.basis.ratePencePerHour), marginPct: num(sug.basis.marginPct),
            rules: Array.isArray(sug.basis.rules) ? sug.basis.rules.map(String) : [],
        } : null,
    };
}

function matchById<T extends { lineId?: string }>(items: T[] | null | undefined, lineId: string | null, index: number): T | null {
    if (!Array.isArray(items) || !items.length) return null;
    if (lineId) { const hit = items.find((x) => str(x?.lineId) === lineId); if (hit) return hit; }
    return items[index] ?? null;
}

/** The whole payload. Pure: every DB read happens in loadPriceScreen. */
export function buildPricePayload(input: {
    row: DraftRowShape;
    estimate: EstimateRowShape | null;
    conversationId: string | null;
    readiness: string | null;
    settings: { materialsMarginPercent: number; depositPercent: number };
    baseUrl?: string;
}): PriceScreenPayload {
    const { row, estimate, settings } = input;
    const draftLines: any[] = Array.isArray(row.pricing_line_items) ? row.pricing_line_items : [];
    const sugLines = row.pricing_suggestions?.lines ?? null;
    const estLines = estimate?.lines ?? null;
    const lines = draftLines.map((line, i) => {
        const lineId = str(line?.lineId);
        return buildScreenLine({
            index: i, line,
            estimateLine: matchById(estLines, lineId, i),
            suggestion: matchById(sugLines, lineId, i),
            materialsMarginPercent: settings.materialsMarginPercent,
        });
    });
    const materials: PriceScreenMaterial[] = lines.flatMap((l, i) => {
        const est = matchById(estLines, l.lineId, i);
        const list = Array.isArray(est?.materials) ? est!.materials! : Array.isArray(draftLines[i]?.materials) ? draftLines[i].materials : [];
        return list.map((m: any) => ({ lineId: l.lineId, name: String(m?.name ?? 'Material'), qty: Math.max(1, int(m?.qty) ?? 1), unitCostPence: int(m?.unitCostPence) ?? int(m?.unitPricePence), source: str(m?.source) ?? str(m?.supplier) }));
    });
    const job = estimate?.job ?? row.pricing_suggestions?.job ?? null;
    const baseUrl = input.baseUrl ?? process.env.BASE_URL ?? 'https://handyservices.app';
    return {
        available: true,
        slug: row.short_slug, quoteId: row.id, conversationId: input.conversationId,
        version: versionOf(row, estimate),
        status: statusOf(row),
        customer: {
            firstName: firstNameOf(row.customer_name), name: row.customer_name ?? 'Customer',
            postcode: row.postcode ?? null, customerType: row.customer_type ?? 'homeowner', readiness: input.readiness,
        },
        lines,
        job: job ? { setupMinutes: int(job.setupMinutes) ?? 0, cleanupMinutes: int(job.cleanupMinutes) ?? 0, accessNotes: str(job.accessNotes) } : null,
        settings: { materialsMarginPercent: settings.materialsMarginPercent, depositPercent: settings.depositPercent },
        materials,
        photos: Array.isArray(row.customer_photo_urls) ? row.customer_photo_urls.filter(Boolean) : [],
        videos: Array.isArray(row.customer_video_urls) ? row.customer_video_urls.filter(Boolean) : [],
        builderUrl: `/admin/quotes/${row.short_slug}/edit`,
        estimate: estimate ? { id: estimate.id ?? null, status: estimate.status ?? null, confidence: estimate.confidence ?? null, at: estimate.created_at ?? null } : null,
        quoteUrl: `${baseUrl}/quote/${row.short_slug}`,
    };
}

/**
 * Totals the screen shows and the send writes: labour = final − materials per line, materials at
 * the live margin, deposit = 100 % materials + depositPercent of labour, rounded to the pound —
 * the same rule as server/stripe-routes.ts calculateDeposit, so what Ben sees is what Stripe asks.
 */
export function totalsFor(lines: Array<{ finalPence: number; materialsPence: number }>, depositPercent: number): Totals {
    const totalPence = lines.reduce((s, l) => s + l.finalPence, 0);
    const materialsPence = lines.reduce((s, l) => s + Math.min(l.materialsPence, l.finalPence), 0);
    const labourPence = totalPence - materialsPence;
    const depositPence = Math.round((materialsPence + Math.round(labourPence * (depositPercent / 100))) / 100) * 100;
    return { labourPence, materialsPence, totalPence, depositPence };
}

export interface SendInput { version: string; lines: Array<{ lineId: string; finalPence: number }>; messageStyle: string | null }

export function validateSendBody(body: unknown, expectedLineIds: string[]): { ok: true; input: SendInput } | { ok: false; errors: string[] } {
    const b = (body ?? {}) as Record<string, any>;
    const errors: string[] = [];
    const version = str(b.version);
    if (!version) errors.push("Missing 'version' (the draft's supersede token).");
    const raw: any[] = Array.isArray(b.lines) ? b.lines : [];
    const lines: SendInput['lines'] = [];
    const seen = new Set<string>();
    for (const l of raw) {
        const lineId = str(l?.lineId);
        const finalPence = int(l?.finalPence);
        if (!lineId) { errors.push('A line is missing its lineId.'); continue; }
        if (seen.has(lineId)) { errors.push(`Line ${lineId} appears twice.`); continue; }
        seen.add(lineId);
        if (finalPence == null || finalPence <= 0) { errors.push(`Line ${lineId} needs a price above £0.`); continue; }
        if (finalPence > 5_000_000) { errors.push(`Line ${lineId}: £${(finalPence / 100).toFixed(0)} is above the £50,000 per-line ceiling.`); continue; }
        lines.push({ lineId, finalPence });
    }
    for (const id of expectedLineIds) if (!seen.has(id)) errors.push(`No price given for line ${id}.`);
    for (const id of Array.from(seen)) if (!expectedLineIds.includes(id)) errors.push(`Line ${id} is not on this draft.`);
    if (errors.length) return { ok: false, errors };
    return { ok: true, input: { version: version!, lines, messageStyle: str(b.messageStyle) } };
}

export interface VerdictRowInput {
    slug: string; quoteId: string; lineId: string; category: string | null;
    suggestedPence: number | null; bandLowPence: number | null; bandHighPence: number | null;
    finalPence: number; inBand: boolean; edited: boolean; checkThis: boolean; by: string; at: Date;
}

/** One verdict row per line: in_band needs a band, edited = no suggestion or a different number. */
export function verdictRowsFor(payload: Pick<PriceScreenPayload, 'slug' | 'quoteId' | 'lines'>, finals: SendInput['lines'], by: string, at: Date): VerdictRowInput[] {
    const byId = new Map(finals.map((f) => [f.lineId, f.finalPence]));
    return payload.lines.map((l) => {
        const finalPence = byId.get(l.lineId)!;
        const inBand = l.bandLowPence != null && l.bandHighPence != null && finalPence >= l.bandLowPence && finalPence <= l.bandHighPence;
        return {
            slug: payload.slug, quoteId: payload.quoteId, lineId: l.lineId, category: l.category,
            suggestedPence: l.suggestedPence, bandLowPence: l.bandLowPence, bandHighPence: l.bandHighPence,
            finalPence, inBand, edited: l.suggestedPence == null || finalPence !== l.suggestedPence, checkThis: l.checkThis, by, at,
        };
    });
}

/**
 * The customer-visible line items, written ONLY here. The quote page renders a line as
 * guardedPricePence + materialsWithMarginPence (UnifiedQuoteCard), so Ben's final line price is
 * split: materials at the live margin, labour = the rest. `pricePence` carries the whole line for
 * the draft-shape readers. Everything else on the existing line (assumptions, scope, materials
 * list) is kept as it was.
 */
export function confirmedLineItems(existing: any[], payload: Pick<PriceScreenPayload, 'lines'>, finals: SendInput['lines']): any[] {
    const byId = new Map(finals.map((f) => [f.lineId, f.finalPence]));
    return payload.lines.map((l, i) => {
        const prev = existing[i] && typeof existing[i] === 'object' ? existing[i] : {};
        const finalPence = byId.get(l.lineId)!;
        const materials = Math.min(l.materialsPence, finalPence);
        const labour = finalPence - materials;
        return {
            ...prev,
            lineId: l.lineId,
            label: prev.label ?? l.title, title: prev.title ?? l.title, description: prev.description ?? l.title,
            category: l.category ?? prev.category ?? 'general_fixing',
            qty: l.qty,
            timeEstimateMinutes: l.minutes?.point ?? prev.timeEstimateMinutes ?? null,
            pricePence: finalPence,
            labourPence: labour,
            materialsPence: materials,
            guardedPricePence: labour,
            referencePricePence: prev.referencePricePence ?? labour,
            llmSuggestedPricePence: prev.llmSuggestedPricePence ?? labour,
            materialsWithMarginPence: materials,
            materialsCostPence: prev.materialsCostPence ?? materials,
            // The suggestion stays on the line for the record, clearly not the price.
            suggestedPricePence: l.suggestedPence,
            priceBandPence: l.bandLowPence != null && l.bandHighPence != null ? [l.bandLowPence, l.bandHighPence] : null,
            checkThis: l.checkThis,
            confirmedBy: 'human',
            source: prev.source ?? 'spine_route_a',
        };
    });
}

// ---------------------------------------------------------------- db

async function selectRowJson(slug: string): Promise<DraftRowShape | null> {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const r: any = await db.execute(sql`select to_jsonb(q) as row from personalized_quotes q where q.short_slug = ${slug} limit 1`);
    const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
    return rows[0]?.row ?? null;
}

/** The newest non-superseded quote_estimates row for the draft. Null when the table is absent. */
async function selectEstimateJson(quoteId: string): Promise<EstimateRowShape | null> {
    try {
        const { db } = await import('../db');
        const { sql } = await import('drizzle-orm');
        const r: any = await db.execute(sql`select to_jsonb(e) as row from quote_estimates e where e.draft_quote_id = ${quoteId} order by (e.superseded_at is null) desc, e.created_at desc limit 1`);
        const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
        return rows[0]?.row ?? null;
    } catch (error: any) {
        // 42P01 undefined_table: pane A's migration not applied here. The screen works without it.
        if (String(error?.code) === '42P01' || /quote_estimates/.test(String(error?.message))) return null;
        throw error;
    }
}

/** The thread this draft belongs to: the estimate's, else the thread whose card saved it, else by phone. */
export async function resolveConversationForQuote(row: DraftRowShape, estimate: EstimateRowShape | null): Promise<string | null> {
    if (estimate?.conversation_id) return estimate.conversation_id;
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const bySlug: any = await db.execute(sql`select id from conversations where metadata->'quoteDraft'->>'slug' = ${row.short_slug} limit 1`);
    const r1: any[] = Array.isArray(bySlug) ? bySlug : (bySlug?.rows ?? []);
    if (r1[0]?.id) return String(r1[0].id);
    const digits = (row.phone ?? '').replace(/\D/g, '');
    if (!digits) return null;
    const byPhone: any = await db.execute(sql`select id from conversations where regexp_replace(phone_number, '\\D', '', 'g') = ${digits} order by updated_at desc nulls last limit 1`);
    const r2: any[] = Array.isArray(byPhone) ? byPhone : (byPhone?.rows ?? []);
    return r2[0]?.id ? String(r2[0].id) : null;
}

async function readinessFor(conversationId: string | null): Promise<string | null> {
    if (!conversationId) return null;
    try {
        const { loadQuoteIntakeCard } = await import('./quote-intake');
        const card = await loadQuoteIntakeCard(conversationId);
        return card.available ? card.intake.readiness : null;
    } catch { return null; }
}

async function liveSettings(): Promise<{ materialsMarginPercent: number; depositPercent: number }> {
    const { getPricingSettings } = await import('../pricing-settings');
    const s = await getPricingSettings();
    return { materialsMarginPercent: Number(s.materialsMarginPercent), depositPercent: Number(s.depositPercent) };
}

export async function loadPriceScreen(slug: string): Promise<PriceScreenPayload | { available: false; status: number; reason: string }> {
    const row = await selectRowJson(slug);
    if (!row) return { available: false, status: 404, reason: 'No quote with that slug' };
    const estimate = await selectEstimateJson(row.id);
    const conversationId = await resolveConversationForQuote(row, estimate);
    const [readiness, settings] = await Promise.all([readinessFor(conversationId), liveSettings()]);
    return buildPricePayload({ row, estimate, conversationId, readiness, settings });
}

export type ConfirmResult =
    | { ok: true; payload: PriceScreenPayload; totals: Totals; verdicts: number; runId: string; approver: Approver }
    | { ok: false; status: number; errors: string[]; payload?: PriceScreenPayload };

/**
 * Ben's tap, part one: write his final prices onto the draft (the only customer-visible price
 * write on Route A) and record one quote_price_verdicts row per line. Refuses with 409 when the
 * draft was superseded, sent or revoked since the screen loaded, or when the echoed version
 * differs (a new scope arrived). Sending is part two (routes.ts → deliverQuoteLink).
 */
export async function confirmPrices(slug: string, body: unknown, user: { id?: string | null; email?: string | null }): Promise<ConfirmResult> {
    const loaded = await loadPriceScreen(slug);
    if (!loaded.available) return { ok: false, status: loaded.status, errors: [loaded.reason] };
    const payload = loaded;
    if (payload.status !== 'draft') {
        return { ok: false, status: 409, errors: [payload.status === 'sent' ? 'This quote has already been sent.' : payload.status === 'revoked' ? 'This quote was revoked.' : 'A new scope arrived and this draft was superseded. Reload to price the new one.'], payload };
    }
    const v = validateSendBody(body, payload.lines.map((l) => l.lineId));
    if (!v.ok) return { ok: false, status: 400, errors: v.errors, payload };
    if (v.input.version !== payload.version) {
        return { ok: false, status: 409, errors: ['The draft changed since this screen loaded (a new scope or estimate arrived). Reload and check the prices again.'], payload };
    }
    const { humanApprover, newRunId } = await import('../approver');
    const approver = humanApprover(user.email ?? user.id ?? 'admin');
    const runId = newRunId('human');
    const now = new Date();
    const rows = verdictRowsFor(payload, v.input.lines, approver, now);
    const totals = totalsFor(payload.lines.map((l) => ({ finalPence: v.input.lines.find((f) => f.lineId === l.lineId)!.finalPence, materialsPence: l.materialsPence })), payload.settings.depositPercent);
    const items = confirmedLineItems(await currentLineItems(payload.quoteId), payload, v.input.lines);

    const { db } = await import('../db');
    const { personalizedQuotes, quotePriceVerdicts } = await import('@shared/schema');
    const { and, eq } = await import('drizzle-orm');
    const { quoteValidityMs } = await import('../quotes');
    // Compare-and-set on is_draft so two taps (or a supersede racing the tap) cannot both write.
    const updated = await db.update(personalizedQuotes).set({
        pricingLineItems: items,
        basePrice: totals.totalPence,
        materialsCostWithMarkupPence: totals.materialsPence,
        depositAmountPence: totals.depositPence,
        expiresAt: new Date(now.getTime() + quoteValidityMs(totals.totalPence)),
        pricingLayerBreakdown: {
            source: 'spine_route_a', confirmedBy: approver, confirmedAt: now.toISOString(), runId,
            labourPence: totals.labourPence, materialsWithMarginPence: totals.materialsPence, finalPricePence: totals.totalPence,
            materialsMarginPercent: payload.settings.materialsMarginPercent, estimateId: payload.estimate?.id ?? null,
        },
    } as any).where(and(eq(personalizedQuotes.id, payload.quoteId), eq(personalizedQuotes.isDraft, true))).returning({ id: personalizedQuotes.id });
    if (!updated.length) return { ok: false, status: 409, errors: ['This quote is no longer a draft (sent or taken over in the builder).'], payload };
    // A quote is priced once: a retry after a failed send replaces the earlier tap's rows rather
    // than double-counting the quote in the graduation stats.
    await db.delete(quotePriceVerdicts).where(eq(quotePriceVerdicts.slug, slug));
    await db.insert(quotePriceVerdicts).values(rows.map((r) => ({
        slug: r.slug, quoteId: r.quoteId, lineId: r.lineId, category: r.category,
        suggestedPence: r.suggestedPence, bandLowPence: r.bandLowPence, bandHighPence: r.bandHighPence,
        finalPence: r.finalPence, inBand: r.inBand, edited: r.edited, checkThis: r.checkThis, by: r.by, at: r.at,
    })));
    try {
        const { logSystemEvent } = await import('../system-events');
        void logSystemEvent({
            kind: 'other',
            summary: `Ben priced quote ${slug}: £${(totals.totalPence / 100).toFixed(0)} across ${rows.length} line(s), ${rows.filter((r) => !r.edited).length} unedited`,
            detail: { slug, quoteId: payload.quoteId, runId, approver, totals, lines: rows.map((r) => ({ lineId: r.lineId, category: r.category, suggestedPence: r.suggestedPence, finalPence: r.finalPence, inBand: r.inBand, edited: r.edited })) },
            source: 'spine.price-screen',
        });
    } catch { /* bookkeeping */ }
    return { ok: true, payload, totals, verdicts: rows.length, runId, approver };
}

async function currentLineItems(quoteId: string): Promise<any[]> {
    const { db } = await import('../db');
    const { personalizedQuotes } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [q] = await db.select({ items: personalizedQuotes.pricingLineItems }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
    return Array.isArray(q?.items) ? (q!.items as any[]) : [];
}
