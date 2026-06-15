/**
 * Shared 15-minute "price lock" clock.
 *
 * The countdown must read as ONE continuous timer from the moment the loading
 * skeleton's price-lock seal first appears, all the way through to the live
 * QuoteTimer seal on the loaded page. Both surfaces derive `secondsLeft` from a
 * single start-anchor captured here (keyed by quote slug) so the skeleton →
 * page swap never resets the clock back to 15:00.
 *
 * In-memory only: a hard refresh reloads this module, so the lock starts fresh
 * at 15:00 (matches prior behaviour). Keyed by slug so SPA-navigating to a
 * different quote starts that quote's lock fresh rather than inheriting the
 * previous one's elapsed time.
 */

export const TOTAL_LOCK_SECONDS = 15 * 60;

let current: { key: string; startMs: number } | null = null;

/** Timestamp (ms) the lock began for this quote — set lazily on first call. */
export function getLockStartMs(key: string): number {
  if (!current || current.key !== key) {
    current = { key, startMs: Date.now() };
  }
  return current.startMs;
}

/** Whole seconds remaining on the lock for this quote, clamped to >= 0. */
export function lockSecondsLeft(key: string, total: number = TOTAL_LOCK_SECONDS): number {
  const elapsed = (Date.now() - getLockStartMs(key)) / 1000;
  return Math.max(0, Math.ceil(total - elapsed));
}

/** mm:ss for a seconds value. */
export function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
