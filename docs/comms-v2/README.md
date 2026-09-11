# docs/comms-v2

Landed knowledge for the clean-sheet rebuild of the comms desk, so an autonomous `/goal` build
loop has it to read from the repo instead of from outside sources.

- `behaviour.md` is the oracle: the captain's 38 recorded answers on how the desk should behave.
- `checklist.md` is the stop condition: the seven-stage, line-by-line checklist a sandbox thread
  either passes or fails against.
- `design.md` is the shape: the agent-map architecture, the box-for-box mapping, the channels, the
  specialist roster, the landlord seams, the settled decisions, and the build plan.
- `contracts.md` is what a goal loop builds against: the six contracts, each a record shape, its
  named calls, what each call refuses, and the invariants a test can check; then how a goal is
  validated.

Each goal is validated by the no-mistakes pipeline's end-to-end test step against the desk's
sandbox door, with recorded evidence in the PR; the goal's checklist lines are the scenarios it
exercises, and the captain reviews sandbox threads before any flip. Goals with independent files
run in parallel.

The build lands in `server/comms-v2/` beside `server/spine/`; it never goes inside `server/spine/`.
Goal 1's desk (sandbox-only until cutover) and Goal 2's board over it (`/admin/comms-v2`) are there
already, with the board's answer action beside its release (Ben's own words out through the one
sender, no guards over them, recorded as his); `server/comms-v2/README.md` covers them, the desk contract
by contract with its sandbox door, the door host and the environment they read, and the board piece
by piece. The old desk stays live
as rollback until the new one is proven and cut over.
