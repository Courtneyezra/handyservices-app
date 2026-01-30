import React from 'react';

interface TryBadgeProps {
    className?: string;
}

/**
 * Bright, clean Try badge for highlighting new features.
 * Used in payment toggles to draw attention to the "Pay in 3" option.
 */
export function TryBadge({ className = '' }: TryBadgeProps) {
    return (
        <div className={`bg-gradient-to-r from-amber-400 to-yellow-400 text-gray-900 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md shadow-md ${className}`}>
            Try
        </div>
    );
}
