/**
 * Phase 25 — SKU resolver.
 *
 * Decouples line-item pricing from the LLM+time path for the ~87% of
 * customer line items that map cleanly to a catalog SKU. Given a request
 * line that carries `skuCode`, this helper resolves the price + on-site
 * minutes from the service_catalog row, applies the off-peak weekend
 * premium if the booking is scheduled on a Saturday, and returns the
 * fully resolved values for the engine to slot into LineItemResult.
 *
 * The lookup is cached per-process (5 min TTL) so we don't hit the DB
 * once per line on every quote. Cache is invalidated lazily on TTL.
 *
 * The legacy LLM-driven flow is unchanged — only lines tagged
 * `source: 'sku'` (or carrying a skuCode) go through here.
 */
import { db } from '../db';
import { serviceCatalog } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { ServiceCatalogRow } from '@shared/schema';

// ── tiny in-memory cache so we don't issue one query per line item ──────
const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { row: ServiceCatalogRow | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * Fetch a SKU row by code. Returns null when the code is unknown or the
 * row is inactive. Cached for CACHE_TTL_MS per process.
 */
export async function getSkuByCode(skuCode: string): Promise<ServiceCatalogRow | null> {
    const now = Date.now();
    const cached = cache.get(skuCode);
    if (cached && cached.expiresAt > now) return cached.row;

    try {
        const rows = await db
            .select()
            .from(serviceCatalog)
            .where(eq(serviceCatalog.skuCode, skuCode))
            .limit(1);
        const row = rows[0] && rows[0].isActive ? rows[0] : null;
        cache.set(skuCode, { row, expiresAt: now + CACHE_TTL_MS });
        return row;
    } catch (err: any) {
        console.error('[sku-resolver] getSkuByCode error:', err?.message || err);
        return null;
    }
}

/** Clear the per-process cache (used by tests / pick-count writes). */
export function invalidateSkuCache(skuCode?: string): void {
    if (skuCode) cache.delete(skuCode);
    else cache.clear();
}

export interface ResolvedSkuLine {
    /** Customer-facing price in pence after applying off-peak premium */
    pricePence: number;
    /** Capacity scheduling minutes */
    scheduleMinutes: number;
    /** Off-peak weekend premium that was applied (0 when not Saturday) */
    offPeakPremiumAppliedPence: number;
    /** Which SKU shape we resolved against */
    shape: ServiceCatalogRow['shape'];
    /**
     * Phase 26 / Anomaly #1 — the effective unit count actually used for
     * pricing on a per-unit SKU (input.unitCount clamped up to minimumUnits).
     * `null` for fixed and tiered SKUs. Engine writes this back onto the line
     * output so the customer page can always render "× N unit_label".
     */
    effectiveUnitCount: number | null;
    /** The catalog row, useful for downstream display */
    skuRow: ServiceCatalogRow;
}

export interface ResolveSkuLineInput {
    skuCode: string;
    /** Required for per_unit SKUs */
    unitCount?: number;
    /** Required for tiered SKUs */
    selectedTier?: string;
    /**
     * Booking date for off-peak premium evaluation. Saturday →
     * `off_peak_weekend_premium_pence` is added on top of the SKU price.
     * Pass null when the date isn't known yet (premium is skipped).
     */
    scheduledDate?: Date | string | null;
}

/**
 * Resolve a SKU code into the concrete price + scheduling minutes the
 * engine will use. Returns null when the code is unknown so the caller
 * can fall back to the custom path.
 *
 * Pricing rules (mirror the SKU schema):
 *   fixed    → pricePence, scheduleMinutes (both from row)
 *   per_unit → max(unitCount, minimumUnits) × pricePerUnitPence;
 *              minutesPerUnit × count + setupMinutes
 *   tiered   → tier row's pricePence + scheduleMinutes
 *
 * Off-peak premium: if scheduledDate falls on Saturday and the SKU has a
 * non-zero off_peak_weekend_premium_pence, that amount is added to the
 * resolved price ONCE (not per-unit). Sunday is treated as in-band by
 * default (matches the SKU column name "weekend" but the seed data uses
 * Saturday only — flagged as an open question for 25c/25d if Sundays
 * should also trigger).
 */
export async function resolveLineItemFromSku(
    input: ResolveSkuLineInput,
): Promise<ResolvedSkuLine | null> {
    const row = await getSkuByCode(input.skuCode);
    if (!row) return null;

    let pricePence = 0;
    let scheduleMinutes = 0;
    let effectiveUnitCount: number | null = null;

    if (row.shape === 'fixed') {
        pricePence = row.pricePence ?? 0;
        scheduleMinutes = row.scheduleMinutes ?? 0;
    } else if (row.shape === 'per_unit') {
        const minUnits = row.minimumUnits ?? 1;
        const askedCount = input.unitCount ?? minUnits;
        const count = Math.max(askedCount, minUnits);
        const pricePer = row.pricePerUnitPence ?? 0;
        const minsPer = row.minutesPerUnit ?? 0;
        const setup = row.setupMinutes ?? 0;
        pricePence = pricePer * count;
        scheduleMinutes = minsPer * count + setup;
        effectiveUnitCount = count;
    } else if (row.shape === 'tiered') {
        const tiers = (row.tiers as Array<{ label: string; pricePence: number; scheduleMinutes: number }> | null) || [];
        const wantedTier = input.selectedTier;
        const tier = wantedTier
            ? tiers.find((t) => t.label === wantedTier)
            : tiers[0];
        if (!tier) {
            console.error(
                `[sku-resolver] tiered SKU ${row.skuCode} requested tier "${wantedTier}" not found; available: ${tiers.map((t) => t.label).join(', ')}`,
            );
            return null;
        }
        pricePence = tier.pricePence ?? 0;
        scheduleMinutes = tier.scheduleMinutes ?? 0;
    } else {
        console.error(`[sku-resolver] unknown SKU shape "${row.shape}" for ${row.skuCode}`);
        return null;
    }

    // Off-peak weekend premium — Saturday only for now.
    let offPeakPremiumAppliedPence = 0;
    if (row.offPeakWeekendPremiumPence && input.scheduledDate) {
        const date = typeof input.scheduledDate === 'string'
            ? new Date(input.scheduledDate)
            : input.scheduledDate;
        if (date instanceof Date && !isNaN(date.getTime()) && date.getDay() === 6) {
            offPeakPremiumAppliedPence = row.offPeakWeekendPremiumPence;
            pricePence += offPeakPremiumAppliedPence;
        }
    }

    return {
        pricePence,
        scheduleMinutes,
        offPeakPremiumAppliedPence,
        shape: row.shape,
        effectiveUnitCount,
        skuRow: row,
    };
}
