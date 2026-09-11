/**
 * Contract 7 - The Quoting tool server. The second specialist's shelf, on the pattern of the
 * Scoping tool server (desk/scoping-tools.ts): every call is read-only against the world except
 * through the quote machinery it wraps, and writes to the case file only through its calls.
 *
 *   quote_readiness   job type and location both present; photos optional; what is missing, for Ben
 *   price_book        read-only catalogue match for a line's category; never a fact, never a chat figure
 *   draft_quote       the existing clerk chain (draft-quote.ts), once per job; refuses while a live quote stands
 *   notify_ben        one notification with the price screen link, recorded on the file; refuses a second
 *   chase             the unpriced draft chased on the clock (4.5), recorded like the notification
 *   quote_status      the quote's status and record, from the row
 *   read_quote_line   one line's amount to the penny with its citation; refuses draft, revoked, superseded, expired
 *   read_quote_scope  what is included and excluded; refuses revoked, superseded, expired
 *   record_quote_facts the quote's lines, total, deposit, link and scope onto the file, once, each cited as its line
 *   price_quote       Ben's prices through the price screen's own write; the desk's stage moves to quoted when his send lands
 *   record_acceptance the human event: refuses any witness but a human; flips the stage and notifies Ben
 *
 * Nothing here composes a sentence for the customer.
 */
import { randomUUID } from 'node:crypto';
import { STAGES, isReady, setStage, type CaseFile, type CaseFileDeps, type Fact, type Party } from '../desk/case-file';
import { ledgerEntry, factFor } from '../desk/case-file';
import { mediaDeclined, mediaReceived } from '../desk/scoping-tools';
import { acceptedNotice, chaseNotice, liveNotifier, readyToPriceNotice, type BenNotice, type BenNotifier } from './ben-notifier';
import { chainDrafter, type DraftIntake, type DraftOutcome, type Drafter } from './draft-quote';
import { DEPOSIT_LABEL, QUOTE_FACT, TOTAL_LABEL, factOnce, factsWithPrefix, figureLabels, newestFact, pounds, quoteRecordOf, quoteSource, quoteUrlFor, readQuoteLine, readQuoteScope, type QuoteRecord, type QuoteStatus } from './quote-record';
import { liveQuoteStore, type PriceInput, type QuoteStore } from './quote-store';

export interface QuotingDeps extends CaseFileDeps {
    store?: QuoteStore;
    drafter?: Drafter;
    notifier?: BenNotifier;
    priceBook?: PriceBook;
    mode?: 'dry_run' | 'live';
    baseUrl?: string;
}

export interface ResolvedQuotingDeps {
    store: QuoteStore;
    drafter: Drafter;
    notifier: BenNotifier;
    priceBook: PriceBook;
    mode: 'dry_run' | 'live';
    baseUrl: string | undefined;
    now: () => Date;
    file: CaseFileDeps;
}

export function resolveQuotingDeps(deps: QuotingDeps = {}): ResolvedQuotingDeps {
    const store = deps.store ?? liveQuoteStore;
    return {
        store,
        drafter: deps.drafter ?? chainDrafter(store),
        notifier: deps.notifier ?? liveNotifier,
        priceBook: deps.priceBook ?? livePriceBook,
        mode: deps.mode ?? 'dry_run',
        baseUrl: deps.baseUrl,
        now: deps.now ?? (() => new Date()),
        file: { now: deps.now, newId: deps.newId },
    };
}

const BY = 'quoting';

// ---------------------------------------------------------------- quote_readiness

/** Ready is job type and location (photos optional, answer 3); `missing` is what Ben may want to request from the price screen. */
export function quoteReadiness(file: CaseFile): { ready: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!mediaReceived(file)) {
        const asked = ledgerEntry(file, 'media')?.askedAt;
        missing.push(mediaDeclined(file) ? 'photo (declined)' : asked ? 'photo (asked once, none sent)' : 'photo (not asked)');
    }
    if (!factFor(file, 'access')) missing.push('access (parking, someone in)');
    return { ready: isReady(file), missing };
}

// ---------------------------------------------------------------- price_book

export interface PriceBook {
    /** A catalogue match for a line, for Ben's screen and the engine. Read-only. Null when nothing matches. */
    lookup(description: string, category?: string | null): Promise<{ skuCode: string; name: string; confidence: 'high' | 'medium' | 'low' } | null>;
}

/** The catalogue matcher the pricing engine already uses (server/contextual-pricing/sku-matcher.ts), loaded on first use. */
export const livePriceBook: PriceBook = {
    async lookup(description, category) {
        try {
            const { matchLineToSku } = await import('../../contextual-pricing/sku-matcher');
            const m = await matchLineToSku({ description, ...(category ? { category } : {}) });
            return m ? { skuCode: m.skuCode, name: m.name, confidence: m.confidence } : null;
        } catch {
            return null;
        }
    },
};

export const emptyPriceBook: PriceBook = { async lookup() { return null; } };

/** price_book: a match for Ben's screen. Records nothing on the file; a figure never comes from here. */
export async function priceBookLookup(description: string, category: string | null, deps: QuotingDeps = {}): Promise<{ skuCode: string; name: string; confidence: string } | null> {
    return resolveQuotingDeps(deps).priceBook.lookup(description, category);
}

// ---------------------------------------------------------------- quote_status

export async function loadQuote(file: CaseFile, deps: QuotingDeps = {}): Promise<QuoteRecord | null> {
    if (!file.job.quoteRef) return null;
    const d = resolveQuotingDeps(deps);
    const row = await d.store.read(file.job.quoteRef);
    return row ? quoteRecordOf(row, d.now()) : null;
}

export async function quoteStatus(file: CaseFile, deps: QuotingDeps = {}): Promise<{ status: QuoteStatus; record: QuoteRecord } | null> {
    const q = await loadQuote(file, deps);
    return q ? { status: q.status, record: q } : null;
}

// ---------------------------------------------------------------- draft_quote

export type DraftQuoteOutcome = DraftOutcome & { factIds: string[]; notice: BenNotice | null; notified: boolean };

/**
 * Drafts the quote for Ben the moment the job and location are known, through the existing chain.
 * Refuses when the file is not ready, and while a quote that is not a draft (sent or accepted)
 * stands: a change to a live quote is Ben's (checklist cross-cutting 6). A standing draft is left
 * alone too: one draft per job; Ben's screen is where it changes.
 */
export async function draftQuote(file: CaseFile, party: Party, intake: DraftIntake, deps: QuotingDeps = {}): Promise<DraftQuoteOutcome> {
    const d = resolveQuotingDeps(deps);
    const refuse = (reason: string): DraftQuoteOutcome => ({ ok: false, reason, log: [], calls: [], factIds: [], notice: null, notified: false });
    if (!isReady(file)) return refuse('not ready: the job type and the location are both needed before a draft');
    if (file.job.quoteRef) {
        const existing = await loadQuote(file, deps);
        if (existing && existing.status !== 'revoked' && existing.status !== 'superseded' && existing.status !== 'expired') return refuse(`a quote already stands (${existing.slug}, ${existing.status}); one draft per job, changes are Ben's`);
    }
    if (!intake.lines.length) return refuse('an intake needs at least one line');
    const out = await d.drafter.draft({ file, party, intake, now: d.now(), baseUrl: d.baseUrl });
    if (!out.ok) return { ...out, factIds: [], notice: null, notified: false };
    file.job.quoteRef = out.slug;
    const factIds: string[] = [];
    const rec = (key: string, value: string, line: string) => { const f = factOnce(file, { key, value, source: quoteSource(out.slug, line), by: BY }, d.file); if (f) factIds.push(f.id); };
    rec(QUOTE_FACT.ref, out.slug, 'reference');
    rec(QUOTE_FACT.status, 'draft: with Ben to price', 'status');
    for (const l of intake.lines) rec(`${QUOTE_FACT.scope}:${l.title}`, [l.qty > 1 ? `${l.qty} x ${l.title}` : l.title, l.detail].filter(Boolean).join(' - '), l.title);
    for (const l of intake.lines) for (const n of l.notIncluded) rec(`${QUOTE_FACT.notIncluded}:${l.title}`, n, l.title);
    // notify_ben: once, with the price screen link.
    const notice = readyToPriceNotice({ customerName: intake.customerName ?? party.name, postcode: intake.postcode, slug: out.slug, lines: out.lines, checkThis: out.checkThis, suggestedTotalPence: out.suggestedTotalPence, estimatorFailed: out.estimatorFailed, missing: intake.missing, at: d.now().toISOString(), baseUrl: d.baseUrl });
    const n = await notifyBen(file, notice, party, deps);
    if (n.factId) factIds.push(n.factId);
    return { ...out, factIds, notice, notified: n.ok };
}

// ---------------------------------------------------------------- notify_ben

export type NotifyOutcome = { ok: true; factId: string | null; dispatched: boolean; note: string } | { ok: false; reason: string; factId: null; dispatched: false };

/** One notification per quote and kind for ready_to_price and accepted; chases are numbered. Recorded on the file as a fact, cited to the quote. */
export async function notifyBen(file: CaseFile, notice: BenNotice, party: Party, deps: QuotingDeps = {}): Promise<NotifyOutcome> {
    const d = resolveQuotingDeps(deps);
    const slug = file.job.quoteRef;
    if (!slug) return { ok: false, reason: 'no quote on the file to notify Ben about', factId: null, dispatched: false };
    const key = notice.kind === 'chase' ? QUOTE_FACT.benChased : notice.kind === 'accepted' ? QUOTE_FACT.accepted : QUOTE_FACT.benNotified;
    if (notice.kind !== 'chase' && factsWithPrefix(file, key).some((f) => f.source.kind === 'quote_line' && f.source.quoteRef === slug)) {
        return { ok: false, reason: `Ben has already been notified (${notice.kind}) for quote ${slug}; one notification`, factId: null, dispatched: false };
    }
    const address = party.channels.find((c) => c.kind === 'whatsapp')?.address ?? party.channels[0]?.address ?? null;
    const r = await d.notifier.notify(notice, { mode: d.mode, slug, caseId: file.id, customerName: party.name, phone: address });
    const value = `${notice.title}${notice.link ? ` | ${notice.link}` : ''} | ${r.note}`;
    const f = factOnce(file, { key, value, source: quoteSource(slug, notice.kind === 'chase' ? 'chase' : notice.kind === 'accepted' ? 'acceptance' : 'notification'), by: BY }, d.file);
    return { ok: true, factId: f?.id ?? null, dispatched: r.dispatched, note: r.note };
}

// ---------------------------------------------------------------- chase

export const CHASE_AFTER_MS = 4 * 3_600_000;
export const CHASE_EVERY_MS = 24 * 3_600_000;
export const CHASE_MAX = 3;

export interface ChaseOutcome { chased: boolean; n: number; reason: string; notice: BenNotice | null }

/** An unpriced draft is chased, not left after one notification (4.5): first after four hours, then daily, three times. Never a customer send. */
export async function chase(file: CaseFile, party: Party, deps: QuotingDeps = {}): Promise<ChaseOutcome> {
    const d = resolveQuotingDeps(deps);
    const q = await loadQuote(file, deps);
    if (!q) return { chased: false, n: 0, reason: 'no quote on the file', notice: null };
    if (q.status !== 'draft') return { chased: false, n: 0, reason: `the quote is ${q.status}; nothing to chase`, notice: null };
    const notified = newestFact(file, QUOTE_FACT.benNotified);
    if (!notified) return { chased: false, n: 0, reason: 'Ben has not been notified yet; nothing to chase', notice: null };
    const chases = factsWithPrefix(file, QUOTE_FACT.benChased).filter((f) => f.source.kind === 'quote_line' && f.source.quoteRef === q.slug);
    const n = chases.length;
    if (n >= CHASE_MAX) return { chased: false, n, reason: `chased ${n} times already; the desk stops chasing at ${CHASE_MAX}`, notice: null };
    const now = d.now();
    const last = chases.length ? chases[chases.length - 1] : null;
    const since = Date.parse(last ? last.at : notified.at);
    const wait = last ? CHASE_EVERY_MS : CHASE_AFTER_MS;
    if (now.getTime() - since < wait) return { chased: false, n, reason: `not due: ${Math.round((wait - (now.getTime() - since)) / 60_000)} min until chase ${n + 1}`, notice: null };
    const notice = chaseNotice({ customerName: party.name, slug: q.slug, n: n + 1, waitingSince: notified.at, at: now.toISOString(), baseUrl: d.baseUrl });
    const r = await notifyBen(file, notice, party, deps);
    return { chased: r.ok, n: n + 1, reason: r.ok ? r.note : r.reason, notice: r.ok ? notice : null };
}

// ---------------------------------------------------------------- read_quote_line, read_quote_scope

export { readQuoteLine, readQuoteScope };

// ---------------------------------------------------------------- record_quote_facts

export interface QuoteFactIds {
    status: string | null;
    link: string | null;
    lines: Record<string, string>;
    scope: string[];
    notIncluded: string[];
    assumptions: string[];
}

/**
 * The quote onto the file as facts, once each, cited to the quote and the line: status; the link;
 * every figure the customer can be read (each line, its halves, the total, the deposit) only when
 * the quote is live for figures; and scope, not-included and assumptions when live for scope.
 */
export function recordQuoteFacts(file: CaseFile, q: QuoteRecord, deps: QuotingDeps = {}): QuoteFactIds {
    const d = resolveQuotingDeps(deps);
    const ids: QuoteFactIds = { status: null, link: null, lines: {}, scope: [], notIncluded: [], assumptions: [] };
    const once = (key: string, value: string, line: string): Fact | null => factOnce(file, { key, value, source: quoteSource(q.slug, line), by: BY }, d.file);
    const statusText: Record<QuoteStatus, string> = {
        draft: 'draft: with Ben to price', sent: 'sent: the customer has the link', accepted: 'accepted: the deposit is paid',
        revoked: 'revoked by Ben', superseded: 'superseded by a newer quote', expired: 'expired: Ben to reissue',
    };
    ids.status = once(QUOTE_FACT.status, statusText[q.status], 'status')?.id ?? null;
    if (q.status === 'sent' || q.status === 'accepted') {
        ids.link = once(QUOTE_FACT.link, quoteUrlFor(q.slug, d.baseUrl), 'link')?.id ?? null;
        for (const f of figureLabels(q)) {
            const read = readQuoteLine(q, f.label);
            if (!read.ok) continue;
            const fact = once(`${QUOTE_FACT.line}:${read.value.label}`, read.value.amount, read.value.citation.line);
            if (fact) ids.lines[read.value.label] = fact.id;
        }
    }
    const scope = readQuoteScope(q);
    if (scope.ok) {
        for (const l of scope.value.lines) {
            const s = once(`${QUOTE_FACT.scope}:${l.label}`, [l.qty > 1 ? `${l.qty} x ${l.label}` : l.label, l.notes].filter(Boolean).join(' - '), l.label);
            if (s) ids.scope.push(s.id);
            for (const n of l.notIncluded) { const f = once(`${QUOTE_FACT.notIncluded}:${l.label}`, n, l.label); if (f) ids.notIncluded.push(f.id); }
            for (const a of l.assumptions) { const f = once(`${QUOTE_FACT.assumption}:${l.label}`, a, l.label); if (f) ids.assumptions.push(f.id); }
        }
    }
    return ids;
}

export { TOTAL_LABEL, DEPOSIT_LABEL, pounds };

// ---------------------------------------------------------------- price_quote (Ben)

export type PriceQuoteOutcome =
    | { ok: true; record: QuoteRecord; message: string; quoteUrl: string; totals: { totalPence: number; depositPence: number }; factIds: string[] }
    | { ok: false; status: number; reason: string };

/** Ben prices the draft: the price screen's own write, which leaves the row a draft. The quote leaves draft and its figures reach the file only once his send has landed (markQuoteSent). */
export async function priceQuote(file: CaseFile, input: Omit<PriceInput, 'by'> & { by?: string }, deps: QuotingDeps = {}): Promise<PriceQuoteOutcome> {
    const d = resolveQuotingDeps(deps);
    if (!file.job.quoteRef) return { ok: false, status: 409, reason: 'no quote on the file: the desk drafts one once the job and the location are known' };
    const by = input.by ?? 'human:ben';
    const r = await d.store.price(file.job.quoteRef, { ...input, by });
    if (!r.ok) return r;
    const row = await d.store.read(file.job.quoteRef);
    if (!row) return { ok: false, status: 500, reason: 'the priced row could not be read back' };
    const record = quoteRecordOf(row, d.now());
    const ids = recordQuoteFacts(file, record, deps);
    const factIds = [ids.status, ids.link, ...Object.values(ids.lines)].filter((x): x is string => !!x);
    return { ok: true, record, message: r.message, quoteUrl: r.quoteUrl, totals: { totalPence: r.totals.totalPence, depositPence: r.totals.depositPence }, factIds };
}

export type MarkSentOutcome =
    | { ok: true; record: QuoteRecord; factIds: string[] }
    | { ok: false; status: number; reason: string };

/**
 * After Ben's send has actually landed: the quote leaves draft (what the old path's
 * finalizeQuoteSent writes on the row, and the only thing `confirmPrices` does not), its figures
 * land on the file as facts cited to their line, and the stage walks forward to quoted.
 *
 * Separate from `price_quote` on purpose, and in this order: a quote whose send was refused (a
 * shut window with no approved template) stays a draft Ben can price again, and no figure the
 * customer has not been sent is ever on the file.
 */
export async function markQuoteSent(file: CaseFile, deps: QuotingDeps = {}): Promise<MarkSentOutcome> {
    const d = resolveQuotingDeps(deps);
    if (!file.job.quoteRef) return { ok: false, status: 409, reason: 'no quote on the file' };
    const marked = await d.store.markSent(file.job.quoteRef);
    if (!marked.ok) return marked;
    const row = await d.store.read(file.job.quoteRef);
    if (!row) return { ok: false, status: 500, reason: 'the sent row could not be read back' };
    const record = quoteRecordOf(row, d.now());
    const ids = recordQuoteFacts(file, record, deps);
    const why = `Ben priced and sent quote ${file.job.quoteRef}`;
    for (const next of ['scoping', 'ready', 'quoted'] as const) {
        if (STAGES.indexOf(file.stage) >= STAGES.indexOf(next)) continue;
        const r = setStage(file, next, why, d.file);
        if (!r.ok) return { ok: false, status: 409, reason: r.reason };
    }
    return { ok: true, record, factIds: [ids.status, ids.link, ...Object.values(ids.lines)].filter((x): x is string => !!x) };
}

// ---------------------------------------------------------------- record_acceptance (human)

export interface AcceptanceWitness { by: 'human'; via: string }

export type AcceptanceOutcome =
    | { ok: true; depositPence: number; factIds: string[]; notice: BenNotice | null; turnBody: string }
    | { ok: false; status: number; reason: string };

/**
 * Acceptance is a human event, never the specialist's: the customer accepts on the quote page and
 * pays the deposit (live, the Stripe webhook; in the sandbox, the door's own action). Recorded here:
 * the row, the stage (quoted -> accepted), one notification to Ben, the facts. Refuses any witness
 * that is not a human.
 */
export async function recordAcceptance(file: CaseFile, party: Party, witness: AcceptanceWitness | { by: string; via?: string }, deps: QuotingDeps = {}): Promise<AcceptanceOutcome> {
    const d = resolveQuotingDeps(deps);
    if (witness.by !== 'human') return { ok: false, status: 403, reason: `acceptance is a human event; refused for witness "${witness.by}"` };
    if (!file.job.quoteRef) return { ok: false, status: 409, reason: 'no quote on the file to accept' };
    const now = d.now();
    const r = await d.store.accept(file.job.quoteRef, now);
    if (!r.ok) return r;
    const row = await d.store.read(file.job.quoteRef);
    const record = row ? quoteRecordOf(row, now) : null;
    if (file.stage === 'quoted') setStage(file, 'accepted', `the customer accepted quote ${file.job.quoteRef} (${witness.via ?? 'quote page'})`, d.file);
    const factIds: string[] = [];
    if (record) {
        const ids = recordQuoteFacts(file, record, deps);
        factIds.push(...[ids.status, ids.link, ...Object.values(ids.lines)].filter((x): x is string => !!x));
    }
    const address = party.channels.find((c) => c.kind === 'whatsapp')?.address ?? null;
    const notice = acceptedNotice({ customerName: party.name, phone: address, jobSummary: record?.lines.map((l) => l.label).join('; ') ?? null, depositPence: r.depositPence, at: now.toISOString() });
    const n = await notifyBen(file, notice, party, deps);
    if (n.ok && n.factId) factIds.push(n.factId);
    return { ok: true, depositPence: r.depositPence, factIds, notice: n.ok ? notice : null, turnBody: `Accepted quote ${file.job.quoteRef} on the quote page${r.depositPence > 0 ? ` and paid the ${pounds(r.depositPence)} deposit` : ''}.` };
}

/** A run id for a human action on the door. */
export function humanRunId(): string { return `human_${randomUUID()}`; }
