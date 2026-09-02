# P9: a scope increase is not "out of scope" (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit  (branch p9-rescope-triage, from comms-v3)

Observed 4 Sep on Sarah's thread (4c0e227b…): she had a £569 quote for 3 doors, came back wanting all 9 and sent six photos. The spine's Haiku triage returned exception `out_of_scope` (lane ben) with reasons that clearly describe a normal re-scope. In live mode that sends the thread to Ben with a flag and NO scoping reply; the correct move is the Scoper's draft-and-flag: acknowledge the photos, confirm the new scope, and tag `needs_quote` so the clerk re-runs (money stays with Ben via the quote, not via a flag). Same rules as every brief (worktree only; no DB; verification gates; commit; `P9-DONE.md`).

## Fix
1. Triage prompt (`server/spine/triage.ts` model step): define `out_of_scope` precisely — work we do not do (trades we don't cover, jobs outside the service area, regulated work) — and state that a customer adding or changing scope on an existing or expired quote is `scoping` with tag `needs_quote` + `rescope`, never an exception. Add a rules-first pre-check: if the thread has a quote (case file `quote`) and the inbound mentions more/extra/all/instead/another + a job noun, set tag `rescope` and lane `scoper` before the model runs.
2. Scoper standing orders: on `rescope`, acknowledge what arrived (photos count), confirm the new scope in one line, say the quote is being redone, and tag `needs_quote`; never state a price or reference the old figure.
3. Eval cases: `eval-cases/rescope/` (≥ 5): Sarah's case (scrubbed), a 1-line quote becoming 3 lines, a customer swapping one job for another, a genuine out-of-scope (asbestos removal), a genuine regulated trade (gas boiler swap) — the last two MUST flag, the first three MUST NOT. Family wired into the harness like the others.
4. Tests for the pre-check with fakes.
