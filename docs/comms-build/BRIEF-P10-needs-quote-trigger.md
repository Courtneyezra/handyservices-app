# P10: tagging `needs_quote` must schedule a spine pass (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit  (branch p10-needs-quote-trigger, from comms-v3)

Observed 4 Sep (Sarah, 4c0e227b…): the thread carried `needs_quote` with no pass pending, so the clerk never ran until the orchestrator requested a run by hand. The tag is a passive label today. Same rules as every brief (worktree only; no DB; verification gates; commit; `P10-DONE.md`).

## Fix
1. One function `ensureQuoteRun(conversationId, reason)` in `server/spine/request-run.ts`: if the thread has tag `needs_quote` (or `rescope`) and no live estimate / non-superseded Route A draft newer than the tag AND no pending run (`metadata.nextTriageAt` absent or in the past by > 10 min), call `requestRun(conversationId, 'cadence', { delayMs: 0 })`. Idempotent; logs one line.
2. Call it from every place that writes the tag: the legacy `set_board_state` tool in server/agents/comms.ts, the spine's tag write in exit.ts / index.ts (Scoper proposals with `tags`), the P9 rescope pre-check, and the portal override that sets readiness. Also from the worker's slow sweep (every 5 min): `sweepUntriggeredQuotes()` selects up to 5 customer threads with `needs_quote` and no live estimate/draft and no pending run, and calls ensureQuoteRun — the safety net for anything that slips through.
3. Shadow mode must still run it (Route A is internal), and `runDue` stays live-only; for shadow, the legacy tick's `runShadow` path picks the row up as it does today — verify that a cadence-triggered row is honoured by the shadow path, and if not, make `runShadow` accept it.
4. Tests with fakes: tag present + no estimate → run requested once; tag present + live estimate → nothing; pending run → nothing; sweep picks up 5 max.
