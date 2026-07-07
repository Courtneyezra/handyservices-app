import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { lockSecondsLeft, setLockExpiry, formatLockTime, TOTAL_LOCK_SECONDS } from './quoteLockClock';

const TOTAL_SECONDS = TOTAL_LOCK_SECONDS;

interface QuoteTimerState {
  secondsLeft: number;
  durationSeconds: number;
  progress: number; // 1 = full, 0 = empty
  expired: boolean;
  /** Returning visitor (viewCount > 1) — render the seal calm, no pulse/countdown anxiety. */
  calm: boolean;
  /** Absolute expiry, e.g. "Thu 8pm" — used by the calm returning-visitor seal. */
  expiryLabel: string | null;
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

/** Seconds remaining: prefer the server expiry, else the shared lock anchor. */
function computeSecondsLeft(
  expiryMs: number | null,
  quoteKey: string | undefined,
  durationSeconds: number,
): number {
  if (expiryMs != null) return Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
  return quoteKey ? lockSecondsLeft(quoteKey, durationSeconds) : durationSeconds;
}

/** "Thu 8pm" / "Thu 8:30pm" — compact absolute expiry for the calm seal. */
function formatExpiryLabel(expiryMs: number): string {
  const d = new Date(expiryMs);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const mins = d.getMinutes();
  const mer = d.getHours() >= 12 ? 'pm' : 'am';
  const h = d.getHours() % 12 || 12;
  return `${day} ${h}${mins ? `:${mins.toString().padStart(2, '0')}` : ''}${mer}`;
}

export function QuoteTimerProvider({
  children,
  durationSeconds = TOTAL_SECONDS,
  quoteKey,
  expiresAt,
  viewCount,
}: {
  children: React.ReactNode;
  durationSeconds?: number;
  /**
   * Shared lock-anchor key (quote slug). Keeps the countdown continuous across
   * the loading-screen → page swap, and lets the anchor persist to
   * localStorage so revisits resume from the real remaining time.
   */
  quoteKey?: string;
  /**
   * The quote's REAL server-issued expiry (48h validity window). When set, the
   * countdown derives from it — same honest number on every open/refresh.
   * Omitted → falls back to the shared lock anchor / a fresh local countdown.
   */
  expiresAt?: Date | string | null;
  /**
   * Server view count for this quote. First view (<= 1) keeps the urgent
   * pulsing treatment; returning visitors get the calm "PRICE LOCKED" seal.
   */
  viewCount?: number;
}) {
  const expiryMs = useMemo(() => {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime();
    return Number.isFinite(ms) ? ms : null;
  }, [expiresAt]);

  // Seed the shared clock synchronously (idempotent) so the initial
  // secondsLeft — and any skeleton still ticking — read the real expiry.
  if (quoteKey && expiryMs != null) {
    setLockExpiry(quoteKey, expiryMs);
  }

  const [secondsLeft, setSecondsLeft] = useState(() =>
    computeSecondsLeft(expiryMs, quoteKey, durationSeconds),
  );
  const expired = secondsLeft <= 0;
  const calm = (viewCount ?? 0) > 1;

  useEffect(() => {
    if (expired) return;
    const interval = setInterval(
      () => setSecondsLeft(computeSecondsLeft(expiryMs, quoteKey, durationSeconds)),
      1000,
    );
    return () => clearInterval(interval);
  }, [expired, quoteKey, expiryMs, durationSeconds]);

  const timeDisplay = useMemo(() => formatLockTime(secondsLeft), [secondsLeft]);

  const expiryLabel = useMemo(
    () => (expiryMs != null ? formatExpiryLabel(expiryMs) : null),
    [expiryMs],
  );

  const progress = Math.min(1, secondsLeft / durationSeconds);

  // Colour thresholds scaled to the 48h window: amber for most of the life of
  // the quote, orange inside the final ~6h, red inside the final hour.
  const borderColor = useMemo(() => {
    if (secondsLeft <= 60 * 60) return '#EF4444';
    if (secondsLeft <= 6 * 60 * 60) return '#EA580C';
    return '#F59E0B';
  }, [secondsLeft]);

  const glowColor = useMemo(() => {
    if (secondsLeft <= 60 * 60) return 'rgba(239, 68, 68, 0.6)';
    if (secondsLeft <= 6 * 60 * 60) return 'rgba(234, 88, 12, 0.5)';
    return 'rgba(245, 158, 11, 0.4)';
  }, [secondsLeft]);

  const pulseSpeed = useMemo(() => {
    if (secondsLeft <= 60 * 60) return '0.8s';
    if (secondsLeft <= 6 * 60 * 60) return '1.5s';
    return '3s';
  }, [secondsLeft]);

  const value: QuoteTimerState = {
    secondsLeft,
    durationSeconds,
    progress,
    expired,
    calm,
    expiryLabel,
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
