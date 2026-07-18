// ── Line-item split scope ────────────────────────────────────────────────────
// Single source of truth for the "choose what to do now" feature: a customer can
// cross line items off a multi-item quote to "save for another visit". The kept
// (active) scope is re-priced and a reduced deposit is charged; the deferred items
// are recorded for a follow-up visit.
//
// Both the client (UnifiedQuoteCard display + charge) and the server
// (create-payment-intent, webhook) MUST derive the reduced figures here so they
// always agree. The client only ever names which lineIds are deferred — never an
// amount; the server re-derives the £ from the trusted quote row.
//
// Pricing model (mirrors the full-quote model):
//   • Each line's gross = guardedPrice + materials + structuralShare.
//   • The quote's authoritative NET total (basePrice + booking levers) is already
//     net of the multi-job "batch" saving. The effective batch rate is recovered
//     as (gross − net) / gross and re-applied to the ACTIVE subtotal, so the kept
//     scope keeps a proportional share of the bundling discount.
//   • Bundling needs ≥2 jobs: with a single active line the saving is zeroed
//     (one job is not a batch).
//   • Deposit = 100% of active materials + depositFraction of active labour,
//     rounded to whole pounds — identical to the full-scope deposit rule.

export interface SplitLineItem {
  lineId: string;
  guardedPricePence: number;
  materialsWithMarginPence?: number | null;
  structuralSharePence?: number | null;
}

export interface SplitScope {
  /** gross sum of every line (pre batch saving) */
  grossPence: number;
  /** gross sum of the kept lines */
  activeSubtotalPence: number;
  /** batch saving apportioned to the kept scope (0 when <2 kept) */
  activeSavingPence: number;
  /** net price of the kept scope — what "this visit" costs */
  activeJobPricePence: number;
  /** materials within the kept scope */
  activeMaterialsPence: number;
  /** reduced deposit for the kept scope */
  activeDepositPence: number;
  /** balance due on completion of the kept scope */
  activeBalancePence: number;
  activeCount: number;
  deferredCount: number;
  /** the lineIds actually deferred, filtered to ones that exist */
  deferredLineIds: string[];
}

const rawPence = (l: SplitLineItem): number =>
  (l.guardedPricePence || 0) + (l.materialsWithMarginPence || 0) + (l.structuralSharePence || 0);

/**
 * Re-price a multi-item quote for a partial ("split") booking.
 *
 * @param lineItems       every priced line on the quote
 * @param fullNetPence    the quote's UN-LANED net base (basePrice) — what the
 *                        multi-job saving reconciles against. Do NOT pass a
 *                        lane-adjusted / lever-adjusted total here: a set-date
 *                        premium would push the net above the line gross, clamp
 *                        the recovered rate to 0, and silently drop BOTH the
 *                        premium and the saving from the kept scope.
 * @param leverDeltaPence booking levers on top of the base (set-date premium,
 *                        Saturday, add-ons…). Applied to the kept scope AFTER
 *                        the batch saving — a premium is per-visit, so the kept
 *                        visit carries it in full.
 * @param deferredLineIds lineIds the customer crossed off
 * @param depositFraction labour deposit fraction (e.g. 0.30)
 *
 * Deferring is a no-op if it would empty the scope (you cannot defer the last
 * line) or if none of the ids match — callers get the full scope back unchanged.
 */
export function computeSplitScope(params: {
  lineItems: SplitLineItem[];
  fullNetPence: number;
  leverDeltaPence?: number;
  deferredLineIds: string[];
  depositFraction: number;
}): SplitScope {
  const { lineItems, fullNetPence, depositFraction } = params;
  const leverDeltaPence = params.leverDeltaPence ?? 0;
  const requested = new Set(params.deferredLineIds || []);

  const grossPence = lineItems.reduce((s, l) => s + rawPence(l), 0);

  // Only defer lines that exist, and never defer the last remaining line.
  const deferrable = lineItems.filter((l) => requested.has(l.lineId));
  const wouldEmpty = deferrable.length >= lineItems.length;
  const deferred = wouldEmpty ? [] : deferrable;
  const deferredIds = new Set(deferred.map((l) => l.lineId));
  const active = lineItems.filter((l) => !deferredIds.has(l.lineId));

  const activeSubtotalPence = active.reduce((s, l) => s + rawPence(l), 0);

  // Recover the batch rate the full quote implies, then re-apply to the kept
  // scope. Booking levers (set-date premium, add-ons…) ride on top afterwards —
  // they are per-visit, not per-line, so the kept visit carries them in full.
  const rate = grossPence > 0 ? Math.max(0, (grossPence - fullNetPence) / grossPence) : 0;
  const activeSavingPence =
    active.length >= 2 ? Math.round((activeSubtotalPence * rate) / 100) * 100 : 0;
  const activeJobPricePence = Math.max(0, activeSubtotalPence - activeSavingPence + leverDeltaPence);

  const activeMaterialsPence = active.reduce((s, l) => s + (l.materialsWithMarginPence || 0), 0);
  const labourPence = activeJobPricePence - activeMaterialsPence;
  const activeDepositPence =
    activeMaterialsPence > 0
      ? Math.round((activeMaterialsPence + Math.round(labourPence * depositFraction)) / 100) * 100
      : Math.round(Math.round(activeJobPricePence * depositFraction) / 100) * 100;
  const activeBalancePence = Math.max(0, activeJobPricePence - activeDepositPence);

  return {
    grossPence,
    activeSubtotalPence,
    activeSavingPence,
    activeJobPricePence,
    activeMaterialsPence,
    activeDepositPence,
    activeBalancePence,
    activeCount: active.length,
    deferredCount: deferred.length,
    deferredLineIds: deferred.map((l) => l.lineId),
  };
}
