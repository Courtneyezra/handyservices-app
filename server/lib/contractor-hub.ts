/**
 * Contractor Hub — pure shaping (DB-free, unit-tested).
 *
 * Groups contractors into delivery bands (partner / core / adhoc), Craig-first
 * within a band, and attaches a fill %. The DB glue that feeds it lives in
 * server/contractor-hub-routes.ts. See docs/contractor-platform/00-PRD.md §5a.
 */
import type { DeliveryTier } from './quote-team';

export interface HubContractorInput {
  id: string;
  name: string;
  tier: DeliveryTier;
  priority: number | null;
  imageUrl: string | null;
  skills: string[];
  bookedDaysThisWeek: number;
  committedDaysPerWeek: number | null;
  pipelineCount: number;
}

export interface HubContractor extends HubContractorInput {
  /** Booked days / committed (or 5-day) target, clamped to 100. */
  fillPercent: number;
}

export interface HubBand {
  tier: DeliveryTier;
  label: string;
  contractors: HubContractor[];
}

export interface CapacityGap {
  quoteId: string;
  slug: string | null;
  postcode: string | null;
  uncoveredCategories: string[];
}

export interface ContractorHub {
  bands: HubBand[];
  capacityGaps: CapacityGap[];
}

const TIER_ORDER: DeliveryTier[] = ['partner', 'core', 'adhoc'];
const TIER_LABEL: Record<DeliveryTier, string> = { partner: 'Partner', core: 'Core', adhoc: 'Ad-hoc' };
const DEFAULT_TARGET_DAYS = 5;

export function fillPercent(bookedDays: number, committed: number | null): number {
  const target = committed && committed > 0 ? committed : DEFAULT_TARGET_DAYS;
  return Math.min(100, Math.round((bookedDays / target) * 100));
}

/** Pure: group contractors into bands (fixed tier order, Craig-first within), attach fill %. */
export function assembleHub(contractors: HubContractorInput[], capacityGaps: CapacityGap[]): ContractorHub {
  const bands: HubBand[] = TIER_ORDER.map((tier) => {
    const inBand = contractors
      .filter((c) => c.tier === tier)
      .map((c) => ({ ...c, fillPercent: fillPercent(c.bookedDaysThisWeek, c.committedDaysPerWeek) }))
      .sort((a, b) => {
        const ap = a.priority ?? Number.POSITIVE_INFINITY;
        const bp = b.priority ?? Number.POSITIVE_INFINITY;
        if (ap !== bp) return ap - bp;
        return a.name.localeCompare(b.name);
      });
    return { tier, label: TIER_LABEL[tier], contractors: inBand };
  });
  return { bands, capacityGaps };
}
