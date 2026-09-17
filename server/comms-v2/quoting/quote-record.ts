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
    /** The desk's own reissues of this quote (reissue.ts), kept on the row under `pricing_suggestions.reissue`. */
    reissue: ReissueRecord | null;
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
}

// ---------------------------------------------------------------- the desk's reissue record

/** One line as the customer first saw it. */
export interface OriginalLine { lineId: string; pricePence: number; materialsPence: number }

/** One reissue the desk made: which lapse it answered, the figure it set, and the run that claimed it. */
export interface ReissueIssue {
    /** The expiry this reissue answered: the row's `expires_at` when it was claimed. */
    fromExpiresAt: string | null;
    at: string;
    /** The desk run that claimed it, and the only run that may tell the customer. */
    runId: string;
    totalPence: number;
    expiresAt: string;
    by: string;
}

/** What the row keeps under `pricing_suggestions.reissue`. */
export interface ReissueRecord {
    /** The quote as the customer first saw it: every reissue is taken from this, never from a previous one. */
    original: { totalPence: number; lines: OriginalLine[] };
    issues: ReissueIssue[];
    /**
     * The total the last write that knew the original set: a desk reissue, or a refresh on the quote
     * page. A row whose total is anything else was moved by something that did not (an edit), so the
     * original can no longer be priced from with certainty. Absent on a record written before it
     * existed, where the newest issue's total stands in.
     */
    lastSetPence?: number;
}

export function reissueRecordOf(row: Pick<QuoteRowLike, 'pricingSuggestions'>): ReissueRecord | null {
    const r = (row.pricingSuggestions as { reissue?: unknown } | null | undefined)?.reissue as ReissueRecord | undefined;
    if (!r || typeof r !== 'object' || !r.original || !Array.isArray(r.issues)) return null;
    if (!Number.isInteger(r.original.totalPence) || !Array.isArray(r.original.lines)) return null;
    return r;
}

/** The newest reissue on the row, or null. */
export function lastIssue(record: ReissueRecord | null): ReissueIssue | null {
    return record?.issues.length ? record.issues[record.issues.length - 1] : null;
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
        reissue: reissueRecordOf(row),
    };
}

// ---------------------------------------------------------------- figures

/** A figure exactly as the quote shows it and the figure guard compares it: pounds and pence, always two decimals. */
export function pounds(pence: number): string {
    return `£${(pence / 100).toFixed(2)}`;
}

export const TOTAL_LABEL = 'Total';
export const DEPOSIT_LABEL = 'Deposit';

export interface QuoteLineRead {
    /** The label as the quote prints it, never the citation below, which is the desk's own key. */
    label: string;
    amountPence: number;
    amount: string;
    citation: { quoteRef: string; line: string };
}

export type QuoteLineReadOutcome = { ok: true; value: QuoteLineRead } | { ok: false; reason: string; status: QuoteStatus };

/** One figure of the quote: the quote's own label for it, and the name it is cited and recorded under. */
export interface QuoteFigure {
    /** The quote's label for it, as the page prints it. Two lines may share one. */
    label: string;
    /**
     * The name this figure is cited and recorded under, unique on the quote: the label, or the label
     * with its position when another line carries the same one. Two lines titled the same is ordinary
     * work (two fence panels, two taps), and one line's price may never be given as another's.
     */
    citation: string;
    /** Another line carries the same label: no figure may be read under it. */
    shared: boolean;
    amountPence: number;
}

/**
 * Every figure a customer may be read: each priced line, the total and the deposit. A line's labour
 * and materials halves are not among them. They are a breakdown of a line rather than a line
 * (behaviour.md answer 23: a figure may be given only as one line of the live quote, to the penny,
 * cited as that line), and the quote page prints them rounded to whole pounds, so an amount to the
 * penny would be one that appears nowhere on the quote the customer holds.
 */
export function figureLabels(q: QuoteRecord): QuoteFigure[] {
    const priced = q.lines.filter((l) => l.pricePence != null);
    const shared = (label: string) => priced.filter((l) => norm(l.label) === norm(label)).length > 1;
    const out: QuoteFigure[] = priced.map((l, i) => ({
        label: l.label,
        citation: shared(l.label) ? `${l.label} (line ${i + 1})` : l.label,
        shared: shared(l.label),
        amountPence: l.pricePence!,
    }));
    if (q.totalPence != null) out.push({ label: TOTAL_LABEL, citation: TOTAL_LABEL, shared: false, amountPence: q.totalPence });
    if (q.depositPence != null && q.depositPence > 0) out.push({ label: DEPOSIT_LABEL, citation: DEPOSIT_LABEL, shared: false, amountPence: q.depositPence });
    return out;
}

function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

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
 * figure guard verifies. Refuses a draft, a revoked, a superseded and an expired quote, a label that
 * is not on it, and a label two lines share.
 */
export function readQuoteLine(q: QuoteRecord, label: string): QuoteLineReadOutcome {
    if (!quoteLiveForFigures(q)) return { ok: false, reason: `the quote is ${q.status}; a figure is read only from the live quote the customer holds`, status: q.status };
    const want = norm(label);
    // Asked by the quote's own label only. The citation, with its line position, is the desk's key
    // for a figure and never a name to ask by: named by a label two lines share, none is meant.
    const hits = figureLabels(q).filter((f) => norm(f.label) === want);
    if (!hits.length) return { ok: false, reason: `no line labelled "${label}" on quote ${q.slug}`, status: q.status };
    if (hits.length > 1) return { ok: false, reason: `quote ${q.slug} carries ${hits.length} lines labelled "${label}"; which one is meant is not the desk's to guess`, status: q.status };
    const hit = hits[0];
    return { ok: true, value: { label: hit.label, amountPence: hit.amountPence, amount: pounds(hit.amountPence), citation: { quoteRef: q.slug, line: hit.citation } } };
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
    reissued: 'quote_reissued',     // Ben's: the desk reissued an expired quote (reissue.ts)
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

// ---------------------------------------------------------------- the desk's reissues on the file

/** The citation line a reissue's own fact carries: the run that claimed it, which is how a later turn knows whether the customer was told. */
export const reissueLineOf = (runId: string): string => `reissue:${runId}`;

/** What Ben's card reads about a reissue: the figure, the one before it, that it was automatic, and whether and when the customer was told. */
export interface ReissueNote {
    slug: string;
    runId: string;
    amount: string;
    previous: string;
    automatic: true;
    /** When the message telling the customer was sent; null when it was not. */
    sentAt: string | null;
    /** Why the customer was not told, when they were not. */
    notSent: string | null;
    at: string;
}

/**
 * Whether the file already records that `slug` was accepted and its deposit paid: the acceptance
 * notification `notifyBen` writes once per quote, cited to that quote (quoting/quoting-tools.ts).
 * The one read of it, for the live Stripe path (a payment delivered twice) and for anything whose
 * words are only true of a quote still waiting to be accepted.
 */
export function acceptanceRecorded(file: CaseFile, slug: string): boolean {
    return factsWithPrefix(file, QUOTE_FACT.accepted).some((f) => f.source.kind === 'quote_line' && f.source.quoteRef === slug);
}

/** Whether the file already records what became of the reissue `runId` claimed. */
export function reissueRecorded(file: CaseFile, slug: string, runId: string): boolean {
    const line = reissueLineOf(runId);
    return factsWithPrefix(file, QUOTE_FACT.reissued).some((f) => f.source.kind === 'quote_line' && f.source.quoteRef === slug && f.source.line === line);
}

/** Every reissue the file records, oldest first, as Ben's card shows them. */
export function reissueNotes(file: CaseFile): ReissueNote[] {
    return factsWithPrefix(file, QUOTE_FACT.reissued).flatMap((f) => {
        if (f.source.kind !== 'quote_line' || !f.source.line.startsWith('reissue:')) return [];
        const [amount, was, , ...rest] = f.value.split(' | ');
        const outcome = rest.join(' | ');
        const sent = /^sent (.+)$/.exec(outcome);
        return [{ slug: f.source.quoteRef, runId: f.source.line.slice('reissue:'.length), amount, previous: (was ?? '').replace(/^was /, ''), automatic: true as const, sentAt: sent ? sent[1] : null, notSent: sent ? null : outcome.replace(/^not sent: /, '') || null, at: f.at }];
    });
}
