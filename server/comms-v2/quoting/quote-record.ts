/**
 * The quote as the Quoting tool server reads it: one record built from the personalized_quotes row
 * (the quote engine's table, which survives the comms rebuild), its status derived from the row's
 * timestamps the way the price screen derives it (server/spine/price-screen.ts statusOf), and the
 * lines a customer can be read back to the penny.
 *
 * Pure. Nothing here opens a database or a model; quote-store.ts loads the row, this file reads it.
 *
 * The refusal set for a figure (contracts.md, "Read a quote line"): draft, revoked, superseded,
 * expired. A figure may be given only as one line of the live quote, to the penny, cited as that
 * line (behaviour.md answer 23); the price catalog is never a source for a figure in chat (answer
 * 35). Scope (what a line covers, what is not included) may be read from a draft as well, because
 * it is the desk's own record of the customer's words, and never carries a figure.
 */
import { QUOTE_HARD_EXPIRY_FALLBACK_MS, REISSUE_MAX_SELF } from '@shared/quote-reissue';
import { recordFact, type CaseFile, type CaseFileDeps, type Fact, type FactSource } from '../desk/case-file';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'revoked' | 'superseded' | 'expired';

/** The statuses a figure may be read from: the quote the customer holds. */
export const LIVE_FOR_FIGURES: ReadonlySet<QuoteStatus> = new Set<QuoteStatus>(['sent', 'accepted']);
/** The statuses scope may be read from: the live quote and the desk's own draft of it. */
export const LIVE_FOR_SCOPE: ReadonlySet<QuoteStatus> = new Set<QuoteStatus>(['draft', 'sent', 'accepted']);

/** One line item as the quote page renders it. Amounts in pence; null while the draft is unpriced. */
export interface QuoteLine {
    lineId: string;
    label: string;
    qty: number;
    pricePence: number | null;
    labourPence: number | null;
    materialsPence: number | null;
    assumptions: string[];
    notIncluded: string[];
    /** The line's own customer-facing words, as the quote page renders them. */
    notes: string | null;
}

export interface QuoteRecord {
    id: string;
    slug: string;
    status: QuoteStatus;
    customerName: string | null;
    phone: string | null;
    postcode: string | null;
    lines: QuoteLine[];
    totalPence: number | null;
    depositPence: number | null;
    expiresAt: string | null;
    depositPaidAt: string | null;
    createdAt: string | null;
    /** The chain's suggested total, for Ben's notification only; never a chat figure. */
    suggestedTotalPence: number | null;
    checkThis: number;
    photoUrls: string[];
    /**
     * Refreshes the customer may still make on their own quote page once the price lock has passed
     * (shared/quote-reissue.ts). Zero is the point the page itself hands off to a human.
     */
    selfRefreshesLeft: number;
}

/** The row fields this module reads, in the column names drizzle gives them. */
export interface QuoteRowLike {
    id: string;
    shortSlug: string;
    customerName?: string | null;
    phone?: string | null;
    postcode?: string | null;
    isDraft?: boolean | null;
    revokedAt?: Date | string | null;
    supersededAt?: Date | string | null;
    depositPaidAt?: Date | string | null;
    expiresAt?: Date | string | null;
    createdAt?: Date | string | null;
    basePrice?: number | null;
    depositAmountPence?: number | null;
    pricingLineItems?: unknown;
    pricingSuggestions?: unknown;
    customerPhotoUrls?: unknown;
    /** The customer's own refreshes of a lapsed quote, as the reissue route counts them. */
    extensionCount?: number | null;
}

const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim()) : []);

/** The status the row is in, derived as the price screen derives it, then accepted and expired on top. */
export function statusOfRow(row: QuoteRowLike, now: Date = new Date()): QuoteStatus {
    if (row.revokedAt) return 'revoked';
    if (row.supersededAt || (row.pricingSuggestions as { supersededAt?: unknown } | null)?.supersededAt) return 'superseded';
    if (row.isDraft !== false) return 'draft';
    if (row.depositPaidAt) return 'accepted';
    const exp = iso(row.expiresAt);
    if (exp && Date.parse(exp) < now.getTime()) return 'expired';
    return 'sent';
}

export function quoteRecordOf(row: QuoteRowLike, now: Date = new Date()): QuoteRecord {
    const items: any[] = Array.isArray(row.pricingLineItems) ? (row.pricingLineItems as any[]) : [];
    const suggestions = (row.pricingSuggestions ?? null) as { lines?: Array<{ checkThis?: boolean }>; totals?: { suggestedPence?: number } } | null;
    const lines: QuoteLine[] = items.map((l, i) => ({
        lineId: str(l?.lineId) ?? `card_${i + 1}`,
        label: str(l?.label) ?? str(l?.title) ?? str(l?.description) ?? `Line ${i + 1}`,
        qty: Math.max(1, int(l?.qty) ?? 1),
        pricePence: int(l?.pricePence),
        labourPence: int(l?.labourPence) ?? int(l?.guardedPricePence),
        materialsPence: int(l?.materialsPence) ?? int(l?.materialsWithMarginPence),
        assumptions: strings(l?.assumptions),
        notIncluded: strings(l?.notIncluded),
        notes: str(l?.description),
    }));
    return {
        id: row.id,
        slug: row.shortSlug,
        status: statusOfRow(row, now),
        customerName: str(row.customerName),
        phone: str(row.phone),
        postcode: str(row.postcode),
        lines,
        totalPence: int(row.basePrice),
        depositPence: int(row.depositAmountPence),
        expiresAt: iso(row.expiresAt),
        depositPaidAt: iso(row.depositPaidAt),
        createdAt: iso(row.createdAt),
        suggestedTotalPence: int(suggestions?.totals?.suggestedPence),
        checkThis: (suggestions?.lines ?? []).filter((l) => l?.checkThis).length,
        photoUrls: strings(row.customerPhotoUrls),
        selfRefreshesLeft: Math.max(0, REISSUE_MAX_SELF - Math.max(0, int(row.extensionCount) ?? 0)),
    };
}

/**
 * The customer can still put this right themselves: the price lock has passed, a refresh is left on
 * their own quote page, and that page will still serve. Past the hard window the public quote GET
 * answers 410 and the page renders not-found (server/quotes.ts `isQuoteGone`), so there is nothing
 * to point them at and the thread is Ben's.
 */
export function selfRefreshable(q: QuoteRecord, now: Date = new Date()): boolean {
    if (q.status !== 'expired' || q.selfRefreshesLeft <= 0 || !q.createdAt) return false;
    const lock = q.expiresAt ? Date.parse(q.expiresAt) : 0;
    const hard = Date.parse(q.createdAt) + QUOTE_HARD_EXPIRY_FALLBACK_MS;
    return now.getTime() <= Math.max(lock, hard);
}

// ---------------------------------------------------------------- figures

/** A figure exactly as the quote shows it and the figure guard compares it: pounds and pence, always two decimals. */
export function pounds(pence: number): string {
    return `£${(pence / 100).toFixed(2)}`;
}

export const TOTAL_LABEL = 'Total';
export const DEPOSIT_LABEL = 'Deposit';

export interface QuoteLineRead {
    /** The label as it appears on the quote, the citation the figure guard verifies against. */
    label: string;
    amountPence: number;
    amount: string;
    citation: { quoteRef: string; line: string };
}

export type QuoteLineReadOutcome = { ok: true; value: QuoteLineRead } | { ok: false; reason: string; status: QuoteStatus };

/** Every label a figure can be read under: each line, its labour and materials halves when priced, the total and the deposit. */
export function figureLabels(q: QuoteRecord): Array<{ label: string; amountPence: number }> {
    const out: Array<{ label: string; amountPence: number }> = [];
    for (const l of q.lines) {
        if (l.pricePence != null) out.push({ label: l.label, amountPence: l.pricePence });
        if (l.labourPence != null && l.materialsPence != null && l.materialsPence > 0) {
            out.push({ label: `${l.label} labour`, amountPence: l.labourPence });
            out.push({ label: `${l.label} materials`, amountPence: l.materialsPence });
        }
    }
    if (q.totalPence != null) out.push({ label: TOTAL_LABEL, amountPence: q.totalPence });
    if (q.depositPence != null && q.depositPence > 0) out.push({ label: DEPOSIT_LABEL, amountPence: q.depositPence });
    return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether a figure may be read from this quote at all. The one liveness rule, asked the same way by
 * read_quote_line and by the figure guard's check of a cited line (a figure may be given only as one
 * line of the live quote, behaviour.md answer 23).
 */
export function quoteLiveForFigures(q: QuoteRecord): boolean {
    return LIVE_FOR_FIGURES.has(q.status);
}

/**
 * read_quote_line: the amount of one line of the live quote, to the penny, with the citation the
 * figure guard verifies. Refuses a draft, a revoked, a superseded and an expired quote, and a label
 * that is not on it.
 */
export function readQuoteLine(q: QuoteRecord, label: string): QuoteLineReadOutcome {
    if (!quoteLiveForFigures(q)) return { ok: false, reason: `the quote is ${q.status}; a figure is read only from the live quote the customer holds`, status: q.status };
    const want = norm(label);
    const hit = figureLabels(q).find((f) => norm(f.label) === want);
    if (!hit) return { ok: false, reason: `no line labelled "${label}" on quote ${q.slug}`, status: q.status };
    return { ok: true, value: { label: hit.label, amountPence: hit.amountPence, amount: pounds(hit.amountPence), citation: { quoteRef: q.slug, line: hit.label } } };
}

// ---------------------------------------------------------------- scope

export interface QuoteScopeRead {
    lines: Array<{ label: string; qty: number; assumptions: string[]; notIncluded: string[]; notes: string | null }>;
}

export type QuoteScopeOutcome = { ok: true; value: QuoteScopeRead } | { ok: false; reason: string; status: QuoteStatus };

/** read_quote_scope: what each line covers, its assumptions and what is not included. No figure. Refuses revoked, superseded and expired. */
export function readQuoteScope(q: QuoteRecord): QuoteScopeOutcome {
    if (!LIVE_FOR_SCOPE.has(q.status)) return { ok: false, reason: `the quote is ${q.status}; nothing is read from it`, status: q.status };
    return { ok: true, value: { lines: q.lines.map((l) => ({ label: l.label, qty: l.qty, assumptions: l.assumptions, notIncluded: l.notIncluded, notes: l.notes })) } };
}

// ---------------------------------------------------------------- facts on the case file

/** The keys the Quoting specialist writes. A figure key always carries the label after the colon. */
export const QUOTE_FACT = {
    ref: 'quote_ref',
    status: 'quote_status',
    link: 'quote_link',
    line: 'quote_line',            // quote_line:<label> = £x.xx
    scope: 'quote_scope',          // quote_scope:<label> = what the line covers
    notIncluded: 'quote_not_included',
    assumption: 'quote_assumption',
    benNotified: 'ben_notified',
    benChased: 'ben_chased',
    benToRequest: 'ben_to_request', // Ben's own: what the draft is missing, for him to request

    accepted: 'quote_accepted',
} as const;

export function quoteSource(quoteRef: string, line: string): FactSource {
    return { kind: 'quote_line', quoteRef, line };
}

/** Records a fact once: the same key, value and source on the file returns the existing fact. */
export function factOnce(file: CaseFile, input: { key: string; value: string; source: FactSource; by: string }, deps: CaseFileDeps = {}): Fact | null {
    const existing = file.facts.find((f) => f.key === input.key && f.value === input.value && JSON.stringify(f.source) === JSON.stringify(input.source));
    if (existing) return existing;
    const r = recordFact(file, input, deps);
    return r.ok ? r.value : null;
}

/** The newest fact for a key, or for a key prefix (quote_line:). */
export function newestFact(file: CaseFile, key: string): Fact | null {
    for (let i = file.facts.length - 1; i >= 0; i--) if (file.facts[i].key === key) return file.facts[i];
    return null;
}

export function factsWithPrefix(file: CaseFile, prefix: string): Fact[] {
    return file.facts.filter((f) => f.key === prefix || f.key.startsWith(`${prefix}:`));
}

/** The customer-facing quote URL, the same shape the price screen and the staff send use. */
export function quoteUrlFor(slug: string, baseUrl: string = process.env.BASE_URL || 'https://handyservices.app'): string {
    return `${baseUrl.replace(/\/$/, '')}/quote/${slug}`;
}

/** Ben's price screen for a draft. */
export function priceScreenUrlFor(slug: string, baseUrl: string = process.env.BASE_URL || 'https://handyservices.app'): string {
    return `${baseUrl.replace(/\/$/, '')}/admin/price/${slug}`;
}
