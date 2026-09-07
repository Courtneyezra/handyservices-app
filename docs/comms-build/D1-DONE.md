# D1 — the clerk re-runs every sweep on a thread that cannot progress (DONE)

Brief: `docs/comms-build/BRIEF-D1-clerk-reruns.md`. Start commit `63390fa`. Branch
`fm/clerk-reruns-d1`, an isolated worktree with **no `.env`, no database and no key**: everything
below is from the code, the unit tests and the build gate. **Nothing here is a claim about live
behaviour.** The ledger figures are the ones quoted in the brief (7 Sep, read-only, by the
captain's side), not re-read here.

## What shipped

Two files of code, one test, four docs.

| File | Change |
|---|---|
| `server/spine/request-run.ts` | **The stamp.** `runDue` folds `metadata.lastSpinePass = { at, trigger, runId, quoteTags }` into the UPDATE that already clears the lease after `runOnce` returns (one write; only when the lease still matches; never on a thrown run). `at` is the moment the pass started; `quoteTags` is `QUOTE_TAGS ∩ caseFile.tags`, the tags the pass *found*. **The reader.** `QuoteRunState.passedThisTurn` (optional, like D7's `pendingDraft`); `shouldRequestQuoteRun` refuses on it after the D7 check and before the pending-pass check. `sweepQuoteRunState` (the **net's** loader only) computes it with the pure `lastPassCoversThisTurn` against `latestInboundFor` — the same inbound D7 judges the pending draft against, now read once and shared. Pure helpers `spinePassStamp`, `readSpinePassStamp`, `lastPassCoversThisTurn`; db helper `recordSpinePass` for the shadow path. |
| `server/spine/shadow.ts` | `runShadow` stamps the same way after a successful shadow pass (fail-safe: a failed stamp is a warning), so shadow mode cannot loop either. |
| `server/spine/clerk-reruns-d1.test.ts` | The regression test (14 tests). The loop shape through the net's real `ensureQuoteRun` and a fake db: **8 of 14 fail at `63390fa`** — the loop-shape test fails because the net requests a run (`requested: ['conv_1']`), the rest on the missing exports — all 14 pass after. |
| `docs/comms-build/BRIEF-D1-clerk-reruns.md` | The diagnosis in full, with line numbers from `63390fa`. |
| `docs/comms-build/BACKLOG.md` | D1 and D10 marked done; three rows appended (D11–D13) for loop shapes found on the way and not widened into here. |
| `CLAUDE.md` | One line in the comms-desk section. |

Not touched: `index.ts`, `triage.ts`, `exit.ts`, `route-a.ts`, the clerk, the survey offer,
anything about money, tiers, send preconditions, the sampler, autonomy, media, any flag, any
migration, any conversation.

## The diagnosis, short form (the brief has the long one)

**It is D10, and D1 is the same loop seen from the clerk's side.** Both rows close here.

- **Initiating trigger:** `sweepUntriggeredQuotes` (`request-run.ts:312`), the untriggered-quote
  net, called on **every** slow-sweep pass (`comms-sweep.ts:68`). Still the only requester that can
  ask for a `cadence` run on a clock: the legacy line 154 is stamped once per customer turn
  (`lastAutoTriageAt`), as D7 proved, and the four direct `ensureQuoteRun` callers fire once per
  cause.
- **Masking condition:** on `76c0a399…` the customer's last word ("…do not want to **pay** just to
  get a quote…") matches `RE_MONEY` (`triage.ts:36`) → `money_question` → Ben's lane. `rescope` on
  the row makes `benLaneClerkWanted` say yes (`index.ts:85-95`); no estimate and no Route A draft
  make `benLaneClerkVerdict` say yes (`103-109`); **the Quote clerk runs on Sonnet** for its
  artifact (`index.ts:277-278`). The artifact is short of `quote_ready`, the `visit_first` branch is
  skipped on Ben's lane (`362`), `decide` flags on the exception (`decide.ts:86`), the exit sees
  `needs_ben` already on the row and writes no flag (`exit.ts:237`). **No draft, no estimate, no
  tag change** — nothing D7's `pendingDraft` can hold. `runDue` clears `nextTriageAt`
  (`request-run.ts:382-385`) and the thread is left exactly as found. That the thread ran straight
  through D7's landing (`0822b27`, 6 Sep 13:48 UK) while `8e038292…` stopped is the proof of which
  shape it is.
- **Symptom:** one clerk run per five-minute pass, recorded under `triage` (`recordedAgent`,
  `index.ts:281`) — ~284 in 30 hours.
- **Why `needs_ben` / `survey_offered` did not stop it:** `needs_ben` is read only at
  `decide.ts:124`, `exit.ts:237` and `asks.ts:55`, all after the clerk has been paid for; the net's
  candidate query and `shouldRequestQuoteRun` never look at it. `survey_offered` has no reader in
  `server/`.

**A finding that shaped the fix.** In live mode the in-pass direct requesters (`triage.ts:350`,
`exit.ts:132`) are refused by the run's own lease: `runDue` has set `nextTriageAt` four minutes
ahead before `runOnce` starts, and `shouldRequestQuoteRun` reads that as "a pass is already
pending". A quote tag that lands *during* a pass is therefore scheduled by the net. So the stamp
records the quote tags the pass **found** (`caseFile.tags`), not the ones it wrote, and the net
treats a quote tag absent from the stamp as "something changed" and asks. Filed as **D11**.

## The two decisions the brief asked for

- **Request site, not run site.** The guard is in `shouldRequestQuoteRun`, read by the net's loader
  only. A suppressed pass costs nothing: no `agent_runs` row, no case file, no Haiku triage, no
  Sonnet clerk. It matches D7 exactly (same state object, same loader, same log line shape). The
  run-site guard (`benLaneClerkVerdict`) is unchanged: when a pass *does* run, the clerk still
  prepares whenever nothing is on the way, which is what P19 built.
- **The Ben-lane clerk keeps running on a `needs_ben` thread — once per new customer turn.** The
  spend was the clock, not the clerk: one Sonnet intake per customer message on a thread Ben is
  handling is P19's whole point (the priced draft on his phone before she rings). What was wrong is
  the 283 identical re-derivations between messages. Changing whether the clerk prepares on Ben's
  lane would change what Ben gets, which is out of scope and not needed.

## What the fix does and does not change

- A quote-tagged thread whose last pass started at or after the customer's latest inbound, with
  no `needs_quote` / `rescope` on the row that the pass did not find, is **not** asked for another
  cadence run by the net. It is asked again when the customer writes (the inbound path requests its
  own run, which then stamps afresh), when a quote tag lands (a direct requester outside a pass, or
  the net for one that landed in-pass), or when Ben presses run now (`manual`, `routes.ts:242`).
- The first pass on a fresh turn is never suppressed: no stamp, or a stamp older than the customer's
  word, means "nobody has looked", exactly as P10 built it. Pinned by test.
- The four direct requesters are byte-for-byte unchanged and never read the field.
- A run that throws is not stamped; the lease-expiry retry is as it was (see D13 for its own loop).
  A run that *completes* with an error recorded on it (a refused model, an unregistered agent) is
  stamped, like the legacy sweep's stamp-before-run: a failed look is still a look, and a retry
  storm on a dead key is the thing this fixes. Ben's run-now is the override.
- Stamps are written for every live pass (any trigger, any lane) and every shadow pass. Sandbox
  passes and hand-run dry runs never reach `runDue` or `runShadow`, so never stamp.
- Nothing about what a run may say. Nothing customer-visible. No flag, no rate limiter, no
  migration (a jsonb key on the row, like `lastAutoTriageAt` and `nextTriageAt`). An unreadable
  row or a malformed stamp fails closed for that pass (no run) and the net never throws.

## The gate, as measured

| | Before (`63390fa`) | After |
|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` errors | 1,880 | 1,880 |
| New tsc errors (diff by file, line, col and code) | — | **0** (the two lists are identical at that grain) |
| vitest (`DATABASE_URL=<placeholder> vitest run`, server + client) | 43 failed · 1,737 passed · 8 skipped (1,788) in 121 files | 42 failed · 1,752 passed · 8 skipped (1,802) in 122 files |
| Failing set diff | — | **−1:** `call-script/__tests__/performance.test.ts › should handle repeated classifications without memory growth`, the `heapUsed` benchmark D7 also saw flip; it failed in the baseline run (which ran alongside a tsc at 8 GB) and passed after. Every other failing test is identical. Nothing new fails. |
| New tests | — | 14 passed (`server/spine/clerk-reruns-d1.test.ts`); at `63390fa`, 8 of 14 fail |
| esbuild `server/index.ts --bundle --platform=node --packages=external --format=esm` (the `npm run build` flags) | — | bundles (4.2 MB) |

## What to look for in the ledger after deploy (copy and paste)

The fix is only proven here by test. After the worker deploys, the shape to look for is: **runs on
`76c0a399…` stop at the deploy and do not resume until the customer writes.**

```sql
-- 1. Runs per hour on the thread, last 48 h. Expect the six-minute drumbeat to end at the deploy
--    time and the next row to be an inbound_message trigger, if any.
SELECT date_trunc('hour', started_at) AS hour, trigger, agent, count(*)
FROM agent_runs
WHERE conversation_id LIKE '76c0a399%'
  AND started_at > now() - interval '48 hours'
GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2;

-- 2. The stamp is on the row (written by the first post-deploy pass on any trigger).
SELECT id, tags, metadata->'lastSpinePass' AS last_pass, metadata->>'nextTriageAt' AS pending
FROM conversations WHERE id::text LIKE '76c0a399%';

-- 3. The net is saying why. On the worker's logs, grep for the new reason:
--    "[Spine] ensureQuoteRun 76c0a399… (untriggered sweep): no run — the desk already looked at this turn"

-- 4. Sanity across the board: cadence runs per day, all threads, should fall to roughly one per
--    quote-tagged thread per customer turn rather than 288 per looping thread.
SELECT date_trunc('day', started_at) AS day, count(*) FILTER (WHERE trigger = 'cadence') AS cadence, count(*) AS all_runs
FROM agent_runs WHERE started_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1 DESC;
```

If (1) still shows cadence runs every six minutes after the deploy with no inbound between, the
next question is whether the row's `lastSpinePass` is being written at all (2); if it is and the
net still asks, the reason line (3) says which check let it through.

## Not done

- **No before/after on the real thread.** No database and no key here. The captain's check above is
  the after.
- **D11 (appended):** the in-pass direct requesters are refused by the run's own lease in live
  mode, so the net is load-bearing for a tag that lands during a pass and the clerk's pass waits up
  to five minutes. Works, and this fix relies on the stamp recording *found* tags because of it, but
  it is not what P10 intended. Not changed here: touching `shouldRequestQuoteRun`'s pending-pass
  check changes when every clerk pass is scheduled.
- **D12 (appended):** the P7 promised-more follow-up re-requests every 15 minutes with no bound. A
  different clock, the same family; the stamp does not gate it because the requester is not the
  net.
- **D13 (appended):** a pass that throws is retried every lease for as long as it throws.
- **Whether the thread should be archived or its `rescope` tag removed** is the captain's, being
  decided separately, and nothing here touches it. Note that with the tag standing and no fix,
  every one of the four ways D7 listed for a loop to stop still applies; with this fix none is
  needed.
- **`AGENTS.md` not created.** `fm-ensure-agents-md.sh` would rename the checked-in `CLAUDE.md`
  to `AGENTS.md` and leave a pointer — a repo-wide move that belongs in its own PR, not a bug fix,
  and the same call D7 made. Nothing this pane learned is missing from the repo: the gate notes
  are in this section and D7's, and the stamp is documented at its definition.
