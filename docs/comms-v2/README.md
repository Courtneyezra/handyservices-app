# docs/comms-v2

Landed knowledge for the clean-sheet rebuild of the comms desk, so an autonomous `/goal` build
loop has it to read from the repo instead of from outside sources.

- `behaviour.md` is the oracle: the captain's 38 recorded answers on how the desk should behave.
- `checklist.md` is the stop condition: the seven-stage, line-by-line checklist a sandbox thread
  either passes or fails against.
- `design.md` is the shape: the agent-map architecture, the box-for-box mapping, the channels, the
  specialist roster, the landlord seams, the settled decisions, and the build plan.
- `contracts.md` is what a goal loop builds against: the seven contracts, each a record shape, its
  named calls, what each call refuses, and the invariants a test can check.

The build lands in a new directory under `server/` beside `server/spine/` (working name
`server/comms-v2/`); it never goes inside `server/spine/`. The old desk stays live as rollback until
the new one is proven and cut over.
