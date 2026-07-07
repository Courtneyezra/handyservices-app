/**
 * Shared "price lock" clock — anchored to the quote's REAL 48-hour validity
 * window (server `expiresAt`), not an arbitrary in-browser countdown.
 *
 * Customers open a quote link a median of 7 times before paying. The old
 * 15-minute clock restarted at 15:00 on every open, which read as fake.
 * This clock instead counts down to the server-issued expiry, so it is the
 * same honest number on every device, tab, refresh, and revisit.
 *
 * The expiry anchor is seeded from the GET /api/personalized-quotes/:slug
 * response (via QuoteTimerProvider) and mirrored to localStorage so loading
 * surfaces that render BEFORE the quote data arrives (skeleton/preparing
 * screens) can show the real remaining time on revisits. Until an anchor is
 * known (very first paint of the very first visit), `lockSecondsLeft` reports
 * the full window so the skeleton → page swap only ever ticks downward.
 */

/** Real quote validity — matches the PDF's "Valid 48 hours" and server expiresAt. */
export const TOTAL_LOCK_SECONDS = 48 * 60 * 60;

// In-memory cache of expiry anchors, keyed by quote slug.
const expiryByKey = new Map<string, number>();

function storageKey(key: string): string {
  return `hs-quote-lock-expiry:${key}`;
}

/** Anchor the lock to the server expiry for this quote (idempotent). */
export function setLockExpiry(key: string, expiresAtMs: number): void {
  if (!Number.isFinite(expiresAtMs)) return;
  if (expiryByKey.get(key) === expiresAtMs) return;
  expiryByKey.set(key, expiresAtMs);
  try {
    localStorage.setItem(storageKey(key), String(expiresAtMs));
  } catch {
    // Private mode / storage full — in-memory anchor still works for this tab.
  }
}

/** Expiry timestamp (ms) for this quote, or null if not yet known. */
export function getLockExpiryMs(key: string): number | null {
  const cached = expiryByKey.get(key);
  if (cached != null) return cached;
  try {
    const stored = localStorage.getItem(storageKey(key));
    if (stored) {
      const ms = Number(stored);
      if (Number.isFinite(ms)) {
        expiryByKey.set(key, ms);
        return ms;
      }
    }
  } catch {
    // Ignore — fall through to null.
  }
  return null;
}

/**
 * Whole seconds remaining on the lock for this quote, clamped to >= 0.
 * Falls back to the full window when no expiry anchor is known yet.
 */
export function lockSecondsLeft(key: string, total: number = TOTAL_LOCK_SECONDS): number {
  const expiryMs = getLockExpiryMs(key);
  if (expiryMs == null) return total;
  return Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
}

/** mm:ss for a seconds value. */
export function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** "36h 12m" when >= 1 hour remains, mm:ss below that (the anxious last hour). */
export function formatLockTime(secs: number): string {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  }
  return formatMMSS(secs);
}
