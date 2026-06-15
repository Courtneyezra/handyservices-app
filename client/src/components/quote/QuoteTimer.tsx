import React, { useMemo } from 'react';
import { Clock, Lock, MessageCircle, Phone } from 'lucide-react';
import { useQuoteTimer } from './QuoteTimerContext';

interface QuoteTimerProps {
  children: React.ReactNode;
  /** Phone number for the call CTA */
  phoneNumber?: string;
  /** WhatsApp link */
  whatsappUrl?: string;
}

export function QuoteTimer({
  children,
  phoneNumber = '+447449501762',
  whatsappUrl = 'https://wa.me/447508744402',
}: QuoteTimerProps) {
  const {
    secondsLeft,
    progress,
    expired,
    borderColor,
    glowColor,
    pulseSpeed,
    timeDisplay,
  } = useQuoteTimer();

  // The border is built with a conic-gradient that drains clockwise
  const borderGradient = useMemo(() => {
    const deg = progress * 360;
    return `conic-gradient(from 0deg, ${borderColor} ${deg}deg, rgba(200,200,200,0.15) ${deg}deg)`;
  }, [progress, borderColor]);

  return (
    <div className="relative">
      {/* Keyframes for the pulse glow */}
      <style>{`
        @keyframes quoteTimerPulse {
          0%, 100% { box-shadow: 0 0 8px 2px var(--timer-glow); }
          50% { box-shadow: 0 0 20px 6px var(--timer-glow); }
        }
        @keyframes sealPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
      `}</style>

      {/* Timer border wrapper */}
      <div
        className="relative rounded-3xl transition-all duration-1000"
        style={{
          padding: '5px',
          background: expired ? 'transparent' : borderGradient,
          animation: expired ? 'none' : `quoteTimerPulse ${pulseSpeed} ease-in-out infinite`,
          '--timer-glow': glowColor,
        } as React.CSSProperties}
      >
        {/* Price-locked seal — circular corner badge */}
        {!expired && (
          <div
            className="absolute -top-10 -right-2 z-20"
            style={{
              animation: `sealPulse ${pulseSpeed} ease-in-out infinite`,
            }}
          >
            {/* Draining conic ring (mirrors the card border) */}
            <div
              className="rounded-full"
              style={{
                width: 76,
                height: 76,
                padding: 3,
                background: borderGradient,
                boxShadow: `0 6px 18px ${glowColor}`,
              }}
            >
              {/* Inner disc */}
              <div className="w-full h-full rounded-full bg-slate-900 flex flex-col items-center justify-center gap-0.5 text-center">
                <div className="flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-white" />
                  <span className="text-[9px] font-bold tracking-[0.15em] text-white leading-none">
                    PRICE
                  </span>
                </div>
                <span className="text-[11px] font-black tracking-[0.12em] text-white leading-none">
                  LOCKED
                </span>
                <span
                  className="text-[14px] font-black tabular-nums leading-none mt-0.5"
                  style={{ color: borderColor }}
                >
                  {timeDisplay}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Inner card content */}
        <div className={`relative rounded-[19px] overflow-hidden transition-all duration-700 ${expired ? 'blur-sm pointer-events-none select-none' : ''}`}>
          {children}
        </div>
      </div>

      {/* Expired overlay */}
      {expired && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-3xl bg-slate-900/60 backdrop-blur-sm">
          <div className="text-center px-6 space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500 text-white text-sm font-bold">
              <Clock className="w-4 h-4" />
              Quote expired
            </div>
            <p className="text-white text-sm font-medium max-w-[260px]">
              Slots fill fast — message us to get a fresh quote and secure your date
            </p>
            <div className="flex items-center gap-3 justify-center">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1fb855] text-white text-sm font-bold transition-all shadow-lg"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </a>
              <a
                href={`tel:${phoneNumber}`}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 text-sm font-bold transition-all shadow-lg"
              >
                <Phone className="w-4 h-4" />
                Call us
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
