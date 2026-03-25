/**
 * Unified Category Architecture — Single Source of Truth
 *
 * Two-tier system: Broad Trades → Granular Categories
 * Used by both contractor onboarding and quote generation.
 *
 * Categories map 1:1 with JobCategoryValues from contextual-pricing-types.ts.
 * Rate ranges are duplicated from server/contextual-pricing/reference-rates.ts
 * so this file is importable by both server and client code.
 *
 * All monetary values in PENCE.
 */

import { JobCategoryValues } from './contextual-pricing-types';
import type { JobCategory } from './contextual-pricing-types';

// Re-export for consumers
export type { JobCategory };

// ---------------------------------------------------------------------------
// Broad Trades
// ---------------------------------------------------------------------------

export const BROAD_TRADES = [
  { id: 'handyman', label: 'Handyman', icon: '🔧' },
  { id: 'plumbing', label: 'Plumbing', icon: '💧' },
  { id: 'electrical', label: 'Electrical', icon: '⚡' },
  { id: 'carpentry_joinery', label: 'Carpentry & Joinery', icon: '🪚' },
  { id: 'painting_decorating', label: 'Painting & Decorating', icon: '🎨' },
  { id: 'tiling', label: 'Tiling', icon: '🔲' },
  { id: 'plastering', label: 'Plastering', icon: '🧱' },
  { id: 'outdoors', label: 'Outdoors & Garden', icon: '🌿' },
] as const;

export type BroadTradeId = typeof BROAD_TRADES[number]['id'];
export type BroadTrade = typeof BROAD_TRADES[number];

// ---------------------------------------------------------------------------
// Trade → Category Mapping
// ---------------------------------------------------------------------------

export const TRADE_CATEGORIES: Record<BroadTradeId, JobCategory[]> = {
  handyman: [
    'general_fixing', 'flat_pack', 'tv_mounting', 'lock_change',
    'shelving', 'curtain_blinds', 'silicone_sealant', 'furniture_repair',
    'waste_removal',
  ],
  plumbing: ['plumbing_minor', 'bathroom_fitting'],
  electrical: ['electrical_minor'],
  carpentry_joinery: ['carpentry', 'door_fitting', 'flooring', 'kitchen_fitting'],
  painting_decorating: ['painting'],
  tiling: ['tiling'],
  plastering: ['plastering'],
  outdoors: ['guttering', 'pressure_washing', 'fencing', 'garden_maintenance'],
};

// ---------------------------------------------------------------------------
// Category Labels
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  general_fixing: 'General Fixing',
  flat_pack: 'Flat Pack Assembly',
  tv_mounting: 'TV Mounting',
  carpentry: 'Carpentry',
  plumbing_minor: 'Plumbing (Minor)',
  electrical_minor: 'Electrical (Minor)',
  painting: 'Painting & Decorating',
  tiling: 'Tiling',
  plastering: 'Plastering',
  lock_change: 'Lock Change',
  guttering: 'Guttering',
  pressure_washing: 'Pressure Washing',
  fencing: 'Fencing',
  garden_maintenance: 'Garden Maintenance',
  bathroom_fitting: 'Bathroom Fitting',
  kitchen_fitting: 'Kitchen Fitting',
  door_fitting: 'Door Fitting',
  flooring: 'Flooring',
  curtain_blinds: 'Curtain & Blind Fitting',
  silicone_sealant: 'Silicone & Sealant',
  shelving: 'Shelving',
  furniture_repair: 'Furniture Repair',
  waste_removal: 'Waste Removal',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Category Rate Ranges (pence) — duplicated from reference-rates.ts for
// client-side access. hourly = sweet spot (most tradies charge this).
// ---------------------------------------------------------------------------

export interface CategoryRateRange {
  /** Sweet spot hourly rate in pence (what most tradies charge) */
  hourly: number;
  /** Low end of market range in pence */
  low: number;
  /** High end of market range in pence */
  high: number;
}

export const CATEGORY_RATE_RANGES: Record<JobCategory, CategoryRateRange> = {
  general_fixing:    { hourly: 3000, low: 2500, high: 4000 },
  flat_pack:         { hourly: 2800, low: 2000, high: 3500 },
  tv_mounting:       { hourly: 3500, low: 3000, high: 5000 },
  carpentry:         { hourly: 4000, low: 3500, high: 5000 },
  plumbing_minor:    { hourly: 4500, low: 4000, high: 6500 },
  electrical_minor:  { hourly: 5000, low: 4500, high: 7000 },
  painting:          { hourly: 3000, low: 2500, high: 4000 },
  tiling:            { hourly: 4000, low: 3500, high: 5500 },
  plastering:        { hourly: 4000, low: 3500, high: 5500 },
  lock_change:       { hourly: 5000, low: 4500, high: 8000 },
  guttering:         { hourly: 3500, low: 3000, high: 5000 },
  pressure_washing:  { hourly: 3000, low: 2500, high: 4500 },
  fencing:           { hourly: 3500, low: 3000, high: 5000 },
  garden_maintenance:{ hourly: 2500, low: 2000, high: 3500 },
  bathroom_fitting:  { hourly: 5000, low: 4000, high: 6500 },
  kitchen_fitting:   { hourly: 5000, low: 4000, high: 6500 },
  door_fitting:      { hourly: 3500, low: 3000, high: 5000 },
  flooring:          { hourly: 3000, low: 2500, high: 4000 },
  curtain_blinds:    { hourly: 3000, low: 2500, high: 4000 },
  silicone_sealant:  { hourly: 2500, low: 2000, high: 3500 },
  shelving:          { hourly: 3000, low: 2500, high: 4000 },
  furniture_repair:  { hourly: 3000, low: 2500, high: 4000 },
  waste_removal:     { hourly: 2500, low: 2000, high: 3500 },
  other:             { hourly: 3500, low: 3000, high: 4500 },
};

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/** Get all granular categories for a broad trade */
export function getCategoriesForTrade(tradeId: BroadTradeId): JobCategory[] {
  return TRADE_CATEGORIES[tradeId] || [];
}

/** Get the broad trade that owns a granular category */
export function getTradeForCategory(category: JobCategory): BroadTradeId | null {
  for (const [tradeId, categories] of Object.entries(TRADE_CATEGORIES)) {
    if (categories.includes(category)) {
      return tradeId as BroadTradeId;
    }
  }
  return null;
}

/** Get the human label for a category */
export function getCategoryLabel(category: JobCategory): string {
  return CATEGORY_LABELS[category] || category;
}

/** Get the human label for a broad trade */
export function getTradeLabel(tradeId: BroadTradeId): string {
  const trade = BROAD_TRADES.find(t => t.id === tradeId);
  return trade?.label || tradeId;
}

/** Get the icon for a broad trade */
export function getTradeIcon(tradeId: BroadTradeId): string {
  const trade = BROAD_TRADES.find(t => t.id === tradeId);
  return trade?.icon || '🔧';
}

/** Get the rate range for a category */
export function getCategoryRateRange(category: JobCategory): CategoryRateRange {
  return CATEGORY_RATE_RANGES[category] || CATEGORY_RATE_RANGES.other;
}

/** Get all trades with their categories, labels, and rate ranges — full structure */
export function getAllTradesWithCategories() {
  return BROAD_TRADES.map(trade => ({
    trade,
    categories: getCategoriesForTrade(trade.id).map(slug => ({
      slug,
      label: getCategoryLabel(slug),
      rateRange: getCategoryRateRange(slug),
    })),
  }));
}

/** Check if all JobCategoryValues are covered by TRADE_CATEGORIES */
export function validateCategoryMapping(): { covered: JobCategory[]; uncovered: JobCategory[] } {
  const allMapped = Object.values(TRADE_CATEGORIES).flat();
  const covered = JobCategoryValues.filter(c => allMapped.includes(c));
  const uncovered = JobCategoryValues.filter(c => !allMapped.includes(c) && c !== 'other');
  return { covered, uncovered };
}
