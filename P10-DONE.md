# P10 — tagging `needs_quote` must schedule a spine pass

Branch `p10-needs-quote-trigger` from `comms-v3` at `bc1f3a9`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P10-needs-quote-trigger.md`. Incident: Sarah (4c0e227b…), 4 Sep —
the thread carried `needs_quote` with no pass pending; the clerk never ran until a run was
requested by hand. The tag was a label.

## Fix

1. **One function** (`server/spine/request-run.ts`)
   - `shouldRequestQuoteRun(state)` (pure): run iff the thread carries `needs_quote` or `rescope`
     AND no live (non-superseded) `quote_estimates` row AND no live Route A draft
     (`metadata.quoteDraft` → a `personalized_quotes` row that is still `is_draft` and not
     superseded) AND no pending pass (`metadata.nextTriageAt` absent, or past by > 10 min — a
     lease that expired unrun).
   - `ensureQuoteRun(conversationId, reason)`: loads that state, decides, and calls
     `requestRun(id, 'cadence', { delayMs: 0 })`. Idempotent (a pending pass or an existing
     estimate / draft means nothing happens), one log line either way, never throws.
   - `sweepUntriggeredQuotes()`: up to **5** customer threads carrying a quote tag (oldest updated
     first, 50 scanned) get `ensureQuoteRun`; the net for anything that slips through.

2. **Every writer of the tag calls it**
   - Spine exit (P9's tag write): `ExitDeps.requestClerkRun` now IS `ensureQuoteRun`.
   - Spine triage (`triage.ts` autonomous tag/stage write): a `needs_quote` from the model or a
     `rescope` from the P9 pre-check that just landed → `ensureQuoteRun`.
   - Legacy `set_board_state` (`server/agents/comms.ts`): `add_tags` containing `needs_quote` /
     `rescope` → `ensureQuoteRun` (never throws into the tool).
   - Portal lane override (`server/intake.ts setIntakeOverride`): an override TO `quote_ready`
     tags the thread `needs_quote` (additive) and calls `ensureQuoteRun`.
   - Worker slow sweep (`server/agents/comms-sweep.ts sweepOnce`, every 5 min, worker-gated):
     `sweepUntriggeredQuotes()` runs first, in every mode the spine is on, before the legacy
     `comms_agent.enabled` gate so a disabled legacy sweep cannot starve it.

3. **Shadow mode** — verified and fixed
   - `runDue` stays live-only (P8-fix). In shadow the legacy fast tick (`tickDueTriage`) reads the
     same `nextTriageAt` rows and runs `runShadow` on them, so a cadence pass requested by
     `ensureQuoteRun` IS picked up — but the tick hardcoded `runShadow(row.id, 'inbound_message')`
     and never read `nextTriageTrigger`. It now selects the trigger and passes it through
     (`isTrigger` guard, `inbound_message` fallback), and clears `nextTriageTrigger` /
     `nextTriageRunId` with the lease, as `runDue` does. The clerk lanes on the tag whatever the
     trigger, so Route A runs in shadow as designed (internal; nothing reaches a customer).
   - Caveat, unchanged behaviour: the shadow fast tick is gated on the legacy
     `comms_agent.enabled && onInbound`, and after the shadow pass it also runs the legacy agent on
     the row. A cadence row therefore costs one legacy run in shadow. Noted below.

4. **Tests** (`server/spine/request-run.test.ts`, 9, fakes only): decision table (tag + nothing →
   run; no tag / live estimate / live draft / pending or recently-past pass → nothing; stale pass
   → run); `ensureQuoteRun` requests once, refuses on estimate or pending, never throws on a
   missing thread, a refused request or a throwing loader; the sweep requests at most 5, reports
   what it checked, and is quiet on an empty or failing candidate list.

## Files

Changed: `server/spine/request-run.ts`, `server/spine/exit.ts`, `server/spine/triage.ts`,
`server/agents/comms.ts`, `server/agents/comms-sweep.ts`, `server/intake.ts`.
New: `server/spine/request-run.test.ts`, `P10-DONE.md`. No migrations.

## Verification

| Gate | Result |
|---|---|
| tsc vs `bc1f3a9` | 1,868 → 1,868; (file, error code) multiset identical |
| server vitest | baseline 42 failed / 1,013 passed (70 files); after 42 failed / 1,022 passed (71 files); failing set identical |
| `npm run test:client` | 60 passed when run alone (the baseline script ran it alongside tsc and one PriceAndSend timing test flaked, as in P9) |
| esbuild `server/index.ts` | bundles |

No dev server, no database, no `app_settings`, no push.

## Not done, and why

- **"Newer than the tag"**: `conversations.tags` carries no timestamp, so the check is "a live
  estimate or a live Route A draft exists at all" rather than "…newer than the tag". A new intake
  supersedes the old estimate and draft (P8 §5), which restores the trigger; a thread whose
  estimate is live but stale would need a supersede first (the manual estimate request does that).
- **Shadow costs a legacy run per cadence row** (see §3). Making the legacy agent skip
  cadence-triggered rows is a legacy-tick change outside this brief; it goes away with Phase 5.
- **The sweep's candidate query uses `tags && ARRAY[...]`** on the `text[]` column; if
  `role_profile` is null on old threads they are included (customer by default), matching
  `resolveInboundRole`'s safe default.

## Decisions

- The decision is pure and the loaders are injected, so every writer shares one rule and the
  tests need no database.
- A stale pending pass (> 10 min past due) counts as absent: that is exactly the "lease expired
  unrun" state Sarah's thread was in.
- The sweep runs before the legacy gate, in shadow as well as live, because Route A is internal
  and the whole point is that nothing depends on a human noticing the tag.
