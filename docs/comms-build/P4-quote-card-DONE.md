# PHASE 4 / B — in-chat quote card — DONE

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p4-quote-card`, based on `53b7340` (comms-v3 with Phases 0–3).
Not pushed, not merged. No dev server, no DB access, no external calls, `app_settings` untouched. Ships dark.

## Migrations to apply

**None.** `personalized_quotes.is_draft` already exists in `shared/schema.ts` (documented as "unsent draft saved from the in-chat quote card"), customer-facing automations already skip `is_draft` rows (inbox-board, lead-automations, template-sync) and a quote-link send clears it (message-drafts). The brief said to add a status column only if none existed; one does, so the draft uses it.

## Files

New
- `server/spine/quote-intake.ts` — pure: `intakeFromArtifact` (clerk `Proposal.artifact` → card intake), `pickLatestIntakeRun`, `missingFields`, `validateDraftInput`, `intakeToDraftQuote` (the draft row: every price null **by type**, `isDraft: true`, media split by kind onto `customerPhotoUrls` / `customerVideoUrls`, `customerType` mapped to the quote vocabulary, `quoteMode: 'simple'`, `sourceChannel: 'comms_quote_card'`), `normaliseCustomerType`, `inferCustomerType` (landlord / letting-agent / business signals, default homeowner). db: `loadQuoteIntakeCard` (latest `agent_runs` row for the thread with `agent = 'quote_clerk'` carrying a `quote_intake` artifact, plus thread media), `loadThreadMedia` (image/video messages, not quarantined, de-duplicated by url, id = message id), `saveDraftQuote` (inserts the draft with the builder's slug discipline, stamps `conversations.metadata.quoteDraft`, emits a `board_delta`).
- `server/spine/routes.ts` — `GET /api/spine/quote-intake/:conversationId` (404 `{ available:false }`), `POST …/save-draft`, `POST /api/spine/ask/:conversationId { kind }`. Mounted in `server/index.ts` behind `requireAdmin`. The two writes refuse with 409 while the spine switch is `off`.
- `client/src/components/comms/QuoteIntakeCard.tsx` — the compact card: name, postcode, customer type select, editable lines (title / category / qty, add, remove), media thumbnails with tick boxes (all ticked; Ben unticks), "Save draft quote", "Open full builder" (same `sessionStorage.quoteFromComms` handoff `QuotePrepPanel` uses, to `/admin/generate-contextual-quote`), "Waiting on postcode / name" chips with "Ask now". Renders nothing without an intake. Mounted in the thread panel (`CommsPage.tsx`) above the existing quote-prep chip.
- `server/spine/quote-intake.test.ts` (10 tests): intake → draft mapping (null prices, media split, customer type, defaults), validation, artifact reading, latest-run picking, missing-field chips, type inference, media kinds.

Modified
- `server/rules-layer.ts` — `AskKind` gains `'ask_name'` (copy, no template, `rules.ask`); `sendAsk(conversationId, kind, runId, { approver? })` accepts a human approver so a tap from the card is approved by that person, not by the rule (additive; the rules-layer's own sweeps are unchanged).
- `server/comms-events.ts`, `client/src/hooks/useCommsEvents.ts` — new `artifact_delta` event; the client invalidates `['quote-intake', conversationId]` on it.
- `server/spine/exit.ts` — after the exit, a run whose proposal carries an artifact emits `artifact_delta` (never throws).
- `server/index.ts` — mounts the spine router.

## Verification

- **tsc**: baseline (`53b7340`, throwaway worktree, private tsbuildinfo) 1,883 errors → after **1,883, zero new, zero gone**.
- **vitest**: baseline 42 failed / 773 passed / 8 skipped (47 files) → after **42 failed / 786 passed / 8 skipped (48 files)**; the same 42 (eve-pricing-engine 37, segment-classifier 4, contractor-pay 1). The new suite is green. One run taken while eleven tsc processes from other panes were competing for CPU showed a 43rd failure in `call-script/__tests__/performance.test.ts` ("transition in < 1 ms" measured 115 ms); it passes alone and passed in the re-run under normal load. Not touched by this branch.
- **esbuild**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds.
- **Component smoke test: skipped.** There is no client test setup in the repo (no testing-library / jsdom / happy-dom in package.json, no `client/**/*.test.tsx`, vitest `include` is `server/**` only). Adding one is a repo-wide decision, not a Phase 4 side effect.
- NOT verified: the card in a browser, a real save, a real ask, a real SSE refetch. All forbidden from this pane.

## Not done, and why

- **Builder resumability of a draft is by the existing `/admin/quotes/:slug/edit` route.** The draft row stores lines in `pricingLineItems` with an explicit null-priced shape (`lineId, label, title, description, category, qty, pricePence:null, labourPence:null, materialsPence:null, assumptions, source:'quote_intake'`). The builder's own line shape is engine-derived and larger; if its edit page assumes engine fields, it will need a small "draft" branch (pane owning the builder). "Open full builder" uses the prefill handoff instead, which works today.
- **No new card trigger.** The clerk already runs on `needs_quote` / `quote_clerk` lane / `call_ended` with a transcript (Phase 2); Phase 4 adds only the SSE refetch from the exit.
- **Media ids are message ids**, so the draft picks urls by ticked message id; a re-sent identical url is de-duplicated to its first message.
- The legacy `QuotePrepPanel` sheet and chip stay as they are; the new card sits above the chip. Both can show for the same thread during the transition (legacy intake in `conversations.metadata`, spine intake in `agent_runs`).

## Decisions the design left open

- **Dark switch = the spine mode.** Reads are harmless (nothing exists to read unless the spine's clerk ran); the two writes (save-draft, ask) refuse with 409 while `spineMode() === 'off'`, using the Phase 3 switch rather than a new field.
- **Ask approver is the signed-in human** (`human:<email>`), via the additive `sendAsk` option; suppression, opt-out, near-duplicate and the 2-hour holding window still apply because the send goes through the same `deliver` path.
- **`ask_name` added to the rules layer** (the brief's chips need it; the legacy request-details endpoint had name copy, the rules layer did not). Copy: "Nearly ready to send your quote over. What name should we put on it?" — one question, no dashes, guarded at module load like the others.
- **Customer type**: the clerk's `customerType` wins; `inferCustomerType` exists for a caller with the customer's text and defaults to homeowner; the card's select lets Ben override either.
- **Draft name fallback**: empty name → the conversation's contact name → `'Customer'` (`customer_name` is NOT NULL).
- `quoteMode: 'simple'` (the only value the codebase writes), `segment: 'CONTEXTUAL'`, expiry 30 days like the builder.
