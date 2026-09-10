---
name: quote-segments
description: Use when adding, renaming or changing a customer segment on the personalized quote page — the segment enum, its detection signals, tier structure, framing, add-ons or conversion boosters. Lists the files a new segment must touch and the framework the existing segments follow.
---

# Quote segments

A segment drives what the personalized quote page says: hero, proof, guarantee,
testimonial, the product on offer, its add-ons and its conversion boosters.

## The files a new segment touches on the quote page

| File | What it holds |
| --- | --- |
| `shared/schema.ts` | `segmentEnum` — add the value here first |
| `server/segmentation/config.ts` | Profile, detection signals, tier structure, pricing, framing |
| `server/openai.ts` | The segment types the model may return |
| `client/src/pages/PersonalizedQuotePage.tsx` | Segment content, features, conversion boosters |
| `client/src/components/quote/SchedulingConfig.ts` | Add-ons |
| `client/src/pages/GenerateQuoteLink.tsx` | Dropdown selector |
| `client/src/pages/GenerateQuoteLinkSimple.tsx` | Segment options |
| `shared/hassle-comparisons.ts` | Hassle rows and the section headline |

Miss one and the segment half-exists: it will be detectable but unselectable, or
selectable with the default page content. That is the minimum set for the quote
page, not the whole surface — segment values are also read by the live-call
coach, the pricing engines and the admin tooling.

tsc will not catch a segment you missed anywhere, so do not wait for it. The
`Record<SegmentType, ...>` maps in `server/segmentation/config.ts` and
`client/src/config/segment-confirmation-content.ts` each carry an `UNKNOWN` key
that is not in `segmentEnum`, and an excess property suppresses TypeScript's
missing-key error on that same literal; the admin tube-map and pipeline colour
maps declare their own local `SegmentType` union and never see the enum at all.
Everything keyed `Record<string, ...>` falls back silently: a segment missing
from `shared/hassle-comparisons.ts` renders the generic `UNKNOWN` rows on a live
quote with no error anywhere. So grep an existing value such as `LANDLORD` across
the repo and decide each hit deliberately — that grep is the only check you have.

## The framework the existing segments follow

Madhavan's single-product framework: offer **one** named product, not a tier comparison.
Tiers exist in the config for pricing, but the page sells a single thing.

- Free add-ons carry the optional work (tenant coordination, photo report); only a genuine
  cost is priced (key collection).
- Optionality is deliberate. Tenant coordination is offered, never assumed — the property
  may be empty or a short let.
- The first quote wins the job. Retention offers such as the Partner Program are a
  post-job upsell after value is proved, never a first-quote pitch. "Land and expand."
- Conversion boosters at the bottom of the funnel: a trust badge strip (insurance, review
  score, volume served), a risk-reversal line, and a PDF download framed for whoever has
  to approve the spend.

## Two worked examples

`PROP_MGR` is a portfolio manager; `LANDLORD` is an individual with one to three
properties. They are deliberately distinct segments with distinct copy, not one segment
with a toggle. Read both in `server/segmentation/config.ts` before inventing a third.

The history behind them, including the exact copy decisions, is in `docs/comms-desk-log.md`.
