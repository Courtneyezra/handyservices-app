# Quote Conversion Improvements — 3 Tactics

## Context

Data analysis shows:
- **0 bookings on first view** — most conversions happen at 6-13 views (decision anxiety)
- **Batch discounts give 2.5x conversion lift** (40% vs 16%) despite higher prices
- **Contextual engine converts at 26%** vs 2.2% legacy
- HBS research: showing "chat with us" option increases conversion by 24% even if nobody uses it
- Landscaping case study: revealing methodology on pricing page lifted conversion from <10% to 15%

## Changes

### 1. WhatsApp "Have a question?" button near the price
**Goal:** Reduce decision anxiety by making help accessible at the moment of hesitation.

**File:** `client/src/components/quote/UnifiedQuoteCard.tsx`

- Add a subtle WhatsApp link **directly below the price breakdown toggle** (after line ~672)
- Small, non-intrusive: `💬 Have a question? Chat with us` linking to `wa.me/447508744402?text=Hi, I have a question about my quote ({shortSlug})`
- Styled as a text link, not a big button — avoids clutter
- Need to pass `shortSlug` into UnifiedQuoteCard as a new prop

### 2. Inline line item context (always visible, one line per item)
**Goal:** Answer "what am I paying for?" without requiring a click.

**File:** `client/src/components/quote/UnifiedQuoteCard.tsx`

Current state: Line items are hidden behind a "See price breakdown" toggle (lines 611-672). Customer sees total price but no detail unless they click.

Change: **Show line items always visible** (remove the toggle), with compact one-line format:
- Instead of hidden: show each line item inline below the price
- Format: `Painting — 2 rooms, prep + 2 coats · £204`
- Materials on same line if present: `+ materials £30`
- Batch discount row stays as-is
- Total row stays at bottom
- Remove the `showBreakdown` state toggle — breakdown is always shown

This is a simple change: remove the `<button>` toggle, remove the `AnimatePresence`/`motion.div` wrapper, and just render the line items directly.

### 3. Proactive WhatsApp nudge on 3rd view (server-side)
**Goal:** Pull conversions forward — reach customers during their decision-making window.

**Files:**
- `shared/schema.ts` — add `viewNudgeSentAt` timestamp column to `personalizedQuotes`
- `server/quotes.ts` — trigger nudge check when `viewCount` hits 3 (in the GET `/api/quotes/:slug` handler, ~line 768)
- `server/lead-automations.ts` — add template `QUOTE_VIEW_NUDGE`

**Logic (in quotes.ts view handler):**
```
if viewCount === 3 AND viewNudgeSentAt IS NULL AND bookedAt IS NULL:
  - Check 24h WhatsApp window (canSendFreeform)
  - Send nudge: "Hi {name}! Still thinking about your quote? Happy to answer any questions — just reply here."
  - Set viewNudgeSentAt = now
```

**Why trigger at view 3:**
- Data shows 0 bookings at view 1, near-zero at views 2-5
- View 3 = customer is actively considering but hasn't committed
- Early enough to influence, late enough to not be annoying
- Dedup via `viewNudgeSentAt` column — one nudge per quote maximum

**DB migration:** Add `view_nudge_sent_at` timestamp column (nullable) to `personalized_quotes`

## Files to modify

1. `client/src/components/quote/UnifiedQuoteCard.tsx` — inline line items + WhatsApp link
2. `shared/schema.ts` — add `viewNudgeSentAt` column
3. `server/quotes.ts` — trigger nudge on 3rd view
4. `server/lead-automations.ts` — add QUOTE_VIEW_NUDGE template

## Verification

1. Start dev server (`npm run dev`)
2. Open a contextual quote page with line items — verify:
   - Line items visible by default (no toggle)
   - WhatsApp link visible below line items
   - Compact formatting, no clutter
3. View a quote 3 times (different requests) — check server logs for nudge trigger
4. Verify nudge respects: dedup (only once), 24h window check, already-booked skip
5. Push schema with `npm run db:push`
