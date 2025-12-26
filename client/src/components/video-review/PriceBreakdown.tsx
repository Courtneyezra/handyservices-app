import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Info, ShieldCheck } from 'lucide-react';

interface PriceBreakdownProps {
    breakdown?: {
        labour: { hours: number; ratePerHour: number; total: number };
        materials: number;
        callout: number;
        vat: number;
        total: number;
    };
    quoteRange: { low: number; high: number };
    confidence?: { percent: number; level: 'high' | 'medium' | 'low' };
}

export function PriceBreakdown({ breakdown, quoteRange, confidence }: PriceBreakdownProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // If no breakdown data (legacy or fallback), just show range
    if (!breakdown) return null;

    const confidenceLevel = confidence?.level || 'medium';
    const confidenceColor =
        confidenceLevel === 'high' ? 'text-emerald-400' :
            confidenceLevel === 'medium' ? 'text-yellow-400' : 'text-orange-400';

    const rangeWidth = quoteRange.high - quoteRange.low;
    // Position of estimated total within the range (approximate center for visual)
    const estimatedPos = rangeWidth > 0 ? ((breakdown.total - quoteRange.low) / rangeWidth) * 100 : 50;

    return (
        <div className="w-full max-w-sm mx-auto mt-6">

            {/* Visual Range Indicator */}
            <div className="mb-6 px-2">
                <div className="flex justify-between text-xs text-slate-400 mb-2 font-medium">
                    <span>£{quoteRange.low}</span>
                    <span className="text-emerald-400 font-bold">£{breakdown.total} est</span>
                    <span>£{quoteRange.high}</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full relative overflow-hidden">
                    {/* Background Range */}
                    <div className="absolute top-0 bottom-0 left-0 right-0 bg-slate-800 rounded-full" />

                    {/* Likely Range Highlight (middle 50%) */}
                    <div className="absolute top-0 bottom-0 left-[25%] right-[25%] bg-emerald-900/40" />

                    {/* Indicator Dot */}
                    <motion.div
                        initial={{ left: '0%' }}
                        animate={{ left: `${Math.min(Math.max(estimatedPos, 0), 100)}%` }}
                        transition={{ duration: 1, delay: 0.5, type: 'spring' }}
                        className="absolute top-0 bottom-0 w-1.5 h-full bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                    />
                </div>

                {confidence && (
                    <div className="flex items-center justify-center gap-1.5 mt-3 text-xs bg-slate-800/50 py-1.5 px-3 rounded-full border border-slate-700/50 w-fit mx-auto">
                        <ShieldCheck className={`w-3.5 h-3.5 ${confidenceColor}`} />
                        <span className="text-slate-300">
                            Match Confidence: <span className={`font-bold ${confidenceColor}`}>{confidence.percent}%</span>
                        </span>
                    </div>
                )}
            </div>

            {/* Expandable Breakdown */}
            <div className="border border-slate-700/50 rounded-xl overflow-hidden bg-slate-800/30">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-between p-4 text-sm font-medium text-slate-300 hover:bg-slate-800/50 transition-colors"
                >
                    <span className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-emerald-500/80" />
                        See price breakdown
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="bg-slate-900/50 border-t border-slate-800/50"
                        >
                            <div className="p-4 space-y-3 text-sm">
                                <div className="flex justify-between items-center text-slate-300">
                                    <div className="flex flex-col">
                                        <span>Labour</span>
                                        <span className="text-[10px] text-slate-500">
                                            {breakdown.labour.hours} hrs @ £{breakdown.labour.ratePerHour}/hr
                                        </span>
                                    </div>
                                    <span className="font-medium">£{breakdown.labour.total}</span>
                                </div>

                                <div className="flex justify-between items-center text-slate-300">
                                    <span>Materials (Est.)</span>
                                    <span className="font-medium">£{breakdown.materials}</span>
                                </div>

                                <div className="flex justify-between items-center text-slate-300">
                                    <span>Call-out Fee</span>
                                    <span className="font-medium">£{breakdown.callout}</span>
                                </div>

                                <div className="h-px bg-slate-700/50 my-2" />

                                <div className="flex justify-between items-center text-slate-400 text-xs">
                                    <span>VAT (20%)</span>
                                    <span>£{breakdown.vat}</span>
                                </div>

                                <div className="flex justify-between items-center text-white font-bold pt-1">
                                    <span>Estimated Total</span>
                                    <span className="text-emerald-400">£{breakdown.total}</span>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
