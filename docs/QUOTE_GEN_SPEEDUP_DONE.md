# Quote Generation Speedup — DONE (29 Aug 2026)

Implements all four work items from `docs/QUOTE_GEN_SPEEDUP_BRIEF.md`. All work targets
`POST /api/pricing/create-contextual-quote`; the legacy `/api/personalized-quotes/value`
route was not touched. Changes are uncommitted, as instructed.

## A — All-SKU quotes skip the LLM pricing call

`server/contextual-pricing/multi-line-engine.ts`

- When every line is SKU-resolved (`skuResolutions` covers all line ids), `generateMultiLinePrice`
  no longer calls `generateMultiLineLLMPrice`. A new `buildAllSkuLLMResult()` builds a
  `MultiLineLLMResult` of identical shape from the SKU resolutions + approved claims:
  - `suggestedPricePence` = catalog price per line (these were already authoritative — the LLM's
    numbers were overwritten in assembly, so customer-facing prices are byte-identical).
  - Deterministic batch discount: 0% (1 line) / 8% (2 lines) / 10% (3+), inside the documented
    LLM guidance bands (2 jobs 5–10%, 3+ jobs 8–15%). Edit path is unaffected:
    `batchDiscountPercentOverride` is consulted first and pins the stored discount.
  - Messaging (headline, contextual message, value bullets, WhatsApp lines, jobTopLine) is
    templated from SKU catalog names + the content-library approved claims pool, with the same
    padding defaults `validateMessaging` uses.
- Mixed and all-custom quotes keep the full LLM call, retries, and fallback unchanged.
- Fast path logs: `[multi-line-engine] all N line(s) SKU-resolved — skipping LLM pricing call (fast path)`.

## B — Description polish only for custom lines

`server/contextual-pricing/multi-line-engine.ts`

- `polishAllDescriptions` is now called with only the non-SKU (free-text) lines.
- SKU-resolved lines use the catalog label the builder sent verbatim (`line.description`) —
  already customer-ready copy. On an all-SKU quote this drops every Haiku polish call.

## C — Hard Craig default lead (auto-skin removed)

`server/lib/quote-team.ts`

- New `defaultLeadId?: string | null` on `ResolveTeamOptions`. Both `resolveQuoteTeam` and
  `deriveTeamFit` resolve the anchor as `forcedLeadId ?? defaultLeadId` — so the default lead
  gets ANCHORING identical to a manual pick (his diary drives the calendar,
  `availabilityContractorIds = [lead]`, no solo-union pool), while a manual `forcedLeadId`
  always wins. Unknown id falls through to the old auto flow. Documented in code comments.

`server/lib/quote-fit.ts`

- `resolveQuoteCandidatePool` passes the vertical's priority contractor (Craig for handyman,
  already fetched for match-all injection) as `defaultLeadId`. No priority contractor for the
  vertical → old behaviour. Because the route only stores `leadContractorSource='manual'` when
  the caller's forced pick actually won, the Craig-default case keeps `'auto'` provenance with
  zero route changes — per the brief's preference.
- `computeQuoteCandidatePoolForQuote` (live recomputes for the customer date picker) goes
  through the same function, so it inherits the anchor automatically.

`server/public-routes.ts` (reserve-slot handler, ~:1407)

- Reserve-path leak closed: the handler now always loads the quote row (incl.
  `leadContractorId`). If the quote has a stored lead (manual pick or Craig-default), the
  booking candidate set is forced to `[leadContractorId]`, overriding both body-supplied pools
  and the stored full `candidateContractorIds` union — so `reserveSlot`'s travel-time sort can
  no longer reassign the job. This also retro-fixes old quotes that still carry full solo-union
  pools. A log line fires whenever the override actually narrows the pool. Quotes with no
  stored lead keep the original fallback chain (stored pool → quote.contractorId →
  skill-matcher → consultation roster → 400).
- Other `reserveSlot` callers audited: `contractor-app-routes.ts` (:901, :967) and
  `contractor-hub-routes.ts` (:262) already pass single-contractor arrays — no change needed.
  Composed plans already anchor on the lead — unchanged.

## D — Per-step duration logging

`server/contextual-pricing/routes.ts` (create-contextual-quote handler)

- Timestamps captured around content-library lookup, win-rate calc, `generateMultiLinePrice`,
  margin engine, geocode, `resolveQuoteCandidatePool`, and the DB insert/update. One summary
  line before the 201 response:

  ```
  [ContextualQuote] timings: mode=sku-fast|llm content=Xms winRate=Xms pricing=Xms margin=Xms geocode=Xms fit=Xms insert=Xms total=Tms
  ```

## Guardrail compliance

- No customer-facing price changes: SKU prices come from the catalog exactly as before; custom
  line LLM pricing untouched; deterministic batch discount sits inside the LLM's own guidance
  bands and the edit path pins the stored discount via `batchDiscountPercentOverride`.
- `MultiLineResult` shape unchanged; margin engine, supersede chain, Stripe/booking webhook
  logic untouched beyond the item-C candidate-set fix.

## Verification

- `npx vitest run` on all suites touching contextual-pricing / quote-team:
  `quote-team.test.ts` (26, incl. 5 new Craig-default anchor tests: default anchors solo +
  lead-only availability; manual pick beats default; match-all multi-trade; unknown default →
  auto fallback; both null → unchanged), `cost-buckets.test.ts` (26),
  `reference-contingency.test.ts` (5), `per-line-guardrails.test.ts` (5) —
  **62/62 passed**.
- `npx tsc --noEmit` — zero errors in any touched file. The only errors in the repo are
  pre-existing syntax breakage in two unrelated untracked scripts
  (`scripts/scrape-reddit-value-drivers.ts`, `scripts/seed-diy-advice.ts`), untouched.

## Files changed

- `server/contextual-pricing/multi-line-engine.ts` — A + B
- `server/contextual-pricing/routes.ts` — D
- `server/lib/quote-team.ts` — C (defaultLeadId anchor)
- `server/lib/quote-fit.ts` — C (priority contractor → defaultLeadId)
- `server/public-routes.ts` — C (reserve-slot lead-only override)
- `server/lib/quote-team.test.ts` — 5 new anchoring tests
- `docs/QUOTE_GEN_SPEEDUP_DONE.md` — this file
