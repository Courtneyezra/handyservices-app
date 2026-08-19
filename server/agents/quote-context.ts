/**
 * The quote, as the comms agent needs to see it once one is live.
 *
 * Before this existed the agent could see that a quote EXISTED and what it cost, and nothing
 * else — no line items, no view history, no expiry, no sense of whether it had already been
 * amended. That is not enough to answer a single real post-quote question: "what does the £340
 * cover", "can you take the doors out of it", "is it still valid", "can you come Tuesday".
 *
 * The view history matters more than it looks. 102 of the 104 quiet customers in the corpus had
 * OPENED their quote and 69 had opened it three or more times, so a reply written as though the
 * link went missing is a reply written to the wrong person. Handing the agent viewCount and
 * lastViewedAt is what makes that mistake avoidable rather than merely forbidden.
 */
import { db } from '../db';
import { personalizedQuotes, messages, masterBlockedDates } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { priceBandFor, type PriceBand } from './objection-levers';

/** A quote older than this is history, not a live negotiation. */
const LIVE_WINDOW_DAYS = 90;
/** Line items are a briefing, not a data dump. */
const MAX_LINES = 15;

export interface QuoteLineSummary {
    label: string;
    pricePence: number | null;
    priceGBP: number | null;
    /** The caveats this line's price rests on — the honest basis for a re-scope conversation. */
    assumptions?: string[];
}

export interface QuoteContext {
    slug: string;
    customerName: string | null;
    job: string;
    totalPence: number | null;
    totalGBP: number | null;
    depositPence: number | null;
    balancePence: number | null;
    lineItems: QuoteLineSummary[];
    lineItemsTruncated: number;
    optionalExtras: { label: string; priceGBP: number | null }[];
    /** Band + posture + observed conversion, so the agent routes before it writes. */
    priceBand: Pick<PriceBand, 'id' | 'label' | 'conversion' | 'posture' | 'playbook'>;

    createdAt: string | null;
    /** When the link actually went to this customer, read from the thread. Null if we cannot see it. */
    linkSentAt: string | null;
    hoursSinceSent: number | null;
    daysSinceSent: number | null;

    viewCount: number;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    /** Plain-English so the model cannot misread the numbers. */
    viewNote: string;

    expiresAt: string | null;
    expired: boolean;

    depositPaid: boolean;
    depositPaidAt: string | null;

    /** Has this customer's quote already been changed once? The only lever with a surviving signal. */
    amendment: {
        isRegeneration: boolean;
        regenerationCount: number;
        priorQuotesForThisCustomer: number;
        note: string;
    };

    surveyRequired: boolean;
    /** Dates the quote itself already offers. The ONLY dates that are safe to talk about. */
    offeredDates: string[];
    selectedDate: string | null;
    deferredLines: { label: string; priceGBP: number }[];

    /**
     * Every £ figure that legitimately belongs to this quote, in pence. The money guard checks
     * drafted figures against this set, so a fabricated number is refused even when the agent
     * cites a real slug.
     */
    allowedFigurePence: number[];

    isLive: boolean;
}

function pounds(pence: number | null | undefined): number | null {
    return pence == null ? null : Math.round(pence) / 100;
}

function iso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** Line total the customer sees: labour, plus materials, plus its share of structural cost. */
function lineTotalPence(l: any): number | null {
    const parts = [l?.guardedPricePence, l?.materialsWithMarginPence, l?.structuralSharePence]
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n !== 0);
    if (!parts.length) {
        const fallback = Number(l?.pricePence ?? l?.llmSuggestedPricePence);
        return Number.isFinite(fallback) && fallback !== 0 ? Math.round(fallback) : null;
    }
    return Math.round(parts.reduce((a, b) => a + b, 0));
}

/**
 * Loads the customer's quotes with everything a post-quote reply needs. Newest first, capped at
 * three — beyond that it is archaeology, not context.
 */
export async function loadQuoteContexts(opts: {
    digits: string;
    conversationId: string;
    limit?: number;
}): Promise<QuoteContext[]> {
    const limit = opts.limit ?? 3;

    const rows = await db.select().from(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${opts.digits}`)
        .orderBy(desc(personalizedQuotes.createdAt))
        .limit(8);

    if (rows.length === 0) return [];

    const kept = rows.slice(0, limit);

    // When did each link actually reach them? The thread is the only honest record: createdAt is
    // when the quote was BUILT, which can be hours or days before Ben sent it.
    const sentBySlug = new Map<string, string>();
    for (const q of kept) {
        if (!q.shortSlug) continue;
        const [msg] = await db.select({ at: messages.createdAt })
            .from(messages)
            .where(and(
                eq(messages.conversationId, opts.conversationId),
                eq(messages.direction, 'outbound'),
                sql`${messages.content} ILIKE ${'%' + q.shortSlug + '%'}`,
            ))
            .orderBy(messages.createdAt)
            .limit(1);
        if (msg?.at) sentBySlug.set(q.shortSlug, new Date(msg.at).toISOString());
    }

    const now = Date.now();

    return kept.map((q) => {
        const totalPence = q.selectedTierPricePence ?? q.basePrice ?? null;
        const band = priceBandFor(totalPence);

        const rawLines: any[] = Array.isArray(q.pricingLineItems) ? (q.pricingLineItems as any[]) : [];
        const usable = rawLines.filter((l) => l && (l.description || l.label || lineTotalPence(l) != null));
        const lineItems: QuoteLineSummary[] = usable.slice(0, MAX_LINES).map((l) => {
            const p = lineTotalPence(l);
            return {
                label: String(l.description ?? l.label ?? 'Line item').slice(0, 160),
                pricePence: p,
                priceGBP: pounds(p),
                ...(Array.isArray(l.assumptions) && l.assumptions.length
                    ? { assumptions: (l.assumptions as string[]).slice(0, 3).map((a) => String(a).slice(0, 160)) }
                    : {}),
            };
        });

        const extrasRaw: any[] = Array.isArray(q.optionalExtras) ? (q.optionalExtras as any[]) : [];
        const optionalExtras = extrasRaw.slice(0, 8).map((e) => ({
            label: String(e?.label ?? '').slice(0, 120),
            priceGBP: pounds(Number(e?.priceInPence ?? e?.pricePence) || null),
        }));

        const sentAt = q.shortSlug ? sentBySlug.get(q.shortSlug) ?? null : null;
        const sentMs = sentAt ? new Date(sentAt).getTime() : (q.createdAt ? new Date(q.createdAt).getTime() : null);
        const hoursSinceSent = sentMs ? Math.round((now - sentMs) / 3600_000) : null;

        const viewCount = q.viewCount ?? 0;
        const viewNote = viewCount > 0
            ? `They have opened this quote ${viewCount} time${viewCount === 1 ? '' : 's'}. They have SEEN it. Never write anything implying the link went missing or that they have not looked.`
            : q.viewedAt
                ? 'They have opened this quote at least once. They have SEEN it.'
                : 'No view recorded. Tracking is imperfect, so still do not accuse them of not looking.';

        const priorQuotes = rows.filter((r) =>
            r.id !== q.id && r.createdAt && q.createdAt && new Date(r.createdAt) < new Date(q.createdAt),
        ).length;
        const regenerationCount = q.regenerationCount ?? 0;
        const isRegeneration = !!q.regeneratedFromId || regenerationCount > 0;

        const depositPence = q.depositAmountPence ?? null;
        const balancePence = totalPence != null && depositPence != null ? totalPence - depositPence : null;

        const offeredDates = [
            ...((Array.isArray(q.availableDates) ? q.availableDates : []) as string[]),
            ...(((q.dateTimePreferences as any[]) ?? []).map((d) => d?.date).filter(Boolean) as string[]),
        ];

        const deferredRaw = (q.deferredLineItems as any[]) ?? [];
        const deferredLines = deferredRaw.map((d) => ({
            label: String(d?.label ?? '').slice(0, 120),
            priceGBP: pounds(Number(d?.pricePence) || 0) ?? 0,
        }));

        // Everything the customer could legitimately be told, in pence. Anything outside this set
        // is, by definition, a number the agent made up.
        const allowed = new Set<number>();
        const add = (n: number | null | undefined) => {
            const v = Number(n);
            if (Number.isFinite(v) && v > 0) allowed.add(Math.round(v));
        };
        add(totalPence);
        add(q.basePrice);
        add(q.selectedTierPricePence);
        add(depositPence);
        add(balancePence);
        add(q.materialsCostWithMarkupPence);
        add(q.surveyFeePence);
        add(q.schedulingFeeInPence);
        add(q.installmentAmountPence);
        for (const l of usable) {
            add(lineTotalPence(l));
            add(l?.guardedPricePence);
            add(l?.materialsWithMarginPence);
        }
        for (const e of extrasRaw) add(Number(e?.priceInPence ?? e?.pricePence));
        for (const d of deferredRaw) add(Number(d?.pricePence));

        const expiresAt = iso(q.expiresAt);
        const expired = !!expiresAt && new Date(expiresAt).getTime() < now;
        const createdMs = q.createdAt ? new Date(q.createdAt).getTime() : null;

        return {
            slug: q.shortSlug,
            customerName: q.customerName ?? null,
            job: (q.jobDescription ?? '').slice(0, 300),
            totalPence,
            totalGBP: pounds(totalPence),
            depositPence,
            balancePence,
            lineItems,
            lineItemsTruncated: Math.max(0, usable.length - lineItems.length),
            optionalExtras,
            priceBand: {
                id: band.id, label: band.label, conversion: band.conversion,
                posture: band.posture, playbook: band.playbook,
            },
            createdAt: iso(q.createdAt),
            linkSentAt: sentAt,
            hoursSinceSent,
            daysSinceSent: hoursSinceSent == null ? null : Math.round(hoursSinceSent / 24),
            viewCount,
            firstViewedAt: iso(q.viewedAt),
            lastViewedAt: iso(q.lastViewedAt),
            viewNote,
            expiresAt,
            expired,
            depositPaid: !!q.depositPaidAt,
            depositPaidAt: iso(q.depositPaidAt),
            amendment: {
                isRegeneration,
                regenerationCount,
                priorQuotesForThisCustomer: priorQuotes,
                note: isRegeneration || priorQuotes > 0
                    ? 'This customer has already had a quote changed once. Re-quoting is the only move in the corpus that survived the confound check, so a further edit is a reasonable thing to offer, but the new price is always Ben\'s.'
                    : 'No amendment on record. Offering to edit the quote is the best performing response to a price objection.',
            },
            surveyRequired: !!q.surveyRequired,
            offeredDates: Array.from(new Set(offeredDates)).sort(),
            selectedDate: iso(q.selectedDate),
            deferredLines,
            allowedFigurePence: Array.from(allowed).sort((a, b) => a - b),
            isLive: !q.depositPaidAt
                && createdMs != null
                && now - createdMs < LIVE_WINDOW_DAYS * 86_400_000,
        };
    });
}

// ---------------------------------------------------------------- read-only date signal

export interface DateSignal {
    date: string;
    valid: boolean;
    inThePast: boolean;
    /** Master calendar says nobody works that day. A hard no, cheaply known. */
    masterBlocked: boolean;
    /** The quote already offers this date to the customer, on the quote page's own picker. */
    offeredOnQuote: boolean;
    quoteSlug: string | null;
    /** Always false. Nothing here books anything, and nothing here lets you confirm a date. */
    mayPromise: false;
    guidance: string;
}

/**
 * The cheapest honest answer to "can you come Tuesday": is that date already on their quote?
 *
 * Deliberately NOT a live capacity check. Real availability depends on contractor fit, travel,
 * day sizing and a slot reservation that can 409 at the last moment, and an agent that reads a
 * "yes" here would promise a date the booking engine can still refuse. The quote's own offered
 * dates are the only dates we have already told this customer we can do, so they are the only
 * dates that are safe to mention.
 */
export async function checkDateSignal(date: string, quote: QuoteContext | null): Promise<DateSignal> {
    const iso10 = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
    if (!iso10) {
        return {
            date, valid: false, inThePast: false, masterBlocked: false, offeredOnQuote: false,
            quoteSlug: quote?.slug ?? null, mayPromise: false,
            guidance: 'Give the date as YYYY-MM-DD. If you cannot work out which date they mean, ask Ben rather than guessing.',
        };
    }

    const today = new Date().toISOString().slice(0, 10);
    const inThePast = iso10 < today;

    let masterBlocked = false;
    try {
        const [blocked] = await db.select({ id: masterBlockedDates.id })
            .from(masterBlockedDates)
            .where(eq(masterBlockedDates.date, iso10))
            .limit(1);
        masterBlocked = !!blocked;
    } catch {
        masterBlocked = false; // Unknown, so it stays a matter for Ben.
    }

    const offeredOnQuote = !!quote?.offeredDates.includes(iso10);

    const guidance = inThePast
        ? 'That date has passed. Ask what they meant rather than guessing at the next one.'
        : masterBlocked
            ? 'Nobody works that day. Do not offer it, do not counter-offer another date yourself, ask Ben.'
            : offeredOnQuote
                ? 'This date is already on their quote. Point them at the date picker on the quote so they book it there with the deposit. Do NOT confirm it yourself: booking happens on the quote, not in this chat.'
                : 'This date is NOT on their quote and nothing here confirms it. Ask Ben. Never promise a date the quote or the thread does not already confirm.';

    return {
        date: iso10, valid: true, inThePast, masterBlocked, offeredOnQuote,
        quoteSlug: quote?.slug ?? null, mayPromise: false, guidance,
    };
}
