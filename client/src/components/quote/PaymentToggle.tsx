import React from 'react';
import { motion } from 'framer-motion';
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

    const containerBg = isDark ? 'bg-[#0f1a27]' : 'bg-slate-100';
    const activeBgFull = isDark ? 'bg-[#2a3f54]' : 'bg-white';
    const activeBgInstallments = 'bg-[#7DB00E]';
    const inactiveText = isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700';

    const padding = isCompact ? 'p-0.5' : 'p-1';
    const gap = isCompact ? 'gap-0.5' : 'gap-1';
    const buttonPadding = isCompact ? 'px-4 py-1.5' : 'px-6 py-2';
    const fontSize = isCompact ? 'text-[10px]' : 'text-sm';

    const fullClasses = `${buttonPadding} relative rounded-full ${fontSize} font-bold transition-[color] duration-200 uppercase tracking-wider active:scale-[0.97] will-change-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] ${
        paymentMode === 'full' ? (isDark ? 'text-white' : 'text-slate-900') : inactiveText
    }`;

    const installmentsClasses = `${buttonPadding} relative rounded-full ${fontSize} font-bold transition-[color] duration-200 flex items-center ${gap} uppercase tracking-wider active:scale-[0.97] will-change-transform [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] ${
        paymentMode === 'installments' ? 'text-[#1D2D3D]' : inactiveText
    }`;

    return (
        <div className={`${containerBg} ${padding} rounded-full inline-flex ${gap} relative`}>
            <button
                type="button"
                onClick={() => setPaymentMode('full')}
                className={fullClasses}
            >
                {paymentMode === 'full' && (
                    <motion.span
                        layoutId="payment-toggle-pill"
                        className={`absolute inset-0 ${activeBgFull} rounded-full shadow-md -z-10`}
                        transition={{ type: 'spring', duration: 0.5, bounce: 0.18 }}
                    />
                )}
                <span className="relative">Pay in Full</span>
            </button>
            <button
                type="button"
                onClick={() => setPaymentMode('installments')}
                className={installmentsClasses}
            >
                {paymentMode === 'installments' && (
                    <motion.span
                        layoutId="payment-toggle-pill"
                        className={`absolute inset-0 ${activeBgInstallments} rounded-full shadow-lg shadow-[#7DB00E]/30 -z-10`}
                        transition={{ type: 'spring', duration: 0.5, bounce: 0.18 }}
                    />
                )}
                <span className="relative inline-flex items-center gap-1">
                    {isCompact ? 'Pay Monthly' : 'Pay in 3'}
                    {showTryBadge && <TryBadge />}
                </span>
            </button>
        </div>
    );
}
