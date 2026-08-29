# Task Brief: Speed up contextual quote generation + hard Craig skin default

Owner decisions (Courtnee, 29 Aug 2026) — these are settled, do not re-ask:
1. The legacy route `POST /api/personalized-quotes/value` (server/quotes.ts:319) is
   NOT in use. Do not optimise or touch it. All work targets
   `POST /api/pricing/create-contextual-quote` (server/contextual-pricing/routes.ts:2170).
2. All-SKU quotes must SKIP the LLM pricing call. Mixed/custom quotes keep it.
3. Description polish: skip for SKU-resolved lines, keep for free-text custom lines.
4. Auto-skin is removed as a concept: when Ben doesn't manually pick a lead
   contractor, the quote must default to the vertical's priority contractor
   (Craig for handyman) as a HARD forced lead — his diary anchors the customer
   calendar and he gets the booking. No travel-time reassignment to other
   contractors. Ben's explicit manual pick still overrides.

## Context — where the time goes

`create-contextual-quote` awaits, in order: content library select → win-rate DB
query → `generateMultiLinePrice` (the dominant cost) → margin engine →
`geocodePostcode` → `resolveQuoteCandidatePool` → insert → WhatsApp message build.

`generateMultiLinePrice` (server/contextual-pricing/multi-line-engine.ts:268):
- Resolves SKU lines deterministically (Phase 25 preflight, lines 283-336).
- Then ALWAYS runs, in parallel (lines 352-357):
  - `polishAllDescriptions` — one Claude Haiku call PER LINE (lines 103-145)
  - the main LLM pricing call (multi-line-llm.ts) — even when every line is
    SKU-resolved, "so messaging (headline, value bullets) still reflects the
    full job". SKU lines' LLM prices are overwritten in assembly anyway.

## Work items

### A. Skip LLM for all-SKU quotes
In `generateMultiLinePrice`: when EVERY line is SKU-resolved (skuResolutions has
all line ids), do not call the multi-line LLM. Build the result from the SKU
resolutions + reference layer. Headline/value bullets: use template copy — reuse
the content-library selection already made in the route (step 3,
routes.ts:2258+) or a simple deterministic template (e.g. from line categories).
Keep the output shape (`MultiLineResult`) identical so the route's assembly,
margin engine, and quote insert are untouched. Mixed/custom quotes: unchanged.

### B. Skip polish for SKU lines
In the polish step, only polish lines NOT in `skuResolutions` (custom free-text
lines). SKU lines keep their catalog label as description.

### C. Hard Craig default lead (remove auto-skin)
Files: server/lib/quote-fit.ts (`resolveQuoteCandidatePool`:125,
`fetchPriorityContractor`:66, forced-lead injection:168-190) and
server/lib/quote-team.ts (`deriveTeamFit`:194-224).

Current behaviour: with no `forcedLeadId`, a 'solo' plan sets
`availabilityContractorIds` = ALL full-coverage soloers, and at booking
`reserveSlot` (server/booking-engine.ts:347-381) sorts candidates by travel time
and books the closest — so the displayed skin and the booked contractor can
differ. That must stop.

Required behaviour: when no manual pick, treat the priority contractor
(fetchPriorityContractor — Craig) as the forced lead: `leadContractorId` =
Craig, `availabilityContractorIds` = [Craig] (his diary alone drives the
customer date picker), and the booking candidate set is Craig only. A manual
Ben pick (`forcedLeadContractorId` / `leadContractorSource='manual'`) still
wins and anchors alone, as today.

IMPORTANT: also verify the reserve path in server/public-routes.ts:1407-1536 —
it falls back to the quote's stored `candidateContractorIds` (the full pool).
Ensure the candidate set passed to `reserveSlot` reflects the lead-only anchor,
otherwise the travel-sort will still reassign. Check every caller of
`reserveSlot` (public-routes.ts, contractor-app-routes.ts, contractor-hub-routes.ts)
for the same leak. Composed (multi-trade) plans already anchor on the lead —
keep that.

Decide whether `leadContractorSource` for the Craig-default case stays 'auto'
(so a later real manual pick is distinguishable) — prefer keeping 'auto' as the
stored value but making the ANCHORING behaviour identical to manual. Document
whichever you choose in code comments.

### D. Instrumentation
Add per-step duration logging in create-contextual-quote (single summary line,
e.g. `[ContextualQuote] timings: pricing=Xms fit=Yms geocode=Zms total=Tms`) so
the speed-up is verifiable in prod logs.

## Guardrails
- Do not change customer-facing prices for any existing quote type. SKU prices
  must come from the catalog exactly as before; custom-line pricing via LLM
  unchanged.
- Do not touch the margin engine, supersede chain, or Stripe/booking webhook
  logic beyond the candidate-set fix in C.
- Run `npx tsc --noEmit` (or the project's typecheck) and any existing tests
  touching contextual-pricing / quote-fit / quote-team before finishing.
  quote-team.ts is described as unit-testable — add/extend a unit test for the
  Craig-default anchoring if a test harness exists.
- Commit is NOT required; leave changes uncommitted for review.

When done, write a short summary of changes + verification results to
docs/QUOTE_GEN_SPEEDUP_DONE.md.
