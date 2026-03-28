# Contextual Quote Analytics

Tracking coverage for the contextual quote system. Two sinks: PostHog (behavioral) and our own DB (conversion).

---

## Events Tracked

### `cq_quote_viewed` (PostHog)
Fired once per page load in `PersonalizedQuotePage.tsx` when quote data arrives. The primary view event.

Key fields:

| Field | Description |
|---|---|
| `quote_id` | UUID of the personalizedQuote row |
| `segment` | Customer segment (CONTEXTUAL, BUSY_PRO, OLDER_WOMAN, etc.) |
| `layout_tier` | `quick` / `standard` / `complex` — complexity tier assigned at quote creation |
| `image_shown` | URL/path of the hero image selected for this quote (content library or static fallback) |
| `customer_type` | Derived from vaContext: `homeowner` / `landlord` / `property_manager` / `business` / `professional` |
| `va_context_length` | Character length of the VA's context note — proxy for how much context was given |
| `has_contextual_headline` | `true` if an LLM-generated headline (`contextualHeadline`) was shown instead of a static one |
| `total_price_pence` | Final quoted price |
| `line_item_count` | Number of job lines in the quote |
| `batch_discount_applied` | Whether a multi-job discount was shown |
| `value_bullet_count` | Number of contextual value bullets shown |
| `is_revisit` | Whether this is a return visit to the same quote link |
| `hours_after_creation` | Time between quote creation and first view |
| `device_type` | `mobile` / `tablet` / `desktop` |

### `cq_pricing_layers` (PostHog)
Fired alongside `cq_quote_viewed` for contextual quotes with full pricing breakdown. Contains per-line reference vs LLM vs guarded price.

### `cq_section_viewed` (PostHog) + DB insert
Fired by IntersectionObserver when a section is visible for >500ms. Also POSTs to `/api/analytics/quotes/section-event` for in-app analytics.

Tracked sections: `hero`, `price`, `value_bullets`, `line_items`, `batch_discount`, `book_cta`, `trust_strip`, `guarantee`, `google_review`, `hassle_items`.

### `cq_payment_completed` (PostHog)
Fired on successful payment. Includes revenue, booking mode, scheduling tier, time-to-pay.

---

## Quote Platform DB Tracking

### Image view/booking counters (`quote_platform_images` table)

When a quote page loads and `selectedContent.images[0].id` exists:
- `POST /api/quote-platform/images/track-view` — increments `view_count`

When a booking is confirmed:
- `POST /api/quote-platform/images/track-booking` — increments `booking_count`

This gives per-image conversion rates independently of PostHog.

### Headline view/booking counters (`quote_platform_headlines` table)

Routes exist for future use once `selectedContent` includes a headline ID:
- `POST /api/quote-platform/headlines/track-view`
- `POST /api/quote-platform/headlines/track-booking`

Both routes are unauthenticated (called from the public-facing quote page).

---

## In-App Analytics Dashboard (`/admin/quote-analytics`)

Powered by `/api/analytics/quotes/summary`. All queries filter on `layoutTier IS NOT NULL` (contextual quotes only).

### Layout Tier Performance

Shows `quick`, `standard`, and `complex` tiers side-by-side:

| Column | Meaning |
|---|---|
| View → book rate | `booked_count / viewed_count` — primary conversion signal |
| Quote count | Total quotes created in this tier |
| Avg price | Mean `basePrice` for quotes in this tier |

**How to interpret:** Higher conversion on `quick` vs `complex` means simpler quotes close faster. Use this to tune when to use each tier. If `complex` has higher avg price but lower conversion, consider whether the complexity is causing drop-off or just reflecting harder jobs.

### Section Engagement Heatmap

Reach rate = % of quotes where the customer scrolled to that section. Bar width = avg dwell time.

- Green (80%+): Almost everyone sees this — it's working
- Amber (25–49%): Many customers drop off before here — consider moving content up
- Red (<25%): Very few reach this section

### Section-to-Conversion Correlation

Which sections correlate with customers who go on to book. A high conversion rate on `guarantee` means customers who read the guarantee are more likely to book — not that showing the guarantee causes bookings (correlation, not causation).

### Price Sensitivity

Conversion rate by price band (`booked / viewed`). Use to identify sweet spots and drop-off thresholds.

---

## Source Files

- Event schema: `client/src/lib/quote-analytics.ts`
- Page tracking: `client/src/pages/PersonalizedQuotePage.tsx` (search `hasTrackedViewRef`)
- DB section events: `server/quote-analytics-api.ts`
- Image/headline tracking routes: `server/contextual-pricing/routes.ts` (bottom of file)
- Analytics dashboard: `client/src/pages/admin/QuoteAnalyticsPage.tsx`
- DB tables: `shared/schema.ts` — `quotePlatformImages`, `quotePlatformHeadlines`, `quoteSectionEvents`
