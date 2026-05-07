/**
 * FlexTierSelector — Module 01 (Booking & Dispatch v2)
 *
 * Customer-facing three-tier flex picker rendered above the date picker on
 * the personalized quote page. Captures date-flexibility intent at quote
 * time and applies a transparent EVE discount (-0% / -10% / -15%).
 *
 * Defaults to "flexible" (per ADR-004 §Decision). Emits `onChange(tier)`
 * to parent, which is responsible for persisting via PUT /api/quotes/:id/flex-tier
 * and re-rendering the date picker with the matching window constraint.
 *
 * Brand tokens (Module 13): Navy #1B2A4A, Yellow #F5A623, light bg #F7F8FC,
 * highlight bg #FFF8EC, Poppins.
 *
 * Spec: docs/architecture/modules/01-flex-tier-booking.md §5
 */

import { Calendar, Leaf, Zap } from 'lucide-react';

export type FlexTier = 'fast' | 'flexible' | 'relaxed';

export const FLEX_WINDOW_DAYS: Record<FlexTier, number> = {
    fast: 1,
    flexible: 7,
    relaxed: 14,
};

const FLEX_DISCOUNT_PCT: Record<FlexTier, number> = {
    fast: 0,
    flexible: 10,
    relaxed: 15,
};

interface TierMeta {
    id: FlexTier;
    icon: typeof Zap;
    label: string;
    sub: string;
    discountPct: number;
    popular: boolean;
}

const TIERS: TierMeta[] = [
    { id: 'fast', icon: Zap, label: 'Fast', sub: 'Pick the exact date', discountPct: 0, popular: false },
    { id: 'flexible', icon: Calendar, label: 'Flexible', sub: 'Up to 3 dates within 7 days', discountPct: 10, popular: true },
    { id: 'relaxed', icon: Leaf, label: 'Relaxed', sub: 'Any 14-day window — we pick', discountPct: 15, popular: false },
];

export interface FlexTierSelectorProps {
    /** Base value in pence used to compute per-tier prices. */
    baseValuePence: number;
    /** Currently selected tier. */
    selected: FlexTier;
    /** Called when user picks a different tier. */
    onChange: (tier: FlexTier) => void;
    /** Optional override for disabled state during request in flight. */
    disabled?: boolean;
}

function formatGbp(pence: number): string {
    return `£${(pence / 100).toFixed(0)}`;
}

function pencePerTier(basePence: number, tier: FlexTier): number {
    const pct = FLEX_DISCOUNT_PCT[tier] / 100;
    // Match server math: Math.round(base * (1 - pct))
    return Math.round(basePence * (1 - pct));
}

export function FlexTierSelector({
    baseValuePence,
    selected,
    onChange,
    disabled = false,
}: FlexTierSelectorProps) {
    return (
        <div className="w-full" data-testid="flex-tier-selector">
            <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#1B2A4A]">
                    How flexible is your timing?
                </h3>
                <span className="text-xs text-slate-500">Choose to save</span>
            </div>

            <div
                role="radiogroup"
                aria-label="Date flexibility tier"
                className="grid grid-cols-1 gap-2 md:grid-cols-4 md:gap-3"
            >
                {TIERS.map((tier) => {
                    const isSelected = selected === tier.id;
                    const Icon = tier.icon;
                    const tierPrice = pencePerTier(baseValuePence, tier.id);
                    // Flexible takes 2 columns on desktop, others 1
                    const colSpan = tier.popular ? 'md:col-span-2' : 'md:col-span-1';

                    const baseClasses = 'relative flex w-full flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] focus-visible:ring-offset-2';
                    const stateClasses = isSelected
                        ? tier.popular
                            ? 'border-[#F5A623] bg-[#FFF8EC] shadow-md'
                            : 'border-[#1B2A4A] bg-[#F7F8FC] shadow-md'
                        : 'border-slate-200 bg-white hover:border-slate-300';
                    const popularEmphasis = tier.popular && !isSelected ? 'border-[#F5A623]/60' : '';
                    const disabledClasses = disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer';

                    return (
                        <button
                            key={tier.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            aria-label={`${tier.label}: ${tier.sub}. ${tier.discountPct === 0 ? 'No discount' : `${tier.discountPct}% off`}.`}
                            disabled={disabled}
                            onClick={() => !disabled && onChange(tier.id)}
                            data-testid={`flex-tier-option-${tier.id}`}
                            className={`${baseClasses} ${stateClasses} ${popularEmphasis} ${disabledClasses} ${colSpan}`}
                        >
                            {tier.popular && (
                                <span className="absolute -top-2 right-3 rounded-full bg-[#F5A623] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                                    Most popular
                                </span>
                            )}

                            <div className="flex items-center gap-2">
                                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${isSelected ? 'bg-[#1B2A4A] text-white' : 'bg-slate-100 text-[#1B2A4A]'}`}>
                                    <Icon className="h-4 w-4" />
                                </span>
                                <span className="text-base font-bold text-[#1B2A4A]">{tier.label}</span>
                                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${tier.discountPct === 0 ? 'bg-slate-100 text-slate-600' : 'bg-[#F5A623]/15 text-[#1B2A4A]'}`}>
                                    {tier.discountPct === 0 ? '+0%' : `−${tier.discountPct}%`}
                                </span>
                            </div>

                            <p className="text-xs leading-snug text-slate-600">{tier.sub}</p>

                            <div className="mt-1 flex items-baseline gap-1">
                                <span className="text-lg font-bold text-[#1B2A4A]">{formatGbp(tierPrice)}</span>
                                {tier.discountPct > 0 && (
                                    <span className="text-xs text-slate-400 line-through">{formatGbp(baseValuePence)}</span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            <p className="mt-3 text-xs text-slate-500">
                {selected === 'fast' && 'You pick one specific date — full price.'}
                {selected === 'flexible' && 'Pick up to 3 acceptable dates within a 7-day window.'}
                {selected === 'relaxed' && 'Pick any 14-day window — we schedule it.'}
            </p>
        </div>
    );
}

export default FlexTierSelector;
