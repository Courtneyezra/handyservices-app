# T5 — the comms sandbox: DONE report

Brief: `BRIEF-T5-comms-sandbox.md`. Branch `fm/comms-sandbox-t5`, start commit `9e5a12a`.

**This was built without being run.** The pane had no `.env`, no database and no model key, so
the dev server was never started, the page was never opened, and no end-to-end pass was executed.
Everything below is verified by unit tests and the build gate only. Nothing in this report is a
claim about how the page looks or behaves live. The section right below is how you find out.

---

## How to verify this locally (copy and paste)

You need the repo checked out on this branch with the usual `.env` (database, Anthropic key) and
an admin login for the app. Open a terminal in the project folder.

1. **Start the app.**
   ```bash
   npm run dev
   ```
   Wait until it prints a line like `Production server running on port 5001`.

2. **Open the sandbox.** In your browser go to:

   http://localhost:5001/admin/sandbox

   Log in as admin if asked. It is also in the left sidebar under DISPATCH CONSOLE as
   **Sandbox** (a flask icon).

3. **What you should see on load:** a yellow banner saying *Dry run only* with the number
   `+447700900942`; a grey box saying *No sandbox thread yet*; a button **Start a clean thread**.
   The message box is greyed out until you press it.

4. **Press "Start a clean thread".** The left panel header should change to *Sandbox customer
   (not real)*, stage `enquiry`, and the message box becomes usable.

5. **Type as a customer and press Enter** (or "Send as customer"). Try:
   `Hi, do you fit bathroom extractor fans? The old one has died.`

   What you should see, in order:
   - a dashed bubble *the desk is thinking…* on the left;
   - on the right, *Agent working on this thread…* with lines appearing one by one: `Case file: …`,
     `Triage (…): lane …`, `Pack … → agent scoper`, then the Scoper's tools (e.g. *Reading thread*,
     *Propose reply*), then `Proposed …`, `Guards: …`, `Decision: …`, and finally a bold amber line
     starting **DRY RUN — nothing sent**;
   - the right column then fills with the pass: a dashed amber box **NOT SENT — dry run** at the
     top, the decision, the proposed reply bubbles, triage / pack / guards / cost;
   - the proposed reply also appears in the chat as a dashed amber bubble labelled *proposed reply ·
     NOT SENT · dry run*.
   - The run typically takes 10–40 seconds (it is a real Sonnet belt).

6. **Reproduce the wrong-move shapes.** Press **Seed quote** (default £480). A green *unpaid quote*
   pill appears in the thread header and a synthetic *Here's your quote…* bubble lands in the chat.
   Now click one of the chips above the box (*Objects on price*, *Quote too expensive*, *Wants a
   call before paying*, *Skirts a negotiation*, *Demands a price*) to fill the message, and send.
   Watch what the desk proposes. The known failure is a polite scoping question that ignores what
   the customer just said.

7. **Prove nothing was sent.** Open `/admin/comms` and `/admin/desk` in another tab: the sandbox
   thread must NOT appear on the board or the desk. Ben's phone must not buzz. In the database, if
   you want to look: `select id, decision, proposal->>'sandbox', proposal->>'dryRun' from agent_runs
   order by started_at desc limit 5;` — the sandbox rows show `true`, `true`.

**What would indicate a fault:**
- The right panel stays on *Send a message and the pass appears here…* while the reply comes
  back: the live feed is not reaching the browser (check the server log for `[Spine] run event
  emit failed`).
- A red *Agent run failed* line and an *Error* row in the detail: the model belt threw — the error
  text says why (usually a missing key).
- A 500 with `sandbox run refused`: the thread found on the number is somehow not on the sandbox
  number. This should be impossible; press **Reset thread**.
- The sandbox thread showing up on `/admin/comms` or `/admin/desk`: the exclusion is not applied;
  stop and report.
- Anything at all arriving on a real phone: stop everything and report. The exit is never called
  on a sandbox pass (pinned by test), so this would mean a different sender entirely.

**To clean up:** press **Reset thread**. It deletes every row on the sandbox number (messages,
runs, drafts, nudges, the synthetic quote) and starts clean.

---

## What shipped

### 1. The spine emits the live run feed (`server/spine/run-events.ts`, `server/spine/index.ts`)

The finding that made this bigger than asked: only the legacy agent (`server/agents/comms.ts`, on
the Phase 5 delete list, eligible 10 Sep) emitted `run_started` / `run_event` / `run_finished`, so
`LiveRunPanel` went dark for every spine run and would have gone dark for good when F3 lands.
`runOnce` now opens the feed before anything else and closes it in a `finally`, on **every** pass:

- `run_started`
- `stage` events (a new, additive lean step type): `case_file`, `triage` (lane, intent, exceptions,
  tags, rules-or-model, reasons), `pack` (pack + agent chosen, Ben-lane clerk verdict), each Scoper
  tool call / result / assistant text (the belt's `onEvent`, threaded through the new optional
  `SpineAgent.run({ onEvent })`), `proposal` (intent, bubbles, reasons, flag, artifact), `guards`,
  `decision`, and `exit` — which on a dry run says **what would have happened** (`wouldHaveHappened`)
- `run_finished` with `ok`

Every emit is fail-safe (logged and swallowed). `leanTranscriptEvent` moved out of `comms.ts` into
`run-events.ts`; the legacy agent imports it from there, so Phase 5 takes nothing the panel needs.

### 2. The sandbox (`server/spine/sandbox.ts`, `server/spine/sandbox-routes.ts`, `/api/comms-sandbox`)

Three structural layers, each pinned by test in `server/spine/sandbox.test.ts`:

1. **Dry run.** `runOnce` gained `sandbox: true`, which *implies* `dryRun` inside `runOnce`
   itself — the route passes `dryRun: true` too, but cannot forget it. The exit is never called
   (test: `layer 1`).
2. **The number.** `+447700900942` / `447700900942@c.us`: the next Ofcom drama number after the
   dev board demo's `…941`. Chosen distinct on purpose: the board demo's `action=cleanup` deletes
   everything on its number, and a sandbox session must not be wiped by someone reviewing the board
   animation (or vice versa). `isSandboxPhone` builds on the one `isTestNumber`. The route looks the
   thread up by number only — no route has a parameter, no handler reads a conversation id (pinned
   structurally in `sandbox-routes.test.ts`). `runOnce` with `sandbox: true` also refuses any case
   file not on that number, before triage (test: `layer 2`).
3. **No trigger.** The thread is created without `metadata.nextTriageAt` (the only thing `runDue`
   and the legacy ticker read); `requestRun` refuses test numbers; the cadence sweep skips them; the
   rules layer suppresses them. Two gaps found and closed: the **SLA sweep** and the **desk's SLA
   candidates** did not skip test numbers, and a sandbox pass that lanes to the clerk writes a
   `quote_clerk` run row, which is exactly what those candidates select on — so a sandbox thread
   could have pinged Ben. Both now skip `isTestNumber` before the lane detector runs (pinned at the
   source in `sandbox-exclusions.test.ts`).

**Evidence hygiene.** The `agent_runs` row carries `proposal.sandbox = true` (and the skipped list).
The sampler skips such rows; all four of `gatherEvidence`'s agent_runs queries carry
`notSandboxRunSql`. The draft-joined queries already could not see a dry run (no draft), but the
two agent_runs-only queries (escalations, incidents) **would** have counted a sandbox flag or send
decision — so the explicit predicate was needed, not just proved.

**Off Ben's desk and board.** `loadBoardCards` excludes the sandbox number; the desk's reply items
derive from the board; the desk's SLA candidates skip test numbers.

**Side-chains a sandbox pass does not run:** job pack filing (writes job packs) and Route A (writes
draft quotes and pushes Ben's phone). Both are recorded on the run and shown as *Skipped* on the
page. Triage, pack, Scoper, guards and the decision run exactly as live.

Endpoints: `GET /` (state), `POST /reset`, `POST /message { text }`, `POST /quote { totalPence?,
title? }` — the quote seed is a synthetic unpaid `personalized_quotes` row on the sandbox number,
marked `SANDBOX` in its description, plus the "here's your quote" outbound bubble that dates it, so
the post-quote pack and the four quote-dependent wrong-move shapes are reachable.

### 3. The page (`client/src/pages/admin/SandboxPage.tsx`, `/admin/sandbox`, in the sidebar)

Chat on the left (customer bubbles left, synthetic quote bubble right, the proposed reply as a
dashed amber *NOT SENT* bubble); `LiveRunPanel` on the right with a new `keepFinished` prop so the
finished pass stays readable; the run detail beneath, led by a dashed amber **NOT SENT — dry run**
box carrying the exit line, then the decision (a `send` reads *SEND — would go to the customer with
no approval*, in red, still inside the NOT SENT frame), the reply, triage, pack, guards, quote seen,
window, cost (`cost_pence`, model, duration), skipped side-chains. Five chips fill the box with the
five wrong-move shapes as **customer** lines (not reply templates: the assistant's words stay its
own). `LiveRunPanel` learned the `stage` step type (additive; the desk's behaviour is unchanged and
pinned).

### The two dev-only blocks

- **Canned run replay: deleted.** Superseded — real spine runs now drive the panel, and the sandbox
  is where to watch one.
- **Board demo: kept, dev-only as it was.** It is still the only way to review the board animation
  without a real customer, and it is unrelated to this task. The false "DELETE BEFORE COMMIT"
  wording is gone from its comment, which now records why it stays and its relationship to the
  sandbox number.

---

## Build gate, as measured

| Check | Start commit `9e5a12a` | This branch |
|---|---|---|
| `tsc --noEmit` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs start (diff of the lists, not counts) | — | 0 (per-file counts identical; the two errors the first run introduced in `server/spine/index.ts` were fixed before commit) |
| vitest server failing files (placeholder `DATABASE_URL`, no `.env`) | 43 tests in 4 files (18 suites fail at collection) | 43 tests in 4 files (18 suites fail at collection) |
| vitest failing-set diff | — | identical: 0 new failing, 0 fixed; 1,423 → 1,469 tests, 1,372 → 1,418 passing |
| new tests | — | 58 passing (46 server, 12 client) |
| esbuild bundle `server/index.ts` | — | bundles (4.2 MB) |
| `db:push` / migration / `app_settings` flag | none | none |

Both vitest runs used the same placeholder `DATABASE_URL` (a socket that never connects) so the spine suites that open the pool at import fail identically on both sides; the failing-set diff was computed from the JSON reporters, test by test, not from counts. The client project was run for the two new suites only (12 passing); it was already green on `main` for the files touched.

A note on the tsc diff: with the union-member ordering normalised the lists still differ by a handful of pre-existing lines whose error text prints a type union in a different order between runs (e.g. `server/lead-stage-engine.ts`, `server/first-contact-ack.ts`); those are the same errors, not new ones, and are excluded from the NEW count above by inspection.

New test files: `server/spine/run-events.test.ts`, `server/spine/sandbox.test.ts`,
`server/spine/sandbox-routes.test.ts`, `server/spine/sandbox-exclusions.test.ts`,
`client/src/components/comms/__tests__/LiveRunPanel.test.tsx`,
`client/src/pages/admin/__tests__/SandboxPage.test.tsx`.

---

## Not done

- **Never run live.** No `.env`, database or model key in this pane. The page, the SSE feed in a
  real browser, the seeded quote's effect on the case file and the cost figure are all untested
  end to end. The "How to verify" section above is the deliverable in place of that.
- **Route A and job pack filing are skipped in the sandbox**, by design (they push Ben and write
  draft quotes / job packs). So the sandbox cannot show the clerk → estimator → priced-draft chain.
  If that is wanted, a sandbox-safe Route A (no Pushover, quote rows on the sandbox number only) is
  a new row (BACKLOG T5-a).
- **No replay of a real thread.** The sandbox starts from an empty thread or a synthetic quote; it
  cannot yet copy a real conversation's messages onto the sandbox number to replay a live failure
  with the exact wording (BACKLOG T5-b).
- **Shadow runs count in `gatherEvidence` too.** Pre-existing, noticed on the way: the same two
  agent_runs-only queries (escalations, incidents) count `proposal.shadow = true` rows. Not touched
  here — out of scope (the brief says no sampler / autonomy logic beyond the sandbox predicate), but
  it is the same shape of leak (BACKLOG T5-c).
- **The AGENTS.md helper was not run.** `fm-ensure-agents-md.sh` would move this project's
  `CLAUDE.md` into a new `AGENTS.md` and replace `CLAUDE.md` with a pointer — a repo restructuring
  outside this task. A two-line pointer to the sandbox was added to `CLAUDE.md`'s comms section
  instead.
- **`LiveRunPanel` on the desk** now also shows the spine's stage lines for real threads (they ride
  the same feed). That is the point — the panel works again — but it has not been seen there either.

## New BACKLOG rows

Appended to `BACKLOG.md` under a new Lane 6 (T5 follow-ups): T5-a sandbox-safe Route A; T5-b replay
a real thread in the sandbox; T5-c shadow rows in `gatherEvidence`.
