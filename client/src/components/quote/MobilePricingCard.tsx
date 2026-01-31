import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Star, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface MobilePricingCardProps {
    tier: 'essential' | 'enhanced' | 'elite';
    name: string;
    price: number;
    tagline: string;
    features: string[];
    isRecommended?: boolean;
    isPremium?: boolean;
    isExpanded: boolean;
    isSelected: boolean;
    onToggleExpand: () => void;
    onSelect: () => void;
    paymentMode?: 'full' | 'installments';
    installmentPrice?: number;
}

/**
 * Mobile-optimized pricing card with accordion behavior.
 * Collapsed state shows essential info in ~100px.
 * Expanded state reveals full features.
 * Always shows CTA button for immediate action.
 */
export function MobilePricingCard({
    tier,
    name,
    price,
    tagline,
    features,
    isRecommended = false,
    isPremium = false,
    isExpanded,
    isSelected,
    onToggleExpand,
    onSelect,
    paymentMode = 'full',
    installmentPrice
}: MobilePricingCardProps) {

    // Tier-specific styling
    const tierStyles = {
        essential: {
            gradient: 'from-slate-50 via-white to-green-50/30',
            border: 'border-slate-200',
            accentColor: 'text-slate-600',
            ring: ''
        },
        enhanced: {
            gradient: 'from-green-100 via-emerald-50 to-white',
            border: 'border-[#7DB00E]',
            accentColor: 'text-[#7DB00E]',
            ring: isExpanded ? 'ring-4 ring-[#7DB00E]/20' : ''
        },
        elite: {
            gradient: 'from-amber-50 via-white to-yellow-50/40',
            border: 'border-slate-200',
            accentColor: 'text-amber-600',
            ring: ''
        }
    };

    const style = tierStyles[tier];
    const displayPrice = paymentMode === 'installments' && installmentPrice ? installmentPrice : price;
    const priceLabel = paymentMode === 'installments' ? '/month' : '';

    return (
        <motion.div
            id={`mobile-card-${tier}`}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`
        relative bg-gradient-to-br ${style.gradient} 
        rounded-2xl border-2 ${style.border} ${style.ring}
        overflow-hidden transition-all duration-300
        ${isSelected ? 'ring-4 ring-green-500/30' : ''}
        ${isExpanded ? 'shadow-2xl' : 'shadow-md'}
      `}
        >
            {/* Badge */}
            {(isRecommended || isPremium) && (
                <div className={`
          ${isRecommended ? 'bg-[#7DB00E]' : 'bg-[#1D2D3D]'}
          text-white text-center py-1.5 text-[10px] font-black tracking-wider uppercase
          flex justify-center items-center gap-2
        `}>
                    {isRecommended && <Star className="w-3 h-3 fill-current" />}
                    {isPremium && <Crown className="w-3 h-3 fill-current" />}
                    {isRecommended ? 'MOST POPULAR' : 'PREMIUM'}
                </div>
            )}

            {/* Collapsed Header - Always Visible */}
            <button
                onClick={onToggleExpand}
                className="w-full text-left p-4 focus:outline-none focus:ring-2 focus:ring-[#7DB00E]/50 rounded-t-2xl"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${name} package details`}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        {/* Package Name */}
                        <h3 className="text-lg font-bold text-slate-900 mb-1">
                            {name}
                        </h3>

                        {/* Price */}
                        <div className="flex items-baseline gap-1 mb-1">
                            <span className="text-2xl font-black text-slate-900">
                                £{Math.round(displayPrice / 100)}
                            </span>
                            {priceLabel && (
                                <span className="text-sm text-slate-600">{priceLabel}</span>
                            )}
                        </div>

                        {/* Tagline */}
                        <p className="text-xs text-slate-600">{tagline}</p>
                    </div>

                    {/* Expand/Collapse Indicator */}
                    <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className={`${style.accentColor} flex-shrink-0`}
                    >
                        <ChevronDown className="w-5 h-5" />
                    </motion.div>
                </div>
            </button>

            {/* Expanded Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-4 space-y-3">
                            {/* Features List */}
                            <div className="space-y-2">
                                {features.map((feature, idx) => (
                                    <div key={idx} className="flex items-start gap-2">
                                        <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                        <span className="text-sm text-slate-700">{feature}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Payment Info */}
                            {paymentMode === 'installments' && installmentPrice && (
                                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">
                                    <div className="flex justify-between">
                                        <span>3 monthly payments</span>
                                        <span className="font-semibold">£{Math.round(installmentPrice / 100)}/mo</span>
                                    </div>
                                    <div className="flex justify-between mt-1">
                                        <span>Total</span>
                                        <span className="font-semibold">£{Math.round(price / 100)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* CTA Button - Always Visible */}
            <div className="p-4 pt-0">
                <Button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                    }}
                    className={`
            w-full font-bold text-sm py-3 rounded-xl transition-all duration-200
            ${isSelected
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : `${style.accentColor} bg-white hover:bg-slate-50 border-2 ${style.border}`
                        }
          `}
                >
                    {isSelected ? (
                        <span className="flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            Selected
                        </span>
                    ) : (
                        'Select Package'
                    )}
                </Button>
            </div>

            {/* Selected Indicator */}
            {isSelected && (
                <div className="absolute top-2 right-2 bg-green-600 text-white rounded-full p-1">
                    <Check className="w-3 h-3" />
                </div>
            )}
        </motion.div>
    );
}
