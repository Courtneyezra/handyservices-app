import React from 'react';
import { Clock } from 'lucide-react';
import { useQuoteTimer } from './QuoteTimerContext';

interface StickyTimerBarProps {
  /** Only show when quote card is not in viewport */
  isVisible?: boolean;
}

export function StickyTimerBar({ isVisible = true }: StickyTimerBarProps) {
  const { progress, expired, borderColor, glowColor, timeDisplay, pulseSpeed } = useQuoteTimer();

  if (expired || !isVisible) return null;

  return (
    <>
      {/* Keyframes */}
      <style>{`
        @keyframes stickyBarGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Fixed bar that sits just above the sticky CTA (which is z-50, bottom-0) */}
      {/* We use bottom-[60px] to sit above the ~60px sticky CTA bar */}
      <div className="fixed bottom-[60px] left-0 right-0 z-[9998] pointer-events-none">
        {/* Compact timer strip */}
        <div className="flex items-center justify-center gap-1.5 py-1 bg-slate-900/90 backdrop-blur-sm">
          <Clock
            className="w-3 h-3"
            style={{
              color: borderColor,
              animation: `stickyBarGlow ${pulseSpeed} ease-in-out infinite`,
            }}
          />
          <span className="text-[11px] font-semibold text-white/90 tracking-wide">
            {timeDisplay}
          </span>
        </div>
        {/* Horizontal progress bar */}
        <div className="h-[3px] bg-slate-800/80 w-full">
          <div
            className="h-full transition-all duration-1000 ease-linear"
            style={{
              width: `${progress * 100}%`,
              backgroundColor: borderColor,
              boxShadow: `0 0 10px ${glowColor}, 0 0 4px ${glowColor}`,
            }}
          />
        </div>
      </div>
    </>
  );
}
