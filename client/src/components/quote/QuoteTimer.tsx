import React, { useMemo } from 'react';
import { Clock, MessageCircle, Phone } from 'lucide-react';
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

  // Badge text color — amber needs dark text for readability
  const badgeTextColor = secondsLeft <= 300 ? 'text-white' : 'text-slate-900';

  return (
    <div className="relative">
      {/* Keyframes for the pulse glow */}
      <style>{`
        @keyframes quoteTimerPulse {
          0%, 100% { box-shadow: 0 0 8px 2px var(--timer-glow); }
          50% { box-shadow: 0 0 20px 6px var(--timer-glow); }
        }
        @keyframes badgePulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          50% { transform: translateX(-50%) scale(1.03); }
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
        {/* Timer label - shown above the card */}
        {!expired && (
          <div
            className="absolute -top-3.5 left-1/2 z-10"
            style={{
              animation: `badgePulse ${pulseSpeed} ease-in-out infinite`,
            }}
          >
            <div
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold ${badgeTextColor} shadow-lg whitespace-nowrap`}
              style={{
                backgroundColor: borderColor,
                boxShadow: `0 4px 12px ${glowColor}`,
              }}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Quote valid for {timeDisplay}</span>
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
