// ---------------------------------------------------------------------------
// Quote Materials — structured "shopping list" attached to quote lines
// ---------------------------------------------------------------------------
//
// A quote line already carries a materials COST (`materialsCostPence`). That
// number alone can't tell a contractor WHAT to buy. `QuoteMaterial` is the
// named, structured item — picked from our own `materials_catalog` (seeded
// on-demand from Screwfix and other suppliers via Apify) or entered manually —
// that flows through to the contractor's job sheet on dispatch.
//
// Cost basis convention: `unitPricePence` is the TRADE (ex-VAT) price, because
// the business reclaims VAT, so ex-VAT is the true cost the quote is built on.
// `unitPriceIncVatPence` is what the contractor actually pays on the Handy card
// and is what reconciles against `job_material_expenses` later.

export type MaterialSupplier = 'screwfix' | 'toolstation' | 'manual';

/**
 * A named material line attached to a quote line — what the contractor must buy.
 * Persisted inside the line item (`materials` on JobLine / LineItemV2) so it
 * rides the existing quote → booking → job-sheet → dispatch rails.
 */
export interface QuoteMaterial {
  /** Ref to a `materials_catalog` row when picked from catalog/supplier. Absent for ad-hoc manual lines. */
  catalogId?: string;
  /** Product name shown to the contractor (and used to derive legacy string[] lists). */
  name: string;
  /** How many units are needed for this job line. */
  qty: number;
  /** TRADE (ex-VAT) unit price in pence at time of pick — the quote's cost basis. */
  unitPricePence: number;
  /** CONSUMER (inc-VAT) unit price in pence — what the contractor pays on the card. */
  unitPriceIncVatPence?: number;
  /** Product thumbnail URL (helps the contractor grab the exact item). */
  imageUrl?: string;
  /** Where it comes from. */
  supplier?: MaterialSupplier;
  /** Supplier SKU / item number (e.g. Screwfix "469JE") — enables later price re-sync. */
  supplierItemNumber?: string;
  /** Direct product page link so the contractor buys the exact item. */
  supplierUrl?: string;
}

/**
 * Sum of ex-VAT line costs = the quote line's materials cost basis, in pence.
 * This is the single source of truth: whenever `materials` changes, the caller
 * writes the result back to the line's `materialsCostPence` so pricing, markup
 * and deposit maths stay consistent with the itemised list.
 */
export function materialsCostPence(
  materials: QuoteMaterial[] | undefined | null,
): number {
  if (!materials || materials.length === 0) return 0;
  return materials.reduce((sum, m) => {
    const unit = Math.max(0, Math.round(m?.unitPricePence ?? 0));
    const qty = Math.max(0, Math.floor(m?.qty ?? 0));
    return sum + unit * qty;
  }, 0);
}

/**
 * Flatten structured materials to display names for legacy `string[]` consumers
 * (e.g. `job_sheets.lineItems[].materialsRequired`, dispatch task `materials`).
 * Prefixes quantity when > 1, e.g. "3× No Nonsense 101 Silicone Sealant".
 */
export function materialNames(
  materials: QuoteMaterial[] | undefined | null,
): string[] {
  if (!materials || materials.length === 0) return [];
  return materials.map((m) =>
    m?.qty && m.qty > 1 ? `${m.qty}× ${m.name}` : m?.name ?? '',
  ).filter(Boolean);
}

/** Normalised product returned by a supplier search, before it's a QuoteMaterial. */
export interface MaterialSearchResult {
  /** Present when this product already exists in our catalog. */
  catalogId?: string;
  supplier: MaterialSupplier;
  supplierItemNumber?: string;
  name: string;
  brand?: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  supplierUrl?: string;
  pricePenceExVat?: number;
  pricePenceIncVat?: number;
  currency?: string;
  availability?: string;
  /** true when this row came from our own catalog (free, fast) vs a live supplier scrape. */
  fromCatalog?: boolean;
}
