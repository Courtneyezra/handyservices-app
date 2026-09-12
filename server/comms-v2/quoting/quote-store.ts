/**
 * Where the Quoting tool server reads and writes the quote: the personalized_quotes row, through
 * the quote machinery that survives the comms rebuild (design.md: the quote engine, the price book
 * and Ben's price screen are not comms and are not deleted; the Quoting tool server wraps them).
 *
 *   read          the row by slug, as a QuoteRecord source
 *   insertDraft   the chain's draft row (built by quote-intake.ts pricedDraftRow, every price null)
 *   price         Ben's per-line prices (or the chain's suggestions for the lines he leaves), written
 *                 by the price screen's own confirmPrices, the only thing that writes a
 *                 customer-visible price; refuses anything that is not a draft
 *   accept        the human event: depositPaidAt, as the Stripe webhook writes it live (answer 42:
 *                 payment paths are not validated live, so the sandbox records the event itself)
 *   addPhotos     a photo that arrives after the draft joins it, so Ben's screen shows it
 *   deleteSandbox the sandbox's own rows on the reserved number, for /reset
 *
 * The live store imports the database on first use, so a test with a memory store opens nothing -
 * and it opens nothing at all unless the database in use is the branch COMMS_V2_DATABASE_URL names
 * (live-database.ts), so the sandbox door mounted on the deployed server cannot write a real quote.
 */
import { assertCommsV2Database, commsV2Db } from '../live-database';
import type { QuoteRowLike } from './quote-record';

export interface DraftInsert {
    id: string;
    shortSlug: string;
    [column: string]: unknown;
}

export interface PriceInput {
    /** Ben's per-line prices, as his price screen writes them. Absent lines take the chain's suggestion. */
    lines?: Array<{ lineId: string; finalPence: number }>;
    /** Who priced it, for the verdict rows: `human:<id>`. */
    by: string;
}

export type PriceOutcome =
    | { ok: true; totals: { totalPence: number; depositPence: number }; quoteUrl: string }
    | { ok: false; status: number; reason: string };

export type AcceptOutcome = { ok: true; depositPence: number } | { ok: false; status: number; reason: string };
export type MarkSentOutcome = { ok: true } | { ok: false; status: number; reason: string };

export interface QuoteStore {
    read(slug: string): Promise<QuoteRowLike | null>;
    insertDraft(row: DraftInsert): Promise<{ id: string; slug: string }>;
    price(slug: string, input: PriceInput): Promise<PriceOutcome>;
    /** The quote leaves draft once Ben's send has actually landed. Separate from `price` because that is what the old path does: the price screen writes the prices, the delivery writes is_draft false. */
    markSent(slug: string): Promise<MarkSentOutcome>;
    accept(slug: string, now: Date): Promise<AcceptOutcome>;
    addPhotos(slug: string, urls: string[]): Promise<void>;
    deleteSandbox(phoneE164: string): Promise<{ quotes: number; estimates: number; verdicts: number; runs: number }>;
}

/** The columns the live read selects, which must cover every field `quoteRecordOf` reads from a row. */
export const QUOTE_READ_COLUMNS = {
    id: true, shortSlug: true, customerName: true, phone: true, postcode: true, isDraft: true, revokedAt: true, supersededAt: true,
    depositPaidAt: true, expiresAt: true, createdAt: true, basePrice: true, depositAmountPence: true, pricingLineItems: true, pricingSuggestions: true, customerPhotoUrls: true,
} as const;

/** Who the database refusal names when this store is the one that asked (live-database.ts). */
const READER = "the Quoting tool server's quote store";

/** The desk's own marker on the rows it creates, so the sandbox can find and remove them. */
export const CREATED_BY = 'comms_v2:quoting';
export const CREATED_BY_NAME = 'Comms desk (v2)';
export const SOURCE_CHANNEL = 'comms_v2';

export const liveQuoteStore: QuoteStore = {
    async read(slug) {
        const db = await commsV2Db(READER);
        const { personalizedQuotes } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const cols = Object.fromEntries(Object.keys(QUOTE_READ_COLUMNS).map((k) => [k, (personalizedQuotes as any)[k]]));
        const [row] = await db.select(cols as any).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
        return (row as QuoteRowLike | undefined) ?? null;
    },

    async insertDraft(row) {
        const db = await commsV2Db(READER);
        const { personalizedQuotes } = await import('@shared/schema');
        await db.insert(personalizedQuotes).values({ ...row, createdAt: new Date() } as any);
        return { id: row.id, slug: row.shortSlug };
    },

    async price(slug, input) {
        assertCommsV2Database(READER);
        const { loadPriceScreen, confirmPrices } = await import('../../spine/price-screen');
        const loaded = await loadPriceScreen(slug);
        if (!loaded.available) return { ok: false, status: loaded.status, reason: loaded.reason };
        if (loaded.status !== 'draft') return { ok: false, status: 409, reason: `quote ${slug} is ${loaded.status}; only a draft is priced` };
        const byId = new Map((input.lines ?? []).map((l) => [l.lineId, l.finalPence]));
        const missing = loaded.lines.filter((l) => !byId.has(l.lineId) && !(l.suggestedPence && l.suggestedPence > 0)).map((l) => l.title);
        if (missing.length) return { ok: false, status: 400, reason: `no price for ${missing.join(', ')}: the chain made no suggestion, so Ben's figure is needed (lines[])` };
        const finals = loaded.lines.map((l) => ({ lineId: l.lineId, finalPence: byId.get(l.lineId) ?? l.suggestedPence! }));
        const body = { version: loaded.version, lines: finals, message: null, messageEdited: false, resolutions: [] };
        const c = await confirmPrices(slug, body, { id: input.by.replace(/^human:/, ''), email: null });
        if (!c.ok) return { ok: false, status: c.status, reason: c.errors.join('; ') };
        return {
            ok: true,
            totals: { totalPence: c.totals.totalPence, depositPence: c.totals.depositPence },
            quoteUrl: c.payload.quoteUrl,
        };
    },

    /**
     * What server/agent-staff.ts finalizeQuoteSent writes on the quote row when a send lands:
     * `is_draft = false`, and nothing else. Its other writes (the conversation's stage and tags,
     * the ledger flag) belong to the old desk's tables; the case file carries those here. The
     * compare-and-set on is_draft means two sends cannot both mark it.
     */
    async markSent(slug) {
        const row = await this.read(slug);
        if (!row) return { ok: false, status: 404, reason: `no quote ${slug}` };
        if (row.isDraft === false) return { ok: false, status: 409, reason: `quote ${slug} is already with the customer` };
        const db = await commsV2Db(READER);
        const { personalizedQuotes } = await import('@shared/schema');
        const { and, eq } = await import('drizzle-orm');
        const updated = await db.update(personalizedQuotes).set({ isDraft: false } as any)
            .where(and(eq(personalizedQuotes.id, row.id), eq(personalizedQuotes.isDraft, true))).returning({ id: personalizedQuotes.id });
        if (!updated.length) return { ok: false, status: 409, reason: `quote ${slug} left draft while the send was going out` };
        return { ok: true };
    },

    async accept(slug, now) {
        const row = await this.read(slug);
        if (!row) return { ok: false, status: 404, reason: `no quote ${slug}` };
        if (row.isDraft !== false) return { ok: false, status: 409, reason: `quote ${slug} is still a draft; Ben prices and sends first` };
        if (row.depositPaidAt) return { ok: false, status: 409, reason: `quote ${slug} is already accepted` };
        if (row.revokedAt || row.supersededAt) return { ok: false, status: 409, reason: `quote ${slug} is no longer live` };
        const total = row.basePrice ?? 0;
        let depositPercent = 25;
        try { const { getPricingSettings } = await import('../../pricing-settings'); depositPercent = Number((await getPricingSettings() as any).depositPercent ?? depositPercent); } catch { /* the shared default */ }
        const { depositFor } = await import('@shared/pricing-settings');
        const depositPence = row.depositAmountPence && row.depositAmountPence > 0 ? row.depositAmountPence : depositFor(total, 0, depositPercent);
        const db = await commsV2Db(READER);
        const { personalizedQuotes } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(personalizedQuotes).set({ depositPaidAt: now, depositAmountPence: depositPence, paymentType: 'deposit', selectedAt: now } as any).where(eq(personalizedQuotes.id, row.id));
        return { ok: true, depositPence };
    },

    async addPhotos(slug, urls) {
        if (!urls.length) return;
        const row = await this.read(slug);
        if (!row || row.isDraft === false) return;
        const existing = Array.isArray(row.customerPhotoUrls) ? (row.customerPhotoUrls as string[]) : [];
        const next = Array.from(new Set([...existing, ...urls]));
        const db = await commsV2Db(READER);
        const { personalizedQuotes } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(personalizedQuotes).set({ customerPhotoUrls: next } as any).where(eq(personalizedQuotes.id, row.id));
    },

    async deleteSandbox(phoneE164) {
        const db = await commsV2Db(READER);
        const { sql } = await import('drizzle-orm');
        const digits = phoneE164.replace(/\D/g, '');
        const found: any = await db.execute(sql`select id, short_slug from personalized_quotes where created_by = ${CREATED_BY} and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = ${digits}`);
        const rows: Array<{ id: string; short_slug: string }> = Array.isArray(found) ? found : (found?.rows ?? []);
        if (!rows.length) return { quotes: 0, estimates: 0, verdicts: 0, runs: 0 };
        const ids = rows.map((r) => r.id);
        const slugs = rows.map((r) => r.short_slug);
        const count = (r: any): number => (typeof r?.rowCount === 'number' ? r.rowCount : Array.isArray(r) ? r.length : 0);
        let estimates = 0; let verdicts = 0; let runs = 0;
        try {
            const convs: any = await db.execute(sql`select distinct conversation_id from quote_estimates where draft_quote_id = any(${ids}) and conversation_id like 'case_%'`);
            const caseIds: string[] = (Array.isArray(convs) ? convs : (convs?.rows ?? [])).map((r: any) => String(r.conversation_id));
            if (caseIds.length) runs = count(await db.execute(sql`delete from agent_runs where conversation_id = any(${caseIds})`));
            estimates = count(await db.execute(sql`delete from quote_estimates where draft_quote_id = any(${ids}) or (conversation_id = any(${caseIds.length ? caseIds : ['-']}) )`));
        } catch { /* the estimate table may be absent on a branch; the quote rows still go */ }
        try { verdicts = count(await db.execute(sql`delete from quote_price_verdicts where slug = any(${slugs})`)); } catch { /* absent table */ }
        const quotes = count(await db.execute(sql`delete from personalized_quotes where id = any(${ids})`));
        return { quotes, estimates, verdicts, runs };
    },
};

// ---------------------------------------------------------------- a memory store for tests

export class MemoryQuoteStore implements QuoteStore {
    readonly rows = new Map<string, QuoteRowLike & Record<string, unknown>>();
    constructor(private readonly opts: { depositPercent?: number; baseUrl?: string } = {}) {}

    async read(slug: string) { return this.rows.get(slug) ?? null; }

    async insertDraft(row: DraftInsert) {
        this.rows.set(row.shortSlug, { ...(row as any), createdAt: new Date().toISOString() });
        return { id: row.id, slug: row.shortSlug };
    }

    async price(slug: string, input: PriceInput): Promise<PriceOutcome> {
        const row = this.rows.get(slug);
        if (!row) return { ok: false, status: 404, reason: 'No quote with that slug' };
        if (row.isDraft === false) return { ok: false, status: 409, reason: `quote ${slug} is sent; only a draft is priced` };
        if (row.revokedAt || row.supersededAt) return { ok: false, status: 409, reason: `quote ${slug} is not a draft` };
        const items: any[] = Array.isArray(row.pricingLineItems) ? (row.pricingLineItems as any[]) : [];
        const suggestions = ((row.pricingSuggestions as any)?.lines ?? []) as Array<{ lineId: string; suggestedPence: number }>;
        const suggested = (lineId: string) => suggestions.find((s) => s.lineId === lineId)?.suggestedPence ?? null;
        const byId = new Map((input.lines ?? []).map((l) => [l.lineId, l.finalPence]));
        const missing = items.filter((l) => !byId.has(l.lineId) && !suggested(l.lineId));
        if (missing.length) return { ok: false, status: 400, reason: `no price for ${missing.map((l) => l.label).join(', ')}` };
        const finals = items.map((l) => ({ lineId: l.lineId, finalPence: byId.get(l.lineId) ?? suggested(l.lineId)! }));
        const priced = items.map((l) => {
            const f = finals.find((x) => x.lineId === l.lineId)!;
            const materials = Math.min(Number(l.materialsPence ?? 0) || 0, f.finalPence);
            return { ...l, pricePence: f.finalPence, labourPence: f.finalPence - materials, materialsPence: materials, confirmedBy: 'human' };
        });
        const totalPence = finals.reduce((a, b) => a + b.finalPence, 0);
        const materialsPence = priced.reduce((a, b) => a + (b.materialsPence ?? 0), 0);
        const pct = this.opts.depositPercent ?? 25;
        const depositPence = Math.round((materialsPence + Math.round((totalPence - materialsPence) * (pct / 100))) / 100) * 100;
        // Exactly what confirmPrices leaves on the row: the prices, the totals and a fresh expiry.
        // It does NOT leave draft - the delivery does that (markSent) - and this fake must not either.
        Object.assign(row, { pricingLineItems: priced, basePrice: totalPence, depositAmountPence: depositPence, expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString() });
        const base = (this.opts.baseUrl ?? 'https://handyservices.app').replace(/\/$/, '');
        const quoteUrl = `${base}/quote/${slug}`;
        return { ok: true, totals: { totalPence, depositPence }, quoteUrl };
    }

    async markSent(slug: string): Promise<MarkSentOutcome> {
        const row = this.rows.get(slug);
        if (!row) return { ok: false, status: 404, reason: `no quote ${slug}` };
        if (row.isDraft === false) return { ok: false, status: 409, reason: `quote ${slug} is already with the customer` };
        row.isDraft = false;
        return { ok: true };
    }

    async accept(slug: string, now: Date): Promise<AcceptOutcome> {
        const row = this.rows.get(slug);
        if (!row) return { ok: false, status: 404, reason: `no quote ${slug}` };
        if (row.isDraft !== false) return { ok: false, status: 409, reason: `quote ${slug} is still a draft; Ben prices and sends first` };
        if (row.depositPaidAt) return { ok: false, status: 409, reason: `quote ${slug} is already accepted` };
        if (row.revokedAt || row.supersededAt) return { ok: false, status: 409, reason: `quote ${slug} is no longer live` };
        const depositPence = Number(row.depositAmountPence ?? 0) || 0;
        Object.assign(row, { depositPaidAt: now.toISOString(), paymentType: 'deposit', selectedAt: now.toISOString() });
        return { ok: true, depositPence };
    }

    async addPhotos(slug: string, urls: string[]) {
        const row = this.rows.get(slug);
        if (!row || row.isDraft === false) return;
        const existing = Array.isArray(row.customerPhotoUrls) ? (row.customerPhotoUrls as string[]) : [];
        row.customerPhotoUrls = Array.from(new Set([...existing, ...urls]));
    }

    async deleteSandbox(phoneE164: string) {
        let quotes = 0;
        for (const [slug, row] of Array.from(this.rows.entries())) if (row.phone === phoneE164) { this.rows.delete(slug); quotes++; }
        return { quotes, estimates: 0, verdicts: 0, runs: 0 };
    }
}
