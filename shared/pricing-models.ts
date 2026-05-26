/**
 * Pricing-model classification per job category.
 *
 * Not every job category is naturally priced by "time × hourly_rate". Forcing
 * them all through that lens is what caused the time-inflation problem (see
 * shared/scheduling-caps.ts and task #42). This module is the source of truth
 * for which categories use which pricing model.
 *
 *   time:     price = time × rate + premiums  (regular trades — painting, plumbing, etc.)
 *   fixed:    price = fixed fee per unit/load  (waste removal, gutter clear, lock change)
 *   per_unit: price = unit count × unit rate   (TV mounts, flat-pack items, blinds)
 *
 * The LLM pricing engine uses this to decide WHICH math to apply per line.
 * The builder UI uses this to render the right inputs per category.
 */

import type { JobCategory } from './contextual-pricing-types';

export type PricingModel = 'time' | 'fixed' | 'per_unit';

/** What "1 unit" means semantically per category — used by builder UI labels. */
export interface PricingModelConfig {
    model: PricingModel;
    /** Singular unit name for the builder UI when model='per_unit' or 'fixed'. */
    unitLabel?: string;
    /** Default reference price in pence for 1 unit / 1 load. */
    referenceUnitPricePence?: number;
    /** Realistic scheduling minutes contributed per unit. */
    minutesPerUnit?: number;
    /** For 'fixed' size-tier categories (eg waste van loads): the available tiers. */
    fixedTiers?: Array<{ id: string; label: string; pricePence: number; scheduleMinutes: number }>;
}

export const PRICING_MODELS: Record<JobCategory, PricingModelConfig> = {
    // ── Time-based: regular skilled trades, billed by labour hours ──
    general_fixing:    { model: 'time' },
    carpentry:         { model: 'time' },
    plumbing_minor:    { model: 'time' },
    electrical_minor:  { model: 'time' },
    painting:          { model: 'time' },
    tiling:            { model: 'time' },
    plastering:        { model: 'time' },
    fencing:           { model: 'time' },
    garden_maintenance:{ model: 'time' },
    bathroom_fitting:  { model: 'time' },
    kitchen_fitting:   { model: 'time' },
    flooring:          { model: 'time' },
    other:             { model: 'time' },

    // ── Per-unit: scales linearly with item count ──
    tv_mounting:       { model: 'per_unit', unitLabel: 'TV',          referenceUnitPricePence: 7500,  minutesPerUnit: 45 },
    flat_pack:         { model: 'per_unit', unitLabel: 'item',        referenceUnitPricePence: 6000,  minutesPerUnit: 60 },
    shelving:          { model: 'per_unit', unitLabel: 'shelf',       referenceUnitPricePence: 3500,  minutesPerUnit: 20 },
    curtain_blinds:    { model: 'per_unit', unitLabel: 'window',      referenceUnitPricePence: 4500,  minutesPerUnit: 30 },
    silicone_sealant:  { model: 'per_unit', unitLabel: 'bath/shower', referenceUnitPricePence: 6000,  minutesPerUnit: 45 },
    door_fitting:      { model: 'per_unit', unitLabel: 'door',        referenceUnitPricePence: 9000,  minutesPerUnit: 75 },
    furniture_repair:  { model: 'per_unit', unitLabel: 'item',        referenceUnitPricePence: 5500,  minutesPerUnit: 60 },

    // ── Fixed-fee: priced by visit, load, or scope (NOT labour time) ──
    lock_change:       { model: 'fixed',    unitLabel: 'lock',        referenceUnitPricePence: 12000, minutesPerUnit: 45 },
    guttering:         { model: 'fixed',    unitLabel: 'property',    referenceUnitPricePence: 15000, minutesPerUnit: 90 },
    pressure_washing:  { model: 'fixed',    unitLabel: 'area',        referenceUnitPricePence: 18000, minutesPerUnit: 120 },
    waste_removal:     {
        model: 'fixed',
        unitLabel: 'van load',
        fixedTiers: [
            { id: 'small',  label: 'Small van load',  pricePence: 8000,  scheduleMinutes: 60 },
            { id: 'medium', label: 'Medium van load', pricePence: 16000, scheduleMinutes: 75 },
            { id: 'full',   label: 'Full van load',   pricePence: 28000, scheduleMinutes: 90 },
        ],
    },
};

/** Convenience accessor — returns the model for a category, defaulting to 'time' if unknown. */
export function getPricingModel(category: string | null | undefined): PricingModel {
    const cfg = PRICING_MODELS[category as JobCategory];
    return cfg?.model ?? 'time';
}

/** Get the full config for a category, with safe defaults. */
export function getPricingConfig(category: string | null | undefined): PricingModelConfig {
    return PRICING_MODELS[category as JobCategory] ?? { model: 'time' };
}

/** Categories grouped by pricing model — handy for builder UI sections. */
export function getCategoriesByModel(model: PricingModel): JobCategory[] {
    return Object.entries(PRICING_MODELS)
        .filter(([, cfg]) => cfg.model === model)
        .map(([cat]) => cat as JobCategory);
}
