/**
 * Single source of truth for "which contractors can do this quote?".
 *
 * Both the admin fit panel (`/api/admin/availability/fit`) and the
 * customer-facing date picker (`/api/public/quote/:id/availability`)
 * call this so they CAN'T disagree about which contractors are
 * eligible for a quote.
 *
 * Layered filters applied here:
 *   1. findCandidateContractors  → active + verified-or-public + within
 *                                  each contractor's own service radius
 *   2. coveragePercent === 100   → only contractors who cover EVERY
 *                                  line-item category. Partials can't
 *                                  complete the full job, so showing
 *                                  them would let admin assign work
 *                                  that can't actually be delivered.
 *
 * If you change this function, customer-facing dates and admin fit
 * panel both move together. That's the point.
 */
import { findCandidateContractors } from '../contractor-matcher';
import type { personalizedQuotes } from '../../shared/schema';
import { geocodeAddress } from './geocoding';

type QuoteRow = typeof personalizedQuotes.$inferSelect;

export interface QuoteFitInput {
  categorySlugs: string[];
  customerLat?: number;
  customerLng?: number;
}

export interface FitCandidate {
  contractorId: string;
  contractorName: string;
  coveragePercent: number;     // always 100 in `candidates` — kept on the type so admin UI doesn't need a separate shape
  coveredCategories: string[];
  distanceMiles: number | null;
}

export interface QuoteFitResult {
  /** Contractors who pass every filter — admin can show + customer can book. */
  candidates: FitCandidate[];
  /** Categories no in-radius contractor covers. Drives the "no fit" warning. */
  uncoveredCategories: string[];
  fullCoverageCandidates: number;
  /** How many were dropped purely because coverage < 100. Diagnostic only. */
  partialCoverageDropped: number;
}

export async function resolveQuoteCandidatePool(input: QuoteFitInput): Promise<QuoteFitResult> {
  if (input.categorySlugs.length === 0) {
    return { candidates: [], uncoveredCategories: [], fullCoverageCandidates: 0, partialCoverageDropped: 0 };
  }

  const match = await findCandidateContractors({
    categorySlugs: input.categorySlugs,
    customerLat: input.customerLat,
    customerLng: input.customerLng,
  });

  const full = match.candidates.filter((c) => c.coveragePercent === 100);
  const partialDropped = match.candidates.length - full.length;
  if (partialDropped > 0) {
    console.log(`[QuoteFit] dropping ${partialDropped} partial-coverage candidate(s) — keeping ${full.length} full-coverage`);
  }

  return {
    candidates: full,
    uncoveredCategories: match.uncoveredCategories,
    fullCoverageCandidates: full.length,
    partialCoverageDropped: partialDropped,
  };
}

/**
 * Convenience wrapper: derive the input from a stored quote row.
 *
 * Pulls categories from `pricingLineItems` (preferred — what the contextual
 * quote builder writes) or `categories` (legacy). Pulls coords from the
 * quote row directly when present; if null but a postcode exists, geocodes
 * it on the fly so the distance check still applies. The geocoded coords
 * are NOT persisted here — the caller (e.g. the admin matrix endpoint) can
 * persist them in its own write path if it wants.
 *
 * NOTE: this is the *uncached* compute. The customer date picker hits the
 * cached wrapper `resolveQuoteCandidatePoolForQuote` below; the admin fit
 * panel calls the lower-level `resolveQuoteCandidatePool` directly. Keep
 * this exported so tests / future callers can force a fresh recompute.
 */
export async function computeQuoteCandidatePoolForQuote(quote: QuoteRow): Promise<QuoteFitResult> {
  // Categories
  let categorySlugs: string[] = [];
  const lineItems = quote.pricingLineItems as any[] | null;
  if (Array.isArray(lineItems)) {
    categorySlugs = Array.from(
      new Set(lineItems.map((li: any) => li.categorySlug || li.category).filter(Boolean) as string[]),
    );
  }
  if (categorySlugs.length === 0 && quote.categories) {
    categorySlugs = (quote.categories as string[]).filter(Boolean);
  }

  // Coords
  let customerLat: number | undefined;
  let customerLng: number | undefined;
  const stored = quote.coordinates as { lat?: number; lng?: number } | null;
  if (stored && typeof stored.lat === 'number' && typeof stored.lng === 'number') {
    customerLat = stored.lat;
    customerLng = stored.lng;
  } else if (quote.postcode) {
    try {
      const geo = await geocodeAddress(quote.postcode);
      if (geo) {
        customerLat = geo.lat;
        customerLng = geo.lng;
      }
    } catch (err) {
      console.warn(`[QuoteFit] postcode geocoding failed for quote ${quote.id}:`, err);
    }
  }

  return resolveQuoteCandidatePool({ categorySlugs, customerLat, customerLng });
}

// ---------------------------------------------------------------------------
// Short-TTL single-flight cache for the customer date picker.
//
// The fit (geocode the quote postcode + run the contractor matcher) depends
// ONLY on the quote — not on the requested slot or month — yet the public
// `/quote/:id/availability` route resolved it live on every read. The page
// fires this work repeatedly: the scarcity banner and the date picker each
// fetch (different slots → separate requests), the slot toggles am↔full_day,
// the month navigates, and react-query refetches on window focus. Every one
// of those was paying a fresh postcodes.io round-trip + 3 sequential DB
// queries, which dominated the 3–7s the picker took to populate.
//
// This cache fixes both:
//   • single-flight  — concurrent callers (the banner + picker firing on the
//     same page load) share ONE in-flight computation instead of racing two.
//   • short TTL       — the resolved pool is reused for 60s, so slot flips,
//     month nav, focus refetches and back-to-back page loads are instant.
//
// The route previously documented "recompute live every read, because
// contractor skills/radius/verification status can change". We honour that
// intent with a deliberately short window: staleness is bounded to 60s, which
// is negligible for admin-driven contractor edits but absorbs the entire
// customer booking interaction. Slot/month-dependent availability
// (`buildAvailabilityResponse`: live booking conflicts + slot locks) is NOT
// cached here and stays live.
const QUOTE_FIT_CACHE_TTL_MS = 60 * 1000; // 60s — bounds staleness, absorbs one booking session

interface QuoteFitCacheEntry {
  promise: Promise<QuoteFitResult>;
  expiresAt: number;
}

const quoteFitCache = new Map<string, QuoteFitCacheEntry>();

/** Drop expired entries. Cheap — the live quote-view set in any 60s window is tiny. */
function pruneExpiredQuoteFit(now: number): void {
  for (const [key, entry] of quoteFitCache) {
    if (entry.expiresAt <= now) quoteFitCache.delete(key);
  }
}

/**
 * Cached, single-flight variant of {@link computeQuoteCandidatePoolForQuote},
 * keyed by the canonical quote id. Used by the customer-facing date picker
 * (`/api/public/quote/:id/availability`). See the block comment above for the
 * staleness rationale. Admin paths intentionally bypass this and recompute.
 */
export async function resolveQuoteCandidatePoolForQuote(quote: QuoteRow): Promise<QuoteFitResult> {
  const key = quote.id;
  const now = Date.now();

  const existing = quoteFitCache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  // Miss (or expired) — sweep stale entries before inserting a fresh one.
  pruneExpiredQuoteFit(now);

  const promise = computeQuoteCandidatePoolForQuote(quote);
  const entry: QuoteFitCacheEntry = { promise, expiresAt: now + QUOTE_FIT_CACHE_TTL_MS };
  quoteFitCache.set(key, entry);

  // Don't cache failures: a transient geocode/DB blip shouldn't be pinned for
  // 60s. Evict on rejection (only if this exact entry is still the cached one,
  // so we never clobber a newer entry). Callers still receive the rejection
  // via the returned promise — this handler just cleans the cache.
  promise.catch(() => {
    if (quoteFitCache.get(key) === entry) quoteFitCache.delete(key);
  });

  return promise;
}
