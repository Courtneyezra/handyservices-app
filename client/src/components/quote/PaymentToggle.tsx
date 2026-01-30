import React from 'react';
import { TryBadge } from './TryBadge';

export type PaymentMode = 'full' | 'installments';

interface PaymentToggleProps {
    paymentMode: PaymentMode;
    setPaymentMode: (mode: PaymentMode) => void;
    theme?: 'light' | 'dark';
    size?: 'default' | 'compact';
    showTryBadge?: boolean;
}

/**
 * Pill-style payment mode toggle with two options: Pay in Full and Pay in 3.
 * Replaces the old toggle switch design for clearer, more intuitive UX.
 * 
 * @param theme - 'light' for white backgrounds, 'dark' for dark backgrounds
 * @param size - 'default' or 'compact' for different use cases
 * @param showTryBadge - Whether to show the "Try" badge on Pay in 3 option
 */
export function PaymentToggle({
    paymentMode,
    setPaymentMode,
    theme = 'light',
    size = 'default',
    showTryBadge = true
}: PaymentToggleProps) {
    const isCompact = size === 'compact';
    const isDark = theme === 'dark';

    // Theme-aware styling
    const containerBg = isDark ? 'bg-[#0f1a27]' : 'bg-slate-100';
    const activeBgFull = isDark ? 'bg-[#2a3f54]' : 'bg-white';
    const activeBgInstallments = 'bg-[#7DB00E]';
    const inactiveText = isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700';

    // Size-aware styling
    const padding = isCompact ? 'p-0.5' : 'p-1';
    const gap = isCompact ? 'gap-0.5' : 'gap-1';
    const buttonPadding = isCompact ? 'px-4 py-1.5' : 'px-6 py-2';
    const fontSize = isCompact ? 'text-[10px]' : 'text-sm';

    return (
        <div className={`${containerBg} ${padding} rounded-full inline-flex ${gap}`}>
            <button
                onClick={() => setPaymentMode('full')}
                className={`${buttonPadding} rounded-full ${fontSize} font-bold transition-all duration-300 uppercase tracking-wider ${paymentMode === 'full'
                        ? `${activeBgFull} ${isDark ? 'text-white' : 'text-slate-900'} shadow-md`
                        : inactiveText
                    }`}
            >
                Pay in Full
            </button>
            <button
                onClick={() => setPaymentMode('installments')}
                className={`${buttonPadding} rounded-full ${fontSize} font-bold transition-all duration-300 flex items-center ${gap} uppercase tracking-wider ${paymentMode === 'installments'
                        ? `${activeBgInstallments} text-[#1D2D3D] shadow-lg shadow-[#7DB00E]/30`
                        : inactiveText
                    }`}
            >
                {isCompact ? 'Pay Monthly' : 'Pay in 3'}
                {showTryBadge && <TryBadge />}
            </button>
        </div>
    );
}
