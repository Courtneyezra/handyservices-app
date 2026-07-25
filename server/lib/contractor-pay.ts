/**
 * Contractor pay — the ONE canonical payout function (Model C revenue share
 * + delivery-tier uplift). Everything that shows or writes contractor money
 * routes through here so a booking's payout, a dispatch offer, and the app's
 * payslip can never disagree.
 *
 * LABOUR-ONLY: the share is a % of LABOUR (guardedPricePence). Materials
 * (materialsWithMarginPence) pass through — the contractor never earns on
 * them, Handy keeps the markup. (The legacy dispatch adapter added materials
 * into the base; that is the discrepancy this centralisation removes.)
 *
 * Hours for the floor come from the HONEST schedule time (verifiedMinutes /
 * clamped estimate via lineScheduleMinutes), not the raw pricing minutes, so
 * an inflated line can't inflate the floor.
 */
import { calculateMultiLineRevenueShare, deliveryTierUplift } from '../revenue-share-tiers';
import { lineScheduleMinutes } from '../../shared/schedule-composition';
import type { JobCategory } from '../../shared/contextual-pricing-types';

export interface PayLineInput {
  category?: string | null;
  description?: string | null;
  /** Customer-facing LABOUR price for the line, in pence (excl. materials). */
  guardedPricePence?: number | null;
  /** Materials at COST — the contractor's spend/allowance (Handy keeps the
   *  markup, which lives in materialsWithMarginPence). Never part of pay. */
  materialsCostPence?: number | null;
  timeEstimateMinutes?: number | null;
  scheduleMinutes?: number | null;
  verifiedMinutes?: number | null;
}

export interface ContractorPaySnapshot {
  totalPayPence: number;
  totalLabourPence: number;
  /** Σ materials at cost — the allowance, NOT income. */
  totalMaterialsPence: number;
  deliveryTier: string;
  sharePctUplift: number;
  /** Effective share of labour, for display ("55% of labour"). */
  effectiveSharePercent: number;
  lines: Array<{
    category: string;
    description: string | null;
    tier: string;
    labourPence: number;
    payPence: number;
    materialsPence: number;
    method: 'share' | 'floor';
  }>;
  flags: string[];
}

/**
 * Compute a contractor's pay for a set of quote line items at a delivery tier.
 * Pure — callers snapshot the result onto the booking so later dial changes
 * never rewrite already-booked pay.
 */
export function computeContractorPay(
  lines: PayLineInput[],
  deliveryTier: string | null | undefined,
): ContractorPaySnapshot {
  const uplift = deliveryTierUplift(deliveryTier);
  const engineLines = (lines || []).map((l) => ({
    categorySlug: (l.category || 'other') as JobCategory,
    pricePence: Math.max(0, Math.round(l.guardedPricePence || 0)), // LABOUR ONLY
    timeEstimateMinutes: lineScheduleMinutes(l),                    // HONEST hours
  }));

  const r = calculateMultiLineRevenueShare(engineLines, uplift);
  const effectiveSharePercent = r.totalCustomerPrice > 0
    ? Math.round((r.totalContractorPay / r.totalCustomerPrice) * 100)
    : 0;

  const materialsByIdx = (lines || []).map((l) => Math.max(0, Math.round(l.materialsCostPence || 0)));
  const totalMaterialsPence = materialsByIdx.reduce((s, m) => s + m, 0);

  return {
    totalPayPence: r.totalContractorPay,
    totalLabourPence: r.totalCustomerPrice,
    totalMaterialsPence,
    deliveryTier: deliveryTier || 'adhoc',
    sharePctUplift: uplift,
    effectiveSharePercent,
    lines: r.lines.map((ln, i) => ({
      category: ln.categorySlug,
      description: (lines?.[i]?.description) ?? null,
      tier: ln.tier,
      labourPence: ln.customerPricePence,
      payPence: ln.contractorPayPence,
      materialsPence: materialsByIdx[i] ?? 0,
      method: ln.payMethod,
    })),
    flags: r.flags,
  };
}
