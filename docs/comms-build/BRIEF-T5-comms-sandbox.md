# T5 — the comms sandbox: type as a customer, watch the desk think, nothing sent

## What paid for this brief

Courtnee, 6 Sep 2026: *"could we build a test platform to mimic conversation and see the chat in
realtime, tool calls, etc?"* — and, on how it should feel, *"the way how lavish opens a browser"*.

He is deciding whether the Scoper's replies may reach customers without Ben approving each one.
The evidence that decision turns on is whether the assistant makes the right **move**, not whether
its sentences are safe. Five known wrong-move shapes exist in the ledger: a customer objecting on
price, saying the quote is too expensive, asking for a call before paying, skirting a negotiation,
and demanding a price. In each, the pipeline proposes a polite, clean, completely wrong reply,
because it carries on scoping while ignoring what the customer said. He wants to reproduce those
by hand and watch it happen. An hour of Ben doing that is worth more than another report.

## The finding that makes this bigger than asked

`LiveRunPanel` (`client/src/components/comms/LiveRunPanel.tsx`) renders a run step by step off
`GET /api/comms/events`. **Only the legacy agent emits those events** (`server/agents/comms.ts:1305`).
The spine emits `board_delta` and `artifact_delta` only. The legacy agent is on the Phase 5 delete
list (`PHASE5-DELETE.md`, eligible 10 Sep), so the panel goes dark the day F3 lands. Wiring the
spine to emit `run_started` / `run_event` / `run_finished` is required for the sandbox **and**
independently saves the panel.

## What to build

1. **The spine emits live run events** from `runOnce` (`server/spine/index.ts`), for every run,
   not only sandbox ones: `run_started`; a `run_event` per stage (case file, triage with lane /
   exceptions / tags / rules-or-model, pack + agent chosen, each Scoper tool call and result, the
   proposal with intent / bubbles / reasons, the guard verdict, the decision, and at the exit
   boundary what happened or — on a dry run — what *would* have happened); `run_finished` with
   `ok`. Same lean payload shape as the legacy `leanTranscriptEvent`, moved to a module the Phase 5
   delete does not take. Emission is wrapped: a failed emit is logged and swallowed.
2. **The sandbox route** (`server/spine/sandbox-routes.ts`, mounted at `/api/comms-sandbox` behind
   `requireAdmin`, not dev-only): reset the sandbox thread, post a customer message and run the
   spine on it with `dryRun`, seed a synthetic unpaid quote, read the thread and its runs.
3. **The page** (`/admin/sandbox`, in the admin sidebar): chat on the left, `LiveRunPanel` on the
   right, the run's detail (triage, pack, guards, decision, proposed reply, `cost_pence`) beneath,
   and a "NOT SENT — dry run" state impossible to misread.

## Hard constraints

**The sandbox must be structurally incapable of sending, not configured not to send.** Three
independent layers, each pinned by a test:

1. **Dry run.** `runOnce(..., { dryRun: true, sandbox: true })`. `sandbox` implies `dryRun` inside
   `runOnce` itself, so the route cannot forget; the exit (`server/spine/exit.ts`, the only sender)
   is never called.
2. **The number.** The sandbox thread lives on `+447700900942` / `447700900942@c.us` — the next
   number in the Ofcom drama range after the dev board demo's `…941`, chosen so the board demo's
   `action=cleanup` can never wipe a sandbox session and vice versa. `isSandboxPhone` builds on the
   one `isTestNumber` (`server/phone-utils.ts`); the route looks the thread up **by number only**
   and never accepts a conversation id from the client. `runOnce` with `sandbox: true` refuses a
   case file whose phone is not the sandbox number.
3. **No trigger.** The sandbox conversation is created without `metadata.nextTriageAt`;
   `requestRun` already refuses test numbers, the cadence sweep already skips them, the rules
   layer already suppresses them. The SLA sweep and the desk's SLA candidates do **not** skip test
   numbers today — add the skip, so a sandbox run can never ping Ben.

**It must not pollute the evidence.** A sandbox run writes an `agent_runs` row like any run, with
`proposal.sandbox = true`. The sampler and the autonomy job's `gatherEvidence` exclude such rows
by an explicit predicate (dry runs already fall out of the draft-joined queries because they queue
no draft; the `agent_runs`-only queries — escalations, incidents — would otherwise count them).
Nothing else in the sampler or autonomy changes.

**Keep the thread off Ben's desk and board.** `loadBoardCards` excludes the sandbox number; the
desk's reply items derive from the board; the desk's SLA candidates skip test numbers.

**In sandbox mode, `runOnce` skips the two internal side-chains that reach outside the thread:**
job pack filing (writes job packs) and Route A (writes draft quotes and pushes Ben's phone). Both
are recorded on the run and shown on the page as skipped. Triage, pack, Scoper, guards and the
decision run exactly as live.

- **Templates are rejected.** No fixed reply text anywhere.
- **Nothing about autonomy.** No tier moves, no `app_settings` flag, no automatic sending.
- **Do not touch the first-contact ack or anything about customer prices or money.** The seeded
  quote is synthetic test data on the sandbox number, marked `SANDBOX` in its description.

## The dev-only blocks

`server/comms-events-route.ts` carries two `TEMP (dev only, DELETE BEFORE COMMIT)` blocks.
The canned run replay is superseded (real runs now drive the panel): **delete it**. The board
demo is unrelated to this task and still the only way to review the board animation without a
real customer: **keep it, dev-only as it is**, and drop the "DELETE BEFORE COMMIT" wording, which
has been false since it was committed.

## Build gate (CLAUDE.md), measured

- Zero NEW tsc errors against the start commit (`NODE_OPTIONS=--max-old-space-size=8192`, ~1,880
  pre-existing). Diff the error lists, never the counts.
- vitest failing set unchanged, plus the new tests passing (no `.env`: the spine suites that
  import the db fail at import; judge by the set diff).
- esbuild bundles `server/index.ts`.
- Never `db:push`; no migration; never flip an `app_settings` flag.

## Cannot be run here

No `.env`, no database, no model key. The page is built without being opened. The DONE report
says so and carries an exact "how to verify this locally" section for a non-developer.

## Definition of done

- `runOnce` emits `run_started`, stage `run_event`s, Scoper tool events, and `run_finished` on
  every run; a throwing emitter never fails a run. Pinned by test.
- `runOnce({ sandbox: true })` never calls the exit, refuses a non-sandbox phone, skips Route A
  and filing, and stamps `proposal.sandbox = true`. Pinned by test.
- The sandbox route refuses to act on anything but the sandbox number; the SLA sweep, desk and
  board exclude it. Pinned by test where the code is reachable without a database.
- The sampler and autonomy predicates exclude sandbox rows. Pinned by test.
- `/admin/sandbox` exists, is in the sidebar, reuses `LiveRunPanel` + `useCommsEvents`, and shows
  the dry-run state loudly. Built, not seen.
- `docs/comms-build/T5-DONE.md` with the local verification steps at the top and a Not done section.
