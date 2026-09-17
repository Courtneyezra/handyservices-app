# Overnight sandbox rounds

One line per round: the scenario, what happened, and the fix (or "no issue").
An `ESCALATE:` line at the top of this file is a live compliance or money finding, added on the
round it was found.

- Round 1 (17 Sep 2026) — the reopen template on a hold that is not a question, WhatsApp, driven on
  the app's own comms-v2 sandbox door as Ben. A complaint ("Nobody turned up for the bathroom job
  yesterday... What is going on?") held on `complaint` with the complaint fixed line sent; window
  aged 30h shut; the board's template-offer and send-template both refused with "no template is
  true for this thread", the hold stood and no turn was written — correct. The positive control
  found a live gap: a plain question nothing on file answers ("what year was your company
  founded?") holds on `no_source` and the desk's holding line goes out as the fixed `no_source`
  line woven into a composed reply, so `unansweredQuestion` counted it as an answer and the board
  offered Ben no template at all once the window shut — the customer could never be reopened,
  against behaviour.md answer 94 ("the holding line is not an answer"). Fix: a standing `no_source`
  hold makes the desk's own sends holding lines rather than answers in
  `unansweredQuestion` (`server/comms-v2/desk/human-reply.ts`), read from the recorded exception
  like `heldOnQuestion`, with two regression tests in `desk/human-reply.test.ts`. Re-driven live:
  the complaint still draws nothing, and the question now reaches the template rung (refused only
  by this branch's unapproved `service_reply` rung, an environment limit).
