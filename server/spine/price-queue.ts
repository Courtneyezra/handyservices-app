/**
 * THE PRICE QUEUE (T9, docs/comms-build/BRIEF-T9-price-queue.md).
 *
 * Every Route A draft waiting for Ben to price it, oldest first, for `/admin/price` (the index),
 * the sidebar badge and the strip on the price screen. The failure this exists for is a quote
 * quietly sitting for days after the one Pushover Route A fires at creation (PRD v3 §9), so age is
 * the point: each item carries how long it has waited, and the payload carries the oldest.
 *
 * What counts as "waiting" is NOT defined here. It is `WAITING_DRAFT_WHERE` in price-brief.ts,
 * the same clause the confirm screen's "Next quote waiting" button reads (loadNextWaiting). The
 * pure builder re-applies the same rule (statusOf === 'draft', holdOf === null) as a belt.
 *
 * The per-item signals are the price screen's own: `buildScreenLine` (price-screen.ts) says
 * check-this, no suggestion (Ben must type a price before Send unlocks), confidence; and
 * `findContradictions` (price-brief.ts) the assumption-versus-materials clashes. Nothing is
 * invented here, and NO MONEY FIGURE LEAVES THIS MODULE: the margin passed to buildScreenLine is
 * 0 because the only pence it would shape (materials at margin) is never read, and the payload
 * type has no pence field. Read-only: nothing here prices, sends, holds, edits or deletes.
 */
import { buildScreenLine, firstNameOf, statusOf, type DraftRowShape, type EstimateRowShape } from './price-screen';
import { findContradictions, holdOf, jobPhrase, WAITING_DRAFT_WHERE } from './price-brief';

export interface PriceQueueSignals {
    /** Lines the engine marked check-this (fallback price, no history, unusual size…). */
    checkThis: number;
    /** Lines with no suggestion: Send stays locked until Ben types a price for them. */
    unpriced: number;
    /** Assumption-versus-materials clashes the screen will ask him to resolve. */
    contradictions: number;
    /** Lines at low confidence. */
    lowConfidence: number;
    /** The estimator's own status ('complete' / 'failed' / …), null when there is no estimate row. */
    estimateStatus: string | null;
}

export interface PriceQueueItem {
    slug: string;
    quoteId: string;
    firstName: string;
    name: string;
    postcode: string | null;
    customerType: string;
    /** The job in a few words: jobPhrase over the lines, else the row's own description. */
    job: string;
    lineCount: number;
    /** When the draft was created, i.e. when the single Pushover fired. */
    createdAt: string | null;
    /** How long it has waited, in ms, at `at`. 0 when the row has no created_at. */
    waitingMs: number;
    sourceChannel: string | null;
    signals: PriceQueueSignals;
}

export interface PriceQueuePayload {
    count: number;
    /** Oldest first, always. */
    items: PriceQueueItem[];
    oldestWaitingMs: number | null;
    /** The clock the ages were measured against (ISO). */
    at: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function matchById<T extends { lineId?: string }>(items: T[] | null | undefined, lineId: string | null, index: number): T | null {
    if (!Array.isArray(items) || !items.length) return null;
    if (lineId) { const hit = items.find((x) => str(x?.lineId) === lineId); if (hit) return hit; }
    return items[index] ?? null;
}

/** One queue item from the draft row and its (optional) estimate. Pure. */
export function buildQueueItem(row: DraftRowShape, estimate: EstimateRowShape | null, now: Date): PriceQueueItem {
    const draftLines: any[] = Array.isArray(row.pricing_line_items) ? row.pricing_line_items : [];
    const sugLines = row.pricing_suggestions?.lines ?? null;
    const estLines = estimate?.lines ?? null;
    const lines = draftLines.map((line, i) => buildScreenLine({
        index: i, line,
        estimateLine: matchById(estLines, str(line?.lineId), i),
        suggestion: matchById(sugLines, str(line?.lineId), i),
        materialsMarginPercent: 0, // no pence figure is read from the result; see the module note
    }));
    const contradictions = findContradictions(lines.map((l) => ({
        lineId: l.lineId, title: l.title, assumptions: l.assumptions, materials: l.materials.map((m) => ({ name: m.name, qty: m.qty })),
    })));
    const createdAt = str(row.created_at);
    const createdMs = createdAt ? Date.parse(createdAt) : NaN;
    const waitingMs = Number.isFinite(createdMs) ? Math.max(0, now.getTime() - createdMs) : 0;
    const job = lines.length ? jobPhrase(lines.map((l) => ({ title: l.title, qty: l.qty }))) : (str(row.job_description) ?? 'the work');
    return {
        slug: row.short_slug,
        quoteId: row.id,
        firstName: firstNameOf(row.customer_name),
        name: row.customer_name ?? 'Customer',
        postcode: row.postcode ?? null,
        customerType: row.customer_type ?? 'homeowner',
        job,
        lineCount: lines.length,
        createdAt,
        waitingMs,
        sourceChannel: str(row.source_channel),
        signals: {
            checkThis: lines.filter((l) => l.checkThis).length,
            unpriced: lines.filter((l) => l.suggestedPence == null).length,
            contradictions: contradictions.length,
            lowConfidence: lines.filter((l) => l.confidence === 'low').length,
            estimateStatus: estimate?.status ?? null,
        },
    };
}

/**
 * The whole payload. Pure: every DB read happens in loadPriceQueue. Rows that are not waiting
 * (sent, superseded, revoked, or held by Ben) are dropped here too, the same rule as the SQL.
 */
export function buildPriceQueue(input: { rows: DraftRowShape[]; estimates: Map<string, EstimateRowShape | null> | Record<string, EstimateRowShape | null>; now?: Date }): PriceQueuePayload {
    const now = input.now ?? new Date();
    const est = (id: string): EstimateRowShape | null =>
        input.estimates instanceof Map ? (input.estimates.get(id) ?? null) : (input.estimates[id] ?? null);
    const items = input.rows
        .filter((row) => statusOf(row) === 'draft' && row.pricing_suggestions != null && holdOf(row.pricing_suggestions as any) == null)
        .map((row) => buildQueueItem(row, est(row.id), now))
        .sort((a, b) => b.waitingMs - a.waitingMs || a.slug.localeCompare(b.slug));
    return {
        count: items.length,
        items,
        oldestWaitingMs: items.length ? items[0].waitingMs : null,
        at: now.toISOString(),
    };
}

// ---------------------------------------------------------------- db

/** At most this many rows; a queue longer than this is a different problem from a missed Pushover. */
export const QUEUE_CAP = 200;

async function selectWaitingRows(): Promise<DraftRowShape[]> {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const r: any = await db.execute(sql`select to_jsonb(q) as row from personalized_quotes q
        where ${sql.raw(WAITING_DRAFT_WHERE)}
        order by q.created_at asc nulls last limit ${QUEUE_CAP}`);
    const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
    return rows.map((x) => x?.row).filter(Boolean);
}

/** The newest non-superseded quote_estimates row per draft, one query. Empty when the table is absent. */
async function selectEstimatesFor(quoteIds: string[]): Promise<Map<string, EstimateRowShape | null>> {
    const out = new Map<string, EstimateRowShape | null>();
    if (!quoteIds.length) return out;
    try {
        const { db } = await import('../db');
        const { sql } = await import('drizzle-orm');
        const r: any = await db.execute(sql`select distinct on (e.draft_quote_id) e.draft_quote_id as quote_id, to_jsonb(e) as row
            from quote_estimates e
            where e.draft_quote_id = any(${quoteIds}::text[])
            order by e.draft_quote_id, (e.superseded_at is null) desc, e.created_at desc`);
        const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
        for (const x of rows) if (x?.quote_id && x?.row) out.set(String(x.quote_id), x.row);
    } catch (error: any) {
        // 42P01 undefined_table: the estimate table is not here. The queue works without it.
        if (String(error?.code) === '42P01' || /quote_estimates/.test(String(error?.message))) return out;
        throw error;
    }
    return out;
}

export async function loadPriceQueue(now: Date = new Date()): Promise<PriceQueuePayload> {
    const rows = await selectWaitingRows();
    const estimates = await selectEstimatesFor(rows.map((r) => r.id));
    return buildPriceQueue({ rows, estimates, now });
}
