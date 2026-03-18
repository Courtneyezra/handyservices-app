import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

const TOTAL_SECONDS = 15 * 60;

interface QuoteTimerState {
  secondsLeft: number;
  durationSeconds: number;
  progress: number; // 1 = full, 0 = empty
  expired: boolean;
  borderColor: string;
  glowColor: string;
  pulseSpeed: string;
  timeDisplay: string;
}

const QuoteTimerContext = createContext<QuoteTimerState | null>(null);

export function useQuoteTimer() {
  const ctx = useContext(QuoteTimerContext);
  if (!ctx) throw new Error('useQuoteTimer must be inside QuoteTimerProvider');
  return ctx;
}

/** Safe version — returns null if not inside provider */
export function useQuoteTimerSafe() {
  return useContext(QuoteTimerContext);
}

/** Thin progress bar for the top edge of the sticky CTA bar */
export function StickyTimerProgress() {
  const timer = useContext(QuoteTimerContext);
  if (!timer || timer.expired) return null;

  return (
    <div className="h-[4px] w-full" style={{ backgroundColor: 'rgba(0,0,0,0.08)' }}>
      <div
        className="h-full transition-all duration-1000 ease-linear"
        style={{
          width: `${timer.progress * 100}%`,
          backgroundColor: timer.borderColor,
          boxShadow: `0 0 8px ${timer.glowColor}, 0 1px 4px ${timer.glowColor}`,
        }}
      />
    </div>
  );
}

export function QuoteTimerProvider({
  children,
  durationSeconds = TOTAL_SECONDS,
}: {
  children: React.ReactNode;
  durationSeconds?: number;
}) {
  const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
  const expired = secondsLeft <= 0;

  useEffect(() => {
    if (expired) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [expired]);

  const timeDisplay = useMemo(() => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, [secondsLeft]);

  const progress = secondsLeft / durationSeconds;

  const borderColor = useMemo(() => {
    if (secondsLeft <= 60) return '#EF4444';
    if (secondsLeft <= 300) return '#EA580C';
    return '#F59E0B';
  }, [secondsLeft]);

  const glowColor = useMemo(() => {
    if (secondsLeft <= 60) return 'rgba(239, 68, 68, 0.6)';
    if (secondsLeft <= 300) return 'rgba(234, 88, 12, 0.5)';
    return 'rgba(245, 158, 11, 0.4)';
  }, [secondsLeft]);

  const pulseSpeed = useMemo(() => {
    if (secondsLeft <= 60) return '0.8s';
    if (secondsLeft <= 300) return '1.5s';
    return '3s';
  }, [secondsLeft]);

  const value: QuoteTimerState = {
    secondsLeft,
    durationSeconds,
    progress,
    expired,
    borderColor,
    glowColor,
    pulseSpeed,
    timeDisplay,
  };

  return (
    <QuoteTimerContext.Provider value={value}>
      {children}
    </QuoteTimerContext.Provider>
  );
}
