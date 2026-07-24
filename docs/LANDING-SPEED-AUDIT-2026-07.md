# Landing Page Speed Audit — Nottingham & Derby (24 Jul 2026)

## Pages audited
Canonical host is `www.handyservices.app` (the apex `handyservices.app` 301-redirects,
adding one extra round-trip before anything loads).

| Page | Route | Component |
|---|---|---|
| Nottingham | `/v2` | `HandymanV2 city="nottingham"` |
| Derby | `/v2/derby` | `HandymanV2 city="derby"` |
| Derby (dedicated) | `/derby` | `DerbyLanding` |

## Method & caveats
- Google PageSpeed Insights keyless API was rate-limiting (HTTP 429) → no headline
  Lighthouse score. The in-app browser engine returns 0 for paint timing (FCP/LCP),
  so this audit is built on **network weight, request count, and eager third-party JS**,
  which are the actual optimization levers.
- Cold-load numbers below are from the first uncached `/v2` load. Decoded (uncompressed)
  sizes are reliable across all captures.

## Measured weight (cold load)
| Page | Requests | Over-the-wire | Decoded | Heaviest single asset |
|---|---|---|---|---|
| `/v2` (Nottingham) | 32 | ~1.22 MB | ~3.7 MB | `nottingham_map.png` — 366 KB PNG |
| `/v2/derby` | 32 | ~1.2 MB | ~3.6 MB | `derby_map.png` 251 KB + JS bundle |
| `/derby` | 39 | heaviest | ~4.9 MB | Google Maps Places JS — 1.3 MB |

## Findings (ranked by impact)
1. **`/derby` eagerly loaded the Google Maps Places script — 373 KB gzip / 1.3 MB decoded.**
   `IntakeHero → DesktopLeadForm` mounted `react-google-autocomplete`'s `<Autocomplete>`
   at the top of the page (and even on mobile, where the form is `hidden lg:flex` — CSS
   hides it but React still mounts it), injecting the Maps JS before anyone typed an address.
2. **Location maps shipped as unoptimized PNGs** — `nottingham_map.png` (366 KB) and
   `derby_map.png` (251 KB), the single biggest images on each page.
3. **PostHog loaded with session recording + heatmaps + autocapture + dead-click capture
   all ON** on every landing page (heavy startup CPU + network via the rrweb recorder).
4. **Monolithic JS/CSS on every page** — main bundle ~917 KB decoded / 255 KB gzip plus
   ~323 KB / 50 KB CSS, loaded in full on landing pages that use a fraction of it.
5. **Apex→www 301 redirect** adds a round-trip for first-time visitors hitting the bare domain.

### Correction
An earlier draft flagged **Stripe.js as eagerly loaded on `/derby`**. Code analysis
disproved this: there are no Stripe imports in the Derby component tree, App.tsx, main.tsx,
index.html, or the global popups, and `stripe.ts` is strictly lazy (`getStripe()` on first
`<Elements>` render). The `stripe=true` reading was cross-navigation contamination in the
browser pane (SPA soft-nav accumulating resource entries). **No Stripe change was needed.**

## Shipped — quick wins (branch `perf/landing-speed-quick-wins`)
1. **Lazy-load Google Maps Places** (`DesktopLeadForm.tsx`): render a plain, pixel-identical
   `<input>` and only upgrade to `<Autocomplete>` (which injects the Maps script) on first
   focus. **Verified:** on load the Maps script is not fetched and `window.google.maps` is
   absent; on focusing the postcode field the 372 KB script fetches and Places initializes.
   Removes ~373 KB gzip / 1.3 MB decoded from the `/derby` critical path (mobile + desktop).
2. **Map PNGs → WebP** (`AnimatedMap.tsx`, `HandymanV2.tsx`): converted at q80, dimensions
   unchanged. `nottingham_map` 365 KB → 23 KB (**−94%**), `derby_map` 250 KB → 21 KB (**−92%**).
   PNGs deleted.
3. **PostHog lightened on landing** (`lib/posthog.ts`): on `/`, `/v2`, `/v2/*`, `/derby`,
   `/landing`, disable session recording (rrweb), heatmaps, and dead-click capture. Init
   stays synchronous so landing-page `capturePageView()` is never dropped. Full instrumentation
   retained on quote/checkout/admin funnel pages.

## Not yet done — recommended next
- **Code-split landing pages** — lazy-load below-the-fold sections (reviews, animated map,
  chat popup, sticky CTA) with `React.lazy` so the initial bundle is hero + form only.
- **Fix apex→www** so the primary domain serves directly (or point ads/links at `www`).
- **Audit `vendor-maps` (leaflet, 152 KB)** — if the landing "map" is just the static WebP +
  animation overlay, leaflet may be dead weight on these routes.
- **Re-measure with a PSI API key** for before/after Lighthouse / Core Web Vitals scores.
